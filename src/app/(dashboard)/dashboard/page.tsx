"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import {
  RefreshCw, MapPin, PackageCheck, Truck, RotateCcw, Boxes, TrendingUp,
  AlertCircle, ChevronRight, LayoutGrid,
} from "lucide-react";

type Row = Record<string, unknown>;

const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string; bigColor: string; bar: string }> = {
  AA: { label: "Pre-Alert",  color: "text-yellow-700", bg: "bg-yellow-50", border: "border-yellow-200", bigColor: "text-yellow-600", bar: "bg-yellow-400" },
  CA: { label: "Processing", color: "text-blue-700",   bg: "bg-blue-50",   border: "border-blue-200",   bigColor: "text-blue-600",   bar: "bg-blue-500"   },
  DA: { label: "Complete",   color: "text-green-700",  bg: "bg-green-50",  border: "border-green-200",  bigColor: "text-green-600",  bar: "bg-green-500"  },
  EA: { label: "Hold",       color: "text-red-700",    bg: "bg-red-50",    border: "border-red-200",    bigColor: "text-red-600",    bar: "bg-red-400"    },
};

const LOC_COLORS: Record<string, { bar: string; dot: string }> = {
  "Bin":            { bar: "bg-blue-500",   dot: "bg-blue-500"   },
  "Pallet Regular": { bar: "bg-purple-500", dot: "bg-purple-500" },
  "Pallet Short":   { bar: "bg-violet-400", dot: "bg-violet-400" },
  "Pallet Tall":    { bar: "bg-indigo-500", dot: "bg-indigo-500" },
  "Carton":         { bar: "bg-orange-400", dot: "bg-orange-400" },
  "Shelf(Large)":   { bar: "bg-teal-500",   dot: "bg-teal-500"   },
};

const AUTO_REFRESH_SEC = 300;

/* ── Count-up hook ── */
function useCountUp(target: number, active: boolean) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!active || target === 0) { setVal(target); return; }
    const steps = 50;
    let step = 0;
    const easeOut = (t: number) => 1 - (1 - t) ** 3;
    const id = setInterval(() => {
      step++;
      if (step >= steps) { setVal(target); clearInterval(id); }
      else setVal(Math.round(target * easeOut(step / steps)));
    }, 1000 / steps);
    return () => clearInterval(id);
  }, [target, active]);
  return val;
}

