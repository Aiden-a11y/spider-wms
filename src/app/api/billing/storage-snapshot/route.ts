/**
 * GET /api/billing/storage-snapshot
 *   ?warehouseCode=STOO1&customerCode=FCOKR&date=2026-05-15
 *
 * Uses service-role key so RLS does not block reads.
 * Returns { rows: number, locations: string[] }
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const warehouseCode = searchParams.get("warehouseCode");
  const customerCode  = searchParams.get("customerCode");
  const date          = searchParams.get("date");

  if (!warehouseCode || !customerCode || !date) {
    return NextResponse.json({ error: "warehouseCode, customerCode, date are required" }, { status: 400 });
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

  const { data, error } = await sb
    .from("inventory_history")
    .select("location")
    .eq("captured_date", date)
    .eq("warehouse_code", warehouseCode)
    .eq("customer_code", customerCode);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const locations = (data ?? []).map((r: Record<string, unknown>) => String(r.location ?? "")).filter(Boolean);

  return NextResponse.json({ date, rows: locations.length, locations });
}
