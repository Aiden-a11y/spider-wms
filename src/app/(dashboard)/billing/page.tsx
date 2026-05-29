"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import {
  Receipt,
  RefreshCw,
  Plus,
  Download,
  Trash2,
  ChevronDown,
  ChevronUp,
  CloudDownload,
  CheckCircle2,
  FileText,
  X,
  AlertCircle,
  Table2,
  Upload,
  BarChart3,
  Calculator,
  Building2,
} from "lucide-react";

// Raw WMS orders collected during auto-fetch (shown in Source Data panel)
type WmsSource = {
  receiving: Record<string, unknown>[];
  b2b:       Record<string, unknown>[];
  b2c:       Record<string, unknown>[];
  returns:   Record<string, unknown>[];
  b2bWarnings?: string[]; // order codes where piece picking exists but no Out info
};

type StorageRow = {
  key: string; // StorageRateKey
  label: string;
  qty15: number;
  qtyLast: number;
  avg: number;
};

// ── Task comment parser ───────────────────────────────────────────────────────
// Parses "existing comment | Labels×5, Picking per Piece×12, Out per Carton×3"
// Returns map of task type → qty
function parseTaskComment(comment: string): Record<string, number> {
  const result: Record<string, number> = {};
  if (!comment) return result;
  // Take the part after the last " | " separator (task section)
  const parts = comment.split(" | ");
  const taskPart = parts[parts.length - 1];
  // Match "TaskName×qty" pairs
  const re = /([^,]+?)×(\d+(?:\.\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(taskPart)) !== null) {
    const type = match[1].trim();
    const qty  = parseFloat(match[2]);
    if (type && !isNaN(qty)) result[type] = (result[type] ?? 0) + qty;
  }
  return result;
}
import ExcelJS from "exceljs";
import {
  buildNewInvoice,
  buildDefaultLineItems,
  applyRateMaster,
  calcLineAmount,
  calcSubtotals,
  calcTotal,
  formatUSD,
  type BillingInvoice,
  type BillingLineItem,
  type CustomerRateMaster,
} from "@/lib/billing-calc";
import { BILLING_CATEGORIES, RATE_VERSION } from "@/lib/billing-rates";
import type { BillingCategory } from "@/lib/billing-rates";
import { buildLocationOccupancyLookup, getLocationOccupancyInfo } from "@/lib/wms";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function periodLabel(period: string): string {
  const [y, m] = period.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const CATEGORY_COLOR: Record<BillingCategory, string> = {
  "Inbound Handling":  "bg-blue-50 border-blue-200 text-blue-800",
  "Storage":           "bg-purple-50 border-purple-200 text-purple-800",
  "Fulfillment B2B":   "bg-emerald-50 border-emerald-200 text-emerald-800",
  "Fulfillment B2C":   "bg-teal-50 border-teal-200 text-teal-800",
  "Return Management": "bg-orange-50 border-orange-200 text-orange-800",
  "Warehouse Labor":   "bg-red-50 border-red-200 text-red-800",
};

// ─── Excel helpers (ExcelJS — styled) ────────────────────────────────────────

// Color palette (ARGB hex, no #)
const C = {
  black:       "FF000000",
  white:       "FFFFFFFF",
  navy:        "FF1B2F55",   // company header bg
  blue:        "FF2E5FA3",   // column header bg
  sectionBg:   "FFBDD7EE",  // numbered section header bg (light blue)
  sectionFont: "FF1B2F55",  // section header text (dark navy)
  teal:        "FF006B6B",  // rate value color
  subtotalBg:  "FFF2F2F2",  // subtotal row bg
  greenBg:     "FF375623",  // grand total bg (dark green)
  rowAlt:      "FFFAFAFA",  // alternate data row bg
  border:      "FFAAAAAA",
};

// 7-column layout: No. | Category | Description | Rate | Unit | Qty | Amount
const COL_WIDTHS_7 = [6, 20, 38, 14, 12, 10, 16];
const NCOLS = 7;
const LAST_COL_LETTER = "G";

function applyBorder(cell: ExcelJS.Cell, style: ExcelJS.BorderStyle = "thin") {
  const color = { argb: C.border };
  cell.border = {
    top: { style, color }, bottom: { style, color },
    left: { style, color }, right: { style, color },
  };
}

function mergeRow(ws: ExcelJS.Worksheet, rowNum: number) {
  ws.mergeCells(`A${rowNum}:${LAST_COL_LETTER}${rowNum}`);
}

/** Build the last day of a "YYYY-MM" period as a readable string */
function periodRange(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const month = MONTHS[m - 1] ?? period;
  return `${month} 1 – ${month} ${lastDay}, ${y}`;
}

/** Fill one ExcelJS worksheet with the styled invoice layout */
function fillInvoiceSheet(ws: ExcelJS.Worksheet, invoice: BillingInvoice) {
  ws.columns = COL_WIDTHS_7.map((w) => ({ width: w }));

  // ── Row 1: Company header ──
  const r1 = ws.addRow(["CTK USA, INC."]);
  r1.height = 28;
  mergeRow(ws, r1.number);
  const c1 = r1.getCell(1);
  c1.font = { bold: true, size: 16, color: { argb: C.white }, name: "Calibri" };
  c1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } };
  c1.alignment = { vertical: "middle", horizontal: "center" };
  applyBorder(c1, "medium");

  // ── Row 2: Invoice for customer ──
  const r2 = ws.addRow([`Invoice for ${invoice.customerName || invoice.customer}`]);
  r2.height = 20;
  mergeRow(ws, r2.number);
  const c2 = r2.getCell(1);
  c2.font = { bold: true, size: 12, color: { argb: C.navy } };
  c2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.white } };
  c2.alignment = { vertical: "middle", horizontal: "center" };
  applyBorder(c2);

  // ── Row 3: Billing period ──
  const r3 = ws.addRow([`Billing Period: ${periodRange(invoice.period)}`]);
  r3.height = 18;
  mergeRow(ws, r3.number);
  const c3 = r3.getCell(1);
  c3.font = { size: 11, color: { argb: C.black } };
  c3.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.white } };
  c3.alignment = { vertical: "middle", horizontal: "center" };
  applyBorder(c3);

  // ── Row 4: Column headers ──
  const hdrRow = ws.addRow(["No.", "Category", "Description", "Rate", "Unit", "Qty", "Amount"]);
  hdrRow.height = 18;
  hdrRow.eachCell((cell, col) => {
    cell.font = { bold: true, color: { argb: C.white }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.blue } };
    cell.alignment = {
      vertical: "middle",
      horizontal: col <= 3 ? "center" : "right",
    };
    applyBorder(cell, "medium");
  });

  // ── Category sections ──
  let lineNo = 1;
  let sectionNo = 1;

  for (const cat of BILLING_CATEGORIES) {
    const catItems = invoice.lineItems.filter((l) => l.category === cat);
    if (catItems.length === 0) continue;

    // Section header row (light blue, numbered)
    const secRow = ws.addRow([`${sectionNo}. ${cat}`]);
    secRow.height = 16;
    mergeRow(ws, secRow.number);
    const secCell = secRow.getCell(1);
    secCell.font = { bold: true, size: 10, color: { argb: C.sectionFont } };
    secCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.sectionBg } };
    secCell.alignment = { vertical: "middle", indent: 1 };
    applyBorder(secCell, "medium");
    sectionNo++;

    // Data rows — all items including qty=0
    for (const item of catItems) {
      const amt = calcLineAmount(item);
      const rateDisplay = item.costPlus ? "cost+10%" : item.rate;
      // Round qty to avoid floating-point noise, then pick format based on whether it's an integer
      const qtyVal = Math.round(item.qty * 100) / 100;
      const qtyFmt = Number.isInteger(qtyVal) ? "#,##0" : "#,##0.00";
      const r = ws.addRow([lineNo, cat, item.description, rateDisplay, item.unit, qtyVal, amt]);
      r.height = 15;

      const isAlt = lineNo % 2 === 0;
      r.eachCell((cell, col) => {
        cell.fill = {
          type: "pattern", pattern: "solid",
          fgColor: { argb: item.qty === 0 ? C.subtotalBg : (isAlt ? C.rowAlt : C.white) },
        };
        cell.font = { size: 10, color: { argb: item.qty === 0 ? C.border : C.black } };
        cell.alignment = { vertical: "middle", horizontal: col <= 3 ? "left" : "right" };
        applyBorder(cell);
      });
      // Rate in teal
      r.getCell(4).font = { size: 10, color: { argb: item.qty === 0 ? C.border : C.teal } };
      if (!item.costPlus) r.getCell(4).numFmt = "$#,##0.00";
      r.getCell(6).numFmt = qtyFmt;
      r.getCell(7).numFmt = "$#,##0.00";
      lineNo++;
    }

    // Subtotal row (only non-zero items count toward subtotal)
    const sub = catItems.reduce((s, i) => s + calcLineAmount(i), 0);
    const subRow = ws.addRow(["", "", "", "", "", "Subtotal", sub]);
    subRow.height = 15;
    subRow.eachCell((cell, col) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.subtotalBg } };
      cell.font = { bold: col >= 6, size: 10, color: { argb: C.black } };
      cell.alignment = { vertical: "middle", horizontal: "right" };
      applyBorder(cell);
    });
    subRow.getCell(7).numFmt = "$#,##0.00";
  }

  // ── Grand Total row ──
  const totalRow = ws.addRow(["", "", "", "", "", "GRAND TOTAL", invoice.total]);
  totalRow.height = 22;
  totalRow.eachCell((cell, col) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.greenBg } };
    applyBorder(cell, "medium");
    if (col >= 6) {
      cell.font = { bold: true, size: 12, color: { argb: C.white } };
      cell.alignment = { vertical: "middle", horizontal: "right" };
    }
  });
  totalRow.getCell(7).numFmt = "$#,##0.00";

  // ── Notes ──
  if (invoice.notes) {
    ws.addRow([]);
    const notesRow = ws.addRow(["Notes:", invoice.notes]);
    notesRow.getCell(1).font = { bold: true, size: 10 };
    notesRow.getCell(2).font = { size: 10 };
  }

  // ── Generated timestamp (small, bottom) ──
  ws.addRow([]);
  const genRow = ws.addRow([`Generated: ${new Date().toLocaleDateString("en-US")}   |   Rate Version: ${invoice.rateVersion}`]);
  mergeRow(ws, genRow.number);
  genRow.getCell(1).font = { italic: true, size: 9, color: { argb: C.border } };
}

/** Add raw WMS data sheets to the workbook */
function addRawDataSheets(wb: ExcelJS.Workbook, source: WmsSource) {
  const sheets: { name: string; data: Record<string, unknown>[] }[] = [
    { name: "Inbound Orders", data: source.receiving },
    { name: "B2B Orders",     data: source.b2b },
    { name: "B2C Orders",     data: source.b2c },
    { name: "Returns",        data: source.returns },
  ];

  for (const { name, data } of sheets) {
    if (!data || data.length === 0) continue;
    const ws = wb.addWorksheet(name);

    // Collect all unique keys across rows
    const keys = Array.from(new Set(data.flatMap((r) => Object.keys(r))));
    ws.columns = keys.map((k) => ({ header: k, key: k, width: Math.max(k.length + 2, 14) }));

    // Header row style
    const hdr = ws.getRow(1);
    hdr.height = 16;
    hdr.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: C.white }, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.blue } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      applyBorder(cell, "medium");
    });

    // Data rows
    data.forEach((row, i) => {
      const r = ws.addRow(keys.map((k) => row[k] ?? ""));
      r.eachCell((cell) => {
        cell.fill = {
          type: "pattern", pattern: "solid",
          fgColor: { argb: i % 2 === 0 ? C.white : C.rowAlt },
        };
        cell.font = { size: 10 };
        applyBorder(cell);
      });
    });
  }
}

// ── Rate Table sheet ─────────────────────────────────────────────────────────
function addRateTableSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet("Rate Table");
  ws.columns = [{ width: 40 }, { width: 16 }, { width: 22 }];

  const addTitle = (text: string) => {
    const r = ws.addRow([text]);
    r.height = 18;
    ws.mergeCells(`A${r.number}:C${r.number}`);
    Object.assign(r.getCell(1), {
      font: { bold: true, size: 11, color: { argb: C.white } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } },
      alignment: { horizontal: "center", vertical: "middle" },
    });
    applyBorder(r.getCell(1), "medium");
    return r;
  };
  const addHeader = () => {
    const r = ws.addRow(["Description", "Rate", "Unit"]);
    r.height = 15;
    r.eachCell(c => {
      c.font = { bold: true, size: 10, color: { argb: C.white } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.blue } };
      c.alignment = { horizontal: "center", vertical: "middle" };
      applyBorder(c, "medium");
    });
  };
  const addRow = (desc: string, rate: string, unit: string, shade: boolean) => {
    const r = ws.addRow([desc, rate, unit]);
    r.height = 14;
    const bg = shade ? C.rowAlt : C.white;
    r.eachCell((c, i) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      c.font = { size: 10 };
      c.alignment = { horizontal: i === 1 ? "left" : "center", vertical: "middle" };
      applyBorder(c);
    });
  };
  const blank = () => ws.addRow([]);

  // ── 1. Inbound ──
  addTitle("1. Inbound Handling");
  addHeader();
  const inbound = [
    ["Order Processing", "Waived", "per receiving order"],
    ["Standard Inbound — Carton (Small Parcel)", "$2.00", "per carton"],
    ["Standard Inbound — Pallet (LTL/LCL)", "$8.00", "per pallet"],
    ["20' Container (Palletized)", "$150.00", "per container"],
    ["40' Container (Palletized)", "$250.00", "per container"],
    ["40' HC Container (Palletized)", "$300.00", "per container"],
    ["20' Container (Floor Loaded)", "$350.00", "per container"],
    ["40' Container (Floor Loaded)", "$450.00", "per container"],
    ["40' HC Container (Floor Loaded)", "$500.00", "per container"],
    ["Additional Labor (QC / Counting)", "$35.00", "per person/hr"],
  ];
  inbound.forEach((row, i) => addRow(row[0], row[1], row[2], i % 2 === 1));
  blank();

  // ── 2. Storage ──
  addTitle("2. Storage (avg of 15th & last day of month)");
  addHeader();
  const storage = [
    ["Bin (8\"×30\"×12\" / 1.7 cuft)", "$0.52", "per bin/month"],
    ["Shelf (12.75\"×42\"×22\" / 6.8 cuft)", "$2.10", "per shelf/month"],
    ["Carton (16\"×42\"×25.5\" / 9.9 cuft)", "$3.05", "per carton/month"],
    ["Pallet Short (48\"×40\"×35.5\" / 39.4 cuft)", "$12.15", "per pallet/month"],
    ["Pallet Regular (48\"×40\"×73\" / 81.1 cuft)", "$25.00", "per pallet/month"],
    ["Pallet Tall (48\"×40\"×97\" / 107.8 cuft)", "$33.23", "per pallet/month"],
    ["Open Floor", "$50.00", "per spot/month"],
  ];
  storage.forEach((row, i) => addRow(row[0], row[1], row[2], i % 2 === 1));
  blank();

  // ── 3. Fulfillment B2B ──
  addTitle("3. Fulfillment — B2B");
  addHeader();
  const b2b = [
    ["Order Processing", "$4.00", "per order"],
    ["Picking — Piece", "$0.25", "per piece"],
    ["Picking — Full Carton", "$1.25", "per carton"],
    ["Picking — Full Pallet", "$6.50", "per pallet"],
    ["Carton Packing", "$1.25", "per carton/bag"],
    ["Palletizing w/ Stretch Wrap", "$12.00", "per pallet"],
    ["Label", "$0.20", "per label"],
    ["Order Inserts", "$0.10", "per insert"],
  ];
  b2b.forEach((row, i) => addRow(row[0], row[1], row[2], i % 2 === 1));
  blank();

  // ── 4. Fulfillment B2C ──
  addTitle("4. Fulfillment — B2C");
  addHeader();
  const b2c = [
    ["Order Processing (up to 5 picks)", "$2.00", "per order"],
    ["Picking — Piece (after 5th pick)", "$0.20", "per pick"],
    ["Fragile Pack", "$0.25", "per item"],
    ["Order Inserts (BOL, packing list…)", "$0.10", "per insert"],
    ["Label / Shipping Unit", "$0.20", "per label"],
  ];
  b2c.forEach((row, i) => addRow(row[0], row[1], row[2], i % 2 === 1));
  blank();

  // ── 5. Return Management ──
  addTitle("5. Return Management");
  addHeader();
  const returns = [
    ["Return Receiving (incl. Inspection)", "$1.50", "per order"],
    ["Return Restock", "$0.25", "per piece"],
    ["Disposal", "Cost + 10%", ""],
  ];
  returns.forEach((row, i) => addRow(row[0], row[1], row[2], i % 2 === 1));
  blank();

  // ── 6. Warehouse Labor ──
  addTitle("6. Warehouse Labor");
  addHeader();
  const labor = [
    ["Regular Time", "$35.00", "per person/hr"],
    ["Weekday After-Hours (1.5×)", "$52.50", "per person/hr"],
    ["Weekend / Holiday (2×)", "$70.00", "per person/hr"],
  ];
  labor.forEach((row, i) => addRow(row[0], row[1], row[2], i % 2 === 1));

  // Footer note
  blank();
  const note = ws.addRow(["Rate ver. 2026-02-17  |  CTK Rate Offer for STL"]);
  note.getCell(1).font = { italic: true, size: 9, color: { argb: "FF888888" } };
  ws.mergeCells(`A${note.number}:C${note.number}`);
}

// ── OM Subsidy sheet ──────────────────────────────────────────────────────────
// Constants (update annually)
const OM_SUBSIDY = {
  employerTaxRate:   0.0765,   // FICA
  dental:            31.39,    // fixed monthly
  medical:           542.55,   // fixed monthly
  wcRate:            0.1185,   // workers comp rate (warehouse)
  // Company-wide WC to derive discount rate
  wcWarehouseExp:    750685,
  wcOfficeExp:       480438,
  wcSalesExp:        52548,
  wcOfficeRate:      0.0046,
  wcSalesRate:       0.0069,
  wcActualPremium:   52482,    // actual premium paid (for discount calc)
  glAnnualPremium:   122889.91,
  glRevenueBase:     6600000,
  allocToSTL:        0.40,
} as const;

/** Calculate STL OM-subsidy allocation amount from raw state strings */
function calcStlAlloc(omWages: string, omAllocPct: string): number {
  const S = OM_SUBSIDY;
  const wages = parseFloat(omWages) || 0;
  if (wages <= 0) return 0;
  const fica = wages * S.employerTaxRate;
  const wcExpected =
    S.wcWarehouseExp * S.wcRate +
    S.wcOfficeExp * S.wcOfficeRate +
    S.wcSalesExp * S.wcSalesRate;
  const wcDiscount = 1 - S.wcActualPremium / wcExpected;
  const wcNetRate = S.wcRate * (1 - wcDiscount);
  const wc = wages * wcNetRate;
  const gl = wages * (S.glAnnualPremium / S.glRevenueBase);
  const totalOverhead = fica + wc + gl + S.dental + S.medical;
  const allocPct = Math.max(0, Math.min(100, parseFloat(omAllocPct) || 0));
  return totalOverhead * (allocPct / 100);
}

function addOmSubsidySheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet("OM Subsidy");
  ws.columns = [{ width: 32 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 12 }, { width: 18 }, { width: 14 }];

  const S = OM_SUBSIDY;

  // Helpers
  const title = (text: string) => {
    const r = ws.addRow([text]);
    r.height = 22;
    ws.mergeCells(`A${r.number}:G${r.number}`);
    Object.assign(r.getCell(1), {
      font: { bold: true, size: 13, color: { argb: C.white } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } },
      alignment: { horizontal: "center", vertical: "middle" },
    });
    applyBorder(r.getCell(1), "medium");
  };
  const label = (text: string, indent = false) => {
    const r = ws.addRow([indent ? `    ${text}` : text]);
    r.height = 14;
    r.getCell(1).font = { size: 10, italic: indent };
    return r;
  };
  const dataRow = (desc: string, amount: number | string, pctOf?: number, bold = false, highlight = false) => {
    const pct = typeof pctOf === "number" && typeof amount === "number"
      ? `${((amount / pctOf) * 100).toFixed(2)}%` : "";
    const r = ws.addRow([desc, typeof amount === "number" ? amount : "", pct]);
    r.height = 15;
    const amtCell = r.getCell(2);
    const pctCell = r.getCell(3);
    amtCell.numFmt = '"$"#,##0.00';
    amtCell.alignment = { horizontal: "right" };
    pctCell.alignment = { horizontal: "right" };
    pctCell.font = { size: 10, color: { argb: "FF666666" } };
    r.getCell(1).font = { bold, size: 10 };
    amtCell.font = { bold, size: 10 };
    if (highlight) {
      [1,2,3].forEach(i => {
        r.getCell(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.greenBg } };
        r.getCell(i).font = { bold: true, size: 11, color: { argb: C.white } };
      });
    }
    [1,2,3].forEach(i => applyBorder(r.getCell(i)));
    return r;
  };
  const inputRow = (rowNum: number) => {
    // Highlight the input cell yellow
    const cell = ws.getCell(`B${rowNum}`);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
    cell.font = { bold: true, size: 11, color: { argb: "FF333333" } };
    cell.border = { top: { style: "medium" }, bottom: { style: "medium" }, left: { style: "medium" }, right: { style: "medium" } };
    const note = ws.getCell(`D${rowNum}`);
    note.value = "← Enter Total Taxable Wages here";
    note.font = { italic: true, size: 9, color: { argb: "FFDD6600" } };
    ws.mergeCells(`D${rowNum}:G${rowNum}`);
  };

  // ── Header ──
  title("Subsidy for OM (Aiden Kim)");
  // Column headers row
  const hdr = ws.addRow(["Description", "Amount", "% of Gross Wage"]);
  hdr.height = 15; hdr.eachCell((c, i) => {
    if (i > 3) return;
    c.font = { bold: true, size: 10, color: { argb: C.white } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.blue } };
    c.alignment = { horizontal: "center" };
    applyBorder(c, "medium");
  });

  // ── Total Taxable Wages (INPUT) ──
  // Pre-fill with 0 so formulas don't break; user edits B4
  const wageRow = ws.addRow(["Total Taxable Wages", 0, "100.00%"]);
  wageRow.height = 16;
  wageRow.getCell(1).font = { bold: true, size: 10 };
  wageRow.getCell(2).numFmt = '"$"#,##0.00';
  wageRow.getCell(2).alignment = { horizontal: "right" };
  [1,2,3].forEach(i => applyBorder(wageRow.getCell(i)));
  const wageRowNum = wageRow.number;
  inputRow(wageRowNum);

  ws.addRow([]); // blank
  label("Overhead");

  // ── 1. Employer Tax ──
  const etRow = ws.addRow(["1. Employer Tax",
    { formula: `ROUND(B${wageRowNum}*${S.employerTaxRate},2)` },
    { formula: `IF(B${wageRowNum}>0,ROUND(B${wageRowNum}*${S.employerTaxRate},2)/B${wageRowNum},0)` },
  ]);
  etRow.height = 14;
  etRow.getCell(2).numFmt = '"$"#,##0.00'; etRow.getCell(2).alignment = { horizontal: "right" };
  etRow.getCell(3).numFmt = "0.00%"; etRow.getCell(3).alignment = { horizontal: "right" };
  etRow.getCell(3).font = { size: 10, color: { argb: "FF666666" } };
  [1,2,3].forEach(i => applyBorder(etRow.getCell(i)));
  const etRowNum = etRow.number;

  ws.addRow([]);
  label("2. Benefits");

  // Dental
  const dentalRow = ws.addRow(["    Health Insurance — Dental", S.dental,
    { formula: `IF(B${wageRowNum}>0,${S.dental}/B${wageRowNum},0)` }]);
  dentalRow.height = 14; dentalRow.getCell(2).numFmt = '"$"#,##0.00';
  dentalRow.getCell(2).alignment = { horizontal: "right" };
  dentalRow.getCell(3).numFmt = "0.00%"; dentalRow.getCell(3).alignment = { horizontal: "right" };
  dentalRow.getCell(3).font = { size: 10, color: { argb: "FF666666" } };
  [1,2,3].forEach(i => applyBorder(dentalRow.getCell(i)));
  const dentalRowNum = dentalRow.number;

  // Medical
  const medRow = ws.addRow(["    Health Insurance — Medical", S.medical,
    { formula: `IF(B${wageRowNum}>0,${S.medical}/B${wageRowNum},0)` }]);
  medRow.height = 14; medRow.getCell(2).numFmt = '"$"#,##0.00';
  medRow.getCell(2).alignment = { horizontal: "right" };
  medRow.getCell(3).numFmt = "0.00%"; medRow.getCell(3).alignment = { horizontal: "right" };
  medRow.getCell(3).font = { size: 10, color: { argb: "FF666666" } };
  [1,2,3].forEach(i => applyBorder(medRow.getCell(i)));
  const medRowNum = medRow.number;

  ws.addRow([]);
  label("3. Insurance");

  // Workers Comp — calculated from company-wide discount
  // WC base premium (company-wide)
  const wcBasePremium = S.wcWarehouseExp * S.wcRate + S.wcOfficeExp * S.wcOfficeRate + S.wcSalesExp * S.wcSalesRate;
  const wcDiscountRate = 1 - S.wcActualPremium / wcBasePremium; // ~42.66%
  const wcNetRate = S.wcRate * (1 - wcDiscountRate);
  const wcRow = ws.addRow(["    Workers Comp",
    { formula: `ROUND(B${wageRowNum}*${wcNetRate.toFixed(6)},2)` },
    { formula: `IF(B${wageRowNum}>0,ROUND(B${wageRowNum}*${wcNetRate.toFixed(6)},2)/B${wageRowNum},0)` },
  ]);
  wcRow.height = 14; wcRow.getCell(2).numFmt = '"$"#,##0.00';
  wcRow.getCell(2).alignment = { horizontal: "right" };
  wcRow.getCell(3).numFmt = "0.00%"; wcRow.getCell(3).alignment = { horizontal: "right" };
  wcRow.getCell(3).font = { size: 10, color: { argb: "FF666666" } };
  [1,2,3].forEach(i => applyBorder(wcRow.getCell(i)));
  const wcRowNum = wcRow.number;

  // General Liability
  const glRate = S.glAnnualPremium / S.glRevenueBase; // ~1.862%
  const glRow = ws.addRow(["    General Liability Insurance",
    { formula: `ROUND(B${wageRowNum}*${glRate.toFixed(6)},2)` },
    { formula: `IF(B${wageRowNum}>0,ROUND(B${wageRowNum}*${glRate.toFixed(6)},2)/B${wageRowNum},0)` },
  ]);
  glRow.height = 14; glRow.getCell(2).numFmt = '"$"#,##0.00';
  glRow.getCell(2).alignment = { horizontal: "right" };
  glRow.getCell(3).numFmt = "0.00%"; glRow.getCell(3).alignment = { horizontal: "right" };
  glRow.getCell(3).font = { size: 10, color: { argb: "FF666666" } };
  [1,2,3].forEach(i => applyBorder(glRow.getCell(i)));
  const glRowNum = glRow.number;

  ws.addRow([]);

  // Total Overhead
  const ohRow = ws.addRow(["Total Overhead",
    { formula: `SUM(B${etRowNum},B${dentalRowNum},B${medRowNum},B${wcRowNum},B${glRowNum})` },
    { formula: `IF(B${wageRowNum}>0,SUM(B${etRowNum},B${dentalRowNum},B${medRowNum},B${wcRowNum},B${glRowNum})/B${wageRowNum},0)` },
  ]);
  ohRow.height = 15;
  ohRow.getCell(1).font = { bold: true, size: 10 };
  ohRow.getCell(2).numFmt = '"$"#,##0.00'; ohRow.getCell(2).alignment = { horizontal: "right" };
  ohRow.getCell(2).font = { bold: true, size: 10 };
  ohRow.getCell(3).numFmt = "0.00%"; ohRow.getCell(3).alignment = { horizontal: "right" };
  ohRow.getCell(3).font = { bold: true, size: 10, color: { argb: "FF666666" } };
  [1,2,3].forEach(i => applyBorder(ohRow.getCell(i)));
  const ohRowNum = ohRow.number;

  ws.addRow([]);

  // Total Cost
  const tcRow = ws.addRow(["Total Cost",
    { formula: `B${wageRowNum}+B${ohRowNum}` },
  ]);
  tcRow.height = 15;
  tcRow.getCell(1).font = { bold: true, size: 10 };
  tcRow.getCell(2).numFmt = '"$"#,##0.00'; tcRow.getCell(2).alignment = { horizontal: "right" };
  tcRow.getCell(2).font = { bold: true, size: 10 };
  [1,2].forEach(i => applyBorder(tcRow.getCell(i)));
  const tcRowNum = tcRow.number;

  // % Allocated to STL
  const pctRow = ws.addRow(["% Allocated to STL", S.allocToSTL]);
  pctRow.height = 14;
  pctRow.getCell(2).numFmt = "0%"; pctRow.getCell(2).alignment = { horizontal: "right" };
  [1,2].forEach(i => applyBorder(pctRow.getCell(i)));
  const pctRowNum = pctRow.number;

  // Charge to STL (highlighted)
  const chargeRow = ws.addRow(["Charge to STL",
    { formula: `ROUND(B${tcRowNum}*B${pctRowNum},2)` },
  ]);
  chargeRow.height = 18;
  chargeRow.getCell(2).numFmt = '"$"#,##0.00'; chargeRow.getCell(2).alignment = { horizontal: "right" };
  [1,2].forEach(i => {
    chargeRow.getCell(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.greenBg } };
    chargeRow.getCell(i).font = { bold: true, size: 12, color: { argb: C.white } };
    applyBorder(chargeRow.getCell(i), "medium");
  });

  ws.addRow([]);
  ws.addRow([]);

  // ── Workers Comp detail table ──
  const wcTitle = ws.addRow(["Workers Comp — Company-wide Detail"]);
  ws.mergeCells(`A${wcTitle.number}:G${wcTitle.number}`);
  Object.assign(wcTitle.getCell(1), {
    font: { bold: true, size: 10, color: { argb: C.white } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } },
    alignment: { horizontal: "center" },
  }); applyBorder(wcTitle.getCell(1));

  const wcHdr = ws.addRow(["", "Exposure", "Rate", "Premium Base", "%", "Premium after Discount", "Discount Rate"]);
  wcHdr.height = 14; wcHdr.eachCell(c => {
    c.font = { bold: true, size: 9, color: { argb: C.white } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.blue } };
    c.alignment = { horizontal: "center" }; applyBorder(c);
  });

  const wcWHBase = S.wcWarehouseExp * S.wcRate;
  const wcOFBase = S.wcOfficeExp * S.wcOfficeRate;
  const wcSLBase = S.wcSalesExp * S.wcSalesRate;
  const wcTotalBase = wcWHBase + wcOFBase + wcSLBase;
  const discPct = 1 - S.wcActualPremium / wcTotalBase;

  const wcDetails = [
    ["Warehouse", S.wcWarehouseExp, S.wcRate, wcWHBase, wcWHBase/wcTotalBase, wcWHBase*(1-discPct)],
    ["Office",    S.wcOfficeExp,    S.wcOfficeRate, wcOFBase, wcOFBase/wcTotalBase, wcOFBase*(1-discPct)],
    ["Sales",     S.wcSalesExp,     S.wcSalesRate,  wcSLBase, wcSLBase/wcTotalBase, wcSLBase*(1-discPct)],
  ];
  wcDetails.forEach((d, i) => {
    const r = ws.addRow([d[0], d[1], d[2], d[3], d[4], d[5], i === 0 ? discPct : ""]);
    r.height = 14;
    const bg = i % 2 === 0 ? C.white : C.rowAlt;
    r.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } }; c.font = { size: 9 }; applyBorder(c); });
    r.getCell(2).numFmt = "#,##0"; r.getCell(3).numFmt = "0.00%";
    r.getCell(4).numFmt = '"$"#,##0.00'; r.getCell(5).numFmt = "0.0%";
    r.getCell(6).numFmt = '"$"#,##0.00';
    if (i === 0) { r.getCell(7).numFmt = "0.00%"; r.getCell(7).font = { bold: true, size: 9 }; }
  });
  // Total row
  const wcTot = ws.addRow(["Total", "", "", wcTotalBase, 1, S.wcActualPremium, discPct]);
  wcTot.height = 14;
  wcTot.eachCell(c => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.rowAlt } };
    c.font = { bold: true, size: 9 }; applyBorder(c, "medium");
  });
  wcTot.getCell(4).numFmt = '"$"#,##0.00'; wcTot.getCell(5).numFmt = "0.0%";
  wcTot.getCell(6).numFmt = '"$"#,##0.00'; wcTot.getCell(7).numFmt = "0.00%";

  ws.addRow([]);

  // ── GL Insurance detail ──
  const glTitle = ws.addRow(["General Liability — Annual Reference"]);
  ws.mergeCells(`A${glTitle.number}:G${glTitle.number}`);
  Object.assign(glTitle.getCell(1), {
    font: { bold: true, size: 10, color: { argb: C.white } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } },
    alignment: { horizontal: "center" },
  }); applyBorder(glTitle.getCell(1));

  const glDetails = [
    ["Annual Premium", S.glAnnualPremium],
    ["Revenue Base",   S.glRevenueBase],
    ["Effective Rate", glRate],
  ];
  glDetails.forEach((d, i) => {
    const r = ws.addRow([d[0], d[1]]);
    r.height = 14;
    r.getCell(1).font = { size: 10 };
    r.getCell(2).numFmt = i === 2 ? "0.000%" : '"$"#,##0.00';
    r.getCell(2).alignment = { horizontal: "right" };
    [1,2].forEach(c => applyBorder(r.getCell(c)));
  });

  // Footer note
  ws.addRow([]);
  const fn = ws.addRow(["※ Yellow cell (Total Taxable Wages) is the only manual input. All other values auto-calculate."]);
  ws.mergeCells(`A${fn.number}:G${fn.number}`);
  fn.getCell(1).font = { italic: true, size: 9, color: { argb: "FF888888" } };
}

async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Per-customer WMS detail sheets ──────────────────────────────────────────

/** Add a [CustCode]_B2B sheet and return { sheetName, rowCount } */
function addB2BDetailSheet(
  wb: ExcelJS.Workbook,
  custCode: string,
  orders: Record<string, unknown>[],
  orderEdits: Record<string, Record<string, number>>
): { sheetName: string; rowCount: number } {
  const sheetName = `${custCode}_B2B`.slice(0, 31);
  const ws = wb.addWorksheet(sheetName);
  ws.columns = [
    { width: 18 }, // A: Order Code
    { width: 12 }, // B: Date
    { width: 11 }, // C: Pick/Piece
    { width: 12 }, // D: Pick/Carton
    { width: 12 }, // E: Pick/Pallet
    { width: 11 }, // F: Out/Carton (ref)
    { width: 11 }, // G: Out/Pallet (ref)
    { width: 11 }, // H: Supplies (ref)
    { width: 11 }, // I: Packing
    { width: 11 }, // J: Palletize
    { width: 11 }, // K: Labels
    { width: 11 }, // L: Inserts
    { width: 11 }, // M: Labor Hrs
    { width: 11 }, // N: Labor OT
    { width: 12 }, // O: Labor Wknd
  ];
  const headers = [
    "Order Code","Date","Pick/Piece","Pick/Carton","Pick/Pallet",
    "Out/Carton","Out/Pallet","Supplies","Packing✓","Palletize✓",
    "Labels","Inserts","Labor Hrs","Labor OT","Labor Wknd",
  ];
  const hdrRow = ws.addRow(headers);
  hdrRow.height = 16;
  hdrRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: C.white }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.blue } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    applyBorder(cell, "medium");
  });

  let rowIdx = 0;
  for (const order of orders) {
    const code  = String(order.shippingOrderCode ?? order.orderCode ?? "");
    const date  = String(order.outDate ?? order.deliveryDate ?? order.shippingDate ?? order.outboundDate ?? "");
    const tasks = parseTaskComment(String(order.comment ?? ""));
    const ov    = orderEdits[code] ?? {};

    const pp       = ov["b2b_pick_piece"]    ?? tasks["Picking per Piece"]    ?? 0;
    const pc       = ov["b2b_pick_carton"]   ?? tasks["Picking per Carton"]   ?? 0;
    const ppl      = ov["b2b_pick_pallet"]   ?? tasks["Picking per Pallet"]   ?? 0;
    const oc       = tasks["Out per Carton"] ?? 0;
    const op       = tasks["Out per Pallet"] ?? 0;
    const supplies = tasks["Supplies"]       ?? 0;

    // Packing: oc > 0 && oc !== pc → charge oc; plus supplies qty
    const packing  = ov["b2b_carton_packing"] ?? ((oc > 0 && oc !== pc ? oc : 0) + (supplies > 0 ? supplies : 0));
    // Palletizing: op > 0 && op !== ppl
    const palletize = ov["b2b_palletizing"]  ?? (op > 0 && op !== ppl ? op : 0);
    const labels    = ov["b2b_label"]         ?? ((tasks["Labels"] ?? 0) + (tasks["Amazon Labels"] ?? 0) + (tasks["FBA Labeling"] ?? 0));
    const inserts   = ov["b2b_insert"]        ?? (tasks["Inserts"] ?? 0);
    const laborReg  = ov["labor_regular"]     ?? (tasks["Labor Hours"] ?? 0);
    const laborOT   = ov["labor_ot_weekday"]  ?? (tasks["Labor Hours (OT)"] ?? 0);
    const laborWknd = ov["labor_ot_weekend"]  ?? (tasks["Labor Hours (Weekend/Holiday)"] ?? 0);

    const r = ws.addRow([
      code, date, pp, pc, ppl, oc, op, supplies, packing, palletize,
      labels, inserts, laborReg, laborOT, laborWknd,
    ]);
    r.height = 15;
    r.eachCell((cell, col) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowIdx % 2 === 0 ? C.white : C.rowAlt } };
      cell.font = { size: 10 };
      cell.alignment = { vertical: "middle", horizontal: col <= 2 ? "left" : "right" };
      applyBorder(cell);
    });
    rowIdx++;
  }
  return { sheetName, rowCount: orders.length };
}

/** Add a [CustCode]_Inbound sheet */
function addInboundDetailSheet(
  wb: ExcelJS.Workbook,
  custCode: string,
  orders: Record<string, unknown>[]
): { sheetName: string; rowCount: number } {
  const sheetName = `${custCode}_Inbound`.slice(0, 31);
  const ws = wb.addWorksheet(sheetName);
  ws.columns = [
    { width: 20 }, // A: Order Code
    { width: 14 }, // B: Date
    { width: 22 }, // C: Type
    { width: 10 }, // D: Qty
  ];
  const hdrRow = ws.addRow(["Order Code", "Date", "Type", "Qty"]);
  hdrRow.height = 16;
  hdrRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: C.white }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.blue } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    applyBorder(cell, "medium");
  });

  let rowIdx = 0;
  for (const order of orders) {
    const code = String(order.receiveOrderCode ?? order.orderCode ?? "");
    const date = String(order.inDate ?? order.receiveDate ?? order.orderDate ?? "");
    const type = String(order.inboundType ?? order.receiveType ?? "");
    const cartonQty = order.cartonQty ?? order.boxQty ?? order.packageQty ?? order.cartonCount;
    const qty = cartonQty != null ? Number(cartonQty) : 1;
    const r = ws.addRow([code, date, type, qty]);
    r.height = 15;
    r.eachCell((cell, col) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowIdx % 2 === 0 ? C.white : C.rowAlt } };
      cell.font = { size: 10 };
      cell.alignment = { vertical: "middle", horizontal: col <= 3 ? "left" : "right" };
      applyBorder(cell);
    });
    rowIdx++;
  }
  return { sheetName, rowCount: orders.length };
}

/** Add a [CustCode]_B2C sheet */
function addB2CDetailSheet(
  wb: ExcelJS.Workbook,
  custCode: string,
  orders: Record<string, unknown>[]
): { sheetName: string; rowCount: number } {
  const sheetName = `${custCode}_B2C`.slice(0, 31);
  const ws = wb.addWorksheet(sheetName);
  ws.columns = [
    { width: 18 }, // A: Order Code
    { width: 12 }, // B: Date
    { width: 12 }, // C: Total Qty
    { width: 12 }, // D: +1 Order
    { width: 12 }, // E: Extra Picks
  ];
  const hdrRow = ws.addRow(["Order Code", "Date", "Total Qty", "+1 Order", "Extra Picks"]);
  hdrRow.height = 16;
  hdrRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: C.white }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.blue } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    applyBorder(cell, "medium");
  });

  let rowIdx = 0;
  for (const order of orders) {
    const code  = String(order.shippingOrderCode ?? order.orderCode ?? "");
    const date  = String(order.outDate ?? order.deliveryDate ?? order.shippingDate ?? "");
    const qty   = Number(order.totalQty ?? order.orderQty ?? 0);
    const extra = Math.max(0, qty - 5);
    const r = ws.addRow([code, date, qty, 1, extra]);
    r.height = 15;
    r.eachCell((cell, col) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowIdx % 2 === 0 ? C.white : C.rowAlt } };
      cell.font = { size: 10 };
      cell.alignment = { vertical: "middle", horizontal: col <= 2 ? "left" : "right" };
      applyBorder(cell);
    });
    rowIdx++;
  }
  return { sheetName, rowCount: orders.length };
}

/** Add Storage_15th, Storage_Last, Storage_Avg sheets to the workbook */
function addInventoryDetailSheets(
  wb: ExcelJS.Workbook,
  storageRows: StorageRow[]
): { avgSheetName: string } {
  const avgSheetName = "Storage_Avg";

  // Helper to add a simple 2-column storage snapshot sheet
  function addSnapSheet(name: string, colHeader: string, getQty: (r: StorageRow) => number) {
    const ws = wb.addWorksheet(name);
    ws.columns = [{ width: 20 }, { width: 12 }];
    const hdr = ws.addRow(["Type", colHeader]);
    hdr.height = 16;
    hdr.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: C.white }, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.blue } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      applyBorder(cell, "medium");
    });
    // Always emit all 7 template rows in fixed order for consistent row positions
    STORAGE_TEMPLATE_ROWS.forEach((tmpl, i) => {
      const found = storageRows.find(r => r.key === tmpl.key);
      const qty = found ? getQty(found) : 0;
      const r = ws.addRow([tmpl.label, qty]);
      r.height = 15;
      r.eachCell((cell, col) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i % 2 === 0 ? C.white : C.rowAlt } };
        cell.font = { size: 10 };
        cell.alignment = { vertical: "middle", horizontal: col === 1 ? "left" : "right" };
        applyBorder(cell);
      });
    });
  }

  addSnapSheet("Storage_15th", "15th Qty", r => r.qty15);
  addSnapSheet("Storage_Last", "Last Qty", r => r.qtyLast);

  // Storage_Avg: A=Type, B=15th (formula ref Storage_15th), C=Last (formula ref Storage_Last), D=Average
  const wsAvg = wb.addWorksheet(avgSheetName);
  wsAvg.columns = [{ width: 20 }, { width: 12 }, { width: 12 }, { width: 14 }];
  const hdrAvg = wsAvg.addRow(["Type", "15th", "Last", "Average"]);
  hdrAvg.height = 16;
  hdrAvg.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: C.white }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.blue } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    applyBorder(cell, "medium");
  });
  STORAGE_TEMPLATE_ROWS.forEach((tmpl, i) => {
    const dataRow = i + 2; // Row 2 = first data row
    const found = storageRows.find(r => r.key === tmpl.key);
    const qty15   = found?.qty15   ?? 0;
    const qtyLast = found?.qtyLast ?? 0;
    const avg     = found?.avg     ?? 0;
    const r = wsAvg.addRow([
      tmpl.label,
      { formula: `='Storage_15th'!B${dataRow}`, result: qty15 },
      { formula: `='Storage_Last'!B${dataRow}`, result: qtyLast },
      { formula: `=AVERAGE(B${dataRow},C${dataRow})`, result: avg },
    ]);
    r.height = 15;
    r.eachCell((cell, col) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i % 2 === 0 ? C.white : C.rowAlt } };
      cell.font = { size: 10 };
      cell.alignment = { vertical: "middle", horizontal: col === 1 ? "left" : "right" };
      applyBorder(cell);
    });
  });

  return { avgSheetName };
}

/** Sheet-name refs for formula generation */
type DataSheetRefs = {
  b2bSheet?: string;
  inboundSheet?: string;
  b2cSheet?: string;
  storageAvgSheet?: string;
};

/** Return ExcelJS cell value for a qty cell: formula if data sheet exists, else fallback number */
function getQtyFormula(
  itemId: string,
  refs: DataSheetRefs,
  fallbackQty: number
): number | ExcelJS.CellFormulaValue {
  const b = refs.b2bSheet;
  const ib = refs.inboundSheet;
  const c = refs.b2cSheet;
  const s = refs.storageAvgSheet;

  // B2B columns
  const b2bColMap: Record<string, string> = {
    b2b_pick_piece:    "C",
    b2b_pick_carton:   "D",
    b2b_pick_pallet:   "E",
    b2b_carton_packing:"I",
    b2b_palletizing:   "J",
    b2b_label:         "K",
    b2b_insert:        "L",
    labor_regular:     "M",
    labor_ot_weekday:  "N",
    labor_ot_weekend:  "O",
  };
  if (b2bColMap[itemId] && b) {
    return { formula: `=SUM('${b}'!${b2bColMap[itemId]}2:${b2bColMap[itemId]}9999)`, result: fallbackQty };
  }
  if (itemId === "b2b_order" && b) {
    return { formula: `=COUNTA('${b}'!A2:A9999)`, result: fallbackQty };
  }
  if (itemId === "inbound_carton" && ib) {
    return { formula: `=SUMIF('${ib}'!C2:C9999,"<>*container*",'${ib}'!D2:D9999)`, result: fallbackQty };
  }
  if (itemId === "b2c_order" && c) {
    return { formula: `=COUNTA('${c}'!A2:A9999)`, result: fallbackQty };
  }
  if (itemId === "b2c_pick_piece" && c) {
    return { formula: `=SUM('${c}'!E2:E9999)`, result: fallbackQty };
  }
  // Storage → Storage_Avg!D{row} (rows 2–8 in STORAGE_TEMPLATE_ROWS order)
  const storageRowMap: Record<string, number> = {
    storage_bin:            2,
    storage_shelf:          3,
    storage_carton:         4,
    storage_pallet_short:   5,
    storage_pallet_regular: 6,
    storage_pallet_tall:    7,
    storage_open_floor:     8,
  };
  if (storageRowMap[itemId] !== undefined && s) {
    const row = storageRowMap[itemId];
    return { formula: `='${s}'!D${row}`, result: fallbackQty };
  }
  return fallbackQty;
}

/**
 * Fill an invoice worksheet using SUM/formula references to data sheets.
 * Returns the row number of the GRAND TOTAL row (for Summary sheet cross-references).
 */
type InvoiceSheetMeta = {
  totalRowNum: number;
  itemRowNums: Record<string, number>;       // itemId → row in this sheet (F=Qty, G=Amount)
  catSubtotalRowNums: Record<string, number>; // category → subtotal row
};

