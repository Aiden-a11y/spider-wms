"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Search, RefreshCw, Package, Download, X, BoxIcon, Check, AlertCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface Customer  { code: string; name: string; }
interface Warehouse { id: string; name: string; }
interface Product   { [key: string]: unknown; }

export interface UomRow {
  sku:              string;
  customer_code:    string;
  units_per_carton: number | null;
  inner_pack_qty:   number | null;
  pallet_qty:       number | null;
  notes:            string | null;
}

export default function ProductsPage() {
  const { user } = useAuth();
  const [warehouses,    setWarehouses]    = useState<Warehouse[]>([]);
  const [warehouseCode, setWarehouseCode] = useState("");
  const [customers,     setCustomers]     = useState<Customer[]>([]);
  const [customerCode,  setCustomerCode]  = useState("ALL");
  const [products,      setProducts]      = useState<Product[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [progress,      setProgress]      = useState<{ loaded: number; total: number } | null>(null);
  const [error,         setError]         = useState("");
  const [search,        setSearch]        = useState("");

  /* ── UOM state ── */
  const [uomData,    setUomData]    = useState<Record<string, UomRow>>({}); // key: `${sku}__${custCode}`
  const [uomModal,   setUomModal]   = useState<Product | null>(null);
  const [uomEdit,    setUomEdit]    = useState<Partial<UomRow>>({});
  const [uomSaving,  setUomSaving]  = useState(false);
  const [uomMsg,     setUomMsg]     = useState<{ text: string; ok: boolean } | null>(null);

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  function parseArr(json: unknown): Record<string, unknown>[] {
    const j = json as Record<string, unknown>;
    return Array.isArray(j?.data) ? j.data : Array.isArray(json) ? (json as Record<string, unknown>[]) : [];
  }

  /* ── Load UOM from Supabase ── */
  async function loadUomData(prods: Product[]) {
    if (!supabase || prods.length === 0) return;
    const skuRecord: Record<string, boolean> = {};
    prods.forEach((p) => {
      const s = String(p.productSku ?? p.sku ?? "");
      if (s) skuRecord[s] = true;
    });
    const uniqueSkus = Object.keys(skuRecord);
    if (uniqueSkus.length === 0) return;
    try {
      const { data } = await supabase.from("product_uom").select("*").in("sku", uniqueSkus);
      if (data) {
        const map: Record<string, UomRow> = {};
        data.forEach((r: UomRow) => { map[`${r.sku}__${r.customer_code}`] = r; });
        setUomData(map);
      }
    } catch { /* ignore */ }
  }

  /* ── Open UOM edit modal ── */
  function openUomModal(product: Product, e: React.MouseEvent) {
    e.stopPropagation();
    const sku      = String(product.productSku ?? product.sku ?? "");
    const custCode = String(product._customerCode ?? product.customerCode ?? "");
    const existing = uomData[`${sku}__${custCode}`];
    setUomModal(product);
    setUomEdit({
      units_per_carton: existing?.units_per_carton ?? undefined,
      inner_pack_qty:   existing?.inner_pack_qty   ?? undefined,
      pallet_qty:       existing?.pallet_qty        ?? undefined,
      notes:            existing?.notes             ?? "",
    });
    setUomMsg(null);
  }

  /* ── Save UOM ── */
  async function saveUom() {
    if (!supabase || !uomModal) return;
    setUomSaving(true);
    setUomMsg(null);

    const sku      = String(uomModal.productSku ?? uomModal.sku ?? "");
    const custCode = String(uomModal._customerCode ?? uomModal.customerCode ?? "");

    try {
      const { error: dbErr } = await supabase
        .from("product_uom")
        .upsert(
          {
            sku,
            customer_code:    custCode,
            units_per_carton: uomEdit.units_per_carton || null,
            inner_pack_qty:   uomEdit.inner_pack_qty   || null,
            pallet_qty:       uomEdit.pallet_qty        || null,
            notes:            uomEdit.notes             || null,
          },
          { onConflict: "sku,customer_code" }
        );
      if (dbErr) throw dbErr;

      // Update local cache
      setUomData((prev) => ({
        ...prev,
        [`${sku}__${custCode}`]: {
          sku, customer_code: custCode,
          units_per_carton: uomEdit.units_per_carton ?? null,
          inner_pack_qty:   uomEdit.inner_pack_qty   ?? null,
          pallet_qty:       uomEdit.pallet_qty        ?? null,
          notes:            uomEdit.notes             ?? null,
        },
      }));
      setUomMsg({ text: "Saved successfully!", ok: true });
    } catch (e) {
      setUomMsg({ text: `Save failed: ${String(e)}`, ok: false });
    }
    setUomSaving(false);
  }

  /* ── Warehouse load ── */
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
          loadCustomers(preferred.id);
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line

  async function loadCustomers(whCode: string) {
    setWarehouseCode(whCode);
    setCustomers([]);
    setCustomerCode("ALL");
    setProducts([]);

    // Try multiple endpoints to get the widest customer list
    const endpoints = [
      `/api/wms/combo/customer-by-warehouse/${whCode}`,
      `/api/wms/combo/customer-by-ordertype/B2B?warehouseCode=${whCode}`,
      `/api/wms/combo/customer-by-ordertype/B2C?warehouseCode=${whCode}`,
      `/api/wms/combo/customer?warehouseCode=${whCode}`,
      `/api/wms/combo/customer`,
    ];

    const custMap: Record<string, Customer> = {};
    for (const ep of endpoints) {
      try {
        const r    = await fetch(ep, { headers });
        const json = await r.json();
        parseArr(json).forEach((c) => {
          const code = String(c.code ?? c.customerCode ?? "");
          const name = String(c.name ?? c.customerName ?? code ?? "");
          if (code && !custMap[code]) custMap[code] = { code, name };
        });
      } catch { /* try next */ }
    }

    const list = Object.values(custMap);
    console.log("[Products] customers loaded:", list.map((c) => c.code).join(", "));
    setCustomers(list);
    await fetchProducts(whCode, "ALL", list);
  }

  /* ── Fetch all pages for one customer ── */
  async function fetchAllPages(whCode: string, custCode: string): Promise<{ items: Record<string, unknown>[]; total: number }> {
    const PAGE_SIZE = 100;
    const items: Record<string, unknown>[] = [];
    let page  = 1;
    let total = 0;

    while (true) {
      const body = {
        warehouseCode: whCode,
        customerCode:  custCode,
        page,
        pageNum:  page,
        size:     PAGE_SIZE,
        pageSize: PAGE_SIZE,
        limit:    PAGE_SIZE,
      };
      const res  = await fetch("/api/wms/product/list", { method: "POST", headers, body: JSON.stringify(body) });
      const json = await res.json() as Record<string, unknown>;

      // Parse total (various field names WMS might use)
      const data = (json?.data as Record<string, unknown>) ?? {};
      if (total === 0) {
        total = Number(data?.total ?? data?.totalCount ?? data?.totalElements ?? json?.total ?? 0);
      }

      // Parse item list
      const batch: Record<string, unknown>[] =
        Array.isArray(data?.list)  ? (data.list as Record<string, unknown>[]) :
        Array.isArray(data?.items) ? (data.items as Record<string, unknown>[]) :
        Array.isArray(json?.data)  ? (json.data as Record<string, unknown>[]) :
        Array.isArray(json?.list)  ? (json.list as Record<string, unknown>[]) :
        [];

      items.push(...batch);

      // Stop when: got all items, or response returned fewer than PAGE_SIZE (last page), or empty
      if (batch.length === 0 || batch.length < PAGE_SIZE || (total > 0 && items.length >= total)) break;
      page++;
      if (page > 50) break; // safety cap
    }

    return { items, total };
  }

  const fetchProducts = useCallback(async (whCode: string, custCode: string, custList: Customer[]) => {
    setLoading(true);
    setError("");
    setProducts([]);
    setProgress(null);
    try {
      const targets = custCode === "ALL" ? custList : custList.filter((c) => c.code === custCode);
      setProgress({ loaded: 0, total: targets.length });
      const allProducts: Product[] = [];
      const debugLines: string[] = [];

      for (let i = 0; i < targets.length; i++) {
        const cust = targets[i];
        const { items, total } = await fetchAllPages(whCode, cust.code);
        items.forEach((p) => allProducts.push({ ...p, _customerCode: cust.code, _customerName: cust.name }));
        debugLines.push(`${cust.code}: fetched ${items.length}${total > 0 ? ` / ${total}` : ""}`);
        setProgress({ loaded: i + 1, total: targets.length });
      }

      // Log fetch summary to console for debugging
      console.log("[Products] fetch summary:\n" + debugLines.join("\n"));
      console.log(`[Products] total loaded: ${allProducts.length}`);

      setProducts(allProducts);
      await loadUomData(allProducts);
    } catch (e) {
      setError(`Request failed: ${String(e)}`);
    }
    setProgress(null);
    setLoading(false);
  }, [headers]); // eslint-disable-line

  const cols = useMemo(() => {
    if (products.length === 0) return [];
    const keys = Object.keys(products[0]).filter((k) => !k.startsWith("_"));
    return keys.slice(0, 10);
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      Object.values(p).some((v) => String(v ?? "").toLowerCase().includes(q))
    );
  }, [products, search]);

  async function downloadExcel() {
    const { utils, writeFile } = await import("xlsx");
    const ws = utils.json_to_sheet(filtered.map((p) => {
      const sku      = String(p.productSku ?? p.sku ?? "");
      const custCode = String(p._customerCode ?? "");
      const uom      = uomData[`${sku}__${custCode}`];
      const row: Record<string, unknown> = {};
      if (customers.length > 1) row["Customer"] = String(p._customerName ?? p._customerCode ?? "");
      cols.forEach((c) => { row[c] = p[c] ?? ""; });
      row["UPC (ea/ctn)"] = uom?.units_per_carton ?? "";
      row["Inner Pack"]   = uom?.inner_pack_qty   ?? "";
      row["Pallet (ctn)"] = uom?.pallet_qty        ?? "";
      return row;
    }));
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Products");
    writeFile(wb, `products_${warehouseCode}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  /* ── UOM preview calc ── */
  const upc = Number(uomEdit.units_per_carton) || 0;
  const ipq = Number(uomEdit.inner_pack_qty)   || 0;
  const plq = Number(uomEdit.pallet_qty)        || 0;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-900">Products</h1>
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
          onChange={(e) => loadCustomers(e.target.value)}
          disabled={warehouses.length === 0}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
        >
          {warehouses.length === 0 && <option value="">Loading...</option>}
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name || w.id}</option>)}
        </select>

        {customers.length > 0 && (
          <select
            value={customerCode}
            onChange={(e) => { setCustomerCode(e.target.value); fetchProducts(warehouseCode, e.target.value, customers); }}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Customers</option>
            {customers.map((c) => <option key={c.code} value={c.code}>{c.name || c.code}</option>)}
          </select>
        )}

        <button
          onClick={() => fetchProducts(warehouseCode, customerCode, customers)}
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
            placeholder="Search SKU, product name..."
            className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-5">
          {error}
        </div>
      )}

      {!loading && products.length > 0 && (
        <div className="flex items-center gap-4 mb-5 bg-white border border-slate-100 rounded-xl px-5 py-3 text-sm shadow-sm">
          <Package className="w-4 h-4 text-slate-400" />
          <span className="text-slate-600">
            <b className="text-slate-900">{filtered.length.toLocaleString()}</b> products
          </span>
          {supabase && (
            <span className="ml-auto text-xs text-slate-400 flex items-center gap-1.5">
              <BoxIcon className="w-3.5 h-3.5" />
              Click any row to set UOM (carton qty)
            </span>
          )}
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="relative w-14 h-14">
            <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56" fill="none">
              <circle cx="28" cy="28" r="24" stroke="#e2e8f0" strokeWidth="4" />
              <circle cx="28" cy="28" r="24" stroke="#3b82f6" strokeWidth="4" strokeLinecap="round"
                strokeDasharray={`${progress && progress.total > 0 ? (progress.loaded / progress.total) * 150.8 : 40} 150.8`}
                strokeDashoffset="0" className="transition-all duration-300" />
            </svg>
            {progress && progress.total > 0 && (
              <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-slate-700">
                {Math.round((progress.loaded / progress.total) * 100)}%
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500">
            Loading products{progress && progress.total > 0 ? ` (${Math.round((progress.loaded / progress.total) * 100)}%)` : ""}
          </p>
        </div>
      )}

      {!loading && !error && products.length === 0 && (
        <div className="text-center py-20 text-slate-400">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No products found</p>
        </div>
      )}

      {/* ── Table ── */}
      {!loading && filtered.length > 0 && cols.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {customers.length > 1 && (
                    <th className="px-4 py-2.5 text-left text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">Customer</th>
                  )}
                  {cols.map((c) => (
                    <th key={c} className="px-4 py-2.5 text-left text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">{c}</th>
                  ))}
                  <th className="px-4 py-2.5 text-center text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">
                    <span className="flex items-center justify-center gap-1">
                      <BoxIcon className="w-3.5 h-3.5" /> UOM
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, idx) => {
                  const sku      = String(p.productSku ?? p.sku ?? "");
                  const custCode = String(p._customerCode ?? p.customerCode ?? "");
                  const uom      = uomData[`${sku}__${custCode}`];
                  const hasUom   = !!uom?.units_per_carton;
                  return (
                    <tr key={idx}
                      onClick={(e) => openUomModal(p, e)}
                      className="hover:bg-blue-50 border-b border-slate-100 last:border-0 cursor-pointer group transition-colors"
                    >
                      {customers.length > 1 && (
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
                          {String(p._customerName ?? p._customerCode ?? "")}
                        </td>
                      )}
                      {cols.map((c) => (
                        <td key={c} className="px-4 py-2.5 text-slate-700 whitespace-nowrap max-w-xs truncate">
                          {c.toLowerCase().includes("sku") || c.toLowerCase().includes("code") || c.toLowerCase().includes("upc") ? (
                            <span className="font-mono font-medium text-slate-900 bg-slate-100 group-hover:bg-blue-100 px-2 py-0.5 rounded transition-colors">
                              {String(p[c] ?? "-")}
                            </span>
                          ) : String(p[c] ?? "-")}
                        </td>
                      ))}
                      {/* UOM cell */}
                      <td className="px-4 py-2.5 text-center">
                        {hasUom ? (
                          <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2.5 py-1 font-semibold whitespace-nowrap">
                            <BoxIcon className="w-3 h-3" />
                            {uom!.units_per_carton} ea/ctn
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-full px-2.5 py-1 border border-dashed border-slate-300 hover:border-blue-300 transition-colors">
                            + Set UOM
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── UOM Edit Modal ── */}
      {uomModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/40" onClick={() => setUomModal(null)} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-emerald-600 rounded-lg flex items-center justify-center">
                  <BoxIcon className="w-3.5 h-3.5 text-white" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-800">Set UOM</p>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">
                    {String(uomModal.productSku ?? uomModal.sku ?? "")}
                  </p>
                </div>
              </div>
              <button onClick={() => setUomModal(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Product name */}
            <div className="px-5 pt-4 pb-2">
              <p className="text-xs text-slate-500 mb-0.5">Product</p>
              <p className="text-sm font-semibold text-slate-800 truncate">
                {String(uomModal.productName ?? uomModal.productShortName ?? "—")}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                Customer: {String(uomModal._customerName ?? uomModal._customerCode ?? "—")}
              </p>
            </div>

            {/* Form */}
            <div className="px-5 pb-3 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">
                    ea / CTN <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={uomEdit.units_per_carton ?? ""}
                    onChange={(e) => setUomEdit((p) => ({ ...p, units_per_carton: e.target.value ? Number(e.target.value) : undefined }))}
                    placeholder="e.g. 24"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 text-right tabular-nums font-semibold"
                  />
                  <p className="text-xs text-slate-400 mt-1 text-center">Units/Carton</p>
                </div>
                <div className="col-span-1">
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">Inner Pack</label>
                  <input
                    type="number"
                    min={1}
                    value={uomEdit.inner_pack_qty ?? ""}
                    onChange={(e) => setUomEdit((p) => ({ ...p, inner_pack_qty: e.target.value ? Number(e.target.value) : undefined }))}
                    placeholder="—"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 text-right tabular-nums"
                  />
                  <p className="text-xs text-slate-400 mt-1 text-center">ea / Inner</p>
                </div>
                <div className="col-span-1">
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">CTN / Pallet</label>
                  <input
                    type="number"
                    min={1}
                    value={uomEdit.pallet_qty ?? ""}
                    onChange={(e) => setUomEdit((p) => ({ ...p, pallet_qty: e.target.value ? Number(e.target.value) : undefined }))}
                    placeholder="—"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 text-right tabular-nums"
                  />
                  <p className="text-xs text-slate-400 mt-1 text-center">Cartons/Pallet</p>
                </div>
              </div>

              {/* Preview */}
              {upc > 0 && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-xs space-y-1">
                  <p className="font-bold text-emerald-700 text-xs uppercase tracking-wide mb-1.5">Preview</p>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">1 Carton</span>
                    <span className="font-bold text-slate-800">{upc.toLocaleString()} EA</span>
                  </div>
                  {ipq > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">1 Inner Pack</span>
                      <span className="font-bold text-slate-800">{ipq.toLocaleString()} EA</span>
                    </div>
                  )}
                  {plq > 0 && (
                    <div className="flex items-center justify-between border-t border-emerald-200 pt-1 mt-1">
                      <span className="text-slate-500">1 Pallet</span>
                      <span className="font-bold text-emerald-700">
                        {plq} CTN = {(plq * upc).toLocaleString()} EA
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-slate-500 mb-1 block">Notes</label>
                <input
                  type="text"
                  value={uomEdit.notes ?? ""}
                  onChange={(e) => setUomEdit((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Optional memo..."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
            </div>

            {/* Save message */}
            {uomMsg && (
              <div className={`mx-5 mb-3 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${uomMsg.ok ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-red-50 text-red-700 border border-red-100"}`}>
                {uomMsg.ok ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                {uomMsg.text}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 px-5 pb-5">
              <button
                onClick={() => setUomModal(null)}
                className="flex-1 text-sm border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl py-2.5 font-medium transition-colors"
              >
                Close
              </button>
              <button
                onClick={saveUom}
                disabled={uomSaving || !uomEdit.units_per_carton}
                className="flex-1 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white rounded-xl py-2.5 font-semibold transition-colors flex items-center justify-center gap-1.5"
              >
                {uomSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {uomSaving ? "Saving…" : "Save UOM"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
