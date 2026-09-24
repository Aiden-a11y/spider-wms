import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WMS_BASE = "https://us-wms-api.stload.com/api";

async function wmsLogin(): Promise<string> {
  const userId = process.env.WMS_USER_ID;
  const password = process.env.WMS_PASSWORD;
  if (!userId || !password) throw new Error("WMS credentials missing");
  const res = await fetch(`${WMS_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, password, clientId: "wms_web" }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const j = await res.json();
  const token: string = j?.data?.token ?? j?.data?.accessToken ?? j?.token ?? j?.accessToken;
  if (!token) throw new Error("Token not found in login response");
  return token;
}

/**
 * GET /api/admin/order-lookup?secret=<CRON_SECRET>&trackingNo=...
 * Read-only diagnostic tool using the service-account WMS login (same one the
 * cron snapshot job uses) — for looking up an order by tracking number when
 * incident response needs it and no interactive session is at hand.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const secret = sp.get("secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const trackingNo = sp.get("trackingNo");
  const warehouseCode = sp.get("warehouseCode") ?? "STOO1";
  if (!trackingNo) return NextResponse.json({ error: "trackingNo required" }, { status: 400 });

  try {
    const token = await wmsLogin();
    const auth = `Bearer ${token}`;

    const found: Record<string, unknown>[] = [];
    for (const ep of [`${WMS_BASE}/shipping/list`, `${WMS_BASE}/shipping/b2c/list`]) {
      for (const body of [{ trackingNo }, { trackingNumber: trackingNo }, { search: trackingNo }]) {
        try {
          const res = await fetch(ep, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: auth },
            body: JSON.stringify({ page: 1, limit: 50, pageSize: 50, warehouseCode, ...body }),
          });
          const j = await res.json().catch(() => ({})) as Record<string, unknown>;
          const d = j?.data as Record<string, unknown> | undefined;
          const list: Record<string, unknown>[] = Array.isArray(d?.list) ? (d!.list as Record<string, unknown>[])
            : Array.isArray(d) ? (d as unknown as Record<string, unknown>[])
            : Array.isArray(j?.list) ? (j!.list as Record<string, unknown>[])
            : [];
          for (const o of list) {
            const t = String(o.trackingNo ?? o.trackingNumber ?? "").trim();
            if (t === trackingNo.trim()) found.push(o);
          }
        } catch { /* try next */ }
      }
    }

    // Dedup by shippingOrderCode
    const seen = new Set<string>();
    const uniq = found.filter((o) => {
      const code = String(o.shippingOrderCode ?? o.orderCode ?? "");
      if (!code || seen.has(code)) return false;
      seen.add(code);
      return true;
    });

    return NextResponse.json({ ok: true, count: uniq.length, orders: uniq });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/**
 * POST /api/admin/order-lookup?secret=<CRON_SECRET>
 * body: { orderCode, customerCode, warehouseCode, newStatus }
 * Incident-response status correction using the service-account login.
 * `newStatus` is caller-supplied and NEVER hardcoded to "FA" here — this route
 * exists to walk a status back (e.g. FA -> AA after a mis-scan), not forward.
 */
export async function POST(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const secret = sp.get("secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({})) as {
    orderCode?: string; customerCode?: string; warehouseCode?: string; newStatus?: string;
  };
  const { orderCode, customerCode, newStatus } = body;
  const warehouseCode = body.warehouseCode ?? "STOO1";
  if (!orderCode || !customerCode || !newStatus) {
    return NextResponse.json({ error: "orderCode, customerCode, newStatus required" }, { status: 400 });
  }
  if (newStatus === "FA") {
    return NextResponse.json({ error: "newStatus 'FA' is never permitted through this endpoint" }, { status: 400 });
  }

  try {
    const token = await wmsLogin();
    const res = await fetch(`${WMS_BASE}/shipping/status-change`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        warehouseCode, customerCode, orderCodes: [orderCode],
        newStatus, completeDate: "", cancelComment: "",
      }),
    });
    const j = await res.json().catch(() => ({}));
    return NextResponse.json({ ok: res.ok, httpStatus: res.status, response: j });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
