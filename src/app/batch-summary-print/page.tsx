"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Loader2, Printer } from "lucide-react";
import type { Batch } from "@/app/api/batch/route";

function PrintInner() {
  const searchParams = useSearchParams();
  const batchId = searchParams.get("id") ?? "";
  const { user } = useAuth();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  const [batch, setBatch] = useState<Batch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!batchId) { setError("No batch ID"); setLoading(false); return; }
    (async () => {
      try {
        const [activeRes, doneRes] = await Promise.all([
          fetch("/api/batch", { headers }),
          fetch("/api/batch?completed=1", { headers }),
        ]);
        const [activeData, doneData] = await Promise.all([
          activeRes.json().catch(() => []),
          doneRes.json().catch(() => []),
        ]);
        const all: Batch[] = [
          ...(Array.isArray(activeData) ? activeData : []),
          ...(Array.isArray(doneData) ? doneData : []),
        ];
        const found = all.find((b) => b.id === batchId);
        if (found) { setBatch(found); } else { setError("Batch not found"); }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load batch");
      } finally {
        setLoading(false);
      }
    })();
  }, [batchId]); // eslint-disable-line

  if (loading) return (
    <div className="flex items-center justify-center h-screen gap-2 text-slate-400">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span>Loading…</span>
    </div>
  );

  if (error || !batch) return (
    <div className="flex items-center justify-center h-screen text-red-500">{error || "Not found"}</div>
  );

  const createdDate = new Date(batch.createdAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  const createdTime = new Date(batch.createdAt).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
  const completedDate = batch.completedAt ? new Date(batch.completedAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  }) : null;
  const completedTime = batch.completedAt ? new Date(batch.completedAt).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: true,
  }) : null;

  return (
    <>
      {/* Print button — hidden when printing */}
      <div className="no-print flex items-center gap-3 p-4 bg-slate-50 border-b border-slate-200">
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-700 transition-colors"
        >
          <Printer className="w-4 h-4" /> Print
        </button>
        <span className="text-sm text-slate-500">4×6 label · {batch.orderCount} orders · {batch.skuList.length} SKU{batch.skuList.length !== 1 ? "s" : ""}</span>
      </div>

      {/* 4x6 label */}
      <div className="label-page">
        {/* Header */}
        <div className="label-header">
          <div className="label-title">BATCH PICK SUMMARY</div>
          <div className="label-meta">{batch.warehouseCode} · {batch.type?.toUpperCase()}</div>
        </div>

        {/* Order count */}
        <div className="label-orders-row">
          <span className="label-count">{batch.orderCount}</span>
          <span className="label-count-label">ORDERS</span>
        </div>

        {/* Divider */}
        <div className="label-divider" />

        {/* SKU list */}
        <div className="label-sku-header">SKU LIST</div>
        <table className="label-sku-table">
          <thead>
            <tr>
              <th className="label-th-sku">SKU</th>
              <th className="label-th-name">Product</th>
              <th className="label-th-qty">QTY / ORDER</th>
              <th className="label-th-total">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {batch.skuList.map(({ sku, name, qty }) => (
              <tr key={sku} className="label-tr">
                <td className="label-td-sku">{sku}</td>
                <td className="label-td-name">{name || "—"}</td>
                <td className="label-td-qty">{qty}</td>
                <td className="label-td-total">{qty * batch.orderCount}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Divider */}
        <div className="label-divider" />

        {/* Footer dates */}
        <div className="label-footer">
          <div>Created: {createdDate} {createdTime}</div>
          {completedDate && <div>Closed: {completedDate} {completedTime}</div>}
        </div>
      </div>

      <style>{`
        @page {
          size: 4in 6in;
          margin: 0;
        }
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; background: white; }

        .no-print { display: flex; }
        @media print { .no-print { display: none !important; } }

        .label-page {
          width: 4in;
          height: 6in;
          padding: 0.2in 0.25in;
          font-family: 'Arial', sans-serif;
          display: flex;
          flex-direction: column;
          background: white;
        }

        .label-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.1in;
        }
        .label-title {
          font-size: 13pt;
          font-weight: 900;
          letter-spacing: 0.02em;
          color: #000;
        }
        .label-meta {
          font-size: 9pt;
          color: #555;
          text-align: right;
        }

        .label-orders-row {
          display: flex;
          align-items: baseline;
          gap: 0.08in;
          margin-bottom: 0.1in;
        }
        .label-count {
          font-size: 36pt;
          font-weight: 900;
          color: #000;
          line-height: 1;
        }
        .label-count-label {
          font-size: 12pt;
          font-weight: 700;
          color: #333;
          letter-spacing: 0.05em;
        }

        .label-divider {
          border-top: 1.5px solid #000;
          margin: 0.08in 0;
        }

        .label-sku-header {
          font-size: 8pt;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: #555;
          margin-bottom: 0.06in;
        }

        .label-sku-table {
          width: 100%;
          border-collapse: collapse;
          flex: 1;
        }
        .label-th-sku  { font-size: 8pt; font-weight: 700; text-align: left;  padding: 2px 3px; border-bottom: 1px solid #ccc; width: 30%; }
        .label-th-name { font-size: 8pt; font-weight: 700; text-align: left;  padding: 2px 3px; border-bottom: 1px solid #ccc; }
        .label-th-qty  { font-size: 8pt; font-weight: 700; text-align: right; padding: 2px 3px; border-bottom: 1px solid #ccc; width: 14%; white-space: nowrap; }
        .label-th-total{ font-size: 8pt; font-weight: 700; text-align: right; padding: 2px 3px; border-bottom: 1px solid #ccc; width: 12%; }

        .label-tr:nth-child(even) { background: #f5f5f5; }
        .label-td-sku  { font-size: 8.5pt; font-family: 'Courier New', monospace; font-weight: 700; padding: 3px 3px; color: #000; }
        .label-td-name { font-size: 7.5pt; padding: 3px 3px; color: #333; max-width: 1.5in; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .label-td-qty  { font-size: 9pt; font-weight: 600; text-align: right; padding: 3px 3px; color: #000; }
        .label-td-total{ font-size: 9pt; font-weight: 900; text-align: right; padding: 3px 3px; color: #000; }

        .label-footer {
          font-size: 7.5pt;
          color: #666;
          margin-top: auto;
          padding-top: 0.06in;
          border-top: 1px solid #ddd;
          display: flex;
          justify-content: space-between;
        }
      `}</style>
    </>
  );
}

export default function BatchSummaryPrintPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen gap-2 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" />Loading…</div>}>
      <PrintInner />
    </Suspense>
  );
}
