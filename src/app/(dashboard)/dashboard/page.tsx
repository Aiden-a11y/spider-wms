"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Truck, PackageCheck, Boxes, RotateCcw, RefreshCw, AlertCircle } from "lucide-react";

interface Summary {
  [key: string]: unknown;
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 flex items-start gap-4">
      <div className={`p-3 rounded-xl ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-slate-500 text-sm">{label}</p>
        <p className="text-2xl font-bold text-slate-900 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sidebarSummary, setSidebarSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const headers = { Authorization: `Bearer ${user!.token}` };
      const [r1, r2] = await Promise.all([
        fetch("/api/wms/dashboard", { headers }),
        fetch("/api/wms/dashboard/sidebar-summary", { headers }),
      ]);
      const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
      setSummary(d1?.data ?? d1);
      setSidebarSummary(d2?.data ?? d2);
    } catch {
      setError("Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line

  const get = (obj: Summary | null, ...keys: string[]): string | number => {
    if (!obj) return "-";
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== null) return obj[k] as string | number;
    }
    return "-";
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-0.5">Warehouse operations summary</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-6">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-100 h-28 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard
              label="Today's Orders"
              value={get(summary, "todayOrders", "today_orders", "todayOrder")}
              sub="New receipts"
              icon={Truck}
              color="bg-blue-100 text-blue-600"
            />
            <StatCard
              label="Pending Shipments"
              value={get(summary, "pendingShipping", "pending_shipping", "pendingOrder")}
              sub="Needs processing"
              icon={Truck}
              color="bg-amber-100 text-amber-600"
            />
            <StatCard
              label="Pending Receiving"
              value={get(summary, "pendingReceiving", "pending_receiving", "pendingReceiving")}
              sub="Scheduled inbound"
              icon={PackageCheck}
              color="bg-green-100 text-green-600"
            />
            <StatCard
              label="Returns"
              value={get(summary, "pendingReturn", "pending_return", "returnCount")}
              sub="Needs review"
              icon={RotateCcw}
              color="bg-red-100 text-red-600"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
            <StatCard
              label="Total SKUs"
              value={get(summary, "totalSKUs", "total_skus", "skuCount", "totalSku")}
              sub="Registered products"
              icon={Boxes}
              color="bg-purple-100 text-purple-600"
            />
            <StatCard
              label="Total Inventory"
              value={get(summary, "totalInventory", "total_inventory", "totalQty", "inventoryCount")}
              sub="Total units stored"
              icon={Boxes}
              color="bg-indigo-100 text-indigo-600"
            />
          </div>

          {/* Raw data for debugging / mapping */}
          {(summary || sidebarSummary) && (
            <details className="bg-slate-800 rounded-xl p-4 text-xs">
              <summary className="text-slate-400 cursor-pointer select-none">
                Raw API response (dev)
              </summary>
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-slate-500 mb-1">/dashboard</p>
                  <pre className="text-green-400 overflow-auto max-h-48">
                    {JSON.stringify(summary, null, 2)}
                  </pre>
                </div>
                <div>
                  <p className="text-slate-500 mb-1">/dashboard/sidebar-summary</p>
                  <pre className="text-green-400 overflow-auto max-h-48">
                    {JSON.stringify(sidebarSummary, null, 2)}
                  </pre>
                </div>
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
