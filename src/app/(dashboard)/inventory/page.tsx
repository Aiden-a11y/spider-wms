"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/auth-context";
import {
  buildLocationOccupancyLookup,
  getLocationOccupancyInfo,
  normalizeInventory,
  type InventoryItem,
  type Warehouse,
} from "@/lib/wms";
import {
  Search,
  RefreshCw,
  AlertCircle,
  Package,
  Download,
  Plus,
  Upload,
  X,
  CheckCircle2,
  Loader2,
} from "lucide-react";

// ────────────────────────────────────────────────
// Adjust / Batch-upload types
// ────────────────────────────────────────────────

const CONDITIONS = [
  { code: "GOOD", label: "GOOD - GOOD" },
  { code: "DMG",  label: "DMG - DAMAGE" },
  { code: "RTRN", label: "RTRN - RETURN" },
];

type AdjustForm = {
  warehouseCode: string;
  warehouseCd: string;      // internal warehouse ID e.g. "W2026032400000002"
  customerCode: string;
  locationCode: string;
  condition: string;        // → itemCondition in payload
  sku: string;              // → productSku in payload
  productName: string;
  currentQty: number;
  adjustQty: string;
  lotNo: string;
  expireDate: string;
  serialNo: string;
  remark: string;
};

type BatchRow = AdjustForm & { _status?: "pending" | "ok" | "error"; _msg?: string };

function blankForm(warehouseCode = "", warehouseCd = "", customerCode = ""): AdjustForm {
  return { warehouseCode, warehouseCd, customerCode, locationCode: "", condition: "GOOD", sku: "", productName: "", currentQty: 0, adjustQty: "", lotNo: "", expireDate: "", serialNo: "", remark: "" };
}

// ────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────

interface Customer {
  code: string;
  name: string;
}

