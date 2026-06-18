"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import type { B2CCluster, B2CClusterBin } from "@/lib/b2c-cluster";

function useQR(text: string): string {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!text) return;
    QRCode.toDataURL(text, { width: 140, margin: 1, color: { dark: "#000", light: "#fff" } })
      .then(setUrl).catch(() => {});
  }, [text]);
  return url;
}

/* ── types ── */
interface ReplenEntry {
  sku: string;
  name: string;
  qty: number;
  lotNo?: string;
  expireDate?: string;
  bins: number[];
}

interface LocationLabel {
  locationCode: string;
  entries: ReplenEntry[];
  totalQty: number;
}

/* ── Aggregate by location → unique SKU ── */
function buildLabels(cluster: B2CCluster): LocationLabel[] {
  const map = new Map<string, Map<string, ReplenEntry>>();

  cluster.bins.forEach((bin: B2CClusterBin) => {
    if (!bin.needsReplenishment || !bin.replenishmentItems?.length) return;
    bin.replenishmentItems.forEach((ri) => {
      const loc = ri.locationCode || "UNKNOWN";
      if (!map.has(loc)) map.set(loc, new Map());
      const skuMap = map.get(loc)!;
      if (!skuMap.has(ri.sku)) {
        skuMap.set(ri.sku, { sku: ri.sku, name: ri.name, qty: 0, lotNo: ri.lotNo, expireDate: ri.expireDate, bins: [] });
      }
      const entry = skuMap.get(ri.sku)!;
      entry.qty += ri.qty;
      if (!entry.bins.includes(bin.binNo)) entry.bins.push(bin.binNo);
    });
  });

  const labels: LocationLabel[] = [];
  map.forEach((skuMap, locationCode) => {
    const entries = Array.from(skuMap.values()).sort((a, b) => a.sku.localeCompare(b.sku));
    labels.push({ locationCode, entries, totalQty: entries.reduce((s, e) => s + e.qty, 0) });
  });

  return labels.sort((a, b) => a.locationCode.localeCompare(b.locationCode, undefined, { numeric: true }));
}

