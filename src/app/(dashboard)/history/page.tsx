"use client";

import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/auth-context";
import {
  buildLocationOccupancyLookup,
  getLocationOccupancyInfo,
} from "@/lib/wms";
import { Download, Search, Calendar, Save } from "lucide-react";

interface SnapshotRow {
  id: number;
  captured_date: string;
  captured_at?: string | null;
  warehouse_code: string;
  customer_code: string | null;
  location: string;
  sku: string;
  product_name: string | null;
  qty: number;
  available_qty: number | null;
  lot: string | null;
  expire_date: string | null;
}

interface Warehouse {
  id: string;
  name: string;
}

function formatExpire(d: string | null) {
  if (!d || d.length !== 8) return d ?? "-";
  return `${d.slice(4,6)}-${d.slice(6,8)}-${d.slice(0,4)}`;
}

/** Format a UTC ISO timestamp as LA local time */
function formatCapturedAt(iso: string | null | undefined): string {
  if (!iso) return "–";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

export default function HistoryPage() {
  const { user } = useAuth();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseCode, setWarehouseCode] = useState("STOO1");
  const [rows, setRows] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [savePct, setSavePct] = useState(0);
  const [saveStatus, setSaveStatus] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [occupancyLookup, setOccupancyLookup] = useState<Map<string, string>>(() => new Map());
  const [customerMap, setCustomerMap] = useState<Record<string, string>>({}); // code → name

  function parseLocationArr(json: unknown): Record<string, unknown>[] {
    const j = json as Record<string, unknown>;
    const d = j?.data as Record<string, unknown> | undefined;
    if (Array.isArray(d?.list)) return d!.list as Record<string, unknown>[];
    if (Array.isArray(d)) return d as unknown as Record<string, unknown>[];
    if (Array.isArray(json)) return json as Record<string, unknown>[];
    return [];
  }

  async function loadOccupancyLookup(whCode: string) {
    try {
      const res = await fetch("/api/wms/warehouse/location/list", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${user!.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ page: 1, pageSize: 9999, warehouseCode: whCode, search: "", sortField: "WarehouseCode", sortDir: "asc" }),
      });
      const text = await res.text();
      const json = text.trim() ? JSON.parse(text) : {};
      return buildLocationOccupancyLookup(parseLocationArr(json));
    } catch {
      return new Map<string, string>();
    }
  }

  function rowOccupancyInfo(row: SnapshotRow) {
    const [zone, aisle, bay, level, position] = row.location.split("-");
    return getLocationOccupancyInfo(occupancyLookup, {
      location: row.location,
      locationCode: row.location,
      zone,
      aisle,
      bay,
      level,
      position,
    });
  }

  useEffect(() => {
    if (!user?.token) return;
    fetch("/api/wms/combo/warehouse", {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then((r) => r.json())
      .then((json) => {
        const arr: Record<string, unknown>[] = Array.isArray(json?.data)
          ? json.data
          : Array.isArray(json)
          ? json
          : [];
        const list: Warehouse[] = arr
          .map((w) => ({
            id: String(w.code ?? w.id ?? ""),
            name: String(w.name ?? w.code ?? ""),
          }))
          .filter((w) => w.id);
        setWarehouses(list);
        if (list.length > 0) {
          const preferred = list.find((w) => w.id === "STOO1") ?? list[0];
          setWarehouseCode(preferred.id);
        }
      })
      .catch(() => {});
  }, [user]);

  async function loadCustomerMap(whCode: string) {
    try {
      const r = await fetch(`/api/wms/combo/customer-by-warehouse/${whCode}`, {
        headers: { Authorization: `Bearer ${user!.token}` },
      });
      const json = await r.json();
      const arr: Record<string, unknown>[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      const map: Record<string, string> = {};
      arr.forEach((c) => {
        const code = String(c.code ?? c.customerCode ?? c.id ?? "");
        const name = String(c.name ?? c.customerName ?? code);
        if (code) map[code] = name;
      });
      setCustomerMap(map);
    } catch {
      setCustomerMap({});
    }
  }

  async function loadSnapshot() {
    if (!supabase) { setError("Supabase environment variables not configured."); return; }
    setLoading(true);
    setError("");
    setRows([]);
    const [occupancy] = await Promise.all([
      loadOccupancyLookup(warehouseCode),
      loadCustomerMap(warehouseCode),
    ]);
    setOccupancyLookup(occupancy);
    const { data, error: err } = await supabase
      .from("inventory_history")
      .select("*")
      .eq("captured_date", date)
      .eq("warehouse_code", warehouseCode)
      .order("location", { ascending: true });

    if (err) setError(err.message);
    else setRows(data ?? []);
    setLoading(false);
  }

  async function saveNow() {
    setSaving(true);
    setSaveMsg("");
    setSavePct(0);
    setSaveStatus("Connecting…");

    try {
      const res = await fetch("/api/snapshot/run", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${user!.token}`,
        },
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        setSaveMsg(`Error: ${(json as Record<string,unknown>).error ?? res.status}`);
        setSaving(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // Parse SSE lines
        const lines = buf.split("\n");
        buf = lines.pop() ?? ""; // keep incomplete last line

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === "status") {
              setSavePct(ev.pct ?? 0);
              setSaveStatus(ev.msg ?? "");
            } else if (ev.type === "done") {
              const errPart = ev.errors?.length
                ? ` | ${ev.errors.length} error(s): ${ev.errors.slice(0, 3).join(" / ")}`
                : "";
              setSaveMsg(
                `Saved — ${(ev.inserted as number).toLocaleString()} rows (${ev.warehouses} warehouse(s))${errPart}`
              );
              setSavePct(100);
              setSaveStatus("");
            } else if (ev.type === "error") {
              setSaveMsg(`Error: ${ev.msg}`);
              setSaveStatus("");
            }
          } catch { /* ignore malformed event */ }
        }
      }
    } catch (e) {
      setSaveMsg(`Request failed: ${String(e)}`);
      setSaveStatus("");
    }

    setSaving(false);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.sku?.toLowerCase().includes(q) ||
      r.product_name?.toLowerCase().includes(q) ||
      r.location?.toLowerCase().includes(q) ||
      rowOccupancyInfo(r).toLowerCase().includes(q) ||
      r.lot?.toLowerCase().includes(q) ||
      r.customer_code?.toLowerCase().includes(q) ||
      (r.customer_code ? customerMap[r.customer_code] ?? "" : "").toLowerCase().includes(q)
    );
  }, [rows, search, occupancyLookup]);

  const totalQty = useMemo(() => filtered.reduce((s, r) => s + r.qty, 0), [filtered]);

  async function downloadExcel() {
    const { utils, writeFile } = await import("xlsx");
    const sheet = utils.json_to_sheet(filtered.map(r => ({
      Date: r.captured_date,
      Customer: r.customer_code ? (customerMap[r.customer_code] ?? r.customer_code) : "",
      Location: r.location,
      occupancyInfo: rowOccupancyInfo(r),
      SKU: r.sku,
      "Product Name": r.product_name ?? "",
      Qty: r.qty,
      Available: r.available_qty ?? "",
      LOT: r.lot ?? "",
      "Expiry Date": formatExpire(r.expire_date),
    })));
    const wb = utils.book_new();
    utils.book_append_sheet(wb, sheet, "Inventory History");
    writeFile(wb, `inventory_history_${warehouseCode}_${date}.xlsx`);
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-900">Inventory History</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={saveNow}
            disabled={saving}
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className={`w-4 h-4 ${saving ? "animate-pulse" : ""}`} />
            {saving ? `Saving… ${savePct}%` : "Save Now"}
          </button>
          <button
            onClick={downloadExcel}
            disabled={filtered.length === 0}
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* Progress bar (shown while saving) */}
      {saving && (
        <div className="mb-5 bg-white border border-slate-200 rounded-xl px-5 py-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-600 font-medium truncate pr-4">{saveStatus || "Working…"}</span>
            <span className="text-sm font-semibold text-blue-600 tabular-nums flex-shrink-0">{savePct}%</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
            <div
              className="h-2 rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${savePct}%` }}
            />
          </div>
        </div>
      )}

      {saveMsg && (
        <div className={`rounded-xl px-4 py-3 text-sm mb-5 border ${saveMsg.startsWith("Error") || saveMsg.startsWith("Request failed") ? "bg-red-50 border-red-200 text-red-700" : "bg-green-50 border-green-200 text-green-700"}`}>
          {saveMsg}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2 bg-white">
          <Calendar className="w-4 h-4 text-slate-400" />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="text-sm focus:outline-none"
          />
        </div>

        <select
          value={warehouseCode}
          onChange={(e) => setWarehouseCode(e.target.value)}
          disabled={warehouses.length === 0}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
        >
          {warehouses.length === 0 && <option value={warehouseCode}>{warehouseCode}</option>}
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.name || w.id}</option>
          ))}
        </select>

        <button
          onClick={loadSnapshot}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          {loading ? "Loading..." : "Search"}
        </button>
        {rows.length > 0 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search SKU, product name, LOT..."
              className="border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
            />
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-5">
          {error}
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="flex items-center gap-4 mb-5 bg-white border border-slate-100 rounded-xl px-5 py-3 text-sm shadow-sm">
          <span className="text-slate-600"><b className="text-slate-900">{filtered.length.toLocaleString()}</b> items</span>
          <span className="text-slate-300">|</span>
          <span className="text-slate-600">Total qty <b className="text-slate-900">{totalQty.toLocaleString()}</b></span>
          <span className="text-slate-300">|</span>
          <span className="text-slate-500 text-xs">
            {date} snapshot
            {rows[0]?.captured_at && (
              <span className="ml-1 text-slate-400">
                · captured {formatCapturedAt(rows[0].captured_at)} (LA)
              </span>
            )}
          </span>
        </div>
      )}

      {!loading && rows.length === 0 && !error && (
        <div className="text-center py-20 text-slate-400">
          <Calendar className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">Select a date and warehouse, then click Search</p>
          <p className="text-sm mt-1">Dates without a saved snapshot will show no data</p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">Customer</th>
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">Location</th>
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">occupancyInfo</th>
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">SKU</th>
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">Product Name</th>
                <th className="px-4 py-2.5 text-right text-slate-500 font-medium">Qty</th>
                <th className="px-4 py-2.5 text-right text-slate-500 font-medium">Available</th>
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">LOT</th>
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">Expiry Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">
                    {r.customer_code
                      ? <span title={r.customer_code}>{customerMap[r.customer_code] ?? r.customer_code}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-600 whitespace-nowrap">{r.location}</td>
                  <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{rowOccupancyInfo(r) || "-"}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono font-medium text-slate-900 bg-slate-100 px-2 py-0.5 rounded">{r.sku}</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-700 max-w-xs truncate">{r.product_name ?? "-"}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-slate-900">{r.qty.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right text-slate-500">{r.available_qty?.toLocaleString() ?? "-"}</td>
                  <td className="px-4 py-2.5 text-slate-400 font-mono">{r.lot ?? "-"}</td>
                  <td className="px-4 py-2.5 text-slate-400 font-mono">{formatExpire(r.expire_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
