"use client";

import { Fragment, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import * as XLSX from "xlsx";
import {
  Plus, Trash2, Pencil, Check, X, TrendingUp, TrendingDown,
  Users, Clock, DollarSign, ChevronLeft, ChevronRight, Loader2,
  Calculator, Upload, ChevronDown, ChevronUp, AlertCircle, LineChart, Receipt,
} from "lucide-react";
import {
  buildDefaultLineItems,
  type CustomerRateMaster,
} from "@/lib/billing-calc";
import type { BillingCategory } from "@/lib/billing-rates";
import { getInboundQty, getB2BQty, getB2CQty, getReturnQty, normDate } from "@/lib/daily-billing";

/* ─── types ─────────────────────────────────────────────────── */
interface Worker {
  id: string;
  work_date: string;
  worker_name: string;
  hours_worked: number;
  hourly_rate: number;
  notes: string | null;
  worker_type?: string | null;
  agency?: string | null;
  dept?: string | null;
  reg_hours?: number | null;
  ot1_hours?: number | null;
  ot2_hours?: number | null;
  markup_pct?: number | null;
  markup_amt?: number | null;
  bill_total?: number | null;
}
interface RevenueRow {
  work_date: string;
  revenue: number;
  notes: string | null;
  breakdown?: {
    byCategory: Record<string, number>;
    items: ItemAgg[];
    counts: Record<string, number>;
    customers?: CustomerBreakdown[];
    orderEdits?: Record<string, Record<string, number>>;
  } | null;
  source?: string | null;
  warehouse_code?: string | null;
}
interface ItemAgg {
  id: string; category: BillingCategory; description: string; unit: string; qty: number; amount: number;
}
interface OrderRow {
  orderCode: string;
  date: string;
  qty: number;
  lineQtys: Record<string, number>;
  amount: number;
}
interface CustomerBreakdown {
  code: string;
  name: string;
  total: number;
  byCategory: Record<string, number>;
  orders: { inbound: OrderRow[]; b2b: OrderRow[]; b2c: OrderRow[]; returns: OrderRow[] };
}

/* ─── helpers ────────────────────────────────────────────────── */
const fmt  = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toISO = (d: Date)  => d.toISOString().slice(0, 10);
const addDay = (iso: string, n: number) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return toISO(d);
};
const fmtDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

/** Normalize a percent cell to a whole number regardless of source formatting:
 *  literal text "30%" → 30; Excel percentage-format numeric fraction (30% → 0.3) → 30; plain "30" → 30. */
function normalizePct(v: unknown): number {
  if (typeof v === "string" && v.trim().endsWith("%")) {
    const n = parseFloat(v.trim().slice(0, -1));
    return isFinite(n) ? n : 0;
  }
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return n > 0 && n <= 1 ? n * 100 : n;
}

const CATEGORY_ORDER: BillingCategory[] = [
  "Inbound Handling", "Fulfillment B2B", "Fulfillment B2C", "Storage", "Return Management", "Warehouse Labor",
];
/** [card border, header bg+text] per category */
const CATEGORY_CARD: Record<string, { border: string; header: string; chip: string }> = {
  "Inbound Handling":  { border: "border-blue-200",    header: "bg-blue-50 text-blue-700",       chip: "bg-blue-50 text-blue-700 border-blue-200" },
  "Storage":           { border: "border-purple-200",  header: "bg-purple-50 text-purple-700",   chip: "bg-purple-50 text-purple-700 border-purple-200" },
  "Fulfillment B2B":   { border: "border-emerald-200",  header: "bg-emerald-50 text-emerald-700", chip: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  "Fulfillment B2C":   { border: "border-teal-200",     header: "bg-teal-50 text-teal-700",       chip: "bg-teal-50 text-teal-700 border-teal-200" },
  "Return Management": { border: "border-orange-200",   header: "bg-orange-50 text-orange-700",   chip: "bg-orange-50 text-orange-700 border-orange-200" },
  "Warehouse Labor":   { border: "border-red-200",      header: "bg-red-50 text-red-700",         chip: "bg-red-50 text-red-700 border-red-200" },
};

/* ─── empty form state ───────────────────────────────────────── */
const emptyForm = () => ({ worker_name: "", hours_worked: "8", hourly_rate: "17", notes: "" });

/* ─── per-category order-detail columns (invoice-style) ─────── */
type OrderCat = "inbound" | "b2b" | "b2c" | "returns";
const CATEGORY_COLUMNS: Record<OrderCat, { key: string; label: string }[]> = {
  inbound: [
    { key: "inbound_carton", label: "Carton" },
    { key: "inbound_pallet", label: "Pallet" },
  ],
  b2b: [
    { key: "b2b_order",          label: "Order Fee" },
    { key: "b2b_pick_piece",     label: "Pick/Piece" },
    { key: "b2b_pick_carton",    label: "Pick/Carton" },
    { key: "b2b_pick_pallet",    label: "Pick/Pallet" },
    { key: "b2b_carton_packing", label: "Packing" },
    { key: "b2b_palletizing",    label: "Palletize" },
    { key: "b2b_label",          label: "Label" },
    { key: "b2b_insert",         label: "Insert" },
  ],
  b2c: [
    { key: "b2c_order",         label: "Order Fee" },
    { key: "b2c_pick_piece",    label: "Extra Picks (>5)" },
    { key: "fulfillment_label", label: "Label" },
    { key: "b2c_fragile",       label: "Fragile" },
    { key: "fulfillment_insert",label: "Insert" },
  ],
  returns: [
    { key: "return_receiving", label: "Receiving" },
    { key: "return_restock",   label: "Restock" },
  ],
};

const CAT_TO_CATEGORY: Record<OrderCat, BillingCategory> = {
  inbound: "Inbound Handling",
  b2b: "Fulfillment B2B",
  b2c: "Fulfillment B2C",
  returns: "Return Management",
};
const CATEGORY_TO_CAT: Partial<Record<BillingCategory, OrderCat>> = {
  "Inbound Handling": "inbound",
  "Fulfillment B2B": "b2b",
  "Fulfillment B2C": "b2c",
  "Return Management": "returns",
};

/** Rate-table definitions (id → description/category/unit/rate/costPlus) — static, computed once. */
const RATE_ID_TO_DEF = new Map(buildDefaultLineItems().map((it) => [it.id, it]));

function applyRateGlobal(custCode: string, id: string, qty: number, rateMasters: Record<string, CustomerRateMaster>): number {
  const def = RATE_ID_TO_DEF.get(id);
  if (!def || qty === 0) return 0;
  if (def.costPlus) return qty * 1.1;
  const rate = rateMasters[custCode]?.rates?.[id] ?? def.rate;
  return qty * rate;
}

/** Recompute one customer's order amounts + category subtotals + total from its (possibly-edited) lineQtys. */
function recomputeCustomer(c: CustomerBreakdown, rateMasters: Record<string, CustomerRateMaster>): CustomerBreakdown {
  const byCategory: Record<string, number> = {};
  let total = 0;
  const orders = { inbound: [] as OrderRow[], b2b: [] as OrderRow[], b2c: [] as OrderRow[], returns: [] as OrderRow[] };
  (Object.keys(c.orders) as OrderCat[]).forEach((cat) => {
    orders[cat] = c.orders[cat].map((o) => {
      let amount = 0;
      for (const [id, q] of Object.entries(o.lineQtys)) amount += applyRateGlobal(c.code, id, q, rateMasters);
      return { ...o, amount };
    });
    const catAmt = orders[cat].reduce((s, o) => s + o.amount, 0);
    if (orders[cat].length > 0) byCategory[CAT_TO_CATEGORY[cat]] = catAmt;
    total += catAmt;
  });
  return { ...c, orders, byCategory, total };
}

/** Recompute the overall {items, byCategory, total} rollup from a customers array. */
function aggregateFromCustomers(customers: CustomerBreakdown[], rateMasters: Record<string, CustomerRateMaster>) {
  const itemAgg: Record<string, ItemAgg> = {};
  const byCategory: Record<string, number> = {};
  for (const c of customers) {
    for (const catOrders of Object.values(c.orders)) {
      for (const o of catOrders) {
        for (const [id, q] of Object.entries(o.lineQtys)) {
          const def = RATE_ID_TO_DEF.get(id);
          if (!def || q === 0) continue;
          const amt = applyRateGlobal(c.code, id, q, rateMasters);
          byCategory[def.category] = (byCategory[def.category] ?? 0) + amt;
          if (!itemAgg[id]) itemAgg[id] = { id, category: def.category, description: def.description, unit: def.unit, qty: 0, amount: 0 };
          itemAgg[id].qty += q;
          itemAgg[id].amount += amt;
        }
      }
    }
  }
  const items = Object.values(itemAgg).sort((a, b) => b.amount - a.amount);
  const total = Object.values(byCategory).reduce((s, v) => s + v, 0);
  return { items, byCategory, total };
}

type OrderEditFn = (custCode: string, cat: OrderCat, orderCode: string, itemId: string, newQty: number) => void;

function EditableQtyCell({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value || ""));
  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(String(value || "")); setEditing(true); }}
        className="w-full text-right font-mono text-slate-500 hover:bg-blue-50 hover:text-blue-700 rounded px-1 transition-colors"
        title="Click to correct"
      >
        {value || "—"}
      </button>
    );
  }
  const commit = () => {
    setEditing(false);
    const v = Math.max(0, Number(draft) || 0);
    if (v !== value) onCommit(v);
  };
  return (
    <input
      autoFocus
      type="number" min={0}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
      className="w-14 text-right font-mono text-xs border border-blue-400 rounded px-1 py-0.5 focus:outline-none"
    />
  );
}

