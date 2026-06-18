"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import type { B2CCluster, B2CClusterBin } from "@/lib/b2c-cluster";
import { binColor } from "@/lib/b2c-cluster";

/* ── helpers ── */
function str(v: unknown): string { return String(v ?? "").trim(); }
function strOr(...vals: unknown[]): string {
  for (const v of vals) { const s = str(v); if (s) return s; }
  return "";
}

function buildAddress(bin: B2CClusterBin): string[] {
  const lines: string[] = [];
  const street = strOr(bin.consigneeAddress1);
  const street2 = strOr(bin.consigneeAddress2);
  const city = strOr(bin.consigneeCity);
  const state = strOr(bin.consigneeState);
  const zip = strOr(bin.consigneeZipCode);
  const country = strOr(bin.consigneeNationalCode);

  if (street) lines.push(street);
  if (street2) lines.push(street2);

  const cityLine = [city, state].filter(Boolean).join(", ");
  const cityZipLine = [cityLine, zip].filter(Boolean).join(" ");
  if (cityZipLine) lines.push(cityZipLine);
  if (country) lines.push(country);
  return lines;
}

/* ── QR hook ── */
function useQR(text: string): string {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!text) return;
    QRCode.toDataURL(text, { width: 96, margin: 1, color: { dark: "#000", light: "#fff" } })
      .then(setUrl).catch(() => {});
  }, [text]);
  return url;
}

/* ── Print styles ── */
const CSS = `
  @media print {
    @page { size: 4in 6in; margin: 0.12in; }
    .no-print { display: none !important; }
    .ticket { page-break-after: always; }
    .ticket:last-child { page-break-after: avoid; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #e2e8f0; }
  .ticket {
    width: 3.76in; min-height: 5.76in; background: #fff;
    padding: 0.13in 0.15in; margin: 0.1in auto;
    border: 1px solid #ccc; display: flex; flex-direction: column; gap: 0;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  }
  .bin-badge {
    display: flex; align-items: center; justify-content: center;
    border-radius: 10px; width: 100%; height: 0.6in;
    font-size: 26pt; font-weight: 900; letter-spacing: 3px;
    color: white; margin-bottom: 0.07in;
  }
  .meta-row {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 0.06in; gap: 6px;
  }
  .order-block { flex: 1; min-width: 0; }
  .order-no {
    font-size: 9pt; font-weight: 800; color: #111;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .order-code-small { font-size: 6pt; color: #888; margin-top: 1px; word-break: break-all; }
  .cluster-small { font-size: 5.5pt; color: #aaa; margin-top: 1px; }
  .qr-box { width: 0.75in; height: 0.75in; flex-shrink: 0; }
  .qr-box img { width: 100%; height: 100%; display: block; }
  .qr-placeholder { width: 100%; height: 100%; background: #f5f5f5; border: 1px solid #ddd; border-radius: 4px; }
  .divider { border: none; border-top: 1px solid #e5e7eb; margin: 0.06in 0; }
  .section-label {
    font-size: 5.5pt; font-weight: 700; color: #6b7280;
    text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 0.04in;
  }
  .ship-name { font-size: 8.5pt; font-weight: 700; color: #111; margin-bottom: 2px; }
  .ship-addr { font-size: 7.5pt; color: #374151; line-height: 1.5; }
  .ship-tel { font-size: 7pt; color: #6b7280; margin-top: 2px; }
  .items-table { width: 100%; border-collapse: collapse; font-size: 6.5pt; margin-top: 0.04in; }
  .items-table th {
    background: #f3f4f6; font-weight: 700; text-align: left;
    padding: 3px 4px; border: 1px solid #d1d5db; color: #374151;
  }
  .items-table td { padding: 2px 4px; border: 1px solid #e5e7eb; vertical-align: top; }
  .items-table .col-qty { text-align: right; font-weight: 700; font-size: 8pt; }
  .items-table .col-loc { font-family: 'Courier New', monospace; font-weight: 700; font-size: 6pt; }
  .items-table .col-sku { font-family: 'Courier New', monospace; font-size: 6pt; }
  .replen-badge {
    display: inline-block; background: #fef3c7; color: #92400e;
    font-size: 5pt; font-weight: 700; padding: 1px 4px; border-radius: 3px;
    border: 1px solid #fcd34d; margin-left: 3px; vertical-align: middle;
  }
  .no-items { text-align: center; color: #9ca3af; padding: 8px; font-size: 7pt; }
  .checklist {
    margin-top: auto; padding-top: 0.07in;
    border-top: 1px dashed #d1d5db;
    display: flex; gap: 0.14in; font-size: 6.5pt; color: #6b7280;
    flex-shrink: 0;
  }
  .checklist span { display: flex; align-items: center; gap: 3px; }
`;

