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

/* GET /api/daily-labor?date=2026-07-23
   GET /api/daily-labor?from=2026-07-01&to=2026-07-31   (trend range — no per-worker detail) */
export async function GET(req: NextRequest) {
  const client = sb();
  if (!client) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const sp = new URL(req.url).searchParams;
  const from = sp.get("from");
  const to   = sp.get("to");

  if (from && to) {
    const [{ data: workers, error: e1 }, { data: revs, error: e2 }] = await Promise.all([
      client.from("daily_labor").select("work_date,hours_worked,hourly_rate,bill_total").gte("work_date", from).lte("work_date", to),
      client.from("daily_revenue").select("*").gte("work_date", from).lte("work_date", to).order("work_date"),
    ]);
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

    const laborByDate: Record<string, number> = {};
    for (const w of workers ?? []) {
      const cost = w.bill_total != null ? Number(w.bill_total) : Number(w.hours_worked) * Number(w.hourly_rate);
      laborByDate[w.work_date] = (laborByDate[w.work_date] ?? 0) + cost;
    }

    return NextResponse.json({ revenues: revs ?? [], laborByDate });
  }

  const date = sp.get("date") ?? new Date().toISOString().slice(0, 10);

  const [{ data: workers, error: e1 }, { data: rev, error: e2 }] = await Promise.all([
    client.from("daily_labor").select("*").eq("work_date", date).order("created_at"),
    client.from("daily_revenue").select("*").eq("work_date", date).maybeSingle(),
  ]);

  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  return NextResponse.json({ workers: workers ?? [], revenue: rev ?? null });
}

/* POST /api/daily-labor  — upsert a worker row, upsert revenue, or bulk-replace from a timecard upload */
export async function POST(req: NextRequest) {
  const client = sb();
  if (!client) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const body = await req.json();

  if (body.type === "revenue") {
    const { error } = await client.from("daily_revenue").upsert({
      work_date: body.work_date,
      revenue: body.revenue,
      notes: body.notes ?? null,
      breakdown: body.breakdown ?? null,
      source: body.source ?? "manual",
      warehouse_code: body.warehouse_code ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "work_date" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.type === "timecard_bulk") {
    const workDate = body.work_date;
    const rows: Record<string, unknown>[] = Array.isArray(body.workers) ? body.workers : [];
    if (!workDate) return NextResponse.json({ error: "work_date required" }, { status: 400 });

    const { error: delErr } = await client.from("daily_labor").delete().eq("work_date", workDate);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    if (rows.length > 0) {
      const payload = rows.map((w) => ({
        work_date:     workDate,
        worker_name:   String(w.worker_name ?? ""),
        hours_worked:  Number(w.total_hours ?? 0),
        hourly_rate:   Number(w.pay_rate ?? 0),
        notes:         w.notes ?? null,
        worker_type:   w.worker_type ?? null,
        agency:        w.agency ?? null,
        dept:          w.dept ?? null,
        reg_hours:     w.reg_hours != null ? Number(w.reg_hours) : null,
        ot1_hours:     w.ot1_hours != null ? Number(w.ot1_hours) : null,
        ot2_hours:     w.ot2_hours != null ? Number(w.ot2_hours) : null,
        markup_pct:    w.markup_pct != null ? Number(w.markup_pct) : null,
        markup_amt:    w.markup_amt != null ? Number(w.markup_amt) : null,
        bill_total:    w.bill_total != null ? Number(w.bill_total) : null,
      }));
      const { error: insErr } = await client.from("daily_labor").insert(payload);
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, count: rows.length });
  }

  /* upsert single worker (manual add/edit) */
  const payload = {
    work_date:     body.work_date,
    worker_name:   body.worker_name,
    hours_worked:  body.hours_worked,
    hourly_rate:   body.hourly_rate,
    notes:         body.notes ?? null,
    worker_type:   body.worker_type ?? null,
    agency:        body.agency ?? null,
    dept:          body.dept ?? null,
    bill_total:    body.bill_total ?? null,
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
