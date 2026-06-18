import { NextResponse } from "next/server";
import redis from "@/lib/redis";

export interface Batch {
  id: string;
  fingerprint: string;
  orders: { orderCode: string; customerCode: string; orderNo?: string }[];
  skuList: { sku: string; name: string; qty: number }[];
  orderCount: number;
  type: string;
  warehouseCode: string;
  createdAt: string;
  createdBy: string;
  status?: "active" | "completed";
  completedAt?: string;
}

const BATCH_TTL = 172800; // 48 hours

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const completed = searchParams.get("completed") === "1";

  const pattern = completed ? "wms:batchdone:*" : "wms:batch:*";
  const keys = await redis.keys(pattern);
  if (keys.length === 0) return NextResponse.json([]);
  const values = await Promise.all(keys.map((k) => redis.get(k)));
  const sortField = completed ? "completedAt" : "createdAt";
  const batches = (values.filter(Boolean) as Batch[]).sort(
    (a, b) => new Date(b[sortField] ?? b.createdAt).getTime() - new Date(a[sortField] ?? a.createdAt).getTime()
  );
  return NextResponse.json(batches);
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<Batch>;
  const id = `batch_${Date.now()}`;
  const batch: Batch = {
    id,
    fingerprint: body.fingerprint ?? "",
    orders: body.orders ?? [],
    skuList: body.skuList ?? [],
    orderCount: body.orders?.length ?? 0,
    type: body.type ?? "b2c",
    warehouseCode: body.warehouseCode ?? "",
    createdAt: new Date().toISOString(),
    createdBy: body.createdBy ?? "",
  };
  await redis.set(`wms:batch:${id}`, batch, { ex: BATCH_TTL });
  return NextResponse.json(batch);
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  await redis.del(`wms:batch:${id}`);
  return NextResponse.json({ ok: true });
}
