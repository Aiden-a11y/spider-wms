"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import {
  RefreshCw, MapPin, PackageCheck, Truck, RotateCcw, Boxes, TrendingUp,
  AlertCircle, ChevronRight, LayoutGrid,
} from "lucide-react";

type Row = Record<string, unknown>;

const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string; bigColor: string; bar: string; glow: string; ring: string }> = {
  AA: { label: "Pre-Alert",  color: "text-yellow-700", bg: "bg-yellow-50", border: "border-yellow-200", bigColor: "text-yellow-600", bar: "bg-yellow-400", glow: "shadow-yellow-200", ring: "ring-yellow-300" },
  CA: { label: "Processing", color: "text-blue-700",   bg: "bg-blue-50",   border: "border-blue-200",   bigColor: "text-blue-600",   bar: "bg-blue-500",   glow: "shadow-blue-200",   ring: "ring-blue-300"   },
  DA: { label: "Complete",   color: "text-green-700",  bg: "bg-green-50",  border: "border-green-200",  bigColor: "text-green-600",  bar: "bg-green-500",  glow: "shadow-green-200",  ring: "ring-green-300"  },
  EA: { label: "Hold",       color: "text-red-700",    bg: "bg-red-50",    border: "border-red-200",    bigColor: "text-red-600",    bar: "bg-red-400",    glow: "shadow-red-200",    ring: "ring-red-300"    },
};

const LOC_COLORS: Record<string, { bar: string; dot: string; grad: string; hex: string }> = {
  "Bin":            { bar: "bg-blue-500",   dot: "bg-blue-500",   grad: "from-blue-400 to-blue-600",     hex: "#3b82f6" },
  "Pallet Regular": { bar: "bg-purple-500", dot: "bg-purple-500", grad: "from-purple-400 to-purple-600", hex: "#a855f7" },
  "Pallet Short":   { bar: "bg-violet-400", dot: "bg-violet-400", grad: "from-violet-400 to-violet-600", hex: "#a78bfa" },
  "Pallet Tall":    { bar: "bg-indigo-500", dot: "bg-indigo-500", grad: "from-indigo-400 to-indigo-600", hex: "#6366f1" },
  "Carton":         { bar: "bg-orange-400", dot: "bg-orange-400", grad: "from-orange-400 to-orange-500", hex: "#fb923c" },
  "Shelf(Large)":   { bar: "bg-teal-500",   dot: "bg-teal-500",   grad: "from-teal-400 to-teal-600",     hex: "#14b8a6" },
};
const FALLBACK_COLORS = ["#94a3b8","#64748b","#475569","#334155"];

