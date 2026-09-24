import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import redis from "@/lib/redis";
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

export async function POST(_req: NextRequest) {
  const client = sb();
  if (!client) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  // Load all clusters from Redis
  const keys = (await redis.keys("wms:b2ccluster:*")).filter((k) => !k.endsWith(":counter"));
  if (keys.length === 0) return NextResponse.json({ synced: 0, skipped: 0 });

  const values = await Promise.all(keys.map((k) => redis.get(k)));
  const clusters = values
    .map((v) => {
      if (!v) return null;
      return (typeof v === "string" ? JSON.parse(v) : v) as B2CCluster;
    })
    .filter((c): c is B2CCluster => !!c && c.status === "completed" && !!c.completedBy && !!c.completedAt);

  if (clusters.length === 0) return NextResponse.json({ synced: 0, skipped: 0 });

  const rows = clusters.map((cluster) => {
    const durationMin =
      (new Date(cluster.completedAt!).getTime() - new Date(cluster.createdAt).getTime()) / 60000;
    const activeDurationMin = cluster.pickStartedAt
      ? (new Date(cluster.completedAt!).getTime() - new Date(cluster.pickStartedAt).getTime()) / 60000
      : null;
    const itemCount = (cluster.bins ?? []).reduce((s, b) => s + (b.items?.length ?? 0), 0);
    return {
      cluster_id: cluster.id,
      cluster_no: cluster.clusterNo ?? null,
      warehouse_code: cluster.warehouseCode,
      picker: cluster.completedBy!,
      cluster_created_at: cluster.createdAt,
      pick_started_at: cluster.pickStartedAt ?? null,
      completed_at: cluster.completedAt!,
      duration_min: Math.round(durationMin * 100) / 100,
      active_duration_min: activeDurationMin != null ? Math.round(activeDurationMin * 100) / 100 : null,
      bin_count: (cluster.bins ?? []).length,
      location_count: (cluster.locationGroups ?? []).length,
      item_count: itemCount,
    };
  });

  const { error, count } = await client
    .from("pick_performance")
    .upsert(rows, { onConflict: "cluster_id", ignoreDuplicates: true, count: "exact" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Permanent full-detail archive — Redis clusters expire after 7 days (CLUSTER_TTL),
  // so mirror the complete record here too before it's gone.
  const archiveRows = clusters.map((cluster) => ({
    cluster_id: cluster.id,
    cluster_no: cluster.clusterNo ?? null,
    warehouse_code: cluster.warehouseCode,
    created_by: cluster.createdBy ?? null,
    completed_by: cluster.completedBy!,
    created_at: cluster.createdAt,
    completed_at: cluster.completedAt!,
    data: cluster,
  }));
  const { error: archiveError, count: archiveCount } = await client
    .from("cluster_archive")
    .upsert(archiveRows, { onConflict: "cluster_id", count: "exact" });

  return NextResponse.json({
    synced: count ?? rows.length,
    skipped: rows.length - (count ?? rows.length),
    archived: archiveError ? 0 : (archiveCount ?? archiveRows.length),
    archiveError: archiveError?.message ?? null,
  });
}
