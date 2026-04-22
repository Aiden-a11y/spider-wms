"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Search, RefreshCw, Package, Download } from "lucide-react";


interface Customer { code: string; name: string; }
interface Warehouse { id: string; name: string; }
interface Product { [key: string]: unknown; }

export default function ProductsPage() {
  const { user } = useAuth();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseCode, setWarehouseCode] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerCode, setCustomerCode] = useState("ALL");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  function parseArr(json: unknown): Record<string, unknown>[] {
    const j = json as Record<string, unknown>;
    return Array.isArray(j?.data) ? j.data : Array.isArray(json) ? (json as Record<string, unknown>[]) : [];
  }

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
    try {
      const r = await fetch(`/api/wms/combo/customer-by-warehouse/${whCode}`, { headers });
      const json = await r.json();
      const list: Customer[] = parseArr(json)
        .map((c) => ({ code: String(c.code ?? c.customerCode ?? ""), name: String(c.name ?? c.customerName ?? c.code ?? "") }))
        .filter((c) => c.code);
      setCustomers(list);
      await fetchProducts(whCode, "ALL", list);
    } catch {
      await fetchProducts(whCode, "ALL", []);
    }
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

      for (let i = 0; i < targets.length; i++) {
        const cust = targets[i];
        const res = await fetch("/api/wms/product/list", {
          method: "POST",
          headers,
          body: JSON.stringify({ warehouseCode: whCode, customerCode: cust.code, page: 1, size: 9999 }),
        });
        const json = await res.json();
        const list: Record<string, unknown>[] = Array.isArray(json?.data?.list)
          ? json.data.list
          : Array.isArray(json?.data)
          ? json.data
          : [];
        list.forEach((p) => allProducts.push({ ...p, _customerCode: cust.code, _customerName: cust.name }));
        setProgress({ loaded: i + 1, total: targets.length });
      }
      setProducts(allProducts);
    } catch (e) {
      setError(`Request failed: ${String(e)}`);
    }
    setProgress(null);
    setLoading(false);
  }, [headers]);

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
      const row: Record<string, unknown> = {};
      if (customers.length > 1) row["Customer"] = String(p._customerName ?? p._customerCode ?? "");
      cols.forEach((c) => { row[c] = p[c] ?? ""; });
      return row;
    }));
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Products");
    writeFile(wb, `products_${warehouseCode}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

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
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.name || w.id}</option>
          ))}
        </select>

        {customers.length > 0 && (
          <select
            value={customerCode}
            onChange={(e) => { setCustomerCode(e.target.value); fetchProducts(warehouseCode, e.target.value, customers); }}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Customers</option>
            {customers.map((c) => (
              <option key={c.code} value={c.code}>{c.name || c.code}</option>
            ))}
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
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="relative w-14 h-14">
            <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56" fill="none">
              <circle cx="28" cy="28" r="24" stroke="#e2e8f0" strokeWidth="4" />
              <circle
                cx="28" cy="28" r="24"
                stroke="#3b82f6" strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${progress && progress.total > 0 ? (progress.loaded / progress.total) * 150.8 : 40} 150.8`}
                strokeDashoffset="0"
                className="transition-all duration-300"
              />
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

      {!loading && filtered.length > 0 && cols.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {customers.length > 1 && (
                    <th className="px-4 py-2.5 text-left text-slate-500 font-medium whitespace-nowrap">Customer</th>
                  )}
                  {cols.map((c) => (
                    <th key={c} className="px-4 py-2.5 text-left text-slate-500 font-medium whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 border-b border-slate-100 last:border-0">
                    {customers.length > 1 && (
                      <td className="px-4 py-2.5 text-slate-500 text-xs whitespace-nowrap">
                        {String(p._customerName ?? p._customerCode ?? "")}
                      </td>
                    )}
                    {cols.map((c) => (
                      <td key={c} className="px-4 py-2.5 text-slate-700 whitespace-nowrap max-w-xs truncate">
                        {c.toLowerCase().includes("sku") || c.toLowerCase().includes("code") || c.toLowerCase().includes("upc") ? (
                          <span className="font-mono font-medium text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                            {String(p[c] ?? "-")}
                          </span>
                        ) : String(p[c] ?? "-")}
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