function fillInvoiceSheetFormula(
  ws: ExcelJS.Worksheet,
  invoice: BillingInvoice,
  refs: DataSheetRefs
): InvoiceSheetMeta {
  ws.columns = COL_WIDTHS_7.map((w) => ({ width: w }));

  // ── Row 1: Company header ──
  const r1 = ws.addRow(["CTK USA, INC."]);
  r1.height = 28;
  mergeRow(ws, r1.number);
  const c1 = r1.getCell(1);
  c1.font = { bold: true, size: 16, color: { argb: C.white }, name: "Calibri" };
  c1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } };
  c1.alignment = { vertical: "middle", horizontal: "center" };
  applyBorder(c1, "medium");

  // ── Row 2: Invoice for customer ──
  const r2 = ws.addRow([`Invoice for ${invoice.customerName || invoice.customer}`]);
  r2.height = 20;
  mergeRow(ws, r2.number);
  const c2 = r2.getCell(1);
  c2.font = { bold: true, size: 12, color: { argb: C.navy } };
  c2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.white } };
  c2.alignment = { vertical: "middle", horizontal: "center" };
  applyBorder(c2);

  // ── Row 3: Billing period ──
  const r3 = ws.addRow([`Billing Period: ${periodRange(invoice.period)}`]);
  r3.height = 18;
  mergeRow(ws, r3.number);
  const c3 = r3.getCell(1);
  c3.font = { size: 11, color: { argb: C.black } };
  c3.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.white } };
  c3.alignment = { vertical: "middle", horizontal: "center" };
  applyBorder(c3);

  // ── Row 4: Column headers ──
  const hdrRow = ws.addRow(["No.", "Category", "Description", "Rate", "Unit", "Qty", "Amount"]);
  hdrRow.height = 18;
  hdrRow.eachCell((cell, col) => {
    cell.font = { bold: true, color: { argb: C.white }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.blue } };
    cell.alignment = {
      vertical: "middle",
      horizontal: col <= 3 ? "center" : "right",
    };
    applyBorder(cell, "medium");
  });

  let lineNo = 1;
  let sectionNo = 1;
  const itemRowNums: Record<string, number> = {};
  const catSubtotalRowNums: Record<string, number> = {};

  for (const cat of BILLING_CATEGORIES) {
    const catItems = invoice.lineItems.filter((l) => l.category === cat);
    if (catItems.length === 0) continue;

    // Section header row
    const secRow = ws.addRow([`${sectionNo}. ${cat}`]);
    secRow.height = 16;
    mergeRow(ws, secRow.number);
    const secCell = secRow.getCell(1);
    secCell.font = { bold: true, size: 10, color: { argb: C.sectionFont } };
    secCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.sectionBg } };
    secCell.alignment = { vertical: "middle", indent: 1 };
    applyBorder(secCell, "medium");
    sectionNo++;

    // Data rows
    for (const item of catItems) {
      const nextRow = ws.rowCount + 1;
      const qtyVal   = getQtyFormula(item.id, refs, Math.round(item.qty * 100) / 100);
      const rateDisplay = item.costPlus ? "cost+10%" : item.rate;
      const isQtyNum    = typeof qtyVal === "number";
      const qtyNumeric  = isQtyNum ? (qtyVal as number) : item.qty;
      const amt = item.costPlus
        ? { formula: `=F${nextRow}*1.1`, result: item.qty * 1.1 }
        : { formula: `=F${nextRow}*${item.rate}`, result: item.qty * item.rate };

      const r = ws.addRow([lineNo, cat, item.description, rateDisplay, item.unit, qtyVal, amt]);
      itemRowNums[item.id] = r.number;  // track for Summary formulas
      r.height = 15;
      const isAlt = lineNo % 2 === 0;
      r.eachCell((cell, col) => {
        cell.fill = {
          type: "pattern", pattern: "solid",
          fgColor: { argb: qtyNumeric === 0 ? C.subtotalBg : (isAlt ? C.rowAlt : C.white) },
        };
        cell.font = { size: 10, color: { argb: qtyNumeric === 0 ? C.border : C.black } };
        cell.alignment = { vertical: "middle", horizontal: col <= 3 ? "left" : "right" };
        applyBorder(cell);
      });
      r.getCell(4).font = { size: 10, color: { argb: qtyNumeric === 0 ? C.border : C.teal } };
      if (!item.costPlus) r.getCell(4).numFmt = "$#,##0.00";
      r.getCell(6).numFmt = Number.isInteger(qtyNumeric) ? "#,##0" : "#,##0.00";
      r.getCell(7).numFmt = "$#,##0.00";
      lineNo++;
    }

    // Subtotal row — formula summing all item Amount cells in this category
    const firstItemRow = itemRowNums[catItems[0].id];
    const lastItemRow  = itemRowNums[catItems[catItems.length - 1].id];
    const subFormula   = firstItemRow && lastItemRow
      ? { formula: `=SUM(G${firstItemRow}:G${lastItemRow})`, result: catItems.reduce((s, i) => s + calcLineAmount(i), 0) }
      : catItems.reduce((s, i) => s + calcLineAmount(i), 0);
    const subRow = ws.addRow(["", "", "", "", "", "Subtotal", subFormula]);
    catSubtotalRowNums[cat] = subRow.number;
    subRow.height = 15;
    subRow.eachCell((cell, col) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.subtotalBg } };
      cell.font = { bold: col >= 6, size: 10, color: { argb: C.black } };
      cell.alignment = { vertical: "middle", horizontal: "right" };
      applyBorder(cell);
    });
    subRow.getCell(7).numFmt = "$#,##0.00";
  }

  // ── Grand Total row — formula summing all subtotals ──
  const subtotalRefs = Object.values(catSubtotalRowNums).map(r => `G${r}`).join("+");
  const gtFormula = subtotalRefs
    ? { formula: `=${subtotalRefs}`, result: invoice.total }
    : invoice.total;
  const totalRow = ws.addRow(["", "", "", "", "", "GRAND TOTAL", gtFormula]);
  const totalRowNum = totalRow.number;
  totalRow.height = 22;
  totalRow.eachCell((cell, col) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.greenBg } };
    applyBorder(cell, "medium");
    if (col >= 6) {
      cell.font = { bold: true, size: 12, color: { argb: C.white } };
      cell.alignment = { vertical: "middle", horizontal: "right" };
    }
  });
  totalRow.getCell(7).numFmt = "$#,##0.00";

  // ── Notes ──
  if (invoice.notes) {
    ws.addRow([]);
    const notesRow = ws.addRow(["Notes:", invoice.notes]);
    notesRow.getCell(1).font = { bold: true, size: 10 };
    notesRow.getCell(2).font = { size: 10 };
  }

  // ── Generated timestamp ──
  ws.addRow([]);
  const genRow = ws.addRow([`Generated: ${new Date().toLocaleDateString("en-US")}   |   Rate Version: ${invoice.rateVersion}`]);
  mergeRow(ws, genRow.number);
  genRow.getCell(1).font = { italic: true, size: 9, color: { argb: C.border } };

  return { totalRowNum, itemRowNums, catSubtotalRowNums };
}

/** Export a single invoice — styled sheet + optional raw data tabs + Rate Table + OM Subsidy */
async function exportInvoiceToExcel(
  invoice: BillingInvoice,
  source?: WmsSource | null,
  orderEdits?: Record<string, Record<string, number>>,
  storageRows?: StorageRow[]
) {
  const wb = new ExcelJS.Workbook();
  const custCode = invoice.customer;
  const refs: DataSheetRefs = {};

  // Add detail sheets if source data is available
  if (source) {
    if (source.b2b.length > 0) {
      const { sheetName } = addB2BDetailSheet(wb, custCode, source.b2b, orderEdits ?? {});
      refs.b2bSheet = sheetName;
    }
    if (source.receiving.length > 0) {
      const { sheetName } = addInboundDetailSheet(wb, custCode, source.receiving);
      refs.inboundSheet = sheetName;
    }
    if (source.b2c.length > 0) {
      const { sheetName } = addB2CDetailSheet(wb, custCode, source.b2c);
      refs.b2cSheet = sheetName;
    }
  }
  if (storageRows && storageRows.length > 0) {
    const { avgSheetName } = addInventoryDetailSheets(wb, storageRows);
    refs.storageAvgSheet = avgSheetName;
  }

  // Invoice sheet: use formula version if we have data sheets, else styled static
  const sheetName = (invoice.customerName || invoice.customer).slice(0, 31);
  const hasRefs = Object.keys(refs).length > 0;
  if (hasRefs) {
    fillInvoiceSheetFormula(wb.addWorksheet(sheetName), invoice, refs);
  } else {
    fillInvoiceSheet(wb.addWorksheet(sheetName), invoice);
  }

  addRateTableSheet(wb);
  addOmSubsidySheet(wb);
  await downloadWorkbook(wb, `Invoice_${invoice.customer}_${invoice.period}.xlsx`);
}

/** Export multiple invoices — styled Summary tab + one tab per customer + optional raw data tabs */
async function exportAllToExcel(
  invoices: BillingInvoice[],
  period: string,
  wmsSourceMap?: Record<string, WmsSource> | null,
  orderEditsMap?: Record<string, Record<string, Record<string, number>>> | null,
  storageRows?: StorageRow[],
  omSubsidy?: number,
  subleaseTotal?: number
) {
  if (invoices.length === 0) return;
  const wb = new ExcelJS.Workbook();

  // ── Summary sheet — same styled layout as individual invoice, aggregated ──
  const ws = wb.addWorksheet("Summary");
  ws.columns = COL_WIDTHS_7.map((w) => ({ width: w }));

  // Helper: merge full row A–G
  const merge = (rowNum: number) => ws.mergeCells(`A${rowNum}:${LAST_COL_LETTER}${rowNum}`);

  // ── Header rows ──
  const r1 = ws.addRow(["CTK USA, INC."]);
  r1.height = 28; merge(r1.number);
  Object.assign(r1.getCell(1), {
    font: { bold: true, size: 16, color: { argb: C.white }, name: "Calibri" },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } },
    alignment: { vertical: "middle", horizontal: "center" },
  }); applyBorder(r1.getCell(1), "medium");

  const customerNames = invoices.map(inv => inv.customerName || inv.customer).join(", ");
  const r2 = ws.addRow([`Combined Invoice — ${customerNames}`]);
  r2.height = 20; merge(r2.number);
  Object.assign(r2.getCell(1), {
    font: { bold: true, size: 12, color: { argb: C.navy } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: C.white } },
    alignment: { vertical: "middle", horizontal: "center" },
  }); applyBorder(r2.getCell(1));

  const r3 = ws.addRow([`Billing Period: ${periodRange(period)}`]);
  r3.height = 18; merge(r3.number);
  Object.assign(r3.getCell(1), {
    font: { size: 11, color: { argb: C.black } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: C.white } },
    alignment: { vertical: "middle", horizontal: "center" },
  }); applyBorder(r3.getCell(1));

  // ── Column headers ──
  const hdr = ws.addRow(["No.", "Category", "Description", "Rate", "Unit", "Qty", "Amount"]);
  hdr.height = 18;
  hdr.eachCell((cell, col) => {
    cell.font = { bold: true, color: { argb: C.white }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.blue } };
    cell.alignment = { vertical: "middle", horizontal: col <= 3 ? "center" : "right" };
    applyBorder(cell, "medium");
  });

  // ── Aggregate line items across all invoices (sum qty by item id) ──
  // Pre-populate with ALL default line items at qty=0 so every row always appears
  const itemMap = new Map<string, BillingLineItem & { totalQty: number }>();
  for (const def of buildDefaultLineItems()) {
    itemMap.set(def.id, { ...def, totalQty: 0 });
  }
  // Sum qty from each invoice on top of the defaults
  for (const inv of invoices) {
    for (const item of inv.lineItems) {
      const existing = itemMap.get(item.id);
      if (existing) {
        existing.totalQty += item.qty;
        // Keep description/rate/unit from the invoice (may have custom rates)
        existing.rate = item.rate;
        existing.costPlus = item.costPlus;
      } else {
        itemMap.set(item.id, { ...item, totalQty: item.qty });
      }
    }
  }

  let lineNo = 1;
  let sectionNo = 1;
  let grandTotal = 0;
  // track Summary sheet's own item rows so we can wire formulas after customer sheets are built
  const summaryItemRows: Record<string, number> = {};
  const summaryCatSubtotalRows: Record<string, number> = {};

  for (const cat of BILLING_CATEGORIES) {
    const catItems = Array.from(itemMap.values()).filter(
      (it) => it.category === cat
    );
    if (catItems.length === 0) continue;

    // Section header
    const sec = ws.addRow([`${sectionNo}. ${cat}`]);
    sec.height = 16; merge(sec.number);
    Object.assign(sec.getCell(1), {
      font: { bold: true, size: 10, color: { argb: C.sectionFont } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: C.sectionBg } },
      alignment: { vertical: "middle", indent: 1 },
    }); applyBorder(sec.getCell(1), "medium");
    sectionNo++;

    for (const item of catItems) {
      const aggQty = item.totalQty;
      const aggAmt = aggQty === 0 ? 0 : (item.costPlus ? aggQty * 1.1 : aggQty * item.rate);
      grandTotal += aggAmt;

      const r = ws.addRow([
        lineNo, cat, item.description,
        item.costPlus ? "cost+10%" : item.rate,
        item.unit, aggQty, aggAmt,  // placeholder — overwritten with formulas later
      ]);
      summaryItemRows[item.id] = r.number;
      r.height = 15;
      const isZero = aggQty === 0;
      const isAlt = lineNo % 2 === 0;
      r.eachCell((cell, col) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isZero ? C.subtotalBg : (isAlt ? C.rowAlt : C.white) } };
        cell.font = { size: 10, color: { argb: isZero ? C.border : C.black } };
        cell.alignment = { vertical: "middle", horizontal: col <= 3 ? "left" : "right" };
        applyBorder(cell);
      });
      r.getCell(4).font = { size: 10, color: { argb: isZero ? C.border : C.teal } };
      if (!item.costPlus) r.getCell(4).numFmt = "$#,##0.00";
      const qtyVal = Math.round(aggQty * 100) / 100;
      r.getCell(6).numFmt = Number.isInteger(qtyVal) ? "#,##0" : "#,##0.00";
      r.getCell(7).numFmt = "$#,##0.00";
      lineNo++;
    }

    // Subtotal — formula-based using Summary's own item rows
    const firstSumRow = summaryItemRows[catItems[0].id];
    const lastSumRow  = summaryItemRows[catItems[catItems.length - 1].id];
    const subVal = catItems.reduce((s, i) => s + (i.totalQty === 0 ? 0 : (i.costPlus ? i.totalQty * 1.1 : i.totalQty * i.rate)), 0);
    const sub = ws.addRow(["", "", "", "", "", "Subtotal",
      firstSumRow && lastSumRow
        ? { formula: `=SUM(G${firstSumRow}:G${lastSumRow})`, result: subVal }
        : subVal
    ]);
    summaryCatSubtotalRows[cat] = sub.number;
    sub.height = 15;
    sub.eachCell((cell, col) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.subtotalBg } };
      cell.font = { bold: col >= 6, size: 10, color: { argb: C.black } };
      cell.alignment = { vertical: "middle", horizontal: "right" };
      applyBorder(cell);
    });
    sub.getCell(7).numFmt = "$#,##0.00";
  }

  // ── OM Subsidy row (if provided) ──
  if (omSubsidy && omSubsidy > 0) {
    grandTotal += omSubsidy;
    const omRow = ws.addRow(["", "OM Subsidy", "OM Subsidy — STL Allocation", "", "monthly", 1, omSubsidy]);
    omRow.height = 15;
    omRow.eachCell((cell, col) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F3FF" } };
      cell.font = { size: 10, color: { argb: "FF7C3AED" } };
      cell.alignment = { vertical: "middle", horizontal: col <= 3 ? "left" : "right" };
      applyBorder(cell);
    });
    omRow.getCell(6).numFmt = "#,##0";
    omRow.getCell(7).numFmt = "$#,##0.00";
  }

  // ── Office Sublease rows (if provided) ──
  if (subleaseTotal && subleaseTotal > 0) {
    grandTotal += subleaseTotal;
    // Section header
    const slSec = ws.addRow(["Office Sublease"]);
    slSec.height = 16;
    mergeRow(ws, slSec.number);
    const slSecCell = slSec.getCell(1);
    slSecCell.font = { bold: true, size: 10, color: { argb: C.sectionFont } };
    slSecCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3CD" } };
    slSecCell.alignment = { vertical: "middle", indent: 1 };
    applyBorder(slSecCell, "medium");
    // Single combined row
    const slRow = ws.addRow(["", "Office Sublease", "Office Sublease — Monthly Fixed Charges", "", "monthly", 1, subleaseTotal]);
    slRow.height = 15;
    slRow.eachCell((cell, col) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8E1" } };
      cell.font = { size: 10, color: { argb: "FFB45309" } };
      cell.alignment = { vertical: "middle", horizontal: col <= 3 ? "left" : "right" };
      applyBorder(cell);
    });
    slRow.getCell(6).numFmt = "#,##0";
    slRow.getCell(7).numFmt = "$#,##0.00";
  }

  // ── Grand Total — formula summing all subtotals ──
  const gtSubtotalRefs = Object.values(summaryCatSubtotalRows).map(r => `G${r}`).join("+");
  const gt = ws.addRow(["", "", "", "", "", "GRAND TOTAL",
    gtSubtotalRefs ? { formula: `=${gtSubtotalRefs}`, result: grandTotal } : grandTotal
  ]);
  gt.height = 22;
  gt.eachCell((cell, col) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.greenBg } };
    applyBorder(cell, "medium");
    if (col >= 6) {
      cell.font = { bold: true, size: 12, color: { argb: C.white } };
      cell.alignment = { vertical: "middle", horizontal: "right" };
    }
  });
  gt.getCell(7).numFmt = "$#,##0.00";

  // ── Per-customer breakdown table ──
  ws.addRow([]);
  const bkHdr = ws.addRow(["Per Customer Breakdown"]);
  bkHdr.height = 16; merge(bkHdr.number);
  Object.assign(bkHdr.getCell(1), {
    font: { bold: true, size: 11, color: { argb: C.white } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } },
    alignment: { vertical: "middle", indent: 1 },
  }); applyBorder(bkHdr.getCell(1), "medium");

  // Sub-header: merge cols so it fits — use wide 3-col layout A=Customer, B=Code, C-F=categories merged label, G=Total
  // Just do a simple flat table with as many cols as needed (reuse cols A–G, some merged)
  const bkColHdr = ws.addRow(["Customer", "Code", ...BILLING_CATEGORIES, "Total"]);
  // widen to fit — override widths for these extra cols if needed
  bkColHdr.height = 16;
  bkColHdr.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: C.white }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.blue } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    applyBorder(cell, "medium");
  });
  // Extend sheet columns if needed for breakdown table
  const extraCols = 2 + BILLING_CATEGORIES.length + 1; // Customer + Code + cats + Total
  if (extraCols > NCOLS) {
    // add extra column widths
    for (let i = NCOLS + 1; i <= extraCols; i++) {
      ws.getColumn(i).width = 16;
    }
  }

  for (let i = 0; i < invoices.length; i++) {
    const inv = invoices[i];
    const row = ws.addRow([
      inv.customerName || inv.customer,
      inv.customer,
      ...BILLING_CATEGORIES.map((c) => inv.subtotals?.[c] ?? 0),
      inv.total,
    ]);
    row.height = 15;
    row.eachCell((cell, col) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i % 2 === 0 ? C.white : C.rowAlt } };
      cell.font = { size: 10, color: { argb: C.black } };
      cell.alignment = { vertical: "middle", horizontal: col <= 2 ? "left" : "right" };
      applyBorder(cell);
      if (col > 2) cell.numFmt = "$#,##0.00";
    });
  }

  // Grand total row for breakdown table
  const bkTot = ws.addRow([
    "TOTAL", "",
    ...BILLING_CATEGORIES.map((c) => invoices.reduce((s, inv) => s + (inv.subtotals?.[c] ?? 0), 0)),
    invoices.reduce((s, inv) => s + inv.total, 0),
  ]);
  bkTot.height = 18;
  bkTot.eachCell((cell, col) => {
    cell.font = { bold: true, color: { argb: C.white }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.greenBg } };
    applyBorder(cell, "medium");
    if (col > 2) { cell.numFmt = "$#,##0.00"; cell.alignment = { horizontal: "right" }; }
  });

  // Generated note
  ws.addRow([]);
  const genR = ws.addRow([`Generated: ${new Date().toLocaleDateString("en-US")}`]);
  merge(genR.number);
  genR.getCell(1).font = { italic: true, size: 9, color: { argb: C.border } };

  // ── Inventory storage sheets (shared across all customers) ──
  let sharedStorageAvg: string | undefined;
  if (storageRows && storageRows.length > 0) {
    const { avgSheetName } = addInventoryDetailSheets(wb, storageRows);
    sharedStorageAvg = avgSheetName;
  }

  // ── One set of WMS data sheets + invoice sheet per customer ──
  type CustomerMeta = InvoiceSheetMeta & { inv: BillingInvoice; sheetName: string };
  const customerMetas: CustomerMeta[] = [];
  const usedNames = new Set<string>();

  for (const inv of invoices) {
    const custCode = inv.customer;
    const source = wmsSourceMap?.[custCode] ?? null;
    const custOrderEdits = orderEditsMap?.[custCode] ?? {};
    const refs: DataSheetRefs = {};

    if (source) {
      if (source.b2b.length > 0) {
        const { sheetName } = addB2BDetailSheet(wb, custCode, source.b2b, custOrderEdits);
        refs.b2bSheet = sheetName;
      }
      if (source.receiving.length > 0) {
        const { sheetName } = addInboundDetailSheet(wb, custCode, source.receiving);
        refs.inboundSheet = sheetName;
      }
      if (source.b2c.length > 0) {
        const { sheetName } = addB2CDetailSheet(wb, custCode, source.b2c);
        refs.b2cSheet = sheetName;
      }
    }
    if (sharedStorageAvg) refs.storageAvgSheet = sharedStorageAvg;

    let name = (inv.customerName || inv.customer).slice(0, 28);
    if (usedNames.has(name)) name = `${name.slice(0, 24)}_${inv.customer.slice(-3)}`;
    usedNames.add(name);

    const meta = fillInvoiceSheetFormula(wb.addWorksheet(name), inv, refs);
    customerMetas.push({ ...meta, inv, sheetName: name });
  }

  // ── Update Summary sheet — replace all hardcoded values with cross-sheet formulas ──
  if (customerMetas.length > 0) {
    const sn = (name: string) => `'${name}'`; // safe sheet name wrapper

    // 1. Per line item: Qty = SUM of each customer's qty cell, Amount = SUM of amount cells
    const allItemIds = new Set(customerMetas.flatMap(m => Object.keys(m.itemRowNums)));
    allItemIds.forEach(itemId => {
      // Find which summary row this item is in by looking at the first customer's row map
      // (all customers have same row structure)
      const firstMeta = customerMetas.find(m => m.itemRowNums[itemId]);
      if (!firstMeta) return;

      // Find the summary sheet row for this item by scanning itemMap
      // The summary sheet was built in the same category order — row matches first customer's offset from row 5
      // We already tracked the summary rows via the itemMap building loop above, but we need to store them.
      // Fallback: we'll update the Per-Customer Breakdown table only (simpler, more reliable).
    });

    // 2. Grand Total cell → SUM of each customer's total cell
    if (customerMetas.every(m => m.totalRowNum > 0)) {
      const parts = customerMetas.map(m => `${sn(m.sheetName)}!G${m.totalRowNum}`);
      const grandTotalResult = invoices.reduce((s, inv) => s + inv.total, 0)
        + (omSubsidy && omSubsidy > 0 ? omSubsidy : 0)
        + (subleaseTotal && subleaseTotal > 0 ? subleaseTotal : 0);
      ws.getCell(`G${gt.number}`).value = { formula: `=${parts.join("+")}`, result: grandTotalResult };
    }

    // 2b. Per line item in Summary: Qty = SUM of customer qty cells, Amount = SUM of amount cells
    Object.keys(summaryItemRows).forEach(itemId => {
      const sumRow = summaryItemRows[itemId];
      if (!sumRow) return;
      const custQtyCells  = customerMetas.filter(m => m.itemRowNums[itemId]).map(m => `${sn(m.sheetName)}!F${m.itemRowNums[itemId]}`);
      const custAmtCells  = customerMetas.filter(m => m.itemRowNums[itemId]).map(m => `${sn(m.sheetName)}!G${m.itemRowNums[itemId]}`);
      if (custQtyCells.length > 0) {
        const aggQty = invoices.reduce((s, inv) => s + (inv.lineItems.find(l => l.id === itemId)?.qty ?? 0), 0);
        const aggAmt = invoices.reduce((s, inv) => { const it = inv.lineItems.find(l => l.id === itemId); return s + (it ? calcLineAmount(it) : 0); }, 0);
        ws.getCell(`F${sumRow}`).value = { formula: `=${custQtyCells.join("+")}`, result: aggQty };
        ws.getCell(`G${sumRow}`).value = { formula: `=${custAmtCells.join("+")}`, result: aggAmt };
      }
    });

    // 3. Per-Customer Breakdown rows → replace static values with cell references
    // The breakdown table starts after gt row + 2 blank/header rows
    // Row positions: bkHdr, bkColHdr, then one row per customer
    // We need to find those rows. Track bkFirstDataRow using a known offset.
    const bkFirstDataRow = gt.number + 3; // gt → blank → bkHdr → bkColHdr → first data row
    for (let i = 0; i < invoices.length; i++) {
      const meta = customerMetas[i];
      if (!meta || meta.totalRowNum <= 0) continue;
      const rowNum = bkFirstDataRow + i;
      const bkRow = ws.getRow(rowNum);

      // Col 3 onwards = category subtotals, last col = total
      BILLING_CATEGORIES.forEach((cat, ci) => {
        const catSubRow = meta.catSubtotalRowNums[cat];
        if (catSubRow) {
          const cellAmt = meta.inv.subtotals?.[cat] ?? 0;
          bkRow.getCell(3 + ci).value = { formula: `=${sn(meta.sheetName)}!G${catSubRow}`, result: cellAmt };
          bkRow.getCell(3 + ci).numFmt = "$#,##0.00";
        }
      });
      // Total column (last)
      const totalCell = 3 + BILLING_CATEGORIES.length;
      bkRow.getCell(totalCell).value = { formula: `=${sn(meta.sheetName)}!G${meta.totalRowNum}`, result: meta.inv.total };
      bkRow.getCell(totalCell).numFmt = "$#,##0.00";
    }

    // 4. Breakdown grand total row → SUM of customer rows above
    const bkTotalRow = bkFirstDataRow + invoices.length;
    const bkTotWsRow = ws.getRow(bkTotalRow);
    BILLING_CATEGORIES.forEach((_, ci) => {
      const colIdx = 3 + ci;
      const colLetter = String.fromCharCode(64 + colIdx); // C, D, E...
      bkTotWsRow.getCell(colIdx).value = {
        formula: `=SUM(${colLetter}${bkFirstDataRow}:${colLetter}${bkFirstDataRow + invoices.length - 1})`,
        result: invoices.reduce((s, inv) => s + (inv.subtotals?.[BILLING_CATEGORIES[ci]] ?? 0), 0),
      };
      bkTotWsRow.getCell(colIdx).numFmt = "$#,##0.00";
    });
    const totColIdx = 3 + BILLING_CATEGORIES.length;
    const totColLetter = String.fromCharCode(64 + totColIdx);
    bkTotWsRow.getCell(totColIdx).value = {
      formula: `=SUM(${totColLetter}${bkFirstDataRow}:${totColLetter}${bkFirstDataRow + invoices.length - 1})`,
      result: invoices.reduce((s, inv) => s + inv.total, 0),
    };
    bkTotWsRow.getCell(totColIdx).numFmt = "$#,##0.00";
  }

  addRateTableSheet(wb);
  addOmSubsidySheet(wb);

  await downloadWorkbook(wb, `Invoice_ALL_${period}.xlsx`);
}

