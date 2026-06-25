"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import {
  Layers, RefreshCw, Loader2, ChevronDown, ChevronUp, Search,
  Package, Calendar, Warehouse, Users, CheckCircle2, Clock, AlertCircle,
} from "lucide-react";

type WmsBatch = Record<string, unknown>;
type WmsOrder = Record<string, unknown>;

function statusBadge(status: string) {
  const s = status.toUpperCase();
  if (s === "AA" || s.includes("REQUEST") || s.includes("OUTBOUND")) {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200"><Clock className="w-3 h-3" />Out-Bound Request</span>;
  }
  if (s === "BB" || s.includes("PICKING") || s.includes("PROGRESS")) {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200"><Loader2 className="w-3 h-3" />In Progress</span>;
  }
  if (s === "DA" || s.includes("COMPLETE") || s.includes("DONE")) {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200"><CheckCircle2 className="w-3 h-3" />Complete</span>;
  }
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">{status}</span>;
}

export default function BatchTestPage() {
  const { user } = useAuth();
  const router = useRouter();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  useEffect(() => {
    if (!user) router.replace("/");
  }, [user, router]);

  // ── State ─────────────────────────────────────────────────────────────────
  const [batches, setBatches] = useState<WmsBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rawResponse, setRawResponse] = useState<unknown>(null);

  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Record<string, WmsOrder[]>>({});
  const [loadingOrders, setLoadingOrders] = useState<Record<string, boolean>>({});
  const [ordersRaw, setOrdersRaw] = useState<Record<string, unknown>>({});

  const [warehouseCode, setWarehouseCode] = useState("STOO1");
  const [customerCode, setCustomerCode] = useState("FCOUS");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  // ── Load batch list ───────────────────────────────────────────────────────
  const loadBatches = useCallback(async () => {
    setLoading(true);
    setError("");
    setRawResponse(null);
    setBatches([]);
    try {
      const params = new URLSearchParams({
        warehouseCode,
        ...(customerCode ? { customerCode } : {}),
        ...(dateFrom ? { startDate: dateFrom.replace(/-/g, "") } : {}),
        ...(dateTo   ? { endDate:   dateTo.replace(/-/g, "")   } : {}),
      });
      const res = await fetch(`/api/wms/dashboard/sidebar-batch?${params}`, { headers });
      const json = await res.json().catch(() => null);
      setRawResponse(json);

      // Try common response shapes
      const list =
        Array.isArray(json?.data?.list)  ? json.data.list  :
        Array.isArray(json?.data)         ? json.data        :
        Array.isArray(json?.list)         ? json.list        :
        Array.isArray(json)               ? json             : null;

      if (list) {
        setBatches(list);
      } else {
        setError(`Unexpected response shape — check Raw Response below.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }, [warehouseCode, customerCode, dateFrom, dateTo, headers]);

  useEffect(() => { loadBatches(); }, [loadBatches]); // eslint-disable-line

  // ── Load orders for a batch ───────────────────────────────────────────────
  async function loadBatchOrders(batch: WmsBatch) {
    const batchId = String(
      batch.batchId ?? batch.id ?? batch.batchNo ?? batch.batchCode ?? ""
    );
    if (!batchId || loadingOrders[batchId]) return;

    setLoadingOrders((p) => ({ ...p, [batchId]: true }));
    try {
      // Try multiple likely endpoints
      const endpoints = [
        `/api/wms/batch/orders?batchId=${encodeURIComponent(batchId)}&warehouseCode=${encodeURIComponent(warehouseCode)}`,
        `/api/wms/batch/order/list?batchId=${encodeURIComponent(batchId)}`,
        `/api/wms/shipping/batch/list?batchId=${encodeURIComponent(batchId)}`,
        `/api/wms/dashboard/list?batchId=${encodeURIComponent(batchId)}&warehouseCode=${encodeURIComponent(warehouseCode)}`,
      ];

      let found = false;
      for (const ep of endpoints) {
        try {
          const res = await fetch(ep, { headers });
          if (!res.ok) continue;
          const json = await res.json().catch(() => null);
          const list =
            Array.isArray(json?.data?.list) ? json.data.list :
            Array.isArray(json?.data)        ? json.data       :
            Array.isArray(json?.list)        ? json.list       :
            Array.isArray(json)              ? json            : null;
          if (list !== null) {
            setOrders((p) => ({ ...p, [batchId]: list }));
            setOrdersRaw((p) => ({ ...p, [batchId]: json }));
            found = true;
            break;
          }
        } catch { /* try next */ }
      }
      if (!found) {
        setOrders((p) => ({ ...p, [batchId]: [] }));
      }
    } finally {
      setLoadingOrders((p) => ({ ...p, [batchId]: false }));
    }
  }

  function toggleBatch(batch: WmsBatch) {
    const batchId = String(batch.batchId ?? batch.id ?? batch.batchNo ?? batch.batchCode ?? "");
    if (expandedId === batchId) {
      setExpandedId(null);
    } else {
      setExpandedId(batchId);
      if (!orders[batchId]) loadBatchOrders(batch);
    }
  }

  // ── Filter ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!search.trim()) return batches;
    const q = search.toLowerCase();
    return batches.filter((b) =>
      Object.values(b).some((v) => String(v ?? "").toLowerCase().includes(q))
    );
  }, [batches, search]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function batchLabel(b: WmsBatch) {
    return String(b.batchName ?? b.batchNo ?? b.batchCode ?? b.batchId ?? b.id ?? "—");
  }
  function batchStatus(b: WmsBatch) {
    return String(b.status ?? b.batchStatus ?? b.statusName ?? "");
  }
  function batchDate(b: WmsBatch) {
    return String(b.batchDate ?? b.createdAt ?? b.createDate ?? b.date ?? "");
  }
  function batchOrderCount(b: WmsBatch) {
    return Number(b.orderCount ?? b.totalCount ?? b.count ?? b.qty ?? 0);
  }
  function batchId(b: WmsBatch) {
    return String(b.batchId ?? b.id ?? b.batchNo ?? b.batchCode ?? "");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">WMS Batch Test</h1>
              <p className="text-sm text-slate-500">Fetch batch data directly from WMS</p>
            </div>
          </div>
          <button
            onClick={loadBatches}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Warehouse</label>
            <input
              value={warehouseCode}
              onChange={(e) => setWarehouseCode(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Customer</label>
            <input
              value={customerCode}
              onChange={(e) => setCustomerCode(e.target.value)}
              placeholder="(all)"
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">From</label>
            <input
              type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
            <input
              type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={loadBatches}
            disabled={loading}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            Search
          </button>

          {/* Search within results */}
          <div className="ml-auto flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter results…"
              className="text-sm outline-none w-36"
            />
          </div>
        </div>

        {/* API endpoint info */}
        <div className="bg-slate-800 rounded-lg px-4 py-2 mb-5 flex items-center gap-2">
          <span className="text-xs font-mono text-green-400 font-medium">GET</span>
          <span className="text-xs font-mono text-slate-300">
            /api/dashboard/sidebar-batch?warehouseCode={warehouseCode}{customerCode ? `&customerCode=${customerCode}` : ""}{dateFrom ? `&startDate=${dateFrom.replace(/-/g,"")}` : ""}{dateTo ? `&endDate=${dateTo.replace(/-/g,"")}` : ""}
          </span>
          <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${loading ? "bg-amber-900 text-amber-300" : batches.length > 0 ? "bg-green-900 text-green-300" : error ? "bg-red-900 text-red-300" : "bg-slate-700 text-slate-400"}`}>
            {loading ? "loading…" : batches.length > 0 ? `${batches.length} batches` : error ? "error" : "—"}
          </span>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-16 text-slate-500 text-sm gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            Fetching from WMS…
          </div>
        )}

        {/* Batch list */}
        {!loading && batches.length > 0 && (
          <div className="space-y-2 mb-6">
            {filtered.map((batch, idx) => {
              const id = batchId(batch) || String(idx);
              const isOpen = expandedId === id;
              const bOrders = orders[id] ?? [];
              const isLoadingOrders = loadingOrders[id];
              const statusStr = batchStatus(batch);
              const count = batchOrderCount(batch);

              return (
                <div key={id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  {/* Batch row */}
                  <button
                    onClick={() => toggleBatch(batch)}
                    className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 transition-colors text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900 text-sm">{batchLabel(batch)}</span>
                        {statusStr && statusBadge(statusStr)}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-slate-400">
                        {batchDate(batch) && (
                          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{batchDate(batch)}</span>
                        )}
                        {!!(batch.warehouseCode || batch.warehouse) && (
                          <span className="flex items-center gap-1"><Warehouse className="w-3 h-3" />{String(batch.warehouseCode ?? batch.warehouse)}</span>
                        )}
                        {!!(batch.customerCode || batch.customer) && (
                          <span className="flex items-center gap-1"><Users className="w-3 h-3" />{String(batch.customerCode ?? batch.customer)}</span>
                        )}
                        <span className="text-xs text-slate-400 font-mono">id: {id}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {count > 0 && (
                        <span className="flex items-center gap-1 text-sm font-medium text-slate-700">
                          <Package className="w-3.5 h-3.5 text-slate-400" />{count}
                        </span>
                      )}
                      {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                  </button>

                  {/* Expanded: raw batch object + orders */}
                  {isOpen && (
                    <div className="border-t border-slate-100">
                      {/* Raw batch data */}
                      <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Raw batch fields</p>
                        <div className="flex flex-wrap gap-x-6 gap-y-1">
                          {Object.entries(batch).map(([k, v]) => (
                            <div key={k} className="text-xs">
                              <span className="text-slate-400">{k}: </span>
                              <span className="text-slate-700 font-medium font-mono">{JSON.stringify(v)}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Orders */}
                      <div className="px-5 py-3">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                          Orders in batch
                          {isLoadingOrders && <Loader2 className="inline w-3 h-3 ml-2 animate-spin" />}
                        </p>

                        {isLoadingOrders ? (
                          <div className="text-sm text-slate-400 py-4 text-center">Loading orders…</div>
                        ) : bOrders.length === 0 ? (
                          <div className="text-sm text-slate-400 py-4 text-center">
                            No orders found (endpoint may need adjustment — check raw response)
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-slate-100">
                                  {Object.keys(bOrders[0]).slice(0, 10).map((k) => (
                                    <th key={k} className="px-2 py-1.5 text-left font-semibold text-slate-500 whitespace-nowrap">{k}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {bOrders.map((o, i) => (
                                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                                    {Object.keys(bOrders[0]).slice(0, 10).map((k) => (
                                      <td key={k} className="px-2 py-1.5 text-slate-700 whitespace-nowrap">{String(o[k] ?? "")}</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* Raw orders response */}
                        {!!ordersRaw[id] && (
                          <details className="mt-3">
                            <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">Raw orders API response</summary>
                            <pre className="mt-2 text-xs bg-slate-900 text-green-400 rounded-lg p-3 overflow-x-auto max-h-48">
                              {JSON.stringify(ordersRaw[id], null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!loading && batches.length === 0 && !error && (
          <div className="text-center py-16 text-slate-400 text-sm">
            No batches returned — adjust filters and search again.
          </div>
        )}

        {/* Raw API response (always visible for debugging) */}
        {rawResponse !== null && (
          <details className="mt-2">
            <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 mb-2">
              Raw sidebar-batch response
            </summary>
            <pre className="text-xs bg-slate-900 text-green-400 rounded-lg p-4 overflow-x-auto max-h-64">
              {JSON.stringify(rawResponse, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