/* ── Single ticket ── */
function BinTicket({ bin, cluster }: { bin: B2CClusterBin; cluster: B2CCluster }) {
  const qrText = strOr(bin.orderNo, bin.orderCode);
  const qrUrl = useQR(qrText);
  const color = binColor(bin.binNo);
  const addrLines = buildAddress(bin);

  // Decide what to show in items table
  const hasItems = bin.items.length > 0;
  const hasReplenItems = !hasItems && bin.replenishmentItems && bin.replenishmentItems.length > 0;

  return (
    <div className="ticket">
      {/* Bin badge */}
      <div className="bin-badge" style={{ backgroundColor: color }}>
        BIN {bin.binNo}
      </div>

      {/* Order info + QR */}
      <div className="meta-row">
        <div className="order-block">
          {bin.orderNo && <div className="order-no">#{bin.orderNo}</div>}
          <div className="order-code-small">{bin.orderCode}</div>
          <div className="cluster-small">
            Cluster: {cluster.id.replace("cluster_", "")} · {new Date(cluster.createdAt).toLocaleDateString()}
          </div>
        </div>
        <div className="qr-box">
          {qrUrl
            ? <img src={qrUrl} alt={qrText} />
            : <div className="qr-placeholder" />}
        </div>
      </div>

      <hr className="divider" />

      {/* Ship To */}
      <div className="section-label">Ship To</div>
      <div className="ship-name">{bin.consigneeName || "—"}</div>
      {addrLines.length > 0
        ? <div className="ship-addr">{addrLines.map((l, i) => <div key={i}>{l}</div>)}</div>
        : <div className="ship-addr" style={{ color: "#9ca3af" }}>No address on file</div>}
      {bin.consigneeTelLNo && (
        <div className="ship-tel">Tel: {bin.consigneeTelLNo}</div>
      )}

      <hr className="divider" />

      {/* Items */}
      <div className="section-label">
        Items
        {bin.needsReplenishment && <span className="replen-badge">REPLENISHMENT NEEDED</span>}
      </div>
      <table className="items-table">
        <thead>
          <tr>
            <th className="col-loc">Location</th>
            <th className="col-sku">SKU</th>
            <th>Product</th>
            <th className="col-qty">Qty</th>
          </tr>
        </thead>
        <tbody>
          {hasItems && bin.items.map((item, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f9fafb" }}>
              <td className="col-loc">{item.locationCode || "—"}</td>
              <td className="col-sku">{item.sku}</td>
              <td style={{ fontSize: "6pt" }}>{item.name || "—"}</td>
              <td className="col-qty">{item.qty}</td>
            </tr>
          ))}
          {hasReplenItems && bin.replenishmentItems!.map((ri, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? "#fffbeb" : "#fef3c7" }}>
              <td className="col-loc" style={{ color: "#b45309" }}>{ri.locationCode || "—"}</td>
              <td className="col-sku" style={{ color: "#b45309" }}>{ri.sku}</td>
              <td style={{ fontSize: "6pt", color: "#92400e" }}>{ri.name || "—"}</td>
              <td className="col-qty" style={{ color: "#b45309" }}>{ri.qty}</td>
            </tr>
          ))}
          {!hasItems && !hasReplenItems && (
            <tr><td colSpan={4} className="no-items">No items assigned</td></tr>
          )}
        </tbody>
      </table>

      {/* Checklist */}
      <div className="checklist">
        <span>□ Picked</span>
        <span>□ Packed</span>
        <span>□ Shipped</span>
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
          Cluster Pick Tickets — {cluster.bins.length} bins
        </span>
        <button onClick={() => window.print()} style={{
          background: "#3b82f6", color: "white", border: "none",
          borderRadius: 8, padding: "6px 16px", fontSize: 13, cursor: "pointer", fontWeight: 600,
        }}>Print All</button>
        <button onClick={() => window.history.back()} style={{
          background: "transparent", color: "#94a3b8",
          border: "1px solid #475569", borderRadius: 8, padding: "6px 14px", fontSize: 13, cursor: "pointer",
        }}>← Back</button>
      </div>

      <div style={{ padding: "0.1in 0" }}>
        {cluster.bins.map((bin) => (
          <BinTicket key={bin.binNo} bin={bin} cluster={cluster} />
        ))}
      </div>
    </>
  );
}

export default function ClustersPrintPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32 }}>Loading…</div>}>
      <PrintContent />
    </Suspense>
  );
}
