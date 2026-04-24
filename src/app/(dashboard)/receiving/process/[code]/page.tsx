"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft, ScanLine, CheckCircle2, AlertCircle, PackageCheck } from "lucide-react";
import { deleteStowTagsByOrder } from "@/lib/stow-tags";

type Row = Record<string, unknown>;

function getItemKey(item: Row, idx: number): string {
  return String(item.productSku ?? item.sku ?? item.skuCode ?? idx);
}

export default function ReceivingProcessDetailPage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams();
  const code = String(params.code ?? "");

  const [order, setOrder] = useState<Row | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanInput, setScanInput] = useState("");
  const [scanError, setScanError] = useState("");
  const [completedKeys, setCompletedKeys] = useState<Set<string>>(new Set());

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  // Load completed items from localStorage
  useEffect(() => {
    if (!code) return;
    let alreadyStarted = false;
    try {
      const saved = localStorage.getItem(`wms_receiving_${code}`);
      if (saved) {
        const parsed: string[] = JSON.parse(saved);
        if (parsed.length > 0) alreadyStarted = true;
        setCompletedKeys(new Set(parsed));
      }
    } catch {}

    // If this is a fresh session for this order (no items completed yet),
    // clean up any stale pending stow tags left from a previous processing run.
    if (!alreadyStarted) {
      deleteStowTagsByOrder(code).catch(() => {});
    }
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    try {
      const [orderRes, itemsRes] = await Promise.all([
        fetch(`/api/wms/receiving/${code}`, { headers }),
        fetch(`/api/wms/receiving/items/${code}`, { headers }),
      ]);
      const orderJson = await orderRes.json();
      const itemsJson = await itemsRes.json().catch(() => null);
      setOrder((orderJson?.data ?? orderJson) as Row);
      const list: Row[] = Array.isArray(itemsJson?.data?.items)
        ? itemsJson.data.items
        : Array.isArray(itemsJson?.data?.list)
        ? itemsJson.data.list
        : Array.isArray(itemsJson?.data)
        ? itemsJson.data
        : [];
      setItems(list);
    } catch {}
    setLoading(false);
  }, [code, headers]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function navigateToInspect(skuKey: string) {
    if (!skuKey) return;
    const idx = items.findIndex((item, i) => getItemKey(item, i).toLowerCase() === skuKey.toLowerCase());
    if (idx === -1) {
      setScanError(`SKU "${skuKey}" not found in this order`);
      return;
    }
    setScanError("");
    router.push(`/receiving/process/${code}/${idx}`);
  }

  function handleScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    navigateToInspect(scanInput.trim());
  }

  function completeOrder() {
    // Receiving inspection complete — do NOT change WMS status here.
    // Status update happens only after stow process is fully done.
    localStorage.removeItem(`wms_receiving_${code}`);
    router.push("/receiving/process");
  }

  const allDone = items.length > 0 && items.every((item, i) => completedKeys.has(getItemKey(item, i)));

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push("/receiving/process")} className="text-slate-400 hover:text-slate-700 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900 font-mono">{code}</h1>
          {order && (
            <p className="text-slate-500 text-sm mt-0.5">
              {String(order.customerName ?? order.customerCode ?? "")} · {String(order.warehouseCode ?? "")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">
            <span className="font-semibold text-slate-800">{completedKeys.size}</span> / {items.length} done
          </span>
          {allDone && (
            <button
              onClick={completeOrder}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <PackageCheck className="w-4 h-4" />
              Complete Order
            </button>
          )}
        </div>
      </div>

      {/* Order info */}
      {order && (
        <div className="grid grid-cols-4 gap-4 bg-white border border-slate-100 rounded-xl px-5 py-4 mb-6 text-sm shadow-sm">
          <div><p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">PO Number</p><p className="font-medium">{String(order.poNum ?? order.poNo ?? "-")}</p></div>
          <div><p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Order Date</p><p className="font-medium">{String(order.orderDate ?? "-")}</p></div>
          <div><p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">ETA</p><p className="font-medium">{String(order.etaDate ?? "-")}</p></div>
          <div><p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Container</p><p className="font-medium">{String(order.containerNo ?? "-")}</p></div>
        </div>
      )}

      {/* Scan input */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 mb-6">
        <p className="text-xs font-semibold text-blue-900 mb-2.5 flex items-center gap-1.5">
          <ScanLine className="w-3.5 h-3.5" />
          Scan SKU Barcode
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={scanInput}
            onChange={(e) => { setScanInput(e.target.value); setScanError(""); }}
            onKeyDown={handleScan}
            autoFocus
            placeholder="Scan or type SKU..."
            className="flex-1 border border-blue-200 bg-white rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => navigateToInspect(scanInput.trim())}
            disabled={!scanInput.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Inspect
          </button>
        </div>
        {scanError && (
          <div className="flex items-center gap-1.5 text-xs text-red-600 mt-1.5">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{scanError}
          </div>
        )}
      </div>

      {/* SKU list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-100 h-12 animate-pulse" />)}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium w-10">#</th>
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">SKU</th>
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">Product</th>
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">LOT</th>
                <th className="px-4 py-2.5 text-left text-slate-500 font-medium">Expire</th>
                <th className="px-4 py-2.5 text-right text-slate-500 font-medium">Order Qty</th>
                <th className="px-4 py-2.5 text-right text-slate-500 font-medium">Assigned</th>
                <th className="px-4 py-2.5 text-center text-slate-500 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const key = getItemKey(item, idx);
                const done = completedKeys.has(key);
                return (
                  <tr
                    key={idx}
                    onClick={() => router.push(`/receiving/process/${code}/${idx}`)}
                    className={`border-b border-slate-100 cursor-pointer transition-colors last:border-0 ${
                      done ? "bg-green-50 hover:bg-green-100" : "hover:bg-blue-50"
                    }`}
                  >
                    <td className="px-4 py-2.5 text-slate-400">{String(item.seq ?? idx + 1)}</td>
                    <td className={`px-4 py-2.5 font-mono font-medium ${done ? "text-green-700" : "text-slate-900"}`}>
                      {String(item.productSku ?? item.sku ?? "-")}
                    </td>
                    <td className={`px-4 py-2.5 max-w-xs truncate ${done ? "text-green-700" : "text-slate-700"}`}>
                      {String(item.productName ?? "-")}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-500">{String(item.lotNo ?? "-")}</td>
                    <td className="px-4 py-2.5 text-slate-500">{String(item.expireDate ?? "-")}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{String(item.orderQty ?? "-")}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{String(item.assignedQty ?? "-")}</td>
                    <td className="px-4 py-2.5 text-center">
                      {done ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Done
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">Pending</span>
                      )}
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
