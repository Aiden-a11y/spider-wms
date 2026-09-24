/**
 * GET /api/inventory-history?date=2026-05-15&warehouseCode=STOO1
 *
 * Reads inventory_history using service-role key (bypasses RLS).
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const date          = searchParams.get("date");
  const warehouseCode = searchParams.get("warehouseCode");

  if (!date || !warehouseCode) {
    return NextResponse.json({ error: "date and warehouseCode are required" }, { status: 400 });
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

  // Paginate to avoid 1000-row limit
  const PAGE = 1000;
  const allRows: Record<string, unknown>[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await sb
      .from("inventory_history")
      .select("*")
      .eq("captured_date", date)
      .eq("warehouse_code", warehouseCode)
      .order("location", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  // Debug: what's the most recent row on file for this warehouse, regardless of date?
  const { data: latestRows } = await sb
    .from("inventory_history")
    .select("id, captured_date, captured_at, warehouse_code")
    .eq("warehouse_code", warehouseCode)
    .order("id", { ascending: false })
    .limit(3);

  // Debug: identical two-filter query via raw PostgREST, bypassing the supabase-js client,
  // to isolate whether the client chain or the data itself is the problem.
  let rawRestCount: number | string = "n/a";
  try {
    const rawUrl = `${supabaseUrl}/rest/v1/inventory_history?warehouse_code=eq.${encodeURIComponent(warehouseCode)}&captured_date=eq.${encodeURIComponent(date)}&select=id&limit=5`;
    const rawRes = await fetch(rawUrl, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
    const rawJson = await rawRes.json();
    rawRestCount = Array.isArray(rawJson) ? rawJson.length : JSON.stringify(rawJson).slice(0, 200);
  } catch (e) {
    rawRestCount = `error: ${(e as Error).message}`;
  }

  const supabaseHost = (() => { try { return new URL(supabaseUrl).host; } catch { return null; } })();
  return NextResponse.json({ date, warehouseCode, rows: allRows.length, data: allRows, supabaseHost, latestRows, rawRestCount });
}
