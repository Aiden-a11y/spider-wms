import { NextRequest, NextResponse } from "next/server";
import redis from "@/lib/redis";
import type { B2CCluster } from "@/lib/b2c-cluster";

export const dynamic = "force-dynamic";

const CLUSTER_TTL = 7 * 24 * 60 * 60; // 7 days — same as wms-mobile's close route

/**
 * POST /api/cluster/complete?id=<clusterId>
 * Marks a cluster completed WITHOUT touching WMS order status (AA→CA).
 * For AMR-picked clusters: the CA transition already happened at "Send to Robot"
 * time (via /api/cluster/force-ca), so completing here is purely a record-keeping
 * step — mark it done in Redis and archive it, nothing more.
 */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const body = await req.json().catch(() => ({})) as { completedBy?: string };

  const raw = await redis.get(`wms:b2ccluster:${id}`);
  if (!raw) return NextResponse.json({ error: "not found" }, { status: 404 });
  const cluster = (typeof raw === "string" ? JSON.parse(raw) : raw) as B2CCluster;

  if (cluster.status === "completed") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const updated: B2CCluster = {
    ...cluster,
    status: "completed",
    completedAt: new Date().toISOString(),
    ...(body.completedBy ? { completedBy: body.completedBy } : {}),
  };
  await redis.set(`wms:b2ccluster:${id}`, updated, { ex: CLUSTER_TTL });

  // Non-blocking: record pick performance + permanent archive in Supabase
  if (updated.completedAt && updated.completedBy) {
    (async () => {
      try {
        const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
        const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
        if (!sbUrl || !sbKey) return;
        const { createClient } = await import("@supabase/supabase-js");
        const sb = createClient(sbUrl, sbKey);
        const durationMin = (new Date(updated.completedAt!).getTime() - new Date(updated.createdAt).getTime()) / 60000;
        const activeDurationMin = updated.pickStartedAt
          ? (new Date(updated.completedAt!).getTime() - new Date(updated.pickStartedAt).getTime()) / 60000
          : null;
        const itemCount = (updated.bins ?? []).reduce((s: number, b) => s + (b.items?.length ?? 0), 0);
        await sb.from("pick_performance").upsert({
          cluster_id: updated.id,
          cluster_no: updated.clusterNo ?? null,
          warehouse_code: updated.warehouseCode,
          picker: updated.completedBy!,
          cluster_created_at: updated.createdAt,
          pick_started_at: updated.pickStartedAt ?? null,
          completed_at: updated.completedAt!,
          duration_min: Math.round(durationMin * 100) / 100,
          active_duration_min: activeDurationMin != null ? Math.round(activeDurationMin * 100) / 100 : null,
          bin_count: (updated.bins ?? []).length,
          location_count: (updated.locationGroups ?? []).length,
          item_count: itemCount,
        }, { onConflict: "cluster_id", ignoreDuplicates: true });

        await sb.from("cluster_archive").upsert({
          cluster_id: updated.id,
          cluster_no: updated.clusterNo ?? null,
          warehouse_code: updated.warehouseCode,
          created_by: updated.createdBy ?? null,
          completed_by: updated.completedBy!,
          created_at: updated.createdAt,
          completed_at: updated.completedAt!,
          data: updated,
        }, { onConflict: "cluster_id" });
      } catch (e) {
        console.warn("[cluster/complete] pick_performance/cluster_archive write failed:", e);
      }
    })();
  }

  return NextResponse.json({ ok: true });
}
