// Single-day revenue calculation — mirrors the per-order qty logic used by the
// monthly invoice builder (billing/page.tsx), but scoped to one calendar day
// instead of a whole period, and aggregated across ALL customers at once.

export function parseTaskComment(comment: string): Record<string, number> {
  const result: Record<string, number> = {};
  if (!comment) return result;
  const parts = comment.split(" | ");
  const taskPart = parts[parts.length - 1];
  const re = /([^,]+?)×(\d+(?:\.\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(taskPart)) !== null) {
    const type = match[1].trim();
    const qty = parseFloat(match[2]);
    if (type && !isNaN(qty)) result[type] = (result[type] ?? 0) + qty;
  }
  return result;
}

function parseReceivingComment(comment: string): { pallets: number; cartons: number } | null {
  if (!comment.includes("RECEIVING INFO")) return null;
  const putAway  = comment.match(/Pallets Put Away:\s*(\d+)\s*PLT\s*\/\s*(\d+)\s*CTN/i);
  const received = comment.match(/Pallets Received:\s*(\d+)\s*PLT\s*\/\s*(\d+)\s*CTN/i);
  const m = putAway ?? received;
  if (!m) return null;
  return { pallets: Number(m[1]), cartons: Number(m[2]) };
}

export function getInboundQty(order: Record<string, unknown>): Record<string, number> {
  const parsed = parseReceivingComment(String(order.comment ?? ""));
  if (parsed && (parsed.pallets > 0 || parsed.cartons > 0)) {
    const r: Record<string, number> = {};
    if (parsed.pallets > 0) r.inbound_pallet = parsed.pallets;
    if (parsed.cartons > 0) r.inbound_carton = parsed.cartons;
    return r;
  }
  const type = String(order.inboundType ?? order.receiveType ?? "").toLowerCase();
  const isContainer = /container|cont/i.test(type);
  if (!isContainer) {
    const v = order.cartonQty ?? order.boxQty ?? order.packageQty ?? order.cartonCount;
    return { inbound_carton: v != null ? Number(v) : 1 };
  }
  const is40hc = /40.*hc|hc.*40|40hc/i.test(type);
  const is40   = /\b40\b/.test(type) && !is40hc;
  const is20   = /\b20\b/.test(type);
  const isFloor = /floor/i.test(type);
  if (is20)   return { [isFloor ? "inbound_20ft_floor" : "inbound_20ft_palletized"]: 1 };
  if (is40hc) return { [isFloor ? "inbound_40hc_floor" : "inbound_40hc_palletized"]: 1 };
  if (is40)   return { [isFloor ? "inbound_40ft_floor" : "inbound_40ft_palletized"]: 1 };
  return { inbound_carton: 1 };
}

export function getB2BQty(order: Record<string, unknown>): Record<string, number> {
  const tasks = parseTaskComment(String(order.comment ?? ""));
  const pp  = tasks["Picking per Piece"]  ?? 0;
  const pc  = tasks["Picking per Carton"] ?? 0;
  const ppl = tasks["Picking per Pallet"] ?? 0;
  const oc  = tasks["Out per Carton"] ?? 0;
  const op  = tasks["Out per Pallet"] ?? 0;
  const supplies = tasks["Supplies"] ?? 0;
  const packing  = (oc > 0 && oc !== pc) ? supplies : 0;
  const labels   = (tasks["Labels"] ?? 0) + (tasks["Amazon Labels"] ?? 0) + (tasks["FBA Labeling"] ?? 0);
  const inserts  = tasks["Inserts"] ?? 0;
  const r: Record<string, number> = { b2b_order: 1 };
  if (pp > 0) r.b2b_pick_piece = pp;
  if (pc > 0) r.b2b_pick_carton = pc;
  if (ppl > 0) r.b2b_pick_pallet = ppl;
  if (packing > 0) r.b2b_carton_packing = packing;
  if (op > 0) r.b2b_palletizing = op;
  if (labels > 0) r.b2b_label = labels;
  if (inserts > 0) r.b2b_insert = inserts;
  return r;
}

