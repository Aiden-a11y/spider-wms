"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import {
  Maximize2, Minimize2, RefreshCw, X, Boxes, Package,
  MapPin, Truck, Building2, User, Layers, Clock, TrendingUp,
  CheckCircle2, AlertCircle, Loader2,
} from "lucide-react";
import type { B2CCluster } from "@/lib/b2c-cluster";

/* ─── types ─────────────────────────────────────────────────── */
type Row = Record<string, unknown>;

const SHIPPING_STATUS: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  AA: { label: "Outbound Req",      color: "#ca8a04", bg: "rgba(234,179,8,0.12)",   dot: "#eab308" },
  CA: { label: "Packing Req",       color: "#3b82f6", bg: "rgba(59,130,246,0.12)",  dot: "#3b82f6" },
  DA: { label: "Packing Complete",  color: "#06b6d4", bg: "rgba(6,182,212,0.12)",   dot: "#06b6d4" },
  AR: { label: "Auto Label Req",    color: "#8b5cf6", bg: "rgba(139,92,246,0.12)",  dot: "#8b5cf6" },
  AC: { label: "Auto Label Comp",   color: "#6366f1", bg: "rgba(99,102,241,0.12)",  dot: "#6366f1" },
  LR: { label: "Twinny Pack Req",   color: "#f59e0b", bg: "rgba(245,158,11,0.12)",  dot: "#f59e0b" },
  LC: { label: "Twinny Pack Comp",  color: "#14b8a6", bg: "rgba(20,184,166,0.12)",  dot: "#14b8a6" },
  HA: { label: "Hold",              color: "#ef4444", bg: "rgba(239,68,68,0.12)",   dot: "#ef4444" },
  CC: { label: "Cancelled",         color: "#64748b", bg: "rgba(100,116,139,0.12)", dot: "#64748b" },
  FA: { label: "Complete",          color: "#22c55e", bg: "rgba(34,197,94,0.12)",   dot: "#22c55e" },
};
const ACTIVE_STATUSES = ["AA","CA","DA","AR","AC","LR","LC","HA"];

