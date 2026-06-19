"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import { Layers, RefreshCw, Trash2, ChevronDown, ChevronUp, MapPin, Loader2, CheckCircle2, AlertCircle, X, Printer, History, CheckCheck } from "lucide-react";
import type { Batch } from "@/app/api/batch/route";

type StockOption = {
  location: string;
  lotNo: string;
  itemCondition: string;
  expireDate: string;
  stockQty: number;
  allocQty: number;
  availQty: number;
  zoneNm: string;
  aisleNm: string;
  bayNm: string;
  levelNm: string;
  positionNm: string;
};

type SkuAssignState = {
  loading: boolean;
  options: StockOption[];
  selected: string | null;
  assigning: boolean;
  result: "ok" | "error" | null;
  message: string;
};

function locationLabel(s: StockOption) {
  return [s.zoneNm, s.aisleNm, s.bayNm, s.levelNm, s.positionNm].filter(Boolean).join("-");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function BatchesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [skuState, setSkuState] = useState<Record<string, SkuAssignState>>({});
  const [assignProgress, setAssignProgress] = useState<{ done: number; total: number; batchId: string; sku: string } | null>(null);
  // per-batch assignment status: "checking" | "assigned" | "pending"
  const [assignStatus, setAssignStatus] = useState<Record<string, "checking" | "assigned" | "pending">>({});
  const [completedBatches, setCompletedBatches] = useState<Batch[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(new Set());

  async function checkBatchAssignStatus(batch: Batch, hdrs: Record<string, string>) {
    const firstOrder = batch.orders[0];
    if (!firstOrder) { setAssignStatus((p) => ({ ...p, [batch.id]: "pending" })); return; }
    try {
      const res = await fetch(`/api/wms/shipping/items/${encodeURIComponent(firstOrder.orderCode)}`, { headers: hdrs });
      const json = await res.json().catch(() => ({})) as Record<string, unknown>;
      const d = (json?.data ?? {}) as Record<string, unknown>;
      const assignments = Array.isArray(d.assignments) ? d.assignments : [];
      setAssignStatus((p) => ({ ...p, [batch.id]: assignments.length > 0 ? "assigned" : "pending" }));
    } catch {
      setAssignStatus((p) => ({ ...p, [batch.id]: "pending" }));
    }
  }

  async function loadBatches() {
    setLoading(true);
    setAssignStatus({});
    try {
      const res = await fetch("/api/batch");
      const data = await res.json();
      if (Array.isArray(data)) {
        setBatches(data);
        // mark all as "checking" first, then check each
        const init: Record<string, "checking"> = {};
        data.forEach((b: Batch) => { init[b.id] = "checking"; });
        setAssignStatus(init);
        data.forEach((b: Batch) => checkBatchAssignStatus(b, headers));
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const res = await fetch("/api/batch?completed=1");
      const data = await res.json();
      if (Array.isArray(data)) setCompletedBatches(data);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => { loadBatches(); loadHistory(); }, []); // eslint-disable-line

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteBatch(id: string) {
    setDeleting((prev) => new Set(prev).add(id));
    await fetch(`/api/batch?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setBatches((prev) => prev.filter((b) => b.id !== id));
    setDeleting((prev) => { const next = new Set(prev); next.delete(id); return next; });
  }

  function skuKey(batchId: string, sku: string) { return `${batchId}:${sku}`; }

  function getSkuState(batchId: string, sku: string): SkuAssignState {
    return skuState[skuKey(batchId, sku)] ?? { loading: false, options: [], selected: null, assigning: false, result: null, message: "" };
  }

  function setSkuField<K extends keyof SkuAssignState>(batchId: string, sku: string, field: K, value: SkuAssignState[K]) {
    const key = skuKey(batchId, sku);
    setSkuState((prev) => ({ ...prev, [key]: { ...(prev[key] ?? { loading: false, options: [], selected: null, assigning: false, result: null, message: "" }), [field]: value } }));
  }

  async function loadLocations(batch: Batch, sku: string) {
    const whCode = batch.warehouseCode;
    const custCode = batch.orders[0]?.customerCode ?? "";
    setSkuField(batch.id, sku, "loading", true);
    setSkuField(batch.id, sku, "result", null);
    setSkuField(batch.id, sku, "message", "");
    try {
      const res = await fetch(
        `/api/wms/shipping/available-stock/${encodeURIComponent(whCode)}/${encodeURIComponent(custCode)}?productSku=${encodeURIComponent(sku)}`,
        { headers }
      );
      const json = await res.json().catch(() => ({}));
      const list: StockOption[] = Array.isArray((json as Record<string,unknown>).data)
        ? (json as Record<string,unknown>).data as StockOption[]
        : [];
      const good = list
        .filter((s) => String(s.itemCondition ?? "").toUpperCase() === "GOOD" && Number(s.availQty ?? 0) > 0)
        .sort((a, b) => {
          const expA = String(a.expireDate ?? "") || "99999999";
          const expB = String(b.expireDate ?? "") || "99999999";
          return expA.localeCompare(expB);
        });
      const key = skuKey(batch.id, sku);
      setSkuState((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? { loading: false, options: [], selected: null, assigning: false, result: null, message: "" }), loading: false, options: good, selected: good[0]?.location ?? null },
      }));
    } catch {
      setSkuField(batch.id, sku, "loading", false);
    }
  }

  async function assignSku(batch: Batch, skuEntry: { sku: string; name: string; qty: number }) {
    const state = getSkuState(batch.id, skuEntry.sku);
    if (!state.selected) return;
    const stockOption = state.options.find((o) => o.location === state.selected);
    if (!stockOption) return;

    const totalQty = batch.orderCount * skuEntry.qty;
    const whCode = batch.warehouseCode;

    setSkuField(batch.id, skuEntry.sku, "assigning", true);
    setSkuField(batch.id, skuEntry.sku, "result", null);
    setSkuField(batch.id, skuEntry.sku, "message", "");
    setAssignProgress({ done: 0, total: batch.orders.length, batchId: batch.id, sku: skuEntry.sku });

    let done = 0;
    const issues: string[] = [];

    for (const order of batch.orders) {
      const orderCode = order.orderCode;
      const custCode = order.customerCode;
      try {
        const itemsRes = await fetch(`/api/wms/shipping/items/${encodeURIComponent(orderCode)}`, { headers });
        const itemsJson = await itemsRes.json().catch(() => ({}));
        const ijData = ((itemsJson as Record<string, unknown>)?.data ?? {}) as Record<string, unknown>;
        const items: Record<string, unknown>[] = (
          (ijData.items ?? (itemsJson as Record<string, unknown>)?.items ?? ijData.list ?? (itemsJson as Record<string, unknown>)?.list ?? [])
        ) as Record<string, unknown>[];
        const lineItem = items.find((it) => String(it.productSku ?? it.sku ?? "") === skuEntry.sku);
        if (!lineItem) {
          issues.push(`${orderCode}: SKU ${skuEntry.sku} not found`);
          done++;
          setAssignProgress({ done, total: batch.orders.length, batchId: batch.id, sku: skuEntry.sku });
          continue;
        }

        const unassignedQty = Number(lineItem.unassignedQty ?? lineItem.qty ?? skuEntry.qty);
        if (unassignedQty <= 0) {
          done++;
          setAssignProgress({ done, total: batch.orders.length, batchId: batch.id, sku: skuEntry.sku });
          continue;
        }

        const body = {
          shippingOrderCode: orderCode,
          shippingItemId: lineItem.shippingItemId,
          customerCode: custCode,
          warehouseCode: whCode,
          warehouseCd: stockOption.location,
          productSku: skuEntry.sku,
          lotNo: stockOption.lotNo ?? "",
          expireDate: stockOption.expireDate ?? "",
          itemCondition: stockOption.itemCondition ?? "GOOD",
          qty: unassignedQty,
        };
        const assignRes = await fetch("/api/wms/shipping/assign", { method: "POST", headers, body: JSON.stringify(body) });
        const assignJson = await assignRes.json().catch(() => ({}));
        const ok = assignRes.ok && ((assignJson as Record<string, unknown>)?.isSuccess ?? true);
        if (!ok) {
          const msg = String((assignJson as Record<string, unknown>)?.message ?? (assignJson as Record<string, unknown>)?.msg ?? "assign failed");
          issues.push(`${orderCode}: ${msg}`);
        }
      } catch (e) {
        issues.push(`${orderCode}: ${e instanceof Error ? e.message : "error"}`);
      }
      done++;
      setAssignProgress({ done, total: batch.orders.length, batchId: batch.id, sku: skuEntry.sku });
      await sleep(200);
    }

    setAssignProgress(null);
    const key = skuKey(batch.id, skuEntry.sku);
    const succeeded = issues.length === 0;
    setSkuState((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] ?? { loading: false, options: [], selected: null, assigning: false, result: null, message: "" }),
        assigning: false,
        result: succeeded ? "ok" : "error",
        message: succeeded
          ? `Assigned ${skuEntry.qty}× ${skuEntry.sku} to all ${batch.orderCount} orders from ${locationLabel(stockOption)}. Total: ${totalQty} units.`
          : `${done - issues.length} ok, ${issues.length} failed: ${issues.slice(0, 3).join("; ")}${issues.length > 3 ? "…" : ""}`,
      },
    }));
    // refresh assignment status badge
    if (succeeded) setAssignStatus((p) => ({ ...p, [batch.id]: "assigned" }));
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center">
            <Layers className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Batch Pick</h1>
            <p className="text-sm text-slate-500">Assign locations for total-pick batches</p>
          </div>
        </div>
        <button
          onClick={loadBatches}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Empty state */}
      {!loading && batches.length === 0 && (
        <div className="text-center py-20 text-slate-400">
          <Layers className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No batches yet</p>
          <p className="text-sm mt-1">Create batches from the Shipping page using the Batch Pick button.</p>
        </div>
      )}

      {/* Batch list */}
      <div className="space-y-3">
        {batches.map((batch) => {
          const isExpanded = expanded.has(batch.id);
          const isDeleting = deleting.has(batch.id);
          const status = assignStatus[batch.id];
          const isAssigned = status === "assigned";
          const isChecking = status === "checking";

          return (
            <div key={batch.id}
              className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-colors ${
                isAssigned ? "border-emerald-200" : "border-slate-200"
              }`}
            >
              {/* Batch header */}
              <div className={`px-5 py-4 flex items-center gap-4 ${isAssigned ? "bg-emerald-50/50" : ""}`}>
                <div className="flex-1 min-w-0">
                  {/* Row 1: type badge + order count + status */}
                  <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-violet-100 text-violet-700 tracking-wide">
                      {batch.type?.toUpperCase()}
                    </span>
                    <span className="text-base font-extrabold text-slate-900">
                      {batch.orderCount} orders
                    </span>
                    <span className="text-sm font-semibold text-slate-500">
                      · {batch.skuList.length} SKU{batch.skuList.length !== 1 ? "s" : ""}
                    </span>
                    <span className="text-sm text-slate-400 font-medium">{batch.warehouseCode}</span>

                    {/* Assignment status badge */}
                    {isChecking && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-400">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Checking…
                      </span>
                    )}
                    {isAssigned && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Location Assigned
                      </span>
                    )}
                    {status === "pending" && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-600 border border-amber-200">
                        <MapPin className="w-3 h-3" />
                        Needs Assignment
                      </span>
                    )}
                  </div>

                  {/* Row 2: SKU list */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mb-1.5">
                    {batch.skuList.map(({ sku, qty }) => (
                      <div key={sku} className="flex items-baseline gap-1.5">
                        <span className="font-mono text-sm font-bold text-slate-800">{sku}</span>
                        <span className="text-sm text-slate-400">×{qty}/order</span>
                        <span className="text-sm font-bold text-violet-600">(total {batch.orderCount * qty})</span>
                      </div>
                    ))}
                  </div>

                  {/* Row 3: timestamp */}
                  <p className="text-xs text-slate-400">{new Date(batch.createdAt).toLocaleString()}</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => router.push(`/batches-print?id=${encodeURIComponent(batch.id)}`)}
                    className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                    title="Print Pick Tickets"
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deleteBatch(batch.id)}
                    disabled={isDeleting}
                    className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                  >
                    {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => toggleExpand(batch.id)}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      isExpanded
                        ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        : isAssigned
                          ? "bg-emerald-600 text-white hover:bg-emerald-700"
                          : "bg-violet-600 text-white hover:bg-violet-700"
                    }`}
                  >
                    {isExpanded
                      ? <><ChevronUp className="w-3.5 h-3.5" /> Collapse</>
                      : <><ChevronDown className="w-3.5 h-3.5" /> {isAssigned ? "Re-Assign" : "Assign"}</>
                    }
                  </button>
                </div>
              </div>

              {/* Expanded: per-SKU location assignment */}
              {isExpanded && (
                <div className="border-t border-slate-100 bg-slate-50">
                  <div className="px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Location Assignment — Total Pick
                  </div>
                  <div className="divide-y divide-slate-100">
                    {batch.skuList.map((skuEntry) => {
                      const state = getSkuState(batch.id, skuEntry.sku);
                      const totalQty = batch.orderCount * skuEntry.qty;
                      const isActive = assignProgress?.batchId === batch.id && assignProgress.sku === skuEntry.sku;

                      return (
                        <div key={skuEntry.sku} className="px-5 py-4">
                          {/* SKU header */}
                          <div className="flex items-start justify-between gap-4 mb-3">
                            <div>
                              <p className="font-mono text-base font-extrabold text-slate-900">{skuEntry.sku}</p>
                              {skuEntry.name && <p className="text-sm text-slate-500 mt-0.5">{skuEntry.name}</p>}
                              <div className="flex items-center gap-3 mt-1.5">
                                <span className="text-sm text-slate-500">{skuEntry.qty}/order × {batch.orderCount} orders</span>
                                <span className="text-base font-extrabold text-violet-700">= {totalQty} units total</span>
                              </div>
                            </div>
                            {state.options.length === 0 && !state.loading && (
                              <button
                                onClick={() => loadLocations(batch, skuEntry.sku)}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-semibold transition-colors flex-shrink-0"
                              >
                                <MapPin className="w-4 h-4" />
                                Load Locations
                              </button>
                            )}
                            {state.loading && (
                              <div className="flex items-center gap-1.5 text-sm text-slate-500">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Loading…
                              </div>
                            )}
                          </div>

                          {/* Location list */}
                          {state.options.length > 0 && (
                            <div className="space-y-2">
                              <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                                {state.options.map((opt) => {
                                  const label = locationLabel(opt) || opt.location;
                                  const isSelected = state.selected === opt.location;
                                  return (
                                    <label
                                      key={opt.location}
                                      className={`flex items-center gap-3 px-3.5 py-3 rounded-xl border cursor-pointer transition-all ${
                                        isSelected
                                          ? "border-violet-400 bg-violet-50"
                                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                                      }`}
                                    >
                                      <input
                                        type="radio"
                                        name={skuKey(batch.id, skuEntry.sku)}
                                        value={opt.location}
                                        checked={isSelected}
                                        onChange={() => setSkuField(batch.id, skuEntry.sku, "selected", opt.location)}
                                        className="accent-violet-600 w-4 h-4"
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2.5 flex-wrap">
                                          <span className="font-mono text-sm font-extrabold text-slate-900">{label}</span>
                                          {opt.lotNo && (
                                            <span className="text-xs font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">LOT: {opt.lotNo}</span>
                                          )}
                                          {opt.expireDate && (
                                            <span className="text-xs font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">EXP: {opt.expireDate}</span>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-3 mt-1">
                                          <span className="text-sm font-bold text-green-700">Avail: {opt.availQty}</span>
                                          <span className="text-sm text-slate-400">Stock: {opt.stockQty}</span>
                                          {Number(opt.availQty) < totalQty && (
                                            <span className="text-sm font-bold text-amber-600">
                                              ⚠ Short {totalQty - Number(opt.availQty)}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                                        String(opt.itemCondition).toUpperCase() === "GOOD"
                                          ? "bg-green-100 text-green-700"
                                          : "bg-amber-100 text-amber-700"
                                      }`}>
                                        {opt.itemCondition}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>

                              {/* Result banner */}
                              {state.result && (
                                <div className={`flex items-start gap-2 px-3.5 py-3 rounded-xl text-sm ${
                                  state.result === "ok"
                                    ? "bg-green-50 border border-green-200 text-green-800"
                                    : "bg-red-50 border border-red-200 text-red-700"
                                }`}>
                                  {state.result === "ok"
                                    ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                    : <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                                  <span className="font-medium">{state.message}</span>
                                  <button
                                    onClick={() => { setSkuField(batch.id, skuEntry.sku, "result", null); setSkuField(batch.id, skuEntry.sku, "message", ""); }}
                                    className="ml-auto flex-shrink-0 text-slate-400 hover:text-slate-600"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              )}

                              {/* Progress */}
                              {isActive && assignProgress && (
                                <div className="flex items-center gap-2 px-3.5 py-3 bg-violet-50 border border-violet-200 rounded-xl text-sm font-medium text-violet-700">
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Assigning {assignProgress.done} / {assignProgress.total} orders…
                                </div>
                              )}

                              {/* Assign button */}
                              {!state.result && (
                                <button
                                  onClick={() => assignSku(batch, skuEntry)}
                                  disabled={!state.selected || state.assigning || !!assignProgress}
                                  className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                  {state.assigning
                                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Assigning…</>
                                    : <><MapPin className="w-4 h-4" /> Assign to All {batch.orderCount} Orders</>}
                                </button>
                              )}

                              {state.result && (
                                <button
                                  onClick={() => loadLocations(batch, skuEntry.sku)}
                                  className="w-full py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-sm font-semibold transition-colors"
                                >
                                  Reload Locations
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Order list */}
                  <details className="px-5 pb-4">
                    <summary className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer select-none py-2 font-medium">
                      View {batch.orderCount} order numbers
                    </summary>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {batch.orders.map((o) => (
                        <span key={o.orderCode} className="font-mono text-xs bg-white border border-slate-200 px-2.5 py-1 rounded-lg text-slate-700 font-medium">
                          {o.orderNo ?? o.orderCode}
                        </span>
                      ))}
                    </div>
                  </details>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Batch History (completed from mobile) ── */}
      <div className="mt-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wide">Batch History</h2>
            {completedBatches.length > 0 && (
              <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">
                {completedBatches.length}
              </span>
            )}
          </div>
          <button
            onClick={loadHistory}
            disabled={loadingHistory}
            className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${loadingHistory ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {loadingHistory && (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading history…
          </div>
        )}

        {!loadingHistory && completedBatches.length === 0 && (
          <p className="text-sm text-slate-400 py-4">No completed batches yet. Close a batch from the mobile app to record it here.</p>
        )}

        {completedBatches.length > 0 && (
          <div className="space-y-2">
            {completedBatches.map((batch) => {
              const isExpanded = expandedHistory.has(batch.id);
              return (
                <div key={batch.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="px-5 py-4 flex items-center gap-4">
                    <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <CheckCheck className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap mb-1">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-500 tracking-wide">
                          {batch.type?.toUpperCase()}
                        </span>
                        <span className="text-sm font-bold text-slate-800">{batch.orderCount} orders</span>
                        <span className="text-sm text-slate-400">· {batch.skuList.length} SKU{batch.skuList.length !== 1 ? "s" : ""}</span>
                        <span className="text-sm text-slate-400">{batch.warehouseCode}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-1">
                        {batch.skuList.map(({ sku, qty }) => (
                          <span key={sku} className="font-mono text-xs text-slate-600">
                            {sku} ×{qty}
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-400">
                        <span>Created: {new Date(batch.createdAt).toLocaleString()}</span>
                        {batch.completedAt && (
                          <span className="text-emerald-600 font-medium">
                            ✓ Closed: {new Date(batch.completedAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => router.push(`/batch-summary-print?id=${encodeURIComponent(batch.id)}`)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                        title="Print Summary Ticket"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setExpandedHistory((prev) => {
                          const next = new Set(prev);
                          if (next.has(batch.id)) next.delete(batch.id); else next.add(batch.id);
                          return next;
                        })}
                        className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 transition-colors font-medium"
                      >
                        {isExpanded ? <><ChevronUp className="w-3.5 h-3.5" /> Orders</> : <><ChevronDown className="w-3.5 h-3.5" /> Orders</>}
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="px-5 pb-4 pt-0 border-t border-slate-100 flex flex-wrap gap-1.5">
                      {batch.orders.map((o) => (
                        <span key={o.orderCode} className="font-mono text-xs bg-slate-50 border border-slate-200 px-2 py-1 rounded text-slate-700">
                          {o.orderNo ?? o.orderCode}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
