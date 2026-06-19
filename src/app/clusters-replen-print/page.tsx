"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { B2CCluster, B2CClusterBin } from "@/lib/b2c-cluster";

/* ── Aggregate replenishment items by location ── */
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

/* ── Single 4×6 ticket ── */
function ReplenTicket({ label, cluster, idx, total }: {
  label: LocationLabel; cluster: B2CCluster; idx: number; total: number;
}) {
  const allBins = Array.from(new Set(label.entries.flatMap((e) => e.bins))).sort((a, b) => a - b);
  const dateStr = new Date(cluster.createdAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });

  return (
    <div className="ticket">
      {/* ── Top strip: title + meta ── */}
      <div className="top-strip">
        <div className="top-left">
          <div className="ticket-title">REPLENISHMENT</div>
          <div className="ticket-sub">Move to Shelf · Pick for Cluster</div>
        </div>
        <div className="top-right">
          <div className="page-num">{idx + 1} / {total}</div>
          <div className="meta-line">{dateStr}</div>
          <div className="meta-line">{cluster.warehouseCode}</div>
        </div>
      </div>

      {/* ── From location ── */}
      <div className="loc-block">
        <div className="loc-label">FROM LOCATION</div>
        <div className="loc-value">{label.locationCode}</div>
      </div>

      {/* ── Bins involved ── */}
      <div className="bins-row">
        <span className="bins-label">BINS:</span>
        <div className="bins-chips">
          {allBins.map((bn) => (
            <span key={bn} className="bin-chip">{bn}</span>
          ))}
        </div>
      </div>

      <div className="divider" />

      {/* ── Items table ── */}
      <table className="items-table">
        <thead>
          <tr>
            <th className="th th-no">#</th>
            <th className="th th-sku">SKU</th>
            <th className="th th-name">PRODUCT</th>
            <th className="th th-qty">QTY</th>
          </tr>
        </thead>
        <tbody>
          {label.entries.map((entry, i) => (
            <tr key={entry.sku} className={i % 2 === 0 ? "tr-even" : "tr-odd"}>
              <td className="td td-no">{i + 1}</td>
              <td className="td td-sku">{entry.sku}</td>
              <td className="td td-name">
                <div className="name-text">{entry.name || "—"}</div>
                {(entry.lotNo || entry.expireDate) && (
                  <div className="lot-text">
                    {entry.lotNo ? `Lot: ${entry.lotNo}` : ""}
                    {entry.lotNo && entry.expireDate ? " · " : ""}
                    {entry.expireDate ? `Exp: ${entry.expireDate}` : ""}
                  </div>
                )}
              </td>
              <td className="td td-qty">{entry.qty}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="tr-total">
            <td colSpan={3} className="td-total-label">TOTAL QTY</td>
            <td className="td-total-val">{label.totalQty}</td>
          </tr>
        </tfoot>
      </table>

      {/* ── Footer: signature lines ── */}
      <div className="footer">
        <div className="sig-row">
          <div className="sig-box"><div className="sig-label">Picker</div><div className="sig-line" /></div>
          <div className="sig-box"><div className="sig-label">Checked</div><div className="sig-line" /></div>
          <div className="sig-box"><div className="sig-label">Time</div><div className="sig-line" /></div>
        </div>
      </div>
    </div>
  );
}

/* ── Print CSS ── */
const CSS = `
  @page { size: 4in 6in; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #d1d5db; font-family: Arial, Helvetica, sans-serif; }
  @media print {
    body { background: white; }
    .no-print { display: none !important; }
    .ticket { page-break-after: always; box-shadow: none !important; margin: 0 !important; border: none !important; }
    .ticket:last-child { page-break-after: avoid; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }

  /* ── Ticket wrapper ── */
  .ticket {
    width: 4in; height: 6in;
    background: #fff;
    padding: 0.18in 0.2in;
    margin: 0.15in auto;
    box-shadow: 0 2px 12px rgba(0,0,0,0.2);
    display: flex; flex-direction: column; gap: 0.06in;
    overflow: hidden;
  }

  /* ── Top strip ── */
  .top-strip {
    display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 2.5px solid #000; padding-bottom: 0.08in;
  }
  .ticket-title {
    font-size: 13pt; font-weight: 900; letter-spacing: 1px; color: #000;
  }
  .ticket-sub { font-size: 7pt; color: #555; margin-top: 2px; letter-spacing: 0.3px; }
  .top-right { text-align: right; }
  .page-num { font-size: 8pt; font-weight: 700; color: #000; }
  .meta-line { font-size: 6.5pt; color: #555; line-height: 1.5; }

  /* ── Location ── */
  .loc-block {
    border: 2.5px solid #000;
    padding: 0.04in 0.1in 0.06in;
    background: #000;
  }
  .loc-label {
    font-size: 6pt; font-weight: 700; letter-spacing: 1.5px;
    color: #aaa; text-transform: uppercase; margin-bottom: 1px;
  }
  .loc-value {
    font-size: 22pt; font-weight: 900;
    font-family: 'Courier New', monospace;
    letter-spacing: 2px; color: #fff; line-height: 1.1;
    word-break: break-all;
  }

  /* ── Bins ── */
  .bins-row {
    display: flex; align-items: center; gap: 0.08in;
  }
  .bins-label {
    font-size: 7pt; font-weight: 700; color: #333; white-space: nowrap;
  }
  .bins-chips { display: flex; flex-wrap: wrap; gap: 3px; }
  .bin-chip {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 18px; height: 18px; padding: 0 4px;
    border: 1.5px solid #000; border-radius: 3px;
    font-size: 8pt; font-weight: 900; color: #000;
  }

  .divider { border-top: 1px solid #ccc; }

  /* ── Items table ── */
  .items-table {
    width: 100%; border-collapse: collapse; flex: 1;
  }
  .th {
    background: #111; color: #fff;
    font-size: 7pt; font-weight: 700;
    padding: 4px 5px; text-align: left;
    border: 1px solid #000; letter-spacing: 0.5px;
  }
  .th-no  { width: 0.18in; text-align: center; }
  .th-sku { width: 1.05in; }
  .th-qty { width: 0.38in; text-align: right; }

  .tr-even td { background: #fff; }
  .tr-odd  td { background: #f3f4f6; }
  .td {
    padding: 5px 5px; border: 1px solid #ccc;
    vertical-align: middle;
  }
  .td-no  { text-align: center; font-size: 8pt; font-weight: 700; color: #555; }
  .td-sku {
    font-family: 'Courier New', monospace;
    font-size: 8pt; font-weight: 900; color: #000;
    word-break: break-all;
  }
  .td-name { }
  .name-text { font-size: 7.5pt; color: #111; line-height: 1.3; }
  .lot-text  { font-size: 6pt; color: #666; margin-top: 1px; font-family: 'Courier New', monospace; }
  .td-qty {
    text-align: right;
    font-size: 13pt; font-weight: 900; color: #000;
    white-space: nowrap;
  }

  /* ── Total row ── */
  .tr-total .td-total-label {
    background: #111 !important; color: #fff;
    font-size: 7pt; font-weight: 700; text-align: right;
    padding: 4px 6px; border: 1px solid #000;
    letter-spacing: 0.5px;
  }
  .tr-total .td-total-val {
    background: #111 !important; color: #fff;
    font-size: 14pt; font-weight: 900; text-align: right;
    padding: 4px 5px; border: 1px solid #000;
  }

  /* ── Footer ── */
  .footer {
    margin-top: auto;
    border-top: 1.5px solid #000;
    padding-top: 0.07in;
  }
  .sig-row { display: flex; gap: 0.1in; }
  .sig-box { flex: 1; }
  .sig-label { font-size: 6pt; color: #555; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; }
  .sig-line  { border-bottom: 1px solid #000; height: 14px; }
`;

/* ── Main ── */
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
    if (cluster) setTimeout(() => window.print(), 600);
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
          Replenishment — {labels.length} location{labels.length !== 1 ? "s" : ""}
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

      <div style={{ paddingBottom: "0.2in" }}>
        {labels.map((label, i) => (
          <ReplenTicket
            key={label.locationCode}
            label={label}
            cluster={cluster}
            idx={i}
            total={labels.length}
          />
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
