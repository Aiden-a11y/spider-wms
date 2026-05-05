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
    const catItems = invoice.lineItems.filter(
      (l) => l.category === cat && l.qty !== 0
    );
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

    // Data rows — only non-zero qty
    for (const item of catItems) {
      const amt = calcLineAmount(item);
      const rateDisplay = item.costPlus ? "cost+10%" : item.rate;
      const r = ws.addRow([lineNo, cat, item.description, rateDisplay, item.unit, item.qty, amt]);
      r.height = 15;

      const isAlt = lineNo % 2 === 0;
      r.eachCell((cell, col) => {
        cell.fill = {
          type: "pattern", pattern: "solid",
          fgColor: { argb: isAlt ? C.rowAlt : C.white },
        };
        cell.font = { size: 10, color: { argb: C.black } };
        cell.alignment = { vertical: "middle", horizontal: col <= 3 ? "left" : "right" };
        applyBorder(cell);
      });
      // Rate in teal
      r.getCell(4).font = { size: 10, color: { argb: C.teal } };
      if (!item.costPlus) r.getCell(4).numFmt = "$#,##0.00";
      r.getCell(6).numFmt = "#,##0.##";
      r.getCell(7).numFmt = "$#,##0.00";
      lineNo++;
    }

    // Subtotal row
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

/** Export a single invoice — styled sheet + optional raw data tabs + Rate Table + OM Subsidy */
async function exportInvoiceToExcel(invoice: BillingInvoice, source?: WmsSource | null) {
  const wb = new ExcelJS.Workbook();
  const sheetName = (invoice.customerName || invoice.customer).slice(0, 31);
  fillInvoiceSheet(wb.addWorksheet(sheetName), invoice);
  if (source) addRawDataSheets(wb, source);
  addRateTableSheet(wb);
  addOmSubsidySheet(wb);
  await downloadWorkbook(wb, `Invoice_${invoice.customer}_${invoice.period}.xlsx`);
}

