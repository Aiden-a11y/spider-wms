"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { normalizeInventory } from "@/lib/wms";
import { RefreshCw, AlertTriangle, Search, Download } from "lucide-react";

type ConflictRow = {
  location:     string;
  customerCode: string;
  sku:          string;
  productName:  string;
  lot:          string;
  expireDate:   string;
  qty:          number;
  availableQty: number | null;
};

type ConflictGroup = {
  location:  string;
  customers: string[];
  rows:      ConflictRow[];
  totalQty:  number;
};

const BADGE_COLORS = [
  "bg-blue-100 text-blue-800 border-blue-200",
  "bg-purple-100 text-purple-800 border-purple-200",
  "bg-amber-100 text-amber-800 border-amber-200",
  "bg-rose-100 text-rose-800 border-rose-200",
  "bg-teal-100 text-teal-800 border-teal-200",
  "bg-orange-100 text-orange-800 border-orange-200",
];

const CACHE_TTL   = 10 * 60 * 1000;
const BATCH_SIZE  = 5;
const BATCH_DELAY = 400;
const SKU_DELAY   = 300;

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
    setProgress(null);

    try {
      // 1. Customers
      const custJson = await fetch(`/api/wms/combo/customer-by-warehouse/${whCode}`, { headers }).then((r) => r.json());
      const custArr: Record<string, unknown>[] =
        Array.isArray(custJson?.data) ? custJson.data : Array.isArray(custJson) ? custJson : [];
      const customers = custArr
        .map((c) => ({ code: String(c.code ?? c.customerCode ?? c.id ?? "") }))
        .filter((c) => c.code);

      if (customers.length === 0) throw new Error("No customers found for this warehouse.");

      // 2. SKU pairs (with session cache)
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
            const j = await fetch("/api/wms/product/list", {
              method: "POST", headers,
              body: JSON.stringify({ warehouseCode: whCode, customerCode: cust.code, pageNum: page, pageSize: 500 }),
            }).then((r) => r.json());
            const list: Record<string, unknown>[] = j?.data?.list ?? [];
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

      if (pairs.length === 0) throw new Error("No products registered.");
      setProgress({ total: pairs.length, loaded: 0 });

      // 3. Fetch inventory/detail
      const allRows: ConflictRow[] = [];
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
              .then((j) =>
                normalizeInventory(j).map((item) => ({
                  location:     item.locationCode ?? "",
                  customerCode: item.customerCode || custCode,
                  sku:          item.sku ?? sku,
                  productName:  item.productName ?? "",
                  lot:          item.lot ?? "",
                  expireDate:   item.expireDate ?? "",
                  qty:          item.qty ?? 0,
                  availableQty: item.availableQty ?? null,
                }))
              )
              .catch(() => [] as ConflictRow[])
          )
        );
        for (const rows of results) { allRows.push(...rows); loaded++; }
        setProgress({ total: pairs.length, loaded });
        if (i + BATCH_SIZE < pairs.length) await new Promise((r) => setTimeout(r, BATCH_DELAY));
      }

      // 4. Group by location → keep only locations with 2+ customers
      const locMap = new Map<string, ConflictRow[]>();
      for (const row of allRows) {
        if (!row.location) continue;
        const arr = locMap.get(row.location) ?? [];
        arr.push(row);
        locMap.set(row.location, arr);
      }

      const found: ConflictGroup[] = [];
      locMap.forEach((rows, location) => {
        const custSet = Array.from(new Set(rows.map((r) => r.customerCode)));
        if (custSet.length < 2) return;
        found.push({
          location,
          customers: custSet,
          rows,
          totalQty: rows.reduce((s, r) => s + r.qty, 0),
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

  useEffect(() => { if (warehouseCode) analyze(warehouseCode); }, [warehouseCode]); // eslint-disable-line

  const filtered = useMemo(() => {
    if (!search.trim()) return conflicts;
    const q = search.toLowerCase();
    return conflicts.filter(
      (g) =>
        g.location.toLowerCase().includes(q) ||
        g.customers.some((c) => c.toLowerCase().includes(q)) ||
        g.rows.some((r) => r.sku.toLowerCase().includes(q) || r.productName.toLowerCase().includes(q))
    );
  }, [conflicts, search]);

  function exportCSV() {
    const rows = [["Location", "Customer", "SKU", "Product", "Lot", "Expire", "Qty", "Avail."]];
    for (const g of filtered)
      for (const r of g.rows)
        rows.push([g.location, r.customerCode, r.sku, r.productName, r.lot, r.expireDate, String(r.qty), r.availableQty != null ? String(r.availableQty) : ""]);
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `conflicts-${warehouseCode}.csv`;
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
        <div className="flex items-center gap-2">
          <select
            value={warehouseCode}
            onChange={(e) => { setWarehouseCode(e.target.value); analyze(e.target.value); }}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
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
            <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors">
              <Download className="w-4 h-4" /> Export CSV
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {/* Summary stats */}
      {!loading && conflicts.length > 0 && (
        <div className="flex gap-4 flex-wrap">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3">
            <div className="text-2xl font-bold text-amber-700">{conflicts.length}</div>
            <div className="text-xs text-amber-600">Conflict Locations</div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-5 py-3">
            <div className="text-2xl font-bold text-slate-700">
              {Array.from(new Set(conflicts.flatMap((g) => g.customers))).length}
            </div>
            <div className="text-xs text-slate-500">Customers Involved</div>
          </div>
        </div>
      )}

      {/* Search */}
      {conflicts.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
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
                <div className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.round((progress.loaded / progress.total) * 100)}%` }} />
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

      {/* Conflict table — one block per location, rows always visible */}
      {!loading && filtered.length > 0 && (
        <div className="space-y-4">
          {filtered.map((group) => (
            <div key={group.location} className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
              {/* Location header */}
              <div className="flex items-center gap-3 px-5 py-3 bg-amber-50 border-b border-amber-200 flex-wrap">
                <span className="font-mono font-bold text-slate-900">{group.location}</span>
                {group.customers.map((c, i) => (
                  <span key={c} className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${BADGE_COLORS[i % BADGE_COLORS.length]}`}>
                    {c}
                  </span>
                ))}
                <span className="ml-auto text-xs text-slate-500">Total qty: {group.totalQty.toLocaleString()}</span>
              </div>

              {/* Rows table */}
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-4 py-2 text-left text-slate-400 font-medium uppercase tracking-wide">Customer</th>
                    <th className="px-4 py-2 text-left text-slate-400 font-medium uppercase tracking-wide">SKU</th>
                    <th className="px-4 py-2 text-left text-slate-400 font-medium uppercase tracking-wide">Product</th>
                    <th className="px-4 py-2 text-left text-slate-400 font-medium uppercase tracking-wide">Lot</th>
                    <th className="px-4 py-2 text-left text-slate-400 font-medium uppercase tracking-wide">Expire</th>
                    <th className="px-4 py-2 text-right text-slate-400 font-medium uppercase tracking-wide">Qty</th>
                    <th className="px-4 py-2 text-right text-slate-400 font-medium uppercase tracking-wide">Avail.</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row, idx) => {
                    const custIdx = group.customers.indexOf(row.customerCode);
                    const badge = BADGE_COLORS[Math.max(0, custIdx) % BADGE_COLORS.length];
                    return (
                      <tr key={idx} className={`border-t border-slate-100 ${idx % 2 === 1 ? "bg-slate-50" : ""}`}>
                        <td className="px-4 py-2">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${badge}`}>
                            {row.customerCode}
                          </span>
                        </td>
                        <td className="px-4 py-2 font-mono text-slate-700">{row.sku || "—"}</td>
                        <td className="px-4 py-2 text-slate-600 max-w-[200px] truncate" title={row.productName}>{row.productName || "—"}</td>
                        <td className="px-4 py-2 text-slate-500 font-mono">{row.lot || "—"}</td>
                        <td className="px-4 py-2 text-slate-500">{row.expireDate || "—"}</td>
                        <td className="px-4 py-2 text-right font-semibold text-slate-800">{row.qty.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right text-slate-500">{row.availableQty != null ? row.availableQty.toLocaleString() : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
