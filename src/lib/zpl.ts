import type { B2CCluster, B2CClusterBin, B2CClusterItem } from "./b2c-cluster";

// ── ZPL helpers ──────────────────────────────────────────────────────────────

/** Strip ZPL control characters from user data */
function ze(v: unknown): string {
  return String(v ?? "").replace(/[\\^~]/g, "").trim();
}

/** Truncate after stripping */
function zt(v: unknown, max: number): string {
  const s = ze(v);
  return s.length > max ? s.slice(0, max) : s;
}

/** Format YYYYMMDD → YYYY-MM-DD */
function zDate(s: string | undefined): string {
  if (!s) return "";
  const d = s.replace(/\D/g, "");
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return s.slice(0, 10);
}

// ── ZPL Bin Ticket ────────────────────────────────────────────────────────────
//   4" × auto at 203 DPI  (PW = 812 dots)

export function generateBinZPL(
  bin: B2CClusterBin,
  clusterNo: number | undefined,
  totalBins: number
): string {
  const items: B2CClusterItem[] = [...bin.items].sort((a, b) =>
    (a.locationCode ?? "").localeCompare(b.locationCode ?? "")
  );
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  const totalSkus = new Set(items.map((i) => i.sku)).size;

  const W = 812;  // 4" @ 203 dpi
  const M = 16;   // left/right margin
  const z: string[] = [];
  let y = 10;
  const LL_IDX = 2; // splice ^LL here after computing height

  z.push("^XA");
  z.push(`^PW${W}`);
  // ^LL spliced in at LL_IDX after final y is known
  z.push("^LH0,0");
  z.push("^CI28"); // UTF-8

  // ── HEADER ──────────────────────────────────────────────
  z.push(`^FO${M},${y}^GB${W - M * 2},4,4^FS`); // top border
  y += 6;

  // BIN badge (solid black rect, white text) — 145×145
  const bX = W - 158;
  const bY = y;
  z.push(`^FO${bX},${bY}^GB142,142,142^FS`);
  z.push(`^FO${bX + 5},${bY + 10}^A0N,30,30^FR^FDBIN^FS`);
  const bn = String(bin.binNo);
  const [bfH, bfW] =
    bn.length >= 3 ? [52, 44] : bn.length === 2 ? [68, 58] : [82, 70];
  z.push(`^FO${bX + 5},${bY + 46}^A0N,${bfH},${bfW}^FR^FD${bn}^FS`);

  // Titles
  z.push(`^FO${M},${y + 8}^A0N,38,34^FDB2C CLUSTER PICK^FS`);
  const clLabel =
    clusterNo != null
      ? `Cluster #${String(clusterNo).padStart(4, "0")}`
      : "Cluster Pick";
  z.push(`^FO${M},${y + 52}^A0N,28,24^FD${ze(clLabel)}^FS`);
  z.push(
    `^FO${M},${y + 86}^A0N,24,20^FDClient: ${ze(bin.customerCode || "ALL")}   SKUs: ${totalSkus}   Total: ${totalQty} EA^FS`
  );
  z.push(`^FO${M},${y + 118}^A0N,28,24^FDBin ${bin.binNo} of ${totalBins}^FS`);

  y += 158;
  z.push(`^FO${M},${y}^GB${W - M * 2},4,4^FS`);
  y += 8;

  // ── ORDER INFO + QR CODE ─────────────────────────────────
  const orderSecY = y;
  // QR encodes orderCode; display shows orderNo
  z.push(`^FO${W - 160},${y + 4}^BQN,2,5^FDQA,${ze(bin.orderCode)}^FS`);

  z.push(`^FO${M},${y}^A0N,22,18^FDORDER NO.^FS`);
  y += 28;
  z.push(`^FO${M},${y}^A0N,34,30^FD${zt(bin.orderNo ?? bin.orderCode, 22)}^FS`);
  y += 44;

  if (bin.orderCode) {
    z.push(`^FO${M},${y}^A0N,22,18^FDCode: ${zt(bin.orderCode, 22)}^FS`);
    y += 30;
  }

  if (bin.consigneeName) {
    z.push(`^FO${M},${y}^A0N,30,26^FD${zt(bin.consigneeName, 22)}^FS`);
    y += 38;
  }

  const addr1 = ze(bin.consigneeAddress1);
  const addr2 = ze(bin.consigneeAddress2);
  const city  = ze(bin.consigneeCity);
  const state = ze(bin.consigneeState);
  const zip   = ze(bin.consigneeZipCode);

  if (addr1) {
    z.push(`^FO${M},${y}^A0N,24,20^FD${zt(addr1, 26)}^FS`);
    y += 30;
  }
  if (addr2) {
    z.push(`^FO${M},${y}^A0N,24,20^FD${zt(addr2, 26)}^FS`);
    y += 30;
  }
  const cityLine = [[city, state].filter(Boolean).join(", "), zip]
    .filter(Boolean)
    .join(" ");
  if (cityLine) {
    z.push(`^FO${M},${y}^A0N,24,20^FD${zt(cityLine, 26)}^FS`);
    y += 30;
  }

  // QR at mag 5 is ~130 dots tall — ensure clearance
  y = Math.max(y, orderSecY + 145);

  z.push(`^FO${M},${y}^GB${W - M * 2},4,4^FS`);
  y += 8;

  // ── ITEMS TABLE ──────────────────────────────────────────
  // Column headers
  z.push(`^FO${M},${y}^A0N,24,18^FD#^FS`);
  z.push(`^FO55,${y}^A0N,24,18^FDLOCATION^FS`);
  z.push(`^FO310,${y}^A0N,24,18^FDSKU^FS`);
  z.push(`^FO680,${y}^A0N,24,18^FDQTY^FS`);
  y += 32;
  z.push(`^FO${M},${y}^GB${W - M * 2},3,3^FS`);
  y += 5;

  // Rows
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    z.push(`^FO${M},${y}^A0N,24,18^FD${i + 1}^FS`);
    z.push(`^FO55,${y}^A0N,24,18^FD${zt(item.locationCode || "—", 15)}^FS`);
    z.push(`^FO310,${y}^A0N,24,18^FD${zt(item.sku, 15)}^FS`);
    z.push(`^FO680,${y}^A0N,26,22^FD${item.qty}^FS`);
    y += 32;

    if (item.lotNo || item.expireDate) {
      const sub = [
        item.lotNo ? `Lot: ${item.lotNo}` : "",
        item.expireDate ? `Exp: ${zDate(item.expireDate)}` : "",
      ]
        .filter(Boolean)
        .join("  ");
      z.push(`^FO55,${y}^A0N,20,16^FD${zt(sub, 36)}^FS`);
      y += 26;
    }

    z.push(`^FO${M},${y}^GB${W - M * 2},1,1^FS`); // thin row divider
    y += 4;
  }

  // ── TOTAL ────────────────────────────────────────────────
  y += 4;
  z.push(`^FO${M},${y}^GB${W - M * 2},4,4^FS`);
  y += 8;
  z.push(`^FO${M},${y}^A0N,32,28^FDTOTAL^FS`);
  z.push(`^FO580,${y}^A0N,32,28^FD${totalQty} EA^FS`);
  y += 44;

  // ── FOOTER ───────────────────────────────────────────────
  z.push(`^FO${M},${y}^GB${W - M * 2},4,4^FS`);
  y += 10;

  z.push(`^FO${M},${y}^A0N,24,20^FDPicker:^FS`);
  z.push(`^FO96,${y + 28}^GB270,3,3^FS`);
  z.push(`^FO400,${y}^A0N,24,20^FDChecked:^FS`);
  z.push(`^FO488,${y + 28}^GB300,3,3^FS`);
  y += 44;

  z.push(`^FO${M},${y}^A0N,24,20^FDDate/Time:^FS`);
  z.push(`^FO120,${y + 28}^GB668,3,3^FS`);
  y += 44;

  const nowStr = new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  z.push(`^FO${M},${y}^A0N,20,16^FDGenerated: ${ze(nowStr)}^FS`);
  y += 28;

  z.push(`^FO${M},${y}^GB${W - M * 2},4,4^FS`);
  y += 12;

  // Splice in the computed label length
  z.splice(LL_IDX, 0, `^LL${y}`);
  z.push("^XZ");

  return z.join("\n");
}

