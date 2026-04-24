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
  accentLight: string;
  orderType: string;         // as sent to the API
}> = {
  b2b: { label: "B2B Shipping", desc: "Business to Business",  icon: Building2, accent: "bg-blue-600",   accentLight: "bg-blue-50 text-blue-700 border-blue-200",   orderType: "B2B" },
  b2c: { label: "B2C Shipping", desc: "Business to Consumer",  icon: User,      accent: "bg-purple-600", accentLight: "bg-purple-50 text-purple-700 border-purple-200", orderType: "B2C" },
  b2s: { label: "B2S Shipping", desc: "Business to Store",     icon: Store,     accent: "bg-amber-600",  accentLight: "bg-amber-50 text-amber-700 border-amber-200",   orderType: "B2S" },
  b2e: { label: "B2E Shipping", desc: "Business to eCommerce", icon: Globe,     accent: "bg-teal-600",   accentLight: "bg-teal-50 text-teal-700 border-teal-200",     orderType: "B2E" },
};

const STATUS_META: Record<string, { label: string; badge: string }> = {
  CA: { label: "Packing Request",           badge: "bg-blue-50    text-blue-700    border-blue-200"    },
  DA: { label: "Packing Complete",          badge: "bg-cyan-50    text-cyan-700    border-cyan-200"    },
  AR: { label: "Auto Label Request",        badge: "bg-violet-50  text-violet-700  border-violet-200"  },
  AC: { label: "Auto Label Complete",       badge: "bg-indigo-50  text-indigo-700  border-indigo-200"  },
  LR: { label: "Twinny Packing Request",    badge: "bg-amber-50   text-amber-700   border-amber-200"   },
  L2: { label: "Twinny Order Cancel Req",   badge: "bg-orange-50  text-orange-700  border-orange-200"  },
  LC: { label: "Twinny Packing Complete",   badge: "bg-teal-50    text-teal-700    border-teal-200"    },
  HA: { label: "Hold",                      badge: "bg-red-50     text-red-700     border-red-200"     },
  CC: { label: "Cancelled Order",           badge: "bg-slate-100  text-slate-500   border-slate-200"   },
  FA: { label: "Complete",                  badge: "bg-green-50   text-green-700   border-green-200"   },
};
function statusBadge(code: string) {
  return STATUS_META[code]?.badge ?? "bg-slate-100 text-slate-500 border-slate-200";
}
function statusLabel(code: string) {
  return STATUS_META[code]?.label ?? code;
}

/* ── Friendly column labels ── */
const COL_LABELS: Record<string, string> = {
  shippingOrderCode: "Order Code", orderCode: "Order Code", outboundCode: "Order Code",
  customerCode: "Customer", customerName: "Customer Name",
  status: "Status", orderStatus: "Status",
  orderDate: "Order Date", shippingDate: "Ship Date", requestDate: "Request Date",
  totalQty: "Qty", qty: "Qty",
  warehouseCode: "Warehouse",
  trackingNo: "Tracking #", trackingNumber: "Tracking #",
  receiverName: "Receiver", deliveryAddress: "Address",
};

interface Order { [key: string]: unknown }
interface Customer { code: string; name: string }
interface Warehouse { id: string; name: string }

