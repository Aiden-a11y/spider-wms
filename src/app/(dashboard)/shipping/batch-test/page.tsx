"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import {
  Layers, RefreshCw, Loader2, ChevronDown, ChevronUp, Search,
  Package, Calendar, Warehouse, Users, CheckCircle2, Clock, AlertCircle, Truck,
  MapPin, Printer, X, Tag,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

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

type SkuEntry = { sku: string; name: string; qtyPerOrder: number; totalQty: number };

type StockOption = {
  location: string; lotNo: string; itemCondition: string; expireDate: string;
  stockQty: number; allocQty: number; availQty: number;
  zoneNm: string; aisleNm: string; bayNm: string; levelNm: string; positionNm: string;
};

type SkuAssignState = {
  loading: boolean; options: StockOption[]; selected: string | null;
  assigning: boolean; result: "ok" | "error" | null; message: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function locLabel(s: StockOption) {
  return [s.zoneNm, s.aisleNm, s.bayNm, s.levelNm, s.positionNm].filter(Boolean).join("-");
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function StatusBadge({ status, name }: { status: string; name: string }) {
  const label = name || status;
  if (status === "FA" || name.toLowerCase().includes("complete"))
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200"><CheckCircle2 className="w-3 h-3" />{label}</span>;
  if (status === "AR" || name.toLowerCase().includes("label"))
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200"><Tag className="w-3 h-3" />{label}</span>;
  if (status === "AA" || name.toLowerCase().includes("request") || name.toLowerCase().includes("outbound"))
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200"><Clock className="w-3 h-3" />{label}</span>;
  if (name.toLowerCase().includes("pick") || name.toLowerCase().includes("progress"))
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200"><Loader2 className="w-3 h-3" />{label}</span>;
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">{label || status}</span>;
}

const EMPTY_SKU_STATE: SkuAssignState = { loading: false, options: [], selected: null, assigning: false, result: null, message: "" };

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BatchTestPage() {
  const { user } = useAuth();
  const router = useRouter();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  useEffect(() => { if (!user) router.replace("/"); }, [user, router]);

  const today = new Date().toISOString().slice(0, 10);
  const todayCompact = today.replace(/-/g, "");

  // Batch list
  const [batches, setBatches] = useState<WmsBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filterDate, setFilterDate] = useState(today);
  const [warehouseCode, setWarehouseCode] = useState("STOO1");
  const [customerCode, setCustomerCode] = useState("FCOUS");

  // Order table (expand)
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [orders, setOrders] = useState<Record<string, WmsOrder[]>>({});
  const [loadingOrders, setLoadingOrders] = useState<Record<string, boolean>>({});

  // Assign panel
  const [assignPanelCode, setAssignPanelCode] = useState<string | null>(null);
  const [batchSkus, setBatchSkus] = useState<Record<string, SkuEntry[]>>({});
  const [loadingSkus, setLoadingSkus] = useState<Record<string, boolean>>({});
  const [skuState, setSkuState] = useState<Record<string, SkuAssignState>>({});
  const [assignProgress, setAssignProgress] = useState<{ batchCode: string; sku: string; done: number; total: number } | null>(null);

  // Label request
  const [labelRequesting, setLabelRequesting] = useState<Record<string, boolean>>({});
  const [labelResult, setLabelResult] = useState<Record<string, { ok: boolean; msg: string }>>({});

  // ── Load batch list ────────────────────────────────────────────────────────
  const loadBatches = useCallback(async () => {
    setLoading(true); setError(""); setBatches([]);
    try {
      const from = new Date(); from.setDate(from.getDate() - 90);
      const dateFrom = from.toISOString().slice(0, 10).replace(/-/g, "");
      const res = await fetch("/api/wms/batch/list", {
        method: "POST", headers,
        body: JSON.stringify({ searchText: "", warehouseCode, customerCode, dateFrom, dateTo: todayCompact }),
      });
      const json = await res.json();
      const list: WmsBatch[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      setBatches(list);
      if (!json?.isSuccess && list.length === 0) setError(json?.message ?? "No data returned");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally { setLoading(false); }
  }, [warehouseCode, customerCode, todayCompact, headers]);

  useEffect(() => { loadBatches(); }, [loadBatches]); // eslint-disable-line

  // ── Load orders (for table) ────────────────────────────────────────────────
  async function loadBatchOrders(batchCode: string) {
    if (loadingOrders[batchCode]) return;
    setLoadingOrders((p) => ({ ...p, [batchCode]: true }));
    try {
      const res = await fetch("/api/wms/batch/orders", { method: "POST", headers, body: JSON.stringify([batchCode]) });
      const json = await res.json();
      setOrders((p) => ({ ...p, [batchCode]: Array.isArray(json?.data) ? json.data : [] }));
    } catch { setOrders((p) => ({ ...p, [batchCode]: [] })); }
    finally { setLoadingOrders((p) => ({ ...p, [batchCode]: false })); }
  }

  function toggleOrderTable(batchCode: string) {
    if (expandedCode === batchCode) { setExpandedCode(null); return; }
    setExpandedCode(batchCode);
    if (!orders[batchCode]) loadBatchOrders(batchCode);
  }

  // ── Load SKUs for assign panel ─────────────────────────────────────────────
  async function loadSkus(batch: WmsBatch) {
    if (loadingSkus[batch.batchCode] || batchSkus[batch.batchCode]) return;
    setLoadingSkus((p) => ({ ...p, [batch.batchCode]: true }));
    try {
      const ordRes = await fetch("/api/wms/batch/orders", { method: "POST", headers, body: JSON.stringify([batch.batchCode]) });
      const ordJson = await ordRes.json();
      const bOrders: WmsOrder[] = Array.isArray(ordJson?.data) ? ordJson.data : [];
      setOrders((p) => ({ ...p, [batch.batchCode]: bOrders })); // cache for table too

      if (!bOrders.length) return;
      const firstCode = bOrders[0].shippingOrderCode;
      const itemRes = await fetch(`/api/wms/shipping/items/${encodeURIComponent(firstCode)}`, { headers });
      const itemJson = await itemRes.json();
      const items: Record<string, unknown>[] = Array.isArray(itemJson?.data?.items) ? itemJson.data.items : [];
      setBatchSkus((p) => ({
        ...p,
        [batch.batchCode]: items
          .map((it) => ({
            sku: String(it.productSku ?? ""),
            name: String(it.productName ?? ""),
            qtyPerOrder: Number(it.qty ?? 0),
            totalQty: Number(it.qty ?? 0) * batch.orderCount,
          }))
          .filter((s) => s.sku),
      }));
    } catch { setBatchSkus((p) => ({ ...p, [batch.batchCode]: [] })); }
    finally { setLoadingSkus((p) => ({ ...p, [batch.batchCode]: false })); }
  }

  function toggleAssignPanel(batch: WmsBatch) {
    if (assignPanelCode === batch.batchCode) { setAssignPanelCode(null); return; }
    setAssignPanelCode(batch.batchCode);
    loadSkus(batch);
  }

  // ── SKU state helpers ──────────────────────────────────────────────────────
  function skuKey(batchCode: string, sku: string) { return `${batchCode}:${sku}`; }
  function getSkuState(batchCode: string, sku: string): SkuAssignState {
    return skuState[skuKey(batchCode, sku)] ?? EMPTY_SKU_STATE;
  }
  function setSkuField<K extends keyof SkuAssignState>(batchCode: string, sku: string, field: K, value: SkuAssignState[K]) {
    const key = skuKey(batchCode, sku);
    setSkuState((prev) => ({ ...prev, [key]: { ...(prev[key] ?? EMPTY_SKU_STATE), [field]: value } }));
  }

  // ── Load locations for SKU ─────────────────────────────────────────────────
  async function loadLocations(batch: WmsBatch, sku: string) {
    setSkuField(batch.batchCode, sku, "loading", true);
    setSkuField(batch.batchCode, sku, "result", null);
    setSkuField(batch.batchCode, sku, "message", "");
    try {
      const res = await fetch(
        `/api/wms/shipping/available-stock/${encodeURIComponent(batch.warehouseCode)}/${encodeURIComponent(batch.customerCode)}?productSku=${encodeURIComponent(sku)}`,
        { headers }
      );
      const json = await res.json().catch(() => ({}));
      const list: StockOption[] = Array.isArray((json as Record<string, unknown>).data)
        ? (json as Record<string, unknown>).data as StockOption[] : [];
      const good = list
        .filter((s) => String(s.itemCondition ?? "").toUpperCase() === "GOOD" && Number(s.availQty ?? 0) > 0)
        .sort((a, b) => (String(a.expireDate ?? "") || "99999999").localeCompare(String(b.expireDate ?? "") || "99999999"));
      const key = skuKey(batch.batchCode, sku);
      setSkuState((prev) => ({ ...prev, [key]: { ...(prev[key] ?? EMPTY_SKU_STATE), loading: false, options: good, selected: good[0]?.location ?? null } }));
    } catch { setSkuField(batch.batchCode, sku, "loading", false); }
  }

  // ── Assign SKU to all orders ───────────────────────────────────────────────
  async function assignSku(batch: WmsBatch, skuEntry: SkuEntry) {
    const state = getSkuState(batch.batchCode, skuEntry.sku);
    if (!state.selected) return;
    const stockOption = state.options.find((o) => o.location === state.selected);
    if (!stockOption) return;

    const bOrders = orders[batch.batchCode] ?? [];
    if (!bOrders.length) return;

    setSkuField(batch.batchCode, skuEntry.sku, "assigning", true);
    setSkuField(batch.batchCode, skuEntry.sku, "result", null);
    setSkuField(batch.batchCode, skuEntry.sku, "message", "");
    setAssignProgress({ batchCode: batch.batchCode, sku: skuEntry.sku, done: 0, total: bOrders.length });

    let done = 0;
    const issues: string[] = [];

    for (const order of bOrders) {
      const orderCode = order.shippingOrderCode;
      try {
        const itemsRes = await fetch(`/api/wms/shipping/items/${encodeURIComponent(orderCode)}`, { headers });
        const itemsJson = await itemsRes.json().catch(() => ({}));
        const ijData = ((itemsJson as Record<string, unknown>)?.data ?? {}) as Record<string, unknown>;
        const items = (Array.isArray(ijData.items) ? ijData.items : []) as Record<string, unknown>[];
        const lineItem = items.find((it) => String(it.productSku ?? "") === skuEntry.sku);
        if (!lineItem) { issues.push(`${orderCode}: SKU not found`); done++; setAssignProgress((p) => p ? { ...p, done: done } : null); continue; }
        const qty = Number(lineItem.unassignedQty ?? lineItem.qty ?? skuEntry.qtyPerOrder);
        if (qty <= 0) { done++; setAssignProgress((p) => p ? { ...p, done: done } : null); continue; }

        const body = {
          shippingOrderCode: orderCode,
          shippingItemId: lineItem.shippingItemId,
          customerCode: order.customerCode,
          warehouseCode: batch.warehouseCode,
          warehouseCd: stockOption.location,
          productSku: skuEntry.sku,
          lotNo: stockOption.lotNo ?? "",
          expireDate: stockOption.expireDate ?? "",
          itemCondition: stockOption.itemCondition ?? "GOOD",
          qty,
        };
        const r = await fetch("/api/wms/shipping/assign", { method: "POST", headers, body: JSON.stringify(body) });
        const rj = await r.json().catch(() => ({}));
        if (!r.ok || !(rj as Record<string, unknown>)?.isSuccess) {
          issues.push(`${orderCode}: ${String((rj as Record<string, unknown>)?.message ?? "failed")}`);
        }
      } catch (e) { issues.push(`${orderCode}: ${e instanceof Error ? e.message : "error"}`); }
      done++;
      setAssignProgress((p) => p ? { ...p, done: done } : null);
      await sleep(200);
    }

    setAssignProgress(null);
    const ok = issues.length === 0;
    const ll = locLabel(stockOption) || stockOption.location;
    setSkuField(batch.batchCode, skuEntry.sku, "assigning", false);
    setSkuField(batch.batchCode, skuEntry.sku, "result", ok ? "ok" : "error");
    setSkuField(batch.batchCode, skuEntry.sku, "message", ok
      ? `Assigned ×${skuEntry.qtyPerOrder} to ${bOrders.length} orders from ${ll}. Total: ${skuEntry.totalQty} units.`
      : `${done - issues.length} ok, ${issues.length} issue(s): ${issues.slice(0, 2).join("; ")}${issues.length > 2 ? "…" : ""}`
    );
  }

  // ── AR Label Request ───────────────────────────────────────────────────────
  async function requestLabels(batch: WmsBatch) {
    let bOrders = orders[batch.batchCode];
    if (!bOrders) {
      const r = await fetch("/api/wms/batch/orders", { method: "POST", headers, body: JSON.stringify([batch.batchCode]) });
      const j = await r.json();
      bOrders = Array.isArray(j?.data) ? j.data : [];
      setOrders((p) => ({ ...p, [batch.batchCode]: bOrders! }));
    }
    if (!bOrders.length) return;

    setLabelRequesting((p) => ({ ...p, [batch.batchCode]: true }));
    setLabelResult((p) => { const n = { ...p }; delete n[batch.batchCode]; return n; });
    try {
      const orderCodes = bOrders.map((o) => o.shippingOrderCode);
      const res = await fetch("/api/wms/shipping/status-change", {
        method: "POST", headers,
        body: JSON.stringify({ warehouseCode: batch.warehouseCode, customerCode: batch.customerCode, orderCodes, newStatus: "AR", completeDate: "", cancelComment: "" }),
      });
      const json = await res.json().catch(() => ({}));
      const ok = !!(res.ok && ((json as Record<string, unknown>)?.isSuccess ?? true));
      setLabelResult((p) => ({ ...p, [batch.batchCode]: { ok, msg: ok ? `${orderCodes.length} orders → AR (Auto Label Request)` : String((json as Record<string, unknown>)?.message ?? "Failed") } }));
      if (ok) {
        setOrders((p) => { const n = { ...p }; delete n[batch.batchCode]; return n; });
        loadBatchOrders(batch.batchCode);
      }
    } catch (e) {
      setLabelResult((p) => ({ ...p, [batch.batchCode]: { ok: false, msg: e instanceof Error ? e.message : "Error" } }));
    } finally { setLabelRequesting((p) => ({ ...p, [batch.batchCode]: false })); }
  }

  // ── Filters ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = batches;
    if (filterDate) { const c = filterDate.replace(/-/g, ""); list = list.filter((b) => b.batchDate === c); }
    const q = search.toLowerCase();
    if (q) list = list.filter((b) => b.batchName.toLowerCase().includes(q) || b.batchCode.toLowerCase().includes(q) || b.customerCode.toLowerCase().includes(q));
    return list;
  }, [batches, filterDate, search]);

  const availableDates = useMemo(() => {
    const seen: Record<string, boolean> = {};
    batches.forEach((b) => { seen[b.batchDate.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")] = true; });
    return Object.keys(seen).sort().reverse();
  }, [batches]);

  // ── Render ─────────────────────────────────────────────────────────────────
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
              <p className="text-sm text-slate-500">Assign locations · Request labels · Print tickets</p>
            </div>
          </div>
          <button onClick={loadBatches} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />Refresh
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
          <button onClick={loadBatches} disabled={loading}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
            Reload
          </button>
          <div className="flex items-end gap-2 ml-2">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Date filter</label>
              <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <button onClick={() => setFilterDate("")}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${!filterDate ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"}`}>
              All dates
            </button>
          </div>
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

        {/* Summary bar */}
        {!loading && batches.length > 0 && (
          <div className="flex items-center gap-3 mb-3 text-sm text-slate-500">
            <span>Showing <span className="font-semibold text-slate-900">{filtered.length}</span>{filtered.length !== batches.length && <> of {batches.length} total</>} batch{filtered.length !== 1 ? "es" : ""}</span>
            {filterDate && <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5">{filterDate === today ? "Today" : filterDate}</span>}
            {availableDates.length > 1 && (
              <div className="flex items-center gap-1 ml-auto text-xs text-slate-400">
                {availableDates.slice(0, 7).map((d) => (
                  <button key={d} onClick={() => setFilterDate(d)}
                    className={`px-2 py-0.5 rounded-full border transition-colors ${filterDate === d ? "bg-blue-600 text-white border-blue-600" : "border-slate-200 hover:bg-slate-100"}`}>
                    {d.slice(5)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Batch list */}
        {!loading && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map((batch) => {
              const isOrdersOpen = expandedCode === batch.batchCode;
              const isAssignOpen = assignPanelCode === batch.batchCode;
              const bOrders = orders[batch.batchCode] ?? [];
              const isLoadingO = loadingOrders[batch.batchCode];
              const skus = batchSkus[batch.batchCode] ?? [];
              const isLoadingSkus = loadingSkus[batch.batchCode];
              const isLabelRequesting = labelRequesting[batch.batchCode];
              const lResult = labelResult[batch.batchCode];

              const printUrl = `/wms-batch-print?batchCode=${encodeURIComponent(batch.batchCode)}&batchName=${encodeURIComponent(batch.batchName)}&batchDate=${encodeURIComponent(batch.batchDate)}&warehouseCode=${encodeURIComponent(batch.warehouseCode)}&customerCode=${encodeURIComponent(batch.customerCode)}&orderCount=${batch.orderCount}`;

              return (
                <div key={batch.batchCode} className={`bg-white border rounded-2xl shadow-sm overflow-hidden transition-colors ${isAssignOpen ? "border-violet-200" : "border-slate-200"}`}>

                  {/* Header row */}
                  <div className={`px-5 py-4 flex items-center gap-3 ${isAssignOpen ? "bg-violet-50/40" : ""}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-slate-900">{batch.batchName}</span>
                        <span className="text-xs text-slate-400 font-mono">{batch.batchCode}</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-400">
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{batch.batchDate.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")}</span>
                        <span className="flex items-center gap-1"><Warehouse className="w-3 h-3" />{batch.warehouseCode}</span>
                        <span className="flex items-center gap-1"><Users className="w-3 h-3" />{batch.customerCode}</span>
                        <span>by {batch.createdBy}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button onClick={() => window.open(printUrl, "_blank")}
                        className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors" title="Print Pick Ticket (4×6)">
                        <Printer className="w-4 h-4" />
                      </button>

                      {/* Order count + table toggle */}
                      <button onClick={() => toggleOrderTable(batch.batchCode)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                        <Package className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-bold">{batch.orderCount}</span>
                        {isOrdersOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {/* Assign button */}
                      <button onClick={() => toggleAssignPanel(batch)}
                        className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${isAssignOpen ? "bg-slate-100 text-slate-600 hover:bg-slate-200" : "bg-violet-600 text-white hover:bg-violet-700"}`}>
                        <MapPin className="w-3.5 h-3.5" />
                        {isAssignOpen ? "Close" : "Assign"}
                      </button>
                    </div>
                  </div>

                  {/* Label result banner */}
                  {lResult && (
                    <div className={`flex items-center gap-2 mx-5 mb-3 px-4 py-2.5 rounded-xl text-sm ${lResult.ok ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-700"}`}>
                      {lResult.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                      <span className="font-medium flex-1">{lResult.msg}</span>
                      <button onClick={() => setLabelResult((p) => { const n = { ...p }; delete n[batch.batchCode]; return n; })} className="text-slate-400 hover:text-slate-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {/* ── Assign panel ─────────────────────────────────────── */}
                  {isAssignOpen && (
                    <div className="border-t border-violet-100 bg-slate-50/60">
                      <div className="px-5 py-3 flex items-center justify-between border-b border-slate-100">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Location Assignment — Total Pick</span>
                        <button onClick={() => requestLabels(batch)} disabled={isLabelRequesting}
                          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold transition-colors disabled:opacity-50">
                          {isLabelRequesting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Requesting…</> : <><Tag className="w-3.5 h-3.5" />AR – Label Request</>}
                        </button>
                      </div>

                      {isLoadingSkus && (
                        <div className="flex items-center justify-center py-8 text-slate-400 text-sm gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />Loading SKUs…
                        </div>
                      )}
                      {!isLoadingSkus && skus.length === 0 && (
                        <div className="text-center py-6 text-slate-400 text-sm">No SKUs found.</div>
                      )}

                      {!isLoadingSkus && skus.length > 0 && (
                        <div className="divide-y divide-slate-100">
                          {skus.map((skuEntry) => {
                            const state = getSkuState(batch.batchCode, skuEntry.sku);
                            const isActive = assignProgress?.batchCode === batch.batchCode && assignProgress.sku === skuEntry.sku;

                            return (
                              <div key={skuEntry.sku} className="px-5 py-4">
                                {/* SKU header */}
                                <div className="flex items-start justify-between gap-4 mb-3">
                                  <div>
                                    <p className="font-mono text-base font-extrabold text-slate-900">{skuEntry.sku}</p>
                                    {skuEntry.name && <p className="text-sm text-slate-500 mt-0.5">{skuEntry.name}</p>}
                                    <div className="flex items-center gap-3 mt-1.5">
                                      <span className="text-sm text-slate-500">{skuEntry.qtyPerOrder}/order × {batch.orderCount} orders</span>
                                      <span className="text-base font-extrabold text-violet-700">= {skuEntry.totalQty} total</span>
                                    </div>
                                  </div>
                                  {state.options.length === 0 && !state.loading && (
                                    <button onClick={() => loadLocations(batch, skuEntry.sku)}
                                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-semibold transition-colors flex-shrink-0">
                                      <MapPin className="w-4 h-4" />Load Locations
                                    </button>
                                  )}
                                  {state.loading && <div className="flex items-center gap-1.5 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>}
                                </div>

                                {/* Location options */}
                                {state.options.length > 0 && (
                                  <div className="space-y-2">
                                    <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                                      {state.options.map((opt) => {
                                        const label = locLabel(opt) || opt.location;
                                        const isSel = state.selected === opt.location;
                                        return (
                                          <label key={opt.location} className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl border cursor-pointer transition-all ${isSel ? "border-violet-400 bg-violet-50" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                                            <input type="radio" name={skuKey(batch.batchCode, skuEntry.sku)} value={opt.location} checked={isSel}
                                              onChange={() => setSkuField(batch.batchCode, skuEntry.sku, "selected", opt.location)}
                                              className="accent-violet-600 w-4 h-4" />
                                            <div className="flex-1 min-w-0">
                                              <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-mono text-sm font-extrabold text-slate-900">{label}</span>
                                                {opt.lotNo && <span className="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">LOT: {opt.lotNo}</span>}
                                                {opt.expireDate && <span className="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">EXP: {opt.expireDate}</span>}
                                              </div>
                                              <div className="flex items-center gap-3 mt-0.5">
                                                <span className="text-sm font-bold text-green-700">Avail: {opt.availQty}</span>
                                                <span className="text-sm text-slate-400">Stock: {opt.stockQty}</span>
                                                {Number(opt.availQty) < skuEntry.totalQty && (
                                                  <span className="text-sm font-bold text-amber-600">⚠ Short {skuEntry.totalQty - Number(opt.availQty)}</span>
                                                )}
                                              </div>
                                            </div>
                                            <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${String(opt.itemCondition).toUpperCase() === "GOOD" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                                              {opt.itemCondition}
                                            </span>
                                          </label>
                                        );
                                      })}
                                    </div>

                                    {state.result && (
                                      <div className={`flex items-start gap-2 px-3.5 py-3 rounded-xl text-sm ${state.result === "ok" ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-700"}`}>
                                        {state.result === "ok" ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                                        <span className="font-medium flex-1">{state.message}</span>
                                        <button onClick={() => { setSkuField(batch.batchCode, skuEntry.sku, "result", null); setSkuField(batch.batchCode, skuEntry.sku, "message", ""); }} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
                                      </div>
                                    )}

                                    {isActive && assignProgress && (
                                      <div className="flex items-center gap-2 px-3.5 py-3 bg-violet-50 border border-violet-200 rounded-xl text-sm font-medium text-violet-700">
                                        <Loader2 className="w-4 h-4 animate-spin" />Assigning {assignProgress.done} / {assignProgress.total} orders…
                                      </div>
                                    )}

                                    {!state.result && (
                                      <button onClick={() => assignSku(batch, skuEntry)}
                                        disabled={!state.selected || state.assigning || !!assignProgress}
                                        className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                                        {state.assigning
                                          ? <><Loader2 className="w-4 h-4 animate-spin" />Assigning…</>
                                          : <><MapPin className="w-4 h-4" />Assign to All {batch.orderCount} Orders</>}
                                      </button>
                                    )}
                                    {state.result && (
                                      <button onClick={() => loadLocations(batch, skuEntry.sku)}
                                        className="w-full py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-sm font-semibold transition-colors">
                                        Reload Locations
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Order table ───────────────────────────────────────── */}
                  {isOrdersOpen && (
                    <div className="border-t border-slate-100">
                      {isLoadingO ? (
                        <div className="flex items-center justify-center py-6 text-slate-400 text-sm gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />Loading orders…
                        </div>
                      ) : !bOrders.length ? (
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
                                  <td className="px-4 py-2.5 font-mono text-slate-500 max-w-[160px] truncate">
                                    {o.trackingNo ? <span className="flex items-center gap-1"><Truck className="w-3 h-3 text-slate-400 flex-shrink-0" />{o.trackingNo}</span> : "—"}
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
