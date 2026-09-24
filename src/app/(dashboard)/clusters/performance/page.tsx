"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import {
  RefreshCw, Loader2, TrendingUp, Users, Clock, Award, ChevronDown, ChevronUp, BarChart2,
} from "lucide-react";

interface PickRecord {
  id: string;
  cluster_id: string;
  cluster_no: number | null;
  warehouse_code: string;
  picker: string;
  cluster_created_at: string;
  completed_at: string;
  duration_min: number;
  bin_count: number;
  location_count: number;
  item_count: number;
  recorded_at: string;
}

interface PickerStats {
  picker: string;
  picks: number;
  avgDurationMin: number;
  avgBins: number;
  avgItems: number;
  avgLocations: number;
  binsPerHour: number;
  itemsPerHour: number;
  totalItems: number;
  totalBins: number;
  totalDurationMin: number;
  lastPick: string;
  bestDurationMin: number;
}

function statCards(records: PickRecord[], stats: PickerStats[]) {
  const totalPicks = records.length;
  const uniquePickers = new Set(records.map((r) => r.picker)).size;
  const avgDuration = records.length > 0
    ? records.reduce((s, r) => s + r.duration_min, 0) / records.length
    : 0;
  const topPicker = stats.length > 0
    ? stats.reduce((best, s) => s.binsPerHour > best.binsPerHour ? s : best, stats[0])
    : null;
  return { totalPicks, uniquePickers, avgDuration, topPicker };
}

