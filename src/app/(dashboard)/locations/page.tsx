"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Search, RefreshCw, MapPin, Download, Upload, ChevronDown, ChevronUp, CheckCircle, XCircle, Loader2 } from "lucide-react";

interface Warehouse { id: string; cd: string; name: string; }
type Row = Record<string, unknown>;

interface UploadRow {
  zoneNm: string;
  aisleNm: string;
  levelNm: string;
  bayNm: string;
  positionNm: string;
  maxCbm: number | string;
  maxCbf: number | string;
  occupancyInfo: string;
  remark: string;
}

type UploadStatus = "pending" | "ok" | "error";
interface UploadResult { row: UploadRow; status: UploadStatus; message?: string; }

export default function LocationMasterPage() {
  const { user } = useAuth();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseCode, setWarehouseCode] = useState("");
  const [warehouseCd, setWarehouseCd] = useState("");
  const [locations, setLocations] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  // Upload state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadRows, setUploadRows] = useState<UploadRow[]>([]);
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        body: JSON.stringify({ page: 1, pageSize: 9999, warehouseCode: whCode, search: "", sortField: "WarehouseCode", sortDir: "asc" }),
      });
      const text = await res.text();
      if (!text.trim()) throw new Error(`Empty response (status ${res.status}) — check the API endpoint`);
      const json = JSON.parse(text);
      const list = parseArr(json);
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
          .map((w) => ({
            id:   String(w.code ?? w.warehouseCode ?? w.id ?? ""),
            cd:   String(w.cd ?? w.warehouseCd ?? w.code ?? w.id ?? ""),
            name: String(w.name ?? w.warehouseName ?? w.code ?? ""),
          }))
          .filter((w) => w.id);
        setWarehouses(list);
        if (list.length > 0) {
          const preferred = list.find((w) => w.id === "STOO1") ?? list[0];
          setWarehouseCode(preferred.id);
          setWarehouseCd(preferred.cd);
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
    utils.book_append_sheet(wb, ws, "Locations");
    writeFile(wb, `locations_master_${warehouseCode}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // ── Upload: parse Excel ───────────────────────────────────────────────────
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const { read, utils } = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw: Record<string, unknown>[] = utils.sheet_to_json(ws, { defval: "" });

    // Normalize headers (trim, uppercase) and map columns
    const normalizeKey = (k: string) => k.trim().toUpperCase().replace(/\s+/g, "_");
    const rows: UploadRow[] = raw.map((r) => {
      const n: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) n[normalizeKey(k)] = v;
      return {
        zoneNm:        String(n["ZONE"] ?? n["ZONE_NM"] ?? ""),
        aisleNm:       String(n["AISLE"] ?? n["AISLE_NM"] ?? ""),
        levelNm:       String(n["LEVEL"] ?? n["LEVEL_NM"] ?? ""),
        bayNm:         String(n["BAY"] ?? n["BAY_NM"] ?? ""),
        positionNm:    String(n["POSITION"] ?? n["POSITION_NM"] ?? ""),
        maxCbm:        n["MAX_CBM"] !== "" ? Number(n["MAX_CBM"] ?? 0) : "",
        maxCbf:        n["MAX_CBF"] !== "" ? Number(n["MAX_CBF"] ?? 0) : "",
        occupancyInfo: String(n["OCCUPANCY_INFO"] ?? n["OCCUPANCY"] ?? ""),
        remark:        String(n["REMARK"] ?? ""),
      };
    }).filter((r) => r.zoneNm || r.aisleNm || r.bayNm || r.positionNm);

    setUploadRows(rows);
    setUploadResults([]);
    // Reset file input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── Upload: POST rows ─────────────────────────────────────────────────────
  async function startUpload() {
    if (!warehouseCode || uploadRows.length === 0) return;
    setUploading(true);
    setUploadProgress(0);
    const results: UploadResult[] = [];

    for (let i = 0; i < uploadRows.length; i++) {
      const row = uploadRows[i];
      // warehouseCd: numeric/internal CD from combo API (may differ from string code)
      // fallback to warehouseCode if cd wasn't available in combo response
      const cdVal = warehouseCd && warehouseCd !== warehouseCode ? warehouseCd : warehouseCode;
      const payload = {
        warehouseCode,
        warehouseCd:  cdVal,
        zoneNm:       row.zoneNm,
        aisleNm:      row.aisleNm,
        levelNm:      row.levelNm,
        bayNm:        row.bayNm,
        positionNm:   row.positionNm,
        maxCbm:       row.maxCbm === "" ? null : Number(row.maxCbm),
        maxCbf:       row.maxCbf === "" ? null : Number(row.maxCbf),
        occupancyInfo: row.occupancyInfo || null,
        remark:       row.remark || null,
        isNew:        true,
      };
      try {
        const res = await fetch("/api/wms/warehouse/location/save", {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
        const rawText = await res.text().catch(() => "");
        let json: Record<string, unknown> = {};
        try { json = JSON.parse(rawText); } catch { /* not json */ }

        if (!res.ok) {
          results.push({ row, status: "error", message: `HTTP ${res.status}: ${rawText.slice(0, 120)}` });
        } else {
          const code = json?.code ?? json?.resultCode ?? json?.result ?? json?.status;
          const msg  = String(json?.message ?? json?.msg ?? json?.resultMessage ?? "");
          // Show full raw response in message for debugging
          const detail = rawText.slice(0, 200);
          if (code !== undefined && code !== 200 && code !== "200" && code !== "OK" && code !== 0 && code !== "0" && code !== "SUCCESS" && code !== "success") {
            results.push({ row, status: "error", message: msg || detail });
          } else {
            results.push({ row, status: "ok", message: detail });
          }
        }
      } catch (e) {
        results.push({ row, status: "error", message: String(e) });
      }
      setUploadProgress(i + 1);
      // Small delay to avoid overwhelming the API
      await new Promise((r) => setTimeout(r, 50));
    }

    setUploadResults(results);
    setUploading(false);
    // Refresh location list after upload
    await fetchLocations(warehouseCode);
  }

  const successCount = uploadResults.filter((r) => r.status === "ok").length;
  const errorCount   = uploadResults.filter((r) => r.status === "error").length;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Location Master</h1>
          <p className="text-slate-500 text-sm mt-0.5">All warehouse locations</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setUploadOpen((v) => !v); setUploadRows([]); setUploadResults([]); }}
            className="flex items-center gap-2 text-sm text-white bg-blue-600 hover:bg-blue-700 border border-blue-600 rounded-lg px-3 py-2 transition-colors"
          >
            <Upload className="w-4 h-4" />
            Bulk Upload
            {uploadOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
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

      {/* ── Bulk Upload Panel ────────────────────────────────────────────── */}
      {uploadOpen && (
        <div className="mb-6 border border-blue-200 rounded-xl bg-blue-50/40 p-5">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Bulk Upload Locations</h2>

          {/* Instructions */}
          <div className="text-xs text-slate-500 mb-4 bg-white border border-slate-100 rounded-lg px-4 py-3 leading-relaxed">
            <span className="font-medium text-slate-700">Required columns: </span>
            ZONE · AISLE · LEVEL · BAY · POSITION · MAX_CBM · MAX_CBF · OCCUPANCY_INFO · REMARK
            <br />
            Warehouse code is taken from the selector above. Each row will be registered via <code className="bg-slate-100 px-1 rounded">POST /warehouse/location/save</code>.
          </div>

          {/* File picker */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <label className="cursor-pointer flex items-center gap-2 text-sm font-medium text-blue-700 bg-white border border-blue-300 rounded-lg px-4 py-2 hover:bg-blue-50 transition-colors">
              <Upload className="w-4 h-4" />
              Choose Excel File
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>
            {uploadRows.length > 0 && (
              <span className="text-sm text-slate-600">
                <b className="text-slate-900">{uploadRows.length}</b> rows parsed
              </span>
            )}
          </div>

          {/* Preview table */}
          {uploadRows.length > 0 && (
            <>
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden mb-4 max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-left text-slate-500 font-medium">#</th>
                      {["ZONE","AISLE","LEVEL","BAY","POSITION","MAX_CBM","MAX_CBF","OCCUPANCY_INFO","REMARK"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-slate-500 font-medium whitespace-nowrap">{h}</th>
                      ))}
                      {uploadResults.length > 0 && <th className="px-3 py-2 text-left text-slate-500 font-medium">Status</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {uploadRows.map((row, i) => {
                      const res = uploadResults[i];
                      return (
                        <tr key={i} className={`border-b border-slate-100 last:border-0 ${
                          res?.status === "ok" ? "bg-green-50" :
                          res?.status === "error" ? "bg-red-50" : "hover:bg-slate-50"
                        }`}>
                          <td className="px-3 py-1.5 text-slate-400">{i + 1}</td>
                          <td className="px-3 py-1.5 text-slate-700">{row.zoneNm || "-"}</td>
                          <td className="px-3 py-1.5 text-slate-700">{row.aisleNm || "-"}</td>
                          <td className="px-3 py-1.5 text-slate-700">{row.levelNm || "-"}</td>
                          <td className="px-3 py-1.5 text-slate-700">{row.bayNm || "-"}</td>
                          <td className="px-3 py-1.5 text-slate-700">{row.positionNm || "-"}</td>
                          <td className="px-3 py-1.5 text-slate-700 text-right">{row.maxCbm === "" ? "-" : String(row.maxCbm)}</td>
                          <td className="px-3 py-1.5 text-slate-700 text-right">{row.maxCbf === "" ? "-" : String(row.maxCbf)}</td>
                          <td className="px-3 py-1.5 text-slate-700">{row.occupancyInfo || "-"}</td>
                          <td className="px-3 py-1.5 text-slate-700">{row.remark || "-"}</td>
                          {uploadResults.length > 0 && (
                            <td className="px-3 py-1.5 max-w-xs">
                              {res?.status === "ok"    && (
                                <span className="flex items-center gap-1 text-green-700" title={res.message}>
                                  <CheckCircle className="w-3.5 h-3.5 shrink-0" />OK
                                </span>
                              )}
                              {res?.status === "error" && (
                                <span className="flex items-start gap-1 text-red-600" title={res.message}>
                                  <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                  <span className="break-all">{res.message ? res.message.slice(0, 80) : "Error"}</span>
                                </span>
                              )}
                              {!res && uploading && i === uploadProgress && (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Progress */}
              {uploading && (
                <div className="mb-3">
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>Uploading…</span>
                    <span>{uploadProgress} / {uploadRows.length}</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-1.5">
                    <div
                      className="bg-blue-500 h-1.5 rounded-full transition-all duration-200"
                      style={{ width: `${uploadRows.length > 0 ? (uploadProgress / uploadRows.length) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Results summary */}
              {uploadResults.length > 0 && !uploading && (
                <div className={`text-sm font-medium mb-3 flex items-center gap-2 ${errorCount > 0 ? "text-red-600" : "text-green-700"}`}>
                  {errorCount === 0
                    ? <><CheckCircle className="w-4 h-4" />All {successCount} rows uploaded successfully!</>
                    : <><XCircle className="w-4 h-4" />{successCount} succeeded · {errorCount} failed</>
                  }
                </div>
              )}

              {/* Upload button */}
              {uploadResults.length === 0 && (
                <button
                  onClick={startUpload}
                  disabled={uploading || !warehouseCode}
                  className="flex items-center gap-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-5 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploading
                    ? <><Loader2 className="w-4 h-4 animate-spin" />Uploading…</>
                    : <><Upload className="w-4 h-4" />Upload {uploadRows.length} rows to {warehouseCode}</>
                  }
                </button>
              )}
              {uploadResults.length > 0 && !uploading && (
                <button
                  onClick={() => { setUploadRows([]); setUploadResults([]); }}
                  className="text-sm text-slate-500 hover:text-slate-700 underline"
                >
                  Clear & upload another file
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={warehouseCode}
          onChange={(e) => {
            const wh = warehouses.find((w) => w.id === e.target.value);
            setWarehouseCode(e.target.value);
            setWarehouseCd(wh?.cd ?? e.target.value);
            fetchLocations(e.target.value);
          }}
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
          <MapPin className="w-4 h-4 text-slate-400" />
          <span className="text-slate-600">
            <b className="text-slate-900">{filtered.length.toLocaleString()}</b> locations
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
          <p className="text-sm text-slate-500">Loading locations...</p>
        </div>
      )}

      {!loading && !error && locations.length === 0 && (
        <div className="text-center py-20 text-slate-400">
          <MapPin className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No locations found</p>
        </div>
      )}

      {!loading && filtered.length > 0 && cols.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {cols.map((c) => (
                    <th key={c} className="px-4 py-2.5 text-left text-slate-500 font-medium whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 border-b border-slate-100 last:border-0">
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
