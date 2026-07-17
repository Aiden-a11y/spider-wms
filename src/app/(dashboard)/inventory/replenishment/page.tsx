"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import {
  buildLocationOccupancyLookup,
  getLocationOccupancyInfo,
  classifyOccupancy,
  normalizeInventory,
} from "@/lib/wms";
import {
  ArrowDownToLine, RefreshCw, Loader2, AlertCircle, X, ChevronUp, ChevronDown,
} from "lucide-react";

interface ReplenItem {
  id: string;
  sku: string;
  name: string;
  locationCode: string;
  availQty: number;
  reason: "below_min_stock" | "required_for_order";
  ordersBlocked: number;
  custCode: string;
}

type SortKey = keyof ReplenItem;
type SortDir = "asc" | "desc";

const MIN_STOCK = 7;

export default function ReplenishmentPage() {
  const { user } = useAuth();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  const [warehouseCode, setWarehouseCode] = useState("STOO1");
  const [warehouses, setWarehouses] = useState<{ code: string; name: string }[]>([]);
  const [items, setItems] = useState<ReplenItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);
  const [scanStats, setScanStats] = useState<{ total: number; passed: number } | null>(null);

  // Column filters
  const [fSku, setFSku] = useState("");
  const [fName, setFName] = useState("");
  const [fLoc, setFLoc] = useState("");
  const [fQtyMax, setFQtyMax] = useState("");
  const [fReason, setFReason] = useState<"" | "below_min_stock" | "required_for_order">("");
  const [fOrders, setFOrders] = useState("");

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("reason");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    fetch("/api/wms/combo/warehouse", { headers })
      .then((r) => r.json())
      .then((j) => {
        const arr: Record<string, unknown>[] = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
        setWarehouses(arr.map((w) => ({ code: String(w.code ?? w.id ?? ""), name: String(w.name ?? w.code ?? "") })));
        const pref = arr.find((w) => String(w.code ?? "") === "STOO1") ?? arr[0];
        if (pref) setWarehouseCode(String(pref.code ?? "STOO1"));
      })
      .catch(() => {});
  }, []); // eslint-disable-line

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const result: ReplenItem[] = [];

    try {
      // ── 1. Occupancy map (paginated) ─────────────────────────────────
      const allLocList: Record<string, unknown>[] = [];
      for (let p = 1; ; p++) {
        const locRes = await fetch("/api/wms/warehouse/location/list", {
          method: "POST",
          headers,
          body: JSON.stringify({ page: p, pageSize: 500, warehouseCode }),
        });
        const locJson = await locRes.json().catch(() => ({}));
        const chunk: Record<string, unknown>[] =
          Array.isArray(locJson?.data?.list) ? locJson.data.list :
          Array.isArray(locJson?.data) ? locJson.data : [];
        allLocList.push(...chunk);
        const total = Number(locJson?.data?.total ?? locJson?.total ?? 0);
        if (chunk.length < 500 || (total > 0 && allLocList.length >= total)) break;
      }
      const occupancyMap = buildLocationOccupancyLookup(allLocList);

      const isShelf = (row: Record<string, unknown>) => {
        // 1) occupancyInfo directly on the inventory row
        const direct = String(row.occupancyInfo ?? row.locationType ?? row.locationTypeCode ?? "").trim();
        if (direct) return classifyOccupancy(direct) === "shelf";
        // 2) occupancyMap lookup
        const mapped = getLocationOccupancyInfo(occupancyMap, row);
        if (mapped) return classifyOccupancy(mapped) === "shelf";
        // 3) zone name fallback
        const zone = String(row.zoneName ?? row.zoneNm ?? row.zone ?? row.zoneCode ?? "").toLowerCase();
        if (zone) return zone.includes("shelf") || zone.includes("pick");
        // 4) unknown → include (don't silently drop)
        return true;
      };

      // ── 2. Below min stock: scan all inventory ───────────────────────
      const custRes = await fetch(
        `/api/wms/combo/customer-by-ordertype/B2C?warehouseCode=${encodeURIComponent(warehouseCode)}`,
        { headers }
      );
      const custJson = await custRes.json().catch(() => ({}));
      const customers: { code: string }[] = Array.isArray(custJson?.data)
        ? custJson.data.map((c: Record<string, unknown>) => ({ code: String(c.customerCode ?? c.code ?? "") }))
        : [];
      if (customers.length === 0) customers.push({ code: "" });

      const seenBelowMin = new Set<string>();
      let totalScanned = 0;
      let totalPassed = 0;
      for (const cust of customers) {
        let page = 1;
        while (true) {
          const r = await fetch("/api/wms/inventory/detail", {
            method: "POST",
            headers,
            body: JSON.stringify({ warehouseCode, customerCode: cust.code || undefined, pageNum: page, pageSize: 500 }),
          });
          if (!r.ok) break;
          const j = await r.json().catch(() => null);
          const list: Record<string, unknown>[] =
            Array.isArray(j?.data?.list) ? j.data.list :
            Array.isArray(j?.data) ? j.data :
            Array.isArray(j?.list) ? j.list :
            Array.isArray(j) ? j : [];
          if (list.length === 0) break;

          for (const row of list) {
            totalScanned++;
            if (!isShelf(row)) continue;
            const inv = normalizeInventory({ data: { list: [row] } })[0];
            if (!inv) continue;
            const availQty = inv.availableQty ?? inv.qty;
            if (availQty > MIN_STOCK) continue;
            totalPassed++;
            const id = `below__${inv.sku}__${inv.locationCode}`;
            if (seenBelowMin.has(id)) continue;
            seenBelowMin.add(id);
            result.push({
              id,
              sku: inv.sku,
              name: inv.productName,
              locationCode: inv.locationCode ?? "",
              availQty,
              reason: "below_min_stock",
              ordersBlocked: 0,
              custCode: inv.customerCode ?? cust.code,
            });
          }
          if (list.length < 500) break;
          page++;
        }
      }
      setScanStats({ total: totalScanned, passed: totalPassed });

      // ── 3. Required for today's orders: from cluster-check cache ─────
      const cacheRes = await fetch(
        `/api/cluster-check?warehouseCode=${encodeURIComponent(warehouseCode)}&all=1`
      );
      const cacheJson = await cacheRes.json().catch(() => null);
      if (cacheJson?.replenSkus) {
        for (const r of cacheJson.replenSkus as Array<{ sku: string; name: string; orderCount: number; location: string; custCode: string }>) {
          const id = `order__${r.sku}`;
          result.push({
            id,
            sku: r.sku,
            name: r.name,
            locationCode: r.location,
            availQty: 0,
            reason: "required_for_order",
            ordersBlocked: r.orderCount,
            custCode: r.custCode,
          });
        }
      }

      setItems(result);
      setLastLoaded(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load replenishment data");
    }
    setLoading(false);
  }, [warehouseCode, headers]);

  useEffect(() => { load(); }, [load]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  const filtered = useMemo(() => {
    let list = items;
    if (fSku) list = list.filter((i) => i.sku.toLowerCase().includes(fSku.toLowerCase()));
    if (fName) list = list.filter((i) => i.name.toLowerCase().includes(fName.toLowerCase()));
    if (fLoc) list = list.filter((i) => i.locationCode.toLowerCase().includes(fLoc.toLowerCase()));
    if (fQtyMax !== "") list = list.filter((i) => i.availQty <= Number(fQtyMax));
    if (fReason) list = list.filter((i) => i.reason === fReason);
    if (fOrders !== "") list = list.filter((i) => i.ordersBlocked >= Number(fOrders));
    return [...list].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      const cmp = typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [items, fSku, fName, fLoc, fQtyMax, fReason, fOrders, sortKey, sortDir]);

  const belowMinCount = items.filter((i) => i.reason === "below_min_stock").length;
  const orderCount = items.filter((i) => i.reason === "required_for_order").length;

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <ChevronUp className="w-3 h-3 text-slate-300 ml-0.5" />;
    return sortDir === "asc"
      ? <ChevronUp className="w-3 h-3 text-blue-500 ml-0.5" />
      : <ChevronDown className="w-3 h-3 text-blue-500 ml-0.5" />;
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center">
            <ArrowDownToLine className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Replenishment</h1>
            <p className="text-xs text-slate-400">
              {lastLoaded ? `Updated ${lastLoaded.toLocaleTimeString()}` : "Loading…"}
              {scanStats && !loading && (
                <span className="ml-2 text-slate-300">
                  · {scanStats.total.toLocaleString()} rows scanned · {scanStats.passed} ≤ {MIN_STOCK}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-2">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
              ↓ Below min stock: {belowMinCount}
            </span>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-700">
              ⚠ Required for order: {orderCount}
            </span>
          </div>
          <select
            value={warehouseCode}
            onChange={(e) => setWarehouseCode(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {warehouses.map((w) => <option key={w.code} value={w.code}>{w.name || w.code}</option>)}
            {warehouses.length === 0 && <option value="STOO1">STOO1</option>}
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl p-4 flex items-start gap-3 bg-red-50 border border-red-200">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading inventory data… this may take a moment</span>
        </div>
      )}

      {!loading && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              {/* Column headers with sort */}
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-4 py-3 text-left cursor-pointer select-none" onClick={() => toggleSort("sku")}>
                  <div className="flex items-center text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    SKU <SortIcon k="sku" />
                  </div>
                </th>
                <th className="px-4 py-3 text-left cursor-pointer select-none" onClick={() => toggleSort("name")}>
                  <div className="flex items-center text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Product <SortIcon k="name" />
                  </div>
                </th>
                <th className="px-4 py-3 text-left cursor-pointer select-none" onClick={() => toggleSort("locationCode")}>
                  <div className="flex items-center text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Location <SortIcon k="locationCode" />
                  </div>
                </th>
                <th className="px-4 py-3 text-right cursor-pointer select-none w-24" onClick={() => toggleSort("availQty")}>
                  <div className="flex items-center justify-end text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Avail Qty <SortIcon k="availQty" />
                  </div>
                </th>
                <th className="px-4 py-3 text-center cursor-pointer select-none w-52" onClick={() => toggleSort("reason")}>
                  <div className="flex items-center justify-center text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Reason <SortIcon k="reason" />
                  </div>
                </th>
                <th className="px-4 py-3 text-center cursor-pointer select-none w-28" onClick={() => toggleSort("ordersBlocked")}>
                  <div className="flex items-center justify-center text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Orders Blocked <SortIcon k="ordersBlocked" />
                  </div>
                </th>
              </tr>

              {/* Filter row */}
              <tr className="bg-white border-b border-slate-100">
                <th className="px-3 py-1.5">
                  <div className="relative">
                    <input
                      value={fSku} onChange={(e) => setFSku(e.target.value)}
                      placeholder="Filter SKU…"
                      className="w-full border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400 font-normal"
                    />
                    {fSku && <button onClick={() => setFSku("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"><X className="w-3 h-3" /></button>}
                  </div>
                </th>
                <th className="px-3 py-1.5">
                  <div className="relative">
                    <input
                      value={fName} onChange={(e) => setFName(e.target.value)}
                      placeholder="Filter product…"
                      className="w-full border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400 font-normal"
                    />
                    {fName && <button onClick={() => setFName("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"><X className="w-3 h-3" /></button>}
                  </div>
                </th>
                <th className="px-3 py-1.5">
                  <div className="relative">
                    <input
                      value={fLoc} onChange={(e) => setFLoc(e.target.value)}
                      placeholder="Filter location…"
                      className="w-full border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400 font-normal"
                    />
                    {fLoc && <button onClick={() => setFLoc("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"><X className="w-3 h-3" /></button>}
                  </div>
                </th>
                <th className="px-3 py-1.5">
                  <input
                    value={fQtyMax} onChange={(e) => setFQtyMax(e.target.value)}
                    placeholder="≤"
                    type="number" min={0}
                    className="w-full border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400 font-normal text-right"
                  />
                </th>
                <th className="px-3 py-1.5">
                  <select
                    value={fReason} onChange={(e) => setFReason(e.target.value as typeof fReason)}
                    className="w-full border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400 font-normal"
                  >
                    <option value="">All reasons</option>
                    <option value="below_min_stock">Below Min Stock</option>
                    <option value="required_for_order">Required for Order</option>
                  </select>
                </th>
                <th className="px-3 py-1.5">
                  <input
                    value={fOrders} onChange={(e) => setFOrders(e.target.value)}
                    placeholder="≥"
                    type="number" min={0}
                    className="w-full border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400 font-normal text-right"
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-400 text-sm">
                    {items.length === 0 ? "No replenishment items found" : "No items match filters"}
                  </td>
                </tr>
              )}
              {filtered.map((item) => (
                <tr key={item.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs font-bold text-slate-700">{item.sku}</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 text-xs max-w-[260px]">
                    <span className="truncate block">{item.name || "—"}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs font-semibold text-blue-700">{item.locationCode || "—"}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {item.reason === "below_min_stock" ? (
                      <span className={`inline-block font-bold tabular-nums text-sm ${item.availQty === 0 ? "text-red-600" : item.availQty <= 3 ? "text-orange-600" : "text-amber-600"}`}>
                        {item.availQty}
                      </span>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {item.reason === "below_min_stock" ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 whitespace-nowrap">
                        ↓ Below Min Stock
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-700 whitespace-nowrap">
                        ⚠ Required for Today&apos;s Order
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {item.ordersBlocked > 0 ? (
                      <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-600">
                        {item.ordersBlocked}
                      </span>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 0 && (
            <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 text-xs text-slate-400 text-right">
              {filtered.length} items{items.length !== filtered.length ? ` (filtered from ${items.length})` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