function formatMin(min: number) {
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function PickPerformancePage() {
  const { user } = useAuth();

  const [records, setRecords] = useState<PickRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [error, setError] = useState("");

  const [warehouseCode, setWarehouseCode] = useState("STOO1");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [sortBy, setSortBy] = useState<keyof PickerStats>("binsPerHour");
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedPicker, setExpandedPicker] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ warehouseCode, dateFrom, dateTo });
      const res = await fetch(`/api/pick-performance?${params}`);
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setRecords(j.records ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  async function sync() {
    setSyncing(true);
    setSyncMsg("");
    try {
      const res = await fetch("/api/pick-performance/sync", { method: "POST" });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setSyncMsg(`Synced ${j.synced} record${j.synced !== 1 ? "s" : ""} from Redis history`);
      await load();
    } catch (e) {
      setSyncMsg(`Error: ${e instanceof Error ? e.message : "Sync failed"}`);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => { load(); }, [warehouseCode, dateFrom, dateTo]); // eslint-disable-line

  // Aggregate per picker
  const pickerStats = useMemo<PickerStats[]>(() => {
    const map = new Map<string, PickRecord[]>();
    records.forEach((r) => {
      if (!map.has(r.picker)) map.set(r.picker, []);
      map.get(r.picker)!.push(r);
    });

    return Array.from(map.entries()).map(([picker, rows]) => {
      const picks = rows.length;
      const totalDurationMin = rows.reduce((s, r) => s + r.duration_min, 0);
      const totalBins = rows.reduce((s, r) => s + r.bin_count, 0);
      const totalItems = rows.reduce((s, r) => s + r.item_count, 0);
      const totalLocations = rows.reduce((s, r) => s + r.location_count, 0);
      const bestDurationMin = Math.min(...rows.map((r) => r.duration_min));
      const lastPick = rows.reduce((best, r) =>
        new Date(r.completed_at) > new Date(best.completed_at) ? r : best
      ).completed_at;

      const avgDurationMin = totalDurationMin / picks;
      const avgBins = totalBins / picks;
      const avgItems = totalItems / picks;
      const avgLocations = totalLocations / picks;
      const binsPerHour = totalDurationMin > 0 ? (totalBins / totalDurationMin) * 60 : 0;
      const itemsPerHour = totalDurationMin > 0 ? (totalItems / totalDurationMin) * 60 : 0;

      return {
        picker, picks, avgDurationMin, avgBins, avgItems, avgLocations,
        binsPerHour, itemsPerHour, totalItems, totalBins, totalDurationMin,
        lastPick, bestDurationMin,
      };
    });
  }, [records]);

  const sortedStats = useMemo(() => {
    return [...pickerStats].sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      if (typeof av === "string" && typeof bv === "string")
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [pickerStats, sortBy, sortAsc]);

  const { totalPicks, uniquePickers, avgDuration, topPicker } = useMemo(
    () => statCards(records, pickerStats),
    [records, pickerStats]
  );

  function toggleSort(col: keyof PickerStats) {
    if (sortBy === col) setSortAsc((p) => !p);
    else { setSortBy(col); setSortAsc(false); }
  }

  function SortIcon({ col }: { col: keyof PickerStats }) {
    if (sortBy !== col) return <span className="text-slate-300 ml-1">↕</span>;
    return <span className="text-blue-500 ml-1">{sortAsc ? "↑" : "↓"}</span>;
  }

  const thCls = "px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer select-none hover:bg-slate-100 whitespace-nowrap";

  return (
    <div className="p-6 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
            <BarChart2 className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Pick Performance</h1>
            <p className="text-sm text-slate-500">Average stats per picker over time</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {syncMsg && (
            <span className={`text-xs px-3 py-1 rounded-full font-medium ${syncMsg.startsWith("Error") ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
              {syncMsg}
            </span>
          )}
          <button
            onClick={sync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Sync from Redis
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap bg-white border border-slate-200 rounded-xl px-4 py-3">
        <select
          value={warehouseCode}
          onChange={(e) => setWarehouseCode(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="STOO1">STOO1</option>
          <option value="">All Warehouses</option>
        </select>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-medium">From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-medium">To</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="ml-auto flex gap-2">
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              onClick={() => {
                const to = new Date().toISOString().slice(0, 10);
                const from = new Date();
                from.setDate(from.getDate() - days);
                setDateFrom(from.toISOString().slice(0, 10));
                setDateTo(to);
              }}
              className="text-xs px-2.5 py-1 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"
            >
              {days}d
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Summary cards */}
      {!loading && records.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Total Picks</span>
            </div>
            <div className="text-3xl font-black text-slate-900">{totalPicks}</div>
            <div className="text-xs text-slate-400 mt-0.5">clusters completed</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-violet-500" />
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Pickers</span>
            </div>
            <div className="text-3xl font-black text-slate-900">{uniquePickers}</div>
            <div className="text-xs text-slate-400 mt-0.5">unique people</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Avg Pick Time</span>
            </div>
            <div className="text-3xl font-black text-slate-900">{formatMin(avgDuration)}</div>
            <div className="text-xs text-slate-400 mt-0.5">per cluster</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Award className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Top Performer</span>
            </div>
            <div className="text-2xl font-black text-slate-900 truncate">{topPicker?.picker ?? "—"}</div>
            {topPicker && (
              <div className="text-xs text-slate-400 mt-0.5">{topPicker.binsPerHour.toFixed(1)} bins/hr</div>
            )}
          </div>
        </div>
      )}

      {/* Picker stats table */}
      {loading && (
        <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      )}

      {!loading && records.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400 bg-white border border-slate-200 rounded-2xl">
          <BarChart2 className="w-10 h-10" />
          <p className="text-sm font-medium">No performance data yet</p>
          <p className="text-xs text-center max-w-xs">
            Click <strong>Sync from Redis</strong> to import existing completed clusters, or data will appear automatically when pickers complete clusters via the mobile app.
          </p>
        </div>
      )}

      {!loading && sortedStats.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <p className="text-sm font-bold text-slate-700">{sortedStats.length} Picker{sortedStats.length !== 1 ? "s" : ""}</p>
            <p className="text-xs text-slate-400">{records.length} total cluster records</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className={thCls} onClick={() => toggleSort("picker")}>
                    Picker <SortIcon col="picker" />
                  </th>
                  <th className={thCls + " text-center"} onClick={() => toggleSort("picks")}>
                    Picks <SortIcon col="picks" />
                  </th>
                  <th className={thCls + " text-center"} onClick={() => toggleSort("avgDurationMin")}>
                    Avg Time <SortIcon col="avgDurationMin" />
                  </th>
                  <th className={thCls + " text-center"} onClick={() => toggleSort("bestDurationMin")}>
                    Best Time <SortIcon col="bestDurationMin" />
                  </th>
                  <th className={thCls + " text-center"} onClick={() => toggleSort("avgBins")}>
                    Avg Bins <SortIcon col="avgBins" />
                  </th>
                  <th className={thCls + " text-center"} onClick={() => toggleSort("avgItems")}>
                    Avg Items <SortIcon col="avgItems" />
                  </th>
                  <th className={thCls + " text-center"} onClick={() => toggleSort("binsPerHour")}>
                    Bins/hr <SortIcon col="binsPerHour" />
                  </th>
                  <th className={thCls + " text-center"} onClick={() => toggleSort("itemsPerHour")}>
                    Items/hr <SortIcon col="itemsPerHour" />
                  </th>
                  <th className={thCls + " text-center"} onClick={() => toggleSort("totalItems")}>
                    Total Items <SortIcon col="totalItems" />
                  </th>
                  <th className={thCls} onClick={() => toggleSort("lastPick")}>
                    Last Pick <SortIcon col="lastPick" />
                  </th>
                  <th className="px-3 py-2.5 w-8" />
                </tr>
              </thead>
              <tbody>
                {sortedStats.map((s, rank) => {
                  const isExpanded = expandedPicker === s.picker;
                  const pickerRecords = records
                    .filter((r) => r.picker === s.picker)
                    .sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime());

                  return (
                    <>
                      <tr
                        key={s.picker}
                        className={`border-b border-slate-50 hover:bg-slate-50/60 transition-colors cursor-pointer ${rank === 0 ? "bg-blue-50/30" : ""}`}
                        onClick={() => setExpandedPicker(isExpanded ? null : s.picker)}
                      >
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            {rank === 0 && !sortAsc && (
                              <span className="text-xs">🥇</span>
                            )}
                            <span className="font-bold text-slate-800">{s.picker}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center font-bold text-slate-700">{s.picks}</td>
                        <td className="px-3 py-3 text-center">
                          <span className={`font-semibold ${s.avgDurationMin < 30 ? "text-emerald-600" : s.avgDurationMin < 60 ? "text-amber-600" : "text-red-500"}`}>
                            {formatMin(s.avgDurationMin)}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center text-emerald-600 font-semibold">{formatMin(s.bestDurationMin)}</td>
                        <td className="px-3 py-3 text-center text-slate-600">{s.avgBins.toFixed(1)}</td>
                        <td className="px-3 py-3 text-center text-slate-600">{s.avgItems.toFixed(1)}</td>
                        <td className="px-3 py-3 text-center">
                          <span className="font-bold text-blue-600">{s.binsPerHour.toFixed(1)}</span>
                        </td>
                        <td className="px-3 py-3 text-center text-slate-600">{s.itemsPerHour.toFixed(1)}</td>
                        <td className="px-3 py-3 text-center font-semibold text-slate-700">{s.totalItems.toLocaleString()}</td>
                        <td className="px-3 py-3 text-xs text-slate-400">
                          {new Date(s.lastPick).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </td>
                        <td className="px-3 py-3 text-slate-400">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr key={`${s.picker}-detail`} className="border-b border-slate-100">
                          <td colSpan={11} className="px-5 py-4 bg-slate-50">
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">
                              All {pickerRecords.length} picks by {s.picker}
                            </p>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs border-collapse">
                                <thead>
                                  <tr className="text-left text-slate-400 border-b border-slate-200">
                                    <th className="py-1.5 pr-4 font-semibold">Cluster</th>
                                    <th className="py-1.5 pr-4 font-semibold">Completed</th>
                                    <th className="py-1.5 pr-4 font-semibold text-center">Duration</th>
                                    <th className="py-1.5 pr-4 font-semibold text-center">Bins</th>
                                    <th className="py-1.5 pr-4 font-semibold text-center">Locations</th>
                                    <th className="py-1.5 font-semibold text-center">Items</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {pickerRecords.map((r) => (
                                    <tr key={r.id} className="border-b border-slate-100">
                                      <td className="py-1.5 pr-4 font-mono font-bold text-slate-700">
                                        {r.cluster_no != null ? `#${String(r.cluster_no).padStart(4, "0")}` : r.cluster_id.slice(0, 8)}
                                      </td>
                                      <td className="py-1.5 pr-4 text-slate-500">
                                        {new Date(r.completed_at).toLocaleString("en-US", {
                                          month: "short", day: "numeric",
                                          hour: "2-digit", minute: "2-digit",
                                        })}
                                      </td>
                                      <td className="py-1.5 pr-4 text-center">
                                        <span className={`font-semibold ${r.duration_min < 30 ? "text-emerald-600" : r.duration_min < 60 ? "text-amber-600" : "text-red-500"}`}>
                                          {formatMin(r.duration_min)}
                                        </span>
                                      </td>
                                      <td className="py-1.5 pr-4 text-center text-slate-600">{r.bin_count}</td>
                                      <td className="py-1.5 pr-4 text-center text-slate-500">{r.location_count}</td>
                                      <td className="py-1.5 text-center font-semibold text-slate-700">{r.item_count}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
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
