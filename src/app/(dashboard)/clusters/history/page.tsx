"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import {
  CheckCircle2, ChevronDown, ChevronUp, Layers, RefreshCw, Trash2, Loader2, Printer, Download,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { B2CCluster } from "@/lib/b2c-cluster";

export default function ClusterHistoryPage() {
  const { user } = useAuth();
  const router = useRouter();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  const [clusters, setClusters] = useState<B2CCluster[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);

  async function exportCluster(cluster: B2CCluster) {
    setExportingId(cluster.id);
    try {
      const res = await fetch("/api/cluster/export", {
        method: "POST",
        headers,
        body: JSON.stringify({ clusterIds: [cluster.id] }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const label = cluster.clusterNo != null ? `cluster-${String(cluster.clusterNo).padStart(4, "0")}` : cluster.id;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${label}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* silent */ } finally {
      setExportingId(null);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/cluster");
      const data = await res.json();
      if (Array.isArray(data)) {
        setClusters(
          (data as B2CCluster[])
            .filter((c) => c.status === "completed")
            .sort((a, b) => new Date(b.completedAt ?? b.createdAt).getTime() - new Date(a.completedAt ?? a.createdAt).getTime())
        );
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line

  async function deleteCluster(id: string) {
    setDeletingId(id);
    await fetch(`/api/cluster?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setClusters((p) => p.filter((c) => c.id !== id));
    setDeletingId(null);
  }

  return (
    <div className="p-6 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Cluster History</h1>
            <p className="text-sm text-slate-500">Completed cluster pick records</p>
          </div>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Cluster list */}
      {loading && (
        <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      )}
      {!loading && clusters.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-slate-400">
          <Layers className="w-8 h-8" />
          <p className="text-sm">No completed clusters yet</p>
          <p className="text-xs">Mark clusters as complete from the Cluster Pick page</p>
        </div>
      )}
      {!loading && clusters.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide">{clusters.length} completed cluster{clusters.length !== 1 ? "s" : ""}</p>
          {clusters.map((cluster) => {
            const isExpanded = expandedId === cluster.id;
            const isDeleting = deletingId === cluster.id;
            return (
              <div key={cluster.id} className="bg-white border border-emerald-200 rounded-2xl shadow-sm overflow-hidden">
                {/* Card header */}
                <div className="px-5 py-4 bg-emerald-50/40 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {cluster.clusterNo != null && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-black bg-indigo-600 text-white tracking-wide">
                          #{String(cluster.clusterNo).padStart(4, "0")}
                        </span>
                      )}
                      <span className="text-base font-extrabold text-slate-900">{cluster.bins.length} bins</span>
                      <span className="text-sm text-slate-400">· {cluster.locationGroups.length} locations</span>
                      <span className="text-sm text-slate-400">· {cluster.warehouseCode}</span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
                        <CheckCircle2 className="w-3 h-3" /> Completed
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">Created: {new Date(cluster.createdAt).toLocaleString()}</p>
                    {cluster.completedAt && (
                      <p className="text-xs text-emerald-600 font-medium">Completed: {new Date(cluster.completedAt).toLocaleString()}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => router.push(`/clusters-print?id=${encodeURIComponent(cluster.id)}`)}
                      className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                      title="Print Pick Tickets"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => exportCluster(cluster)}
                      disabled={exportingId === cluster.id}
                      className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-50"
                      title="Export to Excel"
                    >
                      {exportingId === cluster.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => { isDeleting ? null : deleteCluster(cluster.id); }}
                      disabled={isDeleting}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : cluster.id)}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                    >
                      {isExpanded
                        ? <><ChevronUp className="w-3.5 h-3.5" /> Collapse</>
                        : <><ChevronDown className="w-3.5 h-3.5" /> Detail</>}
                    </button>
                  </div>
                </div>

                {/* Expanded: bins + location groups */}
                {isExpanded && (
                  <div className="border-t border-slate-100">
                    {/* Bin list */}
                    <div className="px-5 py-3 border-b border-slate-100">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Bins ({cluster.bins.length})</p>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-slate-400 border-b border-slate-100">
                            <th className="py-1.5 pr-3 font-semibold">Bin</th>
                            <th className="py-1.5 pr-3 font-semibold">Order</th>
                            <th className="py-1.5 pr-3 font-semibold">Consignee</th>
                            <th className="py-1.5 font-semibold">Items</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cluster.bins.map((bin) => (
                            <tr key={bin.binNo} className="border-b border-slate-50">
                              <td className="py-1.5 pr-3 font-bold text-slate-500">{bin.binNo}</td>
                              <td className="py-1.5 pr-3 font-mono font-semibold text-slate-700">{bin.orderNo || bin.orderCode}</td>
                              <td className="py-1.5 pr-3 text-slate-500">{bin.consigneeName || "—"}</td>
                              <td className="py-1.5 text-slate-400">{bin.items.length} item{bin.items.length !== 1 ? "s" : ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Location group list */}
                    <div className="px-5 py-3">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Pick Route ({cluster.locationGroups.length} locations)</p>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-slate-400 border-b border-slate-100">
                            <th className="py-1.5 pr-3 font-semibold w-6">#</th>
                            <th className="py-1.5 pr-3 font-semibold">Location</th>
                            <th className="py-1.5 font-semibold">Picks</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cluster.locationGroups.map((grp, idx) => (
                            <tr key={grp.locationCode} className="border-b border-slate-50">
                              <td className="py-1.5 pr-3 text-slate-400">{idx + 1}</td>
                              <td className="py-1.5 pr-3 font-mono font-bold text-slate-800">{grp.locationCode}</td>
                              <td className="py-1.5 text-slate-500">
                                {grp.tasks.map((t) => `Bin ${t.binNo} · ${t.sku} ×${t.qty}`).join(",  ")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
