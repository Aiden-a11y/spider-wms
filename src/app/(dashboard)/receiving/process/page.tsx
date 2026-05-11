"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import { RefreshCw, PackageCheck, ScanLine, AlertCircle, Play, RotateCcw } from "lucide-react";

type Row = Record<string, unknown>;

type StowTag = {
  id: number;
  orderCode: string;
  stowedAt?: string;
};

const STATUS_LABEL: Record<string, { label: string; badge: string }> = {
  AA: { label: "Pre-Alert",   badge: "bg-blue-50 text-blue-700 border-blue-200" },
  CA: { label: "In-Progress", badge: "bg-amber-50 text-amber-700 border-amber-200" },
};

export default function ReceivingProcessPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [orders, setOrders] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanInput, setScanInput] = useState("");
  const [scanError, setScanError] = useState("");
  const [starting, setStarting] = useState<string | null>(null);
  const [stowCounts, setStowCounts] = useState<Record<string, number>>({});
  const scanRef = useRef<HTMLInputElement>(null);

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  /* ── Load orders (AA = Pre-Alert, CA = In-Progress) ── */
  async function loadOrders() {
    setLoading(true);
    try {
      const res = await fetch("/api/wms/receiving/list", {
        method: "POST",
        headers,
        body: JSON.stringify({ page: 1, limit: 200 }),
      });
      const json = await res.json();
      const list = json?.data?.list ?? json?.data ?? json?.list ?? [];
      const all: Row[] = Array.isArray(list) ? list : [];
      const filtered = all.filter((r) => {
        const s = String(r.status ?? "").toUpperCase();
        return s === "AA" || s === "CA";
      });
      // AA first, then CA
      filtered.sort((a, b) => {
        const sa = String(a.status ?? "").toUpperCase();
        const sb = String(b.status ?? "").toUpperCase();
        return sa === sb ? 0 : sa === "AA" ? -1 : 1;
      });
      setOrders(filtered);
    } catch {}
    setLoading(false);
  }

  /* ── Load stow ticket counts ── */
  async function loadStowCounts() {
    try {
      const res = await fetch("/api/stow-tags");
      if (!res.ok) return;
      const tags: StowTag[] = await res.json();
      const counts: Record<string, number> = {};
      for (const tag of tags) {
        if (!tag.stowedAt) {
          counts[tag.orderCode] = (counts[tag.orderCode] ?? 0) + 1;
        }
      }
      setStowCounts(counts);
    } catch {}
  }

  useEffect(() => {
    loadOrders();
    loadStowCounts();
  }, []); // eslint-disable-line

  /* ── Start (AA → CA, then navigate) ── */
  async function startReceiving(row: Row) {
    const orderCode = String(row.receiveOrderCode ?? row.orderCode ?? "");
    setStarting(orderCode);
    setScanError("");
    try {
      const res = await fetch("/api/wms/receiving/status-change", {
        method: "POST",
        headers,
        body: JSON.stringify({
          warehouseCode: String(row.warehouseCode ?? ""),
          customerCode: String(row.customerCode ?? ""),
          orderCodes: [orderCode],
          newStatus: "CA",
          completeDate: "",
          cancelComment: "",
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.success === false || json?.code === "ERROR") {
        throw new Error(json?.message ?? "Failed to start receiving");
      }
      router.push(`/receiving/process/${orderCode}`);
    } catch (e) {
      setScanError(String(e instanceof Error ? e.message : e));
      setStarting(null);
    }
  }

  /* ── Resume (CA → navigate directly, no status change) ── */
  function resumeReceiving(row: Row) {
    const orderCode = String(row.receiveOrderCode ?? row.orderCode ?? "");
    router.push(`/receiving/process/${orderCode}`);
  }

  /* ── Scan handler ── */
  function handleScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    handleAction(scanInput.trim());
  }

  function handleAction(code: string) {
    if (!code) return;
    const match = orders.find(
      (o) => String(o.receiveOrderCode ?? o.orderCode ?? "").toLowerCase() === code.toLowerCase()
    );
    if (!match) {
      setScanError(`"${code}" not found in active receiving orders`);
      return;
    }
    const status = String(match.status ?? "").toUpperCase();
    if (status === "CA") {
      resumeReceiving(match);
    } else {
      startReceiving(match);
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Receiving Process</h1>
          <p className="text-slate-500 text-sm mt-0.5">Pre-Alert and In-Progress orders</p>
        </div>
        <button
          onClick={() => { loadOrders(); loadStowCounts(); }}
          disabled={loading}
          className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Scan box */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-6 py-5 mb-6">
        <p className="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
          <ScanLine className="w-4 h-4" />
          Scan Receiving Ticket
        </p>
        <div className="flex gap-3">
          <input
            ref={scanRef}
            type="text"
            value={scanInput}
            onChange={(e) => { setScanInput(e.target.value); setScanError(""); }}
            onKeyDown={handleScan}
            autoFocus
            placeholder="Scan or type order code…"
            className="flex-1 border border-blue-200 bg-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => handleAction(scanInput.trim())}
            disabled={!scanInput.trim() || starting !== null}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
          >
            {starting !== null ? <RefreshCw className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
            Start / Resume
          </button>
        </div>
        {scanError && (
          <div className="flex items-center gap-1.5 text-xs text-red-600 mt-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{scanError}
          </div>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-100 h-12 animate-pulse" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <PackageCheck className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No active receiving orders</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {["STATUS", "ORDER CODE", "ORDER NO", "WAREHOUSE", "CUSTOMER", "ORDER DATE", "ACTION"].map((c) => (
                    <th key={c} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((row, idx) => {
                  const orderCode = String(row.receiveOrderCode ?? row.orderCode ?? "");
                  const status = String(row.status ?? "").toUpperCase();
                  const isInProgress = status === "CA";
                  const isStarting = starting === orderCode;
                  const statusMeta = STATUS_LABEL[status] ?? { label: status, badge: "bg-slate-100 text-slate-600 border-slate-200" };
                  const stowCount = stowCounts[orderCode] ?? 0;

                  return (
                    <tr key={idx} className={`border-b border-slate-100 hover:bg-slate-50 ${isInProgress ? "bg-amber-50/30" : ""}`}>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${statusMeta.badge}`}>
                          {statusMeta.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-blue-600 font-medium whitespace-nowrap">{orderCode || "-"}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{String(row.receiveOrderNo ?? row.orderNo ?? "-")}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{String(row.warehouseCode ?? "-")}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{String(row.customerName ?? row.customerCode ?? "-")}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{String(row.orderDate ?? "-")}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {isInProgress ? (
                            <button
                              onClick={() => resumeReceiving(row)}
                              disabled={starting !== null}
                              className="flex items-center gap-1.5 text-xs font-medium bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white px-3 py-1.5 rounded-lg transition-colors"
                            >
                              {isStarting
                                ? <RefreshCw className="w-3 h-3 animate-spin" />
                                : <RotateCcw className="w-3 h-3" />}
                              Resume
                            </button>
                          ) : (
                            <button
                              onClick={() => startReceiving(row)}
                              disabled={starting !== null}
                              className="flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-3 py-1.5 rounded-lg transition-colors"
                            >
                              {isStarting
                                ? <RefreshCw className="w-3 h-3 animate-spin" />
                                : <Play className="w-3 h-3" />}
                              Start
                            </button>
                          )}

                          {/* Stow count badge (clickable → resume to manage tags) */}
                          {stowCount > 0 && (
                            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full font-medium">
                              {stowCount} stow tag{stowCount !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