// ── Replenishment Label ───────────────────────────────────────────────────────

export interface ReplenLocationLabel {
  locationCode: string;
  entries: Array<{ sku: string; name: string; qty: number; lotNo?: string; expireDate?: string }>;
  totalQty: number;
  bins: number[];
}

export interface ReplenPlanEntry {
  sku: string;
  name: string;
  locationCode: string;
  lotNo?: string;
  expireDate?: string;
  availQty?: number;
  orderCount?: number;
}

/** Build per-location replenishment labels from a cluster (same logic as clusters-replen-print page) */
export function buildReplenLabels(cluster: B2CCluster): ReplenLocationLabel[] {
  const map = new Map<string, Map<string, { sku: string; name: string; qty: number; lotNo?: string; expireDate?: string; bins: Set<number> }>>();

  cluster.bins.forEach((bin) => {
    if (!bin.needsReplenishment || !bin.replenishmentItems?.length) return;
    bin.replenishmentItems.forEach((ri) => {
      const loc = ri.locationCode || "UNKNOWN";
      if (!map.has(loc)) map.set(loc, new Map());
      const skuMap = map.get(loc)!;
      if (!skuMap.has(ri.sku)) {
        skuMap.set(ri.sku, { sku: ri.sku, name: ri.name, qty: 0, lotNo: ri.lotNo, expireDate: ri.expireDate, bins: new Set() });
      }
      const entry = skuMap.get(ri.sku)!;
      entry.qty += ri.qty;
      entry.bins.add(bin.binNo);
    });
  });

  const labels: ReplenLocationLabel[] = [];
  map.forEach((skuMap, locationCode) => {
    const entries = Array.from(skuMap.values())
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .map((e) => ({ sku: e.sku, name: e.name, qty: e.qty, lotNo: e.lotNo, expireDate: e.expireDate }));
    const allBins = Array.from(new Set(Array.from(skuMap.values()).flatMap((e) => Array.from(e.bins)))).sort((a, b) => a - b);
    labels.push({ locationCode, entries, totalQty: entries.reduce((s, e) => s + e.qty, 0), bins: allBins });
  });

  return labels.sort((a, b) => a.locationCode.localeCompare(b.locationCode, undefined, { numeric: true }));
}

