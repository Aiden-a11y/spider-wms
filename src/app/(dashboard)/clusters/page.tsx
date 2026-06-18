"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import {
  Layers, RefreshCw, Trash2, Loader2, CheckCircle2, AlertCircle,
  Printer, Plus, Search, ChevronDown, ChevronUp, X,
} from "lucide-react";
import type {
  B2CCluster, B2CClusterBin, B2CClusterLocationGroup, B2CClusterTask, B2CClusterItem,
} from "@/lib/b2c-cluster";
import { binColor, sortLocationGroups } from "@/lib/b2c-cluster";

const MAX_BINS = 25;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function orderCodeOf(o: Record<string, unknown>): string {
  return String(o.shippingOrderCode ?? o.orderCode ?? o.outboundCode ?? "");
}

function isShelf(zoneNm: unknown): boolean {
  return String(zoneNm ?? "").toLowerCase().includes("shelf");
}

export default function ClustersPage() {
  const { user } = useAuth();
  const router = useRouter();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  // ── Warehouse / Customer ──────────────────────────────────────────────────
  const [warehouseCode, setWarehouseCode] = useState("STOO1");
  const [warehouses, setWarehouses] = useState<{ code: string; name: string }[]>([]);
  const [customers, setCustomers] = useState<{ code: string; name: string }[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState("");

  // ── Orders ────────────────────────────────────────────────────────────────
  const [orders, setOrders] = useState<Record<string, unknown>[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedCodes, setSelectedCodes] = useState<Record<string, boolean>>({});
  const [colFilter, setColFilter] = useState({ orderCode: "", customer: "", consignee: "", qty: "", date: "" });

  // ── Clusters ──────────────────────────────────────────────────────────────
  const [clusters, setClusters] = useState<B2CCluster[]>([]);
  const [loadingClusters, setLoadingClusters] = useState(false);
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Creating ──────────────────────────────────────────────────────────────
  const [creating, setCreating] = useState(false);
  const [createStep, setCreateStep] = useState("");
  const [createError, setCreateError] = useState("");

  // ── Fetch warehouses & customers ──────────────────────────────────────────
  useEffect(() => {
    fetch("/api/wms/combo/warehouse", { headers })
      .then((r) => r.json())
      .then((j) => {
        const arr: Record<string, unknown>[] = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
        setWarehouses(arr.map((w) => ({ code: String(w.code ?? w.id ?? ""), name: String(w.name ?? w.code ?? "") })));
        const pref = arr.find((w) => String(w.code ?? "") === "STOO1") ?? arr[0];
        if (pref) setWarehouseCode(String(pref.code ?? pref.id ?? "STOO1"));
      })
      .catch(() => {});
  }, []); // eslint-disable-line

  useEffect(() => {
    fetch(`/api/wms/combo/customer-by-ordertype/B2C?warehouseCode=${encodeURIComponent(warehouseCode)}`, { headers })
      .then((r) => r.json())
      .then((j) => {
        const list = j?.data ?? j ?? [];
        if (Array.isArray(list))
          setCustomers(list.map((c: Record<string, unknown>) => ({
            code: String(c.customerCode ?? c.code ?? ""),
            name: String(c.customerName ?? c.name ?? ""),
          })));
      })
      .catch(() => {});
  }, [warehouseCode]); // eslint-disable-line

  // ── Load orders ───────────────────────────────────────────────────────────
  const loadOrders = useCallback(async () => {
    setLoadingOrders(true);
    setOrders([]);
    const body = {
      page: 1, limit: 500, pageSize: 500,
      orderType: "B2C",
      warehouseCode,
      ...(selectedCustomer ? { customerCode: selectedCustomer } : {}),
    };
    for (const ep of ["/api/wms/shipping/b2c/list", "/api/wms/shipping/list"]) {
      try {
        const res = await fetch(ep, { method: "POST", headers, body: JSON.stringify(body) });
        const j = await res.json().catch(() => null);
        const list = j?.data?.list ?? j?.data?.items ?? j?.data ?? j?.list ?? (Array.isArray(j) ? j : []);
        if (res.ok && Array.isArray(list)) {
          // Only show Out-Bound Request orders (AA)
          setOrders(list.filter((o: Record<string, unknown>) =>
            ["AA", "Out-Bound Request"].includes(String(o.status ?? o.orderStatus ?? "AA"))
          ));
          setLoadingOrders(false);
          return;
        }
      } catch { /* try next */ }
    }
    setLoadingOrders(false);
  }, [warehouseCode, selectedCustomer, headers]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  // ── Load clusters ─────────────────────────────────────────────────────────
  const loadClusters = useCallback(async () => {
    setLoadingClusters(true);
    try {
      const res = await fetch("/api/cluster");
      const data = await res.json();
      if (Array.isArray(data)) setClusters(data);
    } finally {
      setLoadingClusters(false);
    }
  }, []);

  useEffect(() => { loadClusters(); }, [loadClusters]);

  // ── Selection helpers ─────────────────────────────────────────────────────
  const filteredOrders = useMemo(() => {
    let list = orders;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((o) =>
        orderCodeOf(o).toLowerCase().includes(q) ||
        String(o.customerName ?? "").toLowerCase().includes(q) ||
        String(o.consigneeName ?? "").toLowerCase().includes(q) ||
        String(o.shippingOrderNo ?? "").toLowerCase().includes(q)
      );
    }
    if (colFilter.orderCode) {
      const q = colFilter.orderCode.toLowerCase();
      list = list.filter((o) =>
        orderCodeOf(o).toLowerCase().includes(q) ||
        String(o.shippingOrderNo ?? "").toLowerCase().includes(q)
      );
    }
    if (colFilter.customer) {
      const q = colFilter.customer.toLowerCase();
      list = list.filter((o) =>
        String(o.customerName ?? "").toLowerCase().includes(q) ||
        String(o.customerCode ?? "").toLowerCase().includes(q)
      );
    }
    if (colFilter.consignee) {
      const q = colFilter.consignee.toLowerCase();
      list = list.filter((o) => String(o.consigneeName ?? "").toLowerCase().includes(q));
    }
    if (colFilter.qty) {
      const n = Number(colFilter.qty);
      if (!isNaN(n)) list = list.filter((o) => Number(o.totalQty ?? o.qty ?? 0) >= n);
    }
    if (colFilter.date) {
      list = list.filter((o) => String(o.orderDate ?? "").includes(colFilter.date));
    }
    return list;
  }, [orders, search, colFilter]);

  const totalFilteredQty = useMemo(
    () => filteredOrders.reduce((sum, o) => sum + Number(o.totalQty ?? o.qty ?? 0), 0),
    [filteredOrders]
  );

  const selectedList = filteredOrders.filter((o) => selectedCodes[orderCodeOf(o)]);
  const canCreate = selectedList.length > 0 && selectedList.length <= MAX_BINS;

  function setCol(key: keyof typeof colFilter, val: string) {
    setColFilter((p) => ({ ...p, [key]: val }));
  }
  const hasColFilter = Object.values(colFilter).some(Boolean);

  function toggleSelect(code: string) {
    setSelectedCodes((p) => ({ ...p, [code]: !p[code] }));
  }
  function toggleAll() {
    const visible = filteredOrders.slice(0, MAX_BINS).map((o) => orderCodeOf(o));
    const allSelected = visible.every((c) => selectedCodes[c]);
    const next: Record<string, boolean> = {};
    if (!allSelected) visible.forEach((c) => { next[c] = true; });
    setSelectedCodes(next);
  }

  // ── Cluster creation ──────────────────────────────────────────────────────
  async function createCluster() {
    if (!canCreate) return;
    setCreating(true);
    setCreateError("");

    const selected = selectedList.slice(0, MAX_BINS);
    const bins: B2CClusterBin[] = [];
    const replenishmentBins: number[] = [];
    const locMap = new Map<string, { locationCode: string; locationId: string; tasks: B2CClusterTask[] }>();

    try {
      for (let i = 0; i < selected.length; i++) {
        const o = selected[i];
        const code = orderCodeOf(o);
        const binNo = i + 1;
        setCreateStep(`[${binNo}/${selected.length}] ${code} — fetching assignments…`);

        // 1. Fetch items/assignments — try B2C-specific and generic endpoints
        const parseAssignments = (j: Record<string, unknown>): Record<string, unknown>[] => {
          const d2 = (j?.data ?? {}) as Record<string, unknown>;
          for (const arr of [d2.assignments, j.assignments, d2.list, j.list]) {
            if (Array.isArray(arr) && arr.length > 0) return arr as Record<string, unknown>[];
          }
          return [];
        };
        const parseLineItems = (j: Record<string, unknown>): Record<string, unknown>[] => {
          const d2 = (j?.data ?? {}) as Record<string, unknown>;
          for (const arr of [d2.items, j.items, d2.shippingItems, j.shippingItems, d2.orderItems, j.orderItems]) {
            if (Array.isArray(arr) && arr.length > 0) return arr as Record<string, unknown>[];
          }
          return [];
        };

        let rawAssignments: Record<string, unknown>[] = [];
        let rawItems: Record<string, unknown>[] = [];
        for (const ep of [
          `/api/wms/shipping/b2c/items/${encodeURIComponent(code)}`,
          `/api/wms/shipping/items/${encodeURIComponent(code)}`,
        ]) {
          try {
            const res = await fetch(ep, { headers });
            const j = await res.json().catch(() => ({})) as Record<string, unknown>;
            const asgn = parseAssignments(j);
            const itms = parseLineItems(j);
            if (asgn.length > 0 || itms.length > 0) {
              rawAssignments = asgn;
              rawItems = itms;
              break;
            }
          } catch { /* try next */ }
        }

        // Diagnostic: show what zones exist
        const zoneSet: Record<string, true> = {};
        rawAssignments.forEach((a) => { zoneSet[String(a.zoneNm ?? a.zoneName ?? a.zone ?? "—")] = true; });
        const zoneNames = Object.keys(zoneSet).join(", ") || "(none)";
        setCreateStep(`[${binNo}/${selected.length}] ${code} — ${rawAssignments.length} asgn / ${rawItems.length} items, zones: ${zoneNames}`);
        await sleep(80);

        // 2. Filter to shelf zone assignments
        let shelfAssignments = rawAssignments.filter((a) =>
          isShelf(a.zoneNm ?? a.zoneName ?? a.zone)
        );

        // 3. If no shelf assignments → check available shelf stock or flag replenishment
        let needsReplenishment = false;

        // Case A: no items at all
        if (rawAssignments.length === 0 && rawItems.length === 0) {
          needsReplenishment = true;
          setCreateStep(`[${binNo}/${selected.length}] ${code} — ⚠ No items in order. Replenishment required.`);
          await sleep(400);
        }

        // Case B: assignments exist but ALL in non-shelf zones, no unassigned items to re-assign
        if (shelfAssignments.length === 0 && rawAssignments.length > 0 && rawItems.length === 0) {
          const zones = Object.keys(zoneSet).join(", ");
          needsReplenishment = true;
          setCreateStep(`[${binNo}/${selected.length}] ${code} — ⚠ Assigned to non-shelf (${zones}). Move to shelf first.`);
          await sleep(400);
        }

        if (!needsReplenishment && shelfAssignments.length === 0 && rawItems.length > 0) {
          setCreateStep(`[${binNo}/${selected.length}] ${code} — checking shelf stock…`);
          const custCode = String(o.customerCode ?? "");
          let anyShelfStockFound = false;

          for (const item of rawItems) {
            const sku = String(item.productSku ?? item.sku ?? "");
            if (!sku) continue;
            const unassignedQty = Number(item.unassignedQty ?? item.qty ?? 0);
            if (unassignedQty <= 0) continue;

            const stockRes = await fetch(
              `/api/wms/shipping/available-stock/${encodeURIComponent(warehouseCode)}/${encodeURIComponent(custCode)}?productSku=${encodeURIComponent(sku)}`,
              { headers }
            );
            const stockJson = await stockRes.json().catch(() => ({})) as Record<string, unknown>;
            const stockList = (Array.isArray(stockJson?.data) ? stockJson.data : []) as Record<string, unknown>[];
            const shelfStock = stockList
              .filter((s) => isShelf(s.zoneNm ?? s.zoneName) && Number(s.availQty ?? 0) > 0)
              .sort((a, b) => {
                const expA = String(a.expireDate ?? "") || "99999999";
                const expB = String(b.expireDate ?? "") || "99999999";
                return expA.localeCompare(expB);
              });

            const best = shelfStock[0];
            if (!best) continue;

            anyShelfStockFound = true;
            const assignBody = {
              shippingOrderCode: code,
              shippingItemId: item.shippingItemId,
              customerCode: custCode,
              warehouseCode,
              warehouseCd: best.location,
              productSku: sku,
              lotNo: String(best.lotNo ?? ""),
              expireDate: String(best.expireDate ?? ""),
              itemCondition: String(best.itemCondition ?? "GOOD"),
              qty: unassignedQty,
            };
            await fetch("/api/wms/shipping/assign", { method: "POST", headers, body: JSON.stringify(assignBody) });
            shelfAssignments.push({
              ...item, ...best,
              locationCode: best.location,
              productSku: sku,
            });
            await sleep(200);
          }

          // No shelf stock at all → replenishment needed
          if (!anyShelfStockFound && shelfAssignments.length === 0) {
            needsReplenishment = true;
            setCreateStep(`[${binNo}/${selected.length}] ${code} — ⚠ No shelf stock. Replenishment required.`);
            await sleep(400);
          }
        }

        // Collect replenishment SKU list from rawAssignments (Case B) or rawItems (Case C)
        let replenishmentItems: { sku: string; name: string; qty: number; locationCode?: string }[] = [];
        if (needsReplenishment) {
          replenishmentBins.push(binNo);
          if (rawAssignments.length > 0) {
            // Case B: assigned to non-shelf — show current location so staff knows where to pull from
            replenishmentItems = rawAssignments.map((a) => ({
              sku: String(a.productSku ?? a.sku ?? ""),
              name: String(a.productName ?? a.skuName ?? a.itemName ?? ""),
              qty: Number(a.qty ?? a.assignQty ?? a.assignedQty ?? 0),
              locationCode: String(a.locationCode ?? a.location ?? ""),
            })).filter((r) => r.sku);
          } else if (rawItems.length > 0) {
            // Case C: no shelf stock — show what's needed
            replenishmentItems = rawItems.map((it) => ({
              sku: String(it.productSku ?? it.sku ?? ""),
              name: String(it.productName ?? it.skuName ?? it.itemName ?? ""),
              qty: Number(it.unassignedQty ?? it.qty ?? 0),
            })).filter((r) => r.sku && r.qty > 0);
          }
        }

        // 4. Build bin items (empty if replenishment needed)
        const binItems: B2CClusterItem[] = shelfAssignments.map((a) => ({
          sku: String(a.productSku ?? a.sku ?? ""),
          name: String(a.productName ?? a.skuName ?? a.itemName ?? ""),
          qty: Number(a.qty ?? a.assignQty ?? a.assignedQty ?? 0),
          locationCode: String(a.locationCode ?? a.location ?? ""),
          locationId: String(a.inKey ?? a.locationId ?? ""),
          lotNo: String(a.lotNo ?? ""),
          expireDate: String(a.expireDate ?? ""),
          itemCondition: String(a.itemCondition ?? "GOOD"),
          shippingItemId: Number(a.shippingItemId ?? 0) || undefined,
        }));

        bins.push({
          binNo,
          orderCode: code,
          customerCode: String(o.customerCode ?? ""),
          orderNo: String(o.shippingOrderNo ?? ""),
          consigneeName: String(o.consigneeName ?? ""),
          consigneeAddress1: String(o.consigneeAddress1 ?? ""),
          consigneeAddress2: String(o.consigneeAddress2 ?? ""),
          consigneeCity: String(o.consigneeCity ?? ""),
          consigneeState: String(o.consigneeState ?? ""),
          consigneeZipCode: String(o.consigneeZipCode ?? ""),
          consigneeNationalCode: String(o.consigneeNationalCode ?? ""),
          consigneeTelLNo: String(o.consigneeTelLNo ?? o.consigneeCellNo ?? ""),
          items: binItems,
          needsReplenishment,
          ...(replenishmentItems.length > 0 ? { replenishmentItems } : {}),
        });

        // 5. Accumulate location groups
        for (const item of binItems) {
          const key = item.locationCode;
          if (!key) continue;
          if (!locMap.has(key)) locMap.set(key, { locationCode: key, locationId: item.locationId ?? "", tasks: [] });
          locMap.get(key)!.tasks.push({
            binNo,
            orderCode: code,
            sku: item.sku,
            skuName: item.name,
            qty: item.qty,
            locationId: item.locationId,
            lotNo: item.lotNo,
            expireDate: item.expireDate,
            itemCondition: item.itemCondition,
            shippingItemId: item.shippingItemId,
          });
        }

        if (i < selected.length - 1) await sleep(300 + Math.random() * 200);
      }

      setCreateStep("Building cluster…");
      const locationGroups: B2CClusterLocationGroup[] = sortLocationGroups(
        Array.from(locMap.values())
      );

      const cluster: B2CCluster = {
        id: `cluster_${Date.now()}`,
        warehouseCode,
        createdAt: new Date().toISOString(),
        createdBy: user!.userId,
        status: "active",
        bins,
        locationGroups,
        ...(replenishmentBins.length > 0 ? { replenishmentBins } : {}),
      };

      await fetch("/api/cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cluster),
      });

      setClusters((p) => [cluster, ...p]);
      setSelectedCodes({});
      setCreateStep("");
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Cluster creation failed");
    } finally {
      setCreating(false);
    }
  }

  // ── Delete cluster ────────────────────────────────────────────────────────
  async function deleteCluster(id: string) {
    setDeletingId(id);
    await fetch(`/api/cluster?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setClusters((p) => p.filter((c) => c.id !== id));
    setDeletingId(null);
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
            <Layers className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">B2C Cluster Pick</h1>
            <p className="text-sm text-slate-500">Create up to 25-order clusters with shelf location assignment</p>
          </div>
        </div>
        <button onClick={loadClusters} disabled={loadingClusters}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors">
          <RefreshCw className={`w-4 h-4 ${loadingClusters ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* ── Existing clusters ── */}
      {clusters.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide">Active Clusters</h2>
          {clusters.map((cluster) => {
            const isExpanded = expandedCluster === cluster.id;
            const isDeleting = deletingId === cluster.id;
            return (
              <div key={cluster.id} className={`bg-white border rounded-2xl shadow-sm overflow-hidden ${cluster.status === "completed" ? "border-emerald-200" : "border-slate-200"}`}>
                {/* Card header */}
                <div className={`px-5 py-4 flex items-start gap-4 ${cluster.status === "completed" ? "bg-emerald-50/50" : ""}`}>
                  {/* Bin color grid */}
                  <div className="grid grid-cols-5 gap-0.5 flex-shrink-0">
                    {Array.from({ length: Math.min(cluster.bins.length, 25) }).map((_, i) => (
                      <div key={i}
                        style={{ backgroundColor: binColor(i + 1), width: 14, height: 14, borderRadius: 2 }}
                        title={`Bin ${i + 1}: ${cluster.bins[i]?.orderCode ?? ""}`}
                      />
                    ))}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-base font-extrabold text-slate-900">{cluster.bins.length} bins</span>
                      <span className="text-sm text-slate-400">· {cluster.locationGroups.length} locations</span>
                      <span className="text-sm text-slate-400">· {cluster.warehouseCode}</span>
                      {cluster.replenishmentBins && cluster.replenishmentBins.length > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
                          <AlertCircle className="w-3 h-3" />
                          Replenishment needed: Bin {cluster.replenishmentBins.join(", ")}
                        </span>
                      )}
                      {cluster.status === "completed" && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
                          <CheckCircle2 className="w-3 h-3" /> Completed
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">Created: {new Date(cluster.createdAt).toLocaleString()}</p>
                    {cluster.completedAt && (
                      <p className="text-xs text-emerald-600">Closed: {new Date(cluster.completedAt).toLocaleString()}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => router.push(`/clusters-print?id=${encodeURIComponent(cluster.id)}`)}
                      className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                      title="Print Pick Tickets"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { isDeleting ? null : deleteCluster(cluster.id); }}
                      disabled={isDeleting}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => setExpandedCluster(isExpanded ? null : cluster.id)}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                    >
                      {isExpanded ? <><ChevronUp className="w-3.5 h-3.5" /> Collapse</> : <><ChevronDown className="w-3.5 h-3.5" /> Detail</>}
                    </button>
                  </div>
                </div>

                {/* Expanded: bins + location groups */}
                {isExpanded && (
                  <div className="border-t border-slate-100">

                    {/* Replenishment summary */}
                    {cluster.replenishmentBins && cluster.replenishmentBins.length > 0 && (() => {
                      // Aggregate SKUs across all replenishment bins
                      const skuMap: Record<string, { name: string; qty: number; locations: string[] }> = {};
                      cluster.bins.forEach((bin) => {
                        if (!bin.needsReplenishment || !bin.replenishmentItems) return;
                        bin.replenishmentItems.forEach((ri) => {
                          if (!skuMap[ri.sku]) skuMap[ri.sku] = { name: ri.name, qty: 0, locations: [] };
                          skuMap[ri.sku].qty += ri.qty;
                          if (ri.locationCode && !skuMap[ri.sku].locations.includes(ri.locationCode))
                            skuMap[ri.sku].locations.push(ri.locationCode);
                        });
                      });
                      const rows = Object.entries(skuMap);
                      if (rows.length === 0) return null;
                      return (
                        <div className="px-5 py-3 border-b border-amber-100 bg-amber-50/60">
                          <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5" /> Replenishment Summary — Move to Shelf
                          </p>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-amber-600 font-semibold">
                                  <th className="text-left py-1 pr-4">SKU</th>
                                  <th className="text-left py-1 pr-4">Product</th>
                                  <th className="text-right py-1 pr-4 w-16">Total Qty</th>
                                  <th className="text-left py-1">Current Location</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map(([sku, info]) => (
                                  <tr key={sku} className="border-t border-amber-100">
                                    <td className="font-mono font-bold text-slate-700 py-1.5 pr-4">{sku}</td>
                                    <td className="text-slate-600 py-1.5 pr-4 max-w-[180px] truncate">{info.name || "—"}</td>
                                    <td className="text-right font-bold text-amber-700 py-1.5 pr-4">{info.qty}</td>
                                    <td className="font-mono text-slate-500 py-1.5">{info.locations.join(", ") || "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Bin list */}
                    <div className="px-5 py-3 border-b border-slate-100">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Bins ({cluster.bins.length})</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {cluster.bins.map((bin) => (
                          <div key={bin.binNo}
                            className={`flex items-start gap-2 p-2.5 rounded-xl border ${bin.needsReplenishment ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-slate-50"}`}>
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                              style={{ backgroundColor: binColor(bin.binNo) }}>
                              {bin.binNo}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-mono text-xs font-bold text-slate-700 truncate">{bin.orderNo || bin.orderCode}</p>
                              {bin.consigneeName && <p className="text-xs text-slate-400 truncate">{bin.consigneeName}</p>}
                              {bin.needsReplenishment ? (
                                <div className="mt-1 space-y-0.5">
                                  {bin.replenishmentItems && bin.replenishmentItems.length > 0
                                    ? bin.replenishmentItems.map((ri, ri_i) => (
                                        <p key={ri_i} className="text-xs text-amber-700 font-mono flex items-center gap-1">
                                          <span className="font-bold">{ri.sku}</span>
                                          <span className="text-amber-500">×{ri.qty}</span>
                                          {ri.locationCode && <span className="text-slate-400">@ {ri.locationCode}</span>}
                                        </p>
                                      ))
                                    : <p className="text-xs font-semibold text-amber-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Replenishment needed</p>
                                  }
                                </div>
                              ) : (
                                <p className="text-xs text-slate-400">{bin.items.length} item{bin.items.length !== 1 ? "s" : ""}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Location group list */}
                    <div className="px-5 py-3">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Pick Route ({cluster.locationGroups.length} locations)</p>
                      <div className="space-y-1.5">
                        {cluster.locationGroups.map((grp, idx) => (
                          <div key={grp.locationCode} className="flex items-start gap-3 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                            <span className="text-xs font-bold text-slate-400 w-5 flex-shrink-0 mt-0.5">{idx + 1}</span>
                            <span className="font-mono text-sm font-bold text-slate-800 flex-shrink-0">{grp.locationCode}</span>
                            <div className="flex flex-wrap gap-1">
                              {grp.tasks.map((t, ti) => (
                                <span key={ti} className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md font-medium"
                                  style={{ backgroundColor: `${binColor(t.binNo)}20`, color: binColor(t.binNo) }}>
                                  Bin {t.binNo} · {t.sku} ×{t.qty}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Creating progress overlay ── */}
      {creating && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              <h3 className="text-base font-bold text-slate-900">Creating Cluster…</h3>
            </div>
            <p className="text-sm text-slate-600 min-h-[2.5rem] leading-relaxed">{createStep}</p>
            {createError && (
              <div className="mt-3 flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-xl p-3">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                {createError}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Order selection ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide">Select B2C Orders</h2>
            {!loadingOrders && orders.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
                  {filteredOrders.length} orders
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">
                  Total Qty: {totalFilteredQty.toLocaleString()}
                </span>
                {hasColFilter && (
                  <button onClick={() => setColFilter({ orderCode: "", customer: "", consignee: "", qty: "", date: "" })}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors border border-slate-200">
                    <X className="w-3 h-3" /> Clear filters
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedList.length > 0 && (
              <span className="text-xs text-slate-500">{selectedList.length} / {MAX_BINS} selected</span>
            )}
            <button
              onClick={createCluster}
              disabled={!canCreate || creating}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Cluster {selectedList.length > 0 ? `(${selectedList.length})` : ""}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <select value={warehouseCode} onChange={(e) => setWarehouseCode(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {warehouses.map((w) => <option key={w.code} value={w.code}>{w.name || w.code}</option>)}
            {warehouses.length === 0 && <option value="STOO1">STOO1</option>}
          </select>
          <select value={selectedCustomer} onChange={(e) => setSelectedCustomer(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Customers</option>
            {customers.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
          </select>
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search order, customer, consignee…"
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {search && <button onClick={() => setSearch("")} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>}
          </div>
          <button onClick={loadOrders} disabled={loadingOrders}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-sm transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${loadingOrders ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Order table */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-4 py-3 w-10">
                  <input type="checkbox"
                    checked={filteredOrders.slice(0, MAX_BINS).length > 0 && filteredOrders.slice(0, MAX_BINS).every((o) => selectedCodes[orderCodeOf(o)])}
                    onChange={toggleAll}
                    className="accent-blue-600 w-4 h-4" />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Order Code</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Customer</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Consignee</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide w-16">Qty</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide w-28">Date</th>
              </tr>
              <tr className="bg-white border-b border-slate-100">
                <th />
                <th className="px-3 py-1.5">
                  <input value={colFilter.orderCode} onChange={(e) => setCol("orderCode", e.target.value)}
                    placeholder="Filter…"
                    className="w-full border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400 font-normal" />
                </th>
                <th className="px-3 py-1.5">
                  <input value={colFilter.customer} onChange={(e) => setCol("customer", e.target.value)}
                    placeholder="Filter…"
                    className="w-full border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400 font-normal" />
                </th>
                <th className="px-3 py-1.5">
                  <input value={colFilter.consignee} onChange={(e) => setCol("consignee", e.target.value)}
                    placeholder="Filter…"
                    className="w-full border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400 font-normal" />
                </th>
                <th className="px-3 py-1.5">
                  <input value={colFilter.qty} onChange={(e) => setCol("qty", e.target.value)}
                    placeholder="≥"
                    type="number" min={0}
                    className="w-full border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400 font-normal text-right" />
                </th>
                <th className="px-3 py-1.5">
                  <input value={colFilter.date} onChange={(e) => setCol("date", e.target.value)}
                    placeholder="e.g. 2026-06"
                    className="w-full border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400 font-normal" />
                </th>
              </tr>
            </thead>
            <tbody>
              {loadingOrders && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                  Loading orders…
                </td></tr>
              )}
              {!loadingOrders && filteredOrders.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400 text-sm">No Out-Bound Request orders found</td></tr>
              )}
              {filteredOrders.slice(0, 200).map((o, i) => {
                const code = orderCodeOf(o);
                const isSelected = !!selectedCodes[code];
                const isOver = !isSelected && selectedList.length >= MAX_BINS;
                return (
                  <tr key={code}
                    onClick={() => !isOver && toggleSelect(code)}
                    className={`border-b border-slate-50 last:border-0 transition-colors ${isOver ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:bg-slate-50"} ${isSelected ? "bg-blue-50" : ""}`}>
                    <td className="px-4 py-2.5">
                      <input type="checkbox" checked={isSelected} readOnly disabled={isOver}
                        className="accent-blue-600 w-4 h-4 cursor-pointer" />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {isSelected && (
                          <span className="w-5 h-5 rounded flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                            style={{ backgroundColor: binColor(selectedList.findIndex((s) => orderCodeOf(s) === code) + 1) }}>
                            {selectedList.findIndex((s) => orderCodeOf(s) === code) + 1}
                          </span>
                        )}
                        <span className="font-mono text-xs font-bold text-slate-700">{code}</span>
                      </div>
                      {!!o.shippingOrderNo && <p className="font-mono text-xs text-slate-400 mt-0.5">{String(o.shippingOrderNo)}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 text-xs">{String(o.customerName ?? o.customerCode ?? "")}</td>
                    <td className="px-4 py-2.5 text-slate-600 text-xs">{String(o.consigneeName ?? "")}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-700">{String(o.totalQty ?? o.qty ?? "")}</td>
                    <td className="px-4 py-2.5 text-slate-400 text-xs">{String(o.orderDate ?? "")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredOrders.length > 200 && (
          <p className="text-xs text-slate-400 mt-2 text-right">Showing first 200 of {filteredOrders.length} orders</p>
        )}
      </div>
    </div>
  );
}
