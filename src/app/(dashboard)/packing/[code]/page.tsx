"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/auth-context";
import { Printer, ArrowLeft, Package, Plus, X, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ScanItem, PackingStorageData } from "../page";

/* ─── Types ─────────────────────────────────────────────────────────────────── */

/** One row in the packing assignment grid: a subset qty of a sku/lot going to a specific box */
type PackLine = {
  id: string;          // unique row id (uuid-ish)
  sku: string;
  lot: string;
  productName: string;
  location: string;
  qty: number;         // qty allocated to this box
  boxNo: number;
  palletNo: number;
};

/** Summary of one box */
type BoxSummary = {
  boxNo: number;
  palletNo: number;
  lines: PackLine[];
  totalQty: number;
};

/* ─── Helpers ────────────────────────────────────────────────────────────────── */

function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

function buildBoxSummaries(lines: PackLine[]): BoxSummary[] {
  const map: Record<string, BoxSummary> = {};
  for (const line of lines) {
    const key = `${line.boxNo}__${line.palletNo}`;
    if (!map[key]) map[key] = { boxNo: line.boxNo, palletNo: line.palletNo, lines: [], totalQty: 0 };
    map[key].lines.push(line);
    map[key].totalQty += line.qty;
  }
  return Object.values(map).sort((a, b) =>
    a.boxNo !== b.boxNo ? a.boxNo - b.boxNo : a.palletNo - b.palletNo
  );
}

/* ─── Print ──────────────────────────────────────────────────────────────────── */

