"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Search, Download, Loader2, X, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import * as XLSX from "xlsx";

interface TxRow {
  date: string;
  type: string;
  location: string;
  qty: number;
  reference: string;
  condition: string;
  lot: string;
  remark: string;
  sku?: string;
  productName?: string;
  customerCode?: string;
}

const TYPE_COLOR: Record<string, string> = {
  SHIP:   "bg-red-100 text-red-700 border-red-200",
  RECV:   "bg-green-100 text-green-700 border-green-200",
  ADJ:    "bg-yellow-100 text-yellow-700 border-yellow-200",
  MOVE:   "bg-blue-100 text-blue-700 border-blue-200",
  RETURN: "bg-purple-100 text-purple-700 border-purple-200",
};
const typeColor = (t: string) => TYPE_COLOR[t?.toUpperCase()] ?? "bg-slate-100 text-slate-600 border-slate-200";

function parseTxRow(r: Record<string, unknown>): TxRow {
  const dateRaw = String(r.transactionDate ?? r.date ?? r.createdAt ?? r.created_at ?? "");
  let date = dateRaw;
  if (dateRaw.length === 8) {
    date = `${dateRaw.slice(0,4)}-${dateRaw.slice(4,6)}-${dateRaw.slice(6,8)}`;
  } else if (dateRaw.includes("T")) {
    date = dateRaw.slice(0, 10);
  }

  return {
    date,
    type:        String(r.transactionType ?? r.type ?? r.txType ?? ""),
    location:    String(r.locationCode ?? r.location ?? r.inKey ?? ""),
    qty:         Number(r.qty ?? r.quantity ?? r.transQty ?? 0),
    reference:   String(r.shippingOrderCode ?? r.reference ?? r.referenceCode ?? r.orderCode ?? ""),
    condition:   String(r.itemCondition ?? r.condition ?? ""),
    lot:         String(r.lotNo ?? r.lot ?? ""),
    remark:      String(r.remark ?? r.memo ?? r.note ?? ""),
    sku:         String(r.productSku ?? r.sku ?? ""),
    productName: String(r.productName ?? r.skuName ?? ""),
    customerCode:String(r.customerCode ?? ""),
  };
}

