import { NextRequest, NextResponse } from "next/server";
import redis from "@/lib/redis";
import type { BillingInvoice } from "@/lib/billing-calc";

const HASH_KEY = "billing_invoices";

// GET /api/billing/invoices                — list all
// GET /api/billing/invoices?id=2026-02_STL — single invoice
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    const raw = await redis.hgetall(HASH_KEY);
    if (!raw) return NextResponse.json(id ? null : []);

    const all: BillingInvoice[] = Object.values(raw).map((v) =>
      typeof v === "string" ? JSON.parse(v) : (v as BillingInvoice)
    );

    if (id) {
      const found = all.find((inv) => inv.id === id) ?? null;
      return NextResponse.json(found);
    }

    // Sort by period desc, then customer asc
    all.sort((a, b) =>
      b.period.localeCompare(a.period) || a.customer.localeCompare(b.customer)
    );
    return NextResponse.json(all);
  } catch (e) {
    console.error("GET /api/billing/invoices", e);
    return NextResponse.json({ error: "Failed to fetch invoices" }, { status: 500 });
  }
}

// POST /api/billing/invoices   body: BillingInvoice  — save (upsert)
export async function POST(req: NextRequest) {
  try {
    const invoice: BillingInvoice = await req.json();
    invoice.updatedAt = new Date().toISOString();
    await redis.hset(HASH_KEY, { [invoice.id]: JSON.stringify(invoice) });
    return NextResponse.json({ ok: true, id: invoice.id });
  } catch (e) {
    console.error("POST /api/billing/invoices", e);
    return NextResponse.json({ error: "Failed to save invoice" }, { status: 500 });
  }
}

// DELETE /api/billing/invoices?id=xxx
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await redis.hdel(HASH_KEY, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/billing/invoices", e);
    return NextResponse.json({ error: "Failed to delete invoice" }, { status: 500 });
  }
}
