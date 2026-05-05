/**
 * GET /api/snapshot/status
 * Diagnostic endpoint — checks Supabase inventory_history for recent data.
 * Auth: user's WMS Bearer token (same as /api/snapshot/run)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    return NextResponse.json({ error: "No auth token" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const sb = createClient(supabaseUrl, supabaseKey);

  // 1. Get the most recent 10 distinct captured_dates
  const { data: dateRows, error: dateErr } = await sb
    .from("inventory_history")
    .select("captured_date, captured_at, warehouse_code")
    .order("captured_date", { ascending: false })
    .limit(50);

  if (dateErr) {
    return NextResponse.json({
      ok: false,
      supabase_key_type: process.env.SUPABASE_SERVICE_ROLE_KEY ? "service_role" : "anon",
      error: dateErr.message,
    });
  }

  // Group by captured_date → count rows and warehouses
  const byDate: Record<string, { date: string; captured_at: string; warehouses: string[]; rows: number }> = {};
  for (const r of (dateRows ?? [])) {
    const d = String(r.captured_date);
    if (!byDate[d]) {
      byDate[d] = { date: d, captured_at: String(r.captured_at ?? ""), warehouses: [] as string[], rows: 0 };
    }
    const wh = String(r.warehouse_code);
    if (!byDate[d].warehouses.includes(wh)) byDate[d].warehouses.push(wh);
    byDate[d].rows += 1;
  }

  // Get full row count for each distinct date
  const dates = Object.values(byDate)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);

  // For the most recent date, get actual total count
  let latestCount: number | null = null;
  if (dates.length > 0) {
    const { count } = await sb
      .from("inventory_history")
      .select("*", { count: "exact", head: true })
      .eq("captured_date", dates[0].date);
    latestCount = count;
  }

  return NextResponse.json({
    ok: true,
    supabase_key_type: process.env.SUPABASE_SERVICE_ROLE_KEY ? "service_role" : "anon",
    today_la: new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }),
    latest_snapshot: dates[0]
      ? {
          date: dates[0].date,
          captured_at: dates[0].captured_at,
          total_rows: latestCount,
          warehouses: dates[0].warehouses,
        }
      : null,
    recent_dates: dates.map(d => ({
      date: d.date,
      warehouses: d.warehouses,
      sample_rows: d.rows,
    })),
  });
}
