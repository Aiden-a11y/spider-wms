import { NextRequest, NextResponse } from "next/server";
import { checkApiAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

function cfg() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { base: `${url}/rest/v1`, key };
}

function hdrs(key: string, prefer?: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

// GET /api/packing-list?order_code=XXX
export async function GET(req: NextRequest) {
  const denied = await checkApiAuth(req);
  if (denied) return denied;
  const c = cfg();
  if (!c) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const orderCode = req.nextUrl.searchParams.get("order_code");
  if (!orderCode) return NextResponse.json({ error: "order_code required" }, { status: 400 });

  const res = await fetch(
    `${c.base}/packing_lists?order_code=eq.${encodeURIComponent(orderCode)}&order=created_at.asc`,
    { headers: hdrs(c.key), cache: "no-store" }
  );
  const data = await res.json();
  if (!res.ok) return NextResponse.json({ error: data?.message ?? "fetch error" }, { status: 500 });
  return NextResponse.json({ rows: Array.isArray(data) ? data : [] });
}

// POST /api/packing-list — insert one or many rows
export async function POST(req: NextRequest) {
  const denied = await checkApiAuth(req);
  if (denied) return denied;
  const c = cfg();
  if (!c) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const body = await req.json();
  const rows = Array.isArray(body) ? body : [body];

  const res = await fetch(`${c.base}/packing_lists`, {
    method: "POST",
    headers: hdrs(c.key, "return=representation"),
    body: JSON.stringify(rows),
  });
  const data = await res.json();
  if (!res.ok) return NextResponse.json({ error: data?.message ?? "insert error" }, { status: 500 });
  return NextResponse.json({ rows: Array.isArray(data) ? data : [data] });
}

// PATCH /api/packing-list?id=XXX — update one row
export async function PATCH(req: NextRequest) {
  const denied = await checkApiAuth(req);
  if (denied) return denied;
  const c = cfg();
  if (!c) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body = await req.json();
  const { total_qty: _drop, ...update } = body; // drop generated column

  const res = await fetch(`${c.base}/packing_lists?id=eq.${id}`, {
    method: "PATCH",
    headers: hdrs(c.key, "return=representation"),
    body: JSON.stringify({ ...update, updated_at: new Date().toISOString() }),
  });
  const data = await res.json();
  if (!res.ok) return NextResponse.json({ error: data?.message ?? "update error" }, { status: 500 });
  return NextResponse.json({ row: Array.isArray(data) ? data[0] : data });
}

// DELETE /api/packing-list?id=XXX
export async function DELETE(req: NextRequest) {
  const denied = await checkApiAuth(req);
  if (denied) return denied;
  const c = cfg();
  if (!c) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const id = req.nextUrl.searchParams.get("id");
  // delete all for order_code if no id
  const orderCode = req.nextUrl.searchParams.get("order_code");
  const filter = id ? `id=eq.${id}` : orderCode ? `order_code=eq.${encodeURIComponent(orderCode)}` : null;
  if (!filter) return NextResponse.json({ error: "id or order_code required" }, { status: 400 });

  const res = await fetch(`${c.base}/packing_lists?${filter}`, {
    method: "DELETE",
    headers: hdrs(c.key),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    return NextResponse.json({ error: e?.message ?? "delete error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
