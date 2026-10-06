import { NextResponse } from "next/server";
import redis from "@/lib/redis";
import type { B2CCluster } from "@/lib/b2c-cluster";

const CLUSTER_TTL = 7 * 24 * 60 * 60; // 7 days

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (id) {
    const raw = await redis.get(`wms:b2ccluster:${id}`);
    if (!raw) return NextResponse.json(null, { status: 404 });
    const cluster = typeof raw === "string" ? JSON.parse(raw) : raw;
    return NextResponse.json(cluster);
  }

  const keys = (await redis.keys("wms:b2ccluster:*")).filter(
    (k) => !k.endsWith(":counter") && !k.includes(":order:")
  );
  if (keys.length === 0) return NextResponse.json([]);
  const values = await Promise.all(keys.map((k) => redis.get(k)));
  const clusters = (values
    .map((v) => {
      if (!v) return null;
      return (typeof v === "string" ? JSON.parse(v) : v) as B2CCluster;
    })
    .filter(Boolean) as B2CCluster[])
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // One-time migration: assign clusterNo to clusters that don't have one yet,
  // ordered by createdAt ascending so oldest cluster gets the lowest number.
  const needsNumber = clusters.filter((c) => c.clusterNo == null);
  if (needsNumber.length > 0) {
    const maxExisting = clusters.reduce((m, c) => Math.max(m, c.clusterNo ?? 0), 0);
    let next = maxExisting + 1;
    await Promise.all(
      needsNumber.map(async (c) => {
        const no = next++;
        const updated: B2CCluster = { ...c, clusterNo: no };
        await redis.set(`wms:b2ccluster:${c.id}`, updated, { ex: CLUSTER_TTL });
        c.clusterNo = no;
      })
    );
    // Ensure counter is at least as high as the highest assigned number
    const counter = Number(await redis.get("wms:b2ccluster:counter") ?? 0);
    if (counter < next - 1) await redis.set("wms:b2ccluster:counter", next - 1);
  }

  // Return newest-first
  clusters.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return NextResponse.json(clusters);
}

export async function POST(req: Request) {
  const body = (await req.json()) as B2CCluster;

  // Claim every orderCode atomically — prevents the same order appearing in
  // two clusters when multiple computers create clusters simultaneously.
  const orderCodes = [...new Set(
    (body.bins ?? []).map((b) => b.orderCode).filter(Boolean)
  )];

  const claimedKeys: string[] = [];
  const conflicts: string[] = [];

  for (const code of orderCodes) {
    const key = `wms:b2ccluster:order:${code}`;
    const result = await redis.set(key, body.id, { nx: true, ex: CLUSTER_TTL });
    if (result === null) {
      // Key already exists — this order belongs to another active cluster
      const owner = await redis.get<string>(key);
      conflicts.push(`${code}${owner ? ` (cluster ${owner})` : ""}`);
    } else {
      claimedKeys.push(key);
    }
  }

  if (conflicts.length > 0) {
    // Roll back: release any claims we just set
    if (claimedKeys.length > 0) await redis.del(...claimedKeys);
    const preview = conflicts.slice(0, 3).join(", ");
    const more = conflicts.length > 3 ? ` 외 ${conflicts.length - 3}건` : "";
    return NextResponse.json(
      {
        error: "conflict",
        conflicts,
        message: `이미 다른 클러스터에 포함된 오더: ${preview}${more}`,
      },
      { status: 409 }
    );
  }

  // All orders claimed — persist the cluster
  const clusterNo = body.clusterNo ?? await redis.incr("wms:b2ccluster:counter");
  const cluster: B2CCluster = { ...body, clusterNo };
  await redis.set(`wms:b2ccluster:${body.id}`, cluster, { ex: CLUSTER_TTL });
  return NextResponse.json({ ok: true, id: body.id, clusterNo });
}

export async function PATCH(req: Request) {
  const body = (await req.json()) as Partial<B2CCluster> & { id: string };
  const raw = await redis.get(`wms:b2ccluster:${body.id}`);
  if (!raw) return NextResponse.json({ error: "not found" }, { status: 404 });
  const cluster = (typeof raw === "string" ? JSON.parse(raw) : raw) as B2CCluster;
  const updated = { ...cluster, ...body };
  await redis.set(`wms:b2ccluster:${body.id}`, updated, { ex: CLUSTER_TTL });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  // Release order claims for this cluster so the same orders can be re-clustered
  const raw = await redis.get(`wms:b2ccluster:${id}`);
  if (raw) {
    const cluster = (typeof raw === "string" ? JSON.parse(raw) : raw) as B2CCluster;
    const orderKeys = [...new Set(
      (cluster.bins ?? []).map((b) => b.orderCode).filter(Boolean)
    )].map((code) => `wms:b2ccluster:order:${code}`);
    if (orderKeys.length > 0) {
      // Only release keys that still point to this cluster (safety check)
      await Promise.all(
        orderKeys.map(async (key) => {
          const owner = await redis.get<string>(key);
          if (owner === id) await redis.del(key);
        })
      );
    }
  }

  await redis.del(`wms:b2ccluster:${id}`);
  return NextResponse.json({ ok: true });
}
