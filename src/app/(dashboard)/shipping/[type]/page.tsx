"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useParams } from "next/navigation";
import {
  RefreshCw, AlertCircle, Truck, Search, Download, X,
  Building2, User, Store, Globe,
} from "lucide-react";

/* ── Shipping type config ── */
const TYPE_META: Record<string, {
  label: string; desc: string; icon: React.ElementType;
  accent: string; accentLight: string; orderType: string;
}> = {
  b2b: { label: "B2B Shipping", desc: "Business to Business",  icon: Building2, accent: "bg-blue-600",   accentLight: "bg-blue-50 text-blue-700 border-blue-200",     orderType: "B2B" },
  b2c: { label: "B2C Shipping", desc: "Business to Consumer",  icon: User,      accent: "bg-purple-600", accentLight: "bg-purple-50 text-purple-700 border-purple-200", orderType: "B2C" },
  b2s: { label: "B2S Shipping", desc: "Business to Store",     icon: Store,     accent: "bg-amber-600",  accentLight: "bg-amber-50 text-amber-700 border-amber-200",    orderType: "B2S" },
  b2e: { label: "B2E Shipping", desc: "Business to eCommerce", icon: Globe,     accent: "bg-teal-600",   accentLight: "bg-teal-50 text-teal-700 border-teal-200",       orderType: "B2E" },
};

const STATUS_META: Record<string, { label: string; badge: string }> = {
  AA: { label: "Pre-Alert",               badge: "bg-yellow-50  text-yellow-700  border-yellow-200"  },
  CA: { label: "Packing Request",         badge: "bg-blue-50    text-blue-700    border-blue-200"    },
  DA: { label: "Packing Complete",        badge: "bg-cyan-50    text-cyan-700    border-cyan-200"    },
  AR: { label: "Auto Label Request",      badge: "bg-violet-50  text-violet-700  border-violet-200"  },
  AC: { label: "Auto Label Complete",     badge: "bg-indigo-50  text-indigo-700  border-indigo-200"  },
  LR: { label: "Twinny Packing Request",  badge: "bg-amber-50   text-amber-700   border-amber-200"   },
  L2: { label: "Twinny Cancel Request",   badge: "bg-orange-50  text-orange-700  border-orange-200"  },
  LC: { label: "Twinny Packing Complete", badge: "bg-teal-50    text-teal-700    border-teal-200"    },
  HA: { label: "Hold",                    badge: "bg-red-50     text-red-700     border-red-200"     },
  CC: { label: "Cancelled",              badge: "bg-slate-100  text-slate-500   border-slate-200"   },
  FA: { label: "Complete",               badge: "bg-green-50   text-green-700   border-green-200"   },
};
const statusBadge  = (c: string) => STATUS_META[c]?.badge  ?? "bg-slate-100 text-slate-500 border-slate-200";
const statusLabel  = (c: string) => STATUS_META[c]?.label  ?? c;

const COL_LABELS: Record<string, string> = {
  shippingOrderCode: "Order Code", orderCode: "Order Code", outboundCode: "Order Code",
  customerCode: "Customer", customerName: "Customer Name",
  status: "Status", orderStatus: "Status",
  orderDate: "Order Date", shippingDate: "Ship Date", requestDate: "Request Date",
  totalQty: "Qty", qty: "Qty",
  warehouseCode: "Warehouse",
  trackingNo: "Tracking #", trackingNumber: "Tracking #",
  receiverName: "Receiver", deliveryAddress: "Address",
  shippingOrderNo: "Shipping Order No", orderType: "Order Type",
  totalWeight: "Total Weight", length: "Length", width: "Width", height: "Height",
  invoiceValue: "Invoice Value", fareValue: "Fare Value", fareEtcValue: "Fare Etc",
  insuranceValue: "Insurance Value", shippingRate: "Shipping Rate", shippingCost: "Shipping Cost",
  consignorName: "Consignor", consignorAddress1: "Address",
  consignorCity: "City", consignorState: "State",
  consignorZip: "ZIP", consignorZipCode: "ZIP",
  consignorNationalCode: "Country", consignorTelLno: "Tel",
  comment: "Comment",
};

