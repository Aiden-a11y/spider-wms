/**
 * GET /api/billing/storage-snapshot
 *   ?warehouseCode=STOO1&customerCode=FCOKR&date=2026-05-15
 *
 * Returns all inventory_history rows for the given date/warehouse/customer.
 * Uses service-role key so RLS does not block reads.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export type InventoryHistoryRow = {
  location:      string;
  sku:           string;
  product_name:  string | null;
  qty:           number;
  available_qty: number | null;
  lot:           string | null;
  expire_date:   string | null;
  customer_code: string;
  warehouse_code: string;
  captured_date: string;
};

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
    .select("location, sku, product_name, qty, available_qty, lot, expire_date, customer_code, warehouse_code, captured_date")
    .eq("captured_date", date)
    .eq("warehouse_code", warehouseCode)
    .eq("customer_code", customerCode)
    .order("location", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as InventoryHistoryRow[];

  return NextResponse.json({
    date,
    rows: rows.length,
    // Legacy field — just location strings (still used by billing-calc side)
    locations: rows.map(r => r.location).filter(Boolean),
    // Full raw rows
    rawRows: rows,
  });
}
