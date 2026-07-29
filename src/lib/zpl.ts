import type { B2CClusterBin, B2CClusterItem } from "./b2c-cluster";

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
