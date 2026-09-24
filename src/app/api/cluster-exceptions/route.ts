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
  const resolved = sp.get("resolved"); // "true" | "false" | null
  const clusterId = sp.get("clusterId");

  let q = client
    .from("cluster_exceptions")
    .select("*")
    .order("reported_at", { ascending: false })
    .limit(500);

  if (warehouseCode) q = q.eq("warehouse_code", warehouseCode);
  if (clusterId) q = q.eq("cluster_id", clusterId);
  if (resolved === "true") q = q.eq("resolved", true);
  if (resolved === "false") q = q.eq("resolved", false);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ exceptions: data ?? [] });
}

export async function PATCH(req: NextRequest) {
  const client = sb();
  if (!client) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const sp = new URL(req.url).searchParams;
  const id = sp.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const updates: Record<string, unknown> = {};

  if ("notes" in body) updates.notes = body.notes ?? null;
  if ("resolved" in body) {
    updates.resolved = Boolean(body.resolved);
    if (body.resolved) {
      updates.resolved_by = body.resolvedBy ?? null;
      updates.resolved_at = new Date().toISOString();
    } else {
      updates.resolved_by = null;
      updates.resolved_at = null;
    }
  }

  const { data, error } = await client
    .from("cluster_exceptions")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, exception: data });
}
