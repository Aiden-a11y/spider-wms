/**
 * GET /api/products
 *
 * Reads product_master + product_uom + product_sync_log
 * using service-role key (bypasses RLS).
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const sb = createClient(supabaseUrl, supabaseKey);

  const [prodRes, logRes] = await Promise.all([
    sb.from("product_master").select("*").order("sku"),
    sb.from("product_sync_log").select("synced_at,total_count,elapsed_sec").eq("id", 1).maybeSingle(),
  ]);

  if (prodRes.error) {
    return NextResponse.json({ error: prodRes.error.message }, { status: 500 });
  }

  const products = prodRes.data ?? [];

  // Load UOM for all SKUs
  let uom: unknown[] = [];
  if (products.length > 0) {
    const skuSet: Record<string, boolean> = {};
    products.forEach((p: Record<string, unknown>) => { if (p.sku) skuSet[String(p.sku)] = true; });
    const skus = Object.keys(skuSet);
    const uomRes = await sb.from("product_uom").select("*").in("sku", skus);
    uom = uomRes.data ?? [];
  }

  return NextResponse.json({
    products,
    uom,
    syncInfo: logRes.data ?? null,
  });
}
