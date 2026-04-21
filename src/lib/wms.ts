export const WMS_BASE = "https://us-wms-api.stload.com/api";

export interface InventoryItem {
  locationId?: string;
  locationCode?: string;
  zone: string;
  aisle: string;
  bay: string;
  level: string;
  position: string;
  sku: string;
  productId?: string;
  productName: string;
  qty: number;
  availableQty?: number;
  lot?: string;
  expireDate?: string;
  uom?: string;
  customerCode?: string;
}

export interface LocationNode {
  zone: string;
  aisles: Record<string, AisleNode>;
  totalQty: number;
  itemCount: number;
}

export interface AisleNode {
  aisle: string;
  bays: Record<string, BayItem[]>;
  totalQty: number;
  itemCount: number;
}

export interface BayItem extends InventoryItem {}

export interface DashboardSummary {
  todayOrders?: number;
  pendingShipping?: number;
  completedShipping?: number;
  pendingReceiving?: number;
  totalSKUs?: number;
  totalInventory?: number;
  [key: string]: unknown;
}

export interface Warehouse {
  id: string;
  name: string;
  code?: string;
}

export function buildLocationTree(items: InventoryItem[]): Record<string, LocationNode> {
  const tree: Record<string, LocationNode> = {};

  for (const item of items) {
    const z = item.zone ?? "?";
    const a = item.aisle ?? "?";
    const b = item.bay ?? "?";
    const key = `${b}`;

    if (!tree[z]) tree[z] = { zone: z, aisles: {}, totalQty: 0, itemCount: 0 };
    if (!tree[z].aisles[a]) tree[z].aisles[a] = { aisle: a, bays: {}, totalQty: 0, itemCount: 0 };
    if (!tree[z].aisles[a].bays[key]) tree[z].aisles[a].bays[key] = [];

    tree[z].aisles[a].bays[key].push(item);
    tree[z].aisles[a].totalQty += item.qty;
    tree[z].aisles[a].itemCount += 1;
    tree[z].totalQty += item.qty;
    tree[z].itemCount += 1;
  }

  return tree;
}

// Normalize API response into InventoryItem[]
// Actual WMS field names: zoneName, aisleName, bayName, levelName, positionName, productSku, lotNo
export function normalizeInventory(raw: unknown): InventoryItem[] {
  if (!raw) return [];
  const data = (raw as Record<string, unknown>).data ?? raw;
  const arr = Array.isArray(data) ? data : [];

  return arr.map((r: unknown) => {
    const row = r as Record<string, unknown>;
    const zone = String(row.zoneName ?? row.zone ?? row.zoneCode ?? "");
    const aisle = String(row.aisleName ?? row.aisle ?? row.aisleCode ?? "");
    const bay = String(row.bayName ?? row.bay ?? row.bayCode ?? "");
    const level = String(row.levelName ?? row.level ?? row.levelCode ?? "");
    const position = String(row.positionName ?? row.position ?? row.positionCode ?? "");

    return {
      locationId: String(row.inKey ?? row.locationId ?? row.id ?? ""),
      locationCode: [zone, aisle, bay, level, position].filter(Boolean).join("-"),
      zone,
      aisle,
      bay,
      level,
      position,
      sku: String(row.productSku ?? row.sku ?? row.itemCode ?? ""),
      productId: String(row.productId ?? ""),
      productName: String(row.productName ?? row.itemName ?? ""),
      qty: Number(row.qty ?? row.quantity ?? row.stockQty ?? row.onHandQty ?? 0),
      availableQty: Number(row.availableQty ?? row.availQty ?? row.qty ?? 0),
      lot: String(row.lotNo ?? row.lot ?? ""),
      expireDate: String(row.expireDate ?? row.expiryDate ?? ""),
      uom: String(row.uom ?? row.unit ?? ""),
      customerCode: String(row.customerCode ?? ""),
    };
  });
}

export const ZONE_COLORS: Record<string, string> = {
  A: "bg-blue-100 text-blue-800 border-blue-200",
  B: "bg-green-100 text-green-800 border-green-200",
  C: "bg-orange-100 text-orange-800 border-orange-200",
  D: "bg-purple-100 text-purple-800 border-purple-200",
  E: "bg-red-100 text-red-800 border-red-200",
  F: "bg-yellow-100 text-yellow-800 border-yellow-200",
};

export function zoneColor(zone: string) {
  return ZONE_COLORS[zone.toUpperCase()] ?? "bg-slate-100 text-slate-800 border-slate-200";
}

export function zoneBg(zone: string) {
  const map: Record<string, string> = {
    A: "bg-blue-50 border-l-4 border-blue-400",
    B: "bg-green-50 border-l-4 border-green-400",
    C: "bg-orange-50 border-l-4 border-orange-400",
    D: "bg-purple-50 border-l-4 border-purple-400",
    E: "bg-red-50 border-l-4 border-red-400",
    F: "bg-yellow-50 border-l-4 border-yellow-400",
  };
  return map[zone.toUpperCase()] ?? "bg-slate-50 border-l-4 border-slate-400";
}
