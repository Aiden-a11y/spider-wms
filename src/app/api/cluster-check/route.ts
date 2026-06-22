import { NextResponse } from "next/server";
import redis from "@/lib/redis";

const TTL = 24 * 60 * 60; // 24 hours

interface CheckCache {
  checkResults: Record<string, "yes" | "no">;
  replenSkus: Array<{ sku: string; name: string; orderCount: number; location: string; custCode: string }>;
  checkedAt: string;
  warehouseCode: string;
  customerCode: string;
}

function cacheKey(warehouseCode: string, customerCode: string) {
  return `wms:cluster-check:${warehouseCode}:${customerCode || "all"}`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const warehouseCode = searchParams.get("warehouseCode") ?? "STOO1";
  const customerCode = searchParams.get("customerCode") ?? "";
  const raw = await redis.get(cacheKey(warehouseCode, customerCode));
  if (!raw) return NextResponse.json(null);
  return NextResponse.json(typeof raw === "string" ? JSON.parse(raw) : raw);
}

export async function POST(req: Request) {
  const body = (await req.json()) as CheckCache;
  await redis.set(cacheKey(body.warehouseCode, body.customerCode), body, { ex: TTL });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const warehouseCode = searchParams.get("warehouseCode") ?? "STOO1";
  const customerCode = searchParams.get("customerCode") ?? "";
  await redis.del(cacheKey(warehouseCode, customerCode));
  return NextResponse.json({ ok: true });
}
