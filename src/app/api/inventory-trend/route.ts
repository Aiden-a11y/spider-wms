/**
 * GET /api/inventory-trend
 * Returns daily inventory aggregates from Supabase inventory_history (last 45 days).
 * Also returns the most-recent snapshot's occupied location set for dashboard occupancy.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type HistRow = { captured_date: string; qty: number; sku: string; location: string };

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ trend: [], occupied_locations: [] });
  }

  const sb = createClient(supabaseUrl, supabaseKey);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 45);
  const cutoffStr = cutoff.toLocaleDateString("en-CA");

  // Paginate all rows from last 45 days
  const PAGE = 1000;
  const allRows: HistRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("inventory_history")
      .select("captured_date, qty, sku, location")
      .gte("captured_date", cutoffStr)
      .order("captured_date", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error || !data || data.length === 0) break;
    allRows.push(...(data as HistRow[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  // Aggregate by date
  const byDate: Record<string, { qty: number; skus: Set<string>; locs: Set<string> }> = {};
  for (const row of allRows) {
    if (!byDate[row.captured_date]) {
      byDate[row.captured_date] = { qty: 0, skus: new Set(), locs: new Set() };
    }
    byDate[row.captured_date].qty += row.qty || 0;
    if (row.sku) byDate[row.captured_date].skus.add(row.sku);
    if (row.location) byDate[row.captured_date].locs.add(row.location);
  }

  const trend = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { qty, skus, locs }]) => ({
      date,
      total_qty: qty,
      sku_count: skus.size,
      location_count: locs.size,
    }));

  // Most recent snapshot's occupied locations (for dashboard occupancy widget)
  const latestEntry = trend.length > 0 ? byDate[trend[trend.length - 1].date] : null;
  const occupied_locations: string[] = latestEntry ? Array.from(latestEntry.locs) : [];

  return NextResponse.json({ trend, occupied_locations });
}
