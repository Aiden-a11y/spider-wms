import { NextRequest, NextResponse } from "next/server";
import redis from "@/lib/redis";
import * as XLSX from "xlsx";
import type { B2CCluster } from "@/lib/b2c-cluster";

const WMS_BASE = "https://us-wms-api.stload.com/api";

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

  // 2. Collect all orderCodes and warehouse/customer info
  const allOrderCodes = new Set<string>();
  const warehouseCodes = new Set<string>();
  const customerCodes = new Set<string>();
  for (const c of clusters) {
    warehouseCodes.add(c.warehouseCode);
    for (const bin of c.bins) {
      allOrderCodes.add(bin.orderCode);
      customerCodes.add(bin.customerCode);
    }
  }

  // 3. Fetch tracking numbers from WMS shipping list
  const trackingMap: Record<string, { trackingNo: string; shippingOrderNo: string; status: string }> = {};

  await Promise.all(
    Array.from(warehouseCodes).flatMap((wh) =>
      Array.from(customerCodes).map(async (cust) => {
        for (const ep of [`${WMS_BASE}/shipping/b2c/list`, `${WMS_BASE}/shipping/list`]) {
          try {
            const res = await fetch(ep, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: auth },
              body: JSON.stringify({ page: 1, limit: 1000, pageSize: 1000, warehouseCode: wh, customerCode: cust }),
            });
            const j = await res.json().catch(() => null);
            const list: Record<string, unknown>[] =
              (j?.data as Record<string, unknown>)?.list as Record<string, unknown>[] ??
              (j?.data as Record<string, unknown>)?.items as Record<string, unknown>[] ??
              j?.data ?? j?.list ?? [];
            if (!Array.isArray(list)) continue;
            for (const order of list) {
              const code = String(order.shippingOrderCode ?? order.orderCode ?? "");
              if (allOrderCodes.has(code)) {
                trackingMap[code] = {
                  trackingNo: String(order.trackingNo ?? order.trackingNumber ?? ""),
                  shippingOrderNo: String(order.shippingOrderNo ?? order.orderNo ?? ""),
                  status: String(order.status ?? order.orderStatus ?? ""),
                };
              }
            }
            break;
          } catch { /* try next */ }
        }
      })
    )
  );

  // 4. Build Excel rows
  const rows: Record<string, unknown>[] = [];
  for (const cluster of clusters) {
    const clusterLabel = cluster.clusterNo != null ? `#${String(cluster.clusterNo).padStart(4, "0")}` : cluster.id;
    const createdPDT = new Date(cluster.createdAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
    const completedPDT = cluster.completedAt
      ? new Date(cluster.completedAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
      : "";

    for (const bin of cluster.bins) {
      const wms = trackingMap[bin.orderCode] ?? { trackingNo: "", shippingOrderNo: "", status: "" };
      rows.push({
        "Cluster": clusterLabel,
        "Cluster Created (PDT)": createdPDT,
        "Cluster Completed (PDT)": completedPDT,
        "Bin": bin.binNo,
        "Order Code": bin.orderCode,
        "Shipping Order No": wms.shippingOrderNo || bin.orderNo || "",
        "Tracking #": wms.trackingNo,
        "Customer": bin.customerCode,
        "Consignee": bin.consigneeName ?? "",
        "WMS Status": wms.status,
        "Warehouse": cluster.warehouseCode,
      });
    }
  }

  // 5. Generate Excel
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);

  // Column widths
  ws["!cols"] = [
    { wch: 8 }, { wch: 22 }, { wch: 22 }, { wch: 6 },
    { wch: 22 }, { wch: 28 }, { wch: 32 }, { wch: 10 },
    { wch: 22 }, { wch: 18 }, { wch: 10 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Cluster Orders");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="cluster-export-${Date.now()}.xlsx"`,
    },
  });
}