/* ── Donut Chart ── */
function DonutChart({
  data, visible,
}: {
  data: [string, number][];
  visible: boolean;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const total = data.reduce((s, [, c]) => s + c, 0);
  if (total === 0) return <p className="text-xs text-slate-400 text-center py-8">No data</p>;

  const R = 54; const r = 34; const cx = 70; const cy = 70;
  const circumference = 2 * Math.PI * R;

  // build segments
  let offset = -0.25 * circumference; // start at top
  const segments = data.map(([type, count], i) => {
    const pct = count / total;
    const len = pct * circumference;
    const seg = { type, count, pct, offset, len, color: LOC_COLORS[type]?.hex ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length] };
    offset += len;
    return seg;
  });

  const hovSeg = segments.find((s) => s.type === hovered);
  const centerLabel = hovSeg
    ? { top: hovSeg.type.split(" ")[0], count: hovSeg.count, pct: Math.round(hovSeg.pct * 100) }
    : { top: "Total", count: total, pct: 100 };

  return (
    <div className="flex flex-col items-center gap-4">
      {/* ring */}
      <div className="relative">
        <svg width={140} height={140} viewBox="0 0 140 140">
          {/* track */}
          <circle cx={cx} cy={cy} r={R} fill="none" stroke="#f1f5f9" strokeWidth={20} />
          {/* segments */}
          {segments.map((seg) => {
            const isHov = hovered === seg.type;
            return (
              <circle
                key={seg.type}
                cx={cx} cy={cy} r={R}
                fill="none"
                stroke={seg.color}
                strokeWidth={isHov ? 24 : 20}
                strokeDasharray={`${visible ? seg.len : 0} ${circumference}`}
                strokeDashoffset={-seg.offset}
                strokeLinecap="butt"
                onMouseEnter={() => setHovered(seg.type)}
                onMouseLeave={() => setHovered(null)}
                className="cursor-pointer"
                style={{
                  transition: visible
                    ? "stroke-dasharray 1s cubic-bezier(0.34,1.2,0.64,1), stroke-width 0.2s, filter 0.2s"
                    : "none",
                  filter: isHov ? `drop-shadow(0 0 6px ${seg.color}aa)` : "none",
                  transformOrigin: `${cx}px ${cy}px`,
                }}
              />
            );
          })}
          {/* center text */}
          <text x={cx} y={cy - 8} textAnchor="middle" className="text-slate-400" fontSize={9} fill="#94a3b8">{centerLabel.top}</text>
          <text x={cx} y={cy + 8} textAnchor="middle" fontWeight="800" fontSize={18} fill={hovSeg ? hovSeg.color : "#1e293b"}>
            {hovSeg ? `${centerLabel.pct}%` : centerLabel.count.toLocaleString()}
          </text>
          {hovSeg && (
            <text x={cx} y={cy + 22} textAnchor="middle" fontSize={9} fill="#94a3b8">{hovSeg.count.toLocaleString()}</text>
          )}
        </svg>
      </div>

      {/* legend */}
      <div className="w-full space-y-1.5">
        {segments.map((seg) => {
          const isHov = hovered === seg.type;
          return (
            <div
              key={seg.type}
              onMouseEnter={() => setHovered(seg.type)}
              onMouseLeave={() => setHovered(null)}
              className={`flex items-center gap-2 px-2 py-1 rounded-lg cursor-default transition-all duration-150
                ${isHov ? "bg-slate-50 scale-[1.02]" : ""}`}
            >
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 transition-transform duration-150"
                style={{ background: seg.color, transform: isHov ? "scale(1.4)" : "scale(1)" }} />
              <span className="text-xs text-slate-600 flex-1 truncate">{seg.type}</span>
              <span className="text-xs font-bold tabular-nums" style={{ color: isHov ? seg.color : "#334155" }}>
                {seg.count.toLocaleString()}
              </span>
              <span className="text-xs text-slate-400 w-8 text-right tabular-nums">{Math.round(seg.pct * 100)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const AUTO_REFRESH_SEC = 300;

/* ── Count-up ── */
function useCountUp(target: number, active: boolean) {
  const [val, setVal] = useState(0);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!active) { setVal(0); return; }
    if (target === 0) { setVal(0); return; }
    const steps = 60;
    let step = 0;
    const easeOut = (t: number) => 1 - (1 - t) ** 4;
    const id = setInterval(() => {
      step++;
      if (step >= steps) {
        setVal(target);
        setFlash(true);
        setTimeout(() => setFlash(false), 400);
        clearInterval(id);
      } else {
        setVal(Math.round(target * easeOut(step / steps)));
      }
    }, 800 / steps);
    return () => clearInterval(id);
  }, [target, active]);
  return { val, flash };
}

/* ── Ripple ── */
function useRipple() {
  const [ripples, setRipples] = useState<{ x: number; y: number; id: number }[]>([]);
  function trigger(e: React.MouseEvent<HTMLElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const id = Date.now();
    setRipples((r) => [...r, { x: e.clientX - rect.left, y: e.clientY - rect.top, id }]);
    setTimeout(() => setRipples((r) => r.filter((rp) => rp.id !== id)), 600);
  }
  return { ripples, trigger };
}

/* ── KPI Card ── */
function KpiCard({
  label, value, sub, icon: Icon, accentColor, numColor, href, animated, delay = 0, size = "md",
}: {
  label: string; value: number; sub?: string;
  icon: React.ElementType; accentColor: string; numColor: string;
  href?: string; animated: boolean; delay?: number;
  size?: "md" | "lg";
}) {
  const router = useRouter();
  const { val, flash } = useCountUp(value, animated);
  const { ripples, trigger } = useRipple();
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={(e) => { trigger(e); if (href) setTimeout(() => router.push(href), 150); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ animationDelay: `${delay}ms` }}
      className={`relative overflow-hidden bg-white rounded-2xl shadow-sm select-none
        transition-all duration-300
        ${animated ? "animate-[fadeSlideUp_0.5s_ease_forwards]" : "opacity-0"}
        ${href ? "cursor-pointer" : ""}
        ${hovered && href ? "shadow-xl -translate-y-1.5 scale-[1.025]" : "shadow-sm"}
        ${size === "lg" ? "p-7" : "p-5"}`}
    >
      {/* top accent bar */}
      <div className={`absolute top-0 left-0 right-0 h-1 ${accentColor} transition-all duration-300
        ${hovered ? "h-1.5" : ""}`} />

      {/* ripple */}
      {ripples.map((rp) => (
        <span
          key={rp.id}
          className="absolute rounded-full opacity-20 pointer-events-none animate-[ripple_0.6s_ease-out]"
          style={{ left: rp.x - 60, top: rp.y - 60, width: 120, height: 120, background: "currentColor" }}
        />
      ))}

      {/* watermark icon */}
      <Icon className={`absolute right-3 bottom-2 transition-all duration-300 opacity-[0.07]
        ${hovered ? "opacity-[0.12] scale-110" : ""}
        ${size === "lg" ? "w-20 h-20" : "w-16 h-16"} text-slate-900`} />

      {/* content */}
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">{label}</p>

      <p className={`font-black leading-none tabular-nums transition-all duration-200
        ${size === "lg" ? "text-6xl" : "text-4xl"}
        ${flash ? `${numColor} scale-105` : "text-slate-900"}`}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {val.toLocaleString()}
      </p>

      {sub && (
        <p className={`font-medium mt-2 text-slate-400 transition-colors duration-200
          ${size === "lg" ? "text-sm" : "text-xs"}`}>
          {sub}
        </p>
      )}

      {href && (
        <div className={`mt-3 flex items-center gap-1 text-xs font-semibold transition-all duration-200
          ${hovered ? `${numColor} gap-2` : "text-slate-300"}`}>
          View all
          <ChevronRight className="w-3.5 h-3.5" />
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════ */

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Row | null>(null);
  const [locations, setLocations] = useState<Row[]>([]);
  const [receiving, setReceiving] = useState<Row[]>([]);
  const [inventory, setInventory] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [animated, setAnimated] = useState(false);
  const [barsVisible, setBarsVisible] = useState(false);
  const [locTab, setLocTab] = useState<"type" | "zone">("type");
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [prevStatus, setPrevStatus] = useState<string | null>(null);
  const [rowsKey, setRowsKey] = useState(0);
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SEC);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  function parseList(json: unknown, ...paths: string[][]): Row[] {
    const j = json as Record<string, unknown>;
    for (const path of paths) {
      let cur: unknown = j;
      for (const p of path) cur = (cur as Record<string, unknown>)?.[p];
      if (Array.isArray(cur)) return cur as Row[];
    }
    return [];
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setAnimated(false);
    setBarsVisible(false);
    try {
      const [r1, , r3, r4, r5] = await Promise.all([
        fetch("/api/wms/dashboard", { headers }),
        fetch("/api/wms/dashboard/sidebar-summary", { headers }),
        fetch("/api/wms/warehouse/location/list", {
          method: "POST", headers,
          body: JSON.stringify({ page: 1, pageSize: 9999, warehouseCode: "", search: "", sortField: "WarehouseCode", sortDir: "asc" }),
        }),
        fetch("/api/wms/receiving/list", {
          method: "POST", headers,
          body: JSON.stringify({ page: 1, limit: 9999 }),
        }),
        // inventory/detail — 전체 재고 (warehouseCode 없이 = 전 창고)
        fetch("/api/wms/inventory/detail", {
          method: "POST", headers,
          body: JSON.stringify({ pageSize: 9999 }),
        }),
      ]);
      const [d1, d3, d4, d5] = await Promise.all([r1.json(), r3.json(), r4.json(), r5.json()]);
      setSummary((d1?.data ?? d1) as Row);
      setLocations(parseList(d3, ["data", "list"], ["data"], []));
      setReceiving(parseList(d4, ["data", "list"], ["data"], ["list"], []));
      setInventory(parseList(d5, ["data"], ["data", "list"], ["list"], []));
      setLastUpdated(new Date());
      setTimeout(() => setAnimated(true), 80);
      setTimeout(() => setBarsVisible(true), 300);
    } catch {
      setError("Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
    setCountdown(AUTO_REFRESH_SEC);
  }, [headers]); // eslint-disable-line

  useEffect(() => { load(); }, []); // eslint-disable-line

  useEffect(() => {
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { load(); return AUTO_REFRESH_SEC; }
        return c - 1;
      });
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [load]);

  const get = (obj: Row | null, ...keys: string[]): number => {
    if (!obj) return 0;
    for (const k of keys) {
      const v = obj[k];
      if (v !== undefined && v !== null) return Number(v) || 0;
    }
    return 0;
  };

  const locByType = useMemo(() => {
    const map: Record<string, number> = {};
    for (const loc of locations) {
      const t = String(loc.occupancyInfo ?? "Other");
      map[t] = (map[t] ?? 0) + 1;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [locations]);

  const locByZone = useMemo(() => {
    const map: Record<string, number> = {};
    for (const loc of locations) {
      const z = String(loc.zoneNm ?? "?");
      map[z] = (map[z] ?? 0) + 1;
    }
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [locations]);

  const rcvByStatus = useMemo(() => {
    const map: Record<string, number> = { AA: 0, CA: 0, DA: 0, EA: 0 };
    for (const r of receiving) {
      const s = String(r.status ?? "");
      if (s in map) map[s]++;
    }
    return map;
  }, [receiving]);

  const maxZoneCount = Math.max(...locByZone.map(([, c]) => c), 1);

  const recentOrders = useMemo(() => {
    const list = selectedStatus
      ? receiving.filter((r) => String(r.status ?? "") === selectedStatus)
      : receiving;
    return list.slice(0, 8);
  }, [receiving, selectedStatus]);

  function handleStatusClick(key: string) {
    const next = selectedStatus === key ? null : key;
    setPrevStatus(selectedStatus);
    setSelectedStatus(next);
    setRowsKey((k) => k + 1);
  }

  const circumference = 2 * Math.PI * 10;
  const dashOffset = circumference * (1 - countdown / AUTO_REFRESH_SEC);
  const urgentRefresh = countdown <= 30;

  // ── 직접 계산 (summary API 필드명 의존 X) ──
  const totalLocations = locations.length;

  // 입고 대기 = status AA(Pre-Alert) + CA(Processing) 인 오더 수
  const pendingReceiving = useMemo(
    () => receiving.filter((r) => ["AA", "CA"].includes(String(r.status ?? ""))).length,
    [receiving]
  );

  // 출하 대기 = summary API 우선, 없으면 0 (shipping 전용 API 없으므로 summary 활용)
  const pendingShipments = get(summary, "pendingShipping", "pending_shipping", "pendingOrder", "shippingCount");

  // 반품 = summary API 우선
  const returns = get(summary, "pendingReturn", "returnCount", "pending_return", "returnsCount");

  // SKU 수 = 재고 리스트에서 distinct productSku
  const totalSKUs = useMemo(
    () => new Set(inventory.map((i) => String(i.productSku ?? i.sku ?? "")).filter(Boolean)).size,
    [inventory]
  );

  // 총 재고 수량 = 재고 리스트의 qty 합산
  const totalInventory = useMemo(
    () => inventory.reduce((sum, i) => sum + (Number(i.qty) || 0), 0),
    [inventory]
  );

  /* ── skeleton ── */
  if (loading && !lastUpdated) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="h-6 w-32 bg-slate-200 rounded animate-pulse mb-2" />
            <div className="h-4 w-48 bg-slate-100 rounded animate-pulse" />
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          {[...Array(4)].map((_, i) => <div key={i} className="bg-white rounded-2xl border border-slate-100 h-28 animate-pulse" />)}
        </div>
        <div className="grid grid-cols-2 gap-4 mb-6">
          {[...Array(2)].map((_, i) => <div key={i} className="bg-white rounded-2xl border border-slate-100 h-28 animate-pulse" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="bg-white rounded-2xl border border-slate-100 h-72 animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* keyframes */}
      <style jsx global>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes ripple {
          from { transform: scale(0); opacity: 0.5; }
          to   { transform: scale(4); opacity: 0; }
        }
        @keyframes slideInRow {
          from { opacity: 0; transform: translateX(-12px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes barBounce {
          0%   { width: 0%; }
          80%  { width: calc(var(--bar-w) + 4%); }
          100% { width: var(--bar-w); }
        }
        @keyframes pulse-ring {
          0%   { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
          70%  { box-shadow: 0 0 0 8px rgba(239,68,68,0); }
          100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
        }
      `}</style>

      <div className="p-8">
        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-8">
          <div className={animated ? "animate-[fadeSlideUp_0.4s_ease_forwards]" : "opacity-0"}>
            <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
            <p className="text-slate-500 text-sm mt-0.5">
              {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Warehouse operations overview"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* countdown ring */}
            <div
              className={`flex items-center gap-2 text-xs select-none transition-colors duration-500 ${urgentRefresh ? "text-red-400" : "text-slate-400"}`}
              title={`Auto-refresh in ${countdown}s`}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" className="-rotate-90"
                style={urgentRefresh ? { animation: "pulse-ring 1s ease infinite" } : {}}>
                <circle cx="12" cy="12" r="10" fill="none" stroke={urgentRefresh ? "#fecaca" : "#e2e8f0"} strokeWidth="2.5" />
                <circle
                  cx="12" cy="12" r="10" fill="none"
                  stroke={urgentRefresh ? "#ef4444" : "#3b82f6"}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  style={{ transition: "stroke-dashoffset 1s linear, stroke 0.5s" }}
                />
              </svg>
              <span className={`tabular-nums font-medium ${urgentRefresh ? "text-red-400" : ""}`}>
                {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}
              </span>
            </div>

            <button
              onClick={load} disabled={loading}
              className="flex items-center gap-2 text-sm text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded-xl px-3 py-2 hover:bg-blue-50 transition-all duration-200 disabled:opacity-50 active:scale-95"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-6">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
          </div>
        )}

        {/* ── KPI Row 1: 핵심 운영 지표 ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          <KpiCard label="Pending Receiving" value={pendingReceiving} sub="Scheduled inbound" icon={PackageCheck} accentColor="bg-emerald-500" numColor="text-emerald-600" href="/receiving" animated={animated} delay={0}   size="lg" />
          <KpiCard label="Pending Shipments" value={pendingShipments} sub="Awaiting dispatch" icon={Truck}        accentColor="bg-amber-500"   numColor="text-amber-600"   href="/shipping"  animated={animated} delay={60}  size="lg" />
          <KpiCard label="Returns"           value={returns}          sub="Needs review"       icon={RotateCcw}    accentColor="bg-red-500"     numColor="text-red-600"     href="/returns"   animated={animated} delay={120} size="lg" />
        </div>
        {/* ── KPI Row 2: 재고 현황 ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <KpiCard label="Total Locations"  value={totalLocations}  sub="Registered slots"               icon={MapPin}     accentColor="bg-blue-500"   numColor="text-blue-600"   href="/inventory" animated={animated} delay={180} />
          <KpiCard label="Total SKUs"       value={totalSKUs}       sub="Distinct products in warehouse" icon={Boxes}      accentColor="bg-purple-500" numColor="text-purple-600" href="/products"  animated={animated} delay={240} />
          <KpiCard label="Total Inventory"  value={totalInventory}  sub="Units currently in stock"       icon={TrendingUp} accentColor="bg-indigo-500" numColor="text-indigo-600" href="/inventory" animated={animated} delay={300} />
        </div>

        {/* ── Analytics Row ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">

          {/* Location breakdown */}
          <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm p-5 transition-all duration-500 ${animated ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
            style={{ transitionDelay: "360ms" }}>
            <div className="flex items-center gap-2 mb-4">
              <MapPin className="w-4 h-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-700">Locations</h2>
              <span className="ml-auto text-xs text-slate-400">{locations.length.toLocaleString()} total</span>
            </div>

            {/* Tab switcher */}
            <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-4">
              {(["type", "zone"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setLocTab(tab)}
                  className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-all duration-250
                    ${locTab === tab
                      ? "bg-white text-slate-800 shadow-sm scale-[1.02]"
                      : "text-slate-400 hover:text-slate-600 hover:bg-white/50"}`}
                >
                  {tab === "type" ? "By Type" : "By Zone"}
                </button>
              ))}
            </div>

            {locTab === "type" && (
              <DonutChart data={locByType} visible={barsVisible} />
            )}

            {locTab === "zone" && (
              <div className="space-y-2">
                {locByZone.slice(0, 8).map(([zone, count], i) => {
                  const pct = Math.round((count / maxZoneCount) * 100);
                  return (
                    <div key={zone}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-slate-600">Zone {zone}</span>
                        <span className="text-xs font-bold text-slate-700 tabular-nums">{count.toLocaleString()}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                        <div
                          className="h-2.5 rounded-full"
                          style={{
                            width: barsVisible ? `${pct}%` : "0%",
                            background: "linear-gradient(90deg,#3b82f6,#6366f1)",
                            transition: `width 0.8s cubic-bezier(0.34,1.56,0.64,1) ${i * 60}ms`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
                {locByZone.length === 0 && <p className="text-xs text-slate-400 text-center py-4">No data</p>}
              </div>
            )}
          </div>

          {/* Receiving Pipeline */}
          <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm p-5 transition-all duration-500 ${animated ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
            style={{ transitionDelay: "420ms" }}>
            <div className="flex items-center gap-2 mb-4">
              <PackageCheck className="w-4 h-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-700">Receiving Pipeline</h2>
              <span className="ml-auto text-xs text-slate-400">{receiving.length} orders</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(["AA", "CA", "DA", "EA"] as const).map((key) => {
                const meta = STATUS_META[key];
                const count = rcvByStatus[key] ?? 0;
                const pct = receiving.length ? Math.round((count / receiving.length) * 100) : 0;
                const isSelected = selectedStatus === key;
                const otherSelected = selectedStatus !== null && !isSelected;

                return (
                  <button
                    key={key}
                    onClick={() => handleStatusClick(key)}
                    className={`relative overflow-hidden ${meta.bg} border ${meta.border} rounded-xl px-3 py-3 text-left
                      transition-all duration-300 active:scale-90
                      ${isSelected
                        ? `ring-2 ring-offset-2 ${meta.ring} shadow-lg ${meta.glow} scale-[1.04]`
                        : otherSelected
                          ? "opacity-40 scale-95"
                          : "hover:scale-[1.03] hover:shadow-md"}`}
                  >
                    {/* selected shimmer */}
                    {isSelected && (
                      <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent
                        animate-[shimmer_1.5s_ease_infinite]" style={{ backgroundSize: "200% 100%" }} />
                    )}
                    <p className={`text-4xl font-black ${meta.bigColor} leading-none tabular-nums
                      transition-all duration-200 ${isSelected ? "scale-110" : ""}`}>
                      {count}
                    </p>
                    <p className="text-xs text-slate-500 mt-1.5 mb-2.5 font-semibold tracking-wide uppercase">{meta.label}</p>
                    <div className="w-full bg-white/60 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`${meta.bar} h-1.5 rounded-full transition-all duration-700`}
                        style={{ width: barsVisible ? `${pct}%` : "0%" }}
                      />
                    </div>
                    <p className="text-xs text-slate-400 mt-1 text-right tabular-nums">{pct}%</p>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 h-5 flex items-center justify-center">
              {selectedStatus ? (
                <p className="text-xs text-center text-slate-400 animate-[fadeSlideUp_0.3s_ease_forwards]">
                  Showing{" "}
                  <span className={`font-semibold ${STATUS_META[selectedStatus].bigColor}`}>
                    {STATUS_META[selectedStatus].label}
                  </span>{" "}
                  orders &mdash;{" "}
                  <button onClick={() => { setSelectedStatus(null); setRowsKey((k) => k + 1); }}
                    className="underline hover:text-slate-600 transition-colors">
                    clear
                  </button>
                </p>
              ) : (
                <p className="text-xs text-slate-300">Click a card to filter orders ↓</p>
              )}
            </div>

            {receiving.length === 0 && <p className="text-xs text-slate-400 text-center py-4">No data</p>}
          </div>

          {/* Quick Access */}
          <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm p-5 transition-all duration-500 ${animated ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
            style={{ transitionDelay: "480ms" }}>
            <div className="flex items-center gap-2 mb-4">
              <LayoutGrid className="w-4 h-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-700">Quick Access</h2>
            </div>
            <div className="space-y-1">
              {[
                { label: "Receiving Orders",  sub: `${(rcvByStatus.AA ?? 0) + (rcvByStatus.CA ?? 0)} active`, href: "/receiving",  icon: PackageCheck, iconColor: "text-green-600",  iconBg: "bg-green-100",  delay: 0   },
                { label: "Outbound Orders",   sub: `${pendingShipments} pending`,                              href: "/shipping",   icon: Truck,        iconColor: "text-amber-600",  iconBg: "bg-amber-100",  delay: 40  },
                { label: "Inventory Inquiry", sub: `${totalInventory.toLocaleString()} units`,                 href: "/inventory",  icon: Boxes,        iconColor: "text-indigo-600", iconBg: "bg-indigo-100", delay: 80  },
                { label: "Location Master",   sub: `${locations.length.toLocaleString()} slots`,               href: "/locations",  icon: MapPin,       iconColor: "text-blue-600",   iconBg: "bg-blue-100",   delay: 120 },
                { label: "Available Locations",sub: "Check open slots",                                        href: "/locations/available", icon: TrendingUp, iconColor: "text-teal-600", iconBg: "bg-teal-100", delay: 160 },
                { label: "Returns",           sub: `${returns} pending`,                                       href: "/returns",    icon: RotateCcw,    iconColor: "text-red-600",    iconBg: "bg-red-100",    delay: 200 },
              ].map(({ label, sub, href, icon: Icon, iconColor, iconBg, delay }) => (
                <button
                  key={href}
                  onClick={() => router.push(href)}
                  style={animated ? { animation: `fadeSlideUp 0.4s ease ${delay + 500}ms both` } : { opacity: 0 }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-transparent
                    hover:border-slate-200 hover:bg-slate-50 hover:shadow-sm
                    transition-all duration-200 text-left group active:scale-[0.97]"
                >
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}
                    transition-all duration-200 group-hover:scale-110 group-hover:shadow-md`}>
                    <Icon className={`w-4 h-4 ${iconColor} transition-transform duration-200 group-hover:rotate-12`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-700 group-hover:text-slate-900 transition-colors">{label}</p>
                    <p className="text-xs text-slate-400">{sub}</p>
                  </div>
                  <ChevronRight className={`w-3.5 h-3.5 transition-all duration-200 text-slate-300
                    group-hover:text-blue-500 group-hover:translate-x-1`} />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Recent Receiving Orders ── */}
        {receiving.length > 0 && (
          <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm p-5 transition-all duration-500 ${animated ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
            style={{ transitionDelay: "540ms" }}>
            <div className="flex items-center gap-2 mb-4">
              <PackageCheck className="w-4 h-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-700">
                {selectedStatus ? `${STATUS_META[selectedStatus].label} Orders` : "Recent Receiving Orders"}
              </h2>
              {selectedStatus && (
                <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_META[selectedStatus].bg} ${STATUS_META[selectedStatus].color} ${STATUS_META[selectedStatus].border}
                  animate-[fadeSlideUp_0.3s_ease_forwards]`}>
                  {rcvByStatus[selectedStatus]} orders
                </span>
              )}
              <button
                onClick={() => router.push("/receiving")}
                className="ml-auto text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 hover:gap-2 transition-all duration-200"
              >
                View all <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100">
                    {["Order Code", "Customer", "Order Date", "Status"].map((c) => (
                      <th key={c} className="px-3 py-2 text-left text-slate-400 font-medium uppercase tracking-wide">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody key={rowsKey}>
                  {recentOrders.map((row, i) => {
                    const status = String(row.status ?? "");
                    const meta = STATUS_META[status] ?? { label: status, color: "text-slate-600", bg: "bg-slate-100", border: "border-slate-200" };
                    return (
                      <tr
                        key={i}
                        onClick={() => router.push("/receiving")}
                        className="border-b border-slate-50 last:border-0 hover:bg-blue-50 cursor-pointer transition-colors duration-150 group"
                        style={{ animation: `slideInRow 0.35s ease ${i * 50}ms both` }}
                      >
                        <td className="px-3 py-2.5 font-mono text-blue-600 font-medium group-hover:text-blue-700">
                          {String(row.receiveOrderCode ?? row.orderCode ?? "-")}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700 group-hover:text-slate-900 transition-colors">
                          {String(row.customerName ?? row.customerCode ?? "-")}
                        </td>
                        <td className="px-3 py-2.5 text-slate-500">{String(row.orderDate ?? "-")}</td>
                        <td className="px-3 py-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${meta.bg} ${meta.color} ${meta.border}`}>
                            {meta.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {recentOrders.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-10 text-center text-slate-400 text-xs">
                        No orders for this status
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
