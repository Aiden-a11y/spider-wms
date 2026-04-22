"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Search, RefreshCw, CheckSquare, Download } from "lucide-react";

interface Warehouse { id: string; name: string; }
type Row = Record<string, unknown>;

export default function AvailableLocationsPage() {
  const { user } = useAuth();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseCode, setWarehouseCode] = useState("");
  const [locations, setLocations] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  function parseArr(json: unknown): Row[] {
    const j = json as Record<string, unknown>;
    const d = j?.data as Record<string, unknown> | undefined;
    if (Array.isArray(d?.list)) return d!.list as Row[];
    if (Array.isArray(d)) return d as unknown as Row[];
    if (Array.isArray(json)) return json as Row[];
    return [];
  }

  const fetchLocations = useCallback(async (whCode: string) => {
    if (!whCode) return;
    setLoading(true);
    setError("");
    setLocations([]);
    try {
      const res = await fetch("/api/wms/warehouse/location/list", {
        method: "POST",
        headers,
        body: JSON.stringify({ warehouseCode: whCode, status: "EMPTY", page: 1, size: 9999 }),
      });
      const text = await res.text();
      if (!text.trim()) throw new Error(`Empty response (status ${res.status}) — check the API endpoint`);
      const json = JSON.parse(text);
      let list = parseArr(json);
      // client-side filter as fallback if API doesn't filter by status
      list = list.filter((r) => {
        const s = String(r.status ?? r.locationStatus ?? r.useYn ?? "").toUpperCase();
        return s === "" || s === "EMPTY" || s === "AVAILABLE" || s === "Y" || s === "0";
      });
      setLocations(list);
    } catch (e) {
      setError(`Request failed: ${String(e)}`);
    }
    setLoading(false);
  }, [headers]); // eslint-disable-line

  useEffect(() => {
    fetch("/api/wms/combo/warehouse", { headers })
      .then((r) => r.json())
      .then((json) => {
        const list: Warehouse[] = parseArr(json)
          .map((w) => ({ id: String(w.code ?? w.id ?? ""), name: String(w.name ?? w.code ?? "") }))
          .filter((w) => w.id);
        setWarehouses(list);
        if (list.length > 0) {
          const preferred = list.find((w) => w.id === "STOO1") ?? list[0];
          setWarehouseCode(preferred.id);
          fetchLocations(preferred.id);
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line

  const cols = useMemo(() => {
    if (locations.length === 0) return [];
    return Object.keys(locations[0]).slice(0, 12);
  }, [locations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return locations;
    return locations.filter((r) =>
      Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q))
    );
  }, [locations, search]);

  async function downloadExcel() {
    const { utils, writeFile } = await import("xlsx");
    const ws = utils.json_to_sheet(filtered);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Available Locations");
    writeFile(wb, `locations_available_${warehouseCode}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Available Locations</h1>
          <p className="text-slate-500 text-sm mt-0.5">Empty / available warehouse locations</p>
        </div>
        <button
          onClick={downloadExcel}
          disabled={filtered.length === 0}
          className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" />
          Export
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={warehouseCode}
          onChange={(e) => { setWarehouseCode(e.target.value); fetchLocations(e.target.value); }}
          disabled={warehouses.length === 0}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
        >
          {warehouses.length === 0 && <option value="">Loading...</option>}
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.name || w.id}</option>
          ))}
        </select>

        <button
          onClick={() => fetchLocations(warehouseCode)}
          disabled={loading}
          className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>

        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search location code, zone..."
            className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-5">{error}</div>
      )}

      {!loading && locations.length > 0 && (
        <div className="flex items-center gap-4 mb-5 bg-white border border-slate-100 rounded-xl px-5 py-3 text-sm shadow-sm">
          <CheckSquare className="w-4 h-4 text-green-500" />
          <span className="text-slate-600">
            <b className="text-slate-900">{filtered.length.toLocaleString()}</b> available locations
          </span>
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="relative w-14 h-14">
            <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56" fill="none">
              <circle cx="28" cy="28" r="24" stroke="#e2e8f0" strokeWidth="4" />
              <circle cx="28" cy="28" r="24" stroke="#3b82f6" strokeWidth="4"
                strokeLinecap="round" strokeDasharray="40 150.8" strokeDashoffset="0"
                className="animate-spin origin-center" style={{ animationDuration: "1s" }}
              />
            </svg>
          </div>
          <p className="text-sm text-slate-500">Loading available locations...</p>
        </div>
      )}

      {!loading && !error && locations.length === 0 && (
        <div className="text-center py-20 text-slate-400">
          <CheckSquare className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No available locations found</p>
        </div>
      )}

      {!loading && filtered.length > 0 && cols.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-green-50 border-b border-slate-200">
                  {cols.map((c) => (
                    <th key={c} className="px-4 py-2.5 text-left text-slate-500 font-medium whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, idx) => (
                  <tr key={idx} className="hover:bg-green-50 border-b border-slate-100 last:border-0">
                    {cols.map((c) => (
                      <td key={c} className="px-4 py-2.5 text-slate-700 whitespace-nowrap max-w-xs truncate">
                        {c.toLowerCase().includes("code") ? (
                          <span className="font-mono font-medium text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                            {String(row[c] ?? "-")}
                          </span>
                        ) : String(row[c] ?? "-")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