/* ── Print CSS — B&W packing-list style ── */
const CSS = `
  @media print {
    @page { size: 4in 6in; margin: 0.15in; }
    .no-print { display: none !important; }
    .ticket { page-break-after: always; }
    .ticket:last-child { page-break-after: avoid; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #e5e7eb; }
  .ticket {
    width: 3.7in; min-height: 5.7in; background: #fff;
    padding: 0.14in 0.16in; margin: 0.1in auto;
    border: 1.5px solid #000; display: flex; flex-direction: column;
    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
  }

  /* ── Header ── */
  .hdr {
    display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 2px solid #000; padding-bottom: 0.07in; margin-bottom: 0.07in;
  }
  .hdr-left { flex: 1; min-width: 0; }
  .hdr-title {
    font-size: 9pt; font-weight: 900; letter-spacing: 0.5px;
    text-transform: uppercase; margin: 0 0 2px;
  }
  .hdr-meta { font-size: 6pt; color: #444; line-height: 1.6; }
  .hdr-meta b { color: #000; }
  .qr-box { width: 0.85in; height: 0.85in; flex-shrink: 0; margin-left: 0.08in; }
  .qr-box img { width: 100%; height: 100%; display: block; }
  .qr-placeholder { width: 100%; height: 100%; border: 1px solid #ccc; }

  /* ── Location block ── */
  .loc-block {
    border: 2px solid #000; padding: 0.05in 0.08in; margin-bottom: 0.07in;
  }
  .loc-label {
    font-size: 5.5pt; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.8px; color: #555; margin-bottom: 1px;
  }
  .loc-value {
    font-size: 18pt; font-weight: 900; font-family: 'Courier New', monospace;
    letter-spacing: 2px; line-height: 1.1; word-break: break-all;
  }

  /* ── Items table ── */
  .items-table { width: 100%; border-collapse: collapse; font-size: 6.5pt; margin-bottom: 0.06in; }
  .items-table th {
    background: #000; color: #fff; font-weight: 700;
    padding: 3px 5px; text-align: left; border: 1px solid #000;
    font-size: 6pt; text-transform: uppercase; letter-spacing: 0.4px;
  }
  .items-table th.col-qty { text-align: right; }
  .items-table td {
    padding: 4px 5px; border: 1px solid #888; vertical-align: top;
  }
  .items-table tr:nth-child(even) td { background: #f5f5f5; }
  .col-no { width: 0.2in; text-align: center; font-weight: 700; color: #444; }
  .col-item { }
  .col-qty-td { text-align: right; font-weight: 900; font-size: 9pt; white-space: nowrap; width: 0.5in; }
  .item-sku { font-family: 'Courier New', monospace; font-weight: 700; font-size: 7pt; }
  .item-name { font-size: 6pt; color: #333; margin-top: 1px; }
  .item-lot { font-family: 'Courier New', monospace; font-size: 5.5pt; color: #555; margin-top: 1px; }
  .item-bins { font-size: 5.5pt; color: #555; margin-top: 2px; }

  /* ── Totals row ── */
  .totals-row td {
    background: #000 !important; color: #fff;
    font-weight: 700; font-size: 7pt; text-align: right;
    padding: 3px 5px; border: 1px solid #000;
  }
  .totals-row .label-cell { text-align: right; font-size: 6pt; text-transform: uppercase; letter-spacing: 0.4px; }

  /* ── Footer ── */
  .footer {
    margin-top: auto; border-top: 1.5px solid #000; padding-top: 0.06in;
  }
  .sig-row {
    display: flex; gap: 0.1in; margin-bottom: 0.05in;
  }
  .sig-box { flex: 1; border-bottom: 1px solid #000; padding-bottom: 2px; }
  .sig-label { font-size: 5.5pt; color: #555; text-transform: uppercase; letter-spacing: 0.5px; }
  .generated { font-size: 5pt; color: #888; text-align: right; margin-top: 3px; }
`;

