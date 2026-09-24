import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { B2CCluster } from "@/lib/b2c-cluster";

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

/* GET /api/cluster-archive/analytics?warehouseCode=STOO1&from=2026-08-01&to=2026-08-20 */
export async function GET(req: NextRequest) {
  const client = sb();
  if (!client) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const sp = new URL(req.url).searchParams;
  const warehouseCode = sp.get("warehouseCode");
  const from = sp.get("from");
  const to = sp.get("to");

  let q = client.from("cluster_archive").select("cluster_no, completed_at, data").order("completed_at", { ascending: true });
  if (warehouseCode) q = q.eq("warehouse_code", warehouseCode);
  if (from) q = q.gte("completed_at", from);
  if (to) {
    const end = new Date(to);
    end.setDate(end.getDate() + 1);
    q = q.lt("completed_at", end.toISOString());
  }

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byLocation = new Map<string, { locationCode: string; totalQty: number; pickCount: number; skus: Set<string> }>();
  const bySku = new Map<string, { sku: string; name: string; totalQty: number; pickCount: number; locations: Set<string> }>();
  const byDate = new Map<string, { date: string; totalQty: number; totalPicks: number; clusters: Set<string> }>();

  let totalClusters = 0;
  let totalPicks = 0;
  let totalQty = 0;

  for (const row of rows ?? []) {
    const cluster = row.data as B2CCluster;
    if (!cluster?.bins) continue;
    totalClusters++;
    const date = String(row.completed_at ?? "").slice(0, 10);

    for (const bin of cluster.bins) {
      for (const item of bin.items ?? []) {
        const sku = item.sku ?? "";
        const loc = item.locationCode ?? "";
        const qty = Number(item.qty ?? 0);
        if (!sku && !loc) continue;

        totalPicks++;
        totalQty += qty;

        if (loc) {
          if (!byLocation.has(loc)) byLocation.set(loc, { locationCode: loc, totalQty: 0, pickCount: 0, skus: new Set() });
          const l = byLocation.get(loc)!;
          l.totalQty += qty;
          l.pickCount += 1;
          if (sku) l.skus.add(sku);
        }

        if (sku) {
          if (!bySku.has(sku)) bySku.set(sku, { sku, name: item.name ?? "", totalQty: 0, pickCount: 0, locations: new Set() });
          const s = bySku.get(sku)!;
          s.totalQty += qty;
          s.pickCount += 1;
          if (loc) s.locations.add(loc);
        }

        if (date) {
          if (!byDate.has(date)) byDate.set(date, { date, totalQty: 0, totalPicks: 0, clusters: new Set() });
          const d = byDate.get(date)!;
          d.totalQty += qty;
          d.totalPicks += 1;
          d.clusters.add(cluster.id);
        }
      }
    }
  }

  const locationRows = Array.from(byLocation.values())
    .map((l) => ({ locationCode: l.locationCode, totalQty: l.totalQty, pickCount: l.pickCount, skuCount: l.skus.size }))
    .sort((a, b) => b.totalQty - a.totalQty);

  const skuRows = Array.from(bySku.values())
    .map((s) => ({ sku: s.sku, name: s.name, totalQty: s.totalQty, pickCount: s.pickCount, locationCount: s.locations.size }))
    .sort((a, b) => b.totalQty - a.totalQty);

  const dateRows = Array.from(byDate.values())
    .map((d) => ({ date: d.date, totalQty: d.totalQty, totalPicks: d.totalPicks, clusterCount: d.clusters.size }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({
    totalClusters,
    totalPicks,
    totalQty,
    byLocation: locationRows,
    bySku: skuRows,
    byDate: dateRows,
  });
}
