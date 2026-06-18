"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import { Layers, RefreshCw, Trash2, ChevronDown, ChevronUp, MapPin, Loader2, CheckCircle2, AlertCircle, X, Printer } from "lucide-react";
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
  selected: string | null; // location value
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
  const [skuState, setSkuState] = useState<Record<string, SkuAssignState>>({}); // key: `${batchId}:${sku}`
  const [assignProgress, setAssignProgress] = useState<{ done: number; total: number; batchId: string; sku: string } | null>(null);

  async function loadBatches() {
    setLoading(true);
    try {
      const res = await fetch("/api/batch");
      const data = await res.json();
      if (Array.isArray(data)) setBatches(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadBatches(); }, []);

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
        // Get shippingItemId for this order + SKU
        const itemsRes = await fetch(`/api/wms/shipping/items/${encodeURIComponent(orderCode)}`, { headers });
        const itemsJson = await itemsRes.json().catch(() => ({}));
        const ijData = ((itemsJson as Record<string, unknown>)?.data ?? {}) as Record<string, unknown>;
        const items: Record<string, unknown>[] = (
          (ijData.items ?? (itemsJson as Record<string, unknown>)?.items ?? ijData.list ?? (itemsJson as Record<string, unknown>)?.list ?? [])
        ) as Record<string, unknown>[];
        const lineItem = items.find((it) => String(it.productSku ?? it.sku ?? "") === skuEntry.sku);
        if (!lineItem) {
          issues.push(`${orderCode}: SKU ${skuEntry.sku} not found in items`);
          done++;
          setAssignProgress({ done, total: batch.orders.length, batchId: batch.id, sku: skuEntry.sku });
          continue;
        }

        // Skip if already fully assigned
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
    setSkuState((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] ?? { loading: false, options: [], selected: null, assigning: false, result: null, message: "" }),
        assigning: false,
        result: issues.length === 0 ? "ok" : "error",
        message: issues.length === 0
          ? `Assigned ${skuEntry.qty}× ${skuEntry.sku} to all ${batch.orderCount} orders from location ${locationLabel(stockOption)}. Total: ${totalQty} units.`
          : `${done - issues.length} ok, ${issues.length} failed: ${issues.slice(0, 3).join("; ")}${issues.length > 3 ? "…" : ""}`,
      },
    }));
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
      <div className="space-y-4">
        {batches.map((batch) => {
          const isExpanded = expanded.has(batch.id);
          const isDeleting = deleting.has(batch.id);

          return (
            <div key={batch.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              {/* Batch header */}
              <div className="px-5 py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-violet-100 text-violet-700">
                      {batch.type?.toUpperCase()}
                    </span>
                    <span className="text-sm font-bold text-slate-900">
                      {batch.orderCount} orders · {batch.skuList.length} SKU{batch.skuList.length !== 1 ? "s" : ""}
                    </span>
                    <span className="text-xs text-slate-400">{batch.warehouseCode}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {batch.skuList.map(({ sku, qty }) => (
                      <span key={sku} className="text-xs text-slate-500">
                        {sku} <span className="text-slate-400">×{qty}/order</span>
                        <span className="text-violet-600 font-semibold ml-1">(total {batch.orderCount * qty})</span>
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{new Date(batch.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
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
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 text-sm font-medium transition-colors"
                  >
                    {isExpanded ? <><ChevronUp className="w-3.5 h-3.5" /> Collapse</> : <><ChevronDown className="w-3.5 h-3.5" /> Assign</>}
                  </button>
                </div>
              </div>

              {/* Expanded: per-SKU location assignment */}
              {isExpanded && (
                <div className="border-t border-slate-100 bg-slate-50">
                  <div className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
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
                              <p className="font-mono text-sm font-bold text-slate-800">{skuEntry.sku}</p>
                              {skuEntry.name && <p className="text-xs text-slate-500 mt-0.5">{skuEntry.name}</p>}
                              <div className="flex items-center gap-3 mt-1">
                                <span className="text-xs text-slate-500">{skuEntry.qty}/order × {batch.orderCount} orders</span>
                                <span className="text-sm font-bold text-violet-700">= {totalQty} total units to pick</span>
                              </div>
                            </div>
                            {state.options.length === 0 && !state.loading && (
                              <button
                                onClick={() => loadLocations(batch, skuEntry.sku)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-xs font-semibold transition-colors flex-shrink-0"
                              >
                                <MapPin className="w-3.5 h-3.5" />
                                Load Locations
                              </button>
                            )}
                            {state.loading && (
                              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
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
                                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${
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
                                        className="accent-violet-600"
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="font-mono text-sm font-bold text-slate-800">{label}</span>
                                          {opt.lotNo && (
                                            <span className="text-xs text-slate-500">LOT: {opt.lotNo}</span>
                                          )}
                                          {opt.expireDate && (
                                            <span className="text-xs text-slate-500">EXP: {opt.expireDate}</span>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-3 mt-0.5">
                                          <span className="text-xs text-green-600 font-medium">Avail: {opt.availQty}</span>
                                          <span className="text-xs text-slate-400">Stock: {opt.stockQty}</span>
                                          {Number(opt.availQty) < totalQty && (
                                            <span className="text-xs text-amber-600 font-semibold">
                                              ⚠ Short by {totalQty - Number(opt.availQty)}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
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
                                <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs ${
                                  state.result === "ok"
                                    ? "bg-green-50 border border-green-200 text-green-700"
                                    : "bg-red-50 border border-red-200 text-red-700"
                                }`}>
                                  {state.result === "ok"
                                    ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                                    : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
                                  <span>{state.message}</span>
                                  <button
                                    onClick={() => { setSkuField(batch.id, skuEntry.sku, "result", null); setSkuField(batch.id, skuEntry.sku, "message", ""); }}
                                    className="ml-auto flex-shrink-0"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}

                              {/* Progress */}
                              {isActive && assignProgress && (
                                <div className="flex items-center gap-2 px-3 py-2 bg-violet-50 border border-violet-200 rounded-xl text-xs text-violet-700">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  Assigning {assignProgress.done} / {assignProgress.total} orders…
                                </div>
                              )}

                              {/* Assign button */}
                              {!state.result && (
                                <button
                                  onClick={() => assignSku(batch, skuEntry)}
                                  disabled={!state.selected || state.assigning || !!assignProgress}
                                  className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                  {state.assigning
                                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Assigning…</>
                                    : <><MapPin className="w-4 h-4" /> Assign to All {batch.orderCount} Orders</>}
                                </button>
                              )}

                              {state.result && (
                                <button
                                  onClick={() => loadLocations(batch, skuEntry.sku)}
                                  className="w-full py-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors"
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

                  {/* Order list (collapsed, click to see) */}
                  <details className="px-5 pb-4">
                    <summary className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer select-none py-2">
                      View {batch.orderCount} order codes
                    </summary>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {batch.orders.map((o) => (
                        <span key={o.orderCode} className="font-mono text-xs bg-white border border-slate-200 px-2 py-1 rounded-lg text-slate-600">
                          {o.orderCode}
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
    </div>
  );
}