export default function ShippingTypePage() {
  const { user } = useAuth();
  const params = useParams();
  const type    = String(params.type ?? "b2b").toLowerCase();
  const meta    = TYPE_META[type] ?? TYPE_META.b2b;
  const Icon    = meta.icon;

  const [warehouses,    setWarehouses]    = useState<Warehouse[]>([]);
  const [warehouseCode, setWarehouseCode] = useState("");
  const [customers,     setCustomers]     = useState<Customer[]>([]);
  const [customerCode,  setCustomerCode]  = useState("ALL");
  const [orders,        setOrders]        = useState<Order[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState("");
  const [search,        setSearch]        = useState("");
  const [debugInfo,     setDebugInfo]     = useState<{ endpoint?: string; raw?: unknown }>({});

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  /* ── 1. Load warehouses ── */
  useEffect(() => {
    fetch("/api/wms/combo/warehouse", { headers })
      .then((r) => r.json())
      .then((json) => {
        const arr: Record<string, unknown>[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
        const list: Warehouse[] = arr
          .map((w) => ({ id: String(w.code ?? w.id ?? ""), name: String(w.name ?? w.code ?? "") }))
          .filter((w) => w.id);
        setWarehouses(list);
        const preferred = list.find((w) => w.id === "STOO1") ?? list[0];
        if (preferred) setWarehouseCode(preferred.id);
      })
      .catch(() => {});
  }, []); // eslint-disable-line

  /* ── 2. Load customers for this type whenever warehouse or type changes ── */
  useEffect(() => {
    if (!warehouseCode) return;
    fetch(`/api/wms/combo/customer-by-ordertype/${meta.orderType}?warehouseCode=${warehouseCode}`, { headers })
      .then((r) => r.json())
      .then((json) => {
        const arr: Record<string, unknown>[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
        const list: Customer[] = arr
          .map((c) => ({ code: String(c.code ?? c.customerCode ?? ""), name: String(c.name ?? c.customerName ?? c.code ?? "") }))
          .filter((c) => c.code);
        setCustomers(list);
        setCustomerCode("ALL");
      })
      .catch(() => setCustomers([]));
  }, [warehouseCode, type]); // eslint-disable-line

  /* ── 3. Load orders ── */
  async function loadOrders(whCode = warehouseCode, custCode = customerCode) {
    if (!whCode) return;
    setLoading(true);
    setError("");
    setOrders([]);

    const body: Record<string, unknown> = {
      page: 1,
      limit: 500,
      pageSize: 500,
      orderType: meta.orderType,
      warehouseCode: whCode,
    };
    if (custCode && custCode !== "ALL") body.customerCode = custCode;

    // Candidate endpoints
    const endpoints = [
      `/api/wms/shipping/${type}/list`,
      `/api/wms/shipping/list`,
      `/api/wms/outbound/${type}/list`,
      `/api/wms/outbound/list`,
    ];

    for (const ep of endpoints) {
      try {
        const res = await fetch(ep, { method: "POST", headers, body: JSON.stringify(body) });
        const json = await res.json();
        setDebugInfo({ endpoint: ep, raw: json });
        const list =
          json?.data?.list ?? json?.data?.items ?? json?.data ??
          json?.list ?? json?.items ?? (Array.isArray(json) ? json : []);
        if (res.ok) {
          setOrders(Array.isArray(list) ? list : []);
          setLoading(false);
          return;
        }
      } catch { /* try next */ }
    }

    setError("Could not load orders.");
    setLoading(false);
  }

  useEffect(() => {
    if (warehouseCode) loadOrders();
  }, [warehouseCode, type]); // eslint-disable-line

  /* ── Filter ── */
  const filtered = useMemo(() => {
    let list = orders;
    if (customerCode && customerCode !== "ALL")
      list = list.filter((o) => String(o.customerCode ?? "") === customerCode);
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((o) => Object.values(o).some((v) => String(v).toLowerCase().includes(q)));
  }, [orders, customerCode, search]);

  /* ── Smart columns ── */
  const cols = useMemo(() => {
    if (orders.length === 0) return [];
    const keys = Object.keys(orders[0]);
    const priority = Object.keys(COL_LABELS);
    return [
      ...priority.filter((k) => keys.includes(k)),
      ...keys.filter((k) => !priority.includes(k)),
    ].slice(0, 9);
  }, [orders]);

  /* ── Status summary ── */
  const statusSummary = useMemo(() => {
    const map: Record<string, number> = {};
    for (const o of orders) {
      const s = String(o.status ?? o.orderStatus ?? "UNKNOWN").toUpperCase();
      map[s] = (map[s] ?? 0) + 1;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
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
          <button onClick={downloadExcel} disabled={filtered.length === 0}
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors disabled:opacity-40">
            <Download className="w-4 h-4" /> Export
          </button>
          <button onClick={() => loadOrders()} disabled={loading}
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* ── Filters row ── */}
      <div className="flex flex-wrap gap-3 mb-5">
        {/* Warehouse */}
        <select
          value={warehouseCode}
          onChange={(e) => { setWarehouseCode(e.target.value); loadOrders(e.target.value, customerCode); }}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {warehouses.length === 0 && <option value="">Loading...</option>}
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name || w.id}</option>)}
        </select>

        {/* Customer */}
        {customers.length > 0 && (
          <select
            value={customerCode}
            onChange={(e) => { setCustomerCode(e.target.value); loadOrders(warehouseCode, e.target.value); }}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Customers</option>
            {customers.map((c) => <option key={c.code} value={c.code}>{c.name || c.code}</option>)}
          </select>
        )}

        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order, customer, tracking..."
            className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {/* ── Status pills ── */}
      {statusSummary.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {statusSummary.map(([s, c]) => (
            <span key={s} className={`text-xs font-semibold px-3 py-1 rounded-full border ${statusBadge(s)}`}>
              {statusLabel(s)} <span className="opacity-60">· {c}</span>
            </span>
          ))}
          <span className="ml-auto text-xs text-slate-400 self-center">
            {orders.length.toLocaleString()} total
          </span>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-5">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-100 h-11 animate-pulse" />)}
        </div>
      )}

      {/* ── Empty ── */}
      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-20 text-slate-400">
          <Truck className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No {meta.label} orders found</p>
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
                      const isMono   = c.toLowerCase().includes("code") || c.toLowerCase().includes("no") || c.toLowerCase().includes("tracking");
                      return (
                        <td key={c} className="px-4 py-2.5 whitespace-nowrap">
                          {isStatus ? (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${statusBadge(val)}`}>{statusLabel(val)}</span>
                          ) : isMono ? (
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

      {/* ── Debug ── */}
      {debugInfo.endpoint && (
        <details className="mt-6 bg-slate-800 rounded-xl p-4 text-xs">
          <summary className="text-slate-400 cursor-pointer select-none">
            Debug · <span className="text-green-400 font-mono">{debugInfo.endpoint}</span>
          </summary>
          <pre className="text-green-400 overflow-auto max-h-60 mt-3">{JSON.stringify(debugInfo.raw, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
