"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
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
} from "lucide-react";
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

// Category accent colors (ARGB hex, no #)
// B&W palette
const BW = {
  black:    "FF000000",
  white:    "FFFFFFFF",
  dark:     "FF1A1A1A", // near-black — title / grand total bg
  mid:      "FF444444", // category header bg
  light:    "FFD0D0D0", // column header bg
  faint:    "FFF2F2F2", // zero-qty row + subtotal bg
  border:   "FF888888",
};

const COL_WIDTHS = [52, 10, 26, 14, 14];

function applyBorder(cell: ExcelJS.Cell, style: ExcelJS.BorderStyle = "thin") {
  const color = { argb: BW.border };
  cell.border = {
    top: { style, color }, bottom: { style, color },
    left: { style, color }, right: { style, color },
  };
}

/** Fill one ExcelJS worksheet with a B&W styled invoice */
function fillInvoiceSheet(ws: ExcelJS.Worksheet, invoice: BillingInvoice) {
  ws.columns = COL_WIDTHS.map((w) => ({ width: w }));

  // ── Invoice title ──
  const titleRow = ws.addRow(["INVOICE"]);
  titleRow.height = 22;
  ws.mergeCells(`A${titleRow.number}:E${titleRow.number}`);
  const titleCell = titleRow.getCell(1);
  titleCell.font = { bold: true, size: 14, color: { argb: BW.white } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BW.dark } };
  titleCell.alignment = { vertical: "middle", indent: 1 };
  applyBorder(titleCell, "medium");

  // ── Meta rows ──
  const meta = [
    ["Customer",      invoice.customerName || invoice.customer],
    ["Customer Code", invoice.customer],
    ["Period",        periodLabel(invoice.period)],
    ["Rate Version",  invoice.rateVersion],
    ["Generated",     new Date().toLocaleDateString("en-US")],
  ];
  for (const [label, value] of meta) {
    const r = ws.addRow([label, value]);
    r.getCell(1).font = { bold: true, color: { argb: BW.black } };
    r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BW.faint } };
    r.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BW.white } };
    [1, 2].forEach((c) => applyBorder(r.getCell(c)));
  }
  ws.addRow([]);

  // ── Category sections ──
  for (const cat of BILLING_CATEGORIES) {
    const catItems = invoice.lineItems.filter((l) => l.category === cat);

    // Category header — dark gray, white bold text
    const catRow = ws.addRow([cat.toUpperCase()]);
    catRow.height = 18;
    ws.mergeCells(`A${catRow.number}:E${catRow.number}`);
    const catCell = catRow.getCell(1);
    catCell.font = { bold: true, size: 11, color: { argb: BW.white } };
    catCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BW.mid } };
    catCell.alignment = { vertical: "middle", indent: 1 };
    applyBorder(catCell, "medium");

    // Column headers — light gray bg, bold black
    const colHeaderRow = ws.addRow(["Description", "Qty", "Unit", "Rate", "Amount"]);
    colHeaderRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: BW.black } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BW.light } };
      cell.alignment = { horizontal: Number(cell.col) === 1 ? "left" : "right" };
      applyBorder(cell);
    });

    // Data rows
    for (const item of catItems) {
      const amt = calcLineAmount(item);
      const r = ws.addRow([
        item.description,
        item.qty,
        item.unit,
        item.costPlus ? "cost + 10%" : item.rate,
        amt,
      ]);
      r.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: item.qty === 0 ? BW.faint : BW.white } };
        cell.font = { color: { argb: BW.black } };
        applyBorder(cell);
        if (Number(cell.col) > 1) cell.alignment = { horizontal: "right" };
      });
      r.getCell(2).numFmt = "#,##0.##";
      if (!item.costPlus) r.getCell(4).numFmt = "$#,##0.00";
      r.getCell(5).numFmt = "$#,##0.00";
    }

    // Subtotal row — faint bg, bold
    const sub = catItems.reduce((s, i) => s + calcLineAmount(i), 0);
    const subRow = ws.addRow(["", "", "", "Subtotal", sub]);
    subRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BW.faint } };
      cell.font = { color: { argb: BW.black } };
      applyBorder(cell);
      if (Number(cell.col) >= 4) {
        cell.font = { bold: true, color: { argb: BW.black } };
        cell.alignment = { horizontal: "right" };
      }
    });
    subRow.getCell(5).numFmt = "$#,##0.00";
    ws.addRow([]);
  }

  // ── Grand Total — dark bg, white bold ──
  const totalRow = ws.addRow(["", "", "", "GRAND TOTAL", invoice.total]);
  totalRow.height = 20;
  totalRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BW.dark } };
    applyBorder(cell, "medium");
    if (Number(cell.col) >= 4) {
      cell.font = { bold: true, size: 12, color: { argb: BW.white } };
      cell.alignment = { horizontal: "right" };
    }
  });
  totalRow.getCell(5).numFmt = "$#,##0.00";

  if (invoice.notes) {
    ws.addRow([]);
    const notesRow = ws.addRow(["Notes", invoice.notes]);
    notesRow.getCell(1).font = { bold: true, color: { argb: BW.black } };
  }
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

