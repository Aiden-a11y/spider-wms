"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import { Printer, ArrowLeft, Package } from "lucide-react";
import type { ScanItem, PackingStorageData } from "../page";

/* ── Types ── */
type Assignment = { boxNo: number; palletNo: number };
type Assignments = Record<string, Assignment>; // key: `${sku}__${lot}`

interface BoxGroup {
  boxNo: number;
  palletNo: number;
  items: ScanItem[];
  totalQty: number;
}

/* ── Helper: group items by box → pallet ── */
function buildBoxGroups(items: ScanItem[], assignments: Assignments): BoxGroup[] {
  const map: Record<string, BoxGroup> = {};
  for (const item of items) {
    const key = `${item.sku}__${item.lot}`;
    const { boxNo, palletNo } = assignments[key] ?? { boxNo: 1, palletNo: 1 };
    const groupKey = `${boxNo}__${palletNo}`;
    if (!map[groupKey]) {
      map[groupKey] = { boxNo, palletNo, items: [], totalQty: 0 };
    }
    map[groupKey].items.push(item);
    map[groupKey].totalQty += item.qty;
  }
  return Object.values(map).sort((a, b) =>
    a.boxNo !== b.boxNo ? a.boxNo - b.boxNo : a.palletNo - b.palletNo
  );
}