export default function InventoryPage() {
  const { user } = useAuth();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseCode, setWarehouseCode] = useState<string>("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerCode, setCustomerCode] = useState<string>("");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ total: number; loaded: number } | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [locFilter, setLocFilter] = useState({ zone: "", aisle: "", bay: "", level: "", slot: "" });
  const [debugInfo, setDebugInfo] = useState<{
    comboRaw?: unknown;
    customerRaw?: unknown;
    inventoryRaw?: unknown;
    endpoint?: string;
    status?: number;
  }>({});

  // ── Add Stock modal ──
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustForm, setAdjustForm] = useState<AdjustForm>(() => blankForm());
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);
  const [adjustResult, setAdjustResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [qtyFetching, setQtyFetching] = useState(false);

  // ── Batch upload modal ──
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchDone, setBatchDone] = useState(false);

  // ── Location search (for modal) ──
  type LocResult = { locationCode: string; zone?: string; aisle?: string; bay?: string; level?: string; position?: string; [k: string]: unknown };
  const [locSearch, setLocSearch] = useState("");
  const [locResults, setLocResults] = useState<LocResult[]>([]);
  const [locLoading, setLocLoading] = useState(false);
  const [locDropOpen, setLocDropOpen] = useState(false);
  const locDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locWrapRef = useRef<HTMLDivElement>(null);

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  function parseComboArr(json: unknown): Record<string, unknown>[] {
    if (!json) return [];
    const j = json as Record<string, unknown>;
    const arr = Array.isArray(j?.data) ? j.data : Array.isArray(json) ? json : [];
    return arr as Record<string, unknown>[];
  }

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
        headers,
        body: JSON.stringify({ page: 1, pageSize: 9999, warehouseCode: whCode, search: "", sortField: "WarehouseCode", sortDir: "asc" }),
      });
      const text = await res.text();
      const json = text.trim() ? JSON.parse(text) : {};
      return buildLocationOccupancyLookup(parseLocationArr(json));
    } catch {
      return new Map<string, string>();
    }
  }

  // 1. 창고 목록 로드
  useEffect(() => {
    fetch("/api/wms/combo/warehouse", { headers })
      .then((r) => r.json())
      .then((json) => {
        setDebugInfo((d) => ({ ...d, comboRaw: json }));
        const arr = parseComboArr(json);
        // combo returns { code, name } — use code as the warehouse identifier
        const list: Warehouse[] = arr.map((w) => ({
          id: String(w.code ?? w.id ?? w.warehouseId ?? ""),
          name: String(w.name ?? w.warehouseName ?? w.code ?? ""),
          code: String(w.code ?? ""),
          cd: String(w.id ?? w.warehouseId ?? w.warehouseCd ?? w.cd ?? ""),
        })).filter((w) => w.id);
        setWarehouses(list);
        if (list.length > 0) {
          const preferred = list.find((w) => w.id === "STOO1") ?? list[0];
          selectWarehouse(preferred.id);
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line

  // 2. 창고 선택 시 고객사 목록 로드
  async function selectWarehouse(code: string) {
    setWarehouseCode(code);
    setCustomers([]);
    setCustomerCode("");
    setItems([]);

    try {
      const r = await fetch(`/api/wms/combo/customer-by-warehouse/${code}`, { headers });
      const json = await r.json();
      setDebugInfo((d) => ({ ...d, customerRaw: json }));
      const arr = parseComboArr(json);
      const list: Customer[] = arr.map((c) => ({
        code: String(c.code ?? c.customerCode ?? c.id ?? ""),
        name: String(c.name ?? c.customerName ?? c.code ?? ""),
      })).filter((c) => c.code);
      setCustomers(list);
      setCustomerCode("ALL");
      await loadInventoryWith(code, "ALL", list);
    } catch {
      await loadInventoryWith(code, "ALL", []);
    }
  }


  async function loadInventory() {
    await loadInventoryWith(warehouseCode, customerCode, customers);
  }

  async function downloadExcel() {
    const { utils, writeFile } = await import("xlsx");
    const rows = sortedItems.map((item) => ({
      Location: [item.zone, item.aisle, item.bay, item.level, item.position].join("-"),
      occupancyInfo: item.occupancyInfo ?? "",
      Customer: item.customerCode ?? "",
      SKU: item.sku,
      "Product Name": item.productName,
      Qty: item.qty,
      Available: item.availableQty ?? "",
      LOT: item.lot ?? "",
      "Expiry Date": item.expireDate?.length === 8
        ? `${item.expireDate.slice(4,6)}-${item.expireDate.slice(6,8)}-${item.expireDate.slice(0,4)}`
        : item.expireDate ?? "",
    }));
    const ws = utils.json_to_sheet(rows);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Inventory");
    const date = new Date().toISOString().slice(0,10);
    writeFile(wb, `inventory_${warehouseCode}_${date}.xlsx`);
  }

  async function loadInventoryWith(whCode: string, custCode: string, custSnapshot: Customer[] = customers) {
    if (!whCode) return;
    setLoading(true);
    setError("");
    setItems([]);
    setProgress(null);

    try {
      const custList = custCode === "ALL" || !custCode ? custSnapshot : custSnapshot.filter((c) => c.code === custCode);
      if (custList.length === 0) {
        setError("No customer data available.");
        setLoading(false);
        return;
      }

      // Step 1: collect all (customerCode, productSku) pairs — product list cached 10 min
      const CACHE_TTL = 10 * 60 * 1000;
      const pairs: { custCode: string; sku: string }[] = [];

      for (const cust of custList) {
        const cacheKey = `sku_cache__${whCode}__${cust.code}`;
        let skus: string[] | null = null;
        try {
          const cached = JSON.parse(sessionStorage.getItem(cacheKey) ?? "null");
          if (cached && Date.now() - cached.ts < CACHE_TTL) skus = cached.skus;
        } catch { /* ignore */ }

        if (!skus) {
          // Paginate through product list (pageSize=500) until all pages fetched
          skus = [];
          let page = 1;
          const pageSize = 500;
          while (true) {
            const skuRes = await fetch(`/api/wms/product/list`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                warehouseCode: whCode,
                customerCode: cust.code,
                pageNum: page,
                pageSize,
              }),
            });
            const skuJson = await skuRes.json();
            const list = (skuJson.data?.list ?? []) as Record<string, unknown>[];
            const pageSkus = list.map((p) => String(p.productSku ?? "")).filter(Boolean);
            skus.push(...pageSkus);

            // Stop if this page returned fewer than pageSize (last page) or empty
            if (pageSkus.length < pageSize) break;
            page += 1;
            // Small delay between pages so we don't hammer the API
            await new Promise((r) => setTimeout(r, 300));
          }
          try { sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), skus })); } catch { /* ignore */ }
        }

        skus.forEach((sku) => pairs.push({ custCode: cust.code, sku }));
      }

      if (pairs.length === 0) {
        setError("No products registered.");
        setLoading(false);
        return;
      }

      setProgress({ total: pairs.length, loaded: 0 });

      // Step 2: fetch inventory detail in small batches (5 at a time) with delay between batches
      // Mimics human browsing pace so the WMS API doesn't throttle us
      const BATCH_SIZE = 5;
      const BATCH_DELAY_MS = 400;
      const allItems: ReturnType<typeof normalizeInventory> = [];
      let loaded = 0;

      for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
        const batch = pairs.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(({ custCode: cc, sku }) =>
            fetch(`/api/wms/inventory/detail`, {
              method: "POST",
              headers,
              body: JSON.stringify({ warehouseCode: whCode, customerCode: cc, productSku: sku }),
            })
              .then((r) => r.json())
              .then((j) => normalizeInventory(j))
              .catch(() => [])
          )
        );
        for (const rows of batchResults) {
          allItems.push(...rows);
          loaded += 1;
          setProgress({ total: pairs.length, loaded });
        }
        // Pause between batches unless this is the last one
        if (i + BATCH_SIZE < pairs.length) {
          await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
        }
      }

      setDebugInfo((d) => ({
        ...d,
        inventoryRaw: { totalSkus: pairs.length, totalItems: allItems.length },
        endpoint: `POST /product/list → POST /inventory/detail ×${pairs.length}`,
        status: 200,
      }));

      const occupancyLookup = await loadOccupancyLookup(whCode);
      const mappedItems = allItems.map((item) => ({
        ...item,
        occupancyInfo: getLocationOccupancyInfo(occupancyLookup, {
          locationCode: item.locationCode,
          zone: item.zone,
          aisle: item.aisle,
          bay: item.bay,
          level: item.level,
          position: item.position,
        }),
      }));

      setItems(mappedItems);
    } catch (e) {
      setError(`Request failed: ${String(e)}`);
    }

    setProgress(null);
    setLoading(false);
  }

  const uniq = (arr: string[]) => Array.from(new Set(arr)).filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const locOptions = useMemo(() => ({
    zone:  uniq(items.map((i) => i.zone)),
    aisle: uniq(items.filter((i) => !locFilter.zone  || i.zone  === locFilter.zone).map((i) => i.aisle)),
    bay:   uniq(items.filter((i) => (!locFilter.zone  || i.zone  === locFilter.zone) && (!locFilter.aisle || i.aisle === locFilter.aisle)).map((i) => i.bay)),
    level: uniq(items.filter((i) => (!locFilter.zone  || i.zone  === locFilter.zone) && (!locFilter.aisle || i.aisle === locFilter.aisle) && (!locFilter.bay   || i.bay   === locFilter.bay)).map((i) => i.level)),
    slot:  uniq(items.filter((i) => (!locFilter.zone  || i.zone  === locFilter.zone) && (!locFilter.aisle || i.aisle === locFilter.aisle) && (!locFilter.bay   || i.bay   === locFilter.bay) && (!locFilter.level || i.level === locFilter.level)).map((i) => i.position)),
  }), [items, locFilter]);

  // Filter items
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchCustomer = customerCode === "ALL" || !customerCode || item.customerCode === customerCode;
      const matchLoc =
        (!locFilter.zone  || item.zone     === locFilter.zone)  &&
        (!locFilter.aisle || item.aisle    === locFilter.aisle) &&
        (!locFilter.bay   || item.bay      === locFilter.bay)   &&
        (!locFilter.level || item.level    === locFilter.level) &&
        (!locFilter.slot  || item.position === locFilter.slot);
      const matchSearch =
        !q ||
        item.sku.toLowerCase().includes(q) ||
        item.productName.toLowerCase().includes(q) ||
        item.lot?.toLowerCase().includes(q) ||
        item.occupancyInfo?.toLowerCase().includes(q) ||
        item.locationCode?.toLowerCase().includes(q);
      return matchCustomer && matchLoc && matchSearch;
    });
  }, [items, customerCode, search, locFilter]);

  const sortedItems = useMemo(() =>
    [...filteredItems].sort((a, b) => {
      for (const key of ["zone","aisle","bay","level","position"] as const) {
        const d = a[key].localeCompare(b[key], undefined, {numeric:true});
        if (d !== 0) return d;
      }
      return 0;
    }),
  [filteredItems]);

  const totalQty = useMemo(
    () => filteredItems.reduce((s, i) => s + i.qty, 0),
    [filteredItems]
  );

  // ── Location search ──
  const searchLocations = useCallback(async (term: string, whCode: string) => {
    if (!term || term.length < 1 || !whCode) { setLocResults([]); setLocDropOpen(false); return; }
    setLocLoading(true);
    try {
      const res = await fetch("/api/wms/warehouse/location-search", {
        method: "POST",
        headers,
        body: JSON.stringify({ warehouseCode: whCode, search: term }),
      });
      const json = await res.json();
      const arr: LocResult[] = Array.isArray(json?.data) ? json.data
        : Array.isArray(json?.data?.list) ? json.data.list
        : Array.isArray(json?.list) ? json.list
        : Array.isArray(json) ? json : [];
      // debug: log first item so we can see real field names
      if (arr.length > 0) console.log("[loc-search] sample row:", arr[0]);
      setLocResults(arr.slice(0, 50));
      setLocDropOpen(arr.length > 0);
    } catch { setLocResults([]); setLocDropOpen(false); }
    setLocLoading(false);
  }, [headers]);

  function handleLocInput(val: string) {
    setLocSearch(val);
    setAdjustForm((f) => ({ ...f, locationCode: val }));
    if (locDebounce.current) clearTimeout(locDebounce.current);
    locDebounce.current = setTimeout(() => searchLocations(val, adjustForm.warehouseCode), 300);
  }

  function getLocCode(loc: LocResult): string {
    // Try all known field name variants
    const direct = loc.locationCode ?? loc.locationCd ?? loc.locCode ?? loc.locCd ??
      loc.code ?? loc.location ?? loc.locationName ?? loc.name ?? loc.loc ?? "";
    if (direct) return String(direct);
    // Construct from parts: zone-aisle-bay-level-position
    const parts = [
      loc.zone     ?? loc.zoneNo     ?? loc.zoneName,
      loc.aisle    ?? loc.aisleNo    ?? loc.aisleName,
      loc.bay      ?? loc.bayNo      ?? loc.bayName,
      loc.level    ?? loc.levelNo    ?? loc.levelName,
      loc.position ?? loc.positionNo ?? loc.positionName,
    ].filter(Boolean);
    if (parts.length > 0) return parts.join("-");
    return "";
  }

  function selectLocation(loc: LocResult) {
    const code = getLocCode(loc);
    setLocSearch(code);
    setAdjustForm((f) => ({ ...f, locationCode: code }));
    setLocDropOpen(false);
    // fetch current qty after location is set
    setTimeout(() => fetchCurrentQty({ ...adjustForm, locationCode: code }), 50);
  }

  // close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (locWrapRef.current && !locWrapRef.current.contains(e.target as Node)) setLocDropOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Fetch current qty for a given location + sku ──
  async function fetchCurrentQty(form: AdjustForm) {
    if (!form.warehouseCode || !form.locationCode || !form.sku) return;
    setQtyFetching(true);
    try {
      const res = await fetch("/api/wms/inventory/detail", {
        method: "POST",
        headers,
        body: JSON.stringify({ warehouseCode: form.warehouseCode, customerCode: form.customerCode, locationCode: form.locationCode, sku: form.sku }),
      });
      const json = await res.json();
      const arr: Record<string, unknown>[] = Array.isArray(json?.data) ? json.data : Array.isArray(json?.data?.list) ? json.data.list : Array.isArray(json) ? json : [];
      const match = arr.find((r) =>
        String(r.sku ?? r.productSku ?? "").toUpperCase() === form.sku.toUpperCase() &&
        String(r.locationCode ?? r.location ?? "").toUpperCase() === form.locationCode.toUpperCase()
      );
      const qty = Number(match?.qty ?? match?.quantity ?? 0);
      setAdjustForm((f) => ({ ...f, currentQty: qty }));
    } catch { /* ignore */ }
    setQtyFetching(false);
  }

  // ── Submit single adjustment ──
  async function submitAdjust(form: AdjustForm): Promise<{ ok: boolean; msg: string }> {
    const adjustQtyNum = Number(form.adjustQty);
    if (!form.warehouseCode || !form.customerCode || !form.locationCode || !form.condition) {
      return { ok: false, msg: "Warehouse, Customer, Location, Condition are required." };
    }
    if (!form.adjustQty || isNaN(adjustQtyNum) || adjustQtyNum === 0) {
      return { ok: false, msg: "Adjust Qty must be a non-zero number." };
    }
    const payload: Record<string, unknown> = {
      warehouseCode: form.warehouseCode,
      warehouseCd:   form.warehouseCd || undefined,
      customerCode:  form.customerCode,
      locationCode:  form.locationCode || undefined,
      itemCondition: form.condition,
      productSku:    form.sku || undefined,
      adjustQty:     adjustQtyNum,
      adjustType:    "N",
      lotNo:         form.lotNo || "",
      expireDate:    form.expireDate ? form.expireDate.replace(/-/g, "") : "",
      serialNo:      form.serialNo || "",
      remark:        form.remark || "",
    };
    // strip undefined (but keep empty strings — API expects them)
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
    try {
      const res = await fetch("/api/wms/inventory/adjust", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, msg: json?.message ?? json?.error ?? `HTTP ${res.status}` };
      return { ok: true, msg: json?.message ?? "Adjustment saved." };
    } catch (e) {
      return { ok: false, msg: String(e) };
    }
  }

  // ── Handle single modal submit ──
  async function handleAdjustSubmit() {
    setAdjustSubmitting(true);
    setAdjustResult(null);
    const result = await submitAdjust(adjustForm);
    setAdjustResult(result);
    setAdjustSubmitting(false);
    if (result.ok) {
      // refresh inventory after short delay
      setTimeout(() => loadInventory(), 800);
    }
  }

  // ── Parse Excel for batch upload ──
  async function handleBatchFile(file: File) {
    const { read, utils } = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw: Record<string, unknown>[] = utils.sheet_to_json(ws, { defval: "" });
    const rows: BatchRow[] = raw.map((r) => {
      const get = (...keys: string[]) => String(keys.map((k) => r[k] ?? r[k.toLowerCase()] ?? r[k.toUpperCase()] ?? "").find((v) => v !== "") ?? "");
      const rawDate = get("Expire Date", "ExpireDate", "expireDate", "expire_date");
      // Convert MM/DD/YYYY → YYYY-MM-DD
      let expDate = rawDate;
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(rawDate)) {
        const [m, d, y] = rawDate.split("/");
        expDate = `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
      } else if (/^\d{8}$/.test(rawDate)) {
        expDate = `${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`;
      }
      const whCode = get("Warehouse", "warehouseCode", "warehouse_code") || warehouseCode;
      const wh = warehouses.find((w) => w.id === whCode);
      return {
        warehouseCode: whCode,
        warehouseCd:   wh?.cd ?? "",
        customerCode:  get("Customer Code", "Customer", "customerCode", "customer_code"),
        locationCode:  get("Location", "locationCode", "location_code"),
        condition:     get("Condition", "itemCondition", "condition") || "GOOD",
        sku:           get("SKU", "productSku", "sku", "Product SKU"),
        productName:   get("Product Name", "productName", "product_name"),
        currentQty:    0,
        adjustQty:     get("Adjust Qty", "adjustQty", "adjust_qty", "Qty"),
        lotNo:         get("Lot No", "lotNo", "lot_no", "LOT"),
        expireDate:    expDate,
        serialNo:      get("Serial No", "serialNo", "serial_no"),
        remark:        get("Remark", "remark", "Reason"),
        _status: "pending" as const,
      };
    }).filter((r) => r.locationCode && r.adjustQty);
    setBatchRows(rows);
    setBatchDone(false);
  }

  // ── Run batch submit ──
  async function runBatch() {
    setBatchRunning(true);
    const updated = [...batchRows];
    for (let i = 0; i < updated.length; i++) {
      if (updated[i]._status === "ok") continue;
      const result = await submitAdjust(updated[i]);
      updated[i] = { ...updated[i], _status: result.ok ? "ok" : "error", _msg: result.msg };
      setBatchRows([...updated]);
    }
    setBatchRunning(false);
    setBatchDone(true);
    loadInventory();
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-2 flex-wrap">
        <h1 className="text-xl font-bold text-slate-900">Inventory</h1>
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => { const wh = warehouses.find((w) => w.id === warehouseCode); setAdjustForm(blankForm(warehouseCode, wh?.cd ?? "", customerCode === "ALL" ? "" : customerCode)); setAdjustResult(null); setLocSearch(""); setLocResults([]); setLocDropOpen(false); setAdjustOpen(true); }}
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-2 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Stock
          </button>
          <button
            onClick={() => { setBatchRows([]); setBatchDone(false); setBatchOpen(true); }}
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg px-3 py-2 transition-colors"
          >
            <Upload className="w-4 h-4" />
            Bulk Upload
          </button>
          <button
            onClick={loadInventory}
            disabled={loading}
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={downloadExcel}
            disabled={loading || sortedItems.length === 0}
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* Controls — row 1: warehouse / customer / search */}
      <div className="flex flex-wrap gap-3 mb-2">
        <select
          value={warehouseCode}
          onChange={(e) => selectWarehouse(e.target.value)}
          disabled={warehouses.length === 0}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
        >
          {warehouses.length === 0 && <option value="">Loading warehouses...</option>}
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.name || w.id}</option>
          ))}
        </select>

        {customers.length > 0 && (
          <select
            value={customerCode}
            onChange={(e) => { setCustomerCode(e.target.value); loadInventoryWith(warehouseCode, e.target.value, customers); }}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Customers</option>
            {customers.map((c) => (
              <option key={c.code} value={c.code}>{c.name || c.code}</option>
            ))}
          </select>
        )}

        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SKU, product name, LOT..."
            className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Controls — row 2: location filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        {(["zone","aisle","bay","level","slot"] as const).map((dim) => (
          <select
            key={dim}
            value={locFilter[dim]}
            onChange={(e) => setLocFilter((f) => ({ ...f, [dim]: e.target.value }))}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 capitalize"
          >
            <option value="">All {dim}</option>
            {locOptions[dim].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        ))}
      </div>

      {/* Summary bar */}
      {!loading && filteredItems.length > 0 && (
        <div className="flex items-center gap-4 mb-5 bg-white border border-slate-100 rounded-xl px-5 py-3 text-sm shadow-sm">
          <Package className="w-4 h-4 text-slate-400" />
          <span className="text-slate-600">
            <b className="text-slate-900">{filteredItems.length.toLocaleString()}</b> items
          </span>
          <span className="text-slate-300">|</span>
          <span className="text-slate-600">
            Total qty <b className="text-slate-900">{totalQty.toLocaleString()}</b>
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-5">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Loading / Progress */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="relative w-14 h-14">
            <svg className="w-14 h-14 animate-spin" viewBox="0 0 56 56" fill="none">
              <circle cx="28" cy="28" r="24" stroke="#e2e8f0" strokeWidth="4" />
              <circle
                cx="28" cy="28" r="24"
                stroke="#3b82f6" strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${progress ? (progress.loaded / progress.total) * 150.8 : 40} 150.8`}
                strokeDashoffset="37.7"
              />
            </svg>
            {progress && (
              <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-slate-700">
                {Math.round((progress.loaded / progress.total) * 100)}%
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500">
            Loading inventory{progress ? ` (${Math.round((progress.loaded / progress.total) * 100)}%)` : ""}
          </p>
        </div>
      )}
      {/* Empty state */}
      {!loading && !error && filteredItems.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No inventory data</p>
          <p className="text-sm mt-1">
            {debugInfo.endpoint
              ? `Called: ${debugInfo.endpoint} (HTTP ${debugInfo.status})`
              : "Select a warehouse or check your search terms"}
          </p>
        </div>
      )}

      {/* ══════════════════════════════════════════
          Add Stock Modal
          ══════════════════════════════════════════ */}
      {adjustOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-blue-600" />
                <h2 className="text-base font-bold text-slate-900">New Stock Adjustment</h2>
              </div>
              <button onClick={() => setAdjustOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
            </div>

            <div className="px-6 py-5 space-y-5 max-h-[75vh] overflow-y-auto">
              {/* ── Stock Information ── */}
              <div>
                <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-3">Stock Information</p>
                <div className="grid grid-cols-2 gap-4">
                  {/* Warehouse */}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                      Warehouse <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={adjustForm.warehouseCode}
                      onChange={(e) => { const wh = warehouses.find((w) => w.id === e.target.value); setAdjustForm((f) => ({ ...f, warehouseCode: e.target.value, warehouseCd: wh?.cd ?? "", customerCode: "" })); }}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- Select --</option>
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name || w.id}</option>)}
                    </select>
                  </div>
                  {/* Customer */}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                      Customer <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={adjustForm.customerCode}
                      onChange={(e) => setAdjustForm((f) => ({ ...f, customerCode: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- Select --</option>
                      {customers.map((c) => <option key={c.code} value={c.code}>{c.name || c.code}</option>)}
                    </select>
                  </div>
                  {/* Location — searchable */}
                  <div ref={locWrapRef} className="relative">
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                      Location <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Type to search location..."
                        value={locSearch}
                        onChange={(e) => handleLocInput(e.target.value)}
                        onFocus={() => { if (locResults.length > 0) setLocDropOpen(true); }}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 pr-8 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                        autoComplete="off"
                      />
                      {locLoading && <Loader2 className="absolute right-2.5 top-2.5 w-4 h-4 animate-spin text-slate-400" />}
                      {!locLoading && locSearch && (
                        <button onClick={() => { setLocSearch(""); setAdjustForm((f) => ({ ...f, locationCode: "" })); setLocDropOpen(false); }}
                          className="absolute right-2.5 top-2.5 text-slate-300 hover:text-slate-600"><X className="w-4 h-4" /></button>
                      )}
                    </div>
                    {locDropOpen && locResults.length > 0 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
                        {locResults.map((loc, i) => {
                          const code = getLocCode(loc);
                          const parts = [
                            loc.zone ?? loc.zoneName,
                            loc.aisle ?? loc.aisleNo ?? loc.aisleName,
                            loc.bay   ?? loc.bayNo   ?? loc.bayName,
                            loc.level ?? loc.levelNo ?? loc.levelName,
                            loc.position ?? loc.positionNo ?? loc.positionName,
                          ].filter(Boolean).join("-");
                          return (
                            <button
                              key={i}
                              onMouseDown={(e) => { e.preventDefault(); selectLocation(loc); }}
                              className="w-full text-left px-3 py-2 text-sm font-mono hover:bg-blue-50 hover:text-blue-700 border-b border-slate-50 last:border-0 flex items-center justify-between"
                            >
                              <span className="font-semibold">{code}</span>
                              {parts && parts !== code && <span className="text-slate-400 text-xs">{parts}</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {/* Condition */}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                      Condition <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={adjustForm.condition}
                      onChange={(e) => setAdjustForm((f) => ({ ...f, condition: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {CONDITIONS.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                    </select>
                  </div>
                  {/* SKU */}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Product SKU</label>
                    <input
                      type="text"
                      placeholder="SKU"
                      value={adjustForm.sku}
                      onChange={(e) => setAdjustForm((f) => ({ ...f, sku: e.target.value }))}
                      onBlur={() => fetchCurrentQty(adjustForm)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  {/* Product Name */}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Product Name</label>
                    <input
                      type="text"
                      placeholder="Product name"
                      value={adjustForm.productName}
                      onChange={(e) => setAdjustForm((f) => ({ ...f, productName: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* ── Quantity & Detail ── */}
              <div>
                <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-3">Quantity &amp; Detail</p>
                <div className="grid grid-cols-3 gap-4">
                  {/* Current Qty */}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Current Qty</label>
                    <div className="relative">
                      <input
                        type="text"
                        readOnly
                        value={qtyFetching ? "..." : adjustForm.currentQty.toLocaleString()}
                        className="w-full border border-slate-100 rounded-lg px-3 py-2 text-sm bg-slate-50 text-slate-400 font-mono cursor-not-allowed"
                      />
                      {qtyFetching && <Loader2 className="absolute right-2.5 top-2.5 w-4 h-4 animate-spin text-slate-400" />}
                    </div>
                  </div>
                  {/* Adjust Qty */}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Adjust Qty</label>
                    <input
                      type="number"
                      placeholder="+/- qty"
                      value={adjustForm.adjustQty}
                      onChange={(e) => setAdjustForm((f) => ({ ...f, adjustQty: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  {/* After Qty */}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">After Qty</label>
                    <input
                      type="text"
                      readOnly
                      value={
                        adjustForm.adjustQty !== "" && !isNaN(Number(adjustForm.adjustQty))
                          ? (adjustForm.currentQty + Number(adjustForm.adjustQty)).toLocaleString()
                          : adjustForm.currentQty.toLocaleString()
                      }
                      className={`w-full border rounded-lg px-3 py-2 text-sm font-mono font-semibold cursor-not-allowed ${
                        adjustForm.adjustQty !== "" && !isNaN(Number(adjustForm.adjustQty))
                          ? Number(adjustForm.adjustQty) > 0
                            ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                            : "bg-red-50 border-red-200 text-red-700"
                          : "bg-slate-50 border-slate-100 text-slate-400"
                      }`}
                    />
                  </div>
                  {/* Lot No */}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Lot No</label>
                    <input
                      type="text"
                      placeholder="Lot number"
                      value={adjustForm.lotNo}
                      onChange={(e) => setAdjustForm((f) => ({ ...f, lotNo: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  {/* Expire Date */}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Expire Date</label>
                    <input
                      type="date"
                      value={adjustForm.expireDate}
                      onChange={(e) => setAdjustForm((f) => ({ ...f, expireDate: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  {/* Remark */}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Remark</label>
                    <input
                      type="text"
                      placeholder="Reason for adjustment"
                      value={adjustForm.remark}
                      onChange={(e) => setAdjustForm((f) => ({ ...f, remark: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Result banner */}
              {adjustResult && (
                <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${adjustResult.ok ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                  {adjustResult.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                  {adjustResult.msg}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/60">
              <button onClick={() => setAdjustOpen(false)} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors">Cancel</button>
              <button
                onClick={handleAdjustSubmit}
                disabled={adjustSubmitting || !adjustForm.warehouseCode || !adjustForm.customerCode || !adjustForm.locationCode || !adjustForm.condition}
                className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {adjustSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          Bulk Upload Modal
          ══════════════════════════════════════════ */}
      {batchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Upload className="w-5 h-5 text-emerald-600" />
                <h2 className="text-base font-bold text-slate-900">Bulk Stock Upload (Excel)</h2>
              </div>
              <button onClick={() => !batchRunning && setBatchOpen(false)} className="text-slate-400 hover:text-slate-700 disabled:opacity-40"><X className="w-5 h-5" /></button>
            </div>

            <div className="px-6 py-5 space-y-4 max-h-[75vh] overflow-y-auto">
              {/* Template hint + download */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700 space-y-1">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-semibold">Required Excel columns:</p>
                  <button
                    onClick={async () => {
                      const { utils, writeFile } = await import("xlsx");
                      const headers = [
                        "Customer Code",
                        "Warehouse",
                        "Location",
                        "Condition",
                        "SKU",
                        "Product Name",
                        "Adjust Qty",
                        "Lot No",
                        "Expire Date",
                        "Remark",
                      ];
                      const formatHints = [
                        "e.g. FCOKR (code, not name)",
                        "e.g. STOO1 (optional)",
                        "Zone-Aisle-Bay-Level-Pos  e.g. 01-31-23-01-01",
                        "GOOD / DMG / RTRN",
                        "Product SKU",
                        "Optional",
                        "+N to add, -N to remove",
                        "Optional",
                        "MM/DD/YYYY or YYYYMMDD",
                        "Optional reason",
                      ];
                      const sample = [
                        customers[0]?.code ?? "FCOKR",
                        warehouseCode || "STOO1",
                        "01-31-23-01-01",
                        "NOR",
                        "SKU-001",
                        "Sample Product",
                        10,
                        "",
                        "12/31/2027",
                        "Manual adjustment",
                      ];
                      const ws = utils.aoa_to_sheet([headers, formatHints, sample]);
                      ws["!cols"] = [16, 12, 28, 10, 18, 22, 12, 12, 16, 24].map((w) => ({ wch: w }));
                      // Row 1: header — yellow bold centered
                      headers.forEach((_, i) => {
                        const cell = utils.encode_cell({ r: 0, c: i });
                        if (!ws[cell]) return;
                        ws[cell].s = { font: { bold: true, sz: 11 }, fill: { fgColor: { rgb: "FFF3CD" } }, alignment: { horizontal: "center", wrapText: true } };
                      });
                      // Row 2: format hints — light blue italic
                      formatHints.forEach((_, i) => {
                        const cell = utils.encode_cell({ r: 1, c: i });
                        if (!ws[cell]) return;
                        ws[cell].s = { font: { italic: true, sz: 9, color: { rgb: "5B8DEF" } }, fill: { fgColor: { rgb: "EEF4FF" } } };
                      });
                      // Row 3: sample — normal
                      sample.forEach((_, i) => {
                        const cell = utils.encode_cell({ r: 2, c: i });
                        if (!ws[cell]) return;
                        ws[cell].s = { fill: { fgColor: { rgb: "F9FFF9" } } };
                      });
                      // Customers reference sheet
                      if (customers.length > 0) {
                        const custHeaders = [["Customer Code", "Customer Name"]];
                        const custRows = customers.map((c) => [c.code, c.name]);
                        const ws2 = utils.aoa_to_sheet([...custHeaders, ...custRows]);
                        ws2["!cols"] = [{ wch: 16 }, { wch: 28 }];
                        [0].forEach((r) => ["A","B"].forEach((col) => {
                          const cell = `${col}${r+1}`;
                          if (!ws2[cell]) return;
                          ws2[cell].s = { font: { bold: true }, fill: { fgColor: { rgb: "FFF3CD" } } };
                        }));
                        const wb = utils.book_new();
                        utils.book_append_sheet(wb, ws, "Bulk Stock Upload");
                        utils.book_append_sheet(wb, ws2, "Customer List");
                        writeFile(wb, "bulk_stock_upload_template.xlsx");
                      } else {
                        const wb = utils.book_new();
                        utils.book_append_sheet(wb, ws, "Bulk Stock Upload");
                        writeFile(wb, "bulk_stock_upload_template.xlsx");
                      }
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 text-white rounded-lg text-[11px] font-semibold hover:bg-blue-700 transition-colors"
                  >
                    <Download className="w-3 h-3" />
                    Download Template
                  </button>
                </div>
                <p className="font-mono">Customer Code · Warehouse · Location · Condition · SKU · Product Name · Adjust Qty · Lot No · Expire Date · Remark</p>
                <p className="text-blue-500 mt-1">• <b>Customer</b>: code (e.g. FCOKR), not name &nbsp;• <b>Location</b>: Zone-Aisle-Bay-Level-Pos (e.g. 01-31-23-01-01) &nbsp;• Warehouse optional &nbsp;• Expire Date: MM/DD/YYYY</p>
              </div>

              {/* File input */}
              {batchRows.length === 0 && (
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-xl p-10 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/30 transition-colors">
                  <Upload className="w-8 h-8 text-slate-300 mb-3" />
                  <span className="text-sm font-medium text-slate-500">Click to select .xlsx file</span>
                  <span className="text-xs text-slate-400 mt-1">Excel 2007+ (.xlsx)</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBatchFile(f); }}
                  />
                </label>
              )}

              {/* Preview table */}
              {batchRows.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-slate-700">{batchRows.length} rows parsed</p>
                    {!batchRunning && !batchDone && (
                      <button onClick={() => setBatchRows([])} className="text-xs text-slate-400 hover:text-slate-600 underline">Clear &amp; re-upload</button>
                    )}
                  </div>
                  <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-xs min-w-max">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-slate-500">Status</th>
                          <th className="px-3 py-2 text-left text-slate-500">Customer</th>
                          <th className="px-3 py-2 text-left text-slate-500">Warehouse</th>
                          <th className="px-3 py-2 text-left text-slate-500">Location</th>
                          <th className="px-3 py-2 text-left text-slate-500">Condition</th>
                          <th className="px-3 py-2 text-left text-slate-500">SKU</th>
                          <th className="px-3 py-2 text-right text-slate-500">Adj Qty</th>
                          <th className="px-3 py-2 text-left text-slate-500">Lot</th>
                          <th className="px-3 py-2 text-left text-slate-500">Expire</th>
                          <th className="px-3 py-2 text-left text-slate-500">Remark</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batchRows.map((row, i) => (
                          <tr key={i} className={`border-t border-slate-100 ${row._status === "ok" ? "bg-emerald-50" : row._status === "error" ? "bg-red-50" : ""}`}>
                            <td className="px-3 py-1.5 whitespace-nowrap">
                              {row._status === "ok"    && <span className="text-emerald-600 font-semibold">✓ OK</span>}
                              {row._status === "error" && <span className="text-red-600 font-semibold" title={row._msg}>✗ Err</span>}
                              {row._status === "pending" && <span className="text-slate-400">—</span>}
                            </td>
                            <td className="px-3 py-1.5 font-mono">{row.customerCode}</td>
                            <td className="px-3 py-1.5 font-mono">{row.warehouseCode}</td>
                            <td className="px-3 py-1.5 font-mono">{row.locationCode}</td>
                            <td className="px-3 py-1.5">{row.condition}</td>
                            <td className="px-3 py-1.5 font-mono">{row.sku}</td>
                            <td className={`px-3 py-1.5 text-right font-semibold ${Number(row.adjustQty) > 0 ? "text-emerald-600" : "text-red-600"}`}>{row.adjustQty}</td>
                            <td className="px-3 py-1.5 font-mono text-slate-400">{row.lotNo || "—"}</td>
                            <td className="px-3 py-1.5 font-mono text-slate-400">{row.expireDate || "—"}</td>
                            <td className="px-3 py-1.5 text-slate-500 max-w-xs truncate">{row.remark || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Batch result summary */}
                  {batchDone && (
                    <div className="flex items-center gap-3 mt-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                      <span className="text-emerald-700 font-semibold">{batchRows.filter((r) => r._status === "ok").length} succeeded</span>
                      {batchRows.filter((r) => r._status === "error").length > 0 && (
                        <span className="text-red-600 font-semibold">{batchRows.filter((r) => r._status === "error").length} failed</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/60">
              <button onClick={() => !batchRunning && setBatchOpen(false)} disabled={batchRunning} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-40">Close</button>
              {batchRows.length > 0 && !batchDone && (
                <button
                  onClick={runBatch}
                  disabled={batchRunning}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {batchRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {batchRunning ? `Processing...` : `Submit ${batchRows.length} rows`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Flat table */}
      {!loading && sortedItems.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">Location</th>
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">occupancyInfo</th>
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">Customer</th>
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">SKU</th>
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">Product Name</th>
                <th className="px-4 py-2.5 text-right text-slate-500 font-medium">Qty</th>
                <th className="px-4 py-2.5 text-right text-slate-500 font-medium">Available</th>
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">LOT</th>
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">Expiry Date</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item, idx) => {
                const loc = [item.zone, item.aisle, item.bay, item.level, item.position].join("-");
                return (
                  <tr key={`${item.locationId}-${item.sku}-${idx}`} className="hover:bg-slate-50 border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2.5 font-mono text-slate-600 whitespace-nowrap">{loc}</td>
                    <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{item.occupancyInfo || "-"}</td>
                    <td className="px-4 py-2.5 text-slate-500 font-mono">{item.customerCode || "-"}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono font-medium text-slate-900 bg-slate-100 px-2 py-0.5 rounded">{item.sku || "-"}</span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700 max-w-xs truncate">{item.productName || "-"}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-900">{item.qty.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{item.availableQty?.toLocaleString() ?? "-"}</td>
                    <td className="px-4 py-2.5 text-slate-400 font-mono">{item.lot || "-"}</td>
                    <td className="px-4 py-2.5 text-slate-400 font-mono">
                      {item.expireDate?.length === 8
                        ? `${item.expireDate.slice(4,6)}-${item.expireDate.slice(6,8)}-${item.expireDate.slice(0,4)}`
                        : item.expireDate || "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}
