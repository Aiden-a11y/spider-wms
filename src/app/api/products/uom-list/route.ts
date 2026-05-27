/**
 * POST /api/products/uom-list
 * Fetches UOM rows for a list of SKUs using service-role key (bypasses RLS).
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ data: [] });
  }

  const { skus } = await req.json();
  if (!skus || !Array.isArray(skus) || skus.length === 0) {
    return NextResponse.json({ data: [] });
  }

  const sb = createClient(supabaseUrl, supabaseKey);
  const { data } = await sb.from("product_uom").select("*").in("sku", skus);

  return NextResponse.json({ data: data ?? [] });
}
