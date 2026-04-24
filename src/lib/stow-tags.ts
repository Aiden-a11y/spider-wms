// Shared stow tag type — written by receiving inspection, consumed by stow process.
// Data is stored server-side via Upstash Redis (shared across all devices).

export type PersistedStowTag = {
  id: number;           // Date.now() unique id
  tagNo: number;        // 1-based tag index within the order
  orderCode: string;    // receiving order code
  barcodeValue: string; // printed barcode string
  qty: number;
  lotNo: string;
  expireDate: string;
  sku: string;
  productName: string;
  warehouseCode: string;
  warehouseCd: string;
  customerCode: string;
  receiveItemId: number;
  itemCondition: string;
  stowedAt?: string;    // ISO string when assigned to a location
};

/** Save a new stow tag to the server. */
export async function addStowTag(tag: PersistedStowTag): Promise<void> {
  await fetch("/api/stow-tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tag),
  });
}

/** Fetch all pending (un-stowed) tags from the server. */
export async function fetchPendingStowTags(): Promise<PersistedStowTag[]> {
  try {
    const res = await fetch("/api/stow-tags?pending=true");
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/** Mark a stow tag as done on the server. */
export async function markStowTagDone(id: number): Promise<void> {
  await fetch(`/api/stow-tags/${id}`, { method: "PATCH" });
}

/**
 * Delete all pending (un-stowed) stow tags for a receiving order.
 * Called when re-entering order processing to clean up stale tags
 * from a previous session (e.g., after a status rollback).
 */
export async function deleteStowTagsByOrder(orderCode: string): Promise<number> {
  try {
    const res = await fetch(
      `/api/stow-tags?orderCode=${encodeURIComponent(orderCode)}`,
      { method: "DELETE" }
    );
    if (!res.ok) return 0;
    const json = await res.json();
    return json.deleted ?? 0;
  } catch {
    return 0;
  }
}
