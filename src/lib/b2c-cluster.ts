export interface B2CClusterTask {
  binNo: number;
  orderCode: string;
  sku: string;
  skuName: string;
  qty: number;
  locationId?: string;
  lotNo?: string;
  expireDate?: string;
  itemCondition?: string;
  shippingItemId?: number;
}

export interface B2CClusterLocationGroup {
  locationCode: string;
  locationId?: string;
  tasks: B2CClusterTask[];
}

export interface B2CClusterItem {
  sku: string;
  name: string;
  qty: number;
  locationCode: string;
  locationId?: string;
  lotNo?: string;
  expireDate?: string;
  itemCondition?: string;
  shippingItemId?: number;
}

export interface B2CClusterBin {
  binNo: number;
  orderCode: string;
  customerCode: string;
  orderNo?: string;
  consigneeName?: string;
  consigneeAddress1?: string;
  consigneeAddress2?: string;
  consigneeCity?: string;
  consigneeState?: string;
  consigneeZipCode?: string;
  consigneeNationalCode?: string;
  consigneeTelLNo?: string;
  items: B2CClusterItem[];
  needsReplenishment?: boolean;
  replenishmentItems?: { sku: string; name: string; qty: number; locationCode?: string }[];
}

export interface B2CCluster {
  id: string;
  warehouseCode: string;
  createdAt: string;
  createdBy: string;
  status: "active" | "completed";
  completedAt?: string;
  bins: B2CClusterBin[];
  locationGroups: B2CClusterLocationGroup[];
  replenishmentBins?: number[];
}

export const BIN_COLORS = [
  "#ef4444","#f97316","#eab308","#22c55e","#14b8a6",
  "#3b82f6","#8b5cf6","#ec4899","#06b6d4","#84cc16",
  "#f59e0b","#10b981","#6366f1","#a855f7","#d946ef",
  "#0ea5e9","#65a30d","#dc2626","#ea580c","#ca8a04",
  "#16a34a","#0d9488","#2563eb","#7c3aed","#db2777",
];

export function binColor(binNo: number): string {
  return BIN_COLORS[(binNo - 1) % 25];
}

export function sortLocationGroups(groups: B2CClusterLocationGroup[]): B2CClusterLocationGroup[] {
  return [...groups].sort((a, b) => {
    const partsA = a.locationCode.split(/[/\-]/).map(p => parseInt(p) || 0);
    const partsB = b.locationCode.split(/[/\-]/).map(p => parseInt(p) || 0);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return a.locationCode.localeCompare(b.locationCode);
  });
}