/* ── Print packing list ── */
function printPackingList(
  orderCode: string,
  customerCode: string,
  customerName: string,
  items: ScanItem[],
  assignments: Assignments,
  uomMap: Record<string, number>
) {
  const groups = buildBoxGroups(items, assignments);
  const totalBoxes = groups.length;

  const labels = groups
    .map((group, gi) => {
      const qrData = encodeURIComponent(`${orderCode}-BOX${group.boxNo}`);
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=80x80&margin=2&color=000000&bgcolor=ffffff&data=${qrData}`;

      const rows = group.items
        .map((item, ri) => {
          const upc = uomMap[item.sku] ?? 0;
          const ctnQty = upc > 0 ? Math.floor(item.qty / upc) : 0;
          return `
          <tr>
            <td style="border:1px solid #000;padding:2px 4px;text-align:center;">${ri + 1}</td>
            <td style="border:1px solid #000;padding:2px 4px;">
              ${item.location ? `<span style="font-size:7pt;">${item.location}</span><br>` : ""}
              <span style="font-weight:bold;font-family:monospace;">${item.sku}</span><br>
              ${item.lot ? `<span style="font-size:7pt;">Lot: ${item.lot}</span><br>` : ""}
              <span style="font-size:8pt;">${item.productName}</span>
            </td>
            <td style="border:1px solid #000;padding:2px 4px;text-align:right;white-space:nowrap;">
              <span style="font-weight:bold;">${item.qty.toLocaleString()} EA</span>
              ${ctnQty > 0 ? `<br><span style="font-weight:bold;">${ctnQty} CTN</span>` : ""}
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
              <div>Order No: <span style="font-weight:bold;">${orderCode}</span></div>
              <div>Customer: ${customerName || customerCode || "—"}</div>
              <div>Box: <span style="font-weight:bold;">${group.boxNo} of ${totalBoxes}</span> &nbsp;|&nbsp; Pallet: <span style="font-weight:bold;">${group.palletNo}</span></div>
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
              <td style="border:1px solid #000;padding:2px 4px;text-align:right;font-weight:bold;">${group.totalQty.toLocaleString()} EA</td>
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

/* ── Page component ── */
export default function PackingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const code = String(params.code ?? "");

  const [data, setData] = useState<PackingStorageData | null>(null);
  const [assignments, setAssignments] = useState<Assignments>({});
  const [uomMap, setUomMap] = useState<Record<string, number>>({});

  /* Load from localStorage */
  useEffect(() => {
    try {
      const raw = localStorage.getItem("wms_packing_scan");
      if (!raw) { router.replace("/packing"); return; }
      const parsed: PackingStorageData = JSON.parse(raw);
      if (!parsed.items?.length) { router.replace("/packing"); return; }
      setData(parsed);

      /* Initialize assignments: all boxNo=1, palletNo=1 */
      const init: Assignments = {};
      for (const item of parsed.items) {
        const key = `${item.sku}__${item.lot}`;
        init[key] = { boxNo: 1, palletNo: 1 };
      }
      setAssignments(init);
    } catch {
      router.replace("/packing");
    }
  }, []); // eslint-disable-line

  /* Fetch UOM from Supabase */
  const fetchUom = useCallback(async (skus: string[]) => {
    if (!supabase || skus.length === 0) return;
    try {
      const { data: rows } = await supabase
        .from("product_uom")
        .select("sku, units_per_carton")
        .in("sku", skus);
      if (rows) {
        const map: Record<string, number> = {};
        for (const r of rows as Array<{ sku: string; units_per_carton: number }>) {
          map[r.sku] = r.units_per_carton;
        }
        setUomMap(map);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (data?.items) {
      // suppress unused user warning — token available if needed
      void user;
      fetchUom(data.items.map((i) => i.sku));
    }
  }, [data, fetchUom, user]);

  function setBox(itemKey: string, value: number) {
    setAssignments((prev) => ({
      ...prev,
      [itemKey]: { ...prev[itemKey], boxNo: Math.max(1, value) },
    }));
  }

  function setPallet(itemKey: string, value: number) {
    setAssignments((prev) => ({
      ...prev,
      [itemKey]: { ...prev[itemKey], palletNo: Math.max(1, value) },
    }));
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        Loading…
      </div>
    );
  }

  const boxGroups = buildBoxGroups(data.items, assignments);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
      {/* Header */}
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
                data.items,
                assignments,
                uomMap
              )
            }
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Printer className="w-4 h-4" />
            Print Packing List
          </button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Left: item assignment table */}
        <div className="flex-1 min-w-0">
          <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide w-8">#</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">SKU</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Product</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Lot</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Qty</th>
                  <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide w-20">Box #</th>
                  <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide w-20">Pallet #</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item, idx) => {
                  const itemKey = `${item.sku}__${item.lot}`;
                  const asgn = assignments[itemKey] ?? { boxNo: 1, palletNo: 1 };
                  return (
                    <tr key={itemKey} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2.5 text-center text-slate-400 text-xs">{idx + 1}</td>
                      <td className="px-4 py-2.5 font-mono font-semibold text-slate-800 text-xs">{item.sku}</td>
                      <td className="px-4 py-2.5 text-slate-700 text-xs max-w-[180px] truncate">{item.productName}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-500 text-xs">{item.lot || "—"}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{item.qty.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="number"
                          min={1}
                          value={asgn.boxNo}
                          onChange={(e) => setBox(itemKey, parseInt(e.target.value, 10) || 1)}
                          className="w-14 text-right border border-slate-200 rounded-lg px-2 py-1 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                        />
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="number"
                          min={1}
                          value={asgn.palletNo}
                          onChange={(e) => setPallet(itemKey, parseInt(e.target.value, 10) || 1)}
                          className="w-14 text-right border border-slate-200 rounded-lg px-2 py-1 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Box summary */}
        <div className="w-64 flex-shrink-0">
          <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5">
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Box Summary</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {boxGroups.length === 0 ? (
                <p className="px-4 py-4 text-sm text-slate-400">No boxes assigned yet</p>
              ) : (
                boxGroups.map((group) => (
                  <div key={`${group.boxNo}__${group.palletNo}`} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold text-slate-800">
                        Box {group.boxNo} (Pallet {group.palletNo})
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mb-2">
                      {group.items.length} item{group.items.length !== 1 ? "s" : ""}, {group.totalQty.toLocaleString()} EA
                    </p>
                    <ul className="space-y-0.5">
                      {group.items.map((item) => (
                        <li key={`${item.sku}__${item.lot}`} className="text-xs text-slate-600 font-mono truncate">
                          {item.sku}
                          {item.lot ? ` · ${item.lot}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
