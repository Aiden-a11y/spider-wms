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

  const keys = (await redis.keys("wms:b2ccluster:*")).filter((k) => !k.endsWith(":counter"));
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
  // Assign sequential cluster number if not already set
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
  await redis.del(`wms:b2ccluster:${id}`);
  return NextResponse.json({ ok: true });
}