/** Export a single invoice — one styled sheet */
async function exportInvoiceToExcel(invoice: BillingInvoice) {
  const wb = new ExcelJS.Workbook();
  const sheetName = (invoice.customerName || invoice.customer).slice(0, 31);
  fillInvoiceSheet(wb.addWorksheet(sheetName), invoice);
  await downloadWorkbook(wb, `Invoice_${invoice.customer}_${invoice.period}.xlsx`);
}

/** Export multiple invoices — styled Summary tab + one tab per customer */
async function exportAllToExcel(invoices: BillingInvoice[], period: string) {
  if (invoices.length === 0) return;
  const wb = new ExcelJS.Workbook();

  // ── Summary sheet ──
  const summaryWs = wb.addWorksheet("Summary");
  summaryWs.columns = [
    { width: 30 }, { width: 16 },
    ...BILLING_CATEGORIES.map(() => ({ width: 18 })),
    { width: 16 },
  ];

  // Title
  const titleRow = summaryWs.addRow([`BILLING SUMMARY — ${periodLabel(period)}`]);
  summaryWs.mergeCells(`A1:${String.fromCharCode(65 + 1 + BILLING_CATEGORIES.length)}1`);
  titleRow.height = 22;
  titleRow.getCell(1).font = { bold: true, size: 13, color: { argb: BW.white } };
  titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BW.dark } };
  titleRow.getCell(1).alignment = { vertical: "middle", indent: 1 };
  applyBorder(titleRow.getCell(1), "medium");

  const genRow = summaryWs.addRow(["Generated", new Date().toLocaleDateString("en-US")]);
  genRow.getCell(1).font = { bold: true, color: { argb: BW.black } };
  summaryWs.addRow([]);

  // Column headers — mid gray bg, white bold
  const hdrs = ["Customer", "Customer Code", ...BILLING_CATEGORIES, "TOTAL"];
  const hdrRow = summaryWs.addRow(hdrs);
  hdrRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: BW.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BW.mid } };
    cell.alignment = { horizontal: Number(cell.col) <= 2 ? "left" : "right" };
    applyBorder(cell, "medium");
  });

  // Data rows
  for (const inv of invoices) {
    const dataRow = summaryWs.addRow([
      inv.customerName || inv.customer,
      inv.customer,
      ...BILLING_CATEGORIES.map((c) => inv.subtotals?.[c] ?? 0),
      inv.total,
    ]);
    dataRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BW.white } };
      cell.font = { color: { argb: BW.black } };
      applyBorder(cell);
      if (Number(cell.col) > 2) {
        cell.numFmt = "$#,##0.00";
        cell.alignment = { horizontal: "right" };
      }
    });
  }

  // Totals row — dark bg, white bold
  const totRow = summaryWs.addRow([
    "TOTAL", "",
    ...BILLING_CATEGORIES.map((c) =>
      invoices.reduce((s, inv) => s + (inv.subtotals?.[c] ?? 0), 0)
    ),
    invoices.reduce((s, inv) => s + inv.total, 0),
  ]);
  totRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: BW.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BW.dark } };
    applyBorder(cell, "medium");
    if (Number(cell.col) > 2) {
      cell.numFmt = "$#,##0.00";
      cell.alignment = { horizontal: "right" };
    }
  });

  // ── One sheet per customer ──
  const usedNames = new Set<string>();
  for (const inv of invoices) {
    let name = (inv.customerName || inv.customer).slice(0, 28);
    if (usedNames.has(name)) name = `${name.slice(0, 24)}_${inv.customer.slice(-3)}`;
    usedNames.add(name);
    fillInvoiceSheet(wb.addWorksheet(name), inv);
  }

  await downloadWorkbook(wb, `Invoice_ALL_${period}.xlsx`);
}

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
    setShowNewForm(false);
    setFetchMsg("");
  }

  // ── open existing invoice ──
  function openInvoice(inv: BillingInvoice) {
    setEditing(JSON.parse(JSON.stringify(inv))); // deep clone
    setFetchMsg("");
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

  // ── shared: fetch WMS data for one customer/period → qty updates map ──
  async function fetchWmsQty(customer: string, period: string): Promise<Record<string, number>> {
    const [year, month] = period.split("-").map(Number);
    const startDate = `${period}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${period}-${String(lastDay).padStart(2, "0")}`;
    const updates: Record<string, number> = {};

    try {
      const j = await fetch("/api/wms/receiving/list", {
        method: "POST", headers,
        body: JSON.stringify({ page: 1, limit: 500, customerCode: customer, startDate, endDate }),
      }).then((r) => r.json());
      const list: Record<string, unknown>[] = j?.data?.list ?? j?.data ?? j?.list ?? [];
      if (Array.isArray(list)) {
        let cartons = 0;
        for (const ord of list) {
          const type = String(ord.inboundType ?? ord.receiveType ?? "").toLowerCase();
          if (!type.includes("container") && !type.includes("cont"))
            cartons += Number(ord.totalQty ?? ord.itemCount ?? 1);
        }
        if (cartons > 0) updates["inbound_carton"] = cartons;
      }
    } catch {}

    try {
      const j = await fetch("/api/wms/shipping/list", {
        method: "POST", headers,
        body: JSON.stringify({ page: 1, limit: 500, orderType: "B2B", customerCode: customer, startDate, endDate }),
      }).then((r) => r.json());
      const list: Record<string, unknown>[] = j?.data?.list ?? j?.data ?? j?.list ?? [];
      if (Array.isArray(list) && list.length > 0) {
        updates["b2b_order"] = list.length;
        const pieces = list.reduce((s, o) => s + Number(o.totalQty ?? o.orderQty ?? 0), 0);
        if (pieces > 0) updates["b2b_pick_piece"] = pieces;
      }
    } catch {}

    try {
      const j = await fetch("/api/wms/shipping/list", {
        method: "POST", headers,
        body: JSON.stringify({ page: 1, limit: 500, orderType: "B2C", customerCode: customer, startDate, endDate }),
      }).then((r) => r.json());
      const list: Record<string, unknown>[] = j?.data?.list ?? j?.data ?? j?.list ?? [];
      if (Array.isArray(list) && list.length > 0) {
        updates["b2c_order"] = list.length;
        const extraPicks = list.reduce((s, o) => s + Math.max(0, Number(o.totalQty ?? o.orderQty ?? 0) - 5), 0);
        if (extraPicks > 0) updates["b2c_pick_piece"] = extraPicks;
      }
    } catch {}

    try {
      const r = await fetch("/api/wms/returns/list", {
        method: "POST", headers,
        body: JSON.stringify({ page: 1, limit: 500, customerCode: customer, startDate, endDate }),
      });
      if (r.ok) {
        const j = await r.json();
        const list: Record<string, unknown>[] = j?.data?.list ?? j?.data ?? j?.list ?? [];
        if (Array.isArray(list) && list.length > 0) {
          updates["return_receiving"] = list.length;
          const pieces = list.reduce((s, o) => s + Number(o.totalQty ?? o.qty ?? 0), 0);
          if (pieces > 0) updates["return_restock"] = pieces;
        }
      }
    } catch {}

    return updates;
  }

  // ── auto-fetch for current editing invoice ──
  async function autoFetch() {
    if (!editing) return;
    setFetching(true);
    setFetchMsg("Fetching WMS data...");
    try {
      const updates = await fetchWmsQty(editing.customer, editing.period);
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
        const updates = await fetchWmsQty(c.code, period);
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

  // ── save invoice ──
  async function saveInvoice(status: "draft" | "final") {
    if (!editing) return;
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
      setEditing(null);
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
  const years = [2024, 2025, 2026, 2027].map(String);

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  if (editing) {
    return (
      <div className="p-8 max-w-6xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => setEditing(null)}
            className="text-slate-400 hover:text-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-900">
              {editing.customerName || editing.customer} — {periodLabel(editing.period)}
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
              onClick={() => exportInvoiceToExcel({ ...editing, total: currentTotal }).catch(console.error)}
              className="flex items-center gap-1.5 text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Download className="w-4 h-4" />
              Export Excel
            </button>
            {/* Save draft */}
            <button
              onClick={() => saveInvoice("draft")}
              disabled={saving}
              className="flex items-center gap-1.5 text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
              Save Draft
            </button>
            {/* Finalize */}
            <button
              onClick={() => saveInvoice("final")}
              disabled={saving}
              className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg px-3 py-2 font-medium transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              Finalize
            </button>
          </div>
        </div>

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
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Total</p>
              <p className="text-3xl font-bold text-slate-900 tabular-nums">{formatUSD(currentTotal)}</p>
            </div>
          </div>
        </div>
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
          <h2 className="text-sm font-semibold text-slate-900 mb-4">New Invoice</h2>
          <div className="flex flex-wrap gap-3 items-end">
            {/* Customer */}
            <div>
              <label className="text-xs text-slate-500 uppercase tracking-wide mb-1.5 block">Customer</label>
              {customers.length > 0 ? (
                <select
                  value={newCustomer}
                  onChange={(e) => {
                    setNewCustomer(e.target.value);
                    setNewCustomerName(customers.find((c) => c.code === e.target.value)?.name ?? "");
                    setAllExportMsg("");
                  }}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
                >
                  <option value="">— Select —</option>
                  <option value="__ALL__">★ All Customers</option>
                  {customers.map((c) => (
                    <option key={c.code} value={c.code}>{c.code} {c.name && `— ${c.name}`}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={newCustomer}
                  onChange={(e) => setNewCustomer(e.target.value)}
                  placeholder="e.g. STL001"
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
            </div>

            {/* Customer Name (manual if not from dropdown) */}
            {customers.length === 0 && (
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wide mb-1.5 block">Customer Name</label>
                <input
                  type="text"
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                  placeholder="e.g. STL Logistics"
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-44 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            {/* Year */}
            <div>
              <label className="text-xs text-slate-500 uppercase tracking-wide mb-1.5 block">Year</label>
              <select
                value={newYear}
                onChange={(e) => setNewYear(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            {/* Month */}
            <div>
              <label className="text-xs text-slate-500 uppercase tracking-wide mb-1.5 block">Month</label>
              <select
                value={newMonth}
                onChange={(e) => setNewMonth(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={String(i + 1).padStart(2, "0")}>{m}</option>
                ))}
              </select>
            </div>

            {/* Action button — changes based on All vs single */}
            {newCustomer === "__ALL__" ? (
              <button
                onClick={exportAllCustomers}
                disabled={allExporting || customers.length === 0}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {allExporting
                  ? <RefreshCw className="w-4 h-4 animate-spin" />
                  : <Download className="w-4 h-4" />}
                {allExporting ? "Exporting..." : "Export All Customers"}
              </button>
            ) : (
              <button
                onClick={createInvoice}
                disabled={!newCustomer}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <Receipt className="w-4 h-4" />
                Create
              </button>
            )}
            <button
              onClick={() => { setShowNewForm(false); setAllExportMsg(""); }}
              className="text-sm text-slate-400 hover:text-slate-600 px-3 py-2"
            >
              Cancel
            </button>
          </div>

          {/* All-customers export progress/result */}
          {allExportMsg && (
            <div className={`mt-3 flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm border ${
              allExportMsg.startsWith("✓")
                ? "bg-green-50 border-green-200 text-green-800"
                : allExportMsg.startsWith("Export failed")
                ? "bg-red-50 border-red-200 text-red-700"
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
              {invoices.map((inv) => (
                <tr
                  key={inv.id}
                  onClick={() => openInvoice(inv)}
                  className="border-b border-slate-100 last:border-0 hover:bg-blue-50 cursor-pointer transition-colors"
                >
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-slate-900">{inv.customerName || inv.customer}</p>
                    <p className="text-xs text-slate-400 font-mono">{inv.customer}</p>
                  </td>
                  <td className="px-5 py-3.5 text-slate-700">{periodLabel(inv.period)}</td>
                  <td className="px-5 py-3.5 text-right font-bold text-slate-900 tabular-nums">
                    {formatUSD(inv.total)}
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                      inv.status === "final"
                        ? "bg-green-100 text-green-700"
                        : "bg-amber-100 text-amber-700"
                    }`}>
                      {inv.status === "final" ? "Final" : "Draft"}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right text-slate-400 text-xs">
                    {new Date(inv.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                  <td className="px-5 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => exportInvoiceToExcel(inv).catch(console.error)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Export Excel"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => deleteInvoice(inv.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