/**
 * Generate ZPL for one replenishment location label (4" × auto @ 203 DPI).
 * idx/total are 0-based index and total label count.
 */
export function generateReplenLabelZPL(
  label: ReplenLocationLabel,
  idx: number,
  total: number,
  warehouseCode: string,
  createdAt: string,
): string {
  const W = 812;
  const M = 16;
  const z: string[] = [];
  let y = 10;
  const LL_IDX = 2;

  const dateStr = new Date(createdAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });

  z.push("^XA");
  z.push(`^PW${W}`);
  z.push("^LH0,0");
  z.push("^CI28");

  // ── HEADER ──
  z.push(`^FO${M},${y}^GB${W - M * 2},4,4^FS`);
  y += 8;

  z.push(`^FO${M},${y}^A0N,44,38^FDREPLENISHMENT^FS`);
  z.push(`^FO${M},${y + 50}^A0N,22,18^FDMove to Shelf - Pick for Cluster^FS`);

  // Page num, date, warehouse (right-aligned)
  z.push(`^FO${W - 200},${y}^A0N,24,20^FD${ze(idx + 1)} / ${ze(total)}^FS`);
  z.push(`^FO${W - 200},${y + 30}^A0N,20,16^FD${ze(dateStr)}^FS`);
  z.push(`^FO${W - 200},${y + 52}^A0N,20,16^FD${ze(warehouseCode)}^FS`);

  y += 82;
  z.push(`^FO${M},${y}^GB${W - M * 2},4,4^FS`);
  y += 8;

  // ── FROM LOCATION (inverted block) ──
  z.push(`^FO${M},${y}^GB${W - M * 2},90,90^FS`);
  z.push(`^FO${M + 8},${y + 6}^A0N,20,16^FR^FDFROM LOCATION^FS`);
  const locLen = label.locationCode.length;
  const [locH, locW] = locLen <= 10 ? [64, 54] : locLen <= 16 ? [52, 44] : [42, 36];
  z.push(`^FO${M + 8},${y + 30}^A0N,${locH},${locW}^FR^FD${zt(label.locationCode, 20)}^FS`);
  y += 100;

  // ── BINS ──
  z.push(`^FO${M},${y}^A0N,24,20^FDBINS:^FS`);
  z.push(`^FO${M + 80},${y}^A0N,24,20^FD${zt(label.bins.join(", "), 44)}^FS`);
  y += 34;

  // Divider
  z.push(`^FO${M},${y}^GB${W - M * 2},2,2^FS`);
  y += 6;

  // ── ITEMS TABLE HEADER ──
  z.push(`^FO${M},${y}^A0N,22,18^FD#^FS`);
  z.push(`^FO50,${y}^A0N,22,18^FDSKU^FS`);
  z.push(`^FO300,${y}^A0N,22,18^FDPRODUCT^FS`);
  z.push(`^FO760,${y}^A0N,22,18^FDQTY^FS`);
  y += 28;
  z.push(`^FO${M},${y}^GB${W - M * 2},3,3^FS`);
  y += 5;

  // ── ROWS ──
  for (let i = 0; i < label.entries.length; i++) {
    const e = label.entries[i];
    z.push(`^FO${M},${y}^A0N,22,18^FD${i + 1}^FS`);
    z.push(`^FO50,${y}^A0N,22,18^FD${zt(e.sku, 16)}^FS`);
    z.push(`^FO300,${y}^A0N,22,18^FD${zt(e.name || "—", 24)}^FS`);
    z.push(`^FO760,${y}^A0N,26,22^FD${e.qty}^FS`);
    y += 30;

    if (e.lotNo || e.expireDate) {
      const sub = [e.lotNo ? `Lot:${e.lotNo}` : "", e.expireDate ? `Exp:${zDate(e.expireDate)}` : ""]
        .filter(Boolean)
        .join("  ");
      z.push(`^FO50,${y}^A0N,18,14^FD${zt(sub, 40)}^FS`);
      y += 22;
    }

    z.push(`^FO${M},${y}^GB${W - M * 2},1,1^FS`);
    y += 4;
  }

  // ── TOTAL ──
  y += 4;
  z.push(`^FO${M},${y}^GB${W - M * 2},4,4^FS`);
  y += 8;
  z.push(`^FO${M},${y}^A0N,28,24^FDTOTAL QTY^FS`);
  z.push(`^FO700,${y}^A0N,32,28^FD${label.totalQty}^FS`);
  y += 44;

  // ── FOOTER ──
  z.push(`^FO${M},${y}^GB${W - M * 2},4,4^FS`);
  y += 10;
  z.push(`^FO${M},${y}^A0N,22,18^FDPicker:^FS`);
  z.push(`^FO90,${y + 28}^GB240,3,3^FS`);
  z.push(`^FO370,${y}^A0N,22,18^FDChecked:^FS`);
  z.push(`^FO452,${y + 28}^GB330,3,3^FS`);
  y += 44;
  z.push(`^FO${M},${y}^A0N,22,18^FDTime:^FS`);
  z.push(`^FO72,${y + 28}^GB710,3,3^FS`);
  y += 44;

  z.splice(LL_IDX, 0, `^LL${y + 12}`);
  z.push("^XZ");
  return z.join("\n");
}

