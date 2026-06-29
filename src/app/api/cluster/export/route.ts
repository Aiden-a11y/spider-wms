import { NextRequest, NextResponse } from "next/server";
import redis from "@/lib/redis";
import * as XLSX from "xlsx";
import type { B2CCluster } from "@/lib/b2c-cluster";

const WMS_BASE = "https://us-wms-api.stload.com/api";

interface WMSOrderInfo {
  trackingNo: string;
  shippingOrderNo: string;
  status: string;
}

// Extract tracking/status from any WMS response shape
function extractOrderInfo(order: Record<string, unknown>): WMSOrderInfo {
  return {
    trackingNo: String(
      order.trackingNo ?? order.trackingNumber ?? order.tracking ??
      order.waybillNo ?? order.carrierTrackingNo ?? ""
    ),
    shippingOrderNo: String(
      order.shippingOrderNo ?? order.orderNo ?? order.outboundNo ?? ""
    ),
    status: String(order.status ?? order.orderStatus ?? order.shippingStatus ?? ""),
  };
}

// Query WMS list filtered by a single order code — most reliable way to get tracking
async function fetchOrderFromList(
  warehouseCode: string,
  customerCode: string,
  orderCode: string,
  auth: string,
): Promise<WMSOrderInfo | null> {
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
      if (!Array.isArray(list) || list.length === 0) continue;
      // Find exact match
      const match = list.find(
        (o) => String(o.shippingOrderCode ?? o.orderCode ?? "") === orderCode,
      ) ?? list[0];
      const info = extractOrderInfo(match);
      if (info.trackingNo || info.status) return info;
    } catch { /* try next */ }
  }
  return null;
}

// Fallback: fetch order detail endpoint and look for tracking in the response
async function fetchOrderFromDetail(
  orderCode: string,
  auth: string,
): Promise<WMSOrderInfo | null> {
  for (const ep of [
    `${WMS_BASE}/shipping/b2c/items/${encodeURIComponent(orderCode)}`,
    `${WMS_BASE}/shipping/items/${encodeURIComponent(orderCode)}`,
  ]) {
    try {
      const res = await fetch(ep, {
        headers: { "Content-Type": "application/json", Authorization: auth },
      });
      const j = await res.json().catch(() => null);
      if (!j) continue;
      // Detail response may wrap order-level fields under data or data.order
      const order: Record<string, unknown> =
        (j?.data as Record<string, unknown>)?.order as Record<string, unknown> ??
        j?.data ?? j ?? {};
      const info = extractOrderInfo(order as Record<string, unknown>);
      if (info.trackingNo || info.status) return info;
    } catch { /* try next */ }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const { clusterIds } = (await req.json()) as { clusterIds: string[] };
  if (!clusterIds?.length) return NextResponse.json({ error: "missing clusterIds" }, { status: 400 });

  const auth = req.headers.get("authorization");
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // 1. Load clusters from Redis
  const raws = await Promise.all(clusterIds.map((id) => redis.get(`wms:b2ccluster:${id}`)));
  const clusters = raws
    .map((r) => (r ? (typeof r === "string" ? JSON.parse(r) : r) as B2CCluster : null))
    .filter(Boolean) as B2CCluster[];

  if (!clusters.length) return NextResponse.json({ error: "no clusters found" }, { status: 404 });

  // 2. Fetch WMS info for each bin in parallel
  //    Strategy: list endpoint filtered by orderCode → detail endpoint fallback
  type BinInfo = {
    cluster: B2CCluster;
    bin: (typeof clusters)[0]["bins"][0];
    wms: WMSOrderInfo;
  };

  const binInfos: BinInfo[] = await Promise.all(
    clusters.flatMap((cluster) =>
      cluster.bins.map(async (bin) => {
        let wms = await fetchOrderFromList(cluster.warehouseCode, bin.customerCode, bin.orderCode, auth);
        if (!wms?.trackingNo) {
          wms = await fetchOrderFromDetail(bin.orderCode, auth) ?? wms ?? { trackingNo: "", shippingOrderNo: "", status: "" };
        }
        return { cluster, bin, wms: wms ?? { trackingNo: "", shippingOrderNo: "", status: "" } };
      })
    )
  );

  // 3. Build Excel rows
  const rows = binInfos.map(({ cluster, bin, wms }) => ({
    "Cluster": cluster.clusterNo != null ? `#${String(cluster.clusterNo).padStart(4, "0")}` : cluster.id,
    "Created (PDT)": new Date(cluster.createdAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }),
    "Completed (PDT)": cluster.completedAt
      ? new Date(cluster.completedAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
      : "",
    "Bin": bin.binNo,
    "Order Code": bin.orderCode,
    "Order No": wms.shippingOrderNo || bin.orderNo || "",
    "Tracking #": wms.trackingNo,
    "WMS Status": wms.status,
    "Customer": bin.customerCode,
    "Consignee": bin.consigneeName ?? "",
    "Warehouse": cluster.warehouseCode,
  }));

  // 4. Generate Excel
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 8 }, { wch: 22 }, { wch: 22 }, { wch: 5 },
    { wch: 22 }, { wch: 22 }, { wch: 34 }, { wch: 16 },
    { wch: 10 }, { wch: 24 }, { wch: 8 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Cluster Orders");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const label = clusters.map((c) =>
    c.clusterNo != null ? String(c.clusterNo).padStart(4, "0") : c.id.slice(-6)
  ).join("_");

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="clusters-${label}.xlsx"`,
    },
  });
}
