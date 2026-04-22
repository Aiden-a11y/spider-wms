"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Search, RefreshCw, CheckSquare, Download, MapPin } from "lucide-react";

interface Warehouse { id: string; name: string; }
type Row = Record<string, unknown>;

export default function AvailableLocationsPage() {
  const { user } = useAuth();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseCode, setWarehouseCode] = useState("");
  const [locations, setLocations] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  function parseList(json: unknown): Row[] {
    const j = json as Record<string, unknown>;
    const d = j?.data as Record<string, unknown> | undefined;
    if (Array.isArray(d?.list)) return d!.list as Row[];
    if (Array.isArray(d)) return d as unknown as Row[];
    if (Array.isArray(json)) return json as Row[];
    return [];
  }

  const fetchData = useCallback(async (whCode: string) => {
    if (!whCode) return;
    setLoading(true);
    setError("");
    setLocations([]);

    try {
      // Step 1: all locations
      setLoadingMsg("Fetching locations...");
      const locRes = await fetch("/api/wms/warehouse/location/list", {
        method: "POST",
        headers,
        body: JSON.stringify({ page: 1, pageSize: 9999, warehouseCode: "", search: "", sortField: "WarehouseCode", sortDir: "asc" }),
      });
      const locText = await locRes.text();
      const locJson = locText.trim() ? JSON.parse(locText) : {};
      const allLocations: Row[] = parseList(locJson);

      // Step 2: build occupied barcode set from inventory
      // Try to fetch customers first, then inventory per customer
      setLoadingMsg("Fetching inventory data...");
      const occupiedBarcodes = new Set<string>();

      try {
        const custRes = await fetch(`/api/wms/combo/customer-by-warehouse/${whCode}`, { headers });
        const custJson = await custRes.json();
        const custArr = Array.isArray(custJson?.data) ? custJson.data : Array.isArray(custJson) ? custJson : [];
        const customers: { code: string }[] = custArr.map((c: Record<string, unknown>) => ({ code: String(c.code ?? c.customerCode ?? "") })).filter((c: { code: string }) => c.code);

        // Fetch SKUs per customer and inventory per SKU
        for (const cust of customers.slice(0, 20)) { // limit to avoid timeout
          try {
            const skuRes = await fetch("/api/wms/product/list", {
              method: "POST",
              headers,
              body: JSON.stringify({ warehouseCode: whCode, customerCode: cust.code, page: 1, size: 9999 }),
            });
            const skuJson = await skuRes.json();
            const skus: string[] = ((skuJson.data?.list ?? []) as Record<string, unknown>[])
              .map((p) => String(p.productSku ?? "")).filter(Boolean);

            await Promise.all(skus.slice(0, 50).map(async (sku) => {
              try {
                const invRes = await fetch("/api/wms/inventory/detail", {
                  method: "POST",
                  headers,
                  body: JSON.stringify({ warehouseCode: whCode, customerCode: cust.code, productSku: sku }),
                });
                const invJson = await invRes.json();
                const items = Array.isArray(invJson?.data) ? invJson.data
                  : Array.isArray(invJson?.data?.list) ? invJson.data.list
                  : Array.isArray(invJson) ? invJson : [];
                for (const item of items as Row[]) {
                  const z = String(item.zoneCode ?? item.zone ?? item.zoneNm ?? "").padStart(2, "0");
                  const a = String(item.aisleCode ?? item.aisle ?? item.aisleNm ?? "").padStart(2, "0");
                  const b = String(item.bayCode ?? item.bay ?? item.bayNm ?? "").padStart(2, "0");
                  const l = String(item.levelCode ?? item.level ?? item.levelNm ?? "").padStart(2, "0");
                  const p = String(item.position ?? item.positionNm ?? item.slotCode ?? "").padStart(2, "0");
                  const barcode = z + a + b + l + p;
                  if (barcode.replace(/0/g, "")) occupiedBarcodes.add(barcode);
                  // Also try remark field
                  if (item.remark) occupiedBarcodes.add(String(item.remark));
                  if (item.locationCode) occupiedBarcodes.add(String(item.locationCode));
                }
              } catch { /* skip */ }
            }));
          } catch { /* skip */ }
        }
      } catch { /* skip inventory check */ }

      // Step 3: filter available locations
      setLoadingMsg("Filtering available locations...");
      const available = allLocations.filter((loc) => {
        // Check qty fields first
        const qty = loc.currentQty ?? loc.locQty ?? loc.qty ?? loc.inventoryQty ?? loc.storedQty;
        if (qty !== undefined && qty !== null) return Number(qty) === 0;

        // Cross-reference with occupied barcodes
        const remark = String(loc.remark ?? "");
        const z = String(loc.zoneNm ?? "").padStart(2, "0");
        const a = String(loc.aisleNm ?? "").padStart(2, "0");
        const b = String(loc.bayNm ?? "").padStart(2, "0");
        const l = String(loc.levelNm ?? "").padStart(2, "0");
        const pos = String(loc.positionNm ?? "").padStart(2, "0");
        const constructed = z + a + b + l + pos;

        if (occupiedBarcodes.size > 0) {
          return !occupiedBarcodes.has(remark) && !occupiedBarcodes.has(constructed);
        }
        return true; // fallback: show all if no inventory data
      });

      setLocations(available);
    } catch (e) {
      setError(`Failed: ${String(e)}`);
    }
    setLoadingMsg("");
    setLoading(false);
  }, [headers]); // eslint-disable-line

  useEffect(() => {
    fetch("/api/wms/combo/warehouse", { headers })
      .then((r) => r.json())
      .then((json) => {
        const arr = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
        const list: Warehouse[] = (arr as Row[])
          .map((w) => ({ id: String(w.code ?? w.id ?? ""), name: String(w.name ?? w.code ?? "") }))
          .filter((w) => w.id);
        setWarehouses(list);
        if (list.length > 0) {
          const preferred = list.find((w) => w.id === "STOO1") ?? list[0];
          setWarehouseCode(preferred.id);
          fetchData(preferred.id);
        }
      }).catch(() => {});
  }, []); // eslint-disable-line

  // Group by occupancyInfo type
  const byType = useMemo(() => {
    const map: Record<string, number> = {};
    for (const loc of locations) {
      const t = String(loc.occupancyInfo ?? "Unknown");
      map[t] = (map[t] ?? 0) + 1;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [locations]);

  const cols = useMemo(() => {
    if (locations.length === 0) return [];
    const preferred = ["warehouseCd", "warehouseCode", "zoneNm", "aisleNm", "bayNm", "levelNm", "positionNm", "occupancyInfo", "remark"];
    const keys = Object.keys(locations[0]);
    return [...preferred.filter(k => keys.includes(k)), ...keys.filter(k => !preferred.includes(k))].slice(0, 10);
  }, [locations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return locations;
    return locations.filter((r) => Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q)));
  }, [locations, search]);

  async function downloadExcel() {
    const { utils, writeFile } = await import("xlsx");
    const ws = utils.json_to_sheet(filtered);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Available Locations");
    writeFile(wb, `locations_available_${warehouseCode}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const TYPE_COLORS: Record<string, string> = {
    "Bin": "bg-blue-500",
    "Pallet Regular": "bg-purple-500",
    "Pallet Short": "bg-violet-400",
    "Pallet Tall": "bg-indigo-500",
    "Carton": "bg-orange-400",
    "Shelf(Large)": "bg-teal-500",
    "Unknown": "bg-slate-400",
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Available Locations</h1>
          <p className="text-slate-500 text-sm mt-0.5">Empty locations with no current inventory</p>
        </div>
        <button onClick={downloadExcel} disabled={filtered.length === 0}
          className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors disabled:opacity-40">
          <Download className="w-4 h-4" /> Export
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select value={warehouseCode}
          onChange={(e) => { setWarehouseCode(e.target.value); fetchData(e.target.value); }}
          disabled={warehouses.length === 0}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          {warehouses.length === 0 && <option value="">Loading...</option>}
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name || w.id}</option>)}
        </select>
        <button onClick={() => fetchData(warehouseCode)} disabled={loading}
          className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search location, zone..."
            className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-5">{error}</div>}

      {loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="relative w-14 h-14">
            <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56" fill="none">
              <circle cx="28" cy="28" r="24" stroke="#e2e8f0" strokeWidth="4" />
              <circle cx="28" cy="28" r="24" stroke="#3b82f6" strokeWidth="4"
                strokeLinecap="round" strokeDasharray="40 150.8"
                className="animate-spin origin-center" style={{ animationDuration: "1s" }} />
            </svg>
          </div>
          <p className="text-sm text-slate-500">{loadingMsg || "Loading..."}</p>
        </div>
      )}

      {!loading && locations.length > 0 && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <div className="bg-white border border-slate-100 rounded-xl px-4 py-3 shadow-sm">
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Available</p>
              <p className="text-2xl font-bold text-green-600">{locations.length.toLocaleString()}</p>
            </div>
            {byType.slice(0, 3).map(([type, count]) => (
              <div key={type} className="bg-white border border-slate-100 rounded-xl px-4 py-3 shadow-sm">
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-1 truncate">{type}</p>
                <p className="text-2xl font-bold text-slate-800">{count.toLocaleString()}</p>
              </div>
            ))}
          </div>

          {/* Type breakdown */}
          <div className="bg-white border border-slate-100 rounded-xl p-5 mb-6 shadow-sm">
            <p className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-green-500" /> By Location Type
            </p>
            <div className="space-y-2.5">
              {byType.map(([type, count]) => {
                const pct = Math.round((count / locations.length) * 100);
                const color = TYPE_COLORS[type] ?? "bg-slate-400";
                return (
                  <div key={type}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-600 font-medium">{type}</span>
                      <span className="text-slate-400">{count.toLocaleString()} ({pct}%)</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Summary bar */}
          <div className="flex items-center gap-4 mb-5 bg-white border border-slate-100 rounded-xl px-5 py-3 text-sm shadow-sm">
            <MapPin className="w-4 h-4 text-green-500" />
            <span className="text-slate-600">
              <b className="text-slate-900">{filtered.length.toLocaleString()}</b> available locations
            </span>
          </div>

          {/* Table */}
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
                          {c.toLowerCase().includes("code") || c === "remark" ? (
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
        </>
      )}

      {!loading && !error && locations.length === 0 && (
        <div className="text-center py-20 text-slate-400">
          <CheckSquare className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No available locations found</p>
        </div>
      )}
    </div>
  );
}