export function getB2CQty(order: Record<string, unknown>): Record<string, number> {
  const tasks = parseTaskComment(String(order.comment ?? ""));
  const qty = Number(order.totalQty ?? order.orderQty ?? 0);
  const extra = Math.max(0, qty - 5);
  const label = Math.max(1, (tasks["Labels"] ?? 0) + (tasks["Amazon Labels"] ?? 0) + (tasks["FBA Labeling"] ?? 0));
  const fragile = (tasks["Fragile Pack"] ?? 0) + (tasks["Fragile"] ?? 0);
  const insert = tasks["Inserts"] ?? 0;
  const r: Record<string, number> = { b2c_order: 1, fulfillment_label: label };
  if (extra > 0) r.b2c_pick_piece = extra;
  if (fragile > 0) r.b2c_fragile = fragile;
  if (insert > 0) r.fulfillment_insert = insert;
  return r;
}

export function getReturnQty(order: Record<string, unknown>): Record<string, number> {
  const qty = Number(order.totalQty ?? order.qty ?? order.skuQty ?? 0);
  const r: Record<string, number> = { return_receiving: 1 };
  if (qty > 0) r.return_restock = qty;
  return r;
}

export function mergeQty(maps: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of maps) for (const [k, v] of Object.entries(m)) out[k] = (out[k] ?? 0) + v;
  return out;
}

/** Normalize a date-ish string to YYYYMMDD for comparison (strips dashes). */
export function normDate(d: unknown): string {
  return String(d ?? "").replace(/-/g, "");
}

// ─── Storage type resolution (same mapping used by the monthly invoice's WMS History import) ───

export const STORAGE_LABEL_MAP: Record<string, string> = {
  "bin": "storage_bin",
  "shelf": "storage_shelf",
  "carton": "storage_carton",
  "pallet short": "storage_pallet_short",
  "pallet regular": "storage_pallet_regular",
  "pallet tall": "storage_pallet_tall",
  "open floor": "storage_open_floor",
  "re bin": "storage_bin",
  "re shelf": "storage_shelf",
  "re carton": "storage_carton",
  "re pallet short": "storage_pallet_short",
  "re pallet regular": "storage_pallet_regular",
  "re pallet tall": "storage_pallet_tall",
  "re open floor": "storage_open_floor",
  "re-bin": "storage_bin",
  "re-shelf": "storage_shelf",
  "re-carton": "storage_carton",
  "re-pallet short": "storage_pallet_short",
  "re-pallet regular": "storage_pallet_regular",
  "re-pallet tall": "storage_pallet_tall",
  "rebin": "storage_bin",
  "reshelf": "storage_shelf",
  "recarton": "storage_carton",
};

/**
 * Resolve an occupancyInfo/locationType string to a billing storage key.
 * Tries exact match first, then strips common prefixes (re, rtrn, ret, rtn)
 * so "Re Bin" / "RE-BIN" / "Return Shelf" all map correctly.
 */
export function resolveStorageKey(rawType: string): string | undefined {
  const t = rawType.trim().toLowerCase();
  if (STORAGE_LABEL_MAP[t]) return STORAGE_LABEL_MAP[t];
  const stripped1 = t.replace(/^(re(turn)?|rtrn|ret|rtn)[-\s]*/i, "").trim();
  if (stripped1 && STORAGE_LABEL_MAP[stripped1]) return STORAGE_LABEL_MAP[stripped1];
  const stripped2 = t.replace(/^(picking|storage|reserve|pick|stow|stowing)[-\s]*/i, "").trim();
  if (stripped2 && STORAGE_LABEL_MAP[stripped2]) return STORAGE_LABEL_MAP[stripped2];
  const stripped3 = stripped1.replace(/^(picking|storage|reserve|pick|stow|stowing)[-\s]*/i, "").trim();
  if (stripped3 && STORAGE_LABEL_MAP[stripped3]) return STORAGE_LABEL_MAP[stripped3];
  return undefined;
}

export const STORAGE_TEMPLATE_ROWS: { key: string; label: string }[] = [
  { key: "storage_bin",            label: "Bin" },
  { key: "storage_shelf",          label: "Shelf" },
  { key: "storage_carton",         label: "Carton" },
  { key: "storage_pallet_short",   label: "Pallet Short" },
  { key: "storage_pallet_regular", label: "Pallet Regular" },
  { key: "storage_pallet_tall",    label: "Pallet Tall" },
  { key: "storage_open_floor",     label: "Open Floor" },
];