// ─── Storage import constants ─────────────────────────────────────────────────

const STORAGE_LABEL_MAP: Record<string, string> = {
  "bin": "storage_bin",
  "shelf": "storage_shelf",
  "carton": "storage_carton",
  "pallet short": "storage_pallet_short",
  "pallet regular": "storage_pallet_regular",
  "pallet tall": "storage_pallet_tall",
  "open floor": "storage_open_floor",
};

const STORAGE_TEMPLATE_ROWS = [
  { key: "storage_bin",            label: "Bin" },
  { key: "storage_shelf",          label: "Shelf" },
  { key: "storage_carton",         label: "Carton" },
  { key: "storage_pallet_short",   label: "Pallet Short" },
  { key: "storage_pallet_regular", label: "Pallet Regular" },
  { key: "storage_pallet_tall",    label: "Pallet Tall" },
  { key: "storage_open_floor",     label: "Open Floor" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const { user } = useAuth();

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  // ── invoice list ──
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [listLoading, setListLoading] = useState(false);

  // ── editor state ──
  const [editing, setEditing] = useState<BillingInvoice | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // ── new invoice form ──
  const [newCustomer, setNewCustomer] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newYear, setNewYear] = useState(String(new Date().getFullYear()));
  const [newMonth, setNewMonth] = useState(String(new Date().getMonth() + 1).padStart(2, "0"));
  const [showNewForm, setShowNewForm] = useState(false);

  // ── customers from WMS ──
  const [customers, setCustomers] = useState<{ code: string; name: string }[]>([]);

  // ── auto-fetch state ──
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState("");

  // ── collapsed sections ──
  const [collapsed, setCollapsed] = useState<Set<BillingCategory>>(new Set());

  // ── "All Customers" export state ──
  const [allExporting, setAllExporting] = useState(false);
  const [allExportMsg, setAllExportMsg] = useState("");

  // ── Export preview modal ──
  type ExportPreviewTarget =
    | { mode: "single"; invoice: BillingInvoice }
    | { mode: "multi";  invoices: BillingInvoice[]; period: string; omSubsidy: number; subleaseTotal: number }
    | { mode: "list";   invoices: BillingInvoice[]; period: string };
  const [exportPreview, setExportPreview] = useState<ExportPreviewTarget | null>(null);

  // ── WMS source data (shown after auto-fetch) ──
  const [wmsSource, setWmsSource] = useState<WmsSource | null>(null);
  const [sourceTab, setSourceTab] = useState<"receiving" | "b2b" | "b2c" | "returns" | "storage">("receiving");
  const [showSource, setShowSource] = useState(false);
  // per-order manual overrides: { orderCode: { billingKey: value } }
  const [orderEdits, setOrderEdits] = useState<Record<string, Record<string, number>>>({});
  // per-customer WMS source map for multi-mode exports
  const [wmsSourceMap, setWmsSourceMap] = useState<Record<string, WmsSource>>({});
  // per-customer order edits map: customerCode → orderCode → billingKey → number
  const [orderEditsMap, setOrderEditsMap] = useState<Record<string, Record<string, Record<string, number>>>>({});

  // ── multi-customer combined invoice ──
  const [editGroup, setEditGroup] = useState<BillingInvoice[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);

  // ── extra tabs: Rate Table / OM Subsidy / Office Sublease ──
  const [extraTab, setExtraTab] = useState<"none" | "rate-table" | "om-subsidy" | "sublease">("none");
  const [omWages, setOmWages] = useState<string>("");
  const [omAllocPct, setOmAllocPct] = useState<string>("40");
  // Office Sublease (top-level, not per-customer) — persisted to localStorage
  const SUBLEASE_RENT_RATE   = 1490;    // per month
  const SUBLEASE_OP_RATE     = 1.01;    // per sq ft / month
  const [subleaseRentQty, setSubleaseRentQty] = useState<string>(() =>
    typeof window !== "undefined" ? (localStorage.getItem("billing_sublease_rent_qty") ?? "1") : "1"
  );
  const [subleaseOpQty, setSubleaseOpQty] = useState<string>(() =>
    typeof window !== "undefined" ? (localStorage.getItem("billing_sublease_op_qty") ?? "1000") : "1000"
  );

  // ── new invoice form: multi-select ──
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);

  // ── Storage import ──
  type StorageSnap = { data: Record<string, number>; file: string };
  const [storage15, setStorage15] = useState<StorageSnap | null>(null);
  const [storageLast, setStorageLast] = useState<StorageSnap | null>(null);
  const [storageUploading15, setStorageUploading15] = useState(false);
  const [storageUploadingLast, setStorageUploadingLast] = useState(false);
  const [storageLoadingHistory, setStorageLoadingHistory] = useState(false);
  const [storageHistoryError, setStorageHistoryError] = useState("");
  const [storageHistoryDebug, setStorageHistoryDebug] = useState<{date15: string; dateLast: string; rows15: number; rowsLast: number; matched15: number; matchedLast: number} | null>(null);

  // Derived: merge 15일 + 말일 → avg
  const storageRows = useMemo<StorageRow[]>(() => {
    if (!storage15 && !storageLast) return [];
    return STORAGE_TEMPLATE_ROWS
      .map(r => {
        const qty15   = storage15?.data[r.key]   ?? 0;
        const qtyLast = storageLast?.data[r.key] ?? 0;
        return { key: r.key, label: r.label, qty15, qtyLast, avg: (qty15 + qtyLast) / 2 };
      })
      .filter(r => r.qty15 > 0 || r.qtyLast > 0);
  }, [storage15, storageLast]);

  // Parse WMS inventory export → count distinct locations per Location Type
  async function parseInventoryFile(file: File, customerCode: string): Promise<Record<string, number>> {
    const buf = await file.arrayBuffer();
    const { read, utils } = await import("xlsx");
    const wb = read(buf);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][];

    // Normalize header: lowercase, strip spaces/underscores for flexible matching
    // e.g. "occupancyInfo" → "occupancyinfo", "Location Type" → "locationtype"
    const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[\s_]/g, "");

    let headerIdx = -1, colLoc = -1, colLocType = -1, colCustomer = -1;
    for (let i = 0; i < Math.min(8, rows.length); i++) {
      const hdrs = rows[i].map(norm);
      // occupancyInfo takes priority; fallback to "location type" / "loctype"
      const iOcc  = hdrs.findIndex(h => h === "occupancyinfo" || h === "occupancy");
      const iType = hdrs.findIndex(h => h === "locationtype"  || h === "loctype");
      const iLoc  = hdrs.findIndex(h => h === "location"      || h === "loc");
      const iUsed = iOcc >= 0 ? iOcc : iType;
      if (iUsed >= 0 && iLoc >= 0) {
        headerIdx  = i;
        colLocType = iUsed;
        colLoc     = iLoc;
        colCustomer = hdrs.findIndex(h => h.includes("customer"));
        break;
      }
    }
    if (headerIdx < 0) throw new Error("Header row not found. File must contain 'Location' and 'occupancyInfo' (or 'Location Type') columns.");

    // Count distinct Location values per storage key, filtered by exact customer code
    const locSets: Record<string, Set<string>> = {};
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      const locType = String(row[colLocType] ?? "").trim().toLowerCase();
      const loc     = String(row[colLoc]     ?? "").trim();
      if (!locType || !loc) continue;

      // Exact customer code match (case-insensitive)
      if (colCustomer >= 0 && customerCode) {
        const cust = String(row[colCustomer] ?? "").trim().toLowerCase();
        if (cust && cust !== customerCode.toLowerCase()) continue;
      }

      const key = STORAGE_LABEL_MAP[locType];
      if (!key) continue;
      (locSets[key] ??= new Set()).add(loc);
    }

    const result: Record<string, number> = {};
    for (const [k, s] of Object.entries(locSets)) result[k] = s.size;
    return result;
  }

  async function handleUpload15(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !editing) return;
    setStorageUploading15(true);
    try {
      const data = await parseInventoryFile(file, editing.customer);
      setStorage15({ data, file: file.name });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to parse file.");
    } finally {
      setStorageUploading15(false);
      e.target.value = "";
    }
  }

  async function handleUploadLast(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !editing) return;
    setStorageUploadingLast(true);
    try {
      const data = await parseInventoryFile(file, editing.customer);
      setStorageLast({ data, file: file.name });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to parse file.");
    } finally {
      setStorageUploadingLast(false);
      e.target.value = "";
    }
  }

  // ── Load storage data from inventory_history (Supabase) ──
  async function loadStorageFromHistory() {
    if (!editing) return;
    setStorageLoadingHistory(true);
    setStorageHistoryError("");
    setStorageHistoryDebug(null);

    try {
      const [year, month] = editing.period.split("-").map(Number);
      const lastDayNum = new Date(year, month, 0).getDate();
      const date15   = `${editing.period}-15`;
      const dateLast = `${editing.period}-${String(lastDayNum).padStart(2, "0")}`;
      const whCode   = "STOO1";

      // 1. Fetch WMS location list → build occupancyInfo lookup (reuse wms.ts helpers)
      const locRes = await fetch("/api/wms/warehouse/location/list", {
        method: "POST",
        headers,
        body: JSON.stringify({ page: 1, pageSize: 9999, warehouseCode: whCode, search: "", sortField: "WarehouseCode", sortDir: "asc" }),
      });
      const locJson = await locRes.json().catch(() => ({}));
      const locArr: Record<string, unknown>[] = Array.isArray(locJson?.data?.list)
        ? locJson.data.list
        : Array.isArray(locJson?.data) ? locJson.data : Array.isArray(locJson) ? locJson : [];

      // Use the same lookup builder as the history page (handles key normalization)
      const occupancyLookup = buildLocationOccupancyLookup(locArr);

      // 2. Query inventory_history via server API (uses service-role key, bypasses RLS)
      const fetchSnap = async (date: string): Promise<{ data: Record<string, number>; totalRows: number; matchedRows: number; actualDate: string }> => {
        const url = `/api/billing/storage-snapshot?warehouseCode=${encodeURIComponent(whCode)}&customerCode=${encodeURIComponent(editing!.customer)}&date=${encodeURIComponent(date)}`;
        const res = await fetch(url);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(`Snapshot fetch error (${date}): ${err.error ?? res.status}`);
        }
        const json: { date: string; rows: number; locations: string[] } = await res.json();
        if (json.rows === 0) return { data: {}, totalRows: 0, matchedRows: 0, actualDate: date };

        // Count distinct locations per storage type using the same wms.ts lookup
        const locSets: Record<string, Set<string>> = {};
        let matchedRows = 0;
        for (const loc of json.locations) {
          if (!loc) continue;
          const [zone, aisle, bay, level, position] = loc.split("-");
          const fakeRow = { location: loc, locationCode: loc, zone, aisle, bay, level, position,
            zoneName: zone, aisleName: aisle, bayName: bay, levelName: level, positionName: position };
          const typeLabel = getLocationOccupancyInfo(occupancyLookup, fakeRow);
          const key = STORAGE_LABEL_MAP[typeLabel.toLowerCase()];
          if (!key) continue;
          matchedRows++;
          (locSets[key] ??= new Set()).add(loc);
        }
        const result: Record<string, number> = {};
        for (const [k, s] of Object.entries(locSets)) result[k] = s.size;
        return { data: result, totalRows: json.rows, matchedRows, actualDate: date };
      };

      const [snap15, snapLast] = await Promise.all([
        fetchSnap(date15),
        fetchSnap(dateLast),
      ]);

      // Always store debug info
      setStorageHistoryDebug({
        date15, dateLast,
        rows15: snap15.totalRows,    rowsLast: snapLast.totalRows,
        matched15: snap15.matchedRows, matchedLast: snapLast.matchedRows,
      });

      const total15   = Object.values(snap15.data).reduce((s, v) => s + v, 0);
      const totalLast = Object.values(snapLast.data).reduce((s, v) => s + v, 0);

      if (snap15.totalRows === 0 && snapLast.totalRows === 0) {
        setStorageHistoryError(`No snapshot found for ${editing.customer} on ${date15} or ${dateLast}. Please run Save Now in the History page on those dates.`);
      } else if (total15 === 0 && totalLast === 0) {
        setStorageHistoryError(
          `Snapshots found (${date15}: ${snap15.totalRows} rows, ${dateLast}: ${snapLast.totalRows} rows) but 0 locations matched a known type. ` +
          `The WMS location list returned ${locArr.length} locations (${occupancyLookup.size} with occupancyInfo).`
        );
      } else {
        setStorage15({ data: snap15.data,   file: `WMS History · ${date15}` });
        setStorageLast({ data: snapLast.data, file: `WMS History · ${dateLast}` });
      }
    } catch (e) {
      setStorageHistoryError(e instanceof Error ? e.message : "Failed to load history data");
    } finally {
      setStorageLoadingHistory(false);
    }
  }

  function applyStorageToInvoice() {
    if (!editing || storageRows.length === 0) return;
    const updates: Record<string, number> = {};
    storageRows.forEach(r => {
      updates[r.key] = Math.round(r.avg * 100) / 100; // round to 2 decimals
    });
    setEditing(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        lineItems: prev.lineItems.map(item =>
          updates[item.id] !== undefined
            ? { ...item, qty: updates[item.id], autoFetched: true }
            : item
        ),
      };
    });
  }

  // ── load invoice list ──
  async function loadList() {
    setListLoading(true);
    try {
      const res = await fetch("/api/billing/invoices");
      if (res.ok) setInvoices(await res.json());
    } finally {
      setListLoading(false);
    }
  }

  // ── load customers ──
  useEffect(() => {
    loadList();
    // Fetch customer list from WMS
    fetch("/api/wms/combo/customer-by-ordertype/B2B?warehouseCode=", { headers })
      .then((r) => r.json())
      .then((j) => {
        const list = j?.data ?? j ?? [];
        if (Array.isArray(list)) {
          setCustomers(
            list.map((c: Record<string, unknown>) => ({
              code: String(c.customerCode ?? c.code ?? ""),
              name: String(c.customerName ?? c.name ?? ""),
            }))
          );
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── persist sublease values to localStorage ──
  useEffect(() => { localStorage.setItem("billing_sublease_rent_qty", subleaseRentQty); }, [subleaseRentQty]);
  useEffect(() => { localStorage.setItem("billing_sublease_op_qty",   subleaseOpQty);   }, [subleaseOpQty]);

  // ── create new invoice (with rate master applied) ──
  async function createInvoice() {
    const period = `${newYear}-${newMonth}`;
    const name = customers.find((c) => c.code === newCustomer)?.name ?? newCustomerName;
    const inv = buildNewInvoice(newCustomer, name, period);

    // Apply customer-specific rate master if available
    try {
      const res = await fetch(`/api/billing/rates?customer=${encodeURIComponent(newCustomer)}`);
      if (res.ok) {
        const master: CustomerRateMaster | null = await res.json();
        if (master) {
          inv.lineItems = applyRateMaster(inv.lineItems, master.rates);
          inv.rateVersion = `custom (${new Date(master.updatedAt).toLocaleDateString("en-US")})`;
          inv.subtotals = calcSubtotals(inv.lineItems);
        }
      }
    } catch {
      // fallback to default rates silently
    }

    setEditing(inv);
    setEditGroup([inv]);
    setActiveIdx(0);
    setStorage15(null); setStorageLast(null);
    setShowNewForm(false);
    setFetchMsg("");
  }

  // ── create combined invoice for multiple customers ──
  async function createMultiInvoice() {
    if (selectedCustomers.length === 0) return;
    const period = `${newYear}-${newMonth}`;
    const groupId = `grp_${Date.now()}`;
    const invs: BillingInvoice[] = [];
    for (const code of selectedCustomers) {
      const name = customers.find(c => c.code === code)?.name ?? code;
      const inv = buildNewInvoice(code, name, period);
      inv.groupId = groupId;
      try {
        const res = await fetch(`/api/billing/rates?customer=${encodeURIComponent(code)}`);
        if (res.ok) {
          const master: CustomerRateMaster | null = await res.json();
          if (master) {
            inv.lineItems = applyRateMaster(inv.lineItems, master.rates);
            inv.rateVersion = `custom (${new Date(master.updatedAt).toLocaleDateString("en-US")})`;
            inv.subtotals = calcSubtotals(inv.lineItems);
          }
        }
      } catch { /* use default rates */ }
      invs.push(inv);
    }
    setEditGroup(invs);
    setActiveIdx(0);
    setEditing(invs[0]);
    setStorage15(null); setStorageLast(null);
    setShowNewForm(false); setFetchMsg("");
    setSelectedCustomers([]);
  }

  // ── open a grouped (combined) invoice set ──
  function openGroupInvoice(group: BillingInvoice[]) {
    const cloned = group.map(inv => mergeNewLineItems(JSON.parse(JSON.stringify(inv))));
    setEditGroup(cloned);
    setActiveIdx(0);
    setEditing(cloned[0]);
    setStorage15(null); setStorageLast(null);
    setFetchMsg(""); setWmsSource(null); setShowSource(false);
  }

  // ── get full group with current editing merged in at activeIdx ──
  function getCurrentGroup(): BillingInvoice[] {
    if (!editing) return editGroup;
    return editGroup.map((inv, i) =>
      i === activeIdx
        ? { ...editing, subtotals: calcSubtotals(editing.lineItems), total: calcTotal(editing.lineItems) }
        : inv
    );
  }

  // ── switch tab: save current editing → group, load new tab ──
  function switchTab(idx: number) {
    if (!editing || idx === activeIdx) return;
    const group = getCurrentGroup();
    // Save current customer's wmsSource and orderEdits before switching
    setWmsSourceMap(prev => ({ ...prev, [editing.customer]: wmsSource ?? prev[editing.customer] }));
    setOrderEditsMap(prev => ({ ...prev, [editing.customer]: orderEdits }));
    setEditGroup(group);
    const newCust = group[idx].customer;
    setEditing(JSON.parse(JSON.stringify(group[idx])));
    setActiveIdx(idx);
    setExtraTab("none");
    setStorage15(null); setStorageLast(null);
    setStorageHistoryError(""); setStorageHistoryDebug(null);
    setFetchMsg("");
    setShowSource(false);
    // Restore new customer's wmsSource and orderEdits
    setWmsSource(wmsSourceMap[newCust] ?? null);
    setOrderEdits(orderEditsMap[newCust] ?? {});
  }

  // ── save all invoices in combined group ──
  async function saveAllMulti(status: "draft" | "final") {
    if (!editing) return;
    setSaving(true); setSaveError("");
    const group = getCurrentGroup();
    try {
      for (const inv of group) {
        const payload: BillingInvoice = { ...inv, status, updatedAt: new Date().toISOString() };
        const res = await fetch("/api/billing/invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`Save failed for ${inv.customer}`);
      }
      await loadList();
      setEditing(null); setEditGroup([]); setActiveIdx(0);
    } catch (e) {
      setSaveError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  // ── open existing invoice ──
  function mergeNewLineItems(inv: BillingInvoice): BillingInvoice {
    // Add any line items that exist in the current default but not in the saved invoice
    // (handles rate table additions like Office Sublease added after initial save)
    const existingIds = new Set(inv.lineItems.map((i) => i.id));
    const defaults = buildDefaultLineItems();
    const missing = defaults.filter((d) => !existingIds.has(d.id));
    if (missing.length === 0) return inv;
    const merged = { ...inv, lineItems: [...inv.lineItems, ...missing] };
    merged.subtotals = calcSubtotals(merged.lineItems);
    merged.total = calcTotal(merged.lineItems);
    return merged;
  }

  function openInvoice(inv: BillingInvoice) {
    const cloned: BillingInvoice = JSON.parse(JSON.stringify(inv));
    const merged = mergeNewLineItems(cloned);
    setEditing(merged);
    setEditGroup([merged]);
    setActiveIdx(0);
    setStorage15(null); setStorageLast(null);
    setFetchMsg("");
    setWmsSource(null);
    setShowSource(false);
  }

  // ── update any field of a line item (rate는 Rate Master에서 관리, 편집 불가) ──
  const updateItem = useCallback((
    id: string,
    field: "qty" | "description" | "unit",
    raw: string
  ) => {
    setEditing((prev) => {
      if (!prev) return prev;
      const items = prev.lineItems.map((item) => {
        if (item.id !== id) return item;
        if (field === "qty") {
          const v = raw === "" ? 0 : parseFloat(raw);
          return { ...item, qty: isNaN(v) ? 0 : v, autoFetched: false };
        }
        return { ...item, [field]: raw };
      });
      return { ...prev, lineItems: items, subtotals: calcSubtotals(items), total: calcTotal(items) };
    });
  }, []);

  // ── shared: fetch WMS data for one customer/period → qty updates + raw source ──
  async function fetchWmsQty(
    customer: string,
    period: string
  ): Promise<{ updates: Record<string, number>; source: WmsSource }> {
    const [year, month] = period.split("-").map(Number);
    const lastDay = new Date(year, month, 0).getDate();

    // Send both formats — WMS APIs differ on which they accept
    const yyyymm     = `${year}${String(month).padStart(2, "0")}`;         // "202605"
    const startDash  = `${period}-01`;                                      // "2026-05-01"
    const endDash    = `${period}-${String(lastDay).padStart(2, "0")}`;    // "2026-05-31"
    const startCompact = `${yyyymm}01`;                                     // "20260501"
    const endCompact   = `${yyyymm}${String(lastDay).padStart(2, "0")}`;   // "20260531"

    // Normalize date string → YYYYMMDD (handles both "20260514" and "2026-05-14")
    function normDate(d: unknown): string {
      return String(d ?? "").replace(/-/g, "");
    }

    // B2B / B2C shipping: filter by OUT DATE and status must be FA (Complete)
    function isShippingComplete(order: Record<string, unknown>): boolean {
      const status = String(order.status ?? order.orderStatus ?? "");
      if (status !== "FA") return false;
      // out date field candidates
      const outRaw = normDate(
        order.outDate ?? order.deliveryDate ?? order.shippingDate ?? order.outboundDate ?? ""
      );
      if (!outRaw || outRaw.length < 6) return true; // no out date → keep if FA
      return outRaw.startsWith(yyyymm);
    }

    // Inbound receiving: status=DA (Complete) + inDate in period
    function isInboundInPeriod(order: Record<string, unknown>): boolean {
      const status = String(order.status ?? order.orderStatus ?? "");
      if (status && status !== "DA") return false;
      const raw = normDate(
        order.inDate ?? order.receiveDate ?? order.orderDate ?? ""
      );
      if (!raw || raw.length < 6) return true;
      return raw.startsWith(yyyymm);
    }

    // Returns: filter by return date + complete status
    function isReturnInPeriod(order: Record<string, unknown>): boolean {
      const raw = normDate(
        order.returnDate ?? order.inDate ?? order.orderDate ?? ""
      );
      if (!raw || raw.length < 6) return true;
      return raw.startsWith(yyyymm);
    }

    const updates: Record<string, number> = {};
    const source: WmsSource = { receiving: [], b2b: [], b2c: [], returns: [] };

    try {
      const j = await fetch("/api/wms/receiving/list", {
        method: "POST", headers,
        body: JSON.stringify({
          page: 1, limit: 2000,
          customerCode: customer,
          // try all common param names
          startDate: startDash, endDate: endDash,
          fromDate: startDash,  toDate: endDash,
          orderDateFrom: startDash, orderDateTo: endDash,
          startOrderDate: startCompact, endOrderDate: endCompact,
        }),
      }).then((r) => r.json());
      const raw: Record<string, unknown>[] = j?.data?.list ?? j?.data ?? j?.list ?? [];
      const list = Array.isArray(raw) ? raw.filter(isInboundInPeriod) : [];
      if (list.length > 0) {
        source.receiving = list;
        let cartons = 0;
        for (const ord of list) {
          const type = String(ord.inboundType ?? ord.receiveType ?? "").toLowerCase();
          // Container = charged separately, skip for per-carton count
          if (!type.includes("container") && !type.includes("cont")) {
            // Use carton-specific field if available, fall back to 1 per receiving order
            const cartonQty = ord.cartonQty ?? ord.boxQty ?? ord.packageQty ?? ord.cartonCount;
            cartons += cartonQty != null ? Number(cartonQty) : 1;
          }
        }
        if (cartons > 0) updates["inbound_carton"] = cartons;
      }
    } catch {}

    try {
      const j = await fetch("/api/wms/shipping/list", {
        method: "POST", headers,
        body: JSON.stringify({
          page: 1, limit: 2000,
          orderType: "B2B", customerCode: customer,
          startDate: startDash, endDate: endDash,
          fromDate: startDash,  toDate: endDash,
          orderDateFrom: startDash, orderDateTo: endDash,
          startOrderDate: startCompact, endOrderDate: endCompact,
        }),
      }).then((r) => r.json());
      const rawB2B: Record<string, unknown>[] = j?.data?.list ?? j?.data ?? j?.list ?? [];
      // Out date 기준 + FA(Complete) 상태만
      const list = Array.isArray(rawB2B) ? rawB2B.filter(isShippingComplete) : [];
      if (list.length > 0) {
        source.b2b = list;
        updates["b2b_order"] = list.length;

        // ── B2B task comment → billing line items ──────────────────────────────
        // Each task type maps to a specific billing item.
        // "Supplies" = supplies used for packing → counted as Carton Packing (b2b_carton_packing)
        let pickPiece = 0, pickCarton = 0, pickPallet = 0;
        let cartonPacking = 0, palletizing = 0;
        let labelQty = 0, insertQty = 0;
        let laborRegular = 0, laborOT = 0, laborWeekend = 0;
        const b2bWarnings: string[] = [];

        for (const order of list) {
          const tasks = parseTaskComment(String(order.comment ?? ""));

          const pp       = tasks["Picking per Piece"]    ?? 0;
          const pc       = tasks["Picking per Carton"]   ?? 0;
          const ppl      = tasks["Picking per Pallet"]   ?? 0;
          const oc       = tasks["Out per Carton"]       ?? 0;
          const op       = tasks["Out per Pallet"]       ?? 0;
          const supplies = tasks["Supplies"]             ?? 0;

          pickPiece  += pp;
          pickCarton += pc;
          pickPallet += ppl;

          // Labels: "Labels" / "Amazon Labels" / "FBA Labeling" → b2b_label
          labelQty += (tasks["Labels"]        ?? 0)
                    + (tasks["Amazon Labels"] ?? 0)
                    + (tasks["FBA Labeling"]  ?? 0);

          // Inserts → b2b_insert
          insertQty += tasks["Inserts"] ?? 0;

          // Carton Packing:
          //   1) Out per Carton (when ≠ Picking per Carton — actual repacking)
          //   2) Supplies used → add that qty as additional carton packing
          if (oc > 0 && oc !== pc) cartonPacking += oc;
          if (supplies > 0) cartonPacking += supplies;

          // Palletizing: Out per Pallet UNLESS equals Picking per Pallet
          if (op > 0 && op !== ppl) palletizing += op;

          // Labor Hours → Warehouse Labor billing items
          laborRegular += tasks["Labor Hours"]                   ?? 0;
          laborOT      += tasks["Labor Hours (OT)"]              ?? 0;
          laborWeekend += tasks["Labor Hours (Weekend/Holiday)"] ?? 0;

          // Warning: piece-level picking but no outbound container info
          if (pp > 0 && oc === 0 && op === 0 && supplies === 0) {
            const code = String(order.shippingOrderCode ?? order.orderCode ?? "");
            b2bWarnings.push(code);
          }
        }

        if (pickPiece     > 0) updates["b2b_pick_piece"]      = pickPiece;
        if (pickCarton    > 0) updates["b2b_pick_carton"]     = pickCarton;
        if (pickPallet    > 0) updates["b2b_pick_pallet"]     = pickPallet;
        if (cartonPacking > 0) updates["b2b_carton_packing"]  = cartonPacking;
        if (palletizing   > 0) updates["b2b_palletizing"]     = palletizing;
        if (b2bWarnings.length > 0) source.b2bWarnings = b2bWarnings;
        // B2B Labels & Inserts
        if (labelQty     > 0) updates["b2b_label"]         = labelQty;
        if (insertQty    > 0) updates["b2b_insert"]        = insertQty;
        // Labor Hours → Warehouse Labor
        if (laborRegular > 0) updates["labor_regular"]     = (updates["labor_regular"]     as number ?? 0) + laborRegular;
        if (laborOT      > 0) updates["labor_ot_weekday"]  = (updates["labor_ot_weekday"]  as number ?? 0) + laborOT;
        if (laborWeekend > 0) updates["labor_ot_weekend"]  = (updates["labor_ot_weekend"]  as number ?? 0) + laborWeekend;
      }
    } catch {}

    try {
      const j = await fetch("/api/wms/shipping/list", {
        method: "POST", headers,
        body: JSON.stringify({
          page: 1, limit: 2000,
          orderType: "B2C", customerCode: customer,
          startDate: startDash, endDate: endDash,
          fromDate: startDash,  toDate: endDash,
          orderDateFrom: startDash, orderDateTo: endDash,
          startOrderDate: startCompact, endOrderDate: endCompact,
        }),
      }).then((r) => r.json());
      const rawB2C: Record<string, unknown>[] = j?.data?.list ?? j?.data ?? j?.list ?? [];
      const listB2C = Array.isArray(rawB2C) ? rawB2C.filter(isShippingComplete) : [];
      if (listB2C.length > 0) {
        source.b2c = listB2C;
        updates["b2c_order"] = listB2C.length;
        const extraPicks = listB2C.reduce((s, o) => s + Math.max(0, Number(o.totalQty ?? o.orderQty ?? 0) - 5), 0);
        if (extraPicks > 0) updates["b2c_pick_piece"] = extraPicks;

        // Parse B2C task comments for labels, inserts, fragile, labor
        let b2cLabelQty = 0, b2cInsertQty = 0, b2cFragileQty = 0;
        let b2cLaborRegular = 0, b2cLaborOT = 0, b2cLaborWeekend = 0;
        for (const order of listB2C) {
          const tasks = parseTaskComment(String(order.comment ?? ""));
          b2cLabelQty   += (tasks["Labels"] ?? 0) + (tasks["Amazon Labels"] ?? 0) + (tasks["FBA Labeling"] ?? 0);
          b2cInsertQty  += (tasks["Inserts"] ?? 0);
          b2cFragileQty += (tasks["Fragile Pack"] ?? 0) + (tasks["Fragile"] ?? 0);
          b2cLaborRegular += tasks["Labor Hours"]                   ?? 0;
          b2cLaborOT      += tasks["Labor Hours (OT)"]              ?? 0;
          b2cLaborWeekend += tasks["Labor Hours (Weekend/Holiday)"] ?? 0;
        }
        if (b2cLabelQty    > 0) updates["fulfillment_label"]  = (updates["fulfillment_label"]  as number ?? 0) + b2cLabelQty;
        if (b2cInsertQty   > 0) updates["fulfillment_insert"] = (updates["fulfillment_insert"] as number ?? 0) + b2cInsertQty;
        if (b2cFragileQty  > 0) updates["b2c_fragile"] = b2cFragileQty;
        if (b2cLaborRegular > 0) updates["labor_regular"]    = (updates["labor_regular"]    as number ?? 0) + b2cLaborRegular;
        if (b2cLaborOT      > 0) updates["labor_ot_weekday"] = (updates["labor_ot_weekday"] as number ?? 0) + b2cLaborOT;
        if (b2cLaborWeekend > 0) updates["labor_ot_weekend"] = (updates["labor_ot_weekend"] as number ?? 0) + b2cLaborWeekend;
      }
    } catch {}

    try {
      const r = await fetch("/api/wms/returns/list", {
        method: "POST", headers,
        body: JSON.stringify({
          page: 1, limit: 2000,
          customerCode: customer,
          startDate: startDash, endDate: endDash,
          fromDate: startDash,  toDate: endDash,
          orderDateFrom: startDash, orderDateTo: endDash,
          startOrderDate: startCompact, endOrderDate: endCompact,
        }),
      });
      if (r.ok) {
        const j = await r.json();
        const rawRet: Record<string, unknown>[] = j?.data?.list ?? j?.data ?? j?.list ?? [];
        const listRet = Array.isArray(rawRet) ? rawRet.filter(isReturnInPeriod) : [];
        if (listRet.length > 0) {
          source.returns = listRet;
          updates["return_receiving"] = listRet.length;
          const pieces = listRet.reduce((s, o) => s + Number(o.totalQty ?? o.qty ?? 0), 0);
          if (pieces > 0) updates["return_restock"] = pieces;
        }
      }
    } catch {}

    return { updates, source };
  }

  // ── auto-fetch for current editing invoice ──
  async function autoFetch() {
    if (!editing) return;
    setFetching(true);
    setFetchMsg("Fetching WMS data...");
    setWmsSource(null);
    setShowSource(false);
    setOrderEdits({});
    try {
      const { updates, source } = await fetchWmsQty(editing.customer, editing.period);
      setWmsSource(source);
      setWmsSourceMap(prev => ({ ...prev, [editing.customer]: source }));
      setOrderEditsMap(prev => ({ ...prev, [editing.customer]: {} }));
      const count = Object.keys(updates).length;
      setFetchMsg(
        count > 0
          ? `✓ ${count} fields auto-filled from WMS data. Verify and adjust as needed.`
          : "No matching data found in WMS for this period. Enter quantities manually."
      );
      if (count > 0) {
        setEditing((prev) => {
          if (!prev) return prev;
          const items = prev.lineItems.map((item) =>
            updates[item.id] !== undefined ? { ...item, qty: updates[item.id], autoFetched: true } : item
          );
          return { ...prev, lineItems: items, subtotals: calcSubtotals(items), total: calcTotal(items) };
        });
      }
    } catch {
      setFetchMsg("Failed to fetch WMS data. Enter quantities manually.");
    } finally {
      setFetching(false);
    }
  }

  // ── "All Customers" export: fetch all + multi-sheet Excel ──
  async function exportAllCustomers() {
    if (customers.length === 0) return;
    const period = `${newYear}-${newMonth}`;
    setAllExporting(true);
    setAllExportMsg(`Fetching data for ${customers.length} customers...`);
    try {
      const invoiceList: BillingInvoice[] = [];
      for (let i = 0; i < customers.length; i++) {
        const c = customers[i];
        setAllExportMsg(`Fetching ${c.code} (${i + 1}/${customers.length})...`);
        const { updates } = await fetchWmsQty(c.code, period);
        const inv = buildNewInvoice(c.code, c.name, period);
        if (Object.keys(updates).length > 0) {
          inv.lineItems = inv.lineItems.map((item) =>
            updates[item.id] !== undefined ? { ...item, qty: updates[item.id], autoFetched: true } : item
          );
        }
        inv.subtotals = calcSubtotals(inv.lineItems);
        inv.total = calcTotal(inv.lineItems);
        invoiceList.push(inv);
      }
      exportAllToExcel(invoiceList, period);
      setAllExportMsg(`✓ Exported ${invoiceList.length} customers to Invoice_ALL_${period}.xlsx`);
    } catch {
      setAllExportMsg("Export failed. Please try again.");
    } finally {
      setAllExporting(false);
    }
  }

  // ── save invoice (single or multi) ──
  async function saveInvoice(status: "draft" | "final") {
    if (!editing) return;
    if (editGroup.length > 1) { await saveAllMulti(status); return; }
    setSaving(true);
    setSaveError("");
    // Persist current orderEdits to map before saving
    setOrderEditsMap(prev => ({ ...prev, [editing.customer]: orderEdits }));
    try {
      const payload: BillingInvoice = {
        ...editing,
        subtotals: calcSubtotals(editing.lineItems),
        total: calcTotal(editing.lineItems),
        status,
        updatedAt: new Date().toISOString(),
      };
      const res = await fetch("/api/billing/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      await loadList();
      setEditing(null); setEditGroup([]); setActiveIdx(0);
    } catch (e) {
      setSaveError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  // ── delete invoice ──
  async function deleteInvoice(id: string) {
    if (!confirm("Delete this invoice?")) return;
    await fetch(`/api/billing/invoices?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadList();
  }

  // ── delete group (all invoices in the combined group) ──
  async function deleteGroup(ginvs: BillingInvoice[]) {
    if (!confirm(`Delete all ${ginvs.length} invoices in this group?`)) return;
    await Promise.all(
      ginvs.map((inv) =>
        fetch(`/api/billing/invoices?id=${encodeURIComponent(inv.id)}`, { method: "DELETE" })
      )
    );
    await loadList();
  }

  function toggleCollapse(cat: BillingCategory) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  // ── Derived ──
  const currentTotal = editing ? calcTotal(editing.lineItems) : 0;
  const isMultiMode = editGroup.length > 1;
  const years = [2024, 2025, 2026, 2027].map(String);

  // Group invoices for list view: grouped by groupId, singles stay as-is
  type InvoiceListItem =
    | { type: "single"; invoice: BillingInvoice }
    | { type: "group"; groupId: string; invoices: BillingInvoice[] };

  const invoiceListItems = useMemo<InvoiceListItem[]>(() => {
    const groups = new Map<string, BillingInvoice[]>();
    const singles: BillingInvoice[] = [];
    for (const inv of invoices) {
      if (inv.groupId) {
        const g = groups.get(inv.groupId) ?? [];
        g.push(inv);
        groups.set(inv.groupId, g);
      } else {
        singles.push(inv);
      }
    }
    const result: InvoiceListItem[] = [];
    // Merge singles and groups, sorted by latest updatedAt
    for (const inv of singles) result.push({ type: "single", invoice: inv });
    groups.forEach((invs, groupId) => result.push({ type: "group", groupId, invoices: invs }));
    result.sort((a, b) => {
      const aDate = a.type === "single" ? a.invoice.updatedAt : a.invoices[0].updatedAt;
      const bDate = b.type === "single" ? b.invoice.updatedAt : b.invoices[0].updatedAt;
      return bDate.localeCompare(aDate);
    });
    return result;
  }, [invoices]);

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  // ─── Export Preview Modal (shared between editor + list view) ───────────────
  const exportPreviewModal = exportPreview && (() => {
    const subleaseRent = (parseFloat(subleaseRentQty) || 0) * SUBLEASE_RENT_RATE;
    const subleaseOp   = (parseFloat(subleaseOpQty)   || 0) * SUBLEASE_OP_RATE;
    const subleaseAmt  = subleaseRent + subleaseOp;

    let previewInvoices: BillingInvoice[] = [];
    let previewOmSubsidy = 0;
    let previewSublease  = 0;
    let previewPeriod    = "";

    if (exportPreview.mode === "single") {
      previewInvoices  = [exportPreview.invoice];
      previewPeriod    = exportPreview.invoice.period;
    } else if (exportPreview.mode === "multi") {
      previewInvoices  = exportPreview.invoices;
      previewOmSubsidy = exportPreview.omSubsidy;
      previewSublease  = exportPreview.subleaseTotal;
      previewPeriod    = exportPreview.period;
    } else {
      previewInvoices  = exportPreview.invoices;
      previewSublease  = subleaseAmt;
      previewPeriod    = exportPreview.period;
    }

    const invTotal   = previewInvoices.reduce((s, inv) => s + inv.total, 0);
    const grandTotal = invTotal + previewOmSubsidy + previewSublease;
    const fmt = formatUSD;
    const isMulti = previewInvoices.length > 1;

    function doExport() {
      if (exportPreview!.mode === "single") {
        exportInvoiceToExcel(exportPreview!.invoice as BillingInvoice).catch(console.error);
      } else if (exportPreview!.mode === "multi") {
        const ep = exportPreview as Extract<typeof exportPreview, { mode: "multi" }>;
        exportAllToExcel(ep.invoices, ep.period, wmsSourceMap, { [editing?.customer ?? ""]: orderEdits }, storageRows, ep.omSubsidy, ep.subleaseTotal).catch(console.error);
      } else {
        const ep = exportPreview as Extract<typeof exportPreview, { mode: "list" }>;
        exportAllToExcel(ep.invoices, ep.period, null, null, undefined, undefined, subleaseAmt).catch(console.error);
      }
      setExportPreview(null);
    }

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900">Export Summary</h2>
              <p className="text-xs text-slate-400 mt-0.5">{periodLabel(previewPeriod)}{isMulti ? ` · ${previewInvoices.length} customers` : ""}</p>
            </div>
            <button onClick={() => setExportPreview(null)} className="text-slate-400 hover:text-slate-700 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
            {previewInvoices.map((inv) => (
              <div key={inv.id} className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-2.5 flex items-center justify-between border-b border-slate-200">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{inv.customerName || inv.customer}</p>
                    {isMulti && <p className="text-xs text-slate-400 font-mono">{inv.customer}</p>}
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${inv.status === "final" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                    {inv.status === "final" ? "Final" : "Draft"}
                  </span>
                </div>
                <div className="divide-y divide-slate-50">
                  {BILLING_CATEGORIES.map((cat) => {
                    const amt = inv.subtotals?.[cat] ?? 0;
                    if (amt === 0) return null;
                    return (
                      <div key={cat} className="flex items-center justify-between px-4 py-2">
                        <span className="text-xs text-slate-500">{cat}</span>
                        <span className="text-xs font-semibold text-slate-800 tabular-nums">{fmt(amt)}</span>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50">
                    <span className="text-xs font-bold text-slate-700">Customer Total</span>
                    <span className="text-sm font-bold text-slate-900 tabular-nums">{fmt(inv.total)}</span>
                  </div>
                </div>
              </div>
            ))}
            {previewOmSubsidy > 0 && (
              <div className="flex items-center justify-between px-4 py-2.5 rounded-xl border border-purple-200 bg-purple-50">
                <span className="text-sm font-medium text-purple-800">OM Subsidy — STL Allocation</span>
                <span className="text-sm font-bold text-purple-900 tabular-nums">{fmt(previewOmSubsidy)}</span>
              </div>
            )}
            {previewSublease > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-amber-100">
                  <span className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5" />Office Sublease
                  </span>
                  <span className="text-sm font-bold text-amber-900 tabular-nums">{fmt(previewSublease)}</span>
                </div>
                <div className="px-4 py-2 space-y-1">
                  <div className="flex justify-between text-xs text-amber-700">
                    <span>Monthly Rent (§3.2) — {fmt(SUBLEASE_RENT_RATE)} × {parseFloat(subleaseRentQty)||0} mo</span>
                    <span className="tabular-nums">{fmt(subleaseRent)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-amber-700">
                    <span>Operating Cost (§3.3) — {fmt(SUBLEASE_OP_RATE)} × {parseFloat(subleaseOpQty)||0} sq ft</span>
                    <span className="tabular-nums">{fmt(subleaseOp)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="border-t border-slate-100 px-6 py-4 bg-slate-50">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold text-slate-600">Grand Total</span>
              <span className="text-2xl font-bold text-slate-900 tabular-nums">{fmt(grandTotal)}</span>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setExportPreview(null)}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-white transition-colors">
                Cancel
              </button>
              <button onClick={doExport}
                className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm">
                <Download className="w-4 h-4" />
                Download Excel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  })();

  if (editing) {
    return (
      <div className="pt-8 pb-8 px-8 w-full">
        {exportPreviewModal}
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => { setEditing(null); setEditGroup([]); setActiveIdx(0); }}
            className="text-slate-400 hover:text-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-900">
              {isMultiMode
                ? `Combined Invoice — ${periodLabel(editing.period)} (${editGroup.length} customers)`
                : `${editing.customerName || editing.customer} — ${periodLabel(editing.period)}`}
            </h1>
            <p className="text-slate-400 text-xs mt-0.5">Rate ver. {editing.rateVersion}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Auto-fetch */}
            <button
              onClick={autoFetch}
              disabled={fetching || !editing.customer}
              className="flex items-center gap-1.5 text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              <CloudDownload className={`w-4 h-4 ${fetching ? "animate-pulse" : ""}`} />
              {fetching ? "Fetching…" : "Load WMS Data"}
            </button>
            {/* Export — opens preview modal first */}
            <button
              onClick={() => {
                const group = getCurrentGroup();
                if (isMultiMode) {
                  setExportPreview({
                    mode: "multi",
                    invoices: group,
                    period: editing.period,
                    omSubsidy: calcStlAlloc(omWages, omAllocPct),
                    subleaseTotal: (parseFloat(subleaseRentQty)||0)*SUBLEASE_RENT_RATE + (parseFloat(subleaseOpQty)||0)*SUBLEASE_OP_RATE,
                  });
                } else {
                  setExportPreview({ mode: "single", invoice: { ...editing, total: currentTotal } });
                }
              }}
              className="flex items-center gap-1.5 text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Download className="w-4 h-4" />
              {isMultiMode ? "Export Combined" : "Export Excel"}
            </button>
            {/* Save draft */}
            <button
              onClick={() => saveInvoice("draft")}
              disabled={saving}
              className="flex items-center gap-1.5 text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
              {isMultiMode ? "Save All" : "Save Draft"}
            </button>
            {/* Finalize */}
            <button
              onClick={() => saveInvoice("final")}
              disabled={saving}
              className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg px-3 py-2 font-medium transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              {isMultiMode ? "Finalize All" : "Finalize"}
            </button>
          </div>
        </div>

        {/* ── Tabs: Customer tabs (multi-mode) + Rate Table + OM Subsidy ── */}
        <div className="flex gap-0 border-b border-slate-200 mb-5 -mx-8 px-8">
          {/* Customer tabs — only in multi-mode */}
          {isMultiMode && editGroup.map((inv, i) => (
            <button
              key={inv.customer}
              onClick={() => switchTab(i)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                extraTab === "none" && i === activeIdx
                  ? "border-blue-600 text-blue-700 bg-blue-50/60"
                  : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              }`}
            >
              {inv.customerName || inv.customer}
              {inv.total > 0 && (
                <span className={`ml-2 text-xs font-semibold ${extraTab === "none" && i === activeIdx ? "text-blue-500" : "text-slate-400"}`}>
                  {formatUSD(inv.total)}
                </span>
              )}
            </button>
          ))}

          {/* Divider */}
          {isMultiMode && <div className="flex-1" />}

          {/* Rate Table tab */}
          <button
            onClick={() => setExtraTab(extraTab === "rate-table" ? "none" : "rate-table")}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              extraTab === "rate-table"
                ? "border-slate-700 text-slate-900 bg-slate-50"
                : "border-transparent text-slate-400 hover:text-slate-700 hover:bg-slate-50"
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Rate Table
          </button>

          {/* OM Subsidy tab */}
          <button
            onClick={() => setExtraTab(extraTab === "om-subsidy" ? "none" : "om-subsidy")}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              extraTab === "om-subsidy"
                ? "border-purple-600 text-purple-700 bg-purple-50/60"
                : "border-transparent text-slate-400 hover:text-slate-700 hover:bg-slate-50"
            }`}
          >
            <Calculator className="w-3.5 h-3.5" />
            OM Subsidy
          </button>

          {/* Office Sublease tab */}
          <button
            onClick={() => setExtraTab(extraTab === "sublease" ? "none" : "sublease")}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              extraTab === "sublease"
                ? "border-amber-600 text-amber-700 bg-amber-50/60"
                : "border-transparent text-slate-400 hover:text-slate-700 hover:bg-slate-50"
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            Office Sublease
          </button>
        </div>

        {/* ── Rate Table panel ── */}
        {extraTab === "rate-table" && (
          <div className="space-y-6 pb-8">
            {(
              [
                { label: "1. Inbound Handling", rows: [
                  ["Standard Inbound — Carton", "$2.00", "per carton"],
                  ["Standard Inbound — Pallet (LTL/LCL)", "$8.00", "per pallet"],
                  ["20' Container (Palletized)", "$150.00", "per container"],
                  ["40' Container (Palletized)", "$250.00", "per container"],
                  ["40' HC Container (Palletized)", "$300.00", "per container"],
                  ["20' Container (Floor Loaded)", "$350.00", "per container"],
                  ["40' Container (Floor Loaded)", "$450.00", "per container"],
                  ["40' HC Container (Floor Loaded)", "$500.00", "per container"],
                  ["Additional Labor (QC / Counting)", "$35.00", "per person/hr"],
                ]},
                { label: "2. Storage (avg of 15th & last day)", rows: [
                  ["Bin (8\"×30\"×12\" / 1.7 cuft)", "$0.52", "per bin/month"],
                  ["Shelf (12.75\"×42\"×22\" / 6.8 cuft)", "$2.10", "per shelf/month"],
                  ["Carton (16\"×42\"×25.5\" / 9.9 cuft)", "$3.05", "per carton/month"],
                  ["Pallet Short (48\"×40\"×35.5\" / 39.4 cuft)", "$12.15", "per pallet/month"],
                  ["Pallet Regular (48\"×40\"×73\" / 81.1 cuft)", "$25.00", "per pallet/month"],
                  ["Pallet Tall (48\"×40\"×97\" / 107.8 cuft)", "$33.23", "per pallet/month"],
                  ["Open Floor", "$50.00", "per spot/month"],
                ]},
                { label: "3. Fulfillment — B2B", rows: [
                  ["B2B Order Processing", "$4.00", "per order"],
                  ["B2B Picking (Piece)", "$0.25", "per piece"],
                  ["B2B Picking (Full Carton)", "$1.25", "per carton"],
                  ["B2B Picking (Full Pallet)", "$6.50", "per pallet"],
                  ["B2B Carton Packing", "$1.25", "per carton/bag"],
                  ["B2B Palletizing w/ Stretch Wrap", "$12.00", "per pallet"],
                ]},
                { label: "4. Fulfillment — B2C", rows: [
                  ["B2C Order Processing (up to 5 picks)", "$2.00", "per order"],
                  ["B2C Picking (after 5th pick)", "$0.20", "per pick"],
                  ["B2C Fragile Pack", "$0.25", "per item"],
                  ["Order Inserts (BOL, packing list…)", "$0.10", "per insert"],
                  ["Label", "$0.20", "per label / shipping unit"],
                ]},
                { label: "5. Return Management", rows: [
                  ["Return Receiving (incl. Inspection)", "$1.50", "per order"],
                  ["Return Restock", "$0.25", "per piece"],
                  ["Disposal", "Cost + 10%", ""],
                ]},
                { label: "6. Warehouse Labor", rows: [
                  ["Regular Time (General Labor)", "$35.00", "per person/hr"],
                  ["Weekday After-Hours (1.5× OT)", "$52.50", "per person/hr"],
                  ["Weekend / Holiday (2× OT)", "$70.00", "per person/hr"],
                ]},
              ] as { label: string; rows: string[][] }[]
            ).map(({ label, rows }) => (
              <div key={label} className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="bg-slate-800 text-white text-sm font-semibold px-4 py-2.5">{label}</div>
                <table className="w-full text-sm">
                  <tbody>
                    {rows.map(([desc, rate, unit]) => (
                      <tr key={desc} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-slate-700 w-full">{desc}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">{rate}</td>
                        <td className="px-4 py-2.5 text-slate-400 text-xs whitespace-nowrap text-right">{unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <p className="text-xs text-slate-400 text-right">Rate version: {RATE_VERSION}</p>
          </div>
        )}

        {/* ── OM Subsidy panel ── */}
        {extraTab === "om-subsidy" && (() => {
          const S = OM_SUBSIDY;
          const wages = parseFloat(omWages) || 0;
          // FICA
          const ficaRate = S.employerTaxRate;
          const fica = wages * ficaRate;
          // Workers Comp
          const wcExpected = S.wcWarehouseExp * S.wcRate + S.wcOfficeExp * S.wcOfficeRate + S.wcSalesExp * S.wcSalesRate;
          const wcDiscount = 1 - S.wcActualPremium / wcExpected;
          const wcNetRate = S.wcRate * (1 - wcDiscount);
          const wc = wages * wcNetRate;
          // GL Insurance
          const glRate = S.glAnnualPremium / S.glRevenueBase;
          const gl = wages * glRate;
          // Dental + Medical (fixed, no pct of wages)
          const dental = S.dental;
          const medical = S.medical;
          // Total overhead (monthly)
          const totalOverhead = fica + wc + gl + dental + medical;
          // STL allocation — user-editable
          const allocPct = Math.max(0, Math.min(100, parseFloat(omAllocPct) || 0));
          const stlAlloc = totalOverhead * (allocPct / 100);

          const fmt = (v: number) => wages > 0 ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
          const fmtPct = (r: number) => `${(r * 100).toFixed(4).replace(/\.?0+$/, "")}%`;

          return (
            <div className="space-y-6 pb-8 max-w-2xl">
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="bg-purple-700 text-white text-sm font-semibold px-4 py-2.5">OM Subsidy Calculator</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-400 uppercase tracking-wide">
                      <th className="px-4 py-2 text-left font-medium">Description</th>
                      <th className="px-4 py-2 text-right font-medium">Rate</th>
                      <th className="px-4 py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Wages input */}
                    <tr className="border-b border-slate-200 bg-yellow-50">
                      <td className="px-4 py-3 font-semibold text-slate-800" colSpan={2}>Total Taxable Wages (monthly)</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-slate-500 text-sm">$</span>
                          <input
                            type="number"
                            step="0.01"
                            value={omWages}
                            onChange={e => setOmWages(e.target.value)}
                            placeholder="0.00"
                            className="w-36 text-right border border-yellow-300 bg-yellow-50 focus:bg-white focus:border-blue-400 rounded px-2 py-1 text-sm font-mono outline-none"
                          />
                        </div>
                      </td>
                    </tr>
                    {/* FICA */}
                    <tr className="border-b border-slate-100">
                      <td className="px-4 py-2.5 text-slate-700">Employer FICA</td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-500 text-xs">{fmtPct(ficaRate)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-800">{fmt(fica)}</td>
                    </tr>
                    {/* WC */}
                    <tr className="border-b border-slate-100">
                      <td className="px-4 py-2.5 text-slate-700">Workers&apos; Comp (net after discount)</td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-500 text-xs">{fmtPct(wcNetRate)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-800">{fmt(wc)}</td>
                    </tr>
                    {/* GL */}
                    <tr className="border-b border-slate-100">
                      <td className="px-4 py-2.5 text-slate-700">GL Insurance</td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-500 text-xs">{fmtPct(glRate)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-800">{fmt(gl)}</td>
                    </tr>
                    {/* Dental */}
                    <tr className="border-b border-slate-100">
                      <td className="px-4 py-2.5 text-slate-700">Dental (fixed)</td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-400 text-xs">fixed</td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-800">{`$${dental.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}</td>
                    </tr>
                    {/* Medical */}
                    <tr className="border-b border-slate-200">
                      <td className="px-4 py-2.5 text-slate-700">Medical (fixed)</td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-400 text-xs">fixed</td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-800">{`$${medical.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}</td>
                    </tr>
                    {/* Total Overhead */}
                    <tr className="border-b border-slate-200 bg-slate-100">
                      <td className="px-4 py-2.5 font-semibold text-slate-800" colSpan={2}>Total Overhead</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-900">
                        {wages > 0 ? `$${totalOverhead.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                      </td>
                    </tr>
                    {/* STL Allocation — editable % */}
                    <tr className="bg-purple-50">
                      <td className="px-4 py-3 font-bold text-purple-900">× STL Allocation</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="number"
                            step="1"
                            min="0"
                            max="100"
                            value={omAllocPct}
                            onChange={e => setOmAllocPct(e.target.value)}
                            className="w-16 text-right border border-purple-300 bg-purple-50 focus:bg-white focus:border-purple-500 rounded px-2 py-1 text-sm font-mono outline-none text-purple-800 font-semibold"
                          />
                          <span className="text-purple-700 font-semibold text-sm">%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-purple-900 text-base">
                        {wages > 0 ? `$${stlAlloc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Reference rates */}
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="bg-slate-700 text-white text-sm font-semibold px-4 py-2.5">Reference Rates</div>
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b border-slate-100">
                      <td className="px-4 py-2 text-slate-500">WC Warehouse Rate</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-700">{(S.wcRate * 100).toFixed(2)}%</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="px-4 py-2 text-slate-500">WC Discount (company-wide)</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-700">{(wcDiscount * 100).toFixed(2)}%</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="px-4 py-2 text-slate-500">WC Net Rate (after discount)</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-700">{(wcNetRate * 100).toFixed(4)}%</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="px-4 py-2 text-slate-500">GL Insurance Rate (annual premium / revenue)</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-700">{(glRate * 100).toFixed(4)}%</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-slate-500">STL Allocation</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-700">{allocPct.toFixed(0)}%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* ── Office Sublease panel ── */}
        {extraTab === "sublease" && (() => {
          const rentQty = Math.max(0, parseFloat(subleaseRentQty) || 0);
          const opQty   = Math.max(0, parseFloat(subleaseOpQty)   || 0);
          const rentAmt = rentQty * SUBLEASE_RENT_RATE;
          const opAmt   = opQty   * SUBLEASE_OP_RATE;
          const total   = rentAmt + opAmt;
          const fmt = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
          return (
            <div className="space-y-4 pb-8 max-w-2xl">
              <div className="rounded-xl border border-amber-200 overflow-hidden">
                <div className="bg-amber-600 text-white text-sm font-semibold px-4 py-2.5 flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  Office Sublease — Monthly Fixed Charges
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-400 uppercase tracking-wide">
                      <th className="px-4 py-2 text-left font-medium">Description</th>
                      <th className="px-4 py-2 text-right font-medium">Rate</th>
                      <th className="px-4 py-2 text-right font-medium">Qty</th>
                      <th className="px-4 py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Rent */}
                    <tr className="border-b border-slate-100">
                      <td className="px-4 py-3 text-slate-700">
                        Monthly Office Rent
                        <span className="ml-2 text-xs text-slate-400">(per MSA Section 3.2)</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-teal-700">{fmt(SUBLEASE_RENT_RATE)} / mo</td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={subleaseRentQty}
                          onChange={e => setSubleaseRentQty(e.target.value)}
                          className="w-20 text-right border border-amber-200 bg-amber-50 focus:bg-white focus:border-amber-400 rounded px-2 py-1 text-sm font-mono outline-none"
                        />
                        <span className="ml-1.5 text-xs text-slate-400">months</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-800">{fmt(rentAmt)}</td>
                    </tr>
                    {/* Operating Cost */}
                    <tr className="border-b border-slate-200">
                      <td className="px-4 py-3 text-slate-700">
                        Operating Cost Reimbursement
                        <span className="ml-2 text-xs text-slate-400">(per MSA Section 3.3)</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-teal-700">{fmt(SUBLEASE_OP_RATE)} / sq ft</td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={subleaseOpQty}
                          onChange={e => setSubleaseOpQty(e.target.value)}
                          className="w-20 text-right border border-amber-200 bg-amber-50 focus:bg-white focus:border-amber-400 rounded px-2 py-1 text-sm font-mono outline-none"
                        />
                        <span className="ml-1.5 text-xs text-slate-400">sq ft</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-800">{fmt(opAmt)}</td>
                    </tr>
                    {/* Subtotal */}
                    <tr className="bg-amber-50">
                      <td colSpan={3} className="px-4 py-3 font-bold text-amber-900 text-right">Subtotal — Office Sublease</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-amber-900 text-base">{fmt(total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-400 px-1">
                These charges are fixed monthly contract amounts billed separately from customer WMS fees and added to the combined grand total.
              </p>
            </div>
          );
        })()}

        {/* ── Invoice content (hidden when extra tab is active) ── */}
        {extraTab === "none" && <>

        {/* Fetch message */}
        {fetchMsg && (
          <div className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm mb-5 border ${
            fetchMsg.startsWith("✓")
              ? "bg-green-50 border-green-200 text-green-800"
              : "bg-amber-50 border-amber-200 text-amber-800"
          }`}>
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {fetchMsg}
          </div>
        )}
        {saveError && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-5">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {saveError}
          </div>
        )}

        {/* ── WMS Source Data panel ── full-bleed, breaks out of px-8 padding */}
        {wmsSource && (
          <div className="mb-5 -mx-8 bg-white border-x-0 border border-slate-200 shadow-sm overflow-hidden">
            {/* Header / toggle */}
            <button
              onClick={() => setShowSource((s) => !s)}
              className="w-full flex items-center justify-between px-8 py-3 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-3 text-sm font-medium text-slate-700">
                <Table2 className="w-4 h-4 text-slate-400" />
                WMS Source Data
                <span className="flex gap-1.5 flex-wrap">
                  {wmsSource.receiving.length > 0 && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                      Inbound {wmsSource.receiving.length}
                    </span>
                  )}
                  {wmsSource.b2b.length > 0 && (
                    <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                      B2B {wmsSource.b2b.length}
                    </span>
                  )}
                  {wmsSource.b2c.length > 0 && (
                    <span className="text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-medium">
                      B2C {wmsSource.b2c.length}
                    </span>
                  )}
                  {wmsSource.returns.length > 0 && (
                    <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
                      Returns {wmsSource.returns.length}
                    </span>
                  )}
                </span>
              </div>
              {showSource
                ? <ChevronUp className="w-4 h-4 text-slate-400" />
                : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </button>

            {showSource && (
              <div className="border-t border-slate-100">
                {/* Sub-tabs */}
                <div className="flex border-b border-slate-100 px-8">
                  {(
                    [
                      { key: "receiving", label: "Inbound",      count: wmsSource.receiving.length, active: "text-blue-600 border-blue-600" },
                      { key: "b2b",       label: "B2B Shipping", count: wmsSource.b2b.length,       active: "text-emerald-600 border-emerald-600" },
                      { key: "b2c",       label: "B2C Shipping", count: wmsSource.b2c.length,       active: "text-teal-600 border-teal-600" },
                      { key: "returns",   label: "Returns",      count: wmsSource.returns.length,    active: "text-orange-600 border-orange-600" },
                    ] as const
                  ).map(({ key, label, count, active }) => (
                    <button
                      key={key}
                      onClick={() => setSourceTab(key)}
                      className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px ${
                        sourceTab === key
                          ? `${active} border-current`
                          : "border-transparent text-slate-400 hover:text-slate-600"
                      }`}
                    >
                      {label} ({count})
                    </button>
                  ))}
                  <button
                    onClick={() => setSourceTab("storage")}
                    className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px ${
                      sourceTab === "storage"
                        ? "text-purple-600 border-purple-600 border-current"
                        : "border-transparent text-slate-400 hover:text-slate-600"
                    }`}
                  >
                    Storage ({storageRows.length})
                  </button>
                </div>

                {/* Table area */}
                <div className="overflow-y-auto" style={{ maxHeight: "32rem" }}>
                  {/* ── Inbound ── */}
                  {sourceTab === "receiving" && (
                    wmsSource.receiving.length === 0 ? (
                      <p className="text-center text-sm text-slate-400 py-8">No inbound orders this period</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 sticky top-0 z-10">
                          <tr>
                            <th className="px-3 py-2 text-left text-slate-500 font-semibold">Order Code</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-semibold">PO / Ref</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-semibold">In Date</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-semibold">Status</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-semibold">Type</th>
                            <th className="px-3 py-2 text-right text-slate-500 font-semibold">Item Qty</th>
                            <th className="px-3 py-2 text-right text-slate-500 font-semibold">Carton Field</th>
                            <th className="px-3 py-2 text-right text-slate-500 font-semibold">Carton Value</th>
                            <th className="px-3 py-2 text-right text-slate-500 font-semibold text-blue-600">Counted</th>
                          </tr>
                        </thead>
                        <tbody>
                          {wmsSource.receiving.map((o, i) => {
                            const type = String(o.inboundType ?? o.receiveType ?? "");
                            const isContainer = /container|cont/i.test(type);
                            const itemQty = Number(o.totalQty ?? o.itemCount ?? 0);
                            // Determine which field provides the carton count
                            const cartonFieldName =
                              o.cartonQty != null ? "cartonQty" :
                              o.boxQty != null ? "boxQty" :
                              o.packageQty != null ? "packageQty" :
                              o.cartonCount != null ? "cartonCount" :
                              "default";
                            const cartonFieldVal =
                              o.cartonQty ?? o.boxQty ?? o.packageQty ?? o.cartonCount;
                            const counted = isContainer ? 0 : (cartonFieldVal != null ? Number(cartonFieldVal) : 1);
                            const isDefault = cartonFieldName === "default";
                            const inDateVal = String(o.inDate ?? o.receiveDate ?? o.orderDate ?? "");
                            const missingDate = !inDateVal || inDateVal.length < 6;
                            return (
                              <tr key={i} className={`border-b border-slate-50 ${missingDate ? "bg-yellow-50" : isContainer ? "bg-red-50/40" : "hover:bg-slate-50"}`}>
                                <td className="px-3 py-1.5 font-mono text-blue-600 whitespace-nowrap">{String(o.receiveOrderCode ?? o.orderCode ?? "—")}</td>
                                <td className="px-3 py-1.5 text-slate-400 font-mono text-[10px]">{String(o.poNo ?? o.poNumber ?? o.referenceNo ?? "—")}</td>
                                <td className={`px-3 py-1.5 whitespace-nowrap font-semibold ${missingDate ? "text-yellow-600" : "text-slate-500"}`}>
                                  {missingDate ? "⚠ No date" : inDateVal}
                                </td>
                                <td className="px-3 py-1.5">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                    String(o.status ?? o.orderStatus ?? "") === "DA"
                                      ? "bg-green-100 text-green-700"
                                      : "bg-slate-100 text-slate-500"
                                  }`}>{String(o.status ?? o.orderStatus ?? "—")}</span>
                                </td>
                                <td className="px-3 py-1.5 text-slate-500">
                                  {type || "—"}
                                  {isContainer && <span className="ml-1 text-[10px] text-red-500 font-medium">(excl.)</span>}
                                </td>
                                <td className="px-3 py-1.5 text-right text-slate-500">{itemQty > 0 ? itemQty.toLocaleString() : "—"}</td>
                                <td className="px-3 py-1.5 text-right">
                                  {isContainer ? (
                                    <span className="text-slate-300">—</span>
                                  ) : (
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                                      isDefault ? "bg-amber-50 text-amber-600" : "bg-blue-50 text-blue-600"
                                    }`}>{cartonFieldName}</span>
                                  )}
                                </td>
                                <td className="px-3 py-1.5 text-right text-slate-500">
                                  {isContainer ? "—" : (cartonFieldVal != null ? Number(cartonFieldVal).toLocaleString() : <span className="text-amber-500">1 (default)</span>)}
                                </td>
                                <td className={`px-3 py-1.5 text-right font-bold ${isContainer ? "text-slate-300" : "text-blue-600"}`}>
                                  {isContainer ? "—" : counted.toLocaleString()}
                                </td>
                              </tr>
                            );
                          })}
                          <tr className="bg-blue-50 border-t-2 border-blue-200 font-bold text-blue-700 sticky bottom-0">
                            <td colSpan={8} className="px-3 py-2 text-right pr-4">Total Cartons (non-container)</td>
                            <td className="px-3 py-2 text-right text-blue-700">
                              {wmsSource.receiving
                                .filter((o) => !/container|cont/i.test(String(o.inboundType ?? o.receiveType ?? "")))
                                .reduce((s, o) => {
                                  const v = o.cartonQty ?? o.boxQty ?? o.packageQty ?? o.cartonCount;
                                  return s + (v != null ? Number(v) : 1);
                                }, 0)
                                .toLocaleString()}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    )
                  )}

                  {/* ── B2B ── */}
                  {sourceTab === "b2b" && (
                    wmsSource.b2b.length === 0 ? (
                      <p className="text-center text-sm text-slate-400 py-8">No B2B orders this period</p>
                    ) : (
                      <div className="overflow-x-scroll">
                        {/* Warning banner */}
                        {(wmsSource.b2bWarnings?.length ?? 0) > 0 && (
                          <div className="flex items-start gap-2 bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-xs text-amber-700">
                            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                            <span>
                              <b>{wmsSource.b2bWarnings!.length} order(s)</b> have Picking per Piece but no Out per Carton/Pallet info — check comments:{" "}
                              <span className="font-mono">{wmsSource.b2bWarnings!.join(", ")}</span>
                            </span>
                          </div>
                        )}
                        <table className="w-full text-xs min-w-max">
                          <thead className="bg-slate-50 sticky top-0">
                            <tr>
                              <th className="px-3 py-2 text-left text-slate-500 font-semibold">Order Code</th>
                              <th className="px-3 py-2 text-left text-slate-500 font-semibold">Date</th>
                              <th className="px-3 py-2 text-right text-slate-500 font-semibold">Pick/Piece</th>
                              <th className="px-3 py-2 text-right text-slate-500 font-semibold">Pick/Carton</th>
                              <th className="px-3 py-2 text-right text-slate-500 font-semibold">Pick/Pallet</th>
                              <th className="px-3 py-2 text-right text-slate-500 font-semibold">Out/Carton</th>
                              <th className="px-3 py-2 text-right text-slate-500 font-semibold">Out/Pallet</th>
                              <th className="px-3 py-2 text-right text-slate-500 font-semibold">Supplies</th>
                              <th className="px-3 py-2 text-right text-slate-500 font-semibold">Packing✓</th>
                              <th className="px-3 py-2 text-right text-slate-500 font-semibold">Palletize✓</th>
                              <th className="px-3 py-2 text-right text-violet-500 font-semibold">Labels</th>
                              <th className="px-3 py-2 text-right text-violet-500 font-semibold">Inserts</th>
                              <th className="px-3 py-2 text-right text-orange-500 font-semibold">Labor Hrs</th>
                              <th className="px-3 py-2 text-right text-orange-500 font-semibold">Labor OT</th>
                              <th className="px-3 py-2 text-right text-orange-500 font-semibold">Labor Wknd</th>
                            </tr>
                          </thead>
                          <tbody>
                            {wmsSource.b2b.map((o, i) => {
                              const code     = String(o.shippingOrderCode ?? o.orderCode ?? i);
                              const tasks    = parseTaskComment(String(o.comment ?? ""));
                              const ov       = orderEdits[code] ?? {};
                              // parsed defaults
                              const pp0      = tasks["Picking per Piece"]  ?? 0;
                              const pc0      = tasks["Picking per Carton"] ?? 0;
                              const ppl0     = tasks["Picking per Pallet"] ?? 0;
                              const oc0      = tasks["Out per Carton"]     ?? 0;
                              const op0      = tasks["Out per Pallet"]     ?? 0;
                              const supplies0= tasks["Supplies"]           ?? 0;
                              const labels0  = (tasks["Labels"] ?? 0) + (tasks["Amazon Labels"] ?? 0) + (tasks["FBA Labeling"] ?? 0);
                              const inserts0 = tasks["Inserts"] ?? 0;
                              const lh0      = tasks["Labor Hours"]              ?? 0;
                              const lhOT0    = tasks["Labor Hours (OT)"]         ?? 0;
                              const lhWk0    = tasks["Labor Hours (Weekend/Holiday)"] ?? 0;
                              // effective raw values (user override or WMS parsed)
                              const oc_eff  = ov["out_carton"]      ?? oc0;
                              const op_eff  = ov["out_pallet"]      ?? op0;
                              const sup_eff = ov["supplies"]        ?? supplies0;
                              const pc_eff  = ov["b2b_pick_carton"] ?? pc0;
                              const ppl_eff = ov["b2b_pick_pallet"] ?? ppl0;
                              // packing: charge supplies qty only when out_carton differs from pick_carton (repacked)
                              const packingDefault   = (oc_eff > 0 && oc_eff !== pc_eff) ? sup_eff : 0;
                              // palletizing: out_pallet qty if > 0
                              const palletizeDefault = op_eff > 0 ? op_eff : 0;
                              // effective values (override or default)
                              const pp   = ov["b2b_pick_piece"]    ?? pp0;
                              const pc   = ov["b2b_pick_carton"]   ?? pc0;
                              const ppl  = ov["b2b_pick_pallet"]   ?? ppl0;
                              const pkg  = ov["b2b_carton_packing"]?? packingDefault;
                              const pal  = ov["b2b_palletizing"]   ?? palletizeDefault;
                              const lbl  = ov["b2b_label"]         ?? labels0;
                              const ins  = ov["b2b_insert"]        ?? inserts0;
                              const lh   = ov["labor_regular"]     ?? lh0;
                              const lhOT = ov["labor_ot_weekday"]  ?? lhOT0;
                              const lhWk = ov["labor_ot_weekend"]  ?? lhWk0;
                              const warn = pp0 > 0 && oc0 === 0 && op0 === 0 && supplies0 === 0 && !("b2b_carton_packing" in ov);
                              const outDateVal = String(o.outDate ?? o.deliveryDate ?? o.shippingDate ?? o.outboundDate ?? "");
                              const missingOutDate = !outDateVal || outDateVal.length < 6;
                              const inputCls = (color?: string, modified?: boolean) =>
                                `w-14 text-right text-xs font-semibold rounded px-1 py-0.5 border ${
                                  modified
                                    ? "border-yellow-400 bg-yellow-100 hover:bg-yellow-50 focus:border-yellow-500"
                                    : "border-slate-300 bg-slate-50 hover:bg-white"
                                } focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200 transition-colors placeholder:text-slate-300 ${color ?? "text-slate-800"}`;
                              const setOv = (key: string, val: string) => {
                                const num = val === "" ? undefined : Number(val);
                                setOrderEdits(prev => {
                                  const next = { ...prev, [code]: { ...(prev[code] ?? {}) } };
                                  if (num === undefined) delete next[code][key];
                                  else next[code][key] = num;
                                  // recalculate billing totals from all rows
                                  const colKeys = ["b2b_pick_piece","b2b_pick_carton","b2b_pick_pallet","b2b_carton_packing","b2b_palletizing","b2b_label","b2b_insert","labor_regular","labor_ot_weekday","labor_ot_weekend"];
                                  const totals: Record<string,number> = {};
                                  colKeys.forEach(k => { totals[k] = 0; });
                                  wmsSource.b2b.forEach((ord, idx) => {
                                    const ordCode = String(ord.shippingOrderCode ?? ord.orderCode ?? idx);
                                    const t = parseTaskComment(String(ord.comment ?? ""));
                                    const ordOv = next[ordCode] ?? {};
                                    const oc_ = ordOv["out_carton"]      ?? (t["Out per Carton"]     ?? 0);
                                    const op_ = ordOv["out_pallet"]      ?? (t["Out per Pallet"]     ?? 0);
                                    const sup_= ordOv["supplies"]        ?? (t["Supplies"]            ?? 0);
                                    const pc_ = ordOv["b2b_pick_carton"] ?? (t["Picking per Carton"]  ?? 0);
                                    const pkgDef = (oc_ > 0 && oc_ !== pc_) ? sup_ : 0;
                                    const palDef = op_ > 0 ? op_ : 0;
                                    const lblDef = (t["Labels"] ?? 0) + (t["Amazon Labels"] ?? 0) + (t["FBA Labeling"] ?? 0);
                                    totals["b2b_pick_piece"]    += ordOv["b2b_pick_piece"]    ?? (t["Picking per Piece"]  ?? 0);
                                    totals["b2b_pick_carton"]   += ordOv["b2b_pick_carton"]   ?? (t["Picking per Carton"] ?? 0);
                                    totals["b2b_pick_pallet"]   += ordOv["b2b_pick_pallet"]   ?? (t["Picking per Pallet"] ?? 0);
                                    totals["b2b_carton_packing"]+= ordOv["b2b_carton_packing"]?? pkgDef;
                                    totals["b2b_palletizing"]   += ordOv["b2b_palletizing"]   ?? palDef;
                                    totals["b2b_label"]         += ordOv["b2b_label"]         ?? lblDef;
                                    totals["b2b_insert"]        += ordOv["b2b_insert"]        ?? (t["Inserts"] ?? 0);
                                    totals["labor_regular"]     += ordOv["labor_regular"]     ?? (t["Labor Hours"] ?? 0);
                                    totals["labor_ot_weekday"]  += ordOv["labor_ot_weekday"]  ?? (t["Labor Hours (OT)"] ?? 0);
                                    totals["labor_ot_weekend"]  += ordOv["labor_ot_weekend"]  ?? (t["Labor Hours (Weekend/Holiday)"] ?? 0);
                                  });
                                  // push totals → billing line items
                                  setEditing(ep => {
                                    if (!ep) return ep;
                                    const items = ep.lineItems.map(item =>
                                      totals[item.id] !== undefined
                                        ? { ...item, qty: totals[item.id], autoFetched: false }
                                        : item
                                    );
                                    return { ...ep, lineItems: items, subtotals: calcSubtotals(items), total: calcTotal(items) };
                                  });
                                  return next;
                                });
                              };
                              return (
                                <tr key={i} className={`border-b border-slate-50 ${missingOutDate ? "bg-yellow-50" : warn ? "bg-amber-50" : ""}`}>
                                  <td className="px-3 py-1 font-mono text-emerald-600 text-xs">
                                    {code}
                                    {warn && <span className="ml-1 text-amber-500">⚠</span>}
                                  </td>
                                  <td className={`px-3 py-1 whitespace-nowrap font-semibold ${missingOutDate ? "text-yellow-600" : "text-slate-500"}`}>
                                    {missingOutDate ? "⚠ No date" : outDateVal}
                                  </td>
                                  <td className="px-1 py-1 text-right"><input type="number" min={0} value={pp || ""} placeholder="—" onChange={e => setOv("b2b_pick_piece", e.target.value)} className={inputCls(undefined, "b2b_pick_piece" in ov)} /></td>
                                  <td className="px-1 py-1 text-right"><input type="number" min={0} value={pc || ""} placeholder="—" onChange={e => setOv("b2b_pick_carton", e.target.value)} className={inputCls(undefined, "b2b_pick_carton" in ov)} /></td>
                                  <td className="px-1 py-1 text-right"><input type="number" min={0} value={ppl || ""} placeholder="—" onChange={e => setOv("b2b_pick_pallet", e.target.value)} className={inputCls(undefined, "b2b_pick_pallet" in ov)} /></td>
                                  <td className="px-1 py-1 text-right"><input type="number" min={0} value={(ov["out_carton"] ?? oc0) || ""} placeholder="—" onChange={e => setOv("out_carton", e.target.value)} className={inputCls("text-slate-600", "out_carton" in ov)} /></td>
                                  <td className="px-1 py-1 text-right"><input type="number" min={0} value={(ov["out_pallet"] ?? op0) || ""} placeholder="—" onChange={e => setOv("out_pallet", e.target.value)} className={inputCls("text-slate-600", "out_pallet" in ov)} /></td>
                                  <td className="px-1 py-1 text-right"><input type="number" min={0} value={(ov["supplies"] ?? supplies0) || ""} placeholder="—" onChange={e => setOv("supplies", e.target.value)} className={inputCls("text-blue-600", "supplies" in ov)} /></td>
                                  <td className="px-1 py-1 text-right"><input type="number" min={0} value={pkg || ""} placeholder="—" onChange={e => setOv("b2b_carton_packing", e.target.value)} className={inputCls("text-emerald-700", "b2b_carton_packing" in ov)} /></td>
                                  <td className="px-1 py-1 text-right"><input type="number" min={0} value={pal || ""} placeholder="—" onChange={e => setOv("b2b_palletizing", e.target.value)} className={inputCls("text-emerald-700", "b2b_palletizing" in ov)} /></td>
                                  <td className="px-1 py-1 text-right"><input type="number" min={0} value={lbl || ""} placeholder="—" onChange={e => setOv("b2b_label", e.target.value)} className={inputCls("text-violet-700", "b2b_label" in ov)} /></td>
                                  <td className="px-1 py-1 text-right"><input type="number" min={0} value={ins || ""} placeholder="—" onChange={e => setOv("b2b_insert", e.target.value)} className={inputCls("text-violet-700", "b2b_insert" in ov)} /></td>
                                  <td className="px-1 py-1 text-right"><input type="number" min={0} value={lh || ""} placeholder="—" onChange={e => setOv("labor_regular", e.target.value)} className={inputCls("text-orange-700", "labor_regular" in ov)} /></td>
                                  <td className="px-1 py-1 text-right"><input type="number" min={0} value={lhOT || ""} placeholder="—" onChange={e => setOv("labor_ot_weekday", e.target.value)} className={inputCls("text-orange-700", "labor_ot_weekday" in ov)} /></td>
                                  <td className="px-1 py-1 text-right"><input type="number" min={0} value={lhWk || ""} placeholder="—" onChange={e => setOv("labor_ot_weekend", e.target.value)} className={inputCls("text-orange-700", "labor_ot_weekend" in ov)} /></td>
                                </tr>
                              );
                            })}
                            {/* ── Auto-summed Total row ── */}
                            {(() => {
                              const sumCol = (key: string, defFn: (o: Record<string,unknown>, idx: number) => number) =>
                                wmsSource.b2b.reduce((s, o, idx) => {
                                  const code = String(o.shippingOrderCode ?? o.orderCode ?? idx);
                                  return s + (orderEdits[code]?.[key] ?? defFn(o as Record<string,unknown>, idx));
                                }, 0);
                              const totPP  = sumCol("b2b_pick_piece",    (o) => { const t=parseTaskComment(String(o.comment??"")); return t["Picking per Piece"]??0; });
                              const totPC  = sumCol("b2b_pick_carton",   (o) => { const t=parseTaskComment(String(o.comment??"")); return t["Picking per Carton"]??0; });
                              const totPPl = sumCol("b2b_pick_pallet",   (o) => { const t=parseTaskComment(String(o.comment??"")); return t["Picking per Pallet"]??0; });
                              const totOC  = sumCol("out_carton",  (o) => { const t=parseTaskComment(String(o.comment??"")); return t["Out per Carton"]??0; });
                              const totOP  = sumCol("out_pallet",  (o) => { const t=parseTaskComment(String(o.comment??"")); return t["Out per Pallet"]??0; });
                              const totSup = sumCol("supplies",    (o) => { const t=parseTaskComment(String(o.comment??"")); return t["Supplies"]??0; });
                              const totPkg = sumCol("b2b_carton_packing",(o, idx) => { const t=parseTaskComment(String(o.comment??"")); const code_=String((o as Record<string,unknown>).shippingOrderCode??(o as Record<string,unknown>).orderCode??idx); const ov_=orderEdits[code_]??{}; const oc_=ov_["out_carton"]??(t["Out per Carton"]??0); const pc_=ov_["b2b_pick_carton"]??(t["Picking per Carton"]??0); const sup_=ov_["supplies"]??(t["Supplies"]??0); return (oc_>0&&oc_!==pc_)?sup_:0; });
                              const totPal = sumCol("b2b_palletizing",   (o, idx) => { const t=parseTaskComment(String(o.comment??"")); const code_=String((o as Record<string,unknown>).shippingOrderCode??(o as Record<string,unknown>).orderCode??idx); const ov_=orderEdits[code_]??{}; const op_=ov_["out_pallet"]??(t["Out per Pallet"]??0); return op_>0?op_:0; });
                              const totLbl = sumCol("b2b_label",         (o) => { const t=parseTaskComment(String(o.comment??"")); return (t["Labels"]??0)+(t["Amazon Labels"]??0)+(t["FBA Labeling"]??0); });
                              const totIns = sumCol("b2b_insert",        (o) => { const t=parseTaskComment(String(o.comment??"")); return t["Inserts"]??0; });
                              const totLH  = sumCol("labor_regular",     (o) => { const t=parseTaskComment(String(o.comment??"")); return t["Labor Hours"]??0; });
                              const totOT  = sumCol("labor_ot_weekday",  (o) => { const t=parseTaskComment(String(o.comment??"")); return t["Labor Hours (OT)"]??0; });
                              const totWk  = sumCol("labor_ot_weekend",  (o) => { const t=parseTaskComment(String(o.comment??"")); return t["Labor Hours (Weekend/Holiday)"]??0; });
                              const tdTot = (v: number, color?: string) => (
                                <td className={`px-3 py-1.5 text-right font-bold text-xs ${color ?? "text-emerald-700"}`}>{v || "—"}</td>
                              );
                              return (
                                <tr className="bg-emerald-50 border-t-2 border-emerald-200">
                                  <td colSpan={2} className="px-3 py-1.5 text-emerald-700 text-xs font-bold">
                                    Total ({wmsSource.b2b.length} orders)
                                  </td>
                                  {tdTot(totPP)}
                                  {tdTot(totPC)}
                                  {tdTot(totPPl)}
                                  <td className="px-3 py-1.5 text-right text-xs text-slate-500 font-bold">{totOC || "—"}</td>
                                  <td className="px-3 py-1.5 text-right text-xs text-slate-500 font-bold">{totOP || "—"}</td>
                                  <td className="px-3 py-1.5 text-right text-xs text-blue-700 font-bold">{totSup || "—"}</td>
                                  {tdTot(totPkg)}
                                  {tdTot(totPal)}
                                  {tdTot(totLbl, "text-violet-700")}
                                  {tdTot(totIns, "text-violet-700")}
                                  {tdTot(totLH,  "text-orange-700")}
                                  {tdTot(totOT,  "text-orange-700")}
                                  {tdTot(totWk,  "text-orange-700")}
                                </tr>
                              );
                            })()}
                          </tbody>
                        </table>
                      </div>
                    )
                  )}

                  {/* ── B2C ── */}
                  {sourceTab === "b2c" && (
                    wmsSource.b2c.length === 0 ? (
                      <p className="text-center text-sm text-slate-400 py-8">No B2C orders this period</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left text-slate-500 font-semibold">Order Code</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-semibold">Date</th>
                            <th className="px-3 py-2 text-right text-slate-500 font-semibold">Total Qty</th>
                            <th className="px-3 py-2 text-right text-slate-500 font-semibold">+1 Order</th>
                            <th className="px-3 py-2 text-right text-slate-500 font-semibold">+Extra Picks</th>
                          </tr>
                        </thead>
                        <tbody>
                          {wmsSource.b2c.map((o, i) => {
                            const qty = Number(o.totalQty ?? o.orderQty ?? 0);
                            const extra = Math.max(0, qty - 5);
                            const b2cDateVal = String(o.outDate ?? o.deliveryDate ?? o.shippingDate ?? "");
                            const b2cMissingDate = !b2cDateVal || b2cDateVal.length < 6;
                            return (
                              <tr key={i} className={`border-b border-slate-50 ${b2cMissingDate ? "bg-yellow-50" : "hover:bg-slate-50"}`}>
                                <td className="px-3 py-1.5 font-mono text-teal-600">{String(o.shipOrderCode ?? o.orderCode ?? "—")}</td>
                                <td className={`px-3 py-1.5 whitespace-nowrap font-semibold ${b2cMissingDate ? "text-yellow-600" : "text-slate-500"}`}>
                                  {b2cMissingDate ? "⚠ No date" : b2cDateVal}
                                </td>
                                <td className="px-3 py-1.5 text-right">{qty}</td>
                                <td className="px-3 py-1.5 text-right font-semibold text-teal-600">1</td>
                                <td className="px-3 py-1.5 text-right font-semibold text-teal-600">{extra > 0 ? extra : "—"}</td>
                              </tr>
                            );
                          })}
                          <tr className="bg-teal-50 border-t border-teal-100 font-semibold text-teal-700">
                            <td colSpan={3} className="px-3 py-1.5">Total</td>
                            <td className="px-3 py-1.5 text-right">{wmsSource.b2c.length}</td>
                            <td className="px-3 py-1.5 text-right">{wmsSource.b2c.reduce((s, o) => s + Math.max(0, Number(o.totalQty ?? o.orderQty ?? 0) - 5), 0)}</td>
                          </tr>
                        </tbody>
                      </table>
                    )
                  )}

                  {/* ── Returns ── */}
                  {sourceTab === "returns" && (
                    wmsSource.returns.length === 0 ? (
                      <p className="text-center text-sm text-slate-400 py-8">No returns this period</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left text-slate-500 font-semibold">Order Code</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-semibold">Date</th>
                            <th className="px-3 py-2 text-right text-slate-500 font-semibold">Total Qty</th>
                            <th className="px-3 py-2 text-right text-slate-500 font-semibold">+1 Return</th>
                            <th className="px-3 py-2 text-right text-slate-500 font-semibold">+Restock Pcs</th>
                          </tr>
                        </thead>
                        <tbody>
                          {wmsSource.returns.map((o, i) => {
                            const qty = Number(o.totalQty ?? o.qty ?? 0);
                            const retDateVal = String(o.returnDate ?? o.inDate ?? o.orderDate ?? "");
                            const retMissingDate = !retDateVal || retDateVal.length < 6;
                            return (
                              <tr key={i} className={`border-b border-slate-50 ${retMissingDate ? "bg-yellow-50" : "hover:bg-slate-50"}`}>
                                <td className="px-3 py-1.5 font-mono text-orange-600">{String(o.returnOrderCode ?? o.orderCode ?? "—")}</td>
                                <td className={`px-3 py-1.5 whitespace-nowrap font-semibold ${retMissingDate ? "text-yellow-600" : "text-slate-500"}`}>
                                  {retMissingDate ? "⚠ No date" : retDateVal}
                                </td>
                                <td className="px-3 py-1.5 text-right">{qty}</td>
                                <td className="px-3 py-1.5 text-right font-semibold text-orange-600">1</td>
                                <td className="px-3 py-1.5 text-right font-semibold text-orange-600">{qty}</td>
                              </tr>
                            );
                          })}
                          <tr className="bg-orange-50 border-t border-orange-100 font-semibold text-orange-700">
                            <td colSpan={3} className="px-3 py-1.5">Total</td>
                            <td className="px-3 py-1.5 text-right">{wmsSource.returns.length}</td>
                            <td className="px-3 py-1.5 text-right">{wmsSource.returns.reduce((s, o) => s + Number(o.totalQty ?? o.qty ?? 0), 0)}</td>
                          </tr>
                        </tbody>
                      </table>
                    )
                  )}

                  {/* ── Storage ── */}
                  {sourceTab === "storage" && (
                    storageRows.length === 0 ? (
                      <p className="text-center text-sm text-slate-400 py-8">No storage data loaded. Use &apos;Load from WMS History&apos; below.</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left text-slate-500 font-semibold">Location Type</th>
                            <th className="px-3 py-2 text-right text-slate-500 font-semibold">15th Day Qty</th>
                            <th className="px-3 py-2 text-right text-slate-500 font-semibold">Last Day Qty</th>
                            <th className="px-3 py-2 text-right text-purple-600 font-semibold">Average</th>
                          </tr>
                        </thead>
                        <tbody>
                          {storageRows.map((row) => (
                            <tr key={row.key} className="border-b border-slate-50 hover:bg-slate-50">
                              <td className="px-3 py-1.5 text-slate-700 font-medium">{row.label}</td>
                              <td className="px-3 py-1.5 text-right text-slate-500">{row.qty15.toLocaleString()}</td>
                              <td className="px-3 py-1.5 text-right text-slate-500">{row.qtyLast.toLocaleString()}</td>
                              <td className="px-3 py-1.5 text-right font-semibold text-purple-700">{row.avg.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                            </tr>
                          ))}
                          <tr className="bg-purple-50 border-t border-purple-100 font-semibold text-purple-700">
                            <td className="px-3 py-1.5">Total</td>
                            <td className="px-3 py-1.5 text-right">{storageRows.reduce((s, r) => s + r.qty15, 0).toLocaleString()}</td>
                            <td className="px-3 py-1.5 text-right">{storageRows.reduce((s, r) => s + r.qtyLast, 0).toLocaleString()}</td>
                            <td className="px-3 py-1.5 text-right">{storageRows.reduce((s, r) => s + r.avg, 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                          </tr>
                        </tbody>
                      </table>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Storage Import Panel ── */}
        <div className="bg-white border border-purple-200 rounded-xl overflow-hidden shadow-sm mb-4">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-purple-100 bg-purple-50/60">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-purple-50 border-purple-200 text-purple-800">Storage</span>
              <span className="text-xs text-purple-600 font-medium">15th &amp; last-day snapshot → avg by Location Type</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={loadStorageFromHistory}
                disabled={storageLoadingHistory}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-purple-300 bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 transition-colors"
              >
                {storageLoadingHistory
                  ? <><RefreshCw className="w-3 h-3 animate-spin" />Loading…</>
                  : <><CloudDownload className="w-3 h-3" />Load from WMS History</>}
              </button>
              {(storage15 || storageLast) && (
                <button
                  onClick={() => { setStorage15(null); setStorageLast(null); setStorageHistoryError(""); setStorageHistoryDebug(null); }}
                  className="text-xs text-slate-400 hover:text-red-500 transition-colors"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
          {(storageHistoryError || storageHistoryDebug) && (
            <div className={`px-5 py-2.5 border-b text-xs ${storageHistoryError ? "bg-red-50 border-red-200 text-red-600" : "bg-slate-50 border-slate-200 text-slate-500"}`}>
              {storageHistoryError && (
                <div className="flex items-start gap-2 mb-1">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>{storageHistoryError}</span>
                </div>
              )}
              {storageHistoryDebug && (
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px] text-slate-500">
                  <span>📅 {storageHistoryDebug.date15}: <b>{storageHistoryDebug.rows15}</b> rows, <b>{storageHistoryDebug.matched15}</b> matched</span>
                  <span>📅 {storageHistoryDebug.dateLast}: <b>{storageHistoryDebug.rowsLast}</b> rows, <b>{storageHistoryDebug.matchedLast}</b> matched</span>
                </div>
              )}
            </div>
          )}

          {/* Two upload zones */}
          <div className="grid grid-cols-2 divide-x divide-purple-100">
            {[
              { label: "15th Day Data", snap: storage15, uploading: storageUploading15, handler: handleUpload15, color: "blue" },
              { label: "Last Day Data", snap: storageLast, uploading: storageUploadingLast, handler: handleUploadLast, color: "indigo" },
            ].map(({ label, snap, uploading, handler, color }) => (
              <div key={label} className="p-4 flex flex-col gap-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
                {snap ? (
                  <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                    <span className="text-xs text-green-700 truncate font-medium">{snap.file}</span>
                    <span className="text-xs text-green-600 ml-auto flex-shrink-0 whitespace-nowrap">{Object.values(snap.data).reduce((s,v)=>s+v,0)} loc</span>
                  </div>
                ) : (
                  <label className={`flex items-center justify-center gap-2 border-2 border-dashed rounded-lg px-4 py-4 cursor-pointer transition-colors ${
                    uploading ? "border-slate-200 opacity-60" : `border-${color}-200 hover:border-${color}-400 hover:bg-${color}-50`
                  }`}>
                    {uploading
                      ? <><RefreshCw className="w-4 h-4 animate-spin text-slate-400" /><span className="text-xs text-slate-400">Reading…</span></>
                      : <><Upload className="w-4 h-4 text-slate-400" /><span className="text-xs text-slate-500">Select Excel file</span></>}
                    <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={uploading} onChange={handler} />
                  </label>
                )}
                <p className="text-[10px] text-slate-400">
                  Auto-loaded from WMS History, or upload Excel (Location / occupancyInfo / Customer …)
                </p>
              </div>
            ))}
          </div>

          {/* Preview table */}
          {storageRows.length > 0 && (
            <div className="border-t border-purple-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Storage Type</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-blue-500 uppercase tracking-wide">15th Day</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-indigo-500 uppercase tracking-wide">Last Day</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-purple-600 uppercase tracking-wide">Avg (Billed)</th>
                  </tr>
                </thead>
                <tbody>
                  {storageRows.map((r) => (
                    <tr key={r.key} className="border-t border-slate-50">
                      <td className="px-4 py-2 text-slate-700 font-medium">{r.label}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-500">{r.qty15 > 0 ? r.qty15.toLocaleString() : <span className="text-slate-300">—</span>}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-500">{r.qtyLast > 0 ? r.qtyLast.toLocaleString() : <span className="text-slate-300">—</span>}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold text-purple-700">
                        {r.avg % 1 === 0 ? r.avg.toLocaleString() : r.avg.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-5 py-3 flex items-center justify-between border-t border-purple-100 bg-purple-50/40">
                <p className="text-xs text-slate-500">
                  Avg = (15th + Last) ÷ 2 · {storageRows.length} type{storageRows.length > 1 ? "s" : ""}
                  {!storage15 && <span className="ml-2 text-amber-500">⚠ 15th day data missing</span>}
                  {!storageLast && <span className="ml-2 text-amber-500">⚠ Last day data missing</span>}
                </p>
                <button
                  onClick={applyStorageToInvoice}
                  className="flex items-center gap-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg px-4 py-1.5 transition-colors"
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  Apply to Invoice
                </button>
              </div>
            </div>
          )}

          {/* Empty state */}
          {storageRows.length === 0 && !storage15 && !storageLast && (
            <div className="px-5 py-3 text-xs text-slate-400">
              Upload the 15th-day and last-day WMS inventory exports to auto-summarize by Location Type
            </div>
          )}
        </div>

        {/* Category sections */}
        <div className="space-y-4">
          {BILLING_CATEGORIES.map((cat) => {
            const catItems = editing.lineItems.filter((l) => l.category === cat);
            const catTotal = catItems.reduce((s, i) => s + calcLineAmount(i), 0);
            const isCollapsed = collapsed.has(cat);
            const colorClass = CATEGORY_COLOR[cat];

            return (
              <div key={cat} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                {/* Section header */}
                <button
                  onClick={() => toggleCollapse(cat)}
                  className={`w-full flex items-center justify-between px-5 py-3.5 border-b border-slate-100 hover:bg-slate-50 transition-colors`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${colorClass}`}>
                      {cat}
                    </span>
                    {catTotal > 0 && (
                      <span className="text-sm font-semibold text-slate-700">
                        {formatUSD(catTotal)}
                      </span>
                    )}
                  </div>
                  {isCollapsed ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-slate-400" />}
                </button>

                {!isCollapsed && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Description</th>
                          <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide w-24">Qty</th>
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide w-36">Unit</th>
                          <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide w-28">Rate</th>
                          <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide w-28">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {catItems.map((item) => {
                          const amt = calcLineAmount(item);
                          const inputCls = "w-full bg-transparent border-0 border-b border-transparent hover:border-slate-200 focus:border-blue-400 focus:outline-none text-sm py-0.5 transition-colors";
                          return (
                            <tr
                              key={item.id}
                              className={`border-b border-slate-50 last:border-0 ${item.qty === 0 ? "opacity-50" : ""}`}
                            >
                              {/* Description */}
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={item.description}
                                    onChange={(e) => updateItem(item.id, "description", e.target.value)}
                                    className={`${inputCls} text-slate-800`}
                                  />
                                  {item.autoFetched && item.qty > 0 && (
                                    <span className="flex-shrink-0 text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium">auto</span>
                                  )}
                                </div>
                              </td>
                              {/* Qty */}
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  value={item.qty === 0 ? "" : item.qty}
                                  onChange={(e) => updateItem(item.id, "qty", e.target.value)}
                                  placeholder="0"
                                  className={`${inputCls} text-right tabular-nums`}
                                />
                              </td>
                              {/* Unit */}
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  value={item.unit}
                                  onChange={(e) => updateItem(item.id, "unit", e.target.value)}
                                  className={`${inputCls} text-slate-500 text-xs`}
                                />
                              </td>
                              {/* Rate — 읽기전용 (Rate Master에서 관리) */}
                              <td className="px-3 py-2 text-right">
                                {item.costPlus ? (
                                  <span className="text-xs text-slate-500">cost+10%</span>
                                ) : (
                                  <span className="text-sm tabular-nums text-slate-600 select-none">
                                    {item.rate > 0 ? `$${item.rate}` : "—"}
                                  </span>
                                )}
                              </td>
                              {/* Amount (calculated) */}
                              <td className={`px-3 py-2 text-right font-semibold tabular-nums text-sm ${
                                amt > 0 ? "text-slate-900" : "text-slate-300"
                              }`}>
                                {amt > 0 ? formatUSD(amt) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-50 border-t border-slate-200">
                          <td colSpan={4} className="px-3 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                            Subtotal
                          </td>
                          <td className="px-3 py-2.5 text-right font-bold text-slate-900 tabular-nums">
                            {catTotal > 0 ? formatUSD(catTotal) : "—"}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Notes + Total footer */}
        <div className="mt-6 bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <div className="flex gap-6 items-start">
            <div className="flex-1">
              <label className="text-xs text-slate-500 uppercase tracking-wide mb-1.5 block">Notes</label>
              <textarea
                value={editing.notes}
                onChange={(e) => setEditing((p) => p ? { ...p, notes: e.target.value } : p)}
                rows={2}
                placeholder="Additional notes for this invoice…"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                {isMultiMode ? `${editing.customerName || editing.customer} Subtotal` : "Total"}
              </p>
              <p className="text-3xl font-bold text-slate-900 tabular-nums">{formatUSD(currentTotal)}</p>
            </div>
          </div>
        </div>

        {/* end extraTab === "none" */}
        </>}

        {/* ── Combined grand total bar (multi-mode) ── */}
        {isMultiMode && (() => {
          const group = getCurrentGroup();
          const customerTotal = group.reduce((s, inv) => s + inv.total, 0);
          const subleaseTotal = (parseFloat(subleaseRentQty) || 0) * SUBLEASE_RENT_RATE
                              + (parseFloat(subleaseOpQty)   || 0) * SUBLEASE_OP_RATE;
          const grandTotal = customerTotal + subleaseTotal;
          return (
            <div className="mt-4 bg-slate-900 rounded-xl px-6 py-4 flex items-center gap-6 flex-wrap shadow-lg">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex-shrink-0">Combined Total</p>
              {group.map((inv, i) => (
                <div key={inv.customer} className="flex items-center gap-2">
                  <button
                    onClick={() => switchTab(i)}
                    className={`text-xs font-medium px-2 py-0.5 rounded transition-colors ${
                      i === activeIdx ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {inv.customerName || inv.customer}
                  </button>
                  <span className="text-sm font-semibold text-slate-200 tabular-nums">{formatUSD(inv.total)}</span>
                </div>
              ))}
              {subleaseTotal > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium px-2 py-0.5 rounded bg-amber-700 text-amber-100">Sublease</span>
                  <span className="text-sm font-semibold text-amber-300 tabular-nums">{formatUSD(subleaseTotal)}</span>
                </div>
              )}
              <div className="ml-auto text-right flex-shrink-0">
                <p className="text-xs text-slate-400 uppercase tracking-wide">Grand Total</p>
                <p className="text-2xl font-bold text-white tabular-nums">{formatUSD(grandTotal)}</p>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  // ─── Invoice list view ────────────────────────────────────────────────────────
  return (
    <div className="p-8">
      {exportPreviewModal}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Billing</h1>
          <p className="text-slate-500 text-sm mt-0.5">Monthly invoice management</p>
        </div>
        <div className="flex items-center gap-2">
          {invoices.length > 0 && (
            <button
              onClick={() => setExportPreview({ mode: "list", invoices, period: invoices[0]?.period ?? "" })}
              className="flex items-center gap-2 text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Download className="w-4 h-4" />
              Export All
            </button>
          )}
          <button
            onClick={() => { setShowNewForm(true); setAllExportMsg(""); }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Invoice
          </button>
        </div>
      </div>


      {/* New invoice form */}
      {showNewForm && (
        <div className="bg-white border border-blue-200 rounded-xl p-5 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-900">New Invoice</h2>
            {customers.length > 0 && (
              <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
                <button
                  onClick={() => { setIsMultiSelect(false); setSelectedCustomers([]); }}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${!isMultiSelect ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
                >
                  Single
                </button>
                <button
                  onClick={() => { setIsMultiSelect(true); setNewCustomer(""); }}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${isMultiSelect ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
                >
                  Multiple
                </button>
              </div>
            )}
          </div>

          {/* Period row (shared) */}
          <div className="flex flex-wrap gap-3 items-end mb-4">
            <div>
              <label className="text-xs text-slate-500 uppercase tracking-wide mb-1.5 block">Year</label>
              <select value={newYear} onChange={(e) => setNewYear(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 uppercase tracking-wide mb-1.5 block">Month</label>
              <select value={newMonth} onChange={(e) => setNewMonth(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                {MONTHS.map((m, i) => (
                  <option key={m} value={String(i + 1).padStart(2, "0")}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          {/* ── Single mode ── */}
          {!isMultiSelect && (
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wide mb-1.5 block">Customer</label>
                {customers.length > 0 ? (
                  <select value={newCustomer}
                    onChange={(e) => { setNewCustomer(e.target.value); setNewCustomerName(customers.find(c => c.code === e.target.value)?.name ?? ""); setAllExportMsg(""); }}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-56">
                    <option value="">— Select —</option>
                    <option value="__ALL__">★ All Customers (Export Only)</option>
                    {customers.map((c) => (
                      <option key={c.code} value={c.code}>{c.code}{c.name && ` — ${c.name}`}</option>
                    ))}
                  </select>
                ) : (
                  <input type="text" value={newCustomer} onChange={(e) => setNewCustomer(e.target.value)}
                    placeholder="e.g. STL001"
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                )}
              </div>
              {customers.length === 0 && (
                <div>
                  <label className="text-xs text-slate-500 uppercase tracking-wide mb-1.5 block">Customer Name</label>
                  <input type="text" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)}
                    placeholder="e.g. STL Logistics"
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-44 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
              {newCustomer === "__ALL__" ? (
                <button onClick={exportAllCustomers} disabled={allExporting || customers.length === 0}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                  {allExporting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  {allExporting ? "Exporting..." : "Export All"}
                </button>
              ) : (
                <button onClick={createInvoice} disabled={!newCustomer}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                  <Receipt className="w-4 h-4" /> Create
                </button>
              )}
              <button onClick={() => { setShowNewForm(false); setAllExportMsg(""); setIsMultiSelect(false); setSelectedCustomers([]); }}
                className="text-sm text-slate-400 hover:text-slate-600 px-3 py-2">Cancel</button>
            </div>
          )}

          {/* ── Multi mode ── */}
          {isMultiSelect && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-slate-500 uppercase tracking-wide">Select Customers</label>
                <div className="flex items-center gap-2">
                  <button onClick={() => setSelectedCustomers(customers.map(c => c.code))}
                    className="text-xs text-blue-600 hover:text-blue-800">Select All</button>
                  <span className="text-slate-300">|</span>
                  <button onClick={() => setSelectedCustomers([])}
                    className="text-xs text-slate-400 hover:text-slate-600">Clear</button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5 max-h-48 overflow-y-auto border border-slate-200 rounded-xl p-3 mb-4">
                {customers.map((c) => {
                  const checked = selectedCustomers.includes(c.code);
                  return (
                    <label key={c.code}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors text-sm ${
                        checked ? "bg-blue-50 border border-blue-200" : "hover:bg-slate-50 border border-transparent"
                      }`}>
                      <input type="checkbox" checked={checked}
                        onChange={(e) => setSelectedCustomers(prev =>
                          e.target.checked ? [...prev, c.code] : prev.filter(x => x !== c.code)
                        )}
                        className="accent-blue-600" />
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800 truncate">{c.code}</p>
                        {c.name && <p className="text-[10px] text-slate-400 truncate">{c.name}</p>}
                      </div>
                    </label>
                  );
                })}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={createMultiInvoice} disabled={selectedCustomers.length < 2}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                  <Receipt className="w-4 h-4" />
                  Create Combined ({selectedCustomers.length} customers)
                </button>
                <button onClick={() => { setShowNewForm(false); setIsMultiSelect(false); setSelectedCustomers([]); }}
                  className="text-sm text-slate-400 hover:text-slate-600 px-3 py-2">Cancel</button>
              </div>
            </div>
          )}

          {/* All-customers export progress/result */}
          {allExportMsg && (
            <div className={`mt-3 flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm border ${
              allExportMsg.startsWith("✓") ? "bg-green-50 border-green-200 text-green-800"
              : allExportMsg.startsWith("Export failed") ? "bg-red-50 border-red-200 text-red-700"
              : "bg-blue-50 border-blue-200 text-blue-700"
            }`}>
              {allExporting && <RefreshCw className="w-3.5 h-3.5 animate-spin flex-shrink-0" />}
              {allExportMsg}
            </div>
          )}
        </div>
      )}

      {/* Invoice list */}
      {listLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-100 h-16 animate-pulse" />
          ))}
        </div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-24 text-slate-400">
          <Receipt className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No invoices yet</p>
          <p className="text-xs mt-1">Click "New Invoice" to create your first one</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Customer</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Period</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Total</th>
                <th className="px-5 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Updated</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {invoiceListItems.map((item) => {
                if (item.type === "single") {
                  const inv = item.invoice;
                  return (
                    <tr key={inv.id} onClick={() => openInvoice(inv)}
                      className="border-b border-slate-100 last:border-0 hover:bg-blue-50 cursor-pointer transition-colors">
                      <td className="px-5 py-3.5">
                        <p className="font-medium text-slate-900">{inv.customerName || inv.customer}</p>
                        <p className="text-xs text-slate-400 font-mono">{inv.customer}</p>
                      </td>
                      <td className="px-5 py-3.5 text-slate-700">{periodLabel(inv.period)}</td>
                      <td className="px-5 py-3.5 text-right font-bold text-slate-900 tabular-nums">{formatUSD(inv.total)}</td>
                      <td className="px-5 py-3.5 text-center">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${inv.status === "final" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                          {inv.status === "final" ? "Final" : "Draft"}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right text-slate-400 text-xs">
                        {new Date(inv.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </td>
                      <td className="px-5 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setExportPreview({ mode: "single", invoice: inv })}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Export Excel">
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => deleteInvoice(inv.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                // ── Group row ──
                const { groupId, invoices: ginvs } = item;
                const isExpanded = expandedGroups.has(groupId);
                const groupTotal = ginvs.reduce((s, inv) => s + inv.total, 0);
                const groupStatus = ginvs.every(inv => inv.status === "final") ? "final" : "draft";
                const groupPeriod = ginvs[0].period;
                const groupUpdated = ginvs.reduce((latest, inv) =>
                  inv.updatedAt > latest ? inv.updatedAt : latest, ginvs[0].updatedAt);

                return (
                  <React.Fragment key={groupId}>
                    {/* Group header row */}
                    <tr onClick={() => openGroupInvoice(ginvs)}
                      className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer transition-colors bg-blue-50/30">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedGroups(prev => {
                                const next = new Set(prev);
                                if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
                                return next;
                              });
                            }}
                            className="text-slate-400 hover:text-slate-700 flex-shrink-0"
                          >
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Combined</span>
                              <p className="font-medium text-slate-900 text-sm">
                                {ginvs.map(inv => inv.customerName || inv.customer).join(", ")}
                              </p>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">{ginvs.length} customers</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-700">{periodLabel(groupPeriod)}</td>
                      <td className="px-5 py-3.5 text-right font-bold text-slate-900 tabular-nums">{formatUSD(groupTotal)}</td>
                      <td className="px-5 py-3.5 text-center">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${groupStatus === "final" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                          {groupStatus === "final" ? "Final" : "Draft"}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right text-slate-400 text-xs">
                        {new Date(groupUpdated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </td>
                      <td className="px-5 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setExportPreview({ mode: "list", invoices: ginvs, period: groupPeriod })}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Export Combined Excel">
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => deleteGroup(ginvs)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete Group">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded: individual rows */}
                    {isExpanded && ginvs.map((inv) => (
                      <tr key={inv.id} onClick={() => openGroupInvoice(ginvs)}
                        className="border-b border-slate-50 last:border-0 hover:bg-blue-50/60 cursor-pointer transition-colors bg-slate-50/60">
                        <td className="pl-14 pr-5 py-2.5">
                          <p className="text-sm text-slate-700 font-medium">{inv.customerName || inv.customer}</p>
                          <p className="text-xs text-slate-400 font-mono">{inv.customer}</p>
                        </td>
                        <td className="px-5 py-2.5 text-slate-500 text-xs">{periodLabel(inv.period)}</td>
                        <td className="px-5 py-2.5 text-right text-slate-700 font-semibold tabular-nums text-xs">{formatUSD(inv.total)}</td>
                        <td className="px-5 py-2.5 text-center">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${inv.status === "final" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                            {inv.status === "final" ? "Final" : "Draft"}
                          </span>
                        </td>
                        <td className="px-5 py-2.5 text-right text-slate-400 text-xs">
                          {new Date(inv.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </td>
                        <td className="px-5 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => setExportPreview({ mode: "single", invoice: inv })}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Export Excel">
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Office Sublease + Grand Total ── */}
      {(() => {
        const rentQty    = Math.max(0, parseFloat(subleaseRentQty) || 0);
        const opQty      = Math.max(0, parseFloat(subleaseOpQty)   || 0);
        const rentAmt    = rentQty * SUBLEASE_RENT_RATE;
        const opAmt      = opQty   * SUBLEASE_OP_RATE;
        const subleaseTotal = rentAmt + opAmt;
        const invoicesTotal = invoices.reduce((s, inv) => s + inv.total, 0);
        const grandTotal    = invoicesTotal + subleaseTotal;
        const fmt = (v: number) => formatUSD(v);
        return (
          <div className="mt-4 space-y-3">
            {/* Sublease card */}
            <div className="bg-white border border-amber-200 rounded-xl overflow-hidden shadow-sm">
              <div className="flex items-center justify-between px-5 py-3 border-b border-amber-100 bg-amber-50/60">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-amber-600" />
                  <span className="text-sm font-semibold text-amber-800">Office Sublease</span>
                  <span className="text-xs text-amber-600">— Monthly Fixed Charges</span>
                </div>
                <span className="text-sm font-bold text-amber-900 tabular-nums">{fmt(subleaseTotal)}</span>
              </div>
              <div className="px-5 py-3 flex flex-wrap gap-6">
                {/* Rent */}
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-500">Monthly Rent (§3.2)</span>
                  <span className="text-slate-400 text-xs">{fmt(SUBLEASE_RENT_RATE)} ×</span>
                  <input
                    type="number" min={0} step={1} value={subleaseRentQty}
                    onChange={e => setSubleaseRentQty(e.target.value)}
                    className="w-16 text-right border border-amber-200 bg-amber-50 focus:bg-white focus:border-amber-400 rounded px-2 py-0.5 text-sm font-mono outline-none"
                  />
                  <span className="text-slate-400 text-xs">mo</span>
                  <span className="font-semibold text-slate-800 tabular-nums">{fmt(rentAmt)}</span>
                </div>
                {/* Operating Cost */}
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-500">Operating Cost (§3.3)</span>
                  <span className="text-slate-400 text-xs">{fmt(SUBLEASE_OP_RATE)} ×</span>
                  <input
                    type="number" min={0} step={1} value={subleaseOpQty}
                    onChange={e => setSubleaseOpQty(e.target.value)}
                    className="w-20 text-right border border-amber-200 bg-amber-50 focus:bg-white focus:border-amber-400 rounded px-2 py-0.5 text-sm font-mono outline-none"
                  />
                  <span className="text-slate-400 text-xs">sq ft</span>
                  <span className="font-semibold text-slate-800 tabular-nums">{fmt(opAmt)}</span>
                </div>
              </div>
            </div>

            {/* Grand Total bar */}
            {invoices.length > 0 && (
              <div className="bg-slate-900 rounded-xl px-6 py-4 flex items-center gap-4 flex-wrap shadow-lg">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Grand Total</p>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500">Invoices</span>
                  <span className="text-sm font-semibold text-slate-300 tabular-nums">{fmt(invoicesTotal)}</span>
                </div>
                <span className="text-slate-600">+</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-amber-500">Sublease</span>
                  <span className="text-sm font-semibold text-amber-300 tabular-nums">{fmt(subleaseTotal)}</span>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-2xl font-bold text-white tabular-nums">{fmt(grandTotal)}</p>
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
