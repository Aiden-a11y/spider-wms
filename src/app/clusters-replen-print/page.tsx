"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { B2CCluster, B2CClusterBin } from "@/lib/b2c-cluster";

/* ── types ── */
interface ReplenEntry {
  sku: string;
  name: string;
  qty: number;
  lotNo?: string;
  expireDate?: string;
  itemCondition?: string;
  bins: number[];
}

interface LocationLabel {
  locationCode: string;
  entries: ReplenEntry[];
  totalQty: number;
}

/* ── Aggregate replenishment items by current location ── */
function buildLabels(cluster: B2CCluster): LocationLabel[] {
  const map = new Map<string, Map<string, ReplenEntry>>();

  cluster.bins.forEach((bin: B2CClusterBin) => {
    if (!bin.needsReplenishment || !bin.replenishmentItems?.length) return;
    bin.replenishmentItems.forEach((ri) => {
      const loc = ri.locationCode || "UNKNOWN";
      if (!map.has(loc)) map.set(loc, new Map());
      const skuMap = map.get(loc)!;
      if (!skuMap.has(ri.sku)) {
        skuMap.set(ri.sku, {
          sku: ri.sku, name: ri.name, qty: 0,
          lotNo: ri.lotNo, expireDate: ri.expireDate,
          itemCondition: ri.itemCondition, bins: [],
        });
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

/* ── Print CSS ── */
const CSS = `
  @media print {
    @page { size: 4in 6in; margin: 0.12in; }
    .no-print { display: none !important; }
    .label { page-break-after: always; }
    .label:last-child { page-break-after: avoid; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #e2e8f0; }
  .label {
    width: 3.76in; min-height: 5.76in; background: #fff;
    padding: 0.13in 0.15in; margin: 0.1in auto;
    border: 1px solid #ccc; display: flex; flex-direction: column; gap: 0;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  }
  .replen-header {
    display: flex; align-items: center; justify-content: center;
    background: #fef3c7; border: 2px solid #fcd34d;
    border-radius: 8px; padding: 4px 8px; margin-bottom: 0.08in;
    font-size: 8pt; font-weight: 800; color: #92400e;
    letter-spacing: 1.5px; text-transform: uppercase;
  }
  .loc-badge {
    display: flex; align-items: center; justify-content: center;
    background: #1e293b; border-radius: 10px;
    width: 100%; padding: 0.1in 0.08in; margin-bottom: 0.08in;
    font-size: 28pt; font-weight: 900; letter-spacing: 4px;
    color: #fff; font-family: 'Courier New', monospace;
    word-break: break-all; text-align: center; line-height: 1.15;
  }
  .meta-row {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 0.07in; font-size: 6pt; color: #6b7280;
  }
  .total-badge {
    background: #f97316; color: #fff; font-weight: 800;
    font-size: 9pt; padding: 2px 10px; border-radius: 12px;
  }
  .divider { border: none; border-top: 1.5px solid #e5e7eb; margin: 0.05in 0; }
  .section-label {
    font-size: 5.5pt; font-weight: 700; color: #6b7280;
    text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 0.04in;
  }
  .items-table { width: 100%; border-collapse: collapse; font-size: 6.5pt; }
  .items-table th {
    background: #f3f4f6; font-weight: 700; text-align: left;
    padding: 3px 5px; border: 1px solid #d1d5db; color: #374151;
  }
  .items-table td { padding: 3px 5px; border: 1px solid #e5e7eb; vertical-align: top; }
  .items-table .col-sku { font-family: 'Courier New', monospace; font-weight: 700; font-size: 6pt; width: 0.7in; }
  .items-table .col-qty { text-align: right; font-weight: 900; font-size: 10pt; color: #dc2626; width: 0.35in; }
  .items-table .col-name { font-size: 6pt; color: #374151; }
  .items-table .col-lot { font-family: 'Courier New', monospace; font-size: 5.5pt; color: #6b7280; width: 0.55in; }
  .bins-row {
    margin-top: 0.06in; display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
  }
  .bin-chip {
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border-radius: 4px;
    font-size: 6pt; font-weight: 900; color: #fff;
  }
  .footer {
    margin-top: auto; padding-top: 0.07in;
    border-top: 1px dashed #d1d5db;
    font-size: 5.5pt; color: #9ca3af;
    display: flex; justify-content: space-between;
  }
`;

const BIN_COLORS = [
  "#ef4444","#f97316","#eab308","#22c55e","#14b8a6",
  "#3b82f6","#8b5cf6","#ec4899","#06b6d4","#84cc16",
  "#f59e0b","#10b981","#6366f1","#a855f7","#d946ef",
  "#0ea5e9","#65a30d","#dc2626","#ea580c","#ca8a04",
  "#16a34a","#0d9488","#2563eb","#7c3aed","#db2777",
];
function binColor(n: number) { return BIN_COLORS[(n - 1) % 25]; }

/* ── Single label ── */
function ReplenLabel({ label, cluster }: { label: LocationLabel; cluster: B2CCluster }) {
  const allBins = Array.from(new Set(label.entries.flatMap((e) => e.bins))).sort((a, b) => a - b);
  const dateStr = new Date(cluster.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="label">
      {/* Replenishment banner */}
      <div className="replen-header">⚠ Replenishment Required</div>

      {/* Location */}
      <div className="loc-badge">{label.locationCode}</div>

      {/* Meta */}
      <div className="meta-row">
        <span>Cluster: {cluster.id.replace("cluster_", "")} · {dateStr}</span>
        <span className="total-badge">Total: {label.totalQty} pcs</span>
      </div>

      <hr className="divider" />

      {/* Items table */}
      <div className="section-label">Pick Items from this Location</div>
      <table className="items-table">
        <thead>
          <tr>
            <th className="col-sku">SKU</th>
            <th className="col-name">Product</th>
            <th className="col-lot">Lot / Expiry</th>
            <th className="col-qty">Qty</th>
          </tr>
        </thead>
        <tbody>
          {label.entries.map((entry, i) => (
            <tr key={entry.sku} style={{ background: i % 2 === 0 ? "#fff" : "#fffbeb" }}>
              <td className="col-sku">{entry.sku}</td>
              <td className="col-name">{entry.name || "—"}</td>
              <td className="col-lot">
                {entry.lotNo ? <div>{entry.lotNo}</div> : null}
                {entry.expireDate ? <div style={{ color: "#b45309" }}>{entry.expireDate}</div> : null}
                {!entry.lotNo && !entry.expireDate ? "—" : null}
              </td>
              <td className="col-qty">{entry.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Bins needed */}
      <div style={{ marginTop: "0.06in" }}>
        <div className="section-label" style={{ marginBottom: "0.03in" }}>For Bins</div>
        <div className="bins-row">
          {allBins.map((b) => (
            <div key={b} className="bin-chip" style={{ backgroundColor: binColor(b) }}>{b}</div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="footer">
        <span>Move to Shelf → Assign in WMS</span>
        <span>{label.entries.length} SKU{label.entries.length > 1 ? "s" : ""}</span>
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
    return <div style={{ padding: 32, fontFamily: "sans-serif", color: "#6b7280" }}>No replenishment items in this cluster.</div>;
  }

  return (
    <>
      <style>{CSS}</style>

      {/* Screen-only toolbar */}
      <div className="no-print" style={{
        background: "#1e293b", padding: "10px 20px",
        display: "flex", alignItems: "center", gap: 12,
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <span style={{ color: "white", fontFamily: "sans-serif", fontSize: 14, fontWeight: 600 }}>
          Replenishment Labels — {labels.length} location{labels.length > 1 ? "s" : ""}
        </span>
        <button onClick={() => window.print()} style={{
          background: "#f59e0b", color: "white", border: "none",
          borderRadius: 8, padding: "6px 16px", fontSize: 13, cursor: "pointer", fontWeight: 600,
        }}>Print All</button>
        <button onClick={() => window.history.back()} style={{
          background: "transparent", color: "#94a3b8",
          border: "1px solid #475569", borderRadius: 8, padding: "6px 14px", fontSize: 13, cursor: "pointer",
        }}>← Back</button>
      </div>

      <div style={{ padding: "0.1in 0" }}>
        {labels.map((label) => (
          <ReplenLabel key={label.locationCode} label={label} cluster={cluster} />
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
