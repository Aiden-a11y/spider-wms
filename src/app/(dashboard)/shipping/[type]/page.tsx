"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useParams } from "next/navigation";
import {
  RefreshCw, AlertCircle, Truck, Search, Download,
  Building2, User, Store, Globe,
} from "lucide-react";

/* ── Shipping type config ── */
const TYPE_META: Record<string, {
  label: string;
  desc: string;
  icon: React.ElementType;
  accent: string;
  badge: string;
  /* API endpoint paths to try in order */
  endpoints: string[];
}> = {
  b2b: {
    label: "B2B Shipping",
    desc: "Business to Business outbound orders",
    icon: Building2,
    accent: "bg-blue-600",
    badge: "bg-blue-100 text-blue-700 border-blue-200",
    endpoints: [
      "/api/wms/shipping/b2b/list",
      "/api/wms/b2b/shipping/list",
      "/api/wms/outbound/b2b/list",
    ],
  },
  b2c: {
    label: "B2C Shipping",
    desc: "Business to Consumer outbound orders",
    icon: User,
    accent: "bg-purple-600",
    badge: "bg-purple-100 text-purple-700 border-purple-200",
    endpoints: [
      "/api/wms/shipping/b2c/list",
      "/api/wms/b2c/shipping/list",
      "/api/wms/outbound/b2c/list",
    ],
  },
  b2s: {
    label: "B2S Shipping",
    desc: "Business to Store outbound orders",
    icon: Store,
    accent: "bg-amber-600",
    badge: "bg-amber-100 text-amber-700 border-amber-200",
    endpoints: [
      "/api/wms/shipping/b2s/list",
      "/api/wms/b2s/shipping/list",
      "/api/wms/outbound/b2s/list",
    ],
  },
  b2e: {
    label: "B2E Shipping",
    desc: "Business to eCommerce outbound orders",
    icon: Globe,
    accent: "bg-teal-600",
    badge: "bg-teal-100 text-teal-700 border-teal-200",
    endpoints: [
      "/api/wms/shipping/b2e/list",
      "/api/wms/b2e/shipping/list",
      "/api/wms/outbound/b2e/list",
    ],
  },
};

const STATUS_COLORS: Record<string, string> = {
  PENDING:    "bg-yellow-100 text-yellow-700 border-yellow-200",
  PROCESSING: "bg-blue-100   text-blue-700   border-blue-200",
  COMPLETED:  "bg-green-100  text-green-700  border-green-200",
  SHIPPED:    "bg-purple-100 text-purple-700  border-purple-200",
  CANCELLED:  "bg-red-100    text-red-700    border-red-200",
};
function statusBadge(s: string) {
  return STATUS_COLORS[s?.toUpperCase()] ?? "bg-slate-100 text-slate-600 border-slate-200";
}

/* ── Pretty column names ── */
const COL_LABELS: Record<string, string> = {
  orderCode: "Order Code", shippingOrderCode: "Order Code", outboundCode: "Order Code",
  customerCode: "Customer", customerName: "Customer",
  status: "Status",
  orderDate: "Order Date", shippingDate: "Ship Date",
  totalQty: "Qty", qty: "Qty",
  warehouseCode: "Warehouse",
  trackingNo: "Tracking #", trackingNumber: "Tracking #",
};

interface Order { [key: string]: unknown }

