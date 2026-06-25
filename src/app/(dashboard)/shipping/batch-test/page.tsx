"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import {
  Layers, RefreshCw, Loader2, ChevronDown, ChevronUp, Search,
  Package, Calendar, Warehouse, Users, CheckCircle2, Clock, AlertCircle, Truck,
} from "lucide-react";

type WmsBatch = {
  batchCode: string;
  batchName: string;
  batchDate: string;
  warehouseCode: string;
  customerCode: string;
  orderCount: number;
  remark: string;
  createdBy: string;
  createdAt: string;
};

type WmsOrder = {
  shippingOrderCode: string;
  shippingOrderNo: string;
  warehouseCode: string;
  customerCode: string;
  customerName: string;
  status: string;
  statusName: string;
  orderDate: string;
  outDate: string;
  consigneeName: string;
  trackingNo: string;
  carrierName: string;
  serviceName: string;
  itemCount: number;
  totalQty: number;
  batchCode: string;
  batchName: string;
};

function StatusBadge({ status, name }: { status: string; name: string }) {
  const label = name || status;
  if (status === "FA" || name.toLowerCase().includes("complete")) {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200"><CheckCircle2 className="w-3 h-3" />{label}</span>;
  }
  if (status === "AA" || name.toLowerCase().includes("request") || name.toLowerCase().includes("outbound")) {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200"><Clock className="w-3 h-3" />{label}</span>;
  }
  if (name.toLowerCase().includes("pick") || name.toLowerCase().includes("progress")) {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200"><Loader2 className="w-3 h-3" />{label}</span>;
  }
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">{label || status}</span>;
}

