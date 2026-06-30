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

function pickTracking(o: Record<string, unknown>): string {
  for (const k of ["trackingNo", "trackingNumber", "tracking", "waybillNo", "carrierTrackingNo"]) {
    if (o[k] && String(o[k]).length > 5) return String(o[k]);
  }
  return "";
}
function pickOrderNo(o: Record<string, unknown>): string {
  for (const k of ["shippingOrderNo", "orderNo", "outboundNo"]) {
    if (o[k]) return String(o[k]);
  }
  return "";
}
function pickStatus(o: Record<string, unknown>): string {
  return String(o.status ?? o.orderStatus ?? o.shippingStatus ?? "");
}
function pickCode(o: Record<string, unknown>): string {
  return String(o.shippingOrderCode ?? o.orderCode ?? o.outboundCode ?? "");
}

// Load B2C orders from WMS, paginating until all target codes are found
async function loadOrdersUntilFound(
  warehouseCode: string,
  customerCode: string,
  targetCodes: Set<string>,
  auth: string,
): Promise<Map<string, WMSOrderInfo>> {
  const map = new Map<string, WMSOrderInfo>();
  const remaining = new Set(targetCodes);

  for (const ep of [`${WMS_BASE}/shipping/b2c/list`, `${WMS_BASE}/shipping/list`]) {
    map.clear();
    remaining.clear();
    targetCodes.forEach((c) => remaining.add(c));

    let page = 1;
    while (remaining.size > 0) {
      try {
        const res = await fetch(ep, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: auth },
          // No date filter — load all orders, stop when we find what we need
          body: JSON.stringify({ page, limit: 500, pageSize: 500, warehouseCode, customerCode }),
        });
        const j = await res.json().catch(() => null);
        if (!j) break;
        const list: Record<string, unknown>[] =
          (j?.data as Record<string, unknown>)?.list as Record<string, unknown>[] ??
          (j?.data as Record<string, unknown>)?.items as Record<string, unknown>[] ??
          j?.data ?? j?.list ?? [];
        if (!Array.isArray(list) || list.length === 0) break;

        for (const o of list) {
          const code = pickCode(o);
          if (code) {
            map.set(code, {
              trackingNo: pickTracking(o),
              shippingOrderNo: pickOrderNo(o),
              status: pickStatus(o),
            });
            remaining.delete(code);
          }
        }

        if (list.length < 500) break; // last page — no more data
        page++;
        if (page > 20) break; // safety: max 10,000 orders
      } catch { break; }
    }

    if (map.size > 0) break; // endpoint worked, stop trying alternatives
  }
  return map;
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

  // 2. Collect unique warehouse/customer combos + all target order codes
  const combos = new Map<string, { warehouseCode: string; customerCode: string; codes: Set<string> }>();
  for (const c of clusters) {
    for (const bin of c.bins) {
      const key = `${c.warehouseCode}|${bin.customerCode}`;
      if (!combos.has(key)) combos.set(key, { warehouseCode: c.warehouseCode, customerCode: bin.customerCode, codes: new Set() });
      combos.get(key)!.codes.add(bin.orderCode);
    }
  }

  // 3. Load WMS order data, paginating until all target codes are found
  const orderMap = new Map<string, WMSOrderInfo>();
  await Promise.all(
    Array.from(combos.values()).map(async ({ warehouseCode, customerCode, codes }) => {
      const result = await loadOrdersUntilFound(warehouseCode, customerCode, codes, auth);
      result.forEach((info, code) => orderMap.set(code, info));
    })
  );

  // 4. Build Excel rows — EXACT match only, never fall back to wrong data
  const rows = clusters.flatMap((cluster) =>
    cluster.bins.map((bin) => {
      const wms = orderMap.get(bin.orderCode);
      return {
        "Cluster":          cluster.clusterNo != null ? `#${String(cluster.clusterNo).padStart(4, "0")}` : cluster.id,
        "Created (PDT)":    new Date(cluster.createdAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }),
        "Completed (PDT)":  cluster.completedAt ? new Date(cluster.completedAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) : "",
        "Bin":              bin.binNo,
        "Order Code":       bin.orderCode,
        "Order No":         wms?.shippingOrderNo || bin.orderNo || "",
        "Tracking #":       wms?.trackingNo ?? "",
        "WMS Status":       wms?.status ?? "",
        "Customer":         bin.customerCode,
        "Consignee":        bin.consigneeName ?? "",
        "Warehouse":        cluster.warehouseCode,
      };
    })
  );

  // 5. Build Pick Summary — aggregate by Location + SKU across all clusters
  // Key: "locationCode||sku" → { location, sku, totalQty, bins (Set<number>), cluster label }
  type SummaryRow = { "Cluster": string; "Location": string; "SKU": string; "Total Qty": number; "Bins": string };
  const summaryMap = new Map<string, { cluster: string; location: string; sku: string; qty: number; bins: Set<number> }>();
  for (const cluster of clusters) {
    const clusterLabel = cluster.clusterNo != null ? `#${String(cluster.clusterNo).padStart(4, "0")}` : cluster.id;
    for (const grp of cluster.locationGroups) {
      for (const task of grp.tasks) {
        const key = `${clusterLabel}||${grp.locationCode}||${task.sku}`;
        if (!summaryMap.has(key)) {
          summaryMap.set(key, { cluster: clusterLabel, location: grp.locationCode, sku: String(task.sku), qty: 0, bins: new Set() });
        }
        const entry = summaryMap.get(key)!;
        entry.qty += Number(task.qty ?? 0);
        entry.bins.add(Number(task.binNo));
      }
    }
  }
  const summaryRows: SummaryRow[] = Array.from(summaryMap.values()).map((e) => ({
    "Cluster":    e.cluster,
    "Location":   e.location,
    "SKU":        e.sku,
    "Total Qty":  e.qty,
    "Bins":       Array.from(e.bins).sort((a, b) => a - b).join(", "),
  }));

  // 6. Generate Excel
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 8 }, { wch: 22 }, { wch: 22 }, { wch: 5 },
    { wch: 22 }, { wch: 22 }, { wch: 34 }, { wch: 16 },
    { wch: 10 }, { wch: 24 }, { wch: 8 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Cluster Orders");

  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  wsSummary["!cols"] = [{ wch: 8 }, { wch: 22 }, { wch: 24 }, { wch: 10 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "Pick Summary");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const label = clusters
    .map((c) => c.clusterNo != null ? String(c.clusterNo).padStart(4, "0") : c.id.slice(-6))
    .join("_");

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="clusters-${label}.xlsx"`,
    },
  });
}
