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
import * as XLSX from "xlsx";
import {
  buildNewInvoice,
  buildDefaultLineItems,
  calcLineAmount,
  calcSubtotals,
  calcTotal,
  formatUSD,
  type BillingInvoice,
  type BillingLineItem,
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

// ─── Excel export ─────────────────────────────────────────────────────────────

function exportInvoiceToExcel(invoice: BillingInvoice) {
  const wb = XLSX.utils.book_new();
  const rows: unknown[][] = [];

  rows.push([`INVOICE — ${invoice.customerName || invoice.customer}`]);
  rows.push([`Period: ${periodLabel(invoice.period)}`]);
  rows.push([`Customer: ${invoice.customer}`]);
  rows.push([`Rate Version: ${invoice.rateVersion}`]);
  rows.push([`Generated: ${new Date().toLocaleDateString("en-US")}`]);
  rows.push([]);

  for (const cat of BILLING_CATEGORIES) {
    const catItems = invoice.lineItems.filter((l) => l.category === cat && (l.qty > 0 || l.costPlus));
    if (catItems.length === 0) continue;

    rows.push([cat.toUpperCase()]);
    rows.push(["Description", "Qty", "Unit", "Rate", "Amount"]);
    for (const item of catItems) {
      const amt = calcLineAmount(item);
      rows.push([
        item.description,
        item.qty,
        item.unit,
        item.costPlus ? "cost + 10%" : item.rate,
        amt,
      ]);
    }
    const sub = catItems.reduce((s, i) => s + calcLineAmount(i), 0);
    rows.push(["", "", "", "Subtotal", sub]);
    rows.push([]);
  }

  rows.push(["", "", "", "TOTAL", invoice.total]);
  if (invoice.notes) {
    rows.push([]);
    rows.push(["Notes:", invoice.notes]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 55 }, { wch: 10 }, { wch: 28 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, "Invoice");
  XLSX.writeFile(wb, `Invoice_${invoice.customer}_${invoice.period}.xlsx`);
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

  // ── create new invoice ──
  function createInvoice() {
    const period = `${newYear}-${newMonth}`;
    const name = customers.find((c) => c.code === newCustomer)?.name ?? newCustomerName;
    const inv = buildNewInvoice(newCustomer, name, period);
    setEditing(inv);
    setShowNewForm(false);
    setFetchMsg("");
  }

  // ── open existing invoice ──
  function openInvoice(inv: BillingInvoice) {
    setEditing(JSON.parse(JSON.stringify(inv))); // deep clone
    setFetchMsg("");
  }

  // ── update qty in editor ──
  const updateQty = useCallback((id: string, raw: string) => {
    const qty = raw === "" ? 0 : parseFloat(raw);
    setEditing((prev) => {
      if (!prev) return prev;
      const items = prev.lineItems.map((item) =>
        item.id === id ? { ...item, qty: isNaN(qty) ? 0 : qty } : item
      );
      const subtotals = calcSubtotals(items);
      const total = calcTotal(items);
      return { ...prev, lineItems: items, subtotals, total };
    });
  }, []);

  // ── auto-fetch usage data from WMS API ──
  async function autoFetch() {
    if (!editing) return;
    setFetching(true);
    setFetchMsg("Fetching WMS data…");

    const { customer, period } = editing;
    const [year, month] = period.split("-").map(Number);
    const startDate = `${period}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${period}-${String(lastDay).padStart(2, "0")}`;

    const updates: Record<string, number> = {};

    try {
      // ── Inbound: count receiving orders ──
      const inboundRes = await fetch("/api/wms/receiving/list", {
        method: "POST",
        headers,
        body: JSON.stringify({
          page: 1, limit: 500,
          customerCode: customer,
          startDate, endDate,
        }),
      });
      const inboundJson = await inboundRes.json();
      const inboundList: Record<string, unknown>[] = (
        inboundJson?.data?.list ?? inboundJson?.data ?? inboundJson?.list ?? []
      );
      if (Array.isArray(inboundList)) {
        // Count cartons vs pallets vs containers by parsing orderType / remarks
        // For now: total order count maps to carton (most common inbound)
        // Users can adjust other container types manually
        let cartons = 0;
        for (const ord of inboundList) {
          const type = String(ord.inboundType ?? ord.receiveType ?? "").toLowerCase();
          if (type.includes("container") || type.includes("cont")) {
            // leave for manual input — too many subtypes
          } else {
            cartons += Number(ord.totalQty ?? ord.itemCount ?? 1);
          }
        }
        if (cartons > 0) updates["inbound_carton"] = cartons;
      }

      // ── Fulfillment B2B ──
      const b2bRes = await fetch("/api/wms/shipping/list", {
        method: "POST",
        headers,
        body: JSON.stringify({
          page: 1, limit: 500,
          orderType: "B2B",
          customerCode: customer,
          startDate, endDate,
        }),
      });
      const b2bJson = await b2bRes.json();
      const b2bList: Record<string, unknown>[] = (
        b2bJson?.data?.list ?? b2bJson?.data ?? b2bJson?.list ?? []
      );
      if (Array.isArray(b2bList) && b2bList.length > 0) {
        updates["b2b_order"] = b2bList.length;
        const totalPieces = b2bList.reduce(
          (s, o) => s + Number(o.totalQty ?? o.orderQty ?? 0), 0
        );
        if (totalPieces > 0) updates["b2b_pick_piece"] = totalPieces;
      }

      // ── Fulfillment B2C ──
      const b2cRes = await fetch("/api/wms/shipping/list", {
        method: "POST",
        headers,
        body: JSON.stringify({
          page: 1, limit: 500,
          orderType: "B2C",
          customerCode: customer,
          startDate, endDate,
        }),
      });
      const b2cJson = await b2cRes.json();
      const b2cList: Record<string, unknown>[] = (
        b2cJson?.data?.list ?? b2cJson?.data ?? b2cJson?.list ?? []
      );
      if (Array.isArray(b2cList) && b2cList.length > 0) {
        updates["b2c_order"] = b2cList.length;
        const totalPicks = b2cList.reduce(
          (s, o) => s + Number(o.totalQty ?? o.orderQty ?? 0), 0
        );
        // Picks after 5th per order
        const extraPicks = b2cList.reduce((s, o) => {
          const qty = Number(o.totalQty ?? o.orderQty ?? 0);
          return s + Math.max(0, qty - 5);
        }, 0);
        if (totalPicks > 0) updates["b2c_pick_piece"] = extraPicks;
      }

      // ── Returns ──
      const retRes = await fetch("/api/wms/returns/list", {
        method: "POST",
        headers,
        body: JSON.stringify({
          page: 1, limit: 500,
          customerCode: customer,
          startDate, endDate,
        }),
      }).catch(() => null);
      if (retRes?.ok) {
        const retJson = await retRes.json();
        const retList: Record<string, unknown>[] = (
          retJson?.data?.list ?? retJson?.data ?? retJson?.list ?? []
        );
        if (Array.isArray(retList) && retList.length > 0) {
          updates["return_receiving"] = retList.length;
          const restockPieces = retList.reduce(
            (s, o) => s + Number(o.totalQty ?? o.qty ?? 0), 0
          );
          if (restockPieces > 0) updates["return_restock"] = restockPieces;
        }
      }

      const updatedCount = Object.keys(updates).length;
      setFetchMsg(
        updatedCount > 0
          ? `✓ ${updatedCount} fields auto-filled from WMS data. Verify and adjust as needed.`
          : "No matching data found in WMS for this period. Enter quantities manually."
      );

      if (updatedCount > 0) {
        setEditing((prev) => {
          if (!prev) return prev;
          const items = prev.lineItems.map((item) =>
            updates[item.id] !== undefined
              ? { ...item, qty: updates[item.id], autoFetched: true }
              : item
          );
          const subtotals = calcSubtotals(items);
          const total = calcTotal(items);
          return { ...prev, lineItems: items, subtotals, total };
        });
      }
    } catch (e) {
      setFetchMsg("Failed to fetch WMS data. Enter quantities manually.");
      console.error(e);
    } finally {
      setFetching(false);
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
              onClick={() => exportInvoiceToExcel({ ...editing, total: currentTotal })}
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
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Description</th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide w-28">Qty</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Unit</th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide w-24">Rate</th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide w-28">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {catItems.map((item) => {
                          const amt = calcLineAmount(item);
                          const dimmed = item.qty === 0;
                          return (
                            <tr
                              key={item.id}
                              className={`border-b border-slate-50 last:border-0 transition-colors ${
                                dimmed ? "opacity-40" : ""
                              }`}
                            >
                              <td className="px-4 py-2.5 text-slate-700">
                                <div className="flex items-center gap-2">
                                  {item.description}
                                  {item.autoFetched && item.qty > 0 && (
                                    <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium">
                                      auto
                                    </span>
                                  )}
                                  {item.note && (
                                    <span className="text-xs text-slate-400">({item.note})</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  value={item.qty === 0 ? "" : item.qty}
                                  onChange={(e) => updateQty(item.id, e.target.value)}
                                  placeholder="0"
                                  className="w-24 text-right border border-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                />
                              </td>
                              <td className="px-4 py-2.5 text-slate-500 text-xs">{item.unit}</td>
                              <td className="px-4 py-2.5 text-right text-slate-600 tabular-nums">
                                {item.costPlus ? "cost+10%" : `$${item.rate.toFixed(2)}`}
                              </td>
                              <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${
                                amt > 0 ? "text-slate-900" : "text-slate-300"
                              }`}>
                                {amt > 0 ? formatUSD(amt) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {catTotal > 0 && (
                        <tfoot>
                          <tr className="bg-slate-50 border-t border-slate-200">
                            <td colSpan={4} className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                              Subtotal
                            </td>
                            <td className="px-4 py-2.5 text-right font-bold text-slate-900 tabular-nums">
                              {formatUSD(catTotal)}
                            </td>
                          </tr>
                        </tfoot>
                      )}
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
        <button
          onClick={() => setShowNewForm(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Invoice
        </button>
      </div>

      {/* New invoice form */}
      {showNewForm && (
        <div className="bg-white border border-blue-200 rounded-xl p-5 mb-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">New Invoice</h2>
          <div className="flex flex-wrap gap-3 items-end">
            {/* Customer */}
            <div>
              <label className="text-xs text-slate-500 uppercase tracking-wide mb-1.5 block">Customer Code</label>
              {customers.length > 0 ? (
                <select
                  value={newCustomer}
                  onChange={(e) => {
                    setNewCustomer(e.target.value);
                    setNewCustomerName(customers.find((c) => c.code === e.target.value)?.name ?? "");
                  }}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-52"
                >
                  <option value="">— Select —</option>
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

            <button
              onClick={createInvoice}
              disabled={!newCustomer}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <Receipt className="w-4 h-4" />
              Create
            </button>
            <button
              onClick={() => setShowNewForm(false)}
              className="text-sm text-slate-400 hover:text-slate-600 px-3 py-2"
            >
              Cancel
            </button>
          </div>
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
                        onClick={() => exportInvoiceToExcel(inv)}
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