/** Generate ZPL for one replen plan entry (SKU pick ticket, 4" × auto @ 203 DPI). */
export function generateReplenPlanZPL(
  entry: ReplenPlanEntry,
  warehouseCode: string,
  createdAt: string,
): string {
  const W = 812;
  const M = 16;
  const z: string[] = [];
  let y = 10;
  const LL_IDX = 2;

  const dateStr = new Date(createdAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });

  z.push("^XA");
  z.push(`^PW${W}`);
  z.push("^LH0,0");
  z.push("^CI28");

  // ── BANNER (inverted) ──
  z.push(`^FO${M},${y}^GB${W - M * 2},90,90^FS`);
  z.push(`^FO${M + 8},${y + 8}^A0N,22,18^FR^FDREPLENISHMENT PICK^FS`);
  z.push(`^FO${M + 8},${y + 36}^A0N,48,42^FR^FDMOVE TO SHELF^FS`);
  y += 102;

  // ── SKU ──
  z.push(`^FO${M},${y}^A0N,20,16^FDSKU^FS`);
  y += 24;
  const skuStr = ze(entry.sku);
  const [skuH, skuW] = skuStr.length <= 12 ? [52, 44] : skuStr.length <= 18 ? [42, 36] : [32, 28];
  z.push(`^FO${M},${y}^A0N,${skuH},${skuW}^FD${zt(entry.sku, 24)}^FS`);
  y += skuH + 10;
  z.push(`^FO${M},${y}^A0N,26,22^FD${zt(entry.name || "—", 32)}^FS`);
  y += 36;

  // ── PICK FROM ──
  z.push(`^FO${M},${y}^A0N,20,16^FDPICK FROM^FS`);
  y += 24;
  z.push(`^FO${M},${y}^GB${W - M * 2},80,80^FS`);
  z.push(`^FO${M + 8},${y + 6}^A0N,18,14^FR^FDLOCATION^FS`);
  const locStr = ze(entry.locationCode || "—");
  const [plH, plW] = locStr.length <= 10 ? [56, 48] : locStr.length <= 16 ? [46, 38] : [38, 30];
  z.push(`^FO${M + 8},${y + 28}^A0N,${plH},${plW}^FR^FD${zt(entry.locationCode || "—", 20)}^FS`);
  y += 90;

  // ── META ──
  if (entry.lotNo) {
    z.push(`^FO${M},${y}^A0N,24,20^FDLot: ${zt(entry.lotNo, 22)}^FS`);
    y += 30;
  }
  if (entry.expireDate) {
    z.push(`^FO${M},${y}^A0N,24,20^FDExp: ${zt(entry.expireDate, 22)}^FS`);
    y += 30;
  }
  if (entry.availQty && entry.availQty > 0) {
    z.push(`^FO${M},${y}^A0N,24,20^FDAvail Qty: ${entry.availQty}^FS`);
    y += 30;
  }

  // ── ORDER COUNT WARNING ──
  if (entry.orderCount && entry.orderCount > 0) {
    z.push(`^FO${M},${y}^A0N,24,20^FD! ${entry.orderCount} order${entry.orderCount !== 1 ? "s" : ""} blocked - replenish to shelf^FS`);
    y += 36;
  }

  // ── CHECKBOXES ──
  z.push(`^FO${M},${y}^GB${W - M * 2},2,2^FS`);
  y += 8;
  z.push(`^FO${M},${y}^A0N,24,20^FD[ ] Picked from location^FS`);
  y += 34;
  z.push(`^FO${M},${y}^A0N,24,20^FD[ ] Moved to shelf^FS`);
  y += 36;

  // ── FOOTER ──
  z.push(`^FO${M},${y}^GB${W - M * 2},3,3^FS`);
  y += 8;
  z.push(`^FO${M},${y}^A0N,20,16^FD${ze(warehouseCode)}^FS`);
  z.push(`^FO580,${y}^A0N,20,16^FD${ze(dateStr)}^FS`);
  y += 28;

  z.splice(LL_IDX, 0, `^LL${y + 12}`);
  z.push("^XZ");
  return z.join("\n");
}

