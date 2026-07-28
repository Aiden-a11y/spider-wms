"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Search, Download, Loader2, X, ChevronDown, ChevronUp, RefreshCw, Bug } from "lucide-react";
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
  sku: string;
  productName: string;
  customerCode: string;
}

const TYPE_LABEL: Record<string, string> = {
  S: "SHIP", R: "RECV", M: "MOVE", A: "ADJ",
};
const TYPE_COLOR: Record<string, string> = {
  SHIP: "bg-red-100 text-red-700 border-red-200",
  RECV: "bg-green-100 text-green-700 border-green-200",
  ADJ:  "bg-yellow-100 text-yellow-700 border-yellow-200",
  MOVE: "bg-blue-100 text-blue-700 border-blue-200",
};
const typeColor = (t: string) => TYPE_COLOR[t?.toUpperCase()] ?? "bg-slate-100 text-slate-600 border-slate-200";

/* Try every known field name variation */
function pick(r: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return "";
}
function pickNum(r: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && v !== null) {
      const n = Number(v);
      if (!isNaN(n)) return n;
    }
  }
  return 0;
}

function parseTxRow(r: Record<string, unknown>): TxRow {
  const dateRaw = pick(r, "inventoryDate", "transactionDate", "txDate", "date", "workDate", "regDate");
  let date = dateRaw;
  if (dateRaw.length === 8 && /^\d{8}$/.test(dateRaw)) {
    date = `${dateRaw.slice(0,4)}-${dateRaw.slice(4,6)}-${dateRaw.slice(6,8)}`;
  } else if (dateRaw.includes("T")) {
    date = dateRaw.slice(0, 10);
  }

  const rawType = pick(r, "inventoryType", "transactionType", "transType", "txType", "type", "moveType");
  const typeLabel = TYPE_LABEL[rawType.toUpperCase()] ?? rawType.toUpperCase();

  const rawQty = pickNum(r, "inventoryQty", "qty", "quantity", "transQty", "changeQty", "inQty", "outQty");
  // Ship is always outbound → force negative
  const qty = rawType.toUpperCase() === "S" ? -Math.abs(rawQty) : rawQty;

  return {
    date,
    type: typeLabel,
    location: pick(r, "location", "locationCode", "inKey", "outKey", "locCd"),
    qty,
    reference: pick(r, "referenceId", "shippingOrderCode", "reference", "referenceCode", "orderCode", "refCode"),
    condition: pick(r, "itemCondition", "condition", "conditionCode"),
    lot:       pick(r, "lotNo", "lot", "lotNumber"),
    remark:    pick(r, "remark1", "remark", "memo", "note"),
    sku:       pick(r, "productSku", "sku", "itemCode", "skuCode"),
    productName: pick(r, "productName", "skuName", "itemName", "productNm"),
    customerCode: pick(r, "customerCode", "custCode"),
  };
}