function OrderDetailTable({ rows, cat, custCode, onEdit }: { rows: OrderRow[]; cat: OrderCat; custCode: string; onEdit: OrderEditFn }) {
  const cols = CATEGORY_COLUMNS[cat];
  return (
    <div className="overflow-auto max-h-72 border border-slate-100 rounded-lg">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-slate-50 z-10">
          <tr className="text-left text-slate-400 border-b border-slate-200">
            <th className="py-1.5 px-2 font-semibold">Order Code</th>
            <th className="py-1.5 px-2 font-semibold">Date</th>
            <th className="py-1.5 px-2 font-semibold text-right">Qty</th>
            {cols.map((c) => <th key={c.key} className="py-1.5 px-2 font-semibold text-right whitespace-nowrap">{c.label}</th>)}
            <th className="py-1.5 px-2 font-semibold text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.orderCode}_${i}`} className={`border-b border-slate-50 ${i % 2 === 1 ? "bg-slate-50/50" : ""}`}>
              <td className="py-1 px-2 font-mono text-slate-700 whitespace-nowrap">{r.orderCode}</td>
              <td className="py-1 px-2 text-slate-400 whitespace-nowrap">{r.date}</td>
              <td className="py-1 px-2 text-right font-mono text-slate-500">{r.qty || "—"}</td>
              {cols.map((c) => (
                <td key={c.key} className="py-1 px-1 text-right">
                  <EditableQtyCell
                    value={r.lineQtys[c.key] ?? 0}
                    onCommit={(v) => onEdit(custCode, cat, r.orderCode, c.key, v)}
                  />
                </td>
              ))}
              <td className="py-1 px-2 text-right font-mono font-semibold text-slate-800">${fmt(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── daily WMS revenue calculation — per order, per customer, invoice-style ─── */
async function calcDailyRevenue(
  date: string,
  warehouseCode: string,
  headers: Record<string, string>,
  rateMasters: Record<string, CustomerRateMaster>,
  orderEdits: Record<string, Record<string, number>>,
  onProgress?: (done: number, total: number) => void,
): Promise<{ items: ItemAgg[]; byCategory: Record<string, number>; counts: Record<string, number>; total: number; customers: CustomerBreakdown[] }> {
  const targetCompact = normDate(date);

  const custJson = await fetch(`/api/wms/combo/customer-by-warehouse/${encodeURIComponent(warehouseCode)}`, { headers })
    .then((r) => r.json()).catch(() => ({}));
  const customers: { code: string; name: string }[] = (Array.isArray(custJson?.data) ? custJson.data : [])
    .map((c: Record<string, unknown>) => ({ code: String(c.customerCode ?? c.code ?? ""), name: String(c.customerName ?? c.name ?? "") }))
    .filter((c: { code: string }) => c.code);

  const counts = { inbound: 0, b2b: 0, b2c: 0, returns: 0 };

  const custResults: CustomerBreakdown[] = [];
  let done = 0;

  for (const cust of customers) {
    const orders: CustomerBreakdown["orders"] = { inbound: [], b2b: [], b2c: [], returns: [] };
    const byCategory: Record<string, number> = {};
    let custTotal = 0;

    const addOrder = (cat: keyof typeof orders, category: BillingCategory, orderCode: string, orderDate: string, qty: number, computedQtys: Record<string, number>) => {
      const lineQtys = { ...computedQtys, ...(orderEdits[orderCode] ?? {}) };
      let amount = 0;
      for (const [id, q] of Object.entries(lineQtys)) amount += applyRateGlobal(cust.code, id, q, rateMasters);
      orders[cat].push({ orderCode, date: orderDate, qty, lineQtys, amount });
      byCategory[category] = (byCategory[category] ?? 0) + amount;
      custTotal += amount;
    };

    try {
      const j = await fetch("/api/wms/receiving/list", {
        method: "POST", headers,
        body: JSON.stringify({ page: 1, limit: 2000, customerCode: cust.code }),
      }).then((r) => r.json());
      const raw: Record<string, unknown>[] = j?.data?.list ?? j?.data ?? j?.list ?? [];
      const list = (Array.isArray(raw) ? raw : []).filter((o) => {
        const status = String(o.status ?? o.orderStatus ?? "");
        if (status && status !== "DA") return false;
        return normDate(o.inDate ?? o.receiveDate ?? o.orderDate ?? "") === targetCompact;
      });
      counts.inbound += list.length;
      for (const o of list) {
        const code = String(o.receiveOrderCode ?? o.orderCode ?? "");
        const d    = String(o.inDate ?? o.receiveDate ?? o.orderDate ?? "");
        const qty  = Number(o.totalQty ?? o.itemCount ?? 0);
        addOrder("inbound", "Inbound Handling", code, d, qty, getInboundQty(o));
      }
    } catch {}

    for (const [orderType, key, category] of [
      ["B2B", "b2b", "Fulfillment B2B"],
      ["B2C", "b2c", "Fulfillment B2C"],
    ] as const) {
      try {
        const rows: Record<string, unknown>[] = [];
        for (let page = 1; page <= 10; page++) {
          const j = await fetch("/api/wms/shipping/list", {
            method: "POST", headers,
            body: JSON.stringify({ page, limit: 500, pageSize: 500, orderType, customerCode: cust.code, warehouseCode }),
          }).then((r) => r.json()).catch(() => null);
          const r: Record<string, unknown>[] = j?.data?.list ?? j?.data ?? j?.list ?? [];
          if (!Array.isArray(r) || r.length === 0) break;
          rows.push(...r);
          if (r.length < 500) break;
        }
        const list = rows.filter((o) => {
          const status = String(o.status ?? o.orderStatus ?? "");
          if (status !== "FA") return false;
          return normDate(o.outDate ?? o.deliveryDate ?? o.shippingDate ?? o.outboundDate ?? "") === targetCompact;
        });
        counts[key] += list.length;
        for (const o of list) {
          const code = String(o.shippingOrderCode ?? o.orderCode ?? "");
          const d    = String(o.outDate ?? o.deliveryDate ?? o.shippingDate ?? o.outboundDate ?? "");
          const qty  = Number(o.totalQty ?? o.orderQty ?? 0);
          addOrder(key, category, code, d, qty, key === "b2b" ? getB2BQty(o) : getB2CQty(o));
        }
      } catch {}
    }

    try {
      const j = await fetch("/api/wms/returns/list", {
        method: "POST", headers,
        body: JSON.stringify({ page: 1, limit: 2000, customerCode: cust.code }),
      }).then((r) => r.json());
      const raw: Record<string, unknown>[] = j?.data?.list ?? j?.data ?? j?.list ?? [];
      const list = (Array.isArray(raw) ? raw : []).filter((o) =>
        normDate(o.returnDate ?? o.inDate ?? o.orderDate ?? "") === targetCompact
      );
      counts.returns += list.length;
      for (const o of list) {
        const code = String(o.returnOrderCode ?? o.orderCode ?? "");
        const d    = String(o.returnDate ?? o.inDate ?? o.orderDate ?? "");
        const qty  = Number(o.totalQty ?? o.qty ?? 0);
        addOrder("returns", "Return Management", code, d, qty, getReturnQty(o));
      }
    } catch {}

    const hasAny = Object.values(orders).some((a) => a.length > 0);
    if (hasAny) custResults.push({ code: cust.code, name: cust.name, total: custTotal, byCategory, orders });

    done++;
    onProgress?.(done, customers.length);
  }

  const agg = aggregateFromCustomers(custResults, rateMasters);
  custResults.sort((a, b) => b.total - a.total);

  return { items: agg.items, byCategory: agg.byCategory, counts, total: agg.total, customers: custResults };
}

export default function DailyInvoicePage() {
  const { user } = useAuth();
  const wmsHeaders = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  const [mainTab, setMainTab] = useState<"invoice" | "trends">("invoice");
  const [warehouseCode] = useState("STOO1");
  const [date,    setDate]    = useState(toISO(new Date()));
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [revenue, setRevenue] = useState<RevenueRow | null>(null);
  const [loading, setLoading] = useState(false);

  /* form state */
  const [showForm,  setShowForm]  = useState(false);
  const [editId,    setEditId]    = useState<string | null>(null);
  const [form,      setForm]      = useState(emptyForm());
  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState<string | null>(null);

  /* revenue edit (manual override) */
  const [revEdit,   setRevEdit]   = useState(false);
  const [revInput,  setRevInput]  = useState("");
  const [revSaving, setRevSaving] = useState(false);

  /* auto revenue calculation */
  const [calculating, setCalculating] = useState(false);
  const [calcProgress, setCalcProgress] = useState({ done: 0, total: 0 });
  const [calcError, setCalcError] = useState("");
  const [breakdownOpen, setBreakdownOpen] = useState(true);
  const [expandedCust, setExpandedCust] = useState<string | null>(null);
  const [expandedCustCat, setExpandedCustCat] = useState<OrderCat>("b2c");
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [rateMastersCache, setRateMastersCache] = useState<Record<string, CustomerRateMaster>>({});

  /* timecard upload */
  const [uploadingTimecard, setUploadingTimecard] = useState(false);
  const [timecardError, setTimecardError] = useState("");
  const [timecardFileDate, setTimecardFileDate] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* trends */
  const [trendFrom, setTrendFrom] = useState(() => addDay(toISO(new Date()), -29));
  const [trendTo, setTrendTo]     = useState(() => toISO(new Date()));
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendRows, setTrendRows] = useState<{ date: string; revenue: number; labor: number; profit: number }[]>([]);

  /* ─── load ─────────────────────────────────────────────────── */
  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/daily-labor?date=${date}`);
    const json = await res.json();
    setWorkers(json.workers ?? []);
    setRevenue(json.revenue ?? null);
    setRevInput(json.revenue?.revenue?.toString() ?? "");
    setLoading(false);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  /* ─── derived ───────────────────────────────────────────────── */
  const totalHours   = useMemo(() => workers.reduce((s, w) => s + Number(w.hours_worked), 0), [workers]);
  const totalLabor   = useMemo(
    () => workers.reduce((s, w) => s + (w.bill_total != null ? Number(w.bill_total) : Number(w.hours_worked) * Number(w.hourly_rate)), 0),
    [workers]
  );
  const rev          = revenue ? Number(revenue.revenue) : null;
  const profit        = rev !== null ? rev - totalLabor : null;
  const margin        = rev && rev > 0 ? (profit! / rev) * 100 : null;
  const breakdown     = revenue?.breakdown ?? null;

  /* ─── auto-calculate revenue from real WMS order activity ───── */
  async function runCalcRevenue() {
    setCalculating(true);
    setCalcError("");
    setCalcProgress({ done: 0, total: 0 });
    try {
      const masters: CustomerRateMaster[] = await fetch("/api/billing/rates").then((r) => r.json()).catch(() => []);
      const rateMasters: Record<string, CustomerRateMaster> = {};
      for (const m of Array.isArray(masters) ? masters : []) rateMasters[m.customerCode] = m;
      setRateMastersCache(rateMasters);

      const existingEdits = revenue?.breakdown?.orderEdits ?? {};
      const result = await calcDailyRevenue(date, warehouseCode, wmsHeaders, rateMasters, existingEdits, (done, total) => setCalcProgress({ done, total }));

      const breakdownPayload = {
        byCategory: result.byCategory,
        items: result.items,
        counts: result.counts,
        customers: result.customers,
        orderEdits: existingEdits,
      };

      await fetch("/api/daily-labor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "revenue",
          work_date: date,
          revenue: result.total,
          breakdown: breakdownPayload,
          source: "auto",
          warehouse_code: warehouseCode,
        }),
      });
      await load();
    } catch (e) {
      setCalcError(e instanceof Error ? e.message : "계산 실패");
    } finally {
      setCalculating(false);
    }
  }

  /* ─── correct a single order's line-item qty (persists + recomputes locally, no WMS re-fetch) ─── */
  function handleOrderEdit(custCode: string, cat: OrderCat, orderCode: string, itemId: string, newQty: number) {
    if (!revenue?.breakdown?.customers) return;
    const customers = revenue.breakdown.customers;
    const idx = customers.findIndex((c) => c.code === custCode);
    if (idx === -1) return;

    const cust = customers[idx];
    const updatedOrders = {
      ...cust.orders,
      [cat]: cust.orders[cat].map((o) =>
        o.orderCode === orderCode ? { ...o, lineQtys: { ...o.lineQtys, [itemId]: newQty } } : o
      ),
    };
    const updatedCust = recomputeCustomer({ ...cust, orders: updatedOrders }, rateMastersCache);
    const updatedCustomers = customers.map((c, i) => (i === idx ? updatedCust : c));

    const agg = aggregateFromCustomers(updatedCustomers, rateMastersCache);
    const newOrderEdits = {
      ...(revenue.breakdown.orderEdits ?? {}),
      [orderCode]: { ...(revenue.breakdown.orderEdits?.[orderCode] ?? {}), [itemId]: newQty },
    };
    const newBreakdown = {
      byCategory: agg.byCategory,
      items: agg.items,
      counts: revenue.breakdown.counts,
      customers: updatedCustomers,
      orderEdits: newOrderEdits,
    };
    const newRevenue: RevenueRow = { ...revenue, revenue: agg.total, breakdown: newBreakdown };
    setRevenue(newRevenue);

    fetch("/api/daily-labor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "revenue",
        work_date: date,
        revenue: agg.total,
        breakdown: newBreakdown,
        source: "auto",
        warehouse_code: warehouseCode,
      }),
    }).catch(() => {});
  }

  /* ─── save worker (manual) ────────────────────────────────────── */
  async function saveWorker() {
    if (!form.worker_name.trim()) return;
    setSaving(true);
    await fetch("/api/daily-labor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id:           editId ?? undefined,
        work_date:    date,
        worker_name:  form.worker_name.trim(),
        hours_worked: parseFloat(form.hours_worked) || 0,
        hourly_rate:  parseFloat(form.hourly_rate)  || 0,
        notes:        form.notes.trim() || null,
      }),
    });
    setSaving(false);
    setShowForm(false);
    setEditId(null);
    setForm(emptyForm());
    load();
  }

  /* ─── delete worker ──────────────────────────────────────────── */
  async function deleteWorker(id: string) {
    setDeleting(id);
    await fetch(`/api/daily-labor?id=${id}`, { method: "DELETE" });
    setDeleting(null);
    load();
  }

  /* ─── save revenue (manual override) ─────────────────────────── */
  async function saveRevenue() {
    setRevSaving(true);
    await fetch("/api/daily-labor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "revenue", work_date: date, revenue: parseFloat(revInput) || 0, source: "manual" }),
    });
    setRevSaving(false);
    setRevEdit(false);
    load();
  }

  /* ─── start edit ─────────────────────────────────────────────── */
  function startEdit(w: Worker) {
    setEditId(w.id);
    setForm({ worker_name: w.worker_name, hours_worked: String(w.hours_worked), hourly_rate: String(w.hourly_rate), notes: w.notes ?? "" });
    setShowForm(true);
  }

  /* ─── timecard xlsx upload ────────────────────────────────────── */
  async function handleTimecardFile(file: File) {
    setUploadingTimecard(true);
    setTimecardError("");
    setTimecardFileDate(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

      // detect the file's own date line (for a mismatch warning only)
      for (const row of rows) {
        const first = String(row[0] ?? "").trim();
        if (first.toLowerCase().startsWith("date:")) {
          const m = first.match(/(\d{4}-\d{2}-\d{2})/);
          if (m) setTimecardFileDate(m[1]);
          break;
        }
      }

      let headerIdx = -1;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].some((c) => String(c).trim().toLowerCase() === "worker")) { headerIdx = i; break; }
      }
      if (headerIdx === -1) throw new Error("헤더 행을 찾을 수 없습니다 (\"Worker\" 컬럼 필요)");

      const header = rows[headerIdx].map((c) => String(c).trim().toLowerCase());
      const idx = (needle: string) => header.findIndex((h) => h.includes(needle));
      const iWorker = idx("worker");
      const iOrg    = idx("org") >= 0 ? idx("org") : idx("agency");
      const iDept   = idx("dept");
      const iReg    = idx("reg");
      const iOt1    = idx("ot1");
      const iOt2    = idx("ot2");
      const iTotal  = header.findIndex((h) => h.includes("total hr"));
      const iRate   = idx("pay rate") >= 0 ? idx("pay rate") : idx("rate");
      const iMkPct  = header.findIndex((h) => h.includes("markup") && h.includes("%"));
      const iMkAmt  = header.findIndex((h) => h.includes("markup") && h.includes("amt"));
      const iBill   = header.findIndex((h) => h.includes("bill"));
      const iType   = idx("type");

      if (iWorker < 0) throw new Error("Worker 컬럼을 찾을 수 없습니다");

      const parsed: Record<string, unknown>[] = [];
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        const name = String(row[iWorker] ?? "").trim();
        if (!name) break;
        parsed.push({
          worker_name: name,
          agency:      iOrg  >= 0 ? (String(row[iOrg]  ?? "").trim() || null) : null,
          dept:        iDept >= 0 ? (String(row[iDept] ?? "").trim() || null) : null,
          reg_hours:   iReg  >= 0 ? Number(row[iReg])  || 0 : null,
          ot1_hours:   iOt1  >= 0 ? Number(row[iOt1])  || 0 : null,
          ot2_hours:   iOt2  >= 0 ? Number(row[iOt2])  || 0 : null,
          total_hours: iTotal >= 0 ? Number(row[iTotal]) || 0 : 0,
          pay_rate:    iRate >= 0 ? Number(row[iRate]) || 0 : 0,
          markup_pct:  iMkPct >= 0 ? normalizePct(row[iMkPct]) : null,
          markup_amt:  iMkAmt >= 0 ? Number(row[iMkAmt]) || 0 : null,
          bill_total:  iBill  >= 0 ? Number(row[iBill])  || 0 : null,
          worker_type: iType  >= 0 ? (String(row[iType] ?? "").trim() || null) : null,
        });
      }
      if (parsed.length === 0) throw new Error("파싱된 작업자가 없습니다");

      await fetch("/api/daily-labor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "timecard_bulk", work_date: date, workers: parsed }),
      });
      await load();
    } catch (e) {
      setTimecardError(e instanceof Error ? e.message : "업로드 실패");
    } finally {
      setUploadingTimecard(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  /* ─── trends: load history range ───────────────────────────── */
  const loadTrends = useCallback(async () => {
    setTrendLoading(true);
    try {
      const res = await fetch(`/api/daily-labor?from=${trendFrom}&to=${trendTo}`);
      const json = await res.json();
      const revenues: RevenueRow[] = json.revenues ?? [];
      const laborByDate: Record<string, number> = json.laborByDate ?? {};

      const dateSet = new Set<string>([...revenues.map((r) => r.work_date), ...Object.keys(laborByDate)]);
      const rows = Array.from(dateSet).sort().map((d) => {
        const revRow = revenues.find((r) => r.work_date === d);
        const rv = revRow ? Number(revRow.revenue) : 0;
        const lb = laborByDate[d] ?? 0;
        return { date: d, revenue: rv, labor: lb, profit: rv - lb };
      });
      setTrendRows(rows);
    } catch {
      setTrendRows([]);
    } finally {
      setTrendLoading(false);
    }
  }, [trendFrom, trendTo]);

  useEffect(() => { if (mainTab === "trends") loadTrends(); }, [mainTab, loadTrends]);

  const trendMaxAbs = useMemo(
    () => Math.max(1, ...trendRows.map((r) => Math.max(Math.abs(r.revenue), Math.abs(r.labor), Math.abs(r.profit)))),
    [trendRows]
  );
  const trendTotals = useMemo(() => {
    const revenue = trendRows.reduce((s, r) => s + r.revenue, 0);
    const labor   = trendRows.reduce((s, r) => s + r.labor, 0);
    return { revenue, labor, profit: revenue - labor, avgProfit: trendRows.length ? (revenue - labor) / trendRows.length : 0 };
  }, [trendRows]);

  /* ─── UI ─────────────────────────────────────────────────────── */
  return (
    <div className="p-8 max-w-[1600px] mx-auto">

      {/* ── Tabs ── */}
      <div className="flex items-center gap-2 mb-6">
        <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden text-sm font-medium">
          <button onClick={() => setMainTab("invoice")}
            className={`flex items-center gap-1.5 px-4 py-2 transition-colors ${mainTab === "invoice" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
            <Receipt className="w-3.5 h-3.5" /> Invoice
          </button>
          <button onClick={() => setMainTab("trends")}
            className={`flex items-center gap-1.5 px-4 py-2 transition-colors ${mainTab === "trends" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
            <LineChart className="w-3.5 h-3.5" /> Trends
          </button>
        </div>
      </div>

      {mainTab === "invoice" && (
      <>
      {/* ── Date nav ── */}
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => setDate(d => addDay(d, -1))} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500">
          <ChevronLeft className="w-4 h-4"/>
        </button>
        <div>
          <h1 className="text-xl font-bold text-slate-900">{fmtDate(date)}</h1>
          <p className="text-sm text-slate-400">Daily Invoice · {warehouseCode}</p>
        </div>
        <button onClick={() => setDate(d => addDay(d, 1))} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500">
          <ChevronRight className="w-4 h-4"/>
        </button>
        <input
          type="date" value={date} onChange={e => setDate(e.target.value)}
          className="ml-2 px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <button onClick={() => setDate(toISO(new Date()))} className="text-xs text-blue-600 hover:underline">Today</button>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400 ml-auto"/>}
      </div>

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
              <Receipt className="w-4 h-4 text-blue-600"/>
            </div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Revenue</p>
          </div>
          <p className="text-3xl font-black text-slate-900">{rev !== null ? `$${fmt(rev)}` : "—"}</p>
          <p className="text-xs text-slate-400 mt-1">
            {revenue?.source === "auto" ? "auto from WMS" : revenue?.source === "manual" ? "manual entry" : "not set"}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-violet-50 rounded-lg flex items-center justify-center">
              <Clock className="w-4 h-4 text-violet-600"/>
            </div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Total Hours</p>
          </div>
          <p className="text-3xl font-black text-slate-900">{totalHours.toFixed(1)}</p>
          <p className="text-xs text-slate-400 mt-1">{workers.length} worker{workers.length !== 1 ? "s" : ""}</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-orange-50 rounded-lg flex items-center justify-center">
              <DollarSign className="w-4 h-4 text-orange-600"/>
            </div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Labor Cost</p>
          </div>
          <p className="text-3xl font-black text-slate-900">${fmt(totalLabor)}</p>
          <p className="text-xs text-slate-400 mt-1">total payroll</p>
        </div>

        <div className={`rounded-xl border p-5 ${
          profit === null ? "bg-white border-slate-200" :
          profit >= 0    ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
        }`}>
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              profit === null ? "bg-slate-100" : profit >= 0 ? "bg-green-100" : "bg-red-100"
            }`}>
              {profit === null
                ? <DollarSign className="w-4 h-4 text-slate-400"/>
                : profit >= 0
                  ? <TrendingUp className="w-4 h-4 text-green-600"/>
                  : <TrendingDown className="w-4 h-4 text-red-600"/>
              }
            </div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Profit / Loss</p>
          </div>
          {profit !== null ? (
            <>
              <p className={`text-3xl font-black ${profit >= 0 ? "text-green-700" : "text-red-700"}`}>
                {profit >= 0 ? "+" : ""}${fmt(profit)}
              </p>
              <p className={`text-xs mt-1 font-medium ${profit >= 0 ? "text-green-600" : "text-red-600"}`}>
                {margin !== null ? `${margin.toFixed(1)}% margin` : ""}
              </p>
            </>
          ) : (
            <>
              <p className="text-3xl font-black text-slate-300">—</p>
              <p className="text-xs text-slate-400 mt-1">calculate revenue below</p>
            </>
          )}
        </div>
      </div>

      {/* ── Revenue section ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm font-semibold text-slate-700">Revenue</p>
          <button
            onClick={runCalcRevenue}
            disabled={calculating}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-500 disabled:opacity-50"
          >
            {calculating ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Calculator className="w-3.5 h-3.5"/>}
            {calculating ? `Calculating${calcProgress.total ? ` (${calcProgress.done}/${calcProgress.total})` : "…"}` : "Calculate from WMS"}
          </button>

          {!revEdit ? (
            <button onClick={() => setRevEdit(true)} className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-600">
              <Pencil className="w-3 h-3"/> Override manually
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-slate-500 font-medium text-sm">$</span>
              <input
                type="number" step="0.01" min="0"
                value={revInput} onChange={e => setRevInput(e.target.value)}
                onKeyDown={e => { if (e.key==="Enter") saveRevenue(); if (e.key==="Escape") setRevEdit(false); }}
                autoFocus
                className="w-36 px-3 py-1.5 text-sm border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="0.00"
              />
              <button onClick={saveRevenue} disabled={revSaving} className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-500">
                {revSaving ? <Loader2 className="w-3 h-3 animate-spin"/> : <Check className="w-3 h-3"/>} Save
              </button>
              <button onClick={() => { setRevEdit(false); setRevInput(revenue?.revenue?.toString() ?? ""); }} className="p-1.5 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4"/>
              </button>
            </div>
          )}

        </div>

        {calcError && (
          <div className="mt-3 flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0"/> {calcError}
          </div>
        )}

        {/* Breakdown */}
        {breakdown && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <button onClick={() => setBreakdownOpen(v => !v)} className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase tracking-wide hover:text-slate-700">
              {breakdownOpen ? <ChevronUp className="w-3.5 h-3.5"/> : <ChevronDown className="w-3.5 h-3.5"/>}
              Breakdown
            </button>
            {breakdownOpen && (
              <div className="mt-3 space-y-3">
                {/* order counts */}
                {breakdown.counts && (
                  <p className="text-xs text-slate-400">
                    Inbound {breakdown.counts.inbound ?? 0} · B2B {breakdown.counts.b2b ?? 0} · B2C {breakdown.counts.b2c ?? 0} · Returns {breakdown.counts.returns ?? 0}
                  </p>
                )}

                {/* line items — grouped into one section per category */}
                {breakdown.items && breakdown.items.length > 0 && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {CATEGORY_ORDER
                      .filter((cat) => breakdown.items.some((it: ItemAgg) => it.category === cat))
                      .map((cat) => {
                        const catItems = breakdown.items.filter((it: ItemAgg) => it.category === cat);
                        const catTotal = catItems.reduce((s, it) => s + it.amount, 0);
                        const card = CATEGORY_CARD[cat] ?? { border: "border-slate-200", header: "bg-slate-50 text-slate-600" };
                        return (
                          <div key={cat} className={`rounded-xl border overflow-hidden ${card.border}`}>
                            <div className={`flex items-center justify-between px-3 py-2 border-b ${card.border} ${card.header}`}>
                              <span className="text-xs font-bold uppercase tracking-wide">{cat}</span>
                              <span className="text-xs font-mono font-black">${fmt(catTotal)}</span>
                            </div>
                            <table className="w-full text-xs bg-white">
                              <tbody>
                                {catItems.map((it) => {
                                  const itemCat = CATEGORY_TO_CAT[it.category];
                                  const isItemOpen = expandedItemId === it.id;
                                  const contributingOrders = itemCat && breakdown.customers
                                    ? breakdown.customers.flatMap((c) =>
                                        c.orders[itemCat]
                                          .filter((o) => (o.lineQtys[it.id] ?? 0) > 0)
                                          .map((o) => ({ cust: c, order: o }))
                                      )
                                    : [];
                                  return (
                                    <Fragment key={it.id}>
                                      <tr
                                        className={`border-b border-slate-50 last:border-0 ${itemCat ? "cursor-pointer hover:bg-slate-50" : ""}`}
                                        onClick={() => itemCat && setExpandedItemId(isItemOpen ? null : it.id)}
                                      >
                                        <td className="py-1.5 px-3 text-slate-600">
                                          <span className="flex items-center gap-1">
                                            {itemCat && (isItemOpen
                                              ? <ChevronUp className="w-3 h-3 text-slate-300 flex-shrink-0" />
                                              : <ChevronDown className="w-3 h-3 text-slate-300 flex-shrink-0" />)}
                                            {it.description}
                                          </span>
                                        </td>
                                        <td className="py-1.5 px-3 text-right font-mono text-slate-400 whitespace-nowrap">{it.qty.toLocaleString()}</td>
                                        <td className="py-1.5 px-3 text-right font-mono font-semibold text-slate-800 whitespace-nowrap">${fmt(it.amount)}</td>
                                      </tr>
                                      {isItemOpen && itemCat && (
                                        <tr>
                                          <td colSpan={3} className="p-2 bg-slate-50/60">
                                            <div className="overflow-auto max-h-56 border border-slate-100 rounded-lg bg-white">
                                              <table className="w-full text-xs">
                                                <thead className="sticky top-0 bg-slate-50">
                                                  <tr className="text-left text-slate-400 border-b border-slate-200">
                                                    <th className="py-1 px-2 font-semibold">Customer</th>
                                                    <th className="py-1 px-2 font-semibold">Order Code</th>
                                                    <th className="py-1 px-2 font-semibold text-right">Qty</th>
                                                    <th className="py-1 px-2 font-semibold text-right">Amount</th>
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {contributingOrders.map(({ cust, order }) => (
                                                    <tr key={`${cust.code}_${order.orderCode}`} className="border-b border-slate-50 last:border-0">
                                                      <td className="py-1 px-2 font-mono text-slate-500 whitespace-nowrap">{cust.code}</td>
                                                      <td className="py-1 px-2 font-mono text-slate-700 whitespace-nowrap">{order.orderCode}</td>
                                                      <td className="py-1 px-1 text-right">
                                                        <EditableQtyCell
                                                          value={order.lineQtys[it.id] ?? 0}
                                                          onCommit={(v) => handleOrderEdit(cust.code, itemCat, order.orderCode, it.id, v)}
                                                        />
                                                      </td>
                                                      <td className="py-1 px-2 text-right font-mono text-slate-600 whitespace-nowrap">${fmt(order.amount)}</td>
                                                    </tr>
                                                  ))}
                                                  {contributingOrders.length === 0 && (
                                                    <tr><td colSpan={4} className="py-2 px-2 text-center text-slate-300">No contributing orders</td></tr>
                                                  )}
                                                </tbody>
                                              </table>
                                            </div>
                                          </td>
                                        </tr>
                                      )}
                                    </Fragment>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        );
                      })}
                  </div>
                )}

                {/* by customer — invoice-style, expandable per-order detail */}
                {breakdown.customers && breakdown.customers.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">By Customer</p>
                    <div className="border border-slate-100 rounded-lg overflow-hidden">
                      {breakdown.customers.map((c) => {
                        const isOpen = expandedCust === c.code;
                        const catTabs = (["inbound", "b2b", "b2c", "returns"] as OrderCat[])
                          .filter((k) => c.orders[k].length > 0);
                        const activeCat = catTabs.includes(expandedCustCat) ? expandedCustCat : catTabs[0];
                        return (
                          <div key={c.code} className="border-b border-slate-100 last:border-0">
                            <button
                              onClick={() => setExpandedCust(isOpen ? null : c.code)}
                              className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 transition-colors gap-3"
                            >
                              <span className="flex items-center gap-2 text-xs flex-shrink-0">
                                {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-slate-400"/> : <ChevronDown className="w-3.5 h-3.5 text-slate-400"/>}
                                <span className="font-semibold text-slate-700">{c.name || c.code}</span>
                                <span className="font-mono text-slate-400">{c.code}</span>
                              </span>
                              <span className="flex-1 flex items-center gap-1.5 flex-wrap justify-end">
                                {CATEGORY_ORDER.filter((cat) => c.byCategory[cat]).map((cat) => (
                                  <span key={cat} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${CATEGORY_CARD[cat]?.chip ?? "bg-slate-50 text-slate-500 border-slate-200"}`}>
                                    {cat.replace("Fulfillment ", "").replace(" Handling", "").replace(" Management", "")}: ${fmt(c.byCategory[cat])}
                                  </span>
                                ))}
                              </span>
                              <span className="font-mono font-bold text-slate-800 text-xs flex-shrink-0">${fmt(c.total)}</span>
                            </button>
                            {isOpen && (
                              <div className="px-3 pb-3 space-y-2">
                                <div className="flex gap-1.5 flex-wrap">
                                  {catTabs.map((k) => (
                                    <button
                                      key={k}
                                      onClick={() => setExpandedCustCat(k)}
                                      className={`text-[11px] px-2 py-1 rounded-md font-semibold transition-colors capitalize ${
                                        activeCat === k ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                                      }`}
                                    >
                                      {k} ({c.orders[k].length})
                                    </button>
                                  ))}
                                </div>
                                {activeCat && <OrderDetailTable rows={c.orders[activeCat]} cat={activeCat} custCode={c.code} onEdit={handleOrderEdit} />}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Timecard upload ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm font-semibold text-slate-700">Timecard</p>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleTimecardFile(f); }} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingTimecard}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-semibold hover:bg-slate-700 disabled:opacity-50"
          >
            {uploadingTimecard ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Upload className="w-3.5 h-3.5"/>}
            Upload Timecard (.xlsx)
          </button>
          <span className="text-xs text-slate-400">Replaces workers for {date} with parsed Bill Total per person</span>
        </div>
        {timecardError && (
          <div className="mt-3 flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0"/> {timecardError}
          </div>
        )}
        {timecardFileDate && timecardFileDate !== date && (
          <div className="mt-3 flex items-center gap-2 text-amber-600 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0"/>
            File says {timecardFileDate}, but you're viewing {date} — data was still saved to {date}.
          </div>
        )}
      </div>

      {/* ── Worker table ── */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">Workers</h2>
          <button
            onClick={() => { setEditId(null); setForm(emptyForm()); setShowForm(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-500 transition-colors"
          >
            <Plus className="w-3.5 h-3.5"/> Add Worker
          </button>
        </div>

        {workers.length === 0 && !showForm ? (
          <div className="py-16 text-center">
            <Users className="w-8 h-8 text-slate-200 mx-auto mb-3"/>
            <p className="text-slate-400 text-sm">No workers recorded for this day.</p>
            <p className="text-xs text-slate-300 mt-1">Upload a timecard, or add manually.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                <th className="text-left px-6 py-3 font-semibold whitespace-nowrap">Worker</th>
                <th className="text-left px-3 py-3 font-semibold whitespace-nowrap">Type</th>
                <th className="text-left px-3 py-3 font-semibold whitespace-nowrap">Org Unit / Agency</th>
                <th className="text-left px-3 py-3 font-semibold whitespace-nowrap">Dept</th>
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">Reg Hrs</th>
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">OT1</th>
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">OT2</th>
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">Total Hrs</th>
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">Pay Rate</th>
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">Markup %</th>
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">Markup Amt</th>
                <th className="text-right px-4 py-3 font-semibold whitespace-nowrap">Bill Total</th>
                <th className="px-4 py-3"/>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {workers.map(w => {
                const billTotal = w.bill_total != null ? Number(w.bill_total) : Number(w.hours_worked) * Number(w.hourly_rate);
                const markupAmt = w.markup_amt != null ? Number(w.markup_amt) : null;
                const isCtk = (w.worker_type ?? "").toLowerCase().includes("ctk");
                return (
                  <tr key={w.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3 font-medium text-slate-800 whitespace-nowrap">{w.worker_name}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {w.worker_type
                        ? <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold ${isCtk ? "bg-blue-50 text-blue-600" : "bg-amber-50 text-amber-600"}`}>{w.worker_type}</span>
                        : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500 whitespace-nowrap">{w.agency ?? "—"}</td>
                    <td className="px-3 py-3 text-xs text-slate-500 whitespace-nowrap">{w.dept ?? "—"}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-slate-600">{w.reg_hours != null ? Number(w.reg_hours).toFixed(2) : "—"}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-slate-600">{w.ot1_hours != null ? Number(w.ot1_hours).toFixed(2) : "—"}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-slate-600">{w.ot2_hours != null ? Number(w.ot2_hours).toFixed(2) : "—"}</td>
                    <td className="px-3 py-3 text-right font-mono text-slate-700">{Number(w.hours_worked).toFixed(2)}</td>
                    <td className="px-3 py-3 text-right font-mono text-slate-700">${Number(w.hourly_rate).toFixed(2)}</td>
                    <td className="px-3 py-3 text-right font-mono text-slate-500">{w.markup_pct != null ? `${Number(w.markup_pct).toFixed(1)}%` : "—"}</td>
                    <td className="px-3 py-3 text-right font-mono text-slate-500">{markupAmt != null ? `$${fmt(markupAmt)}` : "—"}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">${fmt(billTotal)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => startEdit(w)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                          <Pencil className="w-3.5 h-3.5"/>
                        </button>
                        <button onClick={() => deleteWorker(w.id)} disabled={deleting===w.id} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          {deleting===w.id ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Trash2 className="w-3.5 h-3.5"/>}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {workers.length > 0 && (
                <tr className="bg-slate-50 font-semibold text-slate-700 border-t-2 border-slate-200">
                  <td className="px-6 py-3 text-sm" colSpan={4}>Total ({workers.length} workers)</td>
                  <td className="px-3 py-3 text-right font-mono text-xs">{workers.reduce((s,w)=>s+(Number(w.reg_hours)||0),0).toFixed(2)}</td>
                  <td className="px-3 py-3 text-right font-mono text-xs">{workers.reduce((s,w)=>s+(Number(w.ot1_hours)||0),0).toFixed(2)}</td>
                  <td className="px-3 py-3 text-right font-mono text-xs">{workers.reduce((s,w)=>s+(Number(w.ot2_hours)||0),0).toFixed(2)}</td>
                  <td className="px-3 py-3 text-right font-mono">{totalHours.toFixed(2)}</td>
                  <td colSpan={2}/>
                  <td className="px-3 py-3 text-right font-mono">${fmt(workers.reduce((s,w)=>s+(Number(w.markup_amt)||0),0))}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">${fmt(totalLabor)}</td>
                  <td/>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        )}

        {showForm && (
          <div className="border-t border-slate-200 bg-blue-50 px-6 py-4">
            <p className="text-sm font-semibold text-slate-700 mb-3">{editId ? "Edit Worker" : "Add Worker"}</p>
            <div className="flex items-end gap-3 flex-wrap">
              <div className="flex-1 min-w-40">
                <label className="text-xs text-slate-500 font-medium mb-1 block">Name *</label>
                <input
                  type="text" placeholder="Worker name"
                  value={form.worker_name} onChange={e => setForm(f => ({ ...f, worker_name: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
                />
              </div>
              <div className="w-28">
                <label className="text-xs text-slate-500 font-medium mb-1 block">Hours</label>
                <input
                  type="number" step="0.5" min="0" max="24"
                  value={form.hours_worked} onChange={e => setForm(f => ({ ...f, hours_worked: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
                />
              </div>
              <div className="w-32">
                <label className="text-xs text-slate-500 font-medium mb-1 block">Rate / hr ($)</label>
                <input
                  type="number" step="0.01" min="0"
                  value={form.hourly_rate} onChange={e => setForm(f => ({ ...f, hourly_rate: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
                />
              </div>
              <div className="flex-1 min-w-32">
                <label className="text-xs text-slate-500 font-medium mb-1 block">Notes</label>
                <input
                  type="text" placeholder="Optional"
                  value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
                />
              </div>
              <div className="flex items-center gap-2 pb-0.5">
                <div className="text-right text-xs text-slate-400 mr-1">
                  Pay: <span className="font-bold text-slate-700">${fmt((parseFloat(form.hours_worked)||0)*(parseFloat(form.hourly_rate)||0))}</span>
                </div>
                <button
                  onClick={saveWorker} disabled={saving || !form.worker_name.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-500 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Check className="w-3.5 h-3.5"/>}
                  {editId ? "Update" : "Add"}
                </button>
                <button
                  onClick={() => { setShowForm(false); setEditId(null); setForm(emptyForm()); }}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg"
                >
                  <X className="w-4 h-4"/>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── SQL hint (only shown if no data ever) ── */}
      {workers.length === 0 && (
        <details className="mt-6">
          <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">Supabase setup — run once</summary>
          <pre className="mt-2 text-xs bg-slate-900 text-green-400 rounded-xl p-4 overflow-x-auto">{`ALTER TABLE daily_revenue ADD COLUMN IF NOT EXISTS breakdown JSONB;
ALTER TABLE daily_revenue ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
ALTER TABLE daily_revenue ADD COLUMN IF NOT EXISTS warehouse_code TEXT;

ALTER TABLE daily_labor ADD COLUMN IF NOT EXISTS worker_type TEXT;
ALTER TABLE daily_labor ADD COLUMN IF NOT EXISTS agency TEXT;
ALTER TABLE daily_labor ADD COLUMN IF NOT EXISTS dept TEXT;
ALTER TABLE daily_labor ADD COLUMN IF NOT EXISTS reg_hours NUMERIC(6,2);
ALTER TABLE daily_labor ADD COLUMN IF NOT EXISTS ot1_hours NUMERIC(6,2);
ALTER TABLE daily_labor ADD COLUMN IF NOT EXISTS ot2_hours NUMERIC(6,2);
ALTER TABLE daily_labor ADD COLUMN IF NOT EXISTS markup_pct NUMERIC(6,2);
ALTER TABLE daily_labor ADD COLUMN IF NOT EXISTS markup_amt NUMERIC(10,2);
ALTER TABLE daily_labor ADD COLUMN IF NOT EXISTS bill_total NUMERIC(10,2);`}</pre>
        </details>
      )}
      </>
      )}

      {/* ══════════════════════════ TRENDS TAB ══════════════════════════ */}
      {mainTab === "trends" && (
        <div>
          <div className="flex items-center gap-3 mb-6 flex-wrap">
            <h1 className="text-xl font-bold text-slate-900 mr-2">Daily P&amp;L Trends</h1>
            <input type="date" value={trendFrom} onChange={e => setTrendFrom(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200" />
            <span className="text-slate-400 text-sm">to</span>
            <input type="date" value={trendTo} onChange={e => setTrendTo(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200" />
            {[7, 30, 90].map((days) => (
              <button key={days} onClick={() => { setTrendFrom(addDay(toISO(new Date()), -(days-1))); setTrendTo(toISO(new Date())); }}
                className="text-xs px-2.5 py-1 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-100">
                {days}d
              </button>
            ))}
            {trendLoading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
          </div>

          {/* summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Total Revenue</p>
              <p className="text-2xl font-black text-slate-900">${fmt(trendTotals.revenue)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Total Labor</p>
              <p className="text-2xl font-black text-slate-900">${fmt(trendTotals.labor)}</p>
            </div>
            <div className={`rounded-xl border p-5 ${trendTotals.profit >= 0 ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Total Profit</p>
              <p className={`text-2xl font-black ${trendTotals.profit >= 0 ? "text-green-700" : "text-red-700"}`}>
                {trendTotals.profit >= 0 ? "+" : ""}${fmt(trendTotals.profit)}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Avg Daily Profit</p>
              <p className="text-2xl font-black text-slate-900">${fmt(trendTotals.avgProfit)}</p>
            </div>
          </div>

          {/* chart */}
          {trendRows.length === 0 && !trendLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-2 text-slate-300 bg-white border border-slate-200 rounded-2xl">
              <LineChart className="w-8 h-8" />
              <p className="text-sm text-slate-400">No data in this range</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
              <div className="flex items-center gap-4 mb-4 text-xs font-medium">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block"/> Revenue</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-orange-400 inline-block"/> Labor</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"/> Profit</span>
              </div>
              <div className="overflow-x-auto">
                <div className="flex items-end gap-1.5 h-48 min-w-full" style={{ width: Math.max(trendRows.length * 28, 100) }}>
                  {trendRows.map((r) => {
                    const revH = (Math.abs(r.revenue) / trendMaxAbs) * 100;
                    const labH = (Math.abs(r.labor) / trendMaxAbs) * 100;
                    const proH = (Math.abs(r.profit) / trendMaxAbs) * 100;
                    return (
                      <div key={r.date} className="flex flex-col items-center gap-0.5 flex-shrink-0" style={{ width: 24 }}
                        title={`${r.date}\nRevenue: $${fmt(r.revenue)}\nLabor: $${fmt(r.labor)}\nProfit: $${fmt(r.profit)}`}>
                        <div className="flex items-end gap-0.5 h-40 w-full justify-center">
                          <div className="w-1.5 bg-blue-400 rounded-t" style={{ height: `${revH}%` }} />
                          <div className="w-1.5 bg-orange-400 rounded-t" style={{ height: `${labH}%` }} />
                          <div className={`w-1.5 rounded-t ${r.profit >= 0 ? "bg-emerald-500" : "bg-red-500"}`} style={{ height: `${proH}%` }} />
                        </div>
                        <span className="text-[9px] text-slate-300 rotate-0">{r.date.slice(5)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* table */}
          {trendRows.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                    <th className="text-left px-6 py-3 font-semibold">Date</th>
                    <th className="text-right px-4 py-3 font-semibold">Revenue</th>
                    <th className="text-right px-4 py-3 font-semibold">Labor</th>
                    <th className="text-right px-6 py-3 font-semibold">Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...trendRows].reverse().map((r) => (
                    <tr key={r.date} className="hover:bg-slate-50">
                      <td className="px-6 py-2.5 font-medium text-slate-700">{r.date}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-700">${fmt(r.revenue)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-700">${fmt(r.labor)}</td>
                      <td className={`px-6 py-2.5 text-right font-mono font-semibold ${r.profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {r.profit >= 0 ? "+" : ""}${fmt(r.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
