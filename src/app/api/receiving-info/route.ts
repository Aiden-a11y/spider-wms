import { NextRequest, NextResponse } from "next/server";
import redis from "@/lib/redis";
import type { ReceivingInfo } from "@/lib/receiving-info";

const HASH_KEY = "receiving_info";

// GET /api/receiving-info              → { [orderCode]: ReceivingInfo } all
// GET /api/receiving-info?order=CODE   → single ReceivingInfo | null
export async function GET(req: NextRequest) {
  try {
    const order = req.nextUrl.searchParams.get("order");
    const raw = await redis.hgetall(HASH_KEY);
    if (!raw) return NextResponse.json(order ? null : {});

    if (order) {
      const val = raw[order];
      return NextResponse.json(val
        ? (typeof val === "string" ? JSON.parse(val) : val)
        : null);
    }

    const all: Record<string, ReceivingInfo> = {};
    for (const [k, v] of Object.entries(raw)) {
      all[k] = typeof v === "string" ? JSON.parse(v) : (v as ReceivingInfo);
    }
    return NextResponse.json(all);
  } catch (e) {
    console.error("GET /api/receiving-info", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

// POST /api/receiving-info  body: ReceivingInfo → upsert
export async function POST(req: NextRequest) {
  try {
    const info: ReceivingInfo = await req.json();
    info.updatedAt = new Date().toISOString();
    await redis.hset(HASH_KEY, { [info.orderCode]: JSON.stringify(info) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("POST /api/receiving-info", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

// DELETE /api/receiving-info?order=CODE
export async function DELETE(req: NextRequest) {
  try {
    const order = req.nextUrl.searchParams.get("order");
    if (!order) return NextResponse.json({ error: "order required" }, { status: 400 });
    await redis.hdel(HASH_KEY, order);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/receiving-info", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
