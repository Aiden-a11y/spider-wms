"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import {
  Search, RefreshCw, Package, Download, X, BoxIcon, Check,
  AlertCircle,
} from "lucide-react";

/* ── Types ── */
interface ProductMaster {
  sku:                string;
  customer_code:      string;
  customer_name:      string;
  product_name:       string;
  product_short_name: string;
  barcode:            string;
  category_first:     string;
  category_second:    string;
  unit_type:          string;
  weight:             number | null;
  status:             string;
  item_store_comment: string;
  description:        string;
}

export interface UomRow {
  sku:              string;
  customer_code:    string;
  units_per_carton: number | null;
  inner_pack_qty:   number | null;
  pallet_qty:       number | null;
  notes:            string | null;
}

/* ── helpers ── */
function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function ProductsPage() {
  const { user } = useAuth();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  /* ── core state ── */
  const [allProducts,  setAllProducts]  = useState<ProductMaster[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [customerCode, setCustomerCode] = useState("ALL");
  const [search,       setSearch]       = useState("");
  const [error,        setError]        = useState("");

  /* ── UOM state ── */
  const [uomData,   setUomData]   = useState<Record<string, UomRow>>({});
  const [uomModal,  setUomModal]  = useState<ProductMaster | null>(null);
  const [uomEdit,   setUomEdit]   = useState<Partial<UomRow>>({});
  const [uomSaving, setUomSaving] = useState(false);
  const [uomMsg,    setUomMsg]    = useState<{ text: string; ok: boolean } | null>(null);

  /* ── derived ── */
  const customers = useMemo(() => {
    const map: Record<string, string> = {};
    allProducts.forEach((p) => { if (p.customer_code) map[p.customer_code] = p.customer_name || p.customer_code; });
    return Object.entries(map).map(([code, name]) => ({ code, name }));
  }, [allProducts]);

  const filtered = useMemo(() => {
    let list = customerCode === "ALL" ? allProducts : allProducts.filter((p) => p.customer_code === customerCode);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((p) =>
        p.sku.toLowerCase().includes(q) ||
        p.product_name.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        p.category_first.toLowerCase().includes(q)
      );
    }
    return list;
  }, [allProducts, customerCode, search]);

  /* ── Load products directly from WMS API ── */
  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // 1. Get all warehouses
      const whRes = await fetch("/api/wms/combo/warehouse", { headers });
      const whJson = await whRes.json();
      const warehouses: { id: string }[] = (Array.isArray(whJson?.data) ? whJson.data : Array.isArray(whJson) ? whJson : [])
        .map((w: Record<string, unknown>) => ({ id: String(w.code ?? w.id ?? "") }))
        .filter((w: { id: string }) => w.id);
      if (warehouses.length === 0) throw new Error("No warehouses found");

      // 2. Collect customers from ALL endpoints (same as previous sync logic)
      const custMap: Record<string, { code: string; name: string }> = {};
      const parseCustomers = (json: unknown) => {
        const arr = Array.isArray((json as Record<string,unknown>)?.data)
          ? ((json as Record<string,unknown>).data as Record<string,unknown>[])
          : Array.isArray(json) ? (json as Record<string,unknown>[]) : [];
        arr.forEach((c) => {
          const code = String(c.code ?? c.customerCode ?? "");
          const name = String(c.name ?? c.customerName ?? code);
          if (code && !custMap[code]) custMap[code] = { code, name };
        });
      };

      const custEndpoints: string[] = [];
      for (const wh of warehouses) {
        custEndpoints.push(
          `/api/wms/combo/customer-by-warehouse/${wh.id}`,
          `/api/wms/combo/customer-by-ordertype/B2B?warehouseCode=${wh.id}`,
          `/api/wms/combo/customer-by-ordertype/B2C?warehouseCode=${wh.id}`,
        );
      }
      custEndpoints.push("/api/wms/combo/customer");

      await Promise.all(custEndpoints.map(ep =>
        fetch(ep, { headers }).then(r => r.json()).then(parseCustomers).catch(() => {})
      ));

      const customers = Object.values(custMap);
      if (customers.length === 0) throw new Error("No customers found");

      // 3. Fetch products per customer across all warehouses (paginated)
      const all: ProductMaster[] = [];
      const whCode = warehouses[0].id;   // product list only needs one warehouse code

      for (const cust of customers) {
        let page = 1;
        while (true) {
          const res = await fetch("/api/wms/product/list", {
            method: "POST", headers,
            body: JSON.stringify({ warehouseCode: whCode, customerCode: cust.code, page, pageNum: page, pageSize: 500, size: 500 }),
          });
          const json = await res.json() as Record<string, unknown>;
          const data = (json?.data as Record<string, unknown>) ?? {};
          const items: Record<string, unknown>[] =
            Array.isArray(data?.list)  ? (data.list  as Record<string, unknown>[]) :
            Array.isArray(data?.items) ? (data.items as Record<string, unknown>[]) :
            Array.isArray(json?.data)  ? (json.data  as Record<string, unknown>[]) : [];
          if (items.length === 0) break;
          items.forEach((p) => all.push({
            sku:                String(p.productSku ?? p.sku ?? ""),
            customer_code:      cust.code,
            customer_name:      cust.name,
            product_name:       String(p.productName      ?? ""),
            product_short_name: String(p.productShortName ?? ""),
            barcode:            String(p.barcode ?? p.upcCode ?? ""),
            category_first:     String(p.categoryFirst  ?? p.category ?? ""),
            category_second:    String(p.categorySecond ?? ""),
            unit_type:          String(p.unitType ?? p.uom ?? ""),
            weight:             Number(p.weight  ?? 0) || null,
            status:             String(p.status  ?? p.useYn ?? "Active"),
            item_store_comment: String(p.itemStoreComment ?? ""),
            description:        String(p.description ?? ""),
          }));
          const total = Number(data?.total ?? data?.totalCount ?? 0);
          if (items.length < 500 || (total > 0 && all.filter(x => x.customer_code === cust.code).length >= total)) break;
          page++;
          if (page > 20) break;
        }
      }
      setAllProducts(all.filter(p => p.sku));

      // 4. Load UOM from Supabase (only dashboard-specific data)
      const skus = all.map(p => p.sku).filter(Boolean);
      if (skus.length > 0) {
        try {
          const uomRes = await fetch("/api/products/uom-list", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ skus }),
          });
          if (uomRes.ok) {
            const uomJson = await uomRes.json();
            const map: Record<string, UomRow> = {};
            (uomJson.data as UomRow[] ?? []).forEach((r) => { map[`${r.sku}__${r.customer_code}`] = r; });
            setUomData(map);
          }
        } catch { /* UOM is optional */ }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, [headers]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  /* ── UOM ── */
  function openUomModal(product: ProductMaster, e: React.MouseEvent) {
    e.stopPropagation();
    const key      = `${product.sku}__${product.customer_code}`;
    const existing = uomData[key];
    setUomModal(product);
    setUomEdit({
      units_per_carton: existing?.units_per_carton ?? undefined,
      inner_pack_qty:   existing?.inner_pack_qty   ?? undefined,
      pallet_qty:       existing?.pallet_qty        ?? undefined,
      notes:            existing?.notes             ?? "",
    });
    setUomMsg(null);
  }

  async function saveUom() {
    if (!uomModal) return;
    setUomSaving(true);
    setUomMsg(null);
    try {
      const res = await fetch("/api/products/uom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku:              uomModal.sku,
          customer_code:    uomModal.customer_code,
          units_per_carton: uomEdit.units_per_carton || null,
          inner_pack_qty:   uomEdit.inner_pack_qty   || null,
          pallet_qty:       uomEdit.pallet_qty        || null,
          notes:            uomEdit.notes             || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      const key = `${uomModal.sku}__${uomModal.customer_code}`;
      setUomData((prev) => ({
        ...prev,
        [key]: {
          sku:              uomModal.sku,
          customer_code:    uomModal.customer_code,
          units_per_carton: uomEdit.units_per_carton ?? null,
          inner_pack_qty:   uomEdit.inner_pack_qty   ?? null,
          pallet_qty:       uomEdit.pallet_qty        ?? null,
          notes:            uomEdit.notes             ?? null,
        },
      }));
      setUomMsg({ text: "Saved!", ok: true });
    } catch (e) {
      setUomMsg({ text: `Failed: ${e instanceof Error ? e.message : String(e)}`, ok: false });
    }
    setUomSaving(false);
  }

  /* ── Excel export ── */
  async function downloadExcel() {
    const { utils, writeFile } = await import("xlsx");
    const ws = utils.json_to_sheet(filtered.map((p) => {
      const uom = uomData[`${p.sku}__${p.customer_code}`];
      return {
        SKU:            p.sku,
        "Product Name": p.product_name,
        Customer:       p.customer_name || p.customer_code,
        Barcode:        p.barcode,
        Category:       p.category_first,
        Unit:           p.unit_type,
        Status:         p.status,
        "ea/CTN":       uom?.units_per_carton ?? "",
        "Inner Pack":   uom?.inner_pack_qty   ?? "",
        "CTN/Pallet":   uom?.pallet_qty        ?? "",
      };
    }));
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Products");
    writeFile(wb, `product_master_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  /* ── UOM preview ── */
  const upc = Number(uomEdit.units_per_carton) || 0;
  const ipq = Number(uomEdit.inner_pack_qty)   || 0;
  const plq = Number(uomEdit.pallet_qty)        || 0;

  /* ════════════════════════════ RENDER ════════════════════════════ */
  return (
    <div className="p-8">
      {/* Header */}
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
        {customers.length > 0 && (
          <select
            value={customerCode}
            onChange={(e) => setCustomerCode(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Customers</option>
            {customers.map((c) => <option key={c.code} value={c.code}>{c.name || c.code}</option>)}
          </select>
        )}

        <button
          onClick={loadProducts}
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
            placeholder="Search SKU, product name, barcode..."
            className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-5">
          {error}
        </div>
      )}

      {/* Stats bar */}
      {!loading && allProducts.length > 0 && (
        <div className="flex items-center gap-4 mb-5 bg-white border border-slate-100 rounded-xl px-5 py-3 text-sm shadow-sm">
          <Package className="w-4 h-4 text-slate-400" />
          <span className="text-slate-600">
            <b className="text-slate-900">{filtered.length.toLocaleString()}</b> products
            {filtered.length !== allProducts.length && (
              <span className="text-slate-400"> of {allProducts.length.toLocaleString()}</span>
            )}
          </span>
          <span className="ml-auto text-xs text-slate-400 flex items-center gap-1.5">
            <BoxIcon className="w-3.5 h-3.5" />
            Click any row to set UOM (carton qty)
          </span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="text-sm text-slate-500">Loading products…</p>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && allProducts.length === 0 && (
        <div className="text-center py-20 text-slate-400">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium mb-2">No products found</p>
          <p className="text-sm">Click <b>Refresh</b> to load products from WMS</p>
        </div>
      )}

      {/* ── Table ── */}
      {!loading && filtered.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-2.5 text-left text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">SKU</th>
                  <th className="px-4 py-2.5 text-left text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">Product Name</th>
                  {customerCode === "ALL" && customers.length > 1 && (
                    <th className="px-4 py-2.5 text-left text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">Customer</th>
                  )}
                  <th className="px-4 py-2.5 text-left text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">Barcode</th>
                  <th className="px-4 py-2.5 text-left text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">Category</th>
                  <th className="px-4 py-2.5 text-left text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">Unit</th>
                  <th className="px-4 py-2.5 text-left text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">Status</th>
                  <th className="px-4 py-2.5 text-center text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">
                    <span className="flex items-center justify-center gap-1">
                      <BoxIcon className="w-3.5 h-3.5" /> UOM
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, idx) => {
                  const uom    = uomData[`${p.sku}__${p.customer_code}`];
                  const hasUom = !!uom?.units_per_carton;
                  return (
                    <tr
                      key={idx}
                      onClick={(e) => openUomModal(p, e)}
                      className="hover:bg-blue-50 border-b border-slate-100 last:border-0 cursor-pointer group transition-colors"
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="font-mono font-medium text-slate-900 bg-slate-100 group-hover:bg-blue-100 px-2 py-0.5 rounded transition-colors">
                          {p.sku || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700 max-w-xs truncate">
                        {p.product_name || p.product_short_name || "—"}
                      </td>
                      {customerCode === "ALL" && customers.length > 1 && (
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
                          {p.customer_name || p.customer_code}
                        </td>
                      )}
                      <td className="px-4 py-2.5 text-slate-500 font-mono whitespace-nowrap">
                        {p.barcode || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">
                        {p.category_first || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">
                        {p.unit_type || "—"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {p.status ? (
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            p.status.toLowerCase().includes("active") || p.status === "1"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-slate-100 text-slate-500"
                          }`}>
                            {p.status}
                          </span>
                        ) : "—"}
                      </td>
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
                  <p className="text-xs text-slate-500 font-mono mt-0.5">{uomModal.sku}</p>
                </div>
              </div>
              <button onClick={() => setUomModal(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Product info */}
            <div className="px-5 pt-4 pb-2">
              <p className="text-xs text-slate-500 mb-0.5">Product</p>
              <p className="text-sm font-semibold text-slate-800 truncate">
                {uomModal.product_name || uomModal.product_short_name || "—"}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                Customer: {uomModal.customer_name || uomModal.customer_code}
              </p>
            </div>

            {/* Form */}
            <div className="px-5 pb-3 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">
                    ea / CTN <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number" min={1}
                    value={uomEdit.units_per_carton ?? ""}
                    onChange={(e) => setUomEdit((p) => ({ ...p, units_per_carton: e.target.value ? Number(e.target.value) : undefined }))}
                    placeholder="e.g. 24"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 text-right tabular-nums font-semibold"
                  />
                  <p className="text-xs text-slate-400 mt-1 text-center">Units/Carton</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">Inner Pack</label>
                  <input
                    type="number" min={1}
                    value={uomEdit.inner_pack_qty ?? ""}
                    onChange={(e) => setUomEdit((p) => ({ ...p, inner_pack_qty: e.target.value ? Number(e.target.value) : undefined }))}
                    placeholder="—"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 text-right tabular-nums"
                  />
                  <p className="text-xs text-slate-400 mt-1 text-center">ea / Inner</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">CTN / Pallet</label>
                  <input
                    type="number" min={1}
                    value={uomEdit.pallet_qty ?? ""}
                    onChange={(e) => setUomEdit((p) => ({ ...p, pallet_qty: e.target.value ? Number(e.target.value) : undefined }))}
                    placeholder="—"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 text-right tabular-nums"
                  />
                  <p className="text-xs text-slate-400 mt-1 text-center">Cartons/Pallet</p>
                </div>
              </div>

              {upc > 0 && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-xs space-y-1">
                  <p className="font-bold text-emerald-700 uppercase tracking-wide mb-1.5">Preview</p>
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
                      <span className="font-bold text-emerald-700">{plq} CTN = {(plq * upc).toLocaleString()} EA</span>
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

            {uomMsg && (
              <div className={`mx-5 mb-3 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${uomMsg.ok ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-red-50 text-red-700 border border-red-100"}`}>
                {uomMsg.ok ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                {uomMsg.text}
              </div>
            )}

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