export default function ShippingTypePage() {
  const { user } = useAuth();
  const params = useParams();
  const type = String(params.type ?? "b2b").toLowerCase();
  const meta = TYPE_META[type] ?? TYPE_META.b2b;
  const Icon = meta.icon;

  const [orders, setOrders]       = useState<Order[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
  const [search, setSearch]       = useState("");
  const [usedEndpoint, setUsedEndpoint] = useState("");
  const [rawResponse, setRawResponse]   = useState<unknown>(null);

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  async function load() {
    setLoading(true);
    setError("");
    setOrders([]);
    setRawResponse(null);

    /* Try each endpoint candidate until one returns data */
    for (const ep of meta.endpoints) {
      try {
        const res = await fetch(ep, {
          method: "POST",
          headers,
          body: JSON.stringify({ page: 1, limit: 200 }),
        });
        const json = await res.json();
        const list =
          json?.data?.list ?? json?.data?.items ?? json?.data ??
          json?.list ?? json?.items ?? (Array.isArray(json) ? json : []);

        setRawResponse(json);
        setUsedEndpoint(ep);

        if (Array.isArray(list) && list.length > 0) {
          setOrders(list);
          setLoading(false);
          return;
        }
        // Got a response but empty — keep it and stop trying
        if (res.ok) {
          setOrders([]);
          setLoading(false);
          return;
        }
      } catch { /* try next */ }
    }

    setError("Could not load orders. Check API endpoint.");
    setLoading(false);
  }

  useEffect(() => { load(); }, [type]); // eslint-disable-line

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) =>
      Object.values(o).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [orders, search]);

  /* Choose meaningful columns (prefer known field names) */
  const cols = useMemo(() => {
    if (orders.length === 0) return [];
    const keys = Object.keys(orders[0]);
    const priority = Object.keys(COL_LABELS);
    const sorted = [
      ...priority.filter((k) => keys.includes(k)),
      ...keys.filter((k) => !priority.includes(k)),
    ];
    return sorted.slice(0, 9);
  }, [orders]);

  async function downloadExcel() {
    const { utils, writeFile } = await import("xlsx");
    const rows = filtered.map((o) =>
      Object.fromEntries(cols.map((c) => [COL_LABELS[c] ?? c, String(o[c] ?? "")]))
    );
    const ws = utils.json_to_sheet(rows);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, meta.label);
    writeFile(wb, `${type}_shipping_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  /* Status summary counts */
  const statusSummary = useMemo(() => {
    const map: Record<string, number> = {};
    for (const o of orders) {
      const s = String(o.status ?? o.orderStatus ?? "UNKNOWN").toUpperCase();
      map[s] = (map[s] ?? 0) + 1;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [orders]);

  return (
    <div className="p-8">
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl ${meta.accent} flex items-center justify-center shadow-sm`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">{meta.label}</h1>
            <p className="text-slate-500 text-sm mt-0.5">{meta.desc}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={downloadExcel}
            disabled={filtered.length === 0}
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Status summary pills ── */}
      {statusSummary.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          <span className="text-xs text-slate-400 self-center mr-1">Status:</span>
          {statusSummary.map(([status, count]) => (
            <span
              key={status}
              className={`text-xs font-semibold px-3 py-1 rounded-full border ${statusBadge(status)}`}
            >
              {status} · {count}
            </span>
          ))}
          <span className="ml-auto text-xs text-slate-400 self-center">
            {orders.length.toLocaleString()} total orders
          </span>
        </div>
      )}

      {/* ── Search ── */}
      <div className="relative mb-5 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search order, customer, tracking..."
          className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-5">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-100 h-11 animate-pulse" />
          ))}
        </div>
      )}

      {/* ── Empty ── */}
      {!loading && filtered.length === 0 && !error && (
        <div className="text-center py-20 text-slate-400">
          <Truck className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No {meta.label} orders found</p>
          {usedEndpoint && (
            <p className="text-xs mt-2 font-mono text-slate-300">{usedEndpoint}</p>
          )}
        </div>
      )}

      {/* ── Table ── */}
      {!loading && filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {cols.map((c) => (
                    <th key={c} className="px-4 py-2.5 text-left text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">
                      {COL_LABELS[c] ?? c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((order, idx) => (
                  <tr key={idx} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                    {cols.map((c) => {
                      const val = String(order[c] ?? "-");
                      const isStatus = c.toLowerCase().includes("status");
                      const isCode = c.toLowerCase().includes("code") || c.toLowerCase().includes("no");
                      return (
                        <td key={c} className="px-4 py-2.5 whitespace-nowrap">
                          {isStatus ? (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${statusBadge(val)}`}>
                              {val}
                            </span>
                          ) : isCode ? (
                            <span className="font-mono font-medium text-slate-700">{val}</span>
                          ) : (
                            <span className="text-slate-600">{val}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Dev: endpoint + raw response ── */}
      {rawResponse !== null && (
        <details className="mt-6 bg-slate-800 rounded-xl p-4 text-xs">
          <summary className="text-slate-400 cursor-pointer select-none">
            Debug · endpoint: <span className="text-green-400 font-mono">{usedEndpoint}</span>
          </summary>
          <pre className="text-green-400 overflow-auto max-h-60 mt-3">
            {JSON.stringify(rawResponse, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
