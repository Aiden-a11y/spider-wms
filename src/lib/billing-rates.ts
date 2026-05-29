/**
 * CTK Rate Table — Rate Offer 2/17/2026
 * Source: CTK Rate Offer for STL 2026-2-17.xlsx
 */

export const RATE_VERSION = "2026-02-17";

// ─── 1. Inbound Handling ─────────────────────────────────────────────────────

export type InboundRateKey =
  | "inbound_carton"
  | "inbound_pallet"
  | "inbound_20ft_palletized"
  | "inbound_40ft_palletized"
  | "inbound_40hc_palletized"
  | "inbound_20ft_floor"
  | "inbound_40ft_floor"
  | "inbound_40hc_floor"
  | "inbound_labor";

export const INBOUND_RATES: Record<
  InboundRateKey,
  { description: string; rate: number; unit: string; waived?: boolean }
> = {
  inbound_carton:          { description: "Standard Inbound — Carton",                       rate: 2,    unit: "per carton" },
  inbound_pallet:          { description: "Standard Inbound — Pallet (LTL/LCL)",             rate: 8,    unit: "per pallet" },
  inbound_20ft_palletized: { description: "Standard Inbound — 20' Container (Palletized)",   rate: 150,  unit: "per container" },
  inbound_40ft_palletized: { description: "Standard Inbound — 40' Container (Palletized)",   rate: 250,  unit: "per container" },
  inbound_40hc_palletized: { description: "Standard Inbound — 40' HC Container (Palletized)",rate: 300,  unit: "per container" },
  inbound_20ft_floor:      { description: "Standard Inbound — 20' Container (Floor Loaded)", rate: 350,  unit: "per container" },
  inbound_40ft_floor:      { description: "Standard Inbound — 40' Container (Floor Loaded)", rate: 450,  unit: "per container" },
  inbound_40hc_floor:      { description: "Standard Inbound — 40' HC Container (Floor Loaded)", rate: 500, unit: "per container" },
  inbound_labor:           { description: "Additional Labor (QC / Counting)",                rate: 35,   unit: "per person/hr" },
};

// ─── 2. Storage ───────────────────────────────────────────────────────────────

export type StorageRateKey =
  | "storage_bin"
  | "storage_shelf"
  | "storage_carton"
  | "storage_pallet_short"
  | "storage_pallet_regular"
  | "storage_pallet_tall"
  | "storage_open_floor";

export const STORAGE_RATES: Record<
  StorageRateKey,
  { description: string; rate: number; unit: string; peFactor: number }
> = {
  storage_bin:            { description: "Bin (8\"×30\"×12\" / 1.7 cuft)",           rate: 0.52,  unit: "per bin/month",     peFactor: 0.02096 },
  storage_shelf:          { description: "Shelf (12.75\"×42\"×22\" / 6.8 cuft)",     rate: 2.10,  unit: "per shelf/month",   peFactor: 0.08385 },
  storage_carton:         { description: "Carton (16\"×42\"×25.5\" / 9.9 cuft)",     rate: 3.05,  unit: "per carton/month",  peFactor: 0.12207 },
  storage_pallet_short:   { description: "Pallet Short (48\"×40\"×35.5\" / 39.4 cuft)", rate: 12.15, unit: "per pallet/month", peFactor: 0.48582 },
  storage_pallet_regular: { description: "Pallet Regular (48\"×40\"×73\" / 81.1 cuft)", rate: 25.00, unit: "per pallet/month", peFactor: 1.0 },
  storage_pallet_tall:    { description: "Pallet Tall (48\"×40\"×97\" / 107.8 cuft)",   rate: 33.23, unit: "per pallet/month", peFactor: 1.32922 },
  storage_open_floor:     { description: "Open Floor",                                  rate: 50.00, unit: "per spot/month",   peFactor: 2.0 },
};

// ─── 3. Fulfillment ───────────────────────────────────────────────────────────

export type FulfillmentRateKey =
  | "b2b_order"
  | "b2b_pick_piece"
  | "b2b_pick_carton"
  | "b2b_pick_pallet"
  | "b2b_carton_packing"
  | "b2b_palletizing"
  | "b2b_label"
  | "b2b_insert"
  | "b2c_order"
  | "b2c_pick_piece"
  | "b2c_fragile"
  | "fulfillment_insert"
  | "fulfillment_label";

export const FULFILLMENT_RATES: Record<
  FulfillmentRateKey,
  { description: string; rate: number; unit: string; note?: string }