function printPackingList(
  orderCode: string,
  customerCode: string,
  customerName: string,
  lines: PackLine[]
) {
  const boxes = buildBoxSummaries(lines);
  const totalBoxes = boxes.length;

  const labels = boxes
    .map((box, gi) => {
      const qrData = encodeURIComponent(`${orderCode}-BOX${box.boxNo}`);
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=80x80&margin=2&color=000000&bgcolor=ffffff&data=${qrData}`;

      const rows = box.lines
        .map((line, ri) => {
          return `
          <tr>
            <td style="border:1px solid #000;padding:2px 4px;text-align:center;">${ri + 1}</td>
            <td style="border:1px solid #000;padding:2px 4px;">
              ${line.location ? `<span style="font-size:7pt;">${line.location}</span><br>` : ""}
              <span style="font-weight:bold;font-family:monospace;">${line.sku}</span><br>
              ${line.lot ? `<span style="font-size:7pt;">Lot: ${line.lot}</span><br>` : ""}
              <span style="font-size:8pt;">${line.productName}</span>
            </td>
            <td style="border:1px solid #000;padding:2px 4px;text-align:right;white-space:nowrap;">
              <span style="font-weight:bold;">${line.qty.toLocaleString()} EA</span>
            </td>
          </tr>`;
        })
        .join("");

      const pageBreak = gi > 0 ? `style="page-break-before:always;"` : "";

      return `
      <div ${pageBreak} class="label">
        <div style="text-align:center;margin-bottom:4px;">
          <span style="font-size:11pt;font-weight:bold;letter-spacing:1px;">PACKING LIST</span>
        </div>
        <table style="width:100%;border-collapse:collapse;margin-bottom:4px;">
          <tr>
            <td style="width:70%;">
              <div style="font-size:9pt;">Order No: <span style="font-weight:bold;font-family:monospace;">${orderCode}</span></div>
              <div style="font-size:9pt;">Customer: ${customerName || customerCode || "—"}</div>
              <div style="font-size:9pt;">Box: <span style="font-weight:bold;">${box.boxNo} of ${totalBoxes}</span> &nbsp;|&nbsp; Pallet: <span style="font-weight:bold;">${box.palletNo}</span></div>
            </td>
            <td style="width:30%;text-align:right;vertical-align:top;">
              <img src="${qrUrl}" width="80" height="80" alt="QR" />
            </td>
          </tr>
        </table>
        <table style="width:100%;border-collapse:collapse;font-size:8pt;">
          <thead>
            <tr>
              <th style="border:1px solid #000;padding:2px 4px;text-align:center;width:24px;">No.</th>
              <th style="border:1px solid #000;padding:2px 4px;text-align:left;">Item</th>
              <th style="border:1px solid #000;padding:2px 4px;text-align:right;white-space:nowrap;">Qty</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            <tr>
              <td colspan="2" style="border:1px solid #000;padding:2px 4px;text-align:right;font-weight:bold;">Total</td>
              <td style="border:1px solid #000;padding:2px 4px;text-align:right;font-weight:bold;">${box.totalQty.toLocaleString()} EA</td>
            </tr>
          </tbody>
        </table>
        <div style="margin-top:8px;border-top:1px solid #000;padding-top:4px;font-size:8pt;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="width:33%;text-align:center;border:1px solid #ccc;padding:12px 4px 4px;">Packer: ___________</td>
              <td style="width:33%;text-align:center;border:1px solid #ccc;padding:12px 4px 4px;">Checker: ___________</td>
              <td style="width:33%;text-align:center;border:1px solid #ccc;padding:12px 4px 4px;">Date: ___________</td>
            </tr>
          </table>
        </div>
      </div>`;
    })
    .join("");

  const win = window.open("", "_blank", "width=500,height=860");
  if (!win) return;
  win.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Packing List — ${orderCode}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 9pt; color: #000; margin: 0; padding: 0; background: #f0f0f0; }
  .print-bar { background: #fff; border-bottom: 1px solid #ccc; padding: 8px 12px; display: flex; align-items: center; gap: 12px; }
  .print-bar button { padding: 6px 14px; font-size: 13px; cursor: pointer; background: #1d4ed8; color: #fff; border: none; border-radius: 6px; font-weight: bold; }
  .print-bar span { font-size: 12px; color: #555; }
  .pages { padding: 12px; }
  .label { background: #fff; padding: 4mm 5mm; margin-bottom: 12px; width: 4in; min-height: 6in; box-shadow: 0 1px 4px rgba(0,0,0,0.15); }
  @media print {
    body { background: #fff; }
    .print-bar { display: none !important; }
    .pages { padding: 0; }
    .label { box-shadow: none; margin-bottom: 0; }
    @page { size: 4in 6in; margin: 4mm 5mm; }
  }
</style>
</head>
<body>
<div class="print-bar">
  <button onclick="window.print()">Print (4×6 Zebra)</button>
  <span>Make sure your printer is set to 4×6 label size</span>
</div>
<div class="pages">
${labels}
</div>
</body>
</html>`);
  win.document.close();
}

/* ─── Page ───────────────────────────────────────────────────────────────────── */

export default function PackingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const code = String(params.code ?? "");

  const [data, setData] = useState<PackingStorageData | null>(null);
  const [packLines, setPackLines] = useState<PackLine[]>([]);

  /* ── Load from localStorage ── */
  useEffect(() => {
    try {
      const raw = localStorage.getItem("wms_packing_scan");
      if (!raw) { router.replace("/packing"); return; }
      const parsed: PackingStorageData = JSON.parse(raw);
      if (!parsed.items?.length) { router.replace("/packing"); return; }
      setData(parsed);

      /* One PackLine per scanned item, full qty → Box 1, Pallet 1 */
      setPackLines(
        parsed.items.map((item: ScanItem) => ({
          id: uid(),
          sku: item.sku,
          lot: item.lot,
          productName: item.productName,
          location: item.location,
          qty: item.qty,
          boxNo: 1,
          palletNo: 1,
        }))
      );
    } catch {
      router.replace("/packing");
    }
  }, []); // eslint-disable-line

  useEffect(() => { void user; }, [user]); // suppress unused warning

  /* ── PackLine helpers ── */

  function updateLine(id: string, patch: Partial<PackLine>) {
    setPackLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...patch } : l))
    );
  }

  function removeLine(id: string) {
    setPackLines((prev) => prev.filter((l) => l.id !== id));
  }

  /** Split: add a sibling PackLine for the same sku/lot with qty=0 */
  function splitLine(line: PackLine) {
    const newLine: PackLine = {
      id: uid(),
      sku: line.sku,
      lot: line.lot,
      productName: line.productName,
      location: line.location,
      qty: 0,
      boxNo: line.boxNo + 1,
      palletNo: line.palletNo,
    };
    setPackLines((prev) => {
      // Insert right after the last line with same sku/lot
      const lastIdx = prev.reduce(
        (acc, l, i) => (l.sku === line.sku && l.lot === line.lot ? i : acc),
        -1
      );
      const next = [...prev];
      next.splice(lastIdx + 1, 0, newLine);
      return next;
    });
  }

  /* ── Validation per sku/lot ── */
  function getRemaining(sku: string, lot: string): number {
    if (!data) return 0;
    const total = data.items.find((i: ScanItem) => i.sku === sku && i.lot === lot)?.qty ?? 0;
    const assigned = packLines
      .filter((l) => l.sku === sku && l.lot === lot)
      .reduce((s, l) => s + (l.qty || 0), 0);
    return total - assigned;
  }

  /* ── Derived state ── */
  const boxSummaries = buildBoxSummaries(packLines);
  const hasError = data
    ? data.items.some((item: ScanItem) => getRemaining(item.sku, item.lot) !== 0)
    : false;

  /* ── Group pack lines by sku/lot for display ── */
  type ItemGroup = { sku: string; lot: string; totalQty: number; lines: PackLine[] };
  const itemGroups: ItemGroup[] = [];
  if (data) {
    for (const item of data.items as ScanItem[]) {
      itemGroups.push({
        sku: item.sku,
        lot: item.lot,
        totalQty: item.qty,
        lines: packLines.filter((l) => l.sku === item.sku && l.lot === item.lot),
      });
    }
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto pb-12">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
            <Package className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Packing — Box Assignment</h1>
            <p className="text-sm text-slate-500">
              Order: <span className="font-mono font-semibold">{code}</span>
              {data.customerName ? ` · ${data.customerName}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/packing"
            className="flex items-center gap-2 px-4 py-2 text-slate-600 border border-slate-200 rounded-xl text-sm hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Scan
          </Link>
          <button
            onClick={() =>
              printPackingList(
                data.orderCode,
                data.customerCode,
                data.customerName,
                packLines
              )
            }
            disabled={hasError}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Printer className="w-4 h-4" />
            Print Packing List
          </button>
        </div>
      </div>

      {hasError && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>Some items have unallocated quantities. Adjust split rows so all quantities add up to 0 remaining.</span>
        </div>
      )}

      {/* ── Item Groups ── */}
      <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Item Assignment</h2>
          <span className="text-xs text-slate-400">Split rows to pack the same SKU into multiple boxes</span>
        </div>

        <div className="divide-y divide-slate-100">
          {itemGroups.map((group) => {
            const remaining = getRemaining(group.sku, group.lot);
            const isOk = remaining === 0;

            return (
              <div key={`${group.sku}__${group.lot}`} className="p-4">
                {/* Item header */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm text-slate-800">{group.sku}</span>
                      {group.lot && (
                        <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-mono">
                          {group.lot}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      {group.lines[0]?.productName || "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-xs text-slate-400 uppercase tracking-wide">Total</div>
                      <div className="font-semibold text-sm text-slate-800">{group.totalQty.toLocaleString()} EA</div>
                    </div>
                    <div className={`text-right min-w-[72px] ${isOk ? "text-emerald-600" : "text-red-500"}`}>
                      <div className="text-xs uppercase tracking-wide">Remaining</div>
                      <div className="font-semibold text-sm flex items-center justify-end gap-1">
                        {isOk ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5" />
                        )}
                        {remaining} EA
                      </div>
                    </div>
                  </div>
                </div>

                {/* Pack lines for this item */}
                <div className="space-y-2 ml-2">
                  {group.lines.map((line, li) => (
                    <div
                      key={line.id}
                      className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2"
                    >
                      <span className="text-xs text-slate-400 w-5 text-center">{li + 1}</span>

                      {/* Qty */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-400">Qty</span>
                        <input
                          type="number"
                          min={0}
                          value={line.qty}
                          onChange={(e) =>
                            updateLine(line.id, { qty: Math.max(0, parseInt(e.target.value, 10) || 0) })
                          }
                          className="w-20 text-right border border-slate-200 rounded-lg px-2 py-1 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                        />
                        <span className="text-xs text-slate-400">EA</span>
                      </div>

                      <div className="w-px h-5 bg-slate-200" />

                      {/* Box # */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-400">Box</span>
                        <input
                          type="number"
                          min={1}
                          value={line.boxNo}
                          onChange={(e) =>
                            updateLine(line.id, { boxNo: Math.max(1, parseInt(e.target.value, 10) || 1) })
                          }
                          className="w-14 text-right border border-slate-200 rounded-lg px-2 py-1 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                        />
                      </div>

                      {/* Pallet # */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-400">Pallet</span>
                        <input
                          type="number"
                          min={1}
                          value={line.palletNo}
                          onChange={(e) =>
                            updateLine(line.id, { palletNo: Math.max(1, parseInt(e.target.value, 10) || 1) })
                          }
                          className="w-14 text-right border border-slate-200 rounded-lg px-2 py-1 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                        />
                      </div>

                      {/* Remove (only if more than 1 line in group) */}
                      {group.lines.length > 1 && (
                        <button
                          onClick={() => removeLine(line.id)}
                          className="ml-auto p-1 text-slate-300 hover:text-red-400 transition-colors"
                          title="Remove this row"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Add split button */}
                  <button
                    onClick={() => splitLine(group.lines[group.lines.length - 1])}
                    className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 px-3 py-1.5 hover:bg-blue-50 rounded-lg transition-colors ml-2"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Split into another box
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Live Packing List ── */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <Package className="w-4 h-4 text-blue-500" />
          Packing List Preview
          <span className="text-xs text-slate-400 font-normal">
            — {boxSummaries.length} box{boxSummaries.length !== 1 ? "es" : ""}
            {boxSummaries.length > 0 && ` · ${boxSummaries.reduce((s, b) => s + b.totalQty, 0).toLocaleString()} EA total`}
          </span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {boxSummaries.map((box) => (
            <div
              key={`${box.boxNo}__${box.palletNo}`}
              className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden"
            >
              {/* Box header */}
              <div className="bg-blue-600 px-4 py-2 flex items-center justify-between">
                <div>
                  <span className="text-white font-bold text-sm">Box {box.boxNo}</span>
                  <span className="text-blue-200 text-xs ml-2">Pallet {box.palletNo}</span>
                </div>
                <span className="text-blue-100 text-xs">
                  {box.totalQty.toLocaleString()} EA
                </span>
              </div>

              {/* Box items */}
              <div className="divide-y divide-slate-100">
                {box.lines.map((line) => (
                  <div key={line.id} className="px-4 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-semibold text-slate-800 truncate">
                          {line.sku}
                        </div>
                        {line.lot && (
                          <div className="text-xs text-slate-400 mt-0.5">Lot: {line.lot}</div>
                        )}
                        {line.productName && (
                          <div className="text-xs text-slate-500 mt-0.5 truncate">{line.productName}</div>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="font-bold text-sm text-slate-800">{line.qty.toLocaleString()} EA</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Box footer total */}
              <div className="bg-slate-50 border-t border-slate-200 px-4 py-2 flex justify-between items-center">
                <span className="text-xs text-slate-500">{box.lines.length} item{box.lines.length !== 1 ? "s" : ""}</span>
                <span className="text-xs font-semibold text-slate-700">
                  Total: {box.totalQty.toLocaleString()} EA
                </span>
              </div>
            </div>
          ))}

          {boxSummaries.length === 0 && (
            <div className="col-span-3 py-8 text-center text-slate-400 text-sm">
              No boxes assigned yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