// ── Batch Pick Ticket ─────────────────────────────────────────────────────────

export interface BatchZPLData {
  batchCode: string;
  batchName: string;
  dateDisplay: string;
  whCode: string;
  custCode: string;
  orderCount: number;
  skus: Array<{ sku: string; name: string; totalQty: number }>;
  totalQty: number;
}

/** Generate ZPL for a batch pick ticket (4" × auto @ 203 DPI). */
export function generateBatchZPL(data: BatchZPLData): string {
  const W = 812;
  const M = 16;
  const z: string[] = [];
  let y = 10;
  const LL_IDX = 2;

  z.push("^XA");
  z.push(`^PW${W}`);
  z.push("^LH0,0");
  z.push("^CI28");

  // ── HEADER: title + QR (mag 5 ≈ 130 dots) ──
  z.push(`^FO${W - 155},${y}^BQN,2,5^FDQA,${ze(data.batchCode)}^FS`);
  z.push(`^FO${M},${y}^GB${W - M * 2},4,4^FS`);
  y += 8;
  z.push(`^FO${M},${y}^A0N,22,18^FD▌ BATCH PICK TICKET^FS`);
  y += 28;
  z.push(`^FO${M},${y}^A0N,36,30^FD${zt(data.batchName, 20)}^FS`);
  y += 46;

  // Ensure we clear the QR region (starts at y=10, mag5 ≈ 130 tall)
  y = Math.max(y, 150);
  z.push(`^FO${M},${y}^GB${W - M * 2},4,4^FS`);
  y += 8;

  // ── INFO GRID (2 cols × 2 rows) ──
  const HALF = Math.floor((W - M * 2) / 2);
  const BOX_H = 108;
  z.push(`^FO${M},${y}^GB${W - M * 2},${BOX_H},2^FS`);             // outer box
  z.push(`^FO${M + HALF},${y}^GB2,${BOX_H},2^FS`);                  // vertical divider
  z.push(`^FO${M},${y + BOX_H / 2}^GB${W - M * 2},2,2^FS`);        // horizontal divider
  const C1 = M + 4;
  const C2 = M + HALF + 4;
  // Row 1 left: Batch No.
  z.push(`^FO${C1},${y + 4}^A0N,20,16^FDBatch No.^FS`);
  z.push(`^FO${C1},${y + 26}^A0N,28,24^FD${zt(data.batchCode, 18)}^FS`);
  // Row 1 right: Client / WH
  z.push(`^FO${C2},${y + 4}^A0N,20,16^FDClient: ${zt(data.custCode || "ALL", 12)}^FS`);
  z.push(`^FO${C2},${y + 28}^A0N,20,16^FDWH: ${zt(data.whCode, 12)}^FS`);
  // Row 2 left: Date / Orders
  const R2Y = y + BOX_H / 2 + 2;
  z.push(`^FO${C1},${R2Y + 4}^A0N,20,16^FDDate: ${zt(data.dateDisplay, 12)}^FS`);
  z.push(`^FO${C1},${R2Y + 28}^A0N,20,16^FDOrders: ${data.orderCount}^FS`);
  // Row 2 right: SKU count / Total
  z.push(`^FO${C2},${R2Y + 4}^A0N,20,16^FDTotal SKU: ${data.skus.length}^FS`);
  z.push(`^FO${C2},${R2Y + 28}^A0N,20,16^FDTotal Qty: ${data.totalQty} EA^FS`);
  y += BOX_H + 6;

  // ── ITEMS TABLE ──
  z.push(`^FO${M},${y}^A0N,20,16^FD#^FS`);
  z.push(`^FO52,${y}^A0N,20,16^FDSKU / ITEM^FS`);
  z.push(`^FO636,${y}^A0N,20,16^FDQTY^FS`);
  z.push(`^FO762,${y}^A0N,20,16^FD✓^FS`);
  y += 24;
  z.push(`^FO${M},${y}^GB${W - M * 2},3,3^FS`);
  y += 5;

  for (let i = 0; i < data.skus.length; i++) {
    const s = data.skus[i];
    const rowY = y;
    z.push(`^FO${M},${rowY}^A0N,24,20^FD${i + 1}^FS`);
    z.push(`^FO52,${rowY}^A0N,24,20^FD${zt(s.sku, 16)}^FS`);
    z.push(`^FO52,${rowY + 28}^A0N,18,14^FD${zt(s.name || "—", 28)}^FS`);
    z.push(`^FO630,${rowY + 6}^A0N,30,26^FD${s.totalQty}^FS`);
    z.push(`^FO762,${rowY + 4}^GB28,28,2^FS`); // check box
    y += 54;
    z.push(`^FO${M},${y}^GB${W - M * 2},1,1^FS`);
    y += 4;
  }

  // Total row
  y += 4;
  z.push(`^FO${M},${y}^GB${W - M * 2},4,4^FS`);
  y += 8;
  z.push(`^FO520,${y}^A0N,28,24^FDTOTAL^FS`);
  z.push(`^FO630,${y}^A0N,32,28^FD${data.totalQty}^FS`);
  y += 44;

  // ── FOOTER ──
  z.push(`^FO${M},${y}^GB${W - M * 2},4,4^FS`);
  y += 10;
  z.push(`^FO${M},${y}^A0N,22,18^FDPicker:^FS`);
  z.push(`^FO90,${y + 28}^GB240,3,3^FS`);
  z.push(`^FO370,${y}^A0N,22,18^FDChecked:^FS`);
  z.push(`^FO452,${y + 28}^GB330,3,3^FS`);
  y += 44;
  z.push(`^FO${M},${y}^A0N,22,18^FDDate / Time:^FS`);
  z.push(`^FO130,${y + 28}^GB650,3,3^FS`);
  y += 44;

  const nowStr = new Date().toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  z.push(`^FO${M},${y}^A0N,18,14^FDGenerated: ${ze(nowStr)}^FS`);
  y += 26;
  z.push(`^FO${M},${y}^GB${W - M * 2},4,4^FS`);
  y += 12;

  z.splice(LL_IDX, 0, `^LL${y}`);
  z.push("^XZ");
  return z.join("\n");
}