/* ── KPI Card ── */
function KpiCard({
  label, value, sub, icon: Icon, iconBg, href, animated,
}: {
  label: string; value: number; sub?: string;
  icon: React.ElementType; iconBg: string; href?: string; animated: boolean;
}) {
  const router = useRouter();
  const displayed = useCountUp(value, animated);
  return (
    <div
      onClick={() => href && router.push(href)}
      className={`bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex items-start gap-4 transition-all duration-200
        ${href ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5 hover:border-blue-100 active:scale-[0.98]" : ""}`}
    >
      <div className={`p-3 rounded-xl ${iconBg} flex-shrink-0`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-slate-500 text-xs uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-slate-900 mt-0.5 leading-none tabular-nums">
          {displayed.toLocaleString()}
        </p>
        {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
      </div>
      {href && <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0 mt-1" />}
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
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // animation flags
  const [animated, setAnimated] = useState(false);
  const [barsVisible, setBarsVisible] = useState(false);

  // interactive state
  const [locTab, setLocTab] = useState<"type" | "zone">("type");
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
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
      const [r1, r2, r3, r4] = await Promise.all([
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
      ]);
      const [d1, , d3, d4] = await Promise.all([r1.json(), r2.json(), r3.json(), r4.json()]);
      setSummary((d1?.data ?? d1) as Row);
      setLocations(parseList(d3, ["data", "list"], ["data"], []));
      setReceiving(parseList(d4, ["data", "list"], ["data"], ["list"], []));
      setLastUpdated(new Date());
      setTimeout(() => { setAnimated(true); setBarsVisible(true); }, 120);
    } catch {
      setError("Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
    setCountdown(AUTO_REFRESH_SEC);
  }, [headers]); // eslint-disable-line

  useEffect(() => { load(); }, []); // eslint-disable-line

  // auto-refresh countdown
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

  // countdown ring geometry
  const circumference = 2 * Math.PI * 10;
  const dashOffset = circumference * (1 - countdown / AUTO_REFRESH_SEC);

  const totalLocations = locations.length;
  const pendingReceiving = get(summary, "pendingReceiving", "pending_receiving");
  const pendingShipments = get(summary, "pendingShipping", "pending_shipping", "pendingOrder");
  const returns = get(summary, "pendingReturn", "returnCount", "pending_return");
  const totalSKUs = get(summary, "totalSKUs", "total_skus", "skuCount", "totalSku");
  const totalInventory = get(summary, "totalInventory", "total_inventory", "totalQty", "inventoryCount");

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
    <div className="p-8">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Warehouse operations overview"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Auto-refresh countdown ring */}
          <div className="flex items-center gap-2 text-xs text-slate-400 select-none">
            <svg width="24" height="24" viewBox="0 0 24 24" className="-rotate-90">
              <circle cx="12" cy="12" r="10" fill="none" stroke="#e2e8f0" strokeWidth="2.5" />
              <circle
                cx="12" cy="12" r="10" fill="none" stroke="#3b82f6" strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                style={{ transition: "stroke-dashoffset 1s linear" }}
              />
            </svg>
            <span className="tabular-nums">
              {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}
            </span>
          </div>
          <button
            onClick={load} disabled={loading}
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-6">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
        </div>
      )}

      {/* ── KPI Row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <KpiCard label="Total Locations"   value={totalLocations}    sub="Registered slots"   icon={MapPin}       iconBg="bg-blue-100 text-blue-600"   href="/locations" animated={animated} />
        <KpiCard label="Pending Receiving" value={pendingReceiving}  sub="Scheduled inbound"  icon={PackageCheck} iconBg="bg-green-100 text-green-600"  href="/receiving" animated={animated} />
        <KpiCard label="Pending Shipments" value={pendingShipments}  sub="Awaiting dispatch"  icon={Truck}        iconBg="bg-amber-100 text-amber-600"  href="/shipping"  animated={animated} />
        <KpiCard label="Returns"           value={returns}           sub="Needs review"        icon={RotateCcw}    iconBg="bg-red-100 text-red-600"      href="/returns"   animated={animated} />
      </div>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <KpiCard label="Total SKUs"       value={totalSKUs}       sub="Registered products" icon={Boxes}      iconBg="bg-purple-100 text-purple-600" href="/products"  animated={animated} />
        <KpiCard label="Total Inventory"  value={totalInventory}  sub="Units in stock"      icon={TrendingUp} iconBg="bg-indigo-100 text-indigo-600" href="/inventory" animated={animated} />
      </div>

      {/* ── Analytics Row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">

        {/* Location breakdown with tab switcher */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <MapPin className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">Locations</h2>
            <span className="ml-auto text-xs text-slate-400">{locations.length.toLocaleString()} total</span>
          </div>

          {/* Tab switcher */}
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1 mb-4">
            {(["type", "zone"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setLocTab(tab)}
                className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-all duration-200
                  ${locTab === tab ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                {tab === "type" ? "By Type" : "By Zone"}
              </button>
            ))}
          </div>

          {locTab === "type" && (
            <>
              {/* Stacked proportion bar */}
              {locByType.length > 0 && (
                <div className="flex h-3 rounded-full overflow-hidden mb-4 gap-px">
                  {locByType.map(([type, count]) => {
                    const pct = locations.length ? (count / locations.length) * 100 : 0;
                    const c = LOC_COLORS[type] ?? { bar: "bg-slate-300" };
                    return (
                      <div
                        key={type}
                        className={`${c.bar} transition-all duration-700 hover:opacity-75 cursor-default`}
                        style={{ width: `${pct}%` }}
                        title={`${type}: ${count} (${Math.round(pct)}%)`}
                      />
                    );
                  })}
                </div>
              )}
              <div className="space-y-2.5">
                {locByType.map(([type, count], i) => {
                  const pct = locations.length ? Math.round((count / locations.length) * 100) : 0;
                  const c = LOC_COLORS[type] ?? { bar: "bg-slate-300", dot: "bg-slate-400" };
                  return (
                    <div key={type}>
                      <div className="flex items-center gap-2.5 mb-1">
                        <span className={`w-2.5 h-2.5 rounded-sm flex-shrink-0 ${c.dot}`} />
                        <span className="text-xs text-slate-600 flex-1 truncate">{type}</span>
                        <span className="text-xs font-bold text-slate-800 tabular-nums">{count.toLocaleString()}</span>
                        <span className="text-xs text-slate-400 w-8 text-right tabular-nums">{pct}%</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`${c.bar} h-1.5 rounded-full`}
                          style={{
                            width: `${barsVisible ? pct : 0}%`,
                            transition: `width 0.8s cubic-bezier(0.4,0,0.2,1) ${i * 80}ms`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
                {locByType.length === 0 && <p className="text-xs text-slate-400 text-center py-4">No data</p>}
              </div>
            </>
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
                          width: `${barsVisible ? pct : 0}%`,
                          background: "linear-gradient(90deg,#3b82f6,#6366f1)",
                          transition: `width 0.8s cubic-bezier(0.4,0,0.2,1) ${i * 60}ms`,
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

        {/* Receiving Pipeline — clickable cards filter Recent Orders */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
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
              return (
                <button
                  key={key}
                  onClick={() => setSelectedStatus(isSelected ? null : key)}
                  className={`${meta.bg} border ${meta.border} rounded-xl px-3 py-3 text-left transition-all duration-200 hover:shadow-sm active:scale-95
                    ${isSelected ? `ring-2 ring-offset-1 ${meta.border.replace("border-", "ring-")} shadow-md` : ""}`}
                >
                  <p className={`text-2xl font-black ${meta.bigColor} leading-none tabular-nums`}>{count}</p>
                  <p className="text-xs text-slate-500 mt-1 mb-2.5">{meta.label}</p>
                  <div className="w-full bg-white/60 rounded-full h-1 overflow-hidden">
                    <div
                      className={`${meta.bar} h-1 rounded-full`}
                      style={{
                        width: `${barsVisible ? pct : 0}%`,
                        transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)",
                      }}
                    />
                  </div>
                  <p className="text-xs text-slate-400 mt-1 text-right tabular-nums">{pct}%</p>
                </button>
              );
            })}
          </div>

          {selectedStatus && (
            <p className="text-xs text-center text-slate-400 mt-3">
              Showing{" "}
              <span className={`font-semibold ${STATUS_META[selectedStatus].bigColor}`}>
                {STATUS_META[selectedStatus].label}
              </span>{" "}
              orders &mdash;{" "}
              <button onClick={() => setSelectedStatus(null)} className="underline hover:text-slate-600">
                clear filter
              </button>
            </p>
          )}
          {!selectedStatus && (
            <p className="text-xs text-center text-slate-300 mt-3">Click a card to filter orders below</p>
          )}

          {receiving.length === 0 && <p className="text-xs text-slate-400 text-center py-4">No data</p>}
        </div>

        {/* Quick Access */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <LayoutGrid className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">Quick Access</h2>
          </div>
          <div className="space-y-1.5">
            {[
              {
                label: "Receiving Orders",
                sub: `${(rcvByStatus.AA ?? 0) + (rcvByStatus.CA ?? 0)} active`,
                href: "/receiving",
                icon: PackageCheck,
                iconColor: "text-green-600 bg-green-100",
              },
              {
                label: "Outbound Orders",
                sub: `${pendingShipments} pending`,
                href: "/shipping",
                icon: Truck,
                iconColor: "text-amber-600 bg-amber-100",
              },
              {
                label: "Inventory Inquiry",
                sub: `${totalInventory.toLocaleString()} units`,
                href: "/inventory",
                icon: Boxes,
                iconColor: "text-indigo-600 bg-indigo-100",
              },
              {
                label: "Location Master",
                sub: `${locations.length.toLocaleString()} slots`,
                href: "/locations",
                icon: MapPin,
                iconColor: "text-blue-600 bg-blue-100",
              },
              {
                label: "Available Locations",
                sub: "Check open slots",
                href: "/locations/available",
                icon: TrendingUp,
                iconColor: "text-teal-600 bg-teal-100",
              },
              {
                label: "Returns",
                sub: `${returns} pending`,
                href: "/returns",
                icon: RotateCcw,
                iconColor: "text-red-600 bg-red-100",
              },
            ].map(({ label, sub, href, icon: Icon, iconColor }) => (
              <button
                key={href}
                onClick={() => router.push(href)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-transparent hover:border-slate-200 hover:bg-slate-50 transition-all duration-150 text-left group active:scale-[0.98]"
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${iconColor}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-700">{label}</p>
                  <p className="text-xs text-slate-400">{sub}</p>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Recent Receiving Orders (filtered by selected status) ── */}
      {receiving.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <PackageCheck className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">
              {selectedStatus
                ? `${STATUS_META[selectedStatus].label} Orders`
                : "Recent Receiving Orders"}
            </h2>
            {selectedStatus && (
              <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_META[selectedStatus].bg} ${STATUS_META[selectedStatus].color} ${STATUS_META[selectedStatus].border}`}>
                {rcvByStatus[selectedStatus]} orders
              </span>
            )}
            <button
              onClick={() => router.push("/receiving")}
              className="ml-auto text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 transition-colors"
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
              <tbody>
                {recentOrders.map((row, i) => {
                  const status = String(row.status ?? "");
                  const meta = STATUS_META[status] ?? { label: status, color: "text-slate-600", bg: "bg-slate-100", border: "border-slate-200" };
                  return (
                    <tr
                      key={i}
                      onClick={() => router.push("/receiving")}
                      className="border-b border-slate-50 last:border-0 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="px-3 py-2.5 font-mono text-blue-600 font-medium">
                        {String(row.receiveOrderCode ?? row.orderCode ?? "-")}
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">
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
  );
}
