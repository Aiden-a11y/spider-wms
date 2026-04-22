"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter, useParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
  Printer,
  Tag,
  RotateCcw,
} from "lucide-react";
import BarcodeLabel, { type LabelData } from "@/components/BarcodeLabel";
import { addStowTag } from "@/lib/stow-tags";

type Row = Record<string, unknown>;

type StowTag = {
  id: number;
  tagNo: number;            // 1-based index for display
  barcodeValue: string;
  qty: number;
  lotNo: string;
  expireDate: string;
  labelData: LabelData;
};

export default function ReceivingInspectPage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams();
  const code = String(params.code ?? "");
  const idx = Number(params.idx ?? 0);

  const [item, setItem] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);

  /* ── form state ── */
  const [tagQty, setTagQty] = useState("");
  const [lotNo, setLotNo] = useState("");
  const [expireDate, setExpireDate] = useState("");

  /* ── stow tags ── */
  const [tags, setTags] = useState<StowTag[]>([]);

  /* ── print trigger ── */
  const [printingTag, setPrintingTag] = useState<StowTag | null>(null);
  const [printKey, setPrintKey] = useState(0); // increment to force re-render + print

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  /* ── fetch item ── */
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
          const raw = String(found.expireDate ?? "");
          setLotNo(String(found.lotNo ?? ""));
          setExpireDate(raw.length >= 10 ? raw.slice(0, 10) : raw);
        }
      } catch {}
      setLoading(false);
    }
    if (code) fetchItem();
  }, [code, idx, headers]);

  /* ── auto-print whenever printKey bumps ── */
  useEffect(() => {
    if (!printingTag || printKey === 0) return;
    // small delay so JsBarcode renders into the SVG before print dialog opens
    const t = setTimeout(() => window.print(), 350);
    return () => clearTimeout(t);
  }, [printKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── derived ── */
  const orderQty = item ? Number(item.orderQty ?? 0) : 0;
  const taggedQty = tags.reduce((s, t) => s + t.qty, 0);
  const remainingQty = orderQty - taggedQty;
  const sku = String(item?.productSku ?? item?.sku ?? "-");
  const productName = String(item?.productName ?? "-");
  const warehouseCode = String(item?.warehouseCode ?? "");
  const customerCode = String(item?.customerCode ?? "");

  /* ── generate a new stow tag ── */
  async function generateTag() {
    if (!item || !tagQty || Number(tagQty) <= 0) return;
    const tagNo = tags.length + 1;
    const itemId = String(item.receiveItemId ?? item.itemId ?? idx);
    const barcodeValue = `${code}::${itemId}-T${tagNo}`;

    const labelData: LabelData = {
      barcodeValue,
      orderCode: code,
      sku,
      productName,
      lotNo: lotNo || undefined,
      expireDate: expireDate || undefined,
      qty: Number(tagQty),
      warehouseCode: warehouseCode || undefined,
      customerCode: customerCode || undefined,
    };

    const newTag: StowTag = {
      id: Date.now(),
      tagNo,
      barcodeValue,
      qty: Number(tagQty),
      lotNo,
      expireDate,
      labelData,
    };

    setTags((prev) => [...prev, newTag]);
    setTagQty(""); // reset qty for next tag

    // Persist to server (Upstash Redis) so all devices can see it
    await addStowTag({
      id: newTag.id,
      tagNo,
      orderCode: code,
      barcodeValue,
      qty: Number(tagQty),
      lotNo,
      expireDate,
      sku,
      productName,
      warehouseCode,
      warehouseCd:   String(item.warehouseCd ?? item.warehouseId ?? warehouseCode),
      customerCode,
      receiveItemId: Number(item.receiveItemId ?? item.itemId ?? idx),
      itemCondition: String(item.itemCondition ?? item.condition ?? "GOOD"),
    });

    triggerPrint(newTag);
  }

  function triggerPrint(tag: StowTag) {
    setPrintingTag(tag);
    setPrintKey((k) => k + 1);
  }

  /* ── complete & go back ── */
  function complete() {
    if (!item) return;
    const storageKey = `wms_receiving_${code}`;
    let completed: string[] = [];
    try { completed = JSON.parse(localStorage.getItem(storageKey) ?? "[]"); } catch {}
    const key = String(item.productSku ?? item.sku ?? idx);
    if (!completed.includes(key)) completed.push(key);
    localStorage.setItem(storageKey, JSON.stringify(completed));
    router.push(`/receiving/process/${code}`);
  }

  /* ── loading / not found ── */
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
        <button
          onClick={() => router.push(`/receiving/process/${code}`)}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <p className="text-slate-500">Item not found.</p>
      </div>
    );
  }

  const canGenerate = Number(tagQty) > 0 && remainingQty > 0;

  return (
    <>
      {/* ═══════════════════════════════════
          Hidden print-only area
          Shown ONLY when window.print() fires
          ═══════════════════════════════════ */}
      {printingTag && (
        <div id="stow-print-area" key={printKey}>
          <BarcodeLabel data={printingTag.labelData} />
        </div>
      )}

      {/* Print CSS */}
      <style jsx global>{`
        @media print {
          body > * { visibility: hidden; }
          #stow-print-area,
          #stow-print-area * { visibility: visible; }
          #stow-print-area {
            position: fixed;
            top: 0; left: 0;
          }
        }
        @media screen {
          #stow-print-area { display: none; }
        }
      `}</style>

      {/* ═══════════════════════════════════
          Main screen layout
          ═══════════════════════════════════ */}
      <div className="p-6 max-w-5xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => router.push(`/receiving/process/${code}`)}
            className="text-slate-400 hover:text-slate-700 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Inspect Item</h1>
            <p className="text-slate-500 text-xs font-mono mt-0.5">{code}</p>
          </div>
        </div>

        {/* Item info card */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-5 py-4 mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold text-slate-900 text-sm">{productName}</p>
              <p className="text-slate-500 font-mono text-xs mt-0.5">{sku}</p>
              <div className="flex flex-wrap gap-5 mt-2 text-xs text-slate-500">
                <span>Order Qty: <span className="font-semibold text-slate-800">{orderQty}</span></span>
                {lotNo && <span>LOT: <span className="font-semibold text-slate-800">{lotNo}</span></span>}
                {expireDate && (
                  <span>Exp: <span className="font-semibold text-slate-800">{expireDate.slice(0, 10)}</span></span>
                )}
              </div>
            </div>
            {/* Progress pill */}
            <div className="flex-shrink-0 text-right">
              <div className="text-xs text-slate-500">Tagged / Total</div>
              <div className="text-lg font-bold text-slate-900 tabular-nums">
                {taggedQty} <span className="text-slate-400 text-sm font-normal">/ {orderQty}</span>
              </div>
              {remainingQty > 0 ? (
                <div className="text-xs text-amber-600 font-medium mt-0.5">
                  {remainingQty} remaining
                </div>
              ) : (
                <div className="text-xs text-green-600 font-medium mt-0.5">All tagged ✓</div>
              )}
            </div>
          </div>

          {/* Progress bar */}
          {orderQty > 0 && (
            <div className="mt-3 h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, (taggedQty / orderQty) * 100)}%` }}
              />
            </div>
          )}
        </div>

        {/* 2-column layout */}
        <div className="flex gap-5 items-start">
          {/* ── LEFT: Tag generation form ── */}
          <div className="flex-1 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Tag className="w-4 h-4 text-blue-500" />
              Generate Stow Tag
            </h2>

            <div>
              <label className="text-xs text-slate-500 uppercase tracking-wide mb-1.5 block">
                Tag Qty <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                value={tagQty}
                onChange={(e) => setTagQty(e.target.value)}
                min={1}
                max={remainingQty > 0 ? remainingQty : undefined}
                autoFocus
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={`Enter qty (remaining: ${remainingQty})`}
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

            <button
              onClick={generateTag}
              disabled={!canGenerate}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-100 disabled:text-slate-400 text-white font-medium py-3 rounded-xl text-sm transition-colors"
            >
              <Printer className="w-4 h-4" />
              Generate &amp; Print Tag
            </button>

            <div className="border-t border-slate-100 pt-4">
              <button
                onClick={complete}
                className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
              >
                <CheckCircle2 className="w-4 h-4" />
                Complete Inspection
              </button>
            </div>
          </div>

          {/* ── RIGHT: Stow tag list ── */}
          <div className="w-72 flex-shrink-0">
            <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <Tag className="w-4 h-4 text-slate-400" />
              Stow Tags
              {tags.length > 0 && (
                <span className="ml-auto bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded-full">
                  {tags.length}
                </span>
              )}
            </h2>

            {tags.length === 0 ? (
              <div className="border border-dashed border-slate-200 rounded-xl p-6 text-center text-slate-400 text-sm">
                No tags yet.
                <br />
                <span className="text-xs">Generate your first stow tag →</span>
              </div>
            ) : (
              <div className="space-y-2">
                {tags.map((tag) => (
                  <div
                    key={tag.id}
                    className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                          T{tag.tagNo}
                        </span>
                        <span className="text-sm font-semibold text-slate-900 tabular-nums">
                          {tag.qty} units
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-400 space-y-0.5">
                        {tag.lotNo && <div>LOT: {tag.lotNo}</div>}
                        {tag.expireDate && <div>EXP: {tag.expireDate.slice(0, 10)}</div>}
                        <div className="font-mono text-slate-300 truncate">{tag.barcodeValue}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => triggerPrint(tag)}
                      title="Reprint"
                      className="flex-shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
