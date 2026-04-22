"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { RefreshCw, MapPin, PackageCheck, Truck, RotateCcw, Boxes, TrendingUp, AlertCircle } from "lucide-react";

type Row = Record<string, unknown>;

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  AA: { label: "Pre-Alert",  color: "text-yellow-700", bg: "bg-yellow-100" },
  CA: { label: "Processing", color: "text-blue-700",   bg: "bg-blue-100"   },
  DA: { label: "Complete",   color: "text-green-700",  bg: "bg-green-100"  },
  EA: { label: "Hold",       color: "text-red-700",    bg: "bg-red-100"    },
};

const LOC_COLORS: Record<string, { bar: string; dot: string }> = {
  "Bin":            { bar: "bg-blue-500",   dot: "bg-blue-500"   },
  "Pallet Regular": { bar: "bg-purple-500", dot: "bg-purple-500" },
  "Pallet Short":   { bar: "bg-violet-400", dot: "bg-violet-400" },
  "Pallet Tall":    { bar: "bg-indigo-500", dot: "bg-indigo-500" },
  "Carton":         { bar: "bg-orange-400", dot: "bg-orange-400" },
  "Shelf(Large)":   { bar: "bg-teal-500",   dot: "bg-teal-500"   },
};

function KpiCard({ label, value, sub, icon: Icon, iconBg }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; iconBg: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex items-start gap-4">
      <div className={`p-3 rounded-xl ${iconBg} flex-shrink-0`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-slate-500 text-xs uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-slate-900 mt-0.5 leading-none">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Row | null>(null);
  const [sidebarSummary, setSidebarSummary] = useState<Row | null>(null);
  const [locations, setLocations] = useState<Row[]>([]);
  const [receiving, setReceiving] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

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

  async function load() {
    setLoading(true);
    setError("");
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

      const [d1, d2, d3, d4] = await Promise.all([r1.json(), r2.json(), r3.json(), r4.json()]);
      setSummary((d1?.data ?? d1) as Row);
      setSidebarSummary((d2?.data ?? d2) as Row);

      const locs = parseList(d3, ["data", "list"], ["data"], []);
      setLocations(locs);

      const rcv = parseList(d4, ["data", "list"], ["data"], ["list"], []);
      setReceiving(rcv);

      setLastUpdated(new Date());
    } catch {
      setError("Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line

  const get = (obj: Row | null, ...keys: string[]): number => {
    if (!obj) return 0;
    for (const k of keys) {
      const v = obj[k];
      if (v !== undefined && v !== null) return Number(v) || 0;
    }
    return 0;
  };

  // Location analytics
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

  // Receiving analytics
  const rcvByStatus = useMemo(() => {
    const map: Record<string, number> = { AA: 0, CA: 0, DA: 0, EA: 0 };
    for (const r of receiving) {
      const s = String(r.status ?? "");
      if (s in map) map[s]++;
    }
    return map;
  }, [receiving]);

  const maxZoneCount = Math.max(...locByZone.map(([, c]) => c), 1);

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="h-6 w-32 bg-slate-200 rounded animate-pulse mb-2" />
            <div className="h-4 w-48 bg-slate-100 rounded animate-pulse" />
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => <div key={i} className="bg-white rounded-2xl border border-slate-100 h-28 animate-pulse" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="bg-white rounded-2xl border border-slate-100 h-64 animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Warehouse operations overview"}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-6">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
        </div>
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Locations" value={locations.length.toLocaleString()}
          sub="Registered slots" icon={MapPin} iconBg="bg-blue-100 text-blue-600" />
        <KpiCard label="Pending Receiving" value={get(summary, "pendingReceiving", "pending_receiving")}
          sub="Scheduled inbound" icon={PackageCheck} iconBg="bg-green-100 text-green-600" />
        <KpiCard label="Pending Shipments" value={get(summary, "pendingShipping", "pending_shipping", "pendingOrder")}
          sub="Awaiting dispatch" icon={Truck} iconBg="bg-amber-100 text-amber-600" />
        <KpiCard label="Returns" value={get(summary, "pendingReturn", "returnCount", "pending_return")}
          sub="Needs review" icon={RotateCcw} iconBg="bg-red-100 text-red-600" />
      </div>

      {/* Second KPI Row */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <KpiCard label="Total SKUs" value={get(summary, "totalSKUs", "total_skus", "skuCount", "totalSku").toLocaleString()}
          sub="Registered products" icon={Boxes} iconBg="bg-purple-100 text-purple-600" />
        <KpiCard label="Total Inventory" value={get(summary, "totalInventory", "total_inventory", "totalQty", "inventoryCount").toLocaleString()}
          sub="Units in stock" icon={TrendingUp} iconBg="bg-indigo-100 text-indigo-600" />
      </div>

      {/* Analytics Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">

        {/* Location by Type */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <MapPin className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">Location by Type</h2>
            <span className="ml-auto text-xs text-slate-400">{locations.length.toLocaleString()} slots</span>
          </div>

          {/* Stacked proportion bar */}
          {locByType.length > 0 && (
            <div className="flex h-3 rounded-full overflow-hidden mb-5 gap-px">
              {locByType.map(([type, count]) => {
                const pct = locations.length ? (count / locations.length) * 100 : 0;
                const colors = LOC_COLORS[type] ?? { bar: "bg-slate-300", dot: "bg-slate-300" };
                return <div key={type} className={`${colors.bar} transition-all duration-500`} style={{ width: `${pct}%` }} title={`${type}: ${count}`} />;
              })}
            </div>
          )}

          {/* Type list */}
          <div className="space-y-2.5">
            {locByType.map(([type, count]) => {
              const pct = locations.length ? Math.round((count / locations.length) * 100) : 0;
              const colors = LOC_COLORS[type] ?? { bar: "bg-slate-300", dot: "bg-slate-400" };
              return (
                <div key={type} className="flex items-center gap-3">
                  <span className={`w-2.5 h-2.5 rounded-sm flex-shrink-0 ${colors.dot}`} />
                  <span className="text-xs text-slate-600 flex-1 truncate">{type}</span>
                  <span className="text-xs font-bold text-slate-800 tabular-nums">{count.toLocaleString()}</span>
                  <span className="text-xs text-slate-400 w-9 text-right tabular-nums">{pct}%</span>
                </div>
              );
            })}
            {locByType.length === 0 && <p className="text-xs text-slate-400 text-center py-4">No data</p>}
          </div>
        </div>

        {/* Receiving Pipeline */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <PackageCheck className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">Receiving Pipeline</h2>
            <span className="ml-auto text-xs text-slate-400">{receiving.length} orders</span>
          </div>

          {/* Big stat cards 2×2 */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            {[
              { key: "AA", label: "Pre-Alert",  big: "text-yellow-600", bg: "bg-yellow-50",  border: "border-yellow-200", bar: "bg-yellow-400" },
              { key: "CA", label: "Processing", big: "text-blue-600",   bg: "bg-blue-50",    border: "border-blue-200",   bar: "bg-blue-500"   },
              { key: "DA", label: "Complete",   big: "text-green-600",  bg: "bg-green-50",   border: "border-green-200",  bar: "bg-green-500"  },
              { key: "EA", label: "Hold",       big: "text-red-600",    bg: "bg-red-50",     border: "border-red-200",    bar: "bg-red-400"    },
            ].map(({ key, label, big, bg, border, bar }) => {
              const count = rcvByStatus[key] ?? 0;
              const pct = receiving.length ? Math.round((count / receiving.length) * 100) : 0;
              return (
                <div key={key} className={`${bg} border ${border} rounded-xl px-3 py-3`}>
                  <p className={`text-2xl font-black ${big} leading-none`}>{count}</p>
                  <p className="text-xs text-slate-500 mt-1 mb-2">{label}</p>
                  <div className="w-full bg-white/70 rounded-full h-1">
                    <div className={`${bar} h-1 rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-slate-400 mt-1 text-right">{pct}%</p>
                </div>
              );
            })}
          </div>

          {receiving.length === 0 && <p className="text-xs text-slate-400 text-center py-4">No data</p>}
        </div>

        {/* Location by Zone */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <MapPin className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">Locations by Zone</h2>
            <span className="ml-auto text-xs text-slate-400">{locByZone.length} zones</span>
          </div>
          <div className="space-y-2">
            {locByZone.slice(0, 10).map(([zone, count]) => {
              const pct = Math.round((count / maxZoneCount) * 100);
              return (
                <div key={zone} className="group">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-slate-600">Zone {zone}</span>
                    <span className="text-xs font-bold text-slate-700 tabular-nums">{count.toLocaleString()}</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                    <div
                      className="h-3 rounded-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        background: `linear-gradient(90deg, #3b82f6, #6366f1)`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
            {locByZone.length === 0 && <p className="text-xs text-slate-400 text-center py-4">No data</p>}
          </div>
        </div>
      </div>

      {/* Recent Receiving */}
      {receiving.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <PackageCheck className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">Recent Receiving Orders</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100">
                  {["Order Code", "Customer", "Order Date", "Status"].map(c => (
                    <th key={c} className="px-3 py-2 text-left text-slate-400 font-medium uppercase tracking-wide">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {receiving.slice(0, 8).map((row, i) => {
                  const status = String(row.status ?? "");
                  const meta = STATUS_META[status] ?? { label: status, color: "text-slate-600", bg: "bg-slate-100" };
                  return (
                    <tr key={i} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-mono text-blue-600 font-medium">{String(row.receiveOrderCode ?? row.orderCode ?? "-")}</td>
                      <td className="px-3 py-2.5 text-slate-700">{String(row.customerName ?? row.customerCode ?? "-")}</td>
                      <td className="px-3 py-2.5 text-slate-500">{String(row.orderDate ?? "-")}</td>
                      <td className="px-3 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${meta.bg} ${meta.color}`}>{meta.label}</span>
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