/* ── Field display / edit helper ── */
function Field({ label, value, onChange }: { label: string; value: unknown; onChange?: (v: string) => void }) {
  const v = value == null || value === "" ? "-" : String(value);
  if (onChange) {
    return (
      <div>
        <label className="text-xs text-slate-400 uppercase tracking-wide mb-1 block">{label}</label>
        <input
          type="text"
          value={v === "-" ? "" : v}
          onChange={(e) => onChange(e.target.value)}
          placeholder="-"
          className="w-full text-sm text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
        />
      </div>
    );
  }
  return (
    <div>
      <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-sm text-slate-800 font-medium break-all">{v}</p>
    </div>
  );
}

interface Order     { [key: string]: unknown }
interface Customer  { code: string; name: string }
interface Warehouse { id: string; name: string }

export default function ShippingTypePage() {
  const { user }  = useAuth();
  const params    = useParams();
  const type      = String(params.type ?? "b2b").toLowerCase();
  const meta      = TYPE_META[type] ?? TYPE_META.b2b;
  const Icon      = meta.icon;

  const [warehouses,    setWarehouses]    = useState<Warehouse[]>([]);
  const [warehouseCode, setWarehouseCode] = useState("");
  const [customers,     setCustomers]     = useState<Customer[]>([]);
  const [customerCode,  setCustomerCode]  = useState("ALL");
  const [orders,        setOrders]        = useState<Order[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState("");
  const [search,        setSearch]        = useState("");
  const [colFilters,    setColFilters]    = useState<Record<string, string>>({});
  const [debugInfo,     setDebugInfo]     = useState<{ endpoint?: string; raw?: unknown }>({});

  /* ── Modal state ── */
  const [selected,      setSelected]      = useState<Order | null>(null);
  const [detail,        setDetail]        = useState<Order | null>(null);
  const [itemsRaw,      setItemsRaw]      = useState<Order[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab,     setActiveTab]     = useState<"info" | "address" | "package" | "additional" | "items" | "raw">("info");
  const [editMode,      setEditMode]      = useState(false);
  const [editData,      setEditData]      = useState<Order>({});
  const [saving,        setSaving]        = useState(false);
  const [saveError,     setSaveError]     = useState("");

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  /* ── 1. Warehouses ── */
  useEffect(() => {
    fetch("/api/wms/combo/warehouse", { headers })
      .then((r) => r.json())
      .then((json) => {
        const arr: Record<string, unknown>[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
        const list = arr.map((w) => ({ id: String(w.code ?? w.id ?? ""), name: String(w.name ?? w.code ?? "") })).filter((w) => w.id);
        setWarehouses(list);
        const pref = list.find((w) => w.id === "STOO1") ?? list[0];
        if (pref) setWarehouseCode(pref.id);
      }).catch(() => {});
  }, []); // eslint-disable-line

  /* ── 2. Customers by order type ── */
  useEffect(() => {
    if (!warehouseCode) return;
    fetch(`/api/wms/combo/customer-by-ordertype/${meta.orderType}?warehouseCode=${warehouseCode}`, { headers })
      .then((r) => r.json())
      .then((json) => {
        const arr: Record<string, unknown>[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
        setCustomers(arr.map((c) => ({ code: String(c.code ?? c.customerCode ?? ""), name: String(c.name ?? c.customerName ?? c.code ?? "") })).filter((c) => c.code));
        setCustomerCode("ALL");
      }).catch(() => setCustomers([]));
  }, [warehouseCode, type]); // eslint-disable-line

  /* ── 3. Orders ── */
  async function loadOrders(whCode = warehouseCode, custCode = customerCode) {
    if (!whCode) return;
    setLoading(true); setError(""); setOrders([]); setColFilters({});
    const body: Record<string, unknown> = { page: 1, limit: 500, pageSize: 500, orderType: meta.orderType, warehouseCode: whCode };
    if (custCode && custCode !== "ALL") body.customerCode = custCode;
    for (const ep of [`/api/wms/shipping/${type}/list`, `/api/wms/shipping/list`, `/api/wms/outbound/${type}/list`, `/api/wms/outbound/list`]) {
      try {
        const res  = await fetch(ep, { method: "POST", headers, body: JSON.stringify(body) });
        const json = await res.json();
        setDebugInfo({ endpoint: ep, raw: json });
        const list = json?.data?.list ?? json?.data?.items ?? json?.data ?? json?.list ?? json?.items ?? (Array.isArray(json) ? json : []);
        if (res.ok) { setOrders(Array.isArray(list) ? list : []); setLoading(false); return; }
      } catch { /* try next */ }
    }
    setError("Could not load orders."); setLoading(false);
  }
  useEffect(() => { if (warehouseCode) loadOrders(); }, [warehouseCode, type]); // eslint-disable-line

  /* ── 4. Fetch order detail on row click ── */
  async function openDetail(order: Order) {
    setSelected(order);
    setDetail(null);
    setItemsRaw([]);
    setActiveTab("info");
    setDetailLoading(true);

    const code = String(order.shippingOrderCode ?? order.orderCode ?? order.outboundCode ?? "");

    // detail + items in parallel
    const detailEndpoints = [
      `/api/wms/shipping/${type}/${code}`,
      `/api/wms/shipping/detail/${code}`,
      `/api/wms/shipping/${code}`,
      `/api/wms/outbound/${type}/${code}`,
      `/api/wms/outbound/detail/${code}`,
    ];
    const itemEndpoints = [
      `/api/wms/shipping/${type}/items/${code}`,
      `/api/wms/shipping/items/${code}`,
    ];

    // fetch detail
    let detailFound = false;
    for (const ep of detailEndpoints) {
      try {
        const res  = await fetch(ep, { headers });
        const json = await res.json();
        const d    = json?.data ?? json;
        if (res.ok && d && typeof d === "object" && !Array.isArray(d)) {
          setDetail(d as Order); setDetailLoading(false);
          detailFound = true;
          break;
        }
      } catch { /* try next */ }
    }
    // fallback: show list row data as-is
    if (!detailFound) { setDetail(order); setDetailLoading(false); }

    // fetch items (best-effort, non-blocking)
    for (const ep of itemEndpoints) {
      try {
        const res  = await fetch(ep, { headers });
        const json = await res.json().catch(() => null);
        const list = json?.data?.items ?? json?.data?.list ?? json?.data ?? (Array.isArray(json) ? json : null);
        if (res.ok && Array.isArray(list) && list.length > 0) {
          setItemsRaw(list); break;
        }
      } catch { /* ignore */ }
    }
  }

  function closeDetail() {
    setSelected(null); setDetail(null); setItemsRaw([]);
    setEditMode(false); setEditData({}); setSaveError("");
  }

  function startEdit() {
    setEditData({ ...(detail ?? selected ?? {}) });
    setEditMode(true);
    setSaveError("");
  }

  function cancelEdit() {
    setEditMode(false);
    setEditData({});
    setSaveError("");
  }

  async function saveEdit() {
    setSaving(true);
    setSaveError("");
    const code = String(
      editData.shippingOrderCode ?? editData.orderCode ?? editData.outboundCode ?? ""
    );
    const attempts = [
      { url: `/api/wms/shipping/${type}/${code}`, method: "PUT"   },
      { url: `/api/wms/shipping/${type}/${code}`, method: "PATCH" },
      { url: `/api/wms/shipping/update/${code}`,  method: "PUT"   },
      { url: `/api/wms/shipping/update`,          method: "POST"  },
    ];
    for (const { url, method } of attempts) {
      try {
        const res = await fetch(url, { method, headers, body: JSON.stringify(editData) });
        if (res.ok) {
          setDetail(editData);
          setEditMode(false);
          setSaving(false);
          return;
        }
      } catch { /* try next */ }
    }
    setSaveError("저장 실패 — API 응답을 확인해주세요.");
    setSaving(false);
  }

  /* ── Derived ── */
  const cols = useMemo(() => {
    if (orders.length === 0) return [];
    const keys     = Object.keys(orders[0]);
    const priority = Object.keys(COL_LABELS);
    return [...priority.filter((k) => keys.includes(k)), ...keys.filter((k) => !priority.includes(k))].slice(0, 10);
  }, [orders]);

  const colOptions = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const c of cols) {
      const vals = Array.from(new Set(orders.map((o) => String(o[c] ?? "")).filter(Boolean))).sort();
      if (vals.length > 1 && vals.length <= 100) map[c] = vals;
    }
    return map;
  }, [orders, cols]);

  const filtered = useMemo(() => {
    let list = orders;
    if (customerCode && customerCode !== "ALL") list = list.filter((o) => String(o.customerCode ?? "") === customerCode);
    for (const [col, val] of Object.entries(colFilters)) { if (val) list = list.filter((o) => String(o[col] ?? "") === val); }
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((o) => Object.values(o).some((v) => String(v).toLowerCase().includes(q)));
    return list;
  }, [orders, customerCode, colFilters, search]);

  const statusSummary = useMemo(() => {
    const map: Record<string, number> = {};
    for (const o of orders) { const s = String(o.status ?? o.orderStatus ?? "UNKNOWN"); map[s] = (map[s] ?? 0) + 1; }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [orders]);

  const activeFilters = Object.entries(colFilters).filter(([, v]) => v);
  function clearAllFilters() { setColFilters({}); setSearch(""); }

  async function downloadExcel() {
    const { utils, writeFile } = await import("xlsx");
    const rows = filtered.map((o) => Object.fromEntries(cols.map((c) => [COL_LABELS[c] ?? c, String(o[c] ?? "")])));
    const ws = utils.json_to_sheet(rows); const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, meta.label);
    writeFile(wb, `${type}_shipping_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  /* ── Detail modal content ── */
  const d = detail ?? selected ?? {};
  const orderCode = String(d.shippingOrderCode ?? d.orderCode ?? d.outboundCode ?? "");

  /* edit field helper: read from editData in edit mode, d otherwise */
  const ef = (key: string) => editMode
    ? { value: editData[key], onChange: (v: string) => setEditData((p) => ({ ...p, [key]: v })) }
    : { value: d[key] };
  const itemList: Order[] =
    itemsRaw.length > 0 ? itemsRaw
    : Array.isArray(d.itemList ?? d.items ?? d.shippingItemList)
      ? (d.itemList ?? d.items ?? d.shippingItemList) as Order[]
      : [];

  /* Fields to skip in "extra" section */
  const SKIP_FIELDS = new Set([
    "shippingOrderCode","orderCode","outboundCode","status","orderStatus","statusName",
    "warehouseCode","warehouseName","customerCode","customerName",
    "orderDate","shippingDate","requestDate","deliveryDate",
    "totalQty","qty","trackingNo","trackingNumber",
    "receiverName","receiverPhone","deliveryAddress","zipCode",
    "itemList","items","shippingItemList","documentList",
    "shippingOrderNo","orderType",
    "totalWeight","length","width","height",
    "invoiceValue","fareValue","fareEtcValue","insuranceValue","shippingRate","shippingCost",
    "consignorName","consignorAddress1","consignorCity","consignorState",
    "consignorZip","consignorZipCode","consignorNationalCode","consignorTelLno",
    "consigneeName","consigneeAddress1","consigneeAddress2","consigneeCity","consigneeState",
    "consigneeZipCode","consigneeNationalCode","consigneeTelLno","consigneeCellNo",
    "consigneeDeliveryMessage","consigneeEtc1","consigneeEtc2",
    "comment",
  ]);

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

      {/* ── Top filters ── */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select value={warehouseCode} onChange={(e) => { setWarehouseCode(e.target.value); loadOrders(e.target.value, customerCode); }}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          {warehouses.length === 0 && <option value="">Loading...</option>}
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name || w.id}</option>)}
        </select>
        {customers.length > 0 && (
          <select value={customerCode} onChange={(e) => { setCustomerCode(e.target.value); loadOrders(warehouseCode, e.target.value); }}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="ALL">All Customers</option>
            {customers.map((c) => <option key={c.code} value={c.code}>{c.name || c.code}</option>)}
          </select>
        )}
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order, customer, tracking..."
            className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {(activeFilters.length > 0 || search) && (
          <button onClick={clearAllFilters}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-600 border border-slate-200 hover:border-red-200 rounded-lg px-3 py-2 hover:bg-red-50 transition-colors">
            <X className="w-3.5 h-3.5" /> Clear filters
          </button>
        )}
      </div>

      {/* ── Active filter chips ── */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {activeFilters.map(([col, val]) => {
            const isStatus = col.toLowerCase().includes("status");
            return (
              <span key={col} className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${isStatus ? statusBadge(val) : "bg-blue-50 text-blue-700 border-blue-200"}`}>
                <span className="opacity-60">{COL_LABELS[col] ?? col}:</span>
                {isStatus ? statusLabel(val) : val}
                <button onClick={() => setColFilters((f) => { const n = { ...f }; delete n[col]; return n; })} className="hover:opacity-60"><X className="w-3 h-3" /></button>
              </span>
            );
          })}
        </div>
      )}

      {/* ── Status pills (clickable filter) ── */}
      {statusSummary.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {statusSummary.map(([s, c]) => {
            const statusCol = cols.find((col) => col === "status" || col === "orderStatus") ?? "status";
            const isActive  = colFilters[statusCol] === s;
            return (
              <button key={s}
                onClick={() => setColFilters((f) => ({ ...f, [statusCol]: isActive ? "" : s }))}
                className={`text-xs font-semibold px-3 py-1 rounded-full border transition-all ${statusBadge(s)} ${isActive ? "ring-2 ring-offset-1 ring-current scale-105" : "hover:scale-105 opacity-80 hover:opacity-100"}`}>
                {statusLabel(s)} <span className="opacity-60">· {c}</span>
              </button>
            );
          })}
          <span className="ml-auto text-xs text-slate-400 self-center">
            {filtered.length !== orders.length ? `${filtered.length.toLocaleString()} / ${orders.length.toLocaleString()}` : `${orders.length.toLocaleString()} total`}
          </span>
        </div>
      )}

      {error && <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-5"><AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}</div>}
      {loading && <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-100 h-11 animate-pulse" />)}</div>}
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
                <tr className="bg-slate-50 border-b border-slate-100">
                  {cols.map((c) => (
                    <th key={c} className="px-4 py-2.5 text-left text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">
                      {COL_LABELS[c] ?? c}
                    </th>
                  ))}
                </tr>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {cols.map((c) => {
                    const opts   = colOptions[c];
                    const active = !!colFilters[c];
                    return (
                      <th key={c} className="px-2 py-1.5">
                        {opts ? (
                          <select value={colFilters[c] ?? ""} onChange={(e) => setColFilters((f) => ({ ...f, [c]: e.target.value }))}
                            className={`w-full text-xs rounded border py-1 px-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 transition-colors ${active ? "border-blue-400 bg-blue-50 text-blue-700 font-medium" : "border-slate-200 bg-white text-slate-500"}`}>
                            <option value="">All</option>
                            {opts.map((v) => {
                              const isSt = c.toLowerCase().includes("status");
                              return <option key={v} value={v}>{isSt ? statusLabel(v) : v}</option>;
                            })}
                          </select>
                        ) : <div className="h-6" />}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filtered.map((order, idx) => (
                  <tr key={idx} onClick={() => openDetail(order)}
                    className="border-b border-slate-100 last:border-0 hover:bg-blue-50 cursor-pointer transition-colors group">
                    {cols.map((c) => {
                      const val      = String(order[c] ?? "-");
                      const isStatus = c.toLowerCase().includes("status");
                      const isMono   = c.toLowerCase().includes("code") || c.toLowerCase().includes("no") || c.toLowerCase().includes("tracking");
                      return (
                        <td key={c} className="px-4 py-2.5 whitespace-nowrap">
                          {isStatus ? (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${statusBadge(val)}`}>{statusLabel(val)}</span>
                          ) : isMono ? (
                            <span className="font-mono font-medium text-slate-700 group-hover:text-blue-700">{val}</span>
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

      {/* ── Detail Modal ── */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/50" onClick={closeDetail} />
          <div className="relative w-full max-w-4xl bg-white shadow-2xl flex flex-col rounded-2xl overflow-hidden" style={{ height: "88vh" }}>

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className={`w-7 h-7 rounded-lg ${meta.accent} flex items-center justify-center`}>
                  <Icon className="w-3.5 h-3.5 text-white" />
                </div>
                <div>
                  <h2 className="font-semibold text-slate-900 text-sm">{meta.label} — {orderCode}</h2>
                  {!!d.status && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border mt-0.5 inline-block ${statusBadge(String(d.status ?? d.orderStatus))}`}>
                      {statusLabel(String(d.status ?? d.orderStatus))}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!editMode ? (
                  <button onClick={startEdit}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                    Edit
                  </button>
                ) : (
                  <>
                    <button onClick={cancelEdit}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                      Cancel
                    </button>
                    <button onClick={saveEdit} disabled={saving}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                      {saving ? "Saving…" : "Save"}
                    </button>
                  </>
                )}
                <button onClick={closeDetail} className="text-slate-400 hover:text-slate-700 transition-colors ml-1">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            {saveError && (
              <div className="px-6 py-2 bg-red-50 border-b border-red-100 text-xs text-red-600 flex-shrink-0">{saveError}</div>
            )}

            {/* Tabs */}
            <div className="flex border-b border-slate-200 px-6 flex-shrink-0 overflow-x-auto">
              {(["info", "address", "package", "additional", "items", "raw"] as const).map((tab) => {
                const label =
                  tab === "info"       ? "Info"
                  : tab === "address"  ? "Address"
                  : tab === "package"  ? "Package"
                  : tab === "additional" ? "Additional"
                  : tab === "items"    ? `Items${itemList.length ? ` (${itemList.length})` : ""}`
                  : "Raw";
                return (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                    className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${activeTab === tab ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Content */}
            {detailLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">

                {/* ── Info tab ── */}
                {activeTab === "info" && (
                  <div className="p-6 space-y-5">
                    <div className="grid grid-cols-3 gap-4">
                      <Field label="Order Code"    value={d.shippingOrderCode ?? d.orderCode ?? d.outboundCode} />
                      <Field label="Customer"      value={d.customerName ?? d.customerCode} />
                      <div>
                        <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Status</p>
                        <span className={`text-sm font-semibold px-2.5 py-1 rounded-full border ${statusBadge(String(d.status ?? d.orderStatus ?? ""))}`}>
                          {statusLabel(String(d.status ?? d.orderStatus ?? "-"))}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <Field label="Warehouse"     value={d.warehouseName ?? d.warehouseCode} />
                      <Field label="Order Date"    {...ef("orderDate")} />
                      <Field label="Ship Date"     {...ef("shippingDate")} />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <Field label="Total Qty"     {...ef("totalQty")} />
                      <Field label="Tracking #"    {...ef("trackingNo")} />
                      <Field label="Delivery Date" {...ef("deliveryDate")} />
                    </div>
                    {!!(d.shippingOrderNo || d.orderType || editMode) && (
                      <div className="grid grid-cols-3 gap-4 pt-2 border-t border-slate-100">
                        <Field label="Shipping Order No" {...ef("shippingOrderNo")} />
                        <Field label="Order Type"        {...ef("orderType")} />
                      </div>
                    )}
                  </div>
                )}

                {/* ── Address tab ── */}
                {activeTab === "address" && (
                  <div className="p-6 space-y-6">
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wide mb-3">Consignee</p>
                      <div className="grid grid-cols-3 gap-4">
                        <Field label="Name"             {...ef("consigneeName")} />
                        <Field label="Tel"              {...ef("consigneeTelLno")} />
                        <Field label="Cell"             {...ef("consigneeCellNo")} />
                        <Field label="Address"          {...ef("consigneeAddress1")} />
                        <Field label="Address 2"        {...ef("consigneeAddress2")} />
                        <Field label="City"             {...ef("consigneeCity")} />
                        <Field label="State"            {...ef("consigneeState")} />
                        <Field label="ZIP"              {...ef("consigneeZipCode")} />
                        <Field label="Country"          {...ef("consigneeNationalCode")} />
                        <div className="col-span-3">
                          <Field label="Delivery Message" {...ef("consigneeDeliveryMessage")} />
                        </div>
                      </div>
                    </div>
                    {!!(d.consignorName || d.consignorAddress1 || editMode) && (
                      <div className="border-t border-slate-100 pt-5">
                        <p className="text-xs text-slate-400 uppercase tracking-wide mb-3">Consignor</p>
                        <div className="grid grid-cols-3 gap-4">
                          <Field label="Name"    {...ef("consignorName")} />
                          <Field label="Tel"     {...ef("consignorTelLno")} />
                          <Field label="Country" {...ef("consignorNationalCode")} />
                          <Field label="Address" {...ef("consignorAddress1")} />
                          <Field label="City"    {...ef("consignorCity")} />
                          <Field label="State"   {...ef("consignorState")} />
                          <Field label="ZIP"     {...ef("consignorZipCode")} />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Package tab ── */}
                {activeTab === "package" && (
                  <div className="p-6 space-y-6">
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wide mb-3">Dimensions</p>
                      <div className="grid grid-cols-4 gap-4">
                        <Field label="Total Weight" {...ef("totalWeight")} />
                        <Field label="Length"       {...ef("length")} />
                        <Field label="Width"        {...ef("width")} />
                        <Field label="Height"       {...ef("height")} />
                      </div>
                    </div>
                    <div className="border-t border-slate-100 pt-5">
                      <p className="text-xs text-slate-400 uppercase tracking-wide mb-3">Financial</p>
                      <div className="grid grid-cols-3 gap-4">
                        <Field label="Invoice Value"   {...ef("invoiceValue")} />
                        <Field label="Fare Value"      {...ef("fareValue")} />
                        <Field label="Fare Etc"        {...ef("fareEtcValue")} />
                        <Field label="Insurance Value" {...ef("insuranceValue")} />
                        <Field label="Shipping Rate"   {...ef("shippingRate")} />
                        <Field label="Shipping Cost"   {...ef("shippingCost")} />
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Additional tab ── */}
                {activeTab === "additional" && (
                  <div className="p-6 space-y-5">
                    <div>
                      <Field label="Comment" {...ef("comment")} />
                    </div>
                    {(() => {
                      const src = editMode ? editData : d;
                      const extra = Object.entries(src).filter(([k, v]) =>
                        !SKIP_FIELDS.has(k) && v != null && v !== "" && !Array.isArray(v) && typeof v !== "object"
                      );
                      if (!extra.length) return null;
                      return (
                        <div className="border-t border-slate-100 pt-5">
                          <div className="grid grid-cols-3 gap-4">
                            {extra.map(([k]) => <Field key={k} label={COL_LABELS[k] ?? k} {...ef(k)} />)}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* ── Items tab ── */}
                {activeTab === "items" && (
                  <div className="p-6">
                    {itemList.length === 0 ? (
                      <div className="text-center py-16 text-slate-400">
                        <p className="text-sm">No item data available</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200">
                              {Object.keys(itemList[0]).slice(0, 10).map((k) => (
                                <th key={k} className="px-4 py-2.5 text-left text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">{k}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {itemList.map((item, i) => (
                              <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                                {Object.keys(itemList[0]).slice(0, 10).map((k) => (
                                  <td key={k} className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{String(item[k] ?? "-")}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Raw tab ── */}
                {activeTab === "raw" && (
                  <div className="p-6">
                    <pre className="bg-slate-900 text-green-400 rounded-xl p-4 text-xs overflow-auto max-h-[60vh]">
                      {JSON.stringify(d, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
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
