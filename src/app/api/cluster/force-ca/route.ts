import { NextRequest, NextResponse } from "next/server";
import redis from "@/lib/redis";
import type { B2CCluster } from "@/lib/b2c-cluster";

export const dynamic = "force-dynamic";

const WMS_BASE = "https://us-wms-api.stload.com/api";

// Statuses that are at or beyond CA — sending CA would revert progress.
// Mirrors wms-mobile/app/api/cluster/close/route.ts exactly.
async function fetchOrderStatus(
  warehouseCode: string,
  customerCode: string,
  orderCode: string,
  auth: string,
): Promise<string | null> {
  for (const ep of [
    `${WMS_BASE}/shipping/b2c/list`,
    `${WMS_BASE}/shipping/list`,
  ]) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({
          page: 1, limit: 50, pageSize: 50,
          warehouseCode, customerCode,
          shippingOrderCode: orderCode,
        }),
      });
      const j = await res.json().catch(() => null);
      if (!j) continue;
      const list: Record<string, unknown>[] =
        (j?.data as Record<string, unknown>)?.list as Record<string, unknown>[] ??
        (j?.data as Record<string, unknown>)?.items as Record<string, unknown>[] ??
        j?.data ?? j?.list ?? [];
      if (!Array.isArray(list)) continue;
      const order = list.find(
        (o) => String(o.shippingOrderCode ?? o.orderCode ?? "") === orderCode,
      );
      if (order) return String(order.status ?? order.orderStatus ?? "AA");
    } catch { /* try next endpoint */ }
  }
  return null;
}

/**
 * POST /api/cluster/force-ca?id=<clusterId>
 * Recovery tool: re-runs the same AA→CA status-change logic that /api/cluster/close
 * normally performs, for a cluster whose orders never got their CA transition
 * (e.g. close() ran before the picker's session had a valid token).
 * Requires the caller's own WMS Authorization header — no service credentials used.
 * Same safety rule as close(): only orders confirmed at AA (or unverifiable) get CA;
 * anything already at DA/FA/or any other status is skipped, never reverted.
 */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  // Optional — scope processing to a single customer within the cluster
  // (e.g. right after that customer's orders alone were sent to the AMR robot).
  const onlyCustomerCode = searchParams.get("customerCode");

  const auth = req.headers.get("authorization");
  if (!auth) return NextResponse.json({ error: "missing authorization" }, { status: 401 });

  const raw = await redis.get(`wms:b2ccluster:${id}`);
  if (!raw) return NextResponse.json({ error: "cluster not found" }, { status: 404 });
  const cluster = (typeof raw === "string" ? JSON.parse(raw) : raw) as B2CCluster;

  const grouped = new Map<string, string[]>();
  for (const bin of cluster.bins) {
    if (onlyCustomerCode && bin.customerCode !== onlyCustomerCode) continue;
    if (!grouped.has(bin.customerCode)) grouped.set(bin.customerCode, []);
    grouped.get(bin.customerCode)!.push(bin.orderCode);
  }

  const sent: string[] = [];
  const skipped: { code: string; status: string | null }[] = [];
  const caFailed: { customerCode: string; orderCodes: string[]; httpStatus: number | null; body: string }[] = [];
  const outcomeLog: { orderCode: string; customerCode: string; outcome: "sent" | "skipped" | "failed"; detectedStatus: string | null; httpStatus: number | null; errorBody: string | null }[] = [];

  await Promise.all(
    Array.from(grouped.entries()).map(async ([customerCode, orderCodes]) => {
      const statusChecks = await Promise.all(
        orderCodes.map(async (code) => ({
          code,
          status: await fetchOrderStatus(cluster.warehouseCode, customerCode, code, auth),
        })),
      );

      const eligible: string[] = [];
      for (const { code, status } of statusChecks) {
        if (status === null || status === "AA" || status === "CA") {
          eligible.push(code);
          sent.push(code);
        } else {
          skipped.push({ code, status });
          outcomeLog.push({ orderCode: code, customerCode, outcome: "skipped", detectedStatus: status, httpStatus: null, errorBody: null });
        }
      }
      if (eligible.length === 0) return;

      try {
        const res = await fetch(`${WMS_BASE}/shipping/status-change`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: auth },
          body: JSON.stringify({
            warehouseCode: cluster.warehouseCode,
            customerCode,
            orderCodes: eligible,
            newStatus: "CA",
            completeDate: "",
            cancelComment: "",
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          caFailed.push({ customerCode, orderCodes: eligible, httpStatus: res.status, body: body.slice(0, 500) });
          for (const code of eligible) outcomeLog.push({ orderCode: code, customerCode, outcome: "failed", detectedStatus: null, httpStatus: res.status, errorBody: body.slice(0, 500) });
        } else {
          for (const code of eligible) outcomeLog.push({ orderCode: code, customerCode, outcome: "sent", detectedStatus: null, httpStatus: res.status, errorBody: null });
        }
      } catch (e) {
        caFailed.push({ customerCode, orderCodes: eligible, httpStatus: null, body: String(e) });
        for (const code of eligible) outcomeLog.push({ orderCode: code, customerCode, outcome: "failed", detectedStatus: null, httpStatus: null, errorBody: String(e).slice(0, 500) });
      }
    }),
  );

  // Non-blocking persistent log — best effort, doesn't affect the response.
  (async () => {
    try {
      if (outcomeLog.length === 0) return;
      const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
      const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
      if (!sbUrl || !sbKey) return;
      const { createClient } = await import("@supabase/supabase-js");
      const sb = createClient(sbUrl, sbKey);
      await sb.from("ca_outcomes").insert(
        outcomeLog.map((o) => ({
          cluster_id: cluster.id,
          cluster_no: cluster.clusterNo ?? null,
          warehouse_code: cluster.warehouseCode,
          customer_code: o.customerCode,
          order_code: o.orderCode,
          outcome: o.outcome,
          detected_status: o.detectedStatus,
          http_status: o.httpStatus,
          error_body: o.errorBody,
          source: "force-ca",
        })),
      );
    } catch (e) {
      console.warn("[cluster/force-ca] ca_outcomes write failed:", e);
    }
  })();

  return NextResponse.json({ ok: true, sent, skipped, caFailed });
}
