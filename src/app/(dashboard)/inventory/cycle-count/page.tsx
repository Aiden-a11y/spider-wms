"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import {
  CheckCircle2, AlertCircle, TrendingUp, ClipboardList,
  RefreshCw, Filter, ChevronDown, Loader2,
} from "lucide-react";

/* ─── types ─────────────────────────────────────────────────── */
type Status = "OK" | "OVER" | "SHORT";
type CycleRecord = {
  id: string;
  session_id: string;
  warehouse_code: string;
  customer_code: string | null;
  location: string;
  sku: string;
  product_name: string | null;
  lot: string | null;
  expire_date: string | null;
  system_qty: number;
  counted_qty: number;
  difference: number;
  status: Status;
  counted_by: string;
  counted_at: string;
  adjusted: boolean;
  adjusted_by: string | null;
  adjusted_at: string | null;
};

/* ─── helpers ────────────────────────────────────────────────── */
function fmt(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    + " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function getWeekKey(iso: string): string {
  const d = new Date(iso);
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  return monday.toLocaleDateString("en-CA");
}

function getWeekLabel(weekKey: string): string {
  const d = new Date(weekKey + "T00:00:00");
  const month = d.toLocaleString("default", { month: "short" });
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  return `${month} W${weekNum}`;
}

function getMonthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-");
  const d = new Date(parseInt(y), parseInt(m) - 1, 1);
  return d.toLocaleString("default", { month: "short", year: "2-digit" });
}

type Bucket = { label: string; ok: number; discrepancy: number; total: number };

