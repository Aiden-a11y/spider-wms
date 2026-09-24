import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "";
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function GET(req: NextRequest) {
  const client = sb();
  if (!client) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const sp = new URL(req.url).searchParams;
  const warehouseCode = sp.get("warehouseCode");
  const picker = sp.get("picker");
  const dateFrom = sp.get("dateFrom");
  const dateTo = sp.get("dateTo");

  let q = client
    .from("pick_performance")
    .select("*")
    .order("completed_at", { ascending: false });

  if (warehouseCode) q = q.eq("warehouse_code", warehouseCode);
  if (picker) q = q.eq("picker", picker);
  if (dateFrom) q = q.gte("completed_at", dateFrom);
  if (dateTo) {
    const end = new Date(dateTo);
    end.setDate(end.getDate() + 1);
    q = q.lt("completed_at", end.toISOString());
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ records: data ?? [] });
}
