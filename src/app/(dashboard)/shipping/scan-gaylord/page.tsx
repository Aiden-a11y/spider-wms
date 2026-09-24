"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { PackageCheck, ScanLine, Loader2, CheckCircle2, XCircle, AlertCircle, X, Send } from "lucide-react";

interface ScanResult {
  id: string;
  trackingInput: string;
  orderCode?: string;
  orderNo?: string;
  customerCode?: string;
  warehouseCode?: string;
  status: "looking_up" | "ready" | "not_found" | "completing" | "done" | "error";
  message?: string;
}

const WAREHOUSE_CODE = "STOO1";
const todayYYYYMMDD = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");

export default function ScanToGaylordPage() {
  const { user } = useAuth();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [completingAll, setCompletingAll] = useState(false);
  const [results, setResults] = useState<ScanResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const refocus = useCallback(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  /** Look up an order by scanned tracking/label value. Requires an EXACT tracking
   *  match on the returned records — no "just take the first result" fallback,
   *  since that's what completed the wrong order last time. */
  async function findOrderByTracking(tracking: string): Promise<Record<string, unknown> | null> {
    const wanted = tracking.trim();
    const bodies = [
      { trackingNo: wanted },
      { trackingNumber: wanted },
      { search: wanted },
    ];
    for (const ep of ["/api/wms/shipping/list", "/api/wms/shipping/b2c/list"]) {
      for (const extra of bodies) {
        try {
          const res = await fetch(ep, {
            method: "POST",
            headers,
            body: JSON.stringify({ page: 1, limit: 50, pageSize: 50, warehouseCode: WAREHOUSE_CODE, ...extra }),
          });
          const j = await res.json().catch(() => ({})) as Record<string, unknown>;
          const d = j?.data as Record<string, unknown> | undefined;
          const list: Record<string, unknown>[] = Array.isArray(d?.list) ? (d!.list as Record<string, unknown>[])
            : Array.isArray(d) ? (d as unknown as Record<string, unknown>[])
            : Array.isArray(j?.list) ? (j!.list as Record<string, unknown>[])
            : [];
          const match = list.find((o) => {
            const t = String(o.trackingNo ?? o.trackingNumber ?? "").trim();
            return t && t === wanted;
          });
          if (match) return match;
        } catch { /* try next */ }
      }
    }
    return null;
  }

  /** Scan → look up only. Does NOT touch WMS order status — just adds a row to
   *  the review list. Nothing is marked Complete until "Complete" is pressed. */
  async function handleScan() {
    const tracking = input.trim();
    if (!tracking || busy) return;
    setInput("");
    setBusy(true);

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setResults((p) => [{ id, trackingInput: tracking, status: "looking_up" }, ...p]);

    try {
      const order = await findOrderByTracking(tracking);
      if (!order) {
        setResults((p) => p.map((r) => (r.id === id ? { ...r, status: "not_found", message: "No exact tracking match found" } : r)));
        return;
      }

      const orderCode = String(order.shippingOrderCode ?? order.orderCode ?? "");
      const orderNo = String(order.shippingOrderNo ?? order.orderNo ?? "");
      const customerCode = String(order.customerCode ?? "");
      const whCode = String(order.warehouseCode ?? order.warehouse ?? WAREHOUSE_CODE);

      setResults((p) => p.map((r) => (r.id === id
        ? { ...r, status: "ready", orderCode, orderNo, customerCode, warehouseCode: whCode }
        : r)));
    } catch (e) {
      setResults((p) => p.map((r) => (r.id === id ? { ...r, status: "error", message: e instanceof Error ? e.message : "Lookup failed" } : r)));
    } finally {
      setBusy(false);
      refocus();
    }
  }

  function removeResult(id: string) {
    setResults((p) => p.filter((r) => r.id !== id));
  }

  /** The actual irreversible step — fires FA for one row. */
  async function completeOne(id: string) {
    const target = results.find((r) => r.id === id);
    if (!target || target.status !== "ready" || !target.orderCode) return;

    setResults((p) => p.map((r) => (r.id === id ? { ...r, status: "completing" } : r)));
    try {
      const res = await fetch("/api/wms/shipping/status-change", {
        method: "POST",
        headers,
        body: JSON.stringify({
          warehouseCode: target.warehouseCode || WAREHOUSE_CODE,
          customerCode: target.customerCode,
          orderCodes: [target.orderCode],
          newStatus: "FA",
          completeDate: todayYYYYMMDD(),
          cancelComment: "",
        }),
      });
      const j = await res.json().catch(() => ({})) as Record<string, unknown>;
      const ok = res.ok && j?.isSuccess !== false;
      setResults((p) => p.map((r) => (r.id === id
        ? { ...r, status: ok ? "done" : "error", message: ok ? undefined : String(j?.message ?? `HTTP ${res.status}`) }
        : r)));
    } catch (e) {
      setResults((p) => p.map((r) => (r.id === id ? { ...r, status: "error", message: e instanceof Error ? e.message : "Complete failed" } : r)));
    }
  }

  async function completeAllReady() {
    const ready = results.filter((r) => r.status === "ready");
    if (ready.length === 0) return;
    setCompletingAll(true);
    try {
      for (const r of ready) {
        await completeOne(r.id);
      }
    } finally {
      setCompletingAll(false);
    }
  }

  const readyCount = results.filter((r) => r.status === "ready").length;
  const doneCount = results.filter((r) => r.status === "done").length;

  return (
    <div className="min-h-[calc(100vh-64px)] flex flex-col bg-slate-950 text-white -m-6">
      {/* Header */}
      <div className="px-8 py-6 border-b border-white/10 flex items-center gap-4">
        <div className="w-12 h-12 bg-indigo-500/20 rounded-2xl flex items-center justify-center">
          <PackageCheck className="w-6 h-6 text-indigo-400" />
        </div>
        <div>
          <h1 className="text-2xl font-black">Scan to Gaylord</h1>
          <p className="text-sm text-slate-400">Scanning only looks up the order — press Complete to actually mark it FA</p>
        </div>
        <div className="ml-auto flex items-center gap-6">
          <div className="text-right">
            <p className="text-3xl font-black text-amber-400">{readyCount}</p>
            <p className="text-xs text-slate-500 uppercase tracking-wide">Ready</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-black text-emerald-400">{doneCount}</p>
            <p className="text-xs text-slate-500 uppercase tracking-wide">Completed</p>
          </div>
        </div>
      </div>

      {/* Scan input */}
      <div className="px-8 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-2 mb-3 text-indigo-300">
            <ScanLine className="w-5 h-5" />
            <p className="text-sm font-bold uppercase tracking-wide">Scan Tracking Label</p>
          </div>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleScan()}
            disabled={busy}
            placeholder="Scan or type tracking number…"
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="w-full bg-white/5 border-2 border-white/10 focus:border-indigo-400 rounded-2xl px-6 py-6 text-3xl font-mono font-bold text-center placeholder:text-slate-600 focus:outline-none transition-colors disabled:opacity-50"
          />

          {readyCount > 0 && (
            <button
              onClick={completeAllReady}
              disabled={completingAll}
              className="mt-4 w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-lg font-black bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 transition-colors"
            >
              {completingAll ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              Complete {readyCount} Order{readyCount !== 1 ? "s" : ""}
            </button>
          )}
        </div>
      </div>

      {/* Scan history / review list */}
      <div className="flex-1 px-8 pb-8 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-2">
          {results.length === 0 && (
            <p className="text-center text-slate-600 text-sm py-12">Scanned labels will appear here — review before completing</p>
          )}
          {results.map((r) => (
            <div
              key={r.id}
              className={`rounded-2xl px-5 py-4 flex items-center gap-4 border ${
                r.status === "done" ? "bg-emerald-500/10 border-emerald-500/30"
                : r.status === "error" || r.status === "not_found" ? "bg-red-500/10 border-red-500/30"
                : r.status === "ready" ? "bg-amber-500/10 border-amber-500/30"
                : "bg-white/5 border-white/10"
              }`}
            >
              <div className="flex-shrink-0">
                {(r.status === "looking_up" || r.status === "completing") && <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />}
                {r.status === "done" && <CheckCircle2 className="w-6 h-6 text-emerald-400" />}
                {(r.status === "error" || r.status === "not_found") && <XCircle className="w-6 h-6 text-red-400" />}
                {r.status === "ready" && <AlertCircle className="w-6 h-6 text-amber-400" />}
              </div>
              <div className="flex-1 min-w-0">
                {r.orderNo || r.orderCode ? (
                  <>
                    <p className="text-2xl font-black font-mono">{r.orderNo || r.orderCode}</p>
                    {r.orderNo && r.orderCode && <p className="text-xs text-slate-500 font-mono">{r.orderCode}</p>}
                  </>
                ) : (
                  <p className="text-lg font-mono font-bold text-slate-400">{r.trackingInput}</p>
                )}
                {r.message && (
                  <p className="text-sm text-red-300 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {r.message}
                  </p>
                )}
              </div>
              <div className="flex-shrink-0 flex items-center gap-2">
                <span className="text-sm font-bold uppercase tracking-wide">
                  {r.status === "looking_up" && <span className="text-slate-400">Looking up…</span>}
                  {r.status === "ready" && <span className="text-amber-400">Ready</span>}
                  {r.status === "completing" && <span className="text-indigo-300">Completing…</span>}
                  {r.status === "done" && <span className="text-emerald-400">✓ Complete</span>}
                  {r.status === "not_found" && <span className="text-red-400">Not Found</span>}
                  {r.status === "error" && <span className="text-red-400">Failed</span>}
                </span>
                {r.status === "ready" && (
                  <>
                    <button
                      onClick={() => completeOne(r.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 transition-colors"
                    >
                      Complete
                    </button>
                    <button
                      onClick={() => removeResult(r.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Remove — wrong scan"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </>
                )}
                {(r.status === "not_found" || r.status === "error") && (
                  <button
                    onClick={() => removeResult(r.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
