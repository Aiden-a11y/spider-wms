import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

// ── SSE event helper ──────────────────────────────────────────────────────────
type ProgressEvent =
  | { type: "status"; msg: string; pct: number }
  | { type: "done"; inserted: number; warehouses: number; date: string; errors?: string[] }
  | { type: "error"; msg: string };

function sseEncode(enc: TextEncoder, ev: ProgressEvent): Uint8Array {
  return enc.encode(`data: ${JSON.stringify(ev)}\n\n`);
}

export async function GET(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const secret =
    req.headers.get("x-cron-secret") ??
    req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Supabase env vars missing" }, { status: 500 });
  }

  const userId = process.env.WMS_USER_ID;
  const password = process.env.WMS_PASSWORD;
  if (!userId || !password) {
    return NextResponse.json({ error: "WMS credentials missing" }, { status: 500 });
  }

  // ── SSE stream ──────────────────────────────────────────────────────────────
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: ProgressEvent) => {
        try { controller.enqueue(sseEncode(enc, ev)); } catch { /* client disconnected */ }
      };

      try {
        // ── Login ─────────────────────────────────────────────────────────────
        send({ type: "status", msg: "Logging in to WMS…", pct: 0 });

        const loginRes = await fetch(`${WMS_BASE}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, password, clientId: "wms_web" }),
        });
        if (!loginRes.ok) {
          const err = await loginRes.json().catch(() => ({}));
          send({ type: "error", msg: `Login failed: ${(err as Record<string, unknown>)?.message ?? loginRes.status}` });
          controller.close();
          return;
        }
        const loginJson = await loginRes.json();
        const token: string =
          loginJson?.data?.token ??
          loginJson?.data?.accessToken ??
          loginJson?.token ??
          loginJson?.accessToken;
        if (!token) {
          send({ type: "error", msg: "Token not found in login response" });
          controller.close();
          return;
        }

        const sb = createClient(supabaseUrl!, supabaseKey!);
        const capturedAt = new Date().toISOString();
        const today = new Date().toLocaleDateString("en-CA", {
          timeZone: "America/Los_Angeles",
        });

        // ── Warehouses ────────────────────────────────────────────────────────
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

        // ── Phase 1: collect all SKUs per warehouse+customer (5% → 15%) ──────
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
        send({ type: "status", msg: `Found ${totalSkus} SKUs across ${workItems.length} customer(s). Fetching inventory…`, pct: 15 });

        // ── Phase 2: fetch inventory (15% → 90%) ──────────────────────────────
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
                const zone     = String(item.zoneName     ?? item.zone     ?? "");
                const aisle    = String(item.aisleName    ?? item.aisle    ?? "");
                const bay      = String(item.bayName      ?? item.bay      ?? "");
                const level    = String(item.levelName    ?? item.level    ?? "");
                const position = String(item.positionName ?? item.position ?? "");
                const location = [zone, aisle, bay, level, position].filter(Boolean).join("-");

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

            // Progress: 15% ~ 88%
            const pct = totalSkus > 0
              ? Math.round(15 + (doneSkus / totalSkus) * 73)
              : 50;
            send({
              type: "status",
              msg: `${work.whCode} / ${work.custCode} — ${doneSkus}/${totalSkus} SKUs`,
              pct,
            });

            if (i + BATCH < work.skus.length) await delay(400);
          }

          // ── Upsert to Supabase ──────────────────────────────────────────────
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
                errors.push(`insert ${work.whCode}/${work.custCode}: ${insertErr.message}`);
              } else {
                totalInserted += Math.min(500, rows.length - i);
              }
            }
          }
        }

        // ── Done ─────────────────────────────────────────────────────────────
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
      "X-Accel-Buffering": "no", // disable nginx buffering
    },
  });
}
