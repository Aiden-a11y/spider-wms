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
  const status = sp.get("status");
  const dateFrom = sp.get("dateFrom");
  const dateTo = sp.get("dateTo");
  const limit = Math.min(parseInt(sp.get("limit") ?? "500"), 2000);
  const offset = parseInt(sp.get("offset") ?? "0");

  let q = client
    .from("cycle_count")
    .select("*")
    .order("counted_at", { ascending: false });

  if (warehouseCode) q = q.eq("warehouse_code", warehouseCode);
  if (status && status !== "ALL") q = q.eq("status", status);
  if (dateFrom) q = q.gte("counted_at", dateFrom);
  if (dateTo) {
    const end = new Date(dateTo);
    end.setDate(end.getDate() + 1);
    q = q.lt("counted_at", end.toISOString());
  }
  q = q.range(offset, offset + limit - 1);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ records: data ?? [] });
}

export async function PATCH(req: NextRequest) {
  const client = sb();
  if (!client) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const body = (await req.json()) as { adjusted_by?: string; action?: string };

  const update =
    body.action === "keep"
      ? { status: "OK", adjusted_by: body.adjusted_by ?? "manager", adjusted_at: new Date().toISOString() }
      : { adjusted: true, adjusted_by: body.adjusted_by ?? "manager", adjusted_at: new Date().toISOString() };

  const { error } = await client.from("cycle_count").update(update).eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