function fmtDate(d: Date) {
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
}
function isoDate(iso: string) {
  return (iso ?? "").slice(0, 10);
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function yesterdayStr() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/* ─── helpers ────────────────────────────────────────────────── */
function arrOf(json: unknown): Row[] {
  const j = json as Record<string, unknown>;
  const d = j?.data as Record<string, unknown> | undefined;
  const list = d?.list ?? d?.items ?? (Array.isArray(d) ? d : null)
    ?? j?.list ?? j?.items ?? (Array.isArray(json) ? json : []);
  return Array.isArray(list) ? (list as Row[]) : [];
}

function orderDateOf(o: Row): string {
  const raw = String(o.orderDate ?? o.requestDate ?? o.shippingDate ?? o.createdAt ?? "");
  if (!raw) return "";
  if (raw.length === 8 && /^\d{8}$/.test(raw)) {
    return `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
  }
  return raw.slice(0, 10);
}

function statusOf(o: Row): string {
  return String(o.status ?? o.orderStatus ?? "");
}

function groupByStatus(orders: Row[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const o of orders) {
    const s = statusOf(o);
    if (s) map[s] = (map[s] ?? 0) + 1;
  }
  return map;
}

/* ─── clock ────────────────────────────────────────────────── */
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/* ─── cluster calc ──────────────────────────────────────────── */
function clusterStats(cluster: B2CCluster) {
  const start = new Date(cluster.createdAt);
  const end = cluster.completedAt ? new Date(cluster.completedAt) : null;
  const durationMs = end ? end.getTime() - start.getTime() : null;
  const durationHr = durationMs ? durationMs / 3600000 : null;
  const totalOrders = cluster.bins.length;
  const totalUnits = cluster.bins.reduce(
    (s, bin) => s + bin.items.reduce((ss, item) => ss + (item.qty ?? 0), 0), 0
  );
  const unitsPerHr = durationHr && durationHr > 0 ? Math.round(totalUnits / durationHr) : null;
  const ordersPerHr = durationHr && durationHr > 0 ? Math.round(totalOrders / durationHr) : null;
  const durationMin = durationMs ? Math.round(durationMs / 60000) : null;
  return { totalOrders, totalUnits, unitsPerHr, ordersPerHr, durationMin };
}

/* ─── components ─────────────────────────────────────────────── */
function KpiTile({
  label, value, sub, icon: Icon, accent,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; accent: string;
}) {
  return (
    <div className="rounded-2xl p-5 flex flex-col gap-2" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "rgba(148,163,184,1)" }}>{label}</span>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${accent}22` }}>
          <Icon className="w-4 h-4" style={{ color: accent }} />
        </div>
      </div>
      <p className="text-4xl font-black text-white leading-none tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function OrderPanel({
  title, icon: Icon, accent, todayOrders, yestOrders,
}: {
  title: string; icon: React.ElementType; accent: string;
  todayOrders: Row[]; yestOrders: Row[];
}) {
  const todayByStatus = useMemo(() => groupByStatus(todayOrders), [todayOrders]);
  const yestPending = useMemo(() => yestOrders.filter(o => ACTIVE_STATUSES.includes(statusOf(o))), [yestOrders]);
  const yestPendingByStatus = useMemo(() => groupByStatus(yestPending), [yestPending]);

  const todayActive = todayOrders.filter(o => ACTIVE_STATUSES.includes(statusOf(o))).length;
  const todayComplete = todayOrders.filter(o => statusOf(o) === "FA").length;

  return (
    <div className="rounded-2xl overflow-hidden flex flex-col" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      {/* header */}
      <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: `${accent}18` }}>
        <Icon className="w-4 h-4" style={{ color: accent }} />
        <span className="text-sm font-bold text-white">{title}</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-slate-400">Today: <span className="text-white font-bold">{todayOrders.length}</span></span>
          <span className="text-xs" style={{ color: "#22c55e" }}>Done: <span className="font-bold">{todayComplete}</span></span>
          <span className="text-xs text-amber-400">Active: <span className="font-bold">{todayActive}</span></span>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Today */}
        <div className="flex-1 p-3 space-y-1.5" style={{ borderRight: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">Today by Status</p>
          {Object.entries(SHIPPING_STATUS).map(([code, meta]) => {
            const cnt = todayByStatus[code] ?? 0;
            if (!cnt) return null;
            return (
              <div key={code} className="flex items-center gap-2 rounded-lg px-2 py-1" style={{ background: meta.bg }}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: meta.dot }} />
                <span className="text-xs flex-1 truncate" style={{ color: meta.color }}>{code} · {meta.label}</span>
                <span className="text-xs font-bold text-white tabular-nums">{cnt}</span>
              </div>
            );
          })}
          {Object.keys(todayByStatus).length === 0 && (
            <p className="text-xs text-slate-600 py-4 text-center">No orders today</p>
          )}
        </div>

        {/* Yesterday pending */}
        <div className="flex-1 p-3 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">
            Yesterday Pending <span className="text-amber-400">({yestPending.length})</span>
          </p>
          {Object.entries(SHIPPING_STATUS).filter(([c]) => ACTIVE_STATUSES.includes(c)).map(([code, meta]) => {
            const cnt = yestPendingByStatus[code] ?? 0;
            if (!cnt) return null;
            return (
              <div key={code} className="flex items-center gap-2 rounded-lg px-2 py-1" style={{ background: meta.bg }}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: meta.dot }} />
                <span className="text-xs flex-1 truncate" style={{ color: meta.color }}>{code} · {meta.label}</span>
                <span className="text-xs font-bold text-amber-300 tabular-nums">{cnt}</span>
              </div>
            );
          })}
          {yestPending.length === 0 && (
            <p className="text-xs text-slate-600 py-4 text-center">No pending</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── main ───────────────────────────────────────────────────── */
const REFRESH_SEC = 120;

export default function KpiPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const now = useClock();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  /* data */
  const [inventory, setInventory] = useState<Row[]>([]);
  const [locations, setLocations] = useState<Row[]>([]);
  const [b2bOrders, setB2bOrders] = useState<Row[]>([]);
  const [b2cOrders, setB2cOrders] = useState<Row[]>([]);
  const [clusters, setClusters] = useState<B2CCluster[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [countdown, setCountdown] = useState(REFRESH_SEC);

  const headers = useMemo(
    (): Record<string, string> => user
      ? { Authorization: `Bearer ${user.token}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" },
    [user]
  );

  /* fullscreen */
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }
  useEffect(() => {
    function onFsChange() { setIsFullscreen(!!document.fullscreenElement); }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  /* load */
  const load = useCallback(async () => {
    if (!user) return;
    setDataLoading(true);
    const today = fmtDate(new Date());
    const yest = (() => { const d = new Date(); d.setDate(d.getDate()-1); return fmtDate(d); })();
    const base = { limit: 2000, pageSize: 2000, warehouseCode: "STOO1" };

    try {
      const [rInv, rLoc, rB2B, rB2C, rClusters] = await Promise.all([
        fetch("/api/wms/inventory/detail", { method: "POST", headers, body: JSON.stringify({ pageSize: 9999 }) }),
        fetch("/api/wms/warehouse/location/list", { method: "POST", headers, body: JSON.stringify({ page: 1, pageSize: 9999, warehouseCode: "", search: "", sortField: "WarehouseCode", sortDir: "asc" }) }),
        fetch("/api/wms/shipping/b2b/list", { method: "POST", headers, body: JSON.stringify({ ...base, orderType: "B2B", dateFrom: yest, dateTo: today }) }),
        fetch("/api/wms/shipping/b2c/list", { method: "POST", headers, body: JSON.stringify({ ...base, orderType: "B2C", dateFrom: yest, dateTo: today }) }),
        fetch("/api/cluster"),
      ]);

      const [dInv, dLoc, dB2B, dB2C, dClusters] = await Promise.all([
        rInv.json().catch(() => ({})),
        rLoc.json().catch(() => ({})),
        rB2B.json().catch(() => ({})),
        rB2C.json().catch(() => ({})),
        rClusters.json().catch(() => []),
      ]);

      setInventory(arrOf(dInv));
      setLocations(arrOf(dLoc));
      setB2bOrders(arrOf(dB2B));
      setB2cOrders(arrOf(dB2C));
      setClusters(Array.isArray(dClusters) ? dClusters as B2CCluster[] : []);
    } catch { /* silent */ }

    setDataLoading(false);
    setCountdown(REFRESH_SEC);
  }, [user, headers]);

  useEffect(() => { if (!authLoading && !user) router.replace("/login"); }, [user, authLoading, router]);
  useEffect(() => { if (user) load(); }, [user, load]);

  useEffect(() => {
    const id = setInterval(() => {
      setCountdown(c => { if (c <= 1) { load(); return REFRESH_SEC; } return c - 1; });
    }, 1000);
    return () => clearInterval(id);
  }, [load]);

  /* derived */
  const todayStr_ = todayStr();
  const yestStr_ = yesterdayStr();

  const b2bToday = useMemo(() => b2bOrders.filter(o => orderDateOf(o) === todayStr_), [b2bOrders, todayStr_]);
  const b2bYest  = useMemo(() => b2bOrders.filter(o => orderDateOf(o) === yestStr_),  [b2bOrders, yestStr_]);
  const b2cToday = useMemo(() => b2cOrders.filter(o => orderDateOf(o) === todayStr_), [b2cOrders, todayStr_]);
  const b2cYest  = useMemo(() => b2cOrders.filter(o => orderDateOf(o) === yestStr_),  [b2cOrders, yestStr_]);

  const totalQty   = useMemo(() => inventory.reduce((s, i) => s + (Number(i.qty) || 0), 0), [inventory]);
  const totalSkus  = useMemo(() => new Set(inventory.map(i => String(i.productSku ?? i.sku ?? "")).filter(Boolean)).size, [inventory]);
  const totalLocs  = locations.length;
  const occupiedLocs = useMemo(() => {
    const norm = (s: string) => s.toLowerCase().replace(/[\s\-_/]+/g, "");
    const set = new Set(inventory.map(i => norm(String(i.locationCode ?? i.location ?? ""))).filter(Boolean));
    return locations.filter(l => {
      const direct = String(l.locationCode ?? l.location ?? "");
      return set.has(norm(direct)) || Number(l.currentQty ?? l.qty ?? 0) > 0;
    }).length;
  }, [inventory, locations]);

  /* cluster stats for today */
  const todayClusters = useMemo(() => {
    return clusters
      .filter(c => c.completedAt && isoDate(c.completedAt) === todayStr_)
      .map(c => ({ cluster: c, stats: clusterStats(c) }))
      .sort((a, b) => new Date(b.cluster.completedAt!).getTime() - new Date(a.cluster.completedAt!).getTime());
  }, [clusters, todayStr_]);

  const clusterAvgUnitsPerHr = useMemo(() => {
    const valid = todayClusters.filter(x => x.stats.unitsPerHr !== null);
    if (!valid.length) return null;
    return Math.round(valid.reduce((s, x) => s + x.stats.unitsPerHr!, 0) / valid.length);
  }, [todayClusters]);

  const clusterTotalUnitsToday = useMemo(() =>
    todayClusters.reduce((s, x) => s + x.stats.totalUnits, 0), [todayClusters]);

  const clusterTotalOrdersToday = useMemo(() =>
    todayClusters.reduce((s, x) => s + x.stats.totalOrders, 0), [todayClusters]);

  /* time display */
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const dateStr = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

  if (authLoading) return null;

  return (
    <div
      ref={containerRef}
      className="min-h-screen flex flex-col select-none"
      style={{ background: "radial-gradient(ellipse at 20% 0%, #0f2040 0%, #060d1a 60%)", fontFamily: "inherit" }}
    >
      {/* ── Top Bar ── */}
      <header className="flex items-center gap-4 px-6 py-3 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
            <Layers className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-bold text-white">WMS · KPI Display</span>
        </div>

        <div className="flex items-center gap-2 ml-4 text-xs text-slate-500">
          {dataLoading
            ? <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
            : <RefreshCw className="w-3 h-3" />}
          <span>Refresh in {countdown}s</span>
          <button onClick={load} className="text-slate-500 hover:text-white transition-colors ml-1">
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-4">
          <div className="text-right">
            <p className="text-2xl font-black text-white tabular-nums tracking-wide">{timeStr}</p>
            <p className="text-[11px] text-slate-400">{dateStr}</p>
          </div>
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={() => router.push("/dashboard")}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Back to dashboard"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ── Main ── */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">

        {/* ── Row 1: Big KPI tiles ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <KpiTile label="Total Inventory" value={totalQty} sub="units on hand" icon={Boxes} accent="#3b82f6" />
          <KpiTile label="Total SKUs" value={totalSkus} sub="distinct products" icon={Package} accent="#8b5cf6" />
          <KpiTile label="Occupied Locs" value={`${occupiedLocs}/${totalLocs}`} sub="locations in use" icon={MapPin} accent="#14b8a6" />
          <KpiTile label="B2B Today" value={b2bToday.length} sub={`${b2bToday.filter(o=>statusOf(o)==="FA").length} complete`} icon={Building2} accent="#f59e0b" />
          <KpiTile label="B2C Today" value={b2cToday.length} sub={`${b2cToday.filter(o=>statusOf(o)==="FA").length} complete`} icon={User} accent="#ec4899" />
          <KpiTile
            label="Cluster Units/hr"
            value={clusterAvgUnitsPerHr !== null ? clusterAvgUnitsPerHr : "—"}
            sub={todayClusters.length ? `${todayClusters.length} runs · ${clusterTotalUnitsToday} units` : "No clusters today"}
            icon={TrendingUp}
            accent="#22c55e"
          />
        </div>

        {/* ── Row 2: B2B + B2C order panels ── */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <OrderPanel
            title="B2B Orders"
            icon={Building2}
            accent="#f59e0b"
            todayOrders={b2bToday}
            yestOrders={b2bYest}
          />
          <OrderPanel
            title="B2C Orders"
            icon={User}
            accent="#ec4899"
            todayOrders={b2cToday}
            yestOrders={b2cYest}
          />
        </div>

        {/* ── Row 3: Inventory by type + Cluster performance ── */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

          {/* Inventory by location type */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <MapPin className="w-4 h-4 text-teal-400" />
              <span className="text-sm font-bold text-white">Location Occupancy</span>
              <span className="ml-auto text-xs text-slate-500">{occupiedLocs} / {totalLocs} occupied</span>
            </div>
            <div className="p-4 space-y-2">
              {(() => {
                const byType: Record<string, { total: number; occupied: number }> = {};
                const norm = (s: string) => s.toLowerCase().replace(/[\s\-_/]+/g, "");
                const invSet = new Set(inventory.map(i => norm(String(i.locationCode ?? i.location ?? ""))).filter(Boolean));
                for (const loc of locations) {
                  const t = String(loc.occupancyInfo ?? loc.locationType ?? "Other");
                  if (!byType[t]) byType[t] = { total: 0, occupied: 0 };
                  byType[t].total++;
                  const direct = norm(String(loc.locationCode ?? loc.location ?? ""));
                  if (invSet.has(direct) || Number(loc.currentQty ?? loc.qty ?? 0) > 0) byType[t].occupied++;
                }
                return Object.entries(byType).sort((a, b) => b[1].occupied - a[1].occupied).map(([type, d]) => {
                  const pct = d.total > 0 ? Math.round((d.occupied / d.total) * 100) : 0;
                  return (
                    <div key={type}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-300 truncate max-w-[160px]">{type}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500 tabular-nums">{d.occupied}/{d.total}</span>
                          <span className="text-xs font-bold text-white tabular-nums w-9 text-right">{pct}%</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : "#3b82f6", transition: "width 0.8s ease" }}
                        />
                      </div>
                    </div>
                  );
                });
              })()}
              {locations.length === 0 && <p className="text-xs text-slate-600 text-center py-4">No location data</p>}
            </div>
          </div>

          {/* Cluster pick performance */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <Layers className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-bold text-white">Cluster Pick · Today</span>
              <div className="ml-auto flex items-center gap-4 text-xs">
                <span className="text-slate-400">Orders: <span className="text-white font-bold">{clusterTotalOrdersToday}</span></span>
                <span className="text-slate-400">Units: <span className="text-white font-bold">{clusterTotalUnitsToday}</span></span>
                {clusterAvgUnitsPerHr !== null && (
                  <span className="text-emerald-400 font-bold">avg {clusterAvgUnitsPerHr} u/hr</span>
                )}
              </div>
            </div>
            <div className="overflow-auto" style={{ maxHeight: 240 }}>
              {todayClusters.length === 0 ? (
                <div className="flex items-center justify-center h-24 text-xs text-slate-600">
                  No completed clusters today
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      {["Cluster #","Orders","Units","Duration","Units/hr","Orders/hr"].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {todayClusters.map(({ cluster, stats }) => (
                      <tr key={cluster.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <td className="px-3 py-2 font-mono text-blue-300 font-bold">
                          #{String(cluster.clusterNo ?? "—").padStart(4,"0")}
                        </td>
                        <td className="px-3 py-2 text-white font-semibold">{stats.totalOrders}</td>
                        <td className="px-3 py-2 text-white font-semibold">{stats.totalUnits}</td>
                        <td className="px-3 py-2 text-slate-300 tabular-nums">
                          {stats.durationMin !== null
                            ? stats.durationMin >= 60
                              ? `${Math.floor(stats.durationMin/60)}h ${stats.durationMin%60}m`
                              : `${stats.durationMin}m`
                            : "—"}
                        </td>
                        <td className="px-3 py-2 font-bold" style={{ color: stats.unitsPerHr && stats.unitsPerHr > 0 ? "#22c55e" : "#94a3b8" }}>
                          {stats.unitsPerHr ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-300 tabular-nums">{stats.ordersPerHr ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* footer */}
      <footer className="px-6 py-2 flex items-center justify-between text-[10px] text-slate-600 flex-shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <span>Spider WMS · KPI Display</span>
        <span>Auto-refresh every {REFRESH_SEC}s</span>
      </footer>
    </div>
  );
}
