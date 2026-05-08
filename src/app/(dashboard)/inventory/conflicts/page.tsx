"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { normalizeInventory, type InventoryItem } from "@/lib/wms";
import { RefreshCw, AlertTriangle, Search, Download, ChevronDown, ChevronUp } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ConflictGroup = {
  locationCode: string;
  zone: string;
  aisle: string;
  bay: string;
  level: string;
  position: string;
  customers: string[];          // distinct customer codes at this location
  items: InventoryItem[];       // all items at this location
  totalQty: number;
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LocationConflictsPage() {
  const { user } = useAuth();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  const [warehouseCode, setWarehouseCode] = useState("");
  const [warehouses,    setWarehouses]    = useState<{ id: string; name: string }[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState("");
  const [conflicts,     setConflicts]     = useState<ConflictGroup[]>([]);
  const [search,        setSearch]        = useState("");
  const [expanded,      setExpanded]      = useState<Set<string>>(new Set());

  // Load warehouses on mount
  useEffect(() => {
    fetch("/api/wms/combo/warehouse", { headers })
      .then((r) => r.json())
      .then((json) => {
        const arr: Record<string, unknown>[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
        const list = arr.map((w) => ({
          id:   String(w.code ?? w.id ?? ""),
          name: String(w.name ?? w.code ?? ""),
        })).filter((w) => w.id);
        setWarehouses(list);
        const pref = list.find((w) => w.id === "STOO1") ?? list[0];
        if (pref) { setWarehouseCode(pref.id); }
      })
      .catch(() => {});
  }, []); // eslint-disable-line

  // Run conflict analysis
  async function analyze(whCode = warehouseCode) {
    if (!whCode) return;
    setLoading(true);
    setError("");
    setConflicts([]);
    setExpanded(new Set());

    try {
      // 1. Get all customers for this warehouse
      const custRes  = await fetch(`/api/wms/combo/customer-by-warehouse/${whCode}`, { headers });
      const custJson = await custRes.json();
      const custArr: Record<string, unknown>[] =
        Array.isArray(custJson?.data) ? custJson.data : Array.isArray(custJson) ? custJson : [];
      const customers = custArr.map((c) => ({
        code: String(c.code ?? c.customerCode ?? ""),
        name: String(c.name ?? c.customerName ?? c.code ?? ""),
      })).filter((c) => c.code);

      if (customers.length === 0) throw new Error("No customers found for this warehouse.");

      // 2. Fetch inventory for ALL customers in parallel
      const allItems: InventoryItem[] = [];
      const results = await Promise.allSettled(
        customers.map((cust) =>
          fetch("/api/wms/inventory/detail", {
            method: "POST", headers,
            body: JSON.stringify({ warehouseCode: whCode, customerCode: cust.code, pageSize: 9999 }),
          })
            .then((r) => r.json())
            .then((json) => {
              const items = normalizeInventory(json);
              // tag customerCode in case the API response doesn't include it
              return items.map((item) => ({
                ...item,
                customerCode: item.customerCode || cust.code,
              }));
            })
        )
      );

      for (const result of results) {
        if (result.status === "fulfilled") allItems.push(...result.value);
      }

      if (allItems.length === 0) throw new Error("No inventory data returned.");

      // 3. Group by locationCode, find locations with >1 distinct customer
      const locMap = new Map<string, InventoryItem[]>();
      for (const item of allItems) {
        const key = item.locationCode ?? "";
        if (!key) continue;
        const arr = locMap.get(key) ?? [];
        arr.push(item);
        locMap.set(key, arr);
      }

      const found: ConflictGroup[] = [];
      locMap.forEach((items, loc) => {
        const custSet: Record<string, boolean> = {};
        items.forEach((i) => { if (i.customerCode) custSet[i.customerCode] = true; });
        const distinctCustomers = Object.keys(custSet);
        if (distinctCustomers.length < 2) return; // no conflict
        const sample = items[0];
        found.push({
          locationCode: loc,
          zone:     sample.zone     ?? "",
          aisle:    sample.aisle    ?? "",
          bay:      sample.bay      ?? "",
          level:    sample.level    ?? "",
          position: sample.position ?? "",
          customers: distinctCustomers,
          items,
          totalQty: items.reduce((s, i) => s + i.qty, 0),
        });
      });

      // Sort: most customers first, then by location code
      found.sort((a, b) => b.customers.length - a.customers.length || a.locationCode.localeCompare(b.locationCode));
      setConflicts(found);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }

  // Run analysis when warehouse is first set
  useEffect(() => {
    if (warehouseCode) analyze(warehouseCode);
  }, [warehouseCode]); // eslint-disable-line

  const filtered = useMemo(() => {
    if (!search.trim()) return conflicts;
    const q = search.toLowerCase();
    return conflicts.filter((g) =>
      g.locationCode.toLowerCase().includes(q) ||
      g.customers.some((c) => c.toLowerCase().includes(q)) ||
      g.items.some((i) => (i.sku ?? "").toLowerCase().includes(q) || (i.productName ?? "").toLowerCase().includes(q))
    );
  }, [conflicts, search]);

  function toggleExpand(loc: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(loc) ? next.delete(loc) : next.add(loc);
      return next;
    });
  }

  function exportCSV() {
    const rows: string[][] = [
      ["Location", "Zone", "Aisle", "Bay", "Level", "Position", "Customer", "SKU", "Product", "Lot", "Expire", "Qty"],
    ];
    for (const g of filtered) {
      for (const item of g.items) {
        rows.push([
          g.locationCode, g.zone, g.aisle, g.bay, g.level, g.position,
          item.customerCode ?? "",
          item.sku ?? "",
          item.productName ?? "",
          item.lot ?? "",
          item.expireDate ?? "",
          String(item.qty),
        ]);
      }
    }
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `location-conflicts-${warehouseCode}.csv`; a.click();
  }

  // Customer badge colors (cycle through a palette)
  const BADGE_COLORS = [
    "bg-blue-100 text-blue-800 border-blue-200",
    "bg-purple-100 text-purple-800 border-purple-200",
    "bg-amber-100 text-amber-800 border-amber-200",
    "bg-rose-100 text-rose-800 border-rose-200",
    "bg-teal-100 text-teal-800 border-teal-200",
    "bg-orange-100 text-orange-800 border-orange-200",
  ];

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Location Conflicts
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Locations shared by multiple customers — potential inventory mix-up risk
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Warehouse selector */}
          <select
            value={warehouseCode}
            onChange={(e) => { setWarehouseCode(e.target.value); analyze(e.target.value); }}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>

          <button
            onClick={() => analyze()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Analyzing…" : "Refresh"}
          </button>

          {filtered.length > 0 && (
            <button
              onClick={exportCSV}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Summary bar */}
      {!loading && conflicts.length > 0 && (
        <div className="flex gap-4 flex-wrap">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 flex flex-col">
            <span className="text-2xl font-bold text-amber-700">{conflicts.length}</span>
            <span className="text-xs text-amber-600">Conflict Locations</span>
          </div>
          <div className="bg-rose-50 border border-rose-200 rounded-xl px-5 py-3 flex flex-col">
            <span className="text-2xl font-bold text-rose-700">
              {conflicts.reduce((s, g) => s + g.items.length, 0)}
            </span>
            <span className="text-xs text-rose-600">Affected Items</span>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-5 py-3 flex flex-col">
            <span className="text-2xl font-bold text-slate-700">
              {Object.keys(conflicts.flatMap((g) => g.customers).reduce((a: Record<string,boolean>, c) => { a[c]=true; return a; }, {})).length}
            </span>
            <span className="text-xs text-slate-500">Customers Involved</span>
          </div>
        </div>
      )}

      {/* Search */}
      {conflicts.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search location, customer, SKU…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-400 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Fetching inventory across all customers…</p>
        </div>
      )}

      {/* No conflicts */}
      {!loading && !error && conflicts.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <AlertTriangle className="w-6 h-6 text-green-600" />
          </div>
          <p className="font-semibold text-slate-800">No location conflicts found</p>
          <p className="text-sm text-slate-500 mt-1">All locations contain items from a single customer.</p>
        </div>
      )}

      {/* Conflict list */}
      {!loading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((group) => {
            const isExpanded = expanded.has(group.locationCode);
            // Group items by customer within this location
            const byCustomer = new Map<string, InventoryItem[]>();
            for (const item of group.items) {
              const c = item.customerCode ?? "Unknown";
              const arr = byCustomer.get(c) ?? [];
              arr.push(item);
              byCustomer.set(c, arr);
            }

            return (
              <div key={group.locationCode} className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
                {/* Location header row */}
                <button
                  onClick={() => toggleExpand(group.locationCode)}
                  className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-amber-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Location code */}
                    <span className="font-mono font-bold text-slate-900 text-sm">
                      {group.locationCode || "—"}
                    </span>
                    {/* Location parts */}
                    {[group.zone, group.aisle, group.bay, group.level, group.position].filter(Boolean).length > 0 && (
                      <span className="text-xs text-slate-400">
                        {[group.zone, group.aisle, group.bay, group.level, group.position].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    {/* Customer badges */}
                    <div className="flex gap-1.5 flex-wrap">
                      {group.customers.map((c, i) => (
                        <span
                          key={c}
                          className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${BADGE_COLORS[i % BADGE_COLORS.length]}`}
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0 ml-4">
                    <span className="text-xs text-slate-500">
                      {group.items.length} items · qty {group.totalQty.toLocaleString()}
                    </span>
                    {isExpanded
                      ? <ChevronUp className="w-4 h-4 text-slate-400" />
                      : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </div>
                </button>

                {/* Expanded detail table */}
                {isExpanded && (
                  <div className="border-t border-amber-100 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-amber-50">
                          <th className="px-4 py-2 text-left text-slate-500 font-semibold uppercase tracking-wide">Customer</th>
                          <th className="px-4 py-2 text-left text-slate-500 font-semibold uppercase tracking-wide">SKU</th>
                          <th className="px-4 py-2 text-left text-slate-500 font-semibold uppercase tracking-wide">Product</th>
                          <th className="px-4 py-2 text-left text-slate-500 font-semibold uppercase tracking-wide">Lot</th>
                          <th className="px-4 py-2 text-left text-slate-500 font-semibold uppercase tracking-wide">Expire</th>
                          <th className="px-4 py-2 text-right text-slate-500 font-semibold uppercase tracking-wide">Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((item, idx) => {
                          const custIdx = group.customers.indexOf(item.customerCode ?? "");
                          const badgeColor = BADGE_COLORS[Math.max(0, custIdx) % BADGE_COLORS.length];
                          return (
                            <tr key={idx} className="border-t border-slate-100 hover:bg-slate-50">
                              <td className="px-4 py-2">
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${badgeColor}`}>
                                  {item.customerCode ?? "—"}
                                </span>
                              </td>
                              <td className="px-4 py-2 font-mono text-slate-700">{item.sku || "—"}</td>
                              <td className="px-4 py-2 text-slate-600 max-w-[220px] truncate" title={item.productName}>
                                {item.productName || "—"}
                              </td>
                              <td className="px-4 py-2 text-slate-500 font-mono">{item.lot || "—"}</td>
                              <td className="px-4 py-2 text-slate-500">{item.expireDate || "—"}</td>
                              <td className="px-4 py-2 text-right font-semibold text-slate-800">{item.qty.toLocaleString()}</td>
                            </tr>
                          );
                        })}
                        {/* Per-location subtotal per customer */}
                        {group.customers.map((cust, i) => {
                          const custItems = group.items.filter((it) => it.customerCode === cust);
                          const custQty   = custItems.reduce((s, it) => s + it.qty, 0);
                          return (
                            <tr key={`sub-${cust}`} className={`border-t border-dashed border-slate-200 ${BADGE_COLORS[i % BADGE_COLORS.length].split(" ")[0]} bg-opacity-30`}>
                              <td className="px-4 py-1.5 font-semibold text-slate-600" colSpan={5}>
                                {cust} subtotal
                              </td>
                              <td className="px-4 py-1.5 text-right font-bold text-slate-800">{custQty.toLocaleString()}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
