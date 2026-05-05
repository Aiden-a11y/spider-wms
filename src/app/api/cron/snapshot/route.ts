/**
 * GET /api/cron/snapshot
 * Called automatically by Vercel Cron (vercel.json schedule: "0 23 * * *" = 4 PM PDT).
 * Vercel sends: Authorization: Bearer <CRON_SECRET>
 * Returns plain JSON (cron doesn't need SSE streaming).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Allow up to 300 seconds (Vercel Pro) — prevents 10-second default timeout
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

export async function GET(req: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  // Vercel Cron sends:  Authorization: Bearer <CRON_SECRET>
  // Manual / test call: ?secret=<CRON_SECRET>  or  x-cron-secret: <CRON_SECRET>
  const authHeader = req.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const secret =
    bearerToken ||
    req.headers.get("x-cron-secret") ||
    req.nextUrl.searchParams.get("secret");

  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Env check ────────────────────────────────────────────────────────────────
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

  // ── Login ────────────────────────────────────────────────────────────────────
  const loginRes = await fetch(`${WMS_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, password, clientId: "wms_web" }),
  });
  if (!loginRes.ok) {
    const err = await loginRes.json().catch(() => ({}));
    return NextResponse.json(
      { error: `Login failed: ${(err as Record<string, unknown>)?.message ?? loginRes.status}` },
      { status: 500 }
    );
  }
  const loginJson = await loginRes.json();
  const token: string =
    loginJson?.data?.token ??
    loginJson?.data?.accessToken ??
    loginJson?.token ??
    loginJson?.accessToken;
  if (!token) {
    return NextResponse.json({ error: "Token not found in login response" }, { status: 500 });
  }

  const usingServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sb = createClient(supabaseUrl, supabaseKey);
  const capturedAt = new Date().toISOString();
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });

  let totalInserted = 0;
  const errors: string[] = [];

  // ── Warehouses ───────────────────────────────────────────────────────────────
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

  // ── Per warehouse → customer → SKU ──────────────────────────────────────────
  for (const wh of warehouses) {
    try {
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
        try {
          // Paginate SKU list
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

          if (skus.length === 0) continue;

          // Fetch inventory in batches of 5
          const rows: Record<string, unknown>[] = [];
          const BATCH = 5;

          for (let i = 0; i < skus.length; i += BATCH) {
            const batch = skus.slice(i, i + BATCH);
            const results = await Promise.all(
              batch.map((sku) =>
                wmsPost("inventory/detail", token, {
                  warehouseCode: wh.id,
                  customerCode: cust.code,
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
                  warehouse_code: wh.id,
                  customer_code:  cust.code,
                  location,
                  sku:            String(item.productSku ?? item.sku ?? sku),
                  product_name:   String(item.productName ?? item.itemName ?? "") || null,
                  qty:            Number(item.qty ?? item.quantity ?? item.onHandQty ?? 0),
                  available_qty:  item.availableQty != null ? Number(item.availableQty) : null,
                  lot:            String(item.lotNo ?? item.lot ?? "") || null,
                  expire_date:    String(item.expireDate ?? item.expiryDate ?? "") || null,
                });
              }
            }

            if (i + BATCH < skus.length) await delay(400);
          }

          // Upsert to Supabase
          if (rows.length > 0) {
            await sb
              .from("inventory_history")
              .delete()
              .eq("captured_date", today)
              .eq("warehouse_code", wh.id)
              .eq("customer_code", cust.code);

            for (let i = 0; i < rows.length; i += 500) {
              const { error: insertErr } = await sb
                .from("inventory_history")
                .insert(rows.slice(i, i + 500));
              if (insertErr) {
                errors.push(`${wh.id}/${cust.code}: ${insertErr.message}`);
              } else {
                totalInserted += Math.min(500, rows.length - i);
              }
            }
          }
        } catch (e) {
          errors.push(`${wh.id}/${cust.code}: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      errors.push(`${wh.id}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({
    ok: true,
    date: today,
    captured_at: capturedAt,
    inserted: totalInserted,
    warehouses: warehouses.length,
    supabase_key_type: usingServiceKey ? "service_role" : "anon",
    errors: errors.length > 0 ? errors : undefined,
  });
}
