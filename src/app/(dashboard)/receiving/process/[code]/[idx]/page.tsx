"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, RefreshCw } from "lucide-react";

type Row = Record<string, unknown>;

export default function ReceivingInspectPage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams();
  const code = String(params.code ?? "");
  const idx = Number(params.idx ?? 0);

  const [item, setItem] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);

  const [receivedQty, setReceivedQty] = useState("");
  const [lotNo, setLotNo] = useState("");
  const [expireDate, setExpireDate] = useState("");
  const [notes, setNotes] = useState("");

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  useEffect(() => {
    async function fetchItem() {
      setLoading(true);
      try {
        const res = await fetch(`/api/wms/receiving/items/${code}`, { headers });
        const json = await res.json();
        const list: Row[] = Array.isArray(json?.data?.items)
          ? json.data.items
          : Array.isArray(json?.data?.list)
          ? json.data.list
          : Array.isArray(json?.data)
          ? json.data
          : [];
        const found = list[idx] ?? null;
        setItem(found);
        if (found) {
          setReceivedQty(String(found.orderQty ?? ""));
          setLotNo(String(found.lotNo ?? ""));
          const raw = String(found.expireDate ?? "");
          // normalize to YYYY-MM-DD for date input
          setExpireDate(raw.length >= 10 ? raw.slice(0, 10) : raw);
        }
      } catch {}
      setLoading(false);
    }
    if (code) fetchItem();
  }, [code, idx, headers]);

  function getItemKey(i: Row, n: number): string {
    return String(i.productSku ?? i.sku ?? i.skuCode ?? n);
  }

  function complete() {
    if (!item) return;
    const storageKey = `wms_receiving_${code}`;
    let completed: string[] = [];
    try { completed = JSON.parse(localStorage.getItem(storageKey) ?? "[]"); } catch {}
    const key = getItemKey(item, idx);
    if (!completed.includes(key)) completed.push(key);
    localStorage.setItem(storageKey, JSON.stringify(completed));
    router.push(`/receiving/process/${code}`);
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="p-8">
        <button onClick={() => router.push(`/receiving/process/${code}`)} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 mb-6">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <p className="text-slate-500">Item not found.</p>
      </div>
    );
  }

  const sku = String(item.productSku ?? item.sku ?? "-");
  const productName = String(item.productName ?? "-");
  const orderQty = String(item.orderQty ?? "-");

  return (
    <div className="p-8 max-w-lg">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push(`/receiving/process/${code}`)} className="text-slate-400 hover:text-slate-700 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Inspect Item</h1>
          <p className="text-slate-500 text-xs font-mono mt-0.5">{code}</p>
        </div>
      </div>

      {/* Item info card */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl px-5 py-4 mb-6">
        <p className="font-semibold text-slate-900 text-sm">{productName}</p>
        <p className="text-slate-500 font-mono text-xs mt-0.5">{sku}</p>
        <div className="flex gap-6 mt-3 text-xs text-slate-500">
          <span>Order Qty: <span className="font-semibold text-slate-800">{orderQty}</span></span>
          {item.lotNo && String(item.lotNo) !== "-" && (
            <span>LOT: <span className="font-semibold text-slate-800">{String(item.lotNo)}</span></span>
          )}
          {item.expireDate && String(item.expireDate) !== "-" && (
            <span>Exp: <span className="font-semibold text-slate-800">{String(item.expireDate).slice(0, 10)}</span></span>
          )}
        </div>
      </div>

      {/* Inspection form */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div>
          <label className="text-xs text-slate-500 uppercase tracking-wide mb-1.5 block">
            Received Qty <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            value={receivedQty}
            onChange={(e) => setReceivedQty(e.target.value)}
            autoFocus
            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter received quantity"
          />
        </div>

        <div>
          <label className="text-xs text-slate-500 uppercase tracking-wide mb-1.5 block">LOT No</label>
          <input
            type="text"
            value={lotNo}
            onChange={(e) => setLotNo(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="LOT number"
          />
        </div>

        <div>
          <label className="text-xs text-slate-500 uppercase tracking-wide mb-1.5 block">Expire Date</label>
          <input
            type="date"
            value={expireDate}
            onChange={(e) => setExpireDate(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="text-xs text-slate-500 uppercase tracking-wide mb-1.5 block">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            placeholder="Optional notes..."
          />
        </div>

        <button
          onClick={complete}
          disabled={!receivedQty}
          className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-medium py-3 rounded-xl text-sm transition-colors"
        >
          <CheckCircle2 className="w-4 h-4" />
          Complete Inspection
        </button>
      </div>
    </div>
  );
}
