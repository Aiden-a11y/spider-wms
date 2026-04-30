import { NextRequest, NextResponse } from "next/server";
import redis from "@/lib/redis";
import type { CustomerRateMaster } from "@/lib/billing-calc";

const HASH_KEY = "billing_rate_masters";

// GET /api/billing/rates                  — list all rate masters
// GET /api/billing/rates?customer=CODE    — single customer
export async function GET(req: NextRequest) {
  try {
    const customer = req.nextUrl.searchParams.get("customer");
    const raw = await redis.hgetall(HASH_KEY);
    if (!raw) return NextResponse.json(customer ? null : []);

    const all: CustomerRateMaster[] = Object.values(raw).map((v) =>
      typeof v === "string" ? JSON.parse(v) : (v as CustomerRateMaster)
    );

    if (customer) {
      const found = all.find((m) => m.customerCode === customer) ?? null;
      return NextResponse.json(found);
    }

    all.sort((a, b) => a.customerCode.localeCompare(b.customerCode));
    return NextResponse.json(all);
  } catch (e) {
    console.error("GET /api/billing/rates", e);
    return NextResponse.json({ error: "Failed to fetch rate masters" }, { status: 500 });
  }
}

// POST /api/billing/rates   body: CustomerRateMaster  — upsert
export async function POST(req: NextRequest) {
  try {
    const master: CustomerRateMaster = await req.json();
    master.updatedAt = new Date().toISOString();
    await redis.hset(HASH_KEY, { [master.customerCode]: JSON.stringify(master) });
    return NextResponse.json({ ok: true, customerCode: master.customerCode });
  } catch (e) {
    console.error("POST /api/billing/rates", e);
    return NextResponse.json({ error: "Failed to save rate master" }, { status: 500 });
  }
}

// DELETE /api/billing/rates?customer=CODE
export async function DELETE(req: NextRequest) {
  try {
    const customer = req.nextUrl.searchParams.get("customer");
    if (!customer) return NextResponse.json({ error: "customer required" }, { status: 400 });
    await redis.hdel(HASH_KEY, customer);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/billing/rates", e);
    return NextResponse.json({ error: "Failed to delete rate master" }, { status: 500 });
  }
}