function computeBuckets(records: CycleRecord[], period: "week" | "month"): Bucket[] {
  const bucketCount = period === "week" ? 8 : 6;
  const now = new Date();
  const keys: string[] = [];

  if (period === "week") {
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((day + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    for (let i = bucketCount - 1; i >= 0; i--) {
      const d = new Date(monday);
      d.setDate(monday.getDate() - i * 7);
      keys.push(d.toLocaleDateString("en-CA"));
    }
  } else {
    for (let i = bucketCount - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
  }

  const map: Record<string, { ok: number; discrepancy: number }> = {};
  keys.forEach((k) => (map[k] = { ok: 0, discrepancy: 0 }));

  for (const r of records) {
    const k = period === "week" ? getWeekKey(r.counted_at) : getMonthKey(r.counted_at);
    if (!map[k]) continue;
    if (r.status === "OK") map[k].ok++;
    else map[k].discrepancy++;
  }

  return keys.map((k) => ({
    label: period === "week" ? getWeekLabel(k) : getMonthLabel(k),
    ok: map[k].ok,
    discrepancy: map[k].discrepancy,
    total: map[k].ok + map[k].discrepancy,
  }));
}

/* ─── status badge ───────────────────────────────────────────── */
function StatusBadge({ status }: { status: Status }) {
  const cfg = {
    OK: "bg-emerald-50 text-emerald-700 border-emerald-200",
    OVER: "bg-blue-50 text-blue-700 border-blue-200",
    SHORT: "bg-red-50 text-red-700 border-red-200",
  }[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cfg}`}>
      {status}
    </span>
  );
}

/* ─── bar chart ──────────────────────────────────────────────── */
function BarChart({ buckets }: { buckets: Bucket[] }) {
  if (buckets.length === 0) return null;
  const W = 700; const H = 130;
  const PL = 36; const PR = 12; const PT = 12; const PB = 30;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;
  const maxVal = Math.max(1, ...buckets.map((b) => Math.max(b.ok, b.discrepancy)));
  const yMax = Math.ceil(maxVal * 1.2);
  const bw = chartW / buckets.length;
  const barW = Math.max(4, bw * 0.36);
  const yTicks = [0, Math.ceil(yMax / 2), yMax];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ overflow: "visible" }}>
      {/* Y grid + labels */}
      {yTicks.map((t) => {
        const y = PT + chartH - (t / yMax) * chartH;
        return (
          <g key={t}>
            <line x1={PL} x2={W - PR} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
            <text x={PL - 6} y={y + 4} textAnchor="end" fontSize="9" fill="#94a3b8">{t}</text>
          </g>
        );
      })}
      {/* Bars */}
      {buckets.map((b, i) => {
        const cx = PL + i * bw + bw / 2;
        const okH = (b.ok / yMax) * chartH;
        const discH = (b.discrepancy / yMax) * chartH;
        return (
          <g key={i}>
            {/* OK bar (green) */}
            <rect
              x={cx - barW - 1}
              y={PT + chartH - okH}
              width={barW}
              height={Math.max(okH, 0)}
              rx="2" fill="#22c55e" opacity="0.85"
            />
            {/* Discrepancy bar (orange) */}
            <rect
              x={cx + 1}
              y={PT + chartH - discH}
              width={barW}
              height={Math.max(discH, 0)}
              rx="2" fill="#f97316" opacity="0.85"
            />
            {/* X label */}
            <text
              x={cx}
              y={PT + chartH + 14}
              textAnchor="middle"
              fontSize="7.5"
              fill="#94a3b8"
            >
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ─── main page ──────────────────────────────────────────────── */
export default function CycleCountPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"history" | "analytics">("history");

  /* ── History state ── */
  const [records, setRecords] = useState<CycleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterWh, setFilterWh] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [adjustingId, setAdjustingId] = useState<string | null>(null);

  /* ── Analytics state ── */
  const [allRecords, setAllRecords] = useState<CycleRecord[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);
  const [period, setPeriod] = useState<"week" | "month">("week");

  /* ── Fetch history ── */
  const fetchHistory = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ limit: "500" });
    if (filterWh !== "ALL") p.set("warehouseCode", filterWh);
    if (filterStatus !== "ALL") p.set("status", filterStatus);
    if (filterFrom) p.set("dateFrom", filterFrom);
    if (filterTo) p.set("dateTo", filterTo);
    try {
      const res = await fetch(`/api/cycle-count?${p}`);
      const json = await res.json();
      setRecords(json.records ?? []);
    } catch { /* silent */ }
    setLoading(false);
  }, [filterWh, filterStatus, filterFrom, filterTo]);

  /* ── Fetch all (analytics) ── */
  const fetchAll = useCallback(async () => {
    setLoadingAll(true);
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 3);
    const p = new URLSearchParams({ limit: "2000", dateFrom: cutoff.toISOString() });
    try {
      const res = await fetch(`/api/cycle-count?${p}`);
      const json = await res.json();
      setAllRecords(json.records ?? []);
    } catch { /* silent */ }
    setLoadingAll(false);
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    if (tab === "analytics" && allRecords.length === 0) fetchAll();
  }, [tab, allRecords.length, fetchAll]);

  /* ── Mark adjusted ── */
  async function markAdjusted(id: string) {
    setAdjustingId(id);
    try {
      await fetch(`/api/cycle-count?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjusted_by: user?.userId ?? "manager" }),
      });
      setRecords((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, adjusted: true, adjusted_by: user?.userId ?? "manager", adjusted_at: new Date().toISOString() }
            : r
        )
      );
    } catch { /* silent */ }
    setAdjustingId(null);
  }

  /* ── Warehouses from records ── */
  const warehouses = useMemo(
    () => Array.from(new Set(records.map((r) => r.warehouse_code))).sort(),
    [records]
  );

  /* ── Analytics computations ── */
  const buckets = useMemo(() => computeBuckets(allRecords, period), [allRecords, period]);

  const periodRecords = useMemo(() => {
    const cutoff = new Date();
    if (period === "week") cutoff.setDate(cutoff.getDate() - 56); // 8 weeks
    else cutoff.setMonth(cutoff.getMonth() - 6);
    return allRecords.filter((r) => new Date(r.counted_at) >= cutoff);
  }, [allRecords, period]);

  const kpi = useMemo(() => {
    const total = periodRecords.length;
    const ok = periodRecords.filter((r) => r.status === "OK").length;
    const disc = total - ok;
    const adjQty = periodRecords
      .filter((r) => r.adjusted)
      .reduce((s, r) => s + Math.abs(r.difference), 0);
    return {
      total,
      accuracy: total > 0 ? Math.round((ok / total) * 100) : 0,
      discrepancies: disc,
      adjustedQty: adjQty,
    };
  }, [periodRecords]);

  /* ── Render ── */
  return (
    <div className="p-8">
      {/* Sub-tabs */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {(["history", "analytics"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
              tab === t
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t === "history" ? (
              <span className="flex items-center gap-1.5"><ClipboardList className="w-4 h-4" />History</span>
            ) : (
              <span className="flex items-center gap-1.5"><TrendingUp className="w-4 h-4" />Analytics</span>
            )}
          </button>
        ))}
      </div>

      {/* ── HISTORY TAB ── */}
      {tab === "history" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-end">
            {/* Warehouse */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500">Warehouse</label>
              <div className="relative">
                <select
                  value={filterWh}
                  onChange={(e) => setFilterWh(e.target.value)}
                  className="appearance-none pl-3 pr-8 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="ALL">All</option>
                  {warehouses.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
                <ChevronDown className="absolute right-2.5 top-2.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              </div>
            </div>
            {/* Status */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500">Status</label>
              <div className="relative">
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="appearance-none pl-3 pr-8 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="ALL">All</option>
                  <option value="OK">OK</option>
                  <option value="OVER">OVER</option>
                  <option value="SHORT">SHORT</option>
                </select>
                <ChevronDown className="absolute right-2.5 top-2.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              </div>
            </div>
            {/* Date from */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500">From</label>
              <input
                type="date" value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
                className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            {/* Date to */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500">To</label>
              <input
                type="date" value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
                className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <button
              onClick={fetchHistory}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm text-slate-700 transition-colors"
            >
              <Filter className="w-3.5 h-3.5" />Apply
            </button>
            <button
              onClick={() => { setFilterWh("ALL"); setFilterStatus("ALL"); setFilterFrom(""); setFilterTo(""); }}
              className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:text-slate-700 transition-colors"
            >
              Clear
            </button>
            <button
              onClick={fetchHistory}
              className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm text-slate-600 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />Refresh
            </button>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center h-48 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />Loading…
            </div>
          ) : records.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-400">
              <ClipboardList className="w-10 h-10 mb-2 opacity-30" />
              <p className="text-sm">No cycle count records found.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-3 whitespace-nowrap">Date / Time</th>
                      <th className="px-4 py-3 whitespace-nowrap">Warehouse</th>
                      <th className="px-4 py-3 whitespace-nowrap">Location</th>
                      <th className="px-4 py-3 whitespace-nowrap">SKU</th>
                      <th className="px-4 py-3 whitespace-nowrap">Product</th>
                      <th className="px-4 py-3 whitespace-nowrap">LOT</th>
                      <th className="px-4 py-3 whitespace-nowrap">EXP</th>
                      <th className="px-4 py-3 text-center whitespace-nowrap">System</th>
                      <th className="px-4 py-3 text-center whitespace-nowrap">Counted</th>
                      <th className="px-4 py-3 text-center whitespace-nowrap">Diff</th>
                      <th className="px-4 py-3 text-center whitespace-nowrap">Status</th>
                      <th className="px-4 py-3 text-center whitespace-nowrap">Adjusted</th>
                      <th className="px-4 py-3 whitespace-nowrap">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {records.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fmt(r.counted_at)}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600 whitespace-nowrap">{r.warehouse_code}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-800 whitespace-nowrap">{r.location}</td>
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-800 whitespace-nowrap">{r.sku}</td>
                        <td className="px-4 py-3 text-xs text-slate-500 max-w-[160px] truncate">{r.product_name ?? "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{r.lot ?? "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{r.expire_date ?? "—"}</td>
                        <td className="px-4 py-3 text-center font-semibold text-slate-700">{r.system_qty}</td>
                        <td className="px-4 py-3 text-center font-semibold text-slate-700">{r.counted_qty}</td>
                        <td className={`px-4 py-3 text-center font-bold ${r.difference > 0 ? "text-blue-600" : r.difference < 0 ? "text-red-600" : "text-slate-400"}`}>
                          {r.difference > 0 ? `+${r.difference}` : r.difference === 0 ? "—" : r.difference}
                        </td>
                        <td className="px-4 py-3 text-center"><StatusBadge status={r.status} /></td>
                        <td className="px-4 py-3 text-center">
                          {r.adjusted ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-semibold">
                              <CheckCircle2 className="w-3.5 h-3.5" />Done
                            </span>
                          ) : r.status === "OK" ? (
                            <span className="text-slate-300 text-xs">—</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-600 text-xs font-semibold">
                              <AlertCircle className="w-3.5 h-3.5" />Pending
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {r.status !== "OK" && !r.adjusted && (
                            <button
                              onClick={() => markAdjusted(r.id)}
                              disabled={adjustingId === r.id}
                              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold disabled:opacity-50 transition-colors whitespace-nowrap"
                            >
                              {adjustingId === r.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : "Mark Adjusted"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
                {records.length} record{records.length !== 1 ? "s" : ""}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ANALYTICS TAB ── */}
      {tab === "analytics" && (
        <div className="space-y-6">
          {/* Period toggle */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-600">Period:</span>
            {(["week", "month"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  period === p
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {p === "week" ? "Weekly" : "Monthly"}
              </button>
            ))}
            {loadingAll && <Loader2 className="w-4 h-4 animate-spin text-slate-400 ml-2" />}
            <button
              onClick={() => { setAllRecords([]); fetchAll(); }}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm text-slate-600 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />Refresh
            </button>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              label="Total Counts"
              value={kpi.total.toLocaleString()}
              icon={<ClipboardList className="w-5 h-5 text-blue-500" />}
              bg="bg-blue-50"
            />
            <KpiCard
              label="Accuracy Rate"
              value={`${kpi.accuracy}%`}
              icon={<CheckCircle2 className="w-5 h-5 text-emerald-500" />}
              bg="bg-emerald-50"
              sub={kpi.total > 0 ? `${kpi.total - kpi.discrepancies} matched` : undefined}
            />
            <KpiCard
              label="Discrepancies"
              value={kpi.discrepancies.toLocaleString()}
              icon={<AlertCircle className="w-5 h-5 text-orange-500" />}
              bg="bg-orange-50"
              sub={kpi.total > 0 ? `${Math.round((kpi.discrepancies / kpi.total) * 100)}% of counts` : undefined}
            />
            <KpiCard
              label="Adjusted Qty"
              value={kpi.adjustedQty.toLocaleString()}
              icon={<TrendingUp className="w-5 h-5 text-purple-500" />}
              bg="bg-purple-50"
              sub="units (adjusted records)"
            />
          </div>

          {/* Bar chart */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">
              {period === "week" ? "Weekly" : "Monthly"} Cycle Count Volume
            </h3>
            {loadingAll ? (
              <div className="flex items-center justify-center h-28 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />Loading chart…
              </div>
            ) : allRecords.length === 0 ? (
              <div className="flex items-center justify-center h-28 text-slate-400 text-sm">
                No data available
              </div>
            ) : (
              <>
                <div style={{ maxHeight: "150px" }}>
                  <BarChart buckets={buckets} />
                </div>
                <div className="flex items-center gap-4 mt-1.5 px-1">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm bg-green-500 opacity-85" />
                    <span className="text-xs text-slate-500">OK</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm bg-orange-500 opacity-85" />
                    <span className="text-xs text-slate-500">Discrepancy</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── KPI card ───────────────────────────────────────────────── */
function KpiCard({ label, value, icon, bg, sub }: {
  label: string; value: string; icon: React.ReactNode; bg: string; sub?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${bg}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-600 truncate">{label}</p>
        <p className="text-lg font-bold text-slate-900 leading-tight">{value}</p>
        {sub && <p className="text-[11px] text-slate-400 truncate">{sub}</p>}
      </div>
    </div>
  );
}