export default function BatchTestPage() {
  const { user } = useAuth();
  const router = useRouter();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  useEffect(() => { if (!user) router.replace("/"); }, [user, router]);

  const [batches, setBatches] = useState<WmsBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [orders, setOrders] = useState<Record<string, WmsOrder[]>>({});
  const [loadingOrders, setLoadingOrders] = useState<Record<string, boolean>>({});

  const [warehouseCode, setWarehouseCode] = useState("STOO1");
  const [customerCode, setCustomerCode] = useState("FCOUS");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  // ── Load batch list: POST /api/batch/list ─────────────────────────────────
  const loadBatches = useCallback(async () => {
    setLoading(true);
    setError("");
    setBatches([]);
    try {
      const res = await fetch("/api/wms/batch/list", {
        method: "POST",
        headers,
        body: JSON.stringify({
          searchText: "",
          warehouseCode,
          customerCode,
          dateFrom: dateFrom.replace(/-/g, ""),
          dateTo: dateTo.replace(/-/g, ""),
        }),
      });
      const json = await res.json();
      const list: WmsBatch[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      setBatches(list);
      if (!json?.isSuccess && list.length === 0) setError(json?.message ?? "No data returned");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }, [warehouseCode, customerCode, dateFrom, dateTo, headers]);

  useEffect(() => { loadBatches(); }, [loadBatches]); // eslint-disable-line

  // ── Load orders: POST /api/batch/orders  body = ["batchCode"] ────────────
  async function loadBatchOrders(batchCode: string) {
    if (loadingOrders[batchCode]) return;
    setLoadingOrders((p) => ({ ...p, [batchCode]: true }));
    try {
      const res = await fetch("/api/wms/batch/orders", {
        method: "POST",
        headers,
        body: JSON.stringify([batchCode]),
      });
      const json = await res.json();
      const list: WmsOrder[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      setOrders((p) => ({ ...p, [batchCode]: list }));
    } catch {
      setOrders((p) => ({ ...p, [batchCode]: [] }));
    } finally {
      setLoadingOrders((p) => ({ ...p, [batchCode]: false }));
    }
  }

  function toggle(batchCode: string) {
    if (expandedCode === batchCode) { setExpandedCode(null); return; }
    setExpandedCode(batchCode);
    if (!orders[batchCode]) loadBatchOrders(batchCode);
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return q ? batches.filter((b) =>
      b.batchName.toLowerCase().includes(q) ||
      b.batchCode.toLowerCase().includes(q) ||
      b.customerCode.toLowerCase().includes(q)
    ) : batches;
  }, [batches, search]);

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
              <h1 className="text-xl font-bold text-slate-900">WMS Batch List</h1>
              <p className="text-sm text-slate-500">POST /api/batch/list → orders via POST /api/batch/orders</p>
            </div>
          </div>
          <button onClick={loadBatches} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Warehouse</label>
            <input value={warehouseCode} onChange={(e) => setWarehouseCode(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Customer</label>
            <input value={customerCode} onChange={(e) => setCustomerCode(e.target.value)} placeholder="(all)"
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button onClick={loadBatches} disabled={loading}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
            Search
          </button>
          <div className="ml-auto flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter…"
              className="text-sm outline-none w-32" />
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-16 text-slate-500 text-sm gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />Loading batches…
          </div>
        )}

        {/* Batch list */}
        {!loading && filtered.length > 0 && (
          <div className="space-y-2">
            {filtered.map((batch) => {
              const isOpen = expandedCode === batch.batchCode;
              const bOrders = orders[batch.batchCode];
              const isLoadingO = loadingOrders[batch.batchCode];

              return (
                <div key={batch.batchCode} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <button onClick={() => toggle(batch.batchCode)}
                    className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 transition-colors text-left">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 text-sm">{batch.batchName}</span>
                        <span className="text-xs text-slate-400 font-mono">{batch.batchCode}</span>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-slate-400">
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />
                          {batch.batchDate.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")}
                        </span>
                        <span className="flex items-center gap-1"><Warehouse className="w-3 h-3" />{batch.warehouseCode}</span>
                        <span className="flex items-center gap-1"><Users className="w-3 h-3" />{batch.customerCode}</span>
                        <span>by {batch.createdBy}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1 text-sm font-medium text-slate-700">
                        <Package className="w-3.5 h-3.5 text-slate-400" />{batch.orderCount}
                      </span>
                      {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-slate-100">
                      {isLoadingO ? (
                        <div className="flex items-center justify-center py-6 text-slate-400 text-sm gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />Loading orders…
                        </div>
                      ) : !bOrders || bOrders.length === 0 ? (
                        <div className="text-center py-6 text-slate-400 text-sm">No orders found</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-100">
                                <th className="px-4 py-2.5 text-left font-semibold text-slate-500 whitespace-nowrap">Order Code</th>
                                <th className="px-4 py-2.5 text-left font-semibold text-slate-500 whitespace-nowrap">Order No</th>
                                <th className="px-4 py-2.5 text-left font-semibold text-slate-500 whitespace-nowrap">Consignee</th>
                                <th className="px-4 py-2.5 text-left font-semibold text-slate-500 whitespace-nowrap">Status</th>
                                <th className="px-4 py-2.5 text-left font-semibold text-slate-500 whitespace-nowrap">Order Date</th>
                                <th className="px-4 py-2.5 text-left font-semibold text-slate-500 whitespace-nowrap">Out Date</th>
                                <th className="px-4 py-2.5 text-right font-semibold text-slate-500">Qty</th>
                                <th className="px-4 py-2.5 text-left font-semibold text-slate-500 whitespace-nowrap">Tracking</th>
                                <th className="px-4 py-2.5 text-left font-semibold text-slate-500 whitespace-nowrap">Carrier</th>
                              </tr>
                            </thead>
                            <tbody>
                              {bOrders.map((o) => (
                                <tr key={o.shippingOrderCode} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                                  <td className="px-4 py-2.5 font-mono text-slate-700">{o.shippingOrderCode}</td>
                                  <td className="px-4 py-2.5 text-slate-500">{o.shippingOrderNo}</td>
                                  <td className="px-4 py-2.5 text-slate-700">{o.consigneeName}</td>
                                  <td className="px-4 py-2.5"><StatusBadge status={o.status} name={o.statusName} /></td>
                                  <td className="px-4 py-2.5 text-slate-500">{o.orderDate.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")}</td>
                                  <td className="px-4 py-2.5 text-slate-500">{o.outDate ? o.outDate.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3") : "—"}</td>
                                  <td className="px-4 py-2.5 text-right font-medium text-slate-700">{o.totalQty}</td>
                                  <td className="px-4 py-2.5 font-mono text-slate-500 max-w-[180px] truncate">
                                    {o.trackingNo ? (
                                      <span className="flex items-center gap-1">
                                        <Truck className="w-3 h-3 text-slate-400 flex-shrink-0" />
                                        {o.trackingNo}
                                      </span>
                                    ) : "—"}
                                  </td>
                                  <td className="px-4 py-2.5 text-slate-500">{o.carrierName || o.serviceName || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!loading && batches.length === 0 && !error && (
          <div className="text-center py-16 text-slate-400 text-sm">No batches — adjust filters.</div>
        )}
      </div>
    </div>
  );
}
