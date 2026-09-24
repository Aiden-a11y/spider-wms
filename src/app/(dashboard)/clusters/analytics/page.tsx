"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Loader2, MapPin, Package, BarChart2, Layers } from "lucide-react";

interface LocationRow { locationCode: string; totalQty: number; pickCount: number; skuCount: number; }
interface SkuRow { sku: string; name: string; totalQty: number; pickCount: number; locationCount: number; }
interface DateRow { date: string; totalQty: number; totalPicks: number; clusterCount: number; }

const toISO = (d: Date) => d.toISOString().slice(0, 10);
const addDay = (iso: string, n: number) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return toISO(d);
};
const fmt = (n: number) => n.toLocaleString("en-US");

export default function ClusterAnalyticsPage() {
  const { user } = useAuth();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  const [warehouseCode] = useState("STOO1");
  const [from, setFrom] = useState(() => addDay(toISO(new Date()), -29));
  const [to, setTo] = useState(() => toISO(new Date()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [totalClusters, setTotalClusters] = useState(0);
  const [totalPicks, setTotalPicks] = useState(0);
  const [totalQty, setTotalQty] = useState(0);
  const [byLocation, setByLocation] = useState<LocationRow[]>([]);
  const [bySku, setBySku] = useState<SkuRow[]>([]);
  const [byDate, setByDate] = useState<DateRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ warehouseCode, from, to });
      const res = await fetch(`/api/cluster-archive/analytics?${params}`, { headers });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setTotalClusters(j.totalClusters ?? 0);
      setTotalPicks(j.totalPicks ?? 0);
      setTotalQty(j.totalQty ?? 0);
      setByLocation(j.byLocation ?? []);
      setBySku(j.bySku ?? []);
      setByDate(j.byDate ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [warehouseCode, from, to, headers]);

  useEffect(() => { load(); }, [load]);

  const dateMax = useMemo(() => Math.max(1, ...byDate.map((d) => d.totalQty)), [byDate]);
  const topLocations = byLocation.slice(0, 15);
  const topSkus = bySku.slice(0, 15);
  const locMax = Math.max(1, ...topLocations.map((l) => l.totalQty));
  const skuMax = Math.max(1, ...topSkus.map((s) => s.totalQty));

  return (
    <div className="p-6 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
            <BarChart2 className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Pick Analytics</h1>
            <p className="text-sm text-slate-500">Location and SKU pick frequency, based on cluster pick history</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200" />
          <span className="text-slate-400 text-sm">~</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200" />
          {[7, 30, 90].map((days) => (
            <button key={days}
              onClick={() => { setFrom(addDay(toISO(new Date()), -(days - 1))); setTo(toISO(new Date())); }}
              className="text-xs px-2.5 py-1 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-100">
              {days}d
            </button>
          ))}
          {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
              <Layers className="w-4 h-4 text-blue-600" />
            </div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Clusters</p>
          </div>
          <p className="text-3xl font-black text-slate-900">{fmt(totalClusters)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-violet-50 rounded-lg flex items-center justify-center">
              <Package className="w-4 h-4 text-violet-600" />
            </div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Pick Lines</p>
          </div>
          <p className="text-3xl font-black text-slate-900">{fmt(totalPicks)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center">
              <MapPin className="w-4 h-4 text-emerald-600" />
            </div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Total Units Picked</p>
          </div>
          <p className="text-3xl font-black text-slate-900">{fmt(totalQty)}</p>
        </div>
      </div>

      {/* Date trend */}
      {byDate.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm font-semibold text-slate-700 mb-4">Units Picked by Day</p>
          <div className="overflow-x-auto">
            <div className="flex items-end gap-1.5 h-40 min-w-full" style={{ width: Math.max(byDate.length * 22, 100) }}>
              {byDate.map((d) => {
                const h = (d.totalQty / dateMax) * 100;
                return (
                  <div key={d.date} className="flex flex-col items-center gap-1 flex-shrink-0" style={{ width: 18 }}
                    title={`${d.date}\nQty: ${fmt(d.totalQty)}\nPick lines: ${fmt(d.totalPicks)}\nClusters: ${d.clusterCount}`}>
                    <div className="w-full flex items-end justify-center h-32">
                      <div className="w-3 bg-blue-500 rounded-t hover:bg-blue-600 transition-colors" style={{ height: `${h}%` }} />
                    </div>
                    <span className="text-[9px] text-slate-300">{d.date.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Top locations / SKUs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Locations */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-emerald-600" />
            <p className="text-sm font-bold text-slate-700">Top Picked Locations</p>
          </div>
          {topLocations.length === 0 && !loading ? (
            <p className="text-center text-sm text-slate-400 py-10">No data</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-400 text-left">
                  <th className="px-4 py-2 font-semibold w-8">#</th>
                  <th className="px-2 py-2 font-semibold">Location</th>
                  <th className="px-2 py-2 font-semibold text-right">Qty</th>
                  <th className="px-2 py-2 font-semibold text-right">Picks</th>
                  <th className="px-4 py-2 font-semibold text-right">SKUs</th>
                </tr>
              </thead>
              <tbody>
                {topLocations.map((l, i) => (
                  <tr key={l.locationCode} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2 text-slate-400 font-mono">{i + 1}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-800">{l.locationCode}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1 mt-1">
                        <div className="h-1 rounded-full bg-emerald-500" style={{ width: `${(l.totalQty / locMax) * 100}%` }} />
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono font-bold text-slate-900">{fmt(l.totalQty)}</td>
                    <td className="px-2 py-2 text-right font-mono text-slate-500">{fmt(l.pickCount)}</td>
                    <td className="px-4 py-2 text-right font-mono text-slate-400">{l.skuCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* SKUs */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
            <Package className="w-4 h-4 text-violet-600" />
            <p className="text-sm font-bold text-slate-700">Top Picked SKUs</p>
          </div>
          {topSkus.length === 0 && !loading ? (
            <p className="text-center text-sm text-slate-400 py-10">No data</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-400 text-left">
                  <th className="px-4 py-2 font-semibold w-8">#</th>
                  <th className="px-2 py-2 font-semibold">SKU</th>
                  <th className="px-2 py-2 font-semibold text-right">Qty</th>
                  <th className="px-2 py-2 font-semibold text-right">Picks</th>
                  <th className="px-4 py-2 font-semibold text-right">Locs</th>
                </tr>
              </thead>
              <tbody>
                {topSkus.map((s, i) => (
                  <tr key={s.sku} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2 text-slate-400 font-mono">{i + 1}</td>
                    <td className="px-2 py-2">
                      <span className="font-mono font-bold text-slate-800">{s.sku}</span>
                      {s.name && <p className="text-slate-400 truncate max-w-[160px]">{s.name}</p>}
                      <div className="w-full bg-slate-100 rounded-full h-1 mt-1">
                        <div className="h-1 rounded-full bg-violet-500" style={{ width: `${(s.totalQty / skuMax) * 100}%` }} />
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono font-bold text-slate-900">{fmt(s.totalQty)}</td>
                    <td className="px-2 py-2 text-right font-mono text-slate-500">{fmt(s.pickCount)}</td>
                    <td className="px-4 py-2 text-right font-mono text-slate-400">{s.locationCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
