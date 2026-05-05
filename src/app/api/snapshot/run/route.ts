/**
 * POST /api/snapshot/run
 * Called by the "Save Now" button in History page.
 * Uses the already-authenticated user's WMS Bearer token — no server-side WMS credentials needed.
 * Streams progress via SSE (text/event-stream).
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 300;

const WMS_BASE = "https://us-wms-api.stload.com/api";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function wmsGet(path: string, token: string) {
  const res = await fetch(`${WMS_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return res.json();
}

async function wmsPost(path: string, token: string, body: unknown) {
  const res = await fetch(`${WMS_BASE}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}`);
  return res.json();
}

type ProgressEvent =
  | { type: "status"; msg: string; pct: number }
  | { type: "done"; inserted: number; warehouses: number; date: string; errors?: string[] }
  | { type: "error"; msg: string };

const enc = new TextEncoder();
function sseEncode(ev: ProgressEvent): Uint8Array {
  return enc.encode(`data: ${JSON.stringify(ev)}\n\n`);
}

export async function POST(req: NextRequest) {
  // Auth: user passes their WMS Bearer token
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", msg: "No auth token" })}\n\n`,
      { status: 401, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", msg: "Supabase not configured" })}\n\n`,
      { status: 500, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: ProgressEvent) => {
        try { controller.enqueue(sseEncode(ev)); } catch { /* disconnected */ }
      };

      try {
        const sb = createClient(supabaseUrl, supabaseKey);
        const capturedAt = new Date().toISOString();
        const today = new Date().toLocaleDateString("en-CA", {
          timeZone: "America/Los_Angeles",
        });

        // ── 1. Warehouses ───────────────────────────────────────────────────
        send({ type: "status", msg: "Fetching warehouses…", pct: 2 });
        const whJson = await wmsGet("combo/warehouse", token);
        const rawWh: Record<string, unknown>[] = Array.isArray(whJson?.data)
          ? whJson.data
          : Array.isArray(whJson) ? whJson : [];
        const warehouses = rawWh
          .map((w) => ({
            id: String(w.code ?? w.id ?? w.warehouseId ?? ""),
            name: String(w.name ?? w.warehouseName ?? w.code ?? ""),
          }))
          .filter((w) => w.id);

        // ── 2. Collect all SKUs per warehouse+customer ──────────────────────
        send({ type: "status", msg: "Counting SKUs…", pct: 5 });

        type WorkItem = { whCode: string; custCode: string; skus: string[] };
        const workItems: WorkItem[] = [];

        for (const wh of warehouses) {
          const custJson = await wmsGet(`combo/customer-by-warehouse/${wh.id}`, token);
          const rawCust: Record<string, unknown>[] = Array.isArray(custJson?.data)
            ? custJson.data
            : Array.isArray(custJson) ? custJson : [];
          const customers = rawCust
            .map((c) => ({
              code: String(c.code ?? c.customerCode ?? c.id ?? ""),
              name: String(c.name ?? c.customerName ?? c.code ?? ""),
            }))
            .filter((c) => c.code);

          for (const cust of customers) {
            const skus: string[] = [];
            let page = 1;
            const pageSize = 500;
            while (true) {
              const skuJson = await wmsPost("product/list", token, {
                warehouseCode: wh.id,
                customerCode: cust.code,
                pageNum: page,
                pageSize,
              });
              const list: Record<string, unknown>[] = Array.isArray(skuJson?.data?.list)
                ? skuJson.data.list
                : Array.isArray(skuJson?.data) ? skuJson.data : [];
              const pageSkus = list
                .map((p) => String(p.productSku ?? p.sku ?? p.code ?? ""))
                .filter(Boolean);
              skus.push(...pageSkus);
              if (pageSkus.length < pageSize) break;
              page += 1;
              await delay(300);
            }
            if (skus.length > 0) {
              workItems.push({ whCode: wh.id, custCode: cust.code, skus });
            }
          }
        }

        const totalSkus = workItems.reduce((s, w) => s + w.skus.length, 0);
        send({
          type: "status",
          msg: `Found ${totalSkus} SKUs across ${workItems.length} customer(s). Fetching inventory…`,
          pct: 15,
        });

        // ── 3. Fetch inventory + save (15% → 100%) ─────────────────────────
        const BATCH = 5;
        let doneSkus = 0;
        let totalInserted = 0;
        const errors: string[] = [];

        for (const work of workItems) {
          const rows: Record<string, unknown>[] = [];

          for (let i = 0; i < work.skus.length; i += BATCH) {
            const batch = work.skus.slice(i, i + BATCH);
            const results = await Promise.all(
              batch.map((sku) =>
                wmsPost("inventory/detail", token, {
                  warehouseCode: work.whCode,
                  customerCode: work.custCode,
                  productSku: sku,
                }).catch(() => null)
              )
            );

            for (let j = 0; j < results.length; j++) {
              const invJson = results[j];
              const sku = batch[j];
              const items: Record<string, unknown>[] = Array.isArray(invJson?.data)
                ? invJson.data : [];

              for (const item of items) {
                const location = [
                  String(item.zoneName ?? item.zone ?? ""),
                  String(item.aisleName ?? item.aisle ?? ""),
                  String(item.bayName ?? item.bay ?? ""),
                  String(item.levelName ?? item.level ?? ""),
                  String(item.positionName ?? item.position ?? ""),
                ].filter(Boolean).join("-");

                rows.push({
                  captured_date:  today,
                  captured_at:    capturedAt,
                  warehouse_code: work.whCode,
                  customer_code:  work.custCode,
                  location,
                  sku:            String(item.productSku ?? item.sku ?? sku),
                  product_name:   String(item.productName ?? item.itemName ?? "") || null,
                  qty:            Number(item.qty ?? item.quantity ?? item.onHandQty ?? 0),
                  available_qty:  item.availableQty != null ? Number(item.availableQty) : null,
                  lot:            String(item.lotNo ?? item.lot ?? "") || null,
                  expire_date:    String(item.expireDate ?? item.expiryDate ?? "") || null,
                });
              }
              doneSkus += 1;
            }

            const pct = totalSkus > 0 ? Math.round(15 + (doneSkus / totalSkus) * 73) : 50;
            send({
              type: "status",
              msg: `${work.whCode} / ${work.custCode} — ${doneSkus}/${totalSkus} SKUs`,
              pct,
            });

            if (i + BATCH < work.skus.length) await delay(400);
          }

          // Save this customer's rows to Supabase
          if (rows.length > 0) {
            send({ type: "status", msg: `Saving ${rows.length} rows for ${work.custCode}…`, pct: 90 });

            await sb
              .from("inventory_history")
              .delete()
              .eq("captured_date", today)
              .eq("warehouse_code", work.whCode)
              .eq("customer_code", work.custCode);

            for (let i = 0; i < rows.length; i += 500) {
              const { error: insertErr } = await sb
                .from("inventory_history")
                .insert(rows.slice(i, i + 500));
              if (insertErr) {
                errors.push(`${work.whCode}/${work.custCode}: ${insertErr.message}`);
              } else {
                totalInserted += Math.min(500, rows.length - i);
              }
            }
          }
        }

        send({
          type: "done",
          inserted: totalInserted,
          warehouses: warehouses.length,
          date: today,
          errors: errors.length > 0 ? errors : undefined,
        });
      } catch (e) {
        send({ type: "error", msg: String((e as Error).message ?? e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
