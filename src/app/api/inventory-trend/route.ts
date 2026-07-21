/**
 * GET /api/inventory-trend
 * Returns daily inventory aggregates from Supabase inventory_history (last 45 days).
 * Per-warehouse breakdown is included so the client can filter without re-fetching.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type HistRow = {
  captured_date: string;
  qty: number;
  sku: string;
  location: string;
  warehouse_code: string;
  customer_code: string;
};

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ trend: [], warehouses: [], customers: [], occupied_locations: [] });
  }

  const sb = createClient(supabaseUrl, supabaseKey);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 45);
  const cutoffStr = cutoff.toLocaleDateString("en-CA");

  const PAGE = 1000;
  const allRows: HistRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("inventory_history")
      .select("captured_date, qty, sku, location, warehouse_code, customer_code")
      .gte("captured_date", cutoffStr)
      .order("captured_date", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error || !data || data.length === 0) break;
    allRows.push(...(data as HistRow[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  // Aggregate: date → warehouse → { qty, skus, locs }
  const byDateWh: Record<
    string,
    Record<string, { qty: number; skus: Set<string>; locs: Set<string> }>
  > = {};
  const whSet = new Set<string>();
  const custSet = new Set<string>();

  for (const row of allRows) {
    const d = row.captured_date;
    const wh = row.warehouse_code || "—";
    const cu = row.customer_code || "—";
    whSet.add(wh);
    custSet.add(cu);
    if (!byDateWh[d]) byDateWh[d] = {};
    if (!byDateWh[d][wh]) byDateWh[d][wh] = { qty: 0, skus: new Set(), locs: new Set() };
    byDateWh[d][wh].qty += row.qty || 0;
    if (row.sku) byDateWh[d][wh].skus.add(row.sku);
    if (row.location) byDateWh[d][wh].locs.add(row.location);
  }

  const trend = Object.entries(byDateWh)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, whMap]) => {
      let totalQty = 0;
      const totalSkus = new Set<string>();
      const totalLocs = new Set<string>();
      const by_warehouse: Record<
        string,
        { total_qty: number; sku_count: number; location_count: number }
      > = {};
      for (const [wh, { qty, skus, locs }] of Object.entries(whMap)) {
        totalQty += qty;
        skus.forEach((s) => totalSkus.add(s));
        locs.forEach((l) => totalLocs.add(l));
        by_warehouse[wh] = {
          total_qty: qty,
          sku_count: skus.size,
          location_count: locs.size,
        };
      }
      return {
        date,
        total_qty: totalQty,
        sku_count: totalSkus.size,
        location_count: totalLocs.size,
        by_warehouse,
      };
    });

  // Occupied locations from the most recent snapshot (all warehouses)
  const latestDate = trend.length > 0 ? trend[trend.length - 1].date : null;
  const latestWhMap = latestDate ? byDateWh[latestDate] : null;
  const occSet = new Set<string>();
  if (latestWhMap) {
    for (const { locs } of Object.values(latestWhMap)) {
      locs.forEach((l) => occSet.add(l));
    }
  }

  return NextResponse.json({
    trend,
    warehouses: Array.from(whSet).sort(),
    customers: Array.from(custSet).sort(),
    occupied_locations: Array.from(occSet),
  });
}