// ── Zebra Browser Print API ───────────────────────────────────────────────────

// Keep the full device object exactly as returned by /available so Browser Print
// can match it back to the physical device.
export type ZebraPrinter = Record<string, unknown> & { name: string; uid: string };

/** Discover printers from local Zebra Browser Print app (port 9100) */
export async function zebraDiscoverPrinters(): Promise<ZebraPrinter[]> {
  const res = await fetch("http://localhost:9100/available", {
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { printer?: ZebraPrinter[] };
  return data.printer ?? [];
}

/** Send raw ZPL to a discovered Zebra printer.
 *  Tries JSON body first; falls back to URL-encoded if the server rejects it.
 */
export async function zebraSend(
  printer: ZebraPrinter,
  zpl: string
): Promise<void> {
  // ZPL must be a single blob — remove newlines so URL-encoding can't fragment it
  const zplFlat = zpl.replace(/\r?\n/g, "");

  // ── Attempt 1: JSON body (Browser Print v3.1+) ──────────────────────────
  let res = await fetch("http://localhost:9100/write", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device: printer, data: zplFlat }),
  });

  if (res.ok) return;

  const status1 = res.status;

  // ── Attempt 2: URL-encoded body (older Browser Print) ───────────────────
  const params = new URLSearchParams();
  params.set("device", JSON.stringify(printer));
  params.set("data", zplFlat);
  res = await fetch("http://localhost:9100/write", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: params.toString(),
  });

  if (res.ok) return;

  const errText = await res.text().catch(() => "");
  throw new Error(`Write failed (JSON:${status1}, form:${res.status})${errText ? ` — ${errText.slice(0, 120)}` : ""}`);
}