/** Export multiple invoices — styled Summary tab + one tab per customer + optional raw data tabs */
async function exportAllToExcel(invoices: BillingInvoice[], period: string, source?: WmsSource | null) {
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
  // Build a merged item list: use first invoice's item as template, sum qty across all
  const itemMap = new Map<string, BillingLineItem & { totalQty: number }>();
  for (const inv of invoices) {
    for (const item of inv.lineItems) {
      const existing = itemMap.get(item.id);
      if (existing) {
        existing.totalQty += item.qty;
      } else {
        itemMap.set(item.id, { ...item, totalQty: item.qty });
      }
    }
  }

  let lineNo = 1;
  let sectionNo = 1;
  let grandTotal = 0;

  for (const cat of BILLING_CATEGORIES) {
    const catItems = Array.from(itemMap.values()).filter(
      (it) => it.category === cat && it.totalQty !== 0
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

    let catTotal = 0;
    for (const item of catItems) {
      // For aggregated qty, recalculate amount
      const aggQty = item.totalQty;
      const aggAmt = item.costPlus ? aggQty * 1.1 : aggQty * item.rate;
      catTotal += aggAmt;
      grandTotal += aggAmt;

      const r = ws.addRow([
        lineNo, cat, item.description,
        item.costPlus ? "cost+10%" : item.rate,
        item.unit, aggQty, aggAmt,
      ]);
      r.height = 15;
      const isAlt = lineNo % 2 === 0;
      r.eachCell((cell, col) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isAlt ? C.rowAlt : C.white } };
        cell.font = { size: 10, color: { argb: C.black } };
        cell.alignment = { vertical: "middle", horizontal: col <= 3 ? "left" : "right" };
        applyBorder(cell);
      });
      r.getCell(4).font = { size: 10, color: { argb: C.teal } };
      if (!item.costPlus) r.getCell(4).numFmt = "$#,##0.00";
      r.getCell(6).numFmt = "#,##0.##";
      r.getCell(7).numFmt = "$#,##0.00";
      lineNo++;
    }

    // Subtotal
    const sub = ws.addRow(["", "", "", "", "", "Subtotal", catTotal]);
    sub.height = 15;
    sub.eachCell((cell, col) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.subtotalBg } };
      cell.font = { bold: col >= 6, size: 10, color: { argb: C.black } };
      cell.alignment = { vertical: "middle", horizontal: "right" };
      applyBorder(cell);
    });
    sub.getCell(7).numFmt = "$#,##0.00";
  }

  // ── Grand Total ──
  const gt = ws.addRow(["", "", "", "", "", "GRAND TOTAL", grandTotal]);
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

  // ── One sheet per customer ──
  const usedNames = new Set<string>();
  for (const inv of invoices) {
    let name = (inv.customerName || inv.customer).slice(0, 28);
    if (usedNames.has(name)) name = `${name.slice(0, 24)}_${inv.customer.slice(-3)}`;
    usedNames.add(name);
    fillInvoiceSheet(wb.addWorksheet(name), inv);
  }

  // ── Raw WMS data tabs ──
  if (source) addRawDataSheets(wb, source);
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

  // ── WMS source data (shown after auto-fetch) ──
  const [wmsSource, setWmsSource] = useState<WmsSource | null>(null);
  const [sourceTab, setSourceTab] = useState<"receiving" | "b2b" | "b2c" | "returns">("receiving");
  const [showSource, setShowSource] = useState(false);

  // ── multi-customer combined invoice ──
  const [editGroup, setEditGroup] = useState<BillingInvoice[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);

  // ── new invoice form: multi-select ──
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);

  // ── Storage import ──
  type StorageSnap = { data: Record<string, number>; file: string };
  const [storage15, setStorage15] = useState<StorageSnap | null>(null);
  const [storageLast, setStorageLast] = useState<StorageSnap | null>(null);
  const [storageUploading15, setStorageUploading15] = useState(false);
  const [storageUploadingLast, setStorageUploadingLast] = useState(false);

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
    const cloned = group.map(inv => JSON.parse(JSON.stringify(inv)));
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
    setEditGroup(group);
    setEditing(JSON.parse(JSON.stringify(group[idx])));
    setActiveIdx(idx);
    setStorage15(null); setStorageLast(null);
    setFetchMsg(""); setWmsSource(null); setShowSource(false);
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
  function openInvoice(inv: BillingInvoice) {
    const cloned = JSON.parse(JSON.stringify(inv));
    setEditing(cloned);
    setEditGroup([cloned]);
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

        // Parse task comments to get per-order picking/out quantities
        let pickPiece = 0, pickCarton = 0, pickPallet = 0;
        let cartonPacking = 0, palletizing = 0;
        const b2bWarnings: string[] = [];

        for (const order of list) {
          const tasks = parseTaskComment(String(order.comment ?? ""));

          const pp  = tasks["Picking per Piece"]   ?? 0;
          const pc  = tasks["Picking per Carton"]  ?? 0;
          const ppl = tasks["Picking per Pallet"]  ?? 0;
          const oc  = tasks["Out per Carton"]      ?? 0;
          const op  = tasks["Out per Pallet"]      ?? 0;

          pickPiece   += pp;
          pickCarton  += pc;
          pickPallet  += ppl;

          // Carton Packing: charge Out per Carton UNLESS it equals Picking per Carton
          // (if same qty → cartons were just picked as-is, no repacking needed)
          if (oc > 0 && oc !== pc) cartonPacking += oc;

          // Palletizing: charge Out per Pallet UNLESS it equals Picking per Pallet
          // (if same qty → pallets were just picked as-is, no palletizing needed)
          if (op > 0 && op !== ppl) palletizing += op;

          // Warning: piece-level picking but no outbound container info
          if (pp > 0 && oc === 0 && op === 0) {
            const code = String(order.shippingOrderCode ?? order.orderCode ?? "");
            b2bWarnings.push(code);
          }
        }

        if (pickPiece   > 0) updates["b2b_pick_piece"]      = pickPiece;
        if (pickCarton  > 0) updates["b2b_pick_carton"]     = pickCarton;
        if (pickPallet  > 0) updates["b2b_pick_pallet"]     = pickPallet;
        if (cartonPacking > 0) updates["b2b_carton_packing"] = cartonPacking;
        if (palletizing > 0) updates["b2b_palletizing"]     = palletizing;
        if (b2bWarnings.length > 0) source.b2bWarnings      = b2bWarnings;
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
    try {
      const { updates, source } = await fetchWmsQty(editing.customer, editing.period);
      setWmsSource(source);
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

  if (editing) {
    return (
      <div className="pt-8 pb-8 px-8 w-full">
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
            {/* Export */}
            <button
              onClick={() => {
                const group = getCurrentGroup();
                if (isMultiMode) exportAllToExcel(group, editing.period, wmsSource).catch(console.error);
                else exportInvoiceToExcel({ ...editing, total: currentTotal }, wmsSource).catch(console.error);
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

        {/* ── Customer tabs (multi-mode) ── */}
        {isMultiMode && (
          <div className="flex gap-0 border-b border-slate-200 mb-5 -mx-8 px-8">
            {editGroup.map((inv, i) => (
              <button
                key={inv.customer}
                onClick={() => switchTab(i)}
                className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                  i === activeIdx
                    ? "border-blue-600 text-blue-700 bg-blue-50/60"
                    : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                }`}
              >
                {inv.customerName || inv.customer}
                {inv.total > 0 && (
                  <span className={`ml-2 text-xs font-semibold ${i === activeIdx ? "text-blue-500" : "text-slate-400"}`}>
                    {formatUSD(inv.total)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

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
                </div>

                {/* Table area */}
                <div className="overflow-x-auto" style={{ maxHeight: "32rem" }}>
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
                            return (
                              <tr key={i} className={`border-b border-slate-50 ${isContainer ? "bg-red-50/40" : "hover:bg-slate-50"}`}>
                                <td className="px-3 py-1.5 font-mono text-blue-600 whitespace-nowrap">{String(o.receiveOrderCode ?? o.orderCode ?? "—")}</td>
                                <td className="px-3 py-1.5 text-slate-400 font-mono text-[10px]">{String(o.poNo ?? o.poNumber ?? o.referenceNo ?? "—")}</td>
                                <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{String(o.inDate ?? o.receiveDate ?? o.orderDate ?? "—")}</td>
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
                      <div>
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
                        <table className="w-full text-xs">
                          <thead className="bg-slate-50 sticky top-0">
                            <tr>
                              <th className="px-3 py-2 text-left text-slate-500 font-semibold">Order Code</th>
                              <th className="px-3 py-2 text-left text-slate-500 font-semibold">Date</th>
                              <th className="px-3 py-2 text-right text-slate-500 font-semibold">Pick/Piece</th>
                              <th className="px-3 py-2 text-right text-slate-500 font-semibold">Pick/Carton</th>
                              <th className="px-3 py-2 text-right text-slate-500 font-semibold">Pick/Pallet</th>
                              <th className="px-3 py-2 text-right text-slate-500 font-semibold">Out/Carton</th>
                              <th className="px-3 py-2 text-right text-slate-500 font-semibold">Out/Pallet</th>
                              <th className="px-3 py-2 text-right text-slate-500 font-semibold">Packing✓</th>
                              <th className="px-3 py-2 text-right text-slate-500 font-semibold">Palletize✓</th>
                            </tr>
                          </thead>
                          <tbody>
                            {wmsSource.b2b.map((o, i) => {
                              const tasks = parseTaskComment(String(o.comment ?? ""));
                              const pp  = tasks["Picking per Piece"]  ?? 0;
                              const pc  = tasks["Picking per Carton"] ?? 0;
                              const ppl = tasks["Picking per Pallet"] ?? 0;
                              const oc  = tasks["Out per Carton"]     ?? 0;
                              const op  = tasks["Out per Pallet"]     ?? 0;
                              const packingCharged  = oc > 0 && oc !== pc;
                              const palletizeCharged = op > 0 && op !== ppl;
                              const warn = pp > 0 && oc === 0 && op === 0;
                              return (
                                <tr key={i} className={`border-b border-slate-50 ${warn ? "bg-amber-50" : ""}`}>
                                  <td className="px-3 py-1.5 font-mono text-emerald-600">
                                    {String(o.shippingOrderCode ?? o.orderCode ?? "—")}
                                    {warn && <span className="ml-1 text-amber-500">⚠</span>}
                                  </td>
                                  <td className="px-3 py-1.5 text-slate-500">{String(o.orderDate ?? "—")}</td>
                                  <td className="px-3 py-1.5 text-right">{pp || "—"}</td>
                                  <td className="px-3 py-1.5 text-right">{pc || "—"}</td>
                                  <td className="px-3 py-1.5 text-right">{ppl || "—"}</td>
                                  <td className="px-3 py-1.5 text-right">{oc || "—"}</td>
                                  <td className="px-3 py-1.5 text-right">{op || "—"}</td>
                                  <td className="px-3 py-1.5 text-right font-semibold">
                                    {oc > 0 ? (packingCharged ? <span className="text-emerald-600">{oc}</span> : <span className="text-slate-400 line-through">{oc}</span>) : "—"}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-semibold">
                                    {op > 0 ? (palletizeCharged ? <span className="text-emerald-600">{op}</span> : <span className="text-slate-400 line-through">{op}</span>) : "—"}
                                  </td>
                                </tr>
                              );
                            })}
                            <tr className="bg-emerald-50 border-t border-emerald-100 font-semibold text-emerald-700">
                              <td colSpan={2} className="px-3 py-1.5">Total ({wmsSource.b2b.length} orders)</td>
                              <td className="px-3 py-1.5 text-right">{wmsSource.b2b.reduce((s, o) => s + (parseTaskComment(String(o.comment ?? ""))["Picking per Piece"] ?? 0), 0) || "—"}</td>
                              <td className="px-3 py-1.5 text-right">{wmsSource.b2b.reduce((s, o) => s + (parseTaskComment(String(o.comment ?? ""))["Picking per Carton"] ?? 0), 0) || "—"}</td>
                              <td className="px-3 py-1.5 text-right">{wmsSource.b2b.reduce((s, o) => s + (parseTaskComment(String(o.comment ?? ""))["Picking per Pallet"] ?? 0), 0) || "—"}</td>
                              <td className="px-3 py-1.5 text-right">{wmsSource.b2b.reduce((s, o) => s + (parseTaskComment(String(o.comment ?? ""))["Out per Carton"] ?? 0), 0) || "—"}</td>
                              <td className="px-3 py-1.5 text-right">{wmsSource.b2b.reduce((s, o) => s + (parseTaskComment(String(o.comment ?? ""))["Out per Pallet"] ?? 0), 0) || "—"}</td>
                              <td className="px-3 py-1.5 text-right">{wmsSource.b2b.reduce((s, o) => { const t = parseTaskComment(String(o.comment ?? "")); const oc = t["Out per Carton"] ?? 0; const pc = t["Picking per Carton"] ?? 0; return s + (oc > 0 && oc !== pc ? oc : 0); }, 0) || "—"}</td>
                              <td className="px-3 py-1.5 text-right">{wmsSource.b2b.reduce((s, o) => { const t = parseTaskComment(String(o.comment ?? "")); const op = t["Out per Pallet"] ?? 0; const ppl = t["Picking per Pallet"] ?? 0; return s + (op > 0 && op !== ppl ? op : 0); }, 0) || "—"}</td>
                            </tr>
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
                            return (
                              <tr key={i} className="border-b border-slate-50">
                                <td className="px-3 py-1.5 font-mono text-teal-600">{String(o.shipOrderCode ?? o.orderCode ?? "—")}</td>
                                <td className="px-3 py-1.5 text-slate-500">{String(o.orderDate ?? "—")}</td>
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
                            return (
                              <tr key={i} className="border-b border-slate-50">
                                <td className="px-3 py-1.5 font-mono text-orange-600">{String(o.returnOrderCode ?? o.orderCode ?? "—")}</td>
                                <td className="px-3 py-1.5 text-slate-500">{String(o.orderDate ?? "—")}</td>
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
              <span className="text-xs text-purple-600 font-medium">Upload inventory snapshots → auto-calculate average by Location Type</span>
            </div>
            {(storage15 || storageLast) && (
              <button
                onClick={() => { setStorage15(null); setStorageLast(null); }}
                className="text-xs text-slate-400 hover:text-red-500 transition-colors"
              >
                Reset
              </button>
            )}
          </div>

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
                    <span className="text-xs text-green-600 ml-auto flex-shrink-0">{Object.values(snap.data).reduce((s,v)=>s+v,0)} locations</span>
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
                  Columns: Location / occupancyInfo / Customer / SKU / Product Name / Qty …
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

        {/* ── Combined grand total bar (multi-mode) ── */}
        {isMultiMode && (() => {
          const group = getCurrentGroup();
          const grandTotal = group.reduce((s, inv) => s + inv.total, 0);
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Billing</h1>
          <p className="text-slate-500 text-sm mt-0.5">Monthly invoice management</p>
        </div>
        <div className="flex items-center gap-2">
          {invoices.length > 0 && (
            <button
              onClick={() => exportAllToExcel(invoices, invoices[0]?.period ?? "").catch(console.error)}
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
                          <button onClick={() => exportInvoiceToExcel(inv).catch(console.error)}
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
                          <button onClick={() => exportAllToExcel(ginvs, groupPeriod).catch(console.error)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Export Combined Excel">
                            <Download className="w-3.5 h-3.5" />
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
                          <button onClick={() => exportInvoiceToExcel(inv).catch(console.error)}
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
    </div>
  );
}
