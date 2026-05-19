"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { normalizeInventory } from "@/lib/wms";
import { RefreshCw, AlertTriangle, Search, Download, ChevronDown, ChevronUp } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ConflictItem = {
  customerCode: string;
  sku: string;
  productName: string;
  lot: string;
  expireDate: string;
  qty: number;
  availableQty: number | null;
  locationCode: string;
};

type ConflictGroup = {
  location: string;
  customers: string[];
  itemCount: number;
  totalQty: number;
  items: ConflictItem[];
};

const BADGE_COLORS = [
  "bg-blue-100 text-blue-800 border-blue-200",
  "bg-purple-100 text-purple-800 border-purple-200",
  "bg-amber-100 text-amber-800 border-amber-200",
  "bg-rose-100 text-rose-800 border-rose-200",
  "bg-teal-100 text-teal-800 border-teal-200",
  "bg-orange-100 text-orange-800 border-orange-200",
];

const BATCH_SIZE   = 5;
const BATCH_DELAY  = 400;
const SKU_DELAY    = 300;
const CACHE_TTL    = 10 * 60 * 1000; // 10 min

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
  const [progress,      setProgress]      = useState<{ total: number; loaded: number } | null>(null);
  const [error,         setError]         = useState("");
  const [conflicts,     setConflicts]     = useState<ConflictGroup[]>([]);
  const [search,        setSearch]        = useState("");
  const [expanded,      setExpanded]      = useState<Set<string>>(new Set());

  // Load warehouses on mount
  useEffect(() => {
    fetch("/api/wms/combo/warehouse", { headers })
      .then((r) => r.json())
      .then((json) => {
        const arr: Record<string, unknown>[] =
          Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
        const list = arr
          .map((w) => ({ id: String(w.code ?? w.id ?? ""), name: String(w.name ?? w.code ?? "") }))
          .filter((w) => w.id);
        setWarehouses(list);
        const pref = list.find((w) => w.id === "STOO1") ?? list[0];
        if (pref) setWarehouseCode(pref.id);
      })
      .catch(() => {});
  }, []); // eslint-disable-line

  async function analyze(whCode = warehouseCode) {
    if (!whCode) return;
    setLoading(true);
    setError("");
    setConflicts([]);
    setExpanded(new Set());
    setProgress(null);

    try {
      // 1. Get all customers for this warehouse
      const custRes  = await fetch(`/api/wms/combo/customer-by-warehouse/${whCode}`, { headers });
      const custJson = await custRes.json();
      const custArr: Record<string, unknown>[] =
        Array.isArray(custJson?.data) ? custJson.data : Array.isArray(custJson) ? custJson : [];
      const customers = custArr
        .map((c) => ({
          code: String(c.code ?? c.customerCode ?? c.id ?? ""),
          name: String(c.name ?? c.customerName ?? c.code ?? ""),
        }))
        .filter((c) => c.code);

      if (customers.length === 0) throw new Error("No customers found for this warehouse.");

      // 2. Collect all (customerCode, sku) pairs — with session cache
      const pairs: { custCode: string; sku: string }[] = [];

      for (const cust of customers) {
        const cacheKey = `sku_cache__${whCode}__${cust.code}`;
        let skus: string[] | null = null;
        try {
          const cached = JSON.parse(sessionStorage.getItem(cacheKey) ?? "null");
          if (cached && Date.now() - cached.ts < CACHE_TTL) skus = cached.skus;
        } catch { /* ignore */ }

        if (!skus) {
          skus = [];
          let page = 1;
          while (true) {
            const res  = await fetch("/api/wms/product/list", {
              method: "POST", headers,
              body: JSON.stringify({ warehouseCode: whCode, customerCode: cust.code, pageNum: page, pageSize: 500 }),
            });
            const json = await res.json();
            const list: Record<string, unknown>[] = json?.data?.list ?? [];
            const pageSkus = list.map((p) => String(p.productSku ?? "")).filter(Boolean);
            skus.push(...pageSkus);
            if (pageSkus.length < 500) break;
            page++;
            await new Promise((r) => setTimeout(r, SKU_DELAY));
          }
          try { sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), skus })); } catch { /* ignore */ }
        }

        skus.forEach((sku) => pairs.push({ custCode: cust.code, sku }));
      }

      if (pairs.length === 0) throw new Error("No products registered for this warehouse.");

      setProgress({ total: pairs.length, loaded: 0 });

      // 3. Fetch inventory/detail in batches of 5
      const allItems: ConflictItem[] = [];
      let loaded = 0;

      for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
        const batch = pairs.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(({ custCode, sku }) =>
            fetch("/api/wms/inventory/detail", {
              method: "POST", headers,
              body: JSON.stringify({ warehouseCode: whCode, customerCode: custCode, productSku: sku }),
            })
              .then((r) => r.json())
              .then((j) => {
                const rows = normalizeInventory(j);
                return rows.map((item) => ({
                  customerCode: item.customerCode || custCode,
                  sku:          item.sku ?? sku,
                  productName:  item.productName ?? "",
                  lot:          item.lot ?? "",
                  expireDate:   item.expireDate ?? "",
                  qty:          item.qty ?? 0,
                  availableQty: item.availableQty ?? null,
                  locationCode: item.locationCode ?? "",
                }));
              })
              .catch(() => [])
          )
        );
        for (const rows of results) {
          allItems.push(...rows);
          loaded++;
          setProgress({ total: pairs.length, loaded });
        }
        if (i + BATCH_SIZE < pairs.length) {
          await new Promise((r) => setTimeout(r, BATCH_DELAY));
        }
      }

      if (allItems.length === 0) throw new Error("No inventory found.");

      // 4. Group by locationCode, find locations with 2+ distinct customers
      const locMap = new Map<string, ConflictItem[]>();
      for (const item of allItems) {
        if (!item.locationCode) continue;
        const arr = locMap.get(item.locationCode) ?? [];
        arr.push(item);
        locMap.set(item.locationCode, arr);
      }

      const found: ConflictGroup[] = [];
      locMap.forEach((items, location) => {
        const custSet = new Set(items.map((i) => i.customerCode));
        if (custSet.size < 2) return;
        found.push({
          location,
          customers: Array.from(custSet),
          itemCount: items.length,
          totalQty:  items.reduce((s, i) => s + i.qty, 0),
          items,
        });
      });

      found.sort((a, b) => b.customers.length - a.customers.length || a.location.localeCompare(b.location));
      setConflicts(found);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  useEffect(() => {
    if (warehouseCode) analyze(warehouseCode);
  }, [warehouseCode]); // eslint-disable-line

  const filtered = useMemo(() => {
    if (!search.trim()) return conflicts;
    const q = search.toLowerCase();
    return conflicts.filter(
      (g) =>
        g.location.toLowerCase().includes(q) ||
        g.customers.some((c) => c.toLowerCase().includes(q)) ||
        g.items.some(
          (i) =>
            i.sku.toLowerCase().includes(q) ||
            i.productName.toLowerCase().includes(q)
        )
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
      ["Location", "Customer", "SKU", "Product", "Lot", "Expire", "Qty", "Available Qty"],
    ];
    for (const g of filtered) {
      for (const item of g.items) {
        rows.push([
          g.location, item.customerCode, item.sku,
          item.productName, item.lot, item.expireDate,
          String(item.qty),
          item.availableQty != null ? String(item.availableQty) : "",
        ]);
      }
    }
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `location-conflicts-${warehouseCode}.csv`;
    a.click();
  }

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

      {/* Summary stats */}
      {!loading && conflicts.length > 0 && (
        <div className="flex gap-4 flex-wrap">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 flex flex-col">
            <span className="text-2xl font-bold text-amber-700">{conflicts.length}</span>
            <span className="text-xs text-amber-600">Conflict Locations</span>
          </div>
          <div className="bg-rose-50 border border-rose-200 rounded-xl px-5 py-3 flex flex-col">
            <span className="text-2xl font-bold text-rose-700">
              {conflicts.reduce((s, g) => s + g.itemCount, 0).toLocaleString()}
            </span>
            <span className="text-xs text-rose-600">Affected Rows</span>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-5 py-3 flex flex-col">
            <span className="text-2xl font-bold text-slate-700">
              {Array.from(new Set(conflicts.flatMap((g) => g.customers))).length}
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

      {/* Loading */}
      {loading && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-4">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-400 mx-auto" />
          {progress ? (
            <>
              <p className="text-sm text-slate-600 font-medium">
                Fetching inventory… {progress.loaded} / {progress.total} SKUs
              </p>
              <div className="w-full max-w-xs mx-auto bg-slate-100 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.round((progress.loaded / progress.total) * 100)}%` }}
                />
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">Fetching SKU list…</p>
          )}
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
            const isExpanded = expanded.has(group.location);
            return (
              <div key={group.location} className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
                <button
                  onClick={() => toggleExpand(group.location)}
                  className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-amber-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono font-bold text-slate-900 text-sm">
                      {group.location || "—"}
                    </span>
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
                      {group.itemCount} rows · qty {group.totalQty.toLocaleString()}
                    </span>
                    {isExpanded
                      ? <ChevronUp className="w-4 h-4 text-slate-400" />
                      : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-amber-100 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-amber-50">
                          {["Customer", "SKU", "Product", "Lot", "Expire", "Qty", "Avail."].map((h) => (
                            <th key={h} className={`px-4 py-2 text-slate-500 font-semibold uppercase tracking-wide ${h === "Qty" || h === "Avail." ? "text-right" : "text-left"}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((item, idx) => {
                          const custIdx = group.customers.indexOf(item.customerCode);
                          const badge = BADGE_COLORS[Math.max(0, custIdx) % BADGE_COLORS.length];
                          return (
                            <tr key={idx} className="border-t border-slate-100 hover:bg-slate-50">
                              <td className="px-4 py-2">
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${badge}`}>
                                  {item.customerCode}
                                </span>
                              </td>
                              <td className="px-4 py-2 font-mono text-slate-700">{item.sku || "—"}</td>
                              <td className="px-4 py-2 text-slate-600 max-w-[200px] truncate" title={item.productName}>
                                {item.productName || "—"}
                              </td>
                              <td className="px-4 py-2 text-slate-500 font-mono">{item.lot || "—"}</td>
                              <td className="px-4 py-2 text-slate-500">{item.expireDate || "—"}</td>
                              <td className="px-4 py-2 text-right font-semibold text-slate-800">{item.qty.toLocaleString()}</td>
                              <td className="px-4 py-2 text-right text-slate-500">
                                {item.availableQty != null ? item.availableQty.toLocaleString() : "—"}
                              </td>
                            </tr>
                          );
                        })}
                        {/* Per-customer subtotals */}
                        {group.customers.map((cust, i) => {
                          const custQty = group.items.filter((it) => it.customerCode === cust).reduce((s, it) => s + it.qty, 0);
                          return (
                            <tr key={`sub-${cust}`} className="border-t border-dashed border-slate-200 bg-slate-50">
                              <td className="px-4 py-1.5 font-semibold text-slate-600" colSpan={5}>
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${BADGE_COLORS[i % BADGE_COLORS.length]}`}>{cust}</span>
                                <span className="ml-2 text-slate-400">subtotal</span>
                              </td>
                              <td className="px-4 py-1.5 text-right font-bold text-slate-800">{custQty.toLocaleString()}</td>
                              <td />
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
