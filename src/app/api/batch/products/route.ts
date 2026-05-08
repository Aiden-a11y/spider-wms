/**
 * /api/batch/products
 *
 * GET  — Vercel Cron trigger (Authorization: Bearer <CRON_SECRET>)
 *       or manual test: ?secret=<CRON_SECRET>
 * POST — Manual trigger from dashboard (no secret required — internal call)
 *
 * Fetches all products from WMS and upserts into Supabase product_master.
 * Human-like delays between requests to avoid rate limiting.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient }              from "@supabase/supabase-js";

export const maxDuration = 300; // 5 min — Vercel Pro allows 300s

const WMS_BASE  = "https://us-wms-api.stload.com/api";
const PAGE_SIZE = 50; // small pages = human-like pacing

/* ── helpers ── */
const sleep = (min: number, max: number) =>
  new Promise<void>((r) => setTimeout(r, min + Math.random() * (max - min)));

function parseArr(json: unknown): Record<string, unknown>[] {
  const j = json as Record<string, unknown>;
  return Array.isArray(j?.data)
    ? (j.data as Record<string, unknown>[])
    : Array.isArray(json)
    ? (json as Record<string, unknown>[])
    : [];
}

async function wmsGet(path: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${WMS_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

/* ── main handler ── */
async function runBatch(log: string[]): Promise<{
  total: number;
  elapsedSec: number;
}> {
  const t0 = Date.now();

  // Supabase
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const sbKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "";
  if (!sbUrl || !sbKey) throw new Error("Supabase env vars missing");
  const sb = createClient(sbUrl, sbKey);

  // WMS credentials
  const userId   = process.env.WMS_USER_ID   ?? "";
  const password = process.env.WMS_PASSWORD  ?? "";
  if (!userId || !password) throw new Error("WMS_USER_ID / WMS_PASSWORD not set");

  // ── 1. Login ──────────────────────────────────────────────────────────────
  log.push("→ Logging in to WMS…");
  const loginRes = await fetch(`${WMS_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, password, clientId: "wms_web" }),
  });
  const loginJson = await loginRes.json();
  const token: string =
    loginJson?.data?.token ??
    loginJson?.data?.accessToken ??
    loginJson?.token ??
    loginJson?.accessToken ??
    "";
  if (!token) throw new Error(`Login failed: ${JSON.stringify(loginJson)}`);
  log.push("✓ Login OK");

  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  await sleep(600, 1200);

  // ── 2. Warehouses ─────────────────────────────────────────────────────────
  const whJson   = await wmsGet("combo/warehouse", token);
  const warehouses = parseArr(whJson)
    .map((w) => ({
      id:   String(w.code   ?? w.id   ?? ""),
      name: String(w.name   ?? w.code ?? ""),
    }))
    .filter((w) => w.id);
  log.push(`✓ Warehouses: ${warehouses.map((w) => w.id).join(", ")}`);
  await sleep(400, 800);

  // ── 3. Customers (merge from multiple endpoints) ──────────────────────────
  const custMap: Record<string, { code: string; name: string }> = {};
  const custEndpoints: string[] = [];
  for (const wh of warehouses) {
    custEndpoints.push(
      `combo/customer-by-warehouse/${wh.id}`,
      `combo/customer-by-ordertype/B2B?warehouseCode=${wh.id}`,
      `combo/customer-by-ordertype/B2C?warehouseCode=${wh.id}`,
    );
  }
  custEndpoints.push("combo/customer");

  for (const ep of custEndpoints) {
    try {
      const json = await wmsGet(ep, token);
      parseArr(json).forEach((c) => {
        const code = String(c.code ?? c.customerCode ?? "");
        const name = String(c.name ?? c.customerName ?? code ?? "");
        if (code && !custMap[code]) custMap[code] = { code, name };
      });
      await sleep(200, 500);
    } catch { /* ignore individual endpoint failures */ }
  }

  const customers = Object.values(custMap);
  log.push(`✓ Customers: ${customers.map((c) => c.code).join(", ")}`);

  if (customers.length === 0) throw new Error("No customers found");

  // ── 4. Fetch products per customer ────────────────────────────────────────
  let totalSynced = 0;

  for (const cust of customers) {
    await sleep(800, 1600); // human pause between customers

    let page       = 1;
    let custCount  = 0;

    while (true) {
      await sleep(300, 900); // human pause between pages

      const body = {
        warehouseCode: warehouses[0]?.id ?? "",
        customerCode:  cust.code,
        page,    pageNum:  page,
        size:    PAGE_SIZE, pageSize: PAGE_SIZE, limit: PAGE_SIZE,
      };

      const res  = await fetch(`${WMS_BASE}/product/list`, {
        method: "POST", headers: h, body: JSON.stringify(body),
      });
      const json = await res.json() as Record<string, unknown>;
      const data = (json?.data as Record<string, unknown>) ?? {};

      const items: Record<string, unknown>[] =
        Array.isArray(data?.list)  ? (data.list  as Record<string, unknown>[]) :
        Array.isArray(data?.items) ? (data.items as Record<string, unknown>[]) :
        Array.isArray(json?.data)  ? (json.data  as Record<string, unknown>[]) :
        Array.isArray(json?.list)  ? (json.list  as Record<string, unknown>[]) :
        [];

      if (items.length === 0) break;

      // Build rows for upsert
      const rows = items
        .map((p) => ({
          sku:                String(p.productSku ?? p.sku ?? ""),
          customer_code:      cust.code,
          customer_name:      cust.name,
          product_name:       String(p.productName       ?? ""),
          product_short_name: String(p.productShortName  ?? ""),
          barcode:            String(p.barcode   ?? p.upcCode ?? ""),
          category_first:     String(p.categoryFirst  ?? p.category ?? ""),
          category_second:    String(p.categorySecond ?? ""),
          unit_type:          String(p.unitType ?? p.uom ?? ""),
          weight:             Number(p.weight   ?? p.itemWeight ?? 0) || null,
          status:             String(p.status   ?? p.itemStatus ?? "Active"),
          item_store_comment: String(p.itemStoreComment ?? ""),
          description:        String(p.description ?? ""),
          raw:                p,
          synced_at:          new Date().toISOString(),
        }))
        .filter((r) => r.sku);

      if (rows.length > 0) {
        const { error } = await sb
          .from("product_master")
          .upsert(rows, { onConflict: "sku,customer_code" });
        if (error) log.push(`  ⚠ upsert error (${cust.code} p${page}): ${error.message}`);
      }

      custCount  += items.length;
      totalSynced += items.length;

      // Stop when last page
      const apiTotal = Number(data?.total ?? data?.totalCount ?? data?.totalElements ?? 0);
      if (items.length < PAGE_SIZE || (apiTotal > 0 && custCount >= apiTotal)) break;
      page++;
      if (page > 100) break; // safety cap
    }

    log.push(`  ✓ ${cust.code}: ${custCount} products`);
  }

  const elapsedSec = parseFloat(((Date.now() - t0) / 1000).toFixed(1));
  log.push(`✓ Done — ${totalSynced} total products, ${elapsedSec}s`);

  // ── 5. Write sync log ─────────────────────────────────────────────────────
  await sb.from("product_sync_log").upsert({
    id:          1,
    synced_at:   new Date().toISOString(),
    total_count: totalSynced,
    elapsed_sec: elapsedSec,
    log:         log.join("\n"),
  });

  return { total: totalSynced, elapsedSec };
}

/* ── GET: Vercel Cron ── */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer     = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const secret     =
    bearer ||
    req.headers.get("x-cron-secret") ||
    req.nextUrl.searchParams.get("secret");

  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const log: string[] = [`[Cron] ${new Date().toISOString()}`];
  try {
    const { total, elapsedSec } = await runBatch(log);
    return NextResponse.json({ ok: true, total, elapsedSec, log });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    log.push(`✗ ${msg}`);
    return NextResponse.json({ ok: false, error: msg, log }, { status: 500 });
  }
}

/* ── POST: Manual trigger from dashboard ── */
export async function POST() {
  const log: string[] = [`[Manual] ${new Date().toISOString()}`];
  try {
    const { total, elapsedSec } = await runBatch(log);
    return NextResponse.json({ ok: true, total, elapsedSec, log });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    log.push(`✗ ${msg}`);
    return NextResponse.json({ ok: false, error: msg, log }, { status: 500 });
  }
}
