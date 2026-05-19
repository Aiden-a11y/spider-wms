/**
 * GET /api/inventory-conflicts?warehouseCode=STOO1
 * Reads the latest inventory_history snapshot from Supabase and returns
 * locations that contain items from 2+ distinct customers.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const warehouseCode = req.nextUrl.searchParams.get("warehouseCode");
  if (!warehouseCode) {
    return NextResponse.json({ error: "warehouseCode is required" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const sb = createClient(supabaseUrl, supabaseKey);

  // Find the most recent captured_date for this warehouse
  const { data: latestRow, error: dateErr } = await sb
    .from("inventory_history")
    .select("captured_date")
    .eq("warehouse_code", warehouseCode)
    .order("captured_date", { ascending: false })
    .limit(1)
    .single();

  if (dateErr || !latestRow) {
    return NextResponse.json({ error: "No snapshot data found. Run 'Save Now' in History page first." }, { status: 404 });
  }

  const latestDate = latestRow.captured_date as string;

  // Fetch all rows for that date + warehouse (paginate to avoid 1000-row limit)
  type HistoryRow = {
    location: string;
    customer_code: string;
    sku: string;
    product_name: string | null;
    lot: string | null;
    expire_date: string | null;
    qty: number;
    available_qty: number | null;
  };

  const allRows: HistoryRow[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("inventory_history")
      .select("location,customer_code,sku,product_name,lot,expire_date,qty,available_qty")
      .eq("warehouse_code", warehouseCode)
      .eq("captured_date", latestDate)
      .range(from, from + PAGE - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    allRows.push(...(data as HistoryRow[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  if (allRows.length === 0) {
    return NextResponse.json({ error: "No inventory rows in latest snapshot.", snapshotDate: latestDate }, { status: 404 });
  }

  // Group by location
  type GroupMap = Map<string, { customers: Set<string>; items: HistoryRow[] }>;
  const locMap: GroupMap = new Map();
  for (const row of allRows) {
    if (!row.location) continue;
    const entry = locMap.get(row.location) ?? { customers: new Set(), items: [] };
    entry.customers.add(row.customer_code);
    entry.items.push(row);
    locMap.set(row.location, entry);
  }

  // Keep only locations with 2+ distinct customers
  const conflicts = Array.from(locMap.entries())
    .filter(([, v]) => v.customers.size >= 2)
    .map(([location, v]) => ({
      location,
      customers: Array.from(v.customers),
      itemCount: v.items.length,
      totalQty: v.items.reduce((s, r) => s + (r.qty ?? 0), 0),
      items: v.items,
    }))
    .sort((a, b) => b.customers.length - a.customers.length || a.location.localeCompare(b.location));

  return NextResponse.json({
    warehouseCode,
    snapshotDate: latestDate,
    totalRows: allRows.length,
    conflicts,
  });
}
