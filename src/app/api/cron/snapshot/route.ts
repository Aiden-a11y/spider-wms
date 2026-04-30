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
  const sb = createClient(supabaseUrl, supabaseKey);

  const userId = process.env.WMS_USER_ID;
  const password = process.env.WMS_PASSWORD;
  if (!userId || !password) {
    return NextResponse.json({ error: "WMS credentials missing" }, { status: 500 });
  }

  // ── Login ───────────────────────────────────────────────────────────────────
  const loginRes = await fetch(`${WMS_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, password, clientId: "wms_web" }),
  });
  if (!loginRes.ok) {
    const err = await loginRes.json().catch(() => ({}));
    return NextResponse.json(
      { error: `Login failed: ${(err as Record<string,unknown>)?.message ?? loginRes.status}` },
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

  // Use America/Los_Angeles for the date label (matches LA business day)
  const capturedAt = new Date().toISOString();
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  }); // YYYY-MM-DD

  let totalInserted = 0;
  const errors: string[] = [];
  const debug: string[] = [];

  // ── 1. Warehouses ───────────────────────────────────────────────────────────
  const whJson = await wmsGet("combo/warehouse", token);
  const rawWarehouses: Record<string, unknown>[] = Array.isArray(whJson?.data)
    ? whJson.data
    : Array.isArray(whJson)
    ? whJson
    : [];

  // WMS returns { code, name } — map code → id to match the rest of the app
  const warehouses = rawWarehouses
    .map((w) => ({
      id: String(w.code ?? w.id ?? w.warehouseId ?? ""),
      name: String(w.name ?? w.warehouseName ?? w.code ?? ""),
    }))
    .filter((w) => w.id);

  debug.push(`Warehouses found: ${warehouses.map((w) => w.id).join(", ")}`);

  // ── 2. Per warehouse ────────────────────────────────────────────────────────
  for (const wh of warehouses) {
    const whCode = wh.id;
    try {
      // Customers for this warehouse
      const custJson = await wmsGet(`combo/customer-by-warehouse/${whCode}`, token);
      const rawCustomers: Record<string, unknown>[] = Array.isArray(custJson?.data)
        ? custJson.data
        : Array.isArray(custJson)
        ? custJson
        : [];

      const customers = rawCustomers
        .map((c) => ({
          code: String(c.code ?? c.customerCode ?? c.id ?? ""),
          name: String(c.name ?? c.customerName ?? c.code ?? ""),
        }))
        .filter((c) => c.code);

      debug.push(`  ${whCode}: ${customers.length} customer(s)`);

      for (const cust of customers) {
        try {
          // ── SKU list — paginate with correct param names ──────────────────
          const skus: string[] = [];
          let page = 1;
          const pageSize = 500;
          while (true) {
            const skuJson = await wmsPost("product/list", token, {
              warehouseCode: whCode,
              customerCode: cust.code,
              pageNum: page,
              pageSize,
            });
            const list: Record<string, unknown>[] = Array.isArray(skuJson?.data?.list)
              ? skuJson.data.list
              : Array.isArray(skuJson?.data)
              ? skuJson.data
              : [];
            const pageSkus = list
              .map((p) => String(p.productSku ?? p.sku ?? p.code ?? ""))
              .filter(Boolean);
            skus.push(...pageSkus);
            if (pageSkus.length < pageSize) break; // last page
            page += 1;
            await delay(300); // be polite between pages
          }

          debug.push(`    ${cust.code}: ${skus.length} SKU(s)`);
          if (skus.length === 0) continue;

          // ── Inventory detail — 5 SKUs at a time, 400 ms between batches ──
          const rows: Record<string, unknown>[] = [];
          const BATCH = 5;

          for (let i = 0; i < skus.length; i += BATCH) {
            const batch = skus.slice(i, i + BATCH);
            const batchResults = await Promise.all(
              batch.map((sku) =>
                wmsPost("inventory/detail", token, {
                  warehouseCode: whCode,
                  customerCode: cust.code,
                  productSku: sku,
                }).catch(() => null)
              )
            );

            for (let j = 0; j < batchResults.length; j++) {
              const invJson = batchResults[j];
              const sku = batch[j];
              const items: Record<string, unknown>[] = Array.isArray(invJson?.data)
                ? invJson.data
                : [];

              for (const item of items) {
                const zone     = String(item.zoneName     ?? item.zone     ?? "");
                const aisle    = String(item.aisleName    ?? item.aisle    ?? "");
                const bay      = String(item.bayName      ?? item.bay      ?? "");
                const level    = String(item.levelName    ?? item.level    ?? "");
                const position = String(item.positionName ?? item.position ?? "");
                const location = [zone, aisle, bay, level, position]
                  .filter(Boolean)
                  .join("-");

                rows.push({
                  captured_date:  today,
                  captured_at:    capturedAt,
                  warehouse_code: whCode,
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

            // Pause between batches (except last)
            if (i + BATCH < skus.length) await delay(400);
          }

          // ── Upsert to Supabase ────────────────────────────────────────────
          if (rows.length > 0) {
            // Delete today's existing rows for this warehouse+customer (idempotent)
            await sb
              .from("inventory_history")
              .delete()
              .eq("captured_date", today)
              .eq("warehouse_code", whCode)
              .eq("customer_code", cust.code);

            for (let i = 0; i < rows.length; i += 500) {
              const chunk = rows.slice(i, i + 500);
              const { error: insertErr } = await sb
                .from("inventory_history")
                .insert(chunk);
              if (insertErr) {
                errors.push(`insert ${whCode}/${cust.code}: ${insertErr.message}`);
              } else {
                totalInserted += chunk.length;
              }
            }
          }

          debug.push(`    ${cust.code}: ${rows.length} rows inserted`);
        } catch (e) {
          errors.push(`${whCode}/${cust.code}: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      errors.push(`${whCode}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({
    ok: true,
    date: today,
    captured_at: capturedAt,
    inserted: totalInserted,
    warehouses: warehouses.length,
    debug,
    errors: errors.length > 0 ? errors : undefined,
  });
}