export default function StockActivityPage() {
  const { user } = useAuth();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user?.token ?? ""}`, "Content-Type": "application/json" }),
    [user]
  );

  const [warehouseCode, setWarehouseCode] = useState("STOO1");
  const [customerCode,  setCustomerCode]  = useState("");
  const [customers,     setCustomers]     = useState<{ code: string; name: string }[]>([]);
  const [skuInput,      setSkuInput]      = useState("");
  const [typeFilter,    setTypeFilter]    = useState("ALL");
  const [custFilter,    setCustFilter]    = useState("ALL");

  const [rows,     setRows]     = useState<TxRow[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [progress, setProgress] = useState({ fetched: 0, total: 0 });
  const [error,    setError]    = useState<string | null>(null);
  const [sortCol,  setSortCol]  = useState<keyof TxRow>("date");
  const [sortAsc,  setSortAsc]  = useState(false);
  const [debug,    setDebug]    = useState<Record<string, unknown> | null>(null);
  const abortRef = useRef(false);

  /* ── Load customers ── */
  useEffect(() => {
    if (!warehouseCode) return;
    fetch(`/api/wms/combo/customer-by-warehouse/${encodeURIComponent(warehouseCode)}`, { headers })
      .then(r => r.json()).catch(() => ({}))
      .then((j: Record<string, unknown>) => {
        const list = Array.isArray(j?.data) ? j.data as Record<string, unknown>[] : [];
        setCustomers(list.map(c => ({
          code: String(c.customerCode ?? c.code ?? ""),
          name: String(c.customerName ?? c.name ?? ""),
        })));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseCode]);

  /* ── Fetch all pages ── */
  const fetchAll = useCallback(async () => {
    const sku = skuInput.trim();
    if (!warehouseCode) { setError("Warehouse is required."); return; }
    abortRef.current = false;
    setLoading(true);
    setError(null);
    setRows([]);
    setDebug(null);
    setProgress({ fetched: 0, total: 0 });

    const PAGE = 500;
    const allRows: TxRow[] = [];
    let page = 1;

    try {
      while (!abortRef.current) {
        const body: Record<string, unknown> = {
          warehouseCode,
          page,
          pageSize: PAGE,
          ...(customerCode ? { customerCode } : {}),
          ...(sku ? { productSku: sku } : {}),
        };
        const res = await fetch("/api/wms/inventory/transactions", {
          method: "POST", headers,
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json().catch(() => ({})) as Record<string, unknown>;

        /* Save first-page raw for debug */
        if (page === 1) setDebug(json);

        const d = json?.data as Record<string, unknown> | undefined;
        const data: Record<string, unknown>[] =
          Array.isArray(d?.list)  ? (d!.list  as Record<string, unknown>[]) :
          Array.isArray(d?.items) ? (d!.items as Record<string, unknown>[]) :
          Array.isArray(json?.data) ? (json.data as Record<string, unknown>[]) :
          Array.isArray((json as Record<string,unknown>)?.list) ? ((json as Record<string,unknown>).list as Record<string, unknown>[]) :
          Array.isArray(json) ? (json as Record<string, unknown>[]) : [];

        const total = Number(d?.total ?? d?.totalCount ?? json?.total ?? (json as Record<string,unknown>)?.totalCount ?? 0);

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

  /* ── Sort + filter ── */
  const displayed = useMemo(() => {
    let r = rows;
    if (typeFilter !== "ALL") r = r.filter(x => x.type.toUpperCase() === typeFilter);
    if (custFilter !== "ALL") r = r.filter(x => x.customerCode === custFilter);
    return [...r].sort((a, b) => {
      const av = a[sortCol] ?? "", bv = b[sortCol] ?? "";
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortAsc ? cmp : -cmp;
    });
  }, [rows, typeFilter, custFilter, sortCol, sortAsc]);

  const types = useMemo(() => {
    const s = new Set(rows.map(r => r.type.toUpperCase()).filter(Boolean));
    return ["ALL", ...Array.from(s).sort()];
  }, [rows]);

  const custCodes = useMemo(() => {
    const s = new Set(rows.map(r => r.customerCode).filter(Boolean));
    return ["ALL", ...Array.from(s).sort()];
  }, [rows]);

  /* ── Export ── */
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
        <div className="flex items-center gap-2">
          {debug && (
            <button onClick={() => setDebug(d => d ? null : debug)} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-500 hover:bg-slate-50">
              <Bug className="w-3.5 h-3.5" /> Raw
            </button>
          )}
          {rows.length > 0 && (
            <button onClick={exportXLSX} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 font-medium">
              <Download className="w-4 h-4" /> Export
            </button>
          )}
        </div>
      </div>

      {/* ── Raw debug panel ── */}
      {debug && (
        <details className="mb-4 bg-slate-900 rounded-xl">
          <summary className="px-4 py-2 text-xs text-green-400 cursor-pointer">Raw API response (first page)</summary>
          <pre className="px-4 pb-4 text-xs text-green-300 overflow-x-auto max-h-60">
            {JSON.stringify(debug, null, 2).slice(0, 3000)}
          </pre>
        </details>
      )}

      {/* ── Filter bar ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Warehouse</label>
            <input
              value={warehouseCode} onChange={e => setWarehouseCode(e.target.value.toUpperCase())}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg w-28 focus:outline-none focus:ring-2 focus:ring-blue-200"
              placeholder="STOO1"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Customer (optional)</label>
            <select
              value={customerCode} onChange={e => setCustomerCode(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg w-44 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
            >
              <option value="">All Customers</option>
              {customers.map(c => (
                <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-48">
            <label className="text-xs font-semibold text-slate-500 mb-1 block">SKU (optional)</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={skuInput} onChange={e => setSkuInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && fetchAll()}
                className="pl-8 pr-8 py-2 text-sm border border-slate-200 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="Leave empty for all"
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
            disabled={loading || !warehouseCode}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {loading ? `${progress.fetched}${progress.total ? `/${progress.total}` : ""} records…` : "Fetch All"}
          </button>
          {loading && (
            <button onClick={() => { abortRef.current = true; }} className="px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50">
              Stop
            </button>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-red-600 font-medium">{error}</p>}
      </div>

      {/* ── Results summary + filters ── */}
      {rows.length > 0 && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-sm text-slate-500 font-medium">{displayed.length.toLocaleString()} records</span>
          <span className="text-slate-300">·</span>
          {types.map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`px-2.5 py-0.5 rounded-full text-xs font-bold border transition-colors ${
                typeFilter === t ? "bg-slate-800 text-white border-slate-800"
                : t === "ALL" ? "bg-white text-slate-500 border-slate-200 hover:border-slate-400"
                : `${typeColor(t)} hover:opacity-80`
              }`}
            >
              {t === "ALL" ? `All (${rows.length})` : `${t} (${rows.filter(r => r.type.toUpperCase() === t).length})`}
            </button>
          ))}
          {custCodes.length > 2 && (
            <>
              <span className="text-slate-300">·</span>
              <select value={custFilter} onChange={e => setCustFilter(e.target.value)}
                className="px-2 py-0.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-600">
                {custCodes.map(c => <option key={c} value={c}>{c === "ALL" ? "All Customers" : c}</option>)}
              </select>
            </>
          )}
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
                    ["date","Date"], ["type","Type"], ["location","Location"],
                    ["qty","Qty"], ["reference","Reference"], ["sku","SKU"],
                    ["productName","Product"], ["condition","Condition"],
                    ["lot","Lot"], ["remark","Remark"],
                  ] as [keyof TxRow, string][]).map(([col, label]) => (
                    <th key={col} onClick={() => toggleSort(col)}
                      className="px-3 py-3 text-left cursor-pointer hover:text-slate-800 select-none whitespace-nowrap">
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
                      {r.type
                        ? <span className={`px-1.5 py-0.5 rounded text-xs font-bold border ${typeColor(r.type)}`}>{r.type}</span>
                        : <span className="text-slate-300 text-xs">—</span>
                      }
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-700">{r.location}</td>
                    <td className={`px-3 py-2.5 font-mono text-xs font-bold text-right ${r.qty < 0 ? "text-red-600" : r.qty > 0 ? "text-green-600" : "text-slate-300"}`}>
                      {r.qty !== 0 ? (r.qty > 0 ? `+${r.qty}` : r.qty) : "—"}
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
        <div className="text-center py-24">
          <Search className="w-10 h-10 mx-auto mb-3 text-slate-200" />
          <p className="text-slate-400 font-medium">Enter warehouse and click Fetch All</p>
          <p className="text-slate-300 text-sm mt-1">Customer and SKU are optional filters</p>
        </div>
      )}
    </div>
  );
}
