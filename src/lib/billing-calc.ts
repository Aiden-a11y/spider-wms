import type { BillingCategory } from "./billing-rates";

// ─── Core types ───────────────────────────────────────────────────────────────

export type BillingLineItem = {
  id: string;
  category: BillingCategory;
  description: string;
  qty: number;
  unit: string;
  rate: number;
  /** true = rate is "cost + 10%" (disposal), qty = actual cost */
  costPlus?: boolean;
  /** Qty was populated from WMS API auto-fetch */
  autoFetched?: boolean;
  note?: string;
};

export type BillingInvoice = {
  id: string;
  customer: string;
  customerName: string;
  period: string;          // "YYYY-MM"
  lineItems: BillingLineItem[];
  subtotals: Record<BillingCategory, number>;
  total: number;
  status: "draft" | "final";
  notes: string;
  rateVersion: string;
  createdAt: string;
  updatedAt: string;
  groupId?: string;        // shared ID for combined invoices created together
  orderEdits?: Record<string, Record<string, number>>; // per-order qty overrides (inbound carton, B2B picks, etc.)
};

// ─── Calculation ──────────────────────────────────────────────────────────────

export function calcLineAmount(item: BillingLineItem): number {
  if (item.costPlus) {
    // Disposal: qty is the actual cost; charge is cost × 1.10
    return item.qty * 1.1;
  }
  return item.qty * item.rate;
}

export function calcSubtotals(
  items: BillingLineItem[]
): Record<BillingCategory, number> {
  const sub: Partial<Record<BillingCategory, number>> = {};
  for (const item of items) {
    sub[item.category] = (sub[item.category] ?? 0) + calcLineAmount(item);
  }
  return sub as Record<BillingCategory, number>;
}

export function calcTotal(items: BillingLineItem[]): number {
  return items.reduce((s, item) => s + calcLineAmount(item), 0);
}

// ─── Rate Master ──────────────────────────────────────────────────────────────

export type CustomerRateMaster = {
  customerCode: string;
  customerName: string;
  rates: Record<string, number>; // item.id → custom rate value
  updatedAt: string;
};

/** 기본 lineItems에 rate master 값을 덮어씌웁니다 (costPlus 항목 제외). */
export function applyRateMaster(
  items: BillingLineItem[],
  rates: Record<string, number>
): BillingLineItem[] {
  return items.map((item) =>
    !item.costPlus && rates[item.id] !== undefined
      ? { ...item, rate: rates[item.id] }
      : item
  );
}

export function formatUSD(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

// ─── Default line items (all at qty=0) ───────────────────────────────────────

import {
  INBOUND_RATES,
  STORAGE_RATES,
  FULFILLMENT_RATES,
  RETURN_RATES,
  LABOR_RATES,
  RATE_VERSION,
} from "./billing-rates";

export function buildDefaultLineItems(): BillingLineItem[] {
  const items: BillingLineItem[] = [];

  // 1. Inbound
  for (const [id, r] of Object.entries(INBOUND_RATES)) {
    items.push({
      id,
      category: "Inbound Handling",
      description: r.description,
      qty: 0,
      unit: r.unit,
      rate: r.rate,
    });
  }

  // 2. Storage
  for (const [id, r] of Object.entries(STORAGE_RATES)) {
    items.push({
      id,
      category: "Storage",
      description: r.description,
      qty: 0,
      unit: r.unit,
      rate: r.rate,
    });
  }

  // 3. Fulfillment — B2B
  const b2bKeys = [
    "b2b_order", "b2b_pick_piece", "b2b_pick_carton",
    "b2b_pick_pallet", "b2b_carton_packing", "b2b_palletizing",
    "b2b_label", "b2b_insert",
  ] as const;
  for (const id of b2bKeys) {
    const r = FULFILLMENT_RATES[id];
    items.push({
      id,
      category: "Fulfillment B2B",
      description: r.description,
      qty: 0,
      unit: r.unit,
      rate: r.rate,
      note: r.note,
    });
  }

  // 4. Fulfillment — B2C
  const b2cKeys = [
    "b2c_order", "b2c_pick_piece", "b2c_fragile",
    "fulfillment_insert", "fulfillment_label",
  ] as const;
  for (const id of b2cKeys) {
    const r = FULFILLMENT_RATES[id];
    items.push({
      id,
      category: "Fulfillment B2C",
      description: r.description,
      qty: 0,
      unit: r.unit,
      rate: r.rate,
      note: r.note,
    });
  }

  // 5. Returns
  for (const [id, r] of Object.entries(RETURN_RATES)) {
    items.push({
      id,
      category: "Return Management",
      description: r.description,
      qty: 0,
      unit: r.unit,
      rate: r.rate,
      costPlus: r.costPlus,
    });
  }

  // 6. Labor
  for (const [id, r] of Object.entries(LABOR_RATES)) {
    items.push({
      id,
      category: "Warehouse Labor",
      description: r.description,
      qty: 0,
      unit: r.unit,
      rate: r.rate,
    });
  }

  return items;
}

export function buildNewInvoice(
  customer: string,
  customerName: string,
  period: string
): BillingInvoice {
  const items = buildDefaultLineItems();
  const subtotals = calcSubtotals(items);
  return {
    id: `${period}_${customer}`,
    customer,
    customerName,
    period,
    lineItems: items,
    subtotals,
    total: 0,
    status: "draft",
    notes: "",
    rateVersion: RATE_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