/* ── Single ticket ── */
function ReplenTicket({
  label, cluster, idx, total,
}: {
  label: LocationLabel; cluster: B2CCluster; idx: number; total: number;
}) {
  const allBins = Array.from(new Set(label.entries.flatMap((e) => e.bins))).sort((a, b) => a - b);
  const dateStr = new Date(cluster.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const now = new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

  // QR = order codes for bins on this label
  const orderCodes = allBins
    .map((bn) => cluster.bins.find((b) => b.binNo === bn))
    .filter(Boolean)
    .map((b) => b!.orderCode || b!.orderNo)
    .filter(Boolean);
  const qrText = orderCodes.join("\n");
  const qrUrl = useQR(qrText);

  const binNos = allBins.join(", ");

  return (
    <div className="ticket">
      {/* Header */}
      <div className="hdr">
        <div className="hdr-left">
          <div className="hdr-title">Replenishment Order</div>
          <div className="hdr-meta">
            <div><b>Cluster:</b> {cluster.id.replace("cluster_", "")}</div>
            <div><b>Date:</b> {dateStr}</div>
            <div><b>Total SKU:</b> {label.entries.length} &nbsp; <b>Total Qty:</b> {label.totalQty.toLocaleString()}</div>
            <div><b>Bins:</b> {binNos}</div>
          </div>
        </div>
        <div className="qr-box">
          {qrUrl ? <img src={qrUrl} alt={qrText} /> : <div className="qr-placeholder" />}
        </div>
      </div>

      {/* Page x/y */}
      <div style={{ fontSize: "5.5pt", color: "#555", textAlign: "right", marginBottom: "0.05in" }}>
        {idx + 1} / {total}
      </div>

      {/* From Location */}
      <div className="loc-block">
        <div className="loc-label">Pick From Location</div>
        <div className="loc-value">{label.locationCode}</div>
      </div>

      {/* Items table */}
      <table className="items-table">
        <thead>
          <tr>
            <th className="col-no">No.</th>
            <th className="col-item">Item</th>
            <th className="col-qty">Qty</th>
          </tr>
        </thead>
        <tbody>
          {label.entries.map((entry, i) => (
            <tr key={entry.sku}>
              <td className="col-no">{i + 1}</td>
              <td className="col-item">
                <div className="item-sku">{entry.sku}</div>
                <div className="item-name">{entry.name || "—"}</div>
                {(entry.lotNo || entry.expireDate) && (
                  <div className="item-lot">
                    {entry.lotNo ? `Lot: ${entry.lotNo}` : ""}
                    {entry.lotNo && entry.expireDate ? " · " : ""}
                    {entry.expireDate ? `Exp: ${entry.expireDate}` : ""}
                  </div>
                )}
                <div className="item-bins">Bins: {entry.bins.sort((a, b) => a - b).join(", ")}</div>
              </td>
              <td className="col-qty-td">{entry.qty} EA</td>
            </tr>
          ))}
          <tr className="totals-row">
            <td colSpan={2} className="label-cell">TOTAL</td>
            <td style={{ textAlign: "right" }}>{label.totalQty} EA</td>
          </tr>
        </tbody>
      </table>

      {/* Footer */}
      <div className="footer">
        <div className="sig-row">
          <div className="sig-box"><div className="sig-label">Picker</div></div>
          <div className="sig-box"><div className="sig-label">Checked</div></div>
          <div className="sig-box"><div className="sig-label">Date / Time</div></div>
        </div>
        <div className="generated">Generated: {now}</div>
      </div>
    </div>
  );
}

/* ── Main content ── */
function PrintContent() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";

  const [cluster, setCluster] = useState<B2CCluster | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) { setError("No cluster ID"); setLoading(false); return; }
    fetch(`/api/cluster?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((data) => { if (!data) setError("Cluster not found"); else setCluster(data as B2CCluster); })
      .catch(() => setError("Failed to load cluster"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (cluster) setTimeout(() => window.print(), 800);
  }, [cluster]);

  if (loading) return <div style={{ padding: 32, fontFamily: "sans-serif" }}>Loading…</div>;
  if (error || !cluster) return <div style={{ padding: 32, fontFamily: "sans-serif", color: "red" }}>{error || "Not found"}</div>;

  const labels = buildLabels(cluster);
  if (labels.length === 0) {
    return <div style={{ padding: 32, fontFamily: "sans-serif", color: "#555" }}>No replenishment items in this cluster.</div>;
  }

  return (
    <>
      <style>{CSS}</style>

      {/* Screen toolbar */}
      <div className="no-print" style={{
        background: "#111827", padding: "10px 20px",
        display: "flex", alignItems: "center", gap: 12,
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <span style={{ color: "#fff", fontFamily: "sans-serif", fontSize: 14, fontWeight: 600 }}>
          Replenishment — {labels.length} location{labels.length > 1 ? "s" : ""}
        </span>
        <button onClick={() => window.print()} style={{
          background: "#1d4ed8", color: "#fff", border: "none",
          borderRadius: 6, padding: "6px 16px", fontSize: 13, cursor: "pointer", fontWeight: 600,
        }}>Print All</button>
        <button onClick={() => window.history.back()} style={{
          background: "transparent", color: "#9ca3af",
          border: "1px solid #374151", borderRadius: 6, padding: "6px 14px", fontSize: 13, cursor: "pointer",
        }}>← Back</button>
      </div>

      <div style={{ padding: "0.1in 0" }}>
        {labels.map((label, i) => (
          <ReplenTicket key={label.locationCode} label={label} cluster={cluster} idx={i} total={labels.length} />
        ))}
      </div>
    </>
  );
}

export default function ClustersReplenPrintPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32 }}>Loading…</div>}>
      <PrintContent />
    </Suspense>
  );
}
