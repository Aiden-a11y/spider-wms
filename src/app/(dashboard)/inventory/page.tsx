"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/auth-context";
import {
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
} from "lucide-react";

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

  const saveSnapshot = useCallback(async (whCode: string, allItems: InventoryItem[]) => {
    if (!supabase || allItems.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const cacheKey = `snapshot_saved__${whCode}__${today}`;
    if (sessionStorage.getItem(cacheKey)) return;

    // 오늘 이미 저장된 행 삭제 후 재삽입 (중복 방지)
    await supabase
      .from("inventory_history")
      .delete()
      .eq("captured_date", today)
      .eq("warehouse_code", whCode);

    const rows = allItems.map((item) => ({
      captured_date: today,
      warehouse_code: whCode,
      customer_code: item.customerCode ?? null,
      location: [item.zone, item.aisle, item.bay, item.level, item.position].join("-"),
      sku: item.sku,
      product_name: item.productName,
      qty: item.qty,
      available_qty: item.availableQty ?? null,
      lot: item.lot ?? null,
      expire_date: item.expireDate ?? null,
    }));

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("inventory_history").insert(rows.slice(i, i + 500));
      if (error) return;
    }
    sessionStorage.setItem(cacheKey, "1");
  }, []);

  async function loadInventory() {
    await loadInventoryWith(warehouseCode, customerCode, customers);
  }

  async function downloadExcel() {
    const { utils, writeFile } = await import("xlsx");
    const rows = sortedItems.map((item) => ({
      Location: [item.zone, item.aisle, item.bay, item.level, item.position].join("-"),
      SKU: item.sku,
      상품명: item.productName,
      재고: item.qty,
      가용: item.availableQty ?? "",
      LOT: item.lot ?? "",
      유통기한: item.expireDate?.length === 8
        ? `${item.expireDate.slice(4,6)}-${item.expireDate.slice(6,8)}-${item.expireDate.slice(0,4)}`
        : item.expireDate ?? "",
    }));
    const ws = utils.json_to_sheet(rows);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "재고현황");
    const date = new Date().toISOString().slice(0,10);
    writeFile(wb, `재고현황_${warehouseCode}_${date}.xlsx`);
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
        setError("고객사 정보가 없습니다.");
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
          const skuRes = await fetch(`/api/wms/product/list`, {
            method: "POST",
            headers,
            body: JSON.stringify({ warehouseCode: whCode, customerCode: cust.code }),
          });
          const skuJson = await skuRes.json();
          skus = ((skuJson.data?.list ?? []) as Record<string, unknown>[])
            .map((p) => String(p.productSku ?? ""))
            .filter(Boolean);
          try { sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), skus })); } catch { /* ignore */ }
        }

        skus.forEach((sku) => pairs.push({ custCode: cust.code, sku }));
      }

      if (pairs.length === 0) {
        setError("등록된 상품이 없습니다.");
        setLoading(false);
        return;
      }

      setProgress({ total: pairs.length, loaded: 0 });

      // Step 2: fetch all pairs concurrently, update progress per SKU
      const allItems: ReturnType<typeof normalizeInventory> = [];
      let loaded = 0;
      await Promise.all(
        pairs.map(({ custCode: cc, sku }) =>
          fetch(`/api/wms/inventory/detail`, {
            method: "POST",
            headers,
            body: JSON.stringify({ warehouseCode: whCode, customerCode: cc, productSku: sku }),
          })
            .then((r) => r.json())
            .then((j) => normalizeInventory(j))
            .catch(() => [])
            .then((rows) => {
              allItems.push(...rows);
              loaded += 1;
              setProgress({ total: pairs.length, loaded });
            })
        )
      );

      setDebugInfo((d) => ({
        ...d,
        inventoryRaw: { totalSkus: pairs.length, totalItems: allItems.length },
        endpoint: `POST /product/list → POST /inventory/detail ×${pairs.length}`,
        status: 200,
      }));

      setItems(allItems);
      saveSnapshot(whCode, allItems);
    } catch (e) {
      setError(`요청 실패: ${String(e)}`);
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

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">재고 현황</h1>
        </div>
        <button
          onClick={loadInventory}
          disabled={loading}
          className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          새로고침
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

      {/* Controls — row 1: warehouse / customer / search */}
      <div className="flex flex-wrap gap-3 mb-2">
        <select
          value={warehouseCode}
          onChange={(e) => selectWarehouse(e.target.value)}
          disabled={warehouses.length === 0}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
        >
          {warehouses.length === 0 && <option value="">창고 로딩 중...</option>}
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
            <option value="ALL">전체 고객사</option>
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
            placeholder="SKU, 상품명, LOT 검색..."
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
            <option value="">전체 {dim}</option>
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
            <b className="text-slate-900">{filteredItems.length.toLocaleString()}</b> 건
          </span>
          <span className="text-slate-300">|</span>
          <span className="text-slate-600">
            총 재고 <b className="text-slate-900">{totalQty.toLocaleString()}</b> 개
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
            재고 조회중{progress ? ` (${Math.round((progress.loaded / progress.total) * 100)}%)` : ""}
          </p>
        </div>
      )}
      {/* Empty state */}
      {!loading && !error && filteredItems.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">재고 데이터가 없습니다</p>
          <p className="text-sm mt-1">
            {debugInfo.endpoint
              ? `호출: ${debugInfo.endpoint} (HTTP ${debugInfo.status})`
              : "창고를 선택하거나 검색어를 확인하세요"}
          </p>
        </div>
      )}

      {/* Flat table */}
      {!loading && sortedItems.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">Location</th>
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">SKU</th>
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">상품명</th>
                <th className="px-4 py-2.5 text-right text-slate-500 font-medium">재고</th>
                <th className="px-4 py-2.5 text-right text-slate-500 font-medium">가용</th>
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">LOT</th>
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">유통기한</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item, idx) => {
                const loc = [item.zone, item.aisle, item.bay, item.level, item.position].join("-");
                return (
                  <tr key={`${item.locationId}-${item.sku}-${idx}`} className="hover:bg-slate-50 border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2.5 font-mono text-slate-600 whitespace-nowrap">{loc}</td>
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
