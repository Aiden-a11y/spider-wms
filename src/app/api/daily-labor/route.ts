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

/* GET /api/daily-labor?date=2026-07-23 */
export async function GET(req: NextRequest) {
  const client = sb();
  if (!client) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const date = new URL(req.url).searchParams.get("date") ?? new Date().toISOString().slice(0, 10);

  const [{ data: workers, error: e1 }, { data: rev, error: e2 }] = await Promise.all([
    client.from("daily_labor").select("*").eq("work_date", date).order("created_at"),
    client.from("daily_revenue").select("*").eq("work_date", date).maybeSingle(),
  ]);

  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  return NextResponse.json({ workers: workers ?? [], revenue: rev ?? null });
}

/* POST /api/daily-labor  — upsert a worker row */
export async function POST(req: NextRequest) {
  const client = sb();
  if (!client) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const body = await req.json();

  if (body.type === "revenue") {
    /* upsert daily revenue */
    const { error } = await client.from("daily_revenue").upsert({
      work_date: body.work_date,
      revenue: body.revenue,
      notes: body.notes ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "work_date" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  /* upsert worker */
  const payload = {
    work_date: body.work_date,
    worker_name: body.worker_name,
    hours_worked: body.hours_worked,
    hourly_rate: body.hourly_rate,
    notes: body.notes ?? null,
  };

  if (body.id) {
    const { error } = await client.from("daily_labor").update(payload).eq("id", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await client.from("daily_labor").insert(payload);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/* DELETE /api/daily-labor?id=uuid */
export async function DELETE(req: NextRequest) {
  const client = sb();
  if (!client) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { error } = await client.from("daily_labor").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