export default function StockActivityPage() {
  const { user } = useAuth();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user?.token ?? ""}`, "Content-Type": "application/json" }),
    [user]
  );

  const [warehouseCode,   setWarehouseCode]   = useState("STOO1");
  const [customerCode,    setCustomerCode]     = useState("");
  const [skuInput,        setSkuInput]         = useState("");
  const [typeFilter,      setTypeFilter]       = useState("ALL");

  const [rows,      setRows]      = useState<TxRow[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [progress,  setProgress]  = useState({ fetched: 0, total: 0 });
  const [error,     setError]     = useState<string | null>(null);
  const [sortCol,   setSortCol]   = useState<keyof TxRow>("date");
  const [sortAsc,   setSortAsc]   = useState(false);
  const abortRef = useRef(false);

  /* ── fetch all pages ── */
  const fetchAll = useCallback(async () => {
    const sku = skuInput.trim();
    if (!warehouseCode || !customerCode) {
      setError("Warehouse and Customer are required.");
      return;
    }
    abortRef.current = false;
    setLoading(true);
    setError(null);
    setRows([]);
    setProgress({ fetched: 0, total: 0 });

    const PAGE = 500;
    const allRows: TxRow[] = [];
    let page = 1;

    try {
      while (!abortRef.current) {
        const res = await fetch("/api/wms/inventory/transactions", {
          method: "POST",
          headers,
          body: JSON.stringify({
            warehouseCode,
            customerCode,
            ...(sku ? { productSku: sku } : {}),
            page,
            pageSize: PAGE,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json().catch(() => ({})) as Record<string, unknown>;

        const d = json?.data as Record<string, unknown> | undefined;
        const data: Record<string, unknown>[] =
          Array.isArray(d?.list)  ? (d!.list  as Record<string, unknown>[]) :
          Array.isArray(d?.items) ? (d!.items as Record<string, unknown>[]) :
          Array.isArray(json?.data) ? (json.data as Record<string, unknown>[]) :
          Array.isArray((json as Record<string,unknown>)?.list) ? ((json as Record<string,unknown>).list as Record<string, unknown>[]) :
          Array.isArray(json) ? (json as Record<string, unknown>[]) : [];

        const total = Number(d?.total ?? json?.total ?? (json as Record<string,unknown>)?.totalCount ?? 0);

        allRows.push(...data.map(parseTxRow));
        setProgress({ fetched: allRows.length, total: total || allRows.length });

        if (data.length < PAGE || (total > 0 && allRows.length >= total)) break;
        page++;
      }
      setRows(allRows);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [warehouseCode, customerCode, skuInput, headers]);

  /* ── sort + filter ── */
  const displayed = useMemo(() => {
    let r = typeFilter === "ALL" ? rows : rows.filter(x => x.type.toUpperCase() === typeFilter);
    r = [...r].sort((a, b) => {
      const av = a[sortCol] ?? "";
      const bv = b[sortCol] ?? "";
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortAsc ? cmp : -cmp;
    });
    return r;
  }, [rows, typeFilter, sortCol, sortAsc]);

  const types = useMemo(() => {
    const s = new Set(rows.map(r => r.type.toUpperCase()).filter(Boolean));
    return ["ALL", ...Array.from(s).sort()];
  }, [rows]);

  /* ── export ── */
  function exportXLSX() {
    const ws = XLSX.utils.json_to_sheet(displayed.map(r => ({
      Date: r.date, Type: r.type, Location: r.location,
      Qty: r.qty, Reference: r.reference, SKU: r.sku,
      "Product Name": r.productName, Condition: r.condition,
      Lot: r.lot, Remark: r.remark, Customer: r.customerCode,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Activity");
    XLSX.writeFile(wb, `stock-activity-${warehouseCode}-${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  function toggleSort(col: keyof TxRow) {
    if (sortCol === col) setSortAsc(a => !a);
    else { setSortCol(col); setSortAsc(false); }
  }

  const SortIcon = ({ col }: { col: keyof TxRow }) =>
    sortCol === col
      ? (sortAsc ? <ChevronUp className="w-3 h-3 inline ml-0.5" /> : <ChevronDown className="w-3 h-3 inline ml-0.5" />)
      : <ChevronDown className="w-3 h-3 inline ml-0.5 opacity-30" />;

  return (
    <div className="p-6 max-w-full">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Stock Activity</h1>
          <p className="text-sm text-slate-400 mt-0.5">Inventory transaction history from WMS</p>
        </div>
        {rows.length > 0 && (
          <button onClick={exportXLSX} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 font-medium">
            <Download className="w-4 h-4" /> Export
          </button>
        )}
      </div>

      {/* ── Filter bar ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Warehouse</label>
            <input
              value={warehouseCode} onChange={e => setWarehouseCode(e.target.value.toUpperCase())}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg w-32 focus:outline-none focus:ring-2 focus:ring-blue-200"
              placeholder="STOO1"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Customer Code *</label>
            <input
              value={customerCode} onChange={e => setCustomerCode(e.target.value.toUpperCase())}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg w-36 focus:outline-none focus:ring-2 focus:ring-blue-200"
              placeholder="FCOUS"
            />
          </div>
          <div className="flex-1 min-w-48">
            <label className="text-xs font-semibold text-slate-500 mb-1 block">SKU (optional)</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={skuInput} onChange={e => setSkuInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && fetchAll()}
                className="pl-8 pr-8 py-2 text-sm border border-slate-200 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="Leave empty for all transactions"
              />
              {skuInput && (
                <button onClick={() => setSkuInput("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          <button
            onClick={fetchAll}
            disabled={loading || !customerCode}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {loading ? `Fetching… (${progress.fetched}${progress.total ? `/${progress.total}` : ""})` : "Fetch All"}
          </button>
          {loading && (
            <button onClick={() => { abortRef.current = true; }} className="px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50">
              Stop
            </button>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-red-600 font-medium">{error}</p>}
      </div>

      {/* ── Results summary + type filter ── */}
      {rows.length > 0 && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-sm text-slate-500 font-medium">{displayed.length.toLocaleString()} records</span>
          <span className="text-slate-300">·</span>
          {types.map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-2.5 py-0.5 rounded-full text-xs font-bold border transition-colors ${
                typeFilter === t
                  ? "bg-slate-800 text-white border-slate-800"
                  : t === "ALL" ? "bg-white text-slate-500 border-slate-200 hover:border-slate-400"
                  : `${typeColor(t)} hover:opacity-80`
              }`}
            >
              {t === "ALL" ? `All (${rows.length})` : `${t} (${rows.filter(r => r.type.toUpperCase() === t).length})`}
            </button>
          ))}
        </div>
      )}

      {/* ── Table ── */}
      {displayed.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  {([
                    ["date",      "Date"],
                    ["type",      "Type"],
                    ["location",  "Location"],
                    ["qty",       "Qty"],
                    ["reference", "Reference"],
                    ["sku",       "SKU"],
                    ["productName","Product"],
                    ["condition", "Condition"],
                    ["lot",       "Lot"],
                    ["remark",    "Remark"],
                  ] as [keyof TxRow, string][]).map(([col, label]) => (
                    <th
                      key={col}
                      onClick={() => toggleSort(col)}
                      className="px-3 py-3 text-left cursor-pointer hover:text-slate-800 select-none whitespace-nowrap"
                    >
                      {label}<SortIcon col={col} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayed.slice(0, 2000).map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-500 whitespace-nowrap">{r.date}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-bold border ${typeColor(r.type)}`}>{r.type}</span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-700">{r.location}</td>
                    <td className={`px-3 py-2.5 font-mono text-xs font-bold text-right ${r.qty < 0 ? "text-red-600" : r.qty > 0 ? "text-green-600" : "text-slate-400"}`}>
                      {r.qty > 0 ? `+${r.qty}` : r.qty}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600 font-mono whitespace-nowrap">{r.reference}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-500 font-mono">{r.sku}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-700 max-w-48 truncate" title={r.productName}>{r.productName}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">{r.condition}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-500 font-mono">{r.lot}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-400">{r.remark}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {displayed.length > 2000 && (
            <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-500 text-center">
              Showing first 2,000 of {displayed.length.toLocaleString()} — export to Excel to see all
            </div>
          )}
        </div>
      )}

      {!loading && rows.length === 0 && !error && (
        <div className="text-center py-24 text-slate-300">
          <Search className="w-10 h-10 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">Enter warehouse + customer and click Fetch All</p>
        </div>
      )}
    </div>
  );
}
