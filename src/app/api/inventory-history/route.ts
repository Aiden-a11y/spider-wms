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

  return NextResponse.json({ date, warehouseCode, rows: allRows.length, data: allRows });
}