> = {
  b2b_order:         { description: "B2B — Order Processing",                 rate: 4,    unit: "per order" },
  b2b_pick_piece:    { description: "B2B — Picking (Piece)",                  rate: 0.25, unit: "per piece" },
  b2b_pick_carton:   { description: "B2B — Picking (Full Carton)",            rate: 1.25, unit: "per carton",  note: "Entire carton picked unchanged" },
  b2b_pick_pallet:   { description: "B2B — Picking (Full Pallet)",            rate: 6.50, unit: "per pallet",  note: "Entire pallet picked unchanged" },
  b2b_carton_packing:{ description: "B2B — Carton Packing",                   rate: 1.25, unit: "per carton/bag" },
  b2b_palletizing:   { description: "B2B — Palletizing w/ Stretch Wrap",      rate: 12,   unit: "per pallet",  note: "Pallet cost charged separately" },
  b2b_label:         { description: "B2B — Label",                            rate: 0.20, unit: "per label" },
  b2b_insert:        { description: "B2B — Order Inserts",                    rate: 0.10, unit: "per insert" },
  b2c_order:         { description: "B2C — Order Processing",                 rate: 2,    unit: "per order",   note: "Flat rate up to 5 picks/order" },
  b2c_pick_piece:    { description: "B2C — Picking (Piece, after 5th pick)",  rate: 0.20, unit: "per pick",    note: "After 5 items per order" },
  b2c_fragile:       { description: "B2C — Fragile Pack",                     rate: 0.25, unit: "per item",    note: "Additional dunnage if applicable" },
  fulfillment_insert:{ description: "B2C — Order Inserts",                    rate: 0.10, unit: "per insert" },
  fulfillment_label: { description: "B2C — Label",                            rate: 0.20, unit: "per label/shipping unit" },
};

// ─── 4. Return Management ─────────────────────────────────────────────────────

export type ReturnRateKey =
  | "return_receiving"
  | "return_restock"
  | "return_disposal";

export const RETURN_RATES: Record<
  ReturnRateKey,
  { description: string; rate: number; unit: string; costPlus?: boolean }
> = {
  return_receiving: { description: "Return Receiving (incl. Inspection)", rate: 1.50, unit: "per order" },
  return_restock:   { description: "Return Restock",                      rate: 0.25, unit: "per piece" },
  return_disposal:  { description: "Disposal",                            rate: 0,    unit: "cost + 10%", costPlus: true },
};

// ─── 5. Warehouse Labor ───────────────────────────────────────────────────────

export type LaborRateKey =
  | "labor_regular"
  | "labor_ot_weekday"
  | "labor_ot_weekend";

export const LABOR_RATES: Record<
  LaborRateKey,
  { description: string; rate: number; unit: string }
> = {
  labor_regular:    { description: "Regular Time (General Labor)",          rate: 35,   unit: "per person/hr" },
  labor_ot_weekday: { description: "Weekday After-Hours (1.5× Overtime)",   rate: 52.5, unit: "per person/hr" },
  labor_ot_weekend: { description: "Weekend / Holiday (2× Overtime)",       rate: 70,   unit: "per person/hr" },
};

// ─── 6. Office Sublease ───────────────────────────────────────────────────────

export type SubleaseRateKey =
  | "sublease_rent"
  | "sublease_operating_cost";

export const SUBLEASE_RATES: Record<
  SubleaseRateKey,
  { description: string; rate: number; unit: string; defaultQty: number; note?: string }
> = {
  sublease_rent:            { description: "Monthly Office Rent (per MSA Section 3.2)",           rate: 1490,  unit: "per month",               defaultQty: 1 },
  sublease_operating_cost:  { description: "Operating Cost Reimbursement (per MSA Section 3.3)",  rate: 1.01,  unit: "per sq ft / month",        defaultQty: 1000 },
};

// ─── Category metadata ────────────────────────────────────────────────────────

export type BillingCategory =
  | "Inbound Handling"
  | "Storage"
  | "Fulfillment B2B"
  | "Fulfillment B2C"
  | "Return Management"
  | "Warehouse Labor"
  | "Office Sublease";

export const BILLING_CATEGORIES: BillingCategory[] = [
  "Inbound Handling",
  "Storage",
  "Fulfillment B2B",
  "Fulfillment B2C",
  "Return Management",
  "Warehouse Labor",
  "Office Sublease",
];
