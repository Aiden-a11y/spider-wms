"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import type { B2CCluster, B2CClusterBin, B2CClusterItem } from "@/lib/b2c-cluster";

/* ── helpers ── */
function str(v: unknown): string { return String(v ?? "").trim(); }

function buildAddress(bin: B2CClusterBin): string[] {
  const lines: string[] = [];
  const street = str(bin.consigneeAddress1);
  const street2 = str(bin.consigneeAddress2);
  const city = str(bin.consigneeCity);
  const state = str(bin.consigneeState);
  const zip = str(bin.consigneeZipCode);
  if (street) lines.push(street);
  if (street2) lines.push(street2);
  const cityLine = [city, state].filter(Boolean).join(", ");
  const cityZip = [cityLine, zip].filter(Boolean).join(" ");
  if (cityZip) lines.push(cityZip);
  return lines;
}

function fmtDate(s: string | undefined): string {
  if (!s) return "";
  const d = s.replace(/\D/g, "");
  if (d.length === 8) return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
  return s.slice(0, 10);
}

function useQR(text: string): string {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!text) return;
    QRCode.toDataURL(text, { width: 120, margin: 1, color: { dark: "#000", light: "#fff" } })
      .then(setUrl).catch(() => {});
  }, [text]);
  return url;
}

/* ── Single ticket ── */
function BinTicket({ bin, cluster, totalBins }: { bin: B2CClusterBin; cluster: B2CCluster; totalBins: number }) {
  const qrUrl = useQR(str(bin.orderCode));
  const addrLines = buildAddress(bin);

  const items: B2CClusterItem[] = [...bin.items].sort((a, b) =>
    (a.locationCode ?? "").localeCompare(b.locationCode ?? "")
  );
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  const totalSku = new Set(items.map((i) => i.sku)).size;

  const F = "Arial, Helvetica, sans-serif";
  const B = "1px solid #000";
  const B2 = "2px solid #000";
  const generatedAt = new Date().toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="ticket" style={{
      fontFamily: F, width: "4in", minHeight: "6in",
      padding: "4mm", boxSizing: "border-box",
      background: "#fff", border: B2,
      display: "flex", flexDirection: "column", gap: 0,
    }}>

      {/* ── Header: client/totals + BIN badge + QR ── */}
      <div style={{ borderBottom: B2, paddingBottom: "2mm", marginBottom: "2mm", display: "flex", alignItems: "flex-start", gap: "3mm" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "6.5pt", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#000", marginBottom: "1mm" }}>
            ▌ B2C CLUSTER PICK
          </div>
          <div style={{ fontSize: "7.5pt", color: "#000", lineHeight: 1.7 }}>
            <span style={{ fontWeight: 700 }}>Client: </span><span style={{ fontWeight: 900 }}>{bin.customerCode || "ALL"}</span><br />
            <span style={{ fontWeight: 700 }}>Total SKU: </span><span style={{ fontWeight: 900 }}>{totalSku}</span>
            <span style={{ fontWeight: 700, marginLeft: "4mm" }}>Total Qty: </span><span style={{ fontWeight: 900 }}>{totalQty}</span><br />
            <span style={{ fontSize: "6.5pt", color: "#555" }}>☐ Sorted by Location</span>
          </div>
        </div>

        {/* BIN badge */}
        <div style={{
          flexShrink: 0, width: "14mm", height: "14mm",
          background: "#000", color: "#fff",
          borderRadius: "3mm", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ fontSize: "5pt", fontWeight: 700, letterSpacing: "0.1em" }}>BIN</div>
          <div style={{ fontSize: "14pt", fontWeight: 900, lineHeight: 1 }}>{bin.binNo}</div>
        </div>

        {/* QR */}
        <div style={{ flexShrink: 0, width: "18mm", height: "18mm" }}>
          {qrUrl
            ? <img src={qrUrl} alt={bin.orderCode} style={{ width: "100%", height: "100%", display: "block", imageRendering: "pixelated" }} />
            : <div style={{ width: "100%", height: "100%", background: "#f5f5f5", border: B }} />}
        </div>
      </div>

      {/* ── Order info ── */}
      <div style={{ borderBottom: B, paddingBottom: "2mm", marginBottom: "2mm", fontSize: "7pt", color: "#000", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "6pt", textTransform: "uppercase", letterSpacing: "0.08em", color: "#555", marginBottom: "0.5mm" }}>Order No.</div>
          <div style={{ fontFamily: "'Courier New', monospace", fontWeight: 900, fontSize: "7.5pt" }}>{bin.orderCode}</div>
          {bin.orderNo && (
            <div style={{ marginTop: "1mm" }}>
              <span style={{ fontWeight: 700 }}>Ship: </span>
              <span style={{ fontFamily: "'Courier New', monospace", fontWeight: 700 }}>{bin.orderNo}</span>
            </div>
          )}
        </div>
        <div style={{ fontWeight: 900, fontSize: "9pt", color: "#000", textAlign: "right" }}>
          {bin.binNo}/{totalBins}
        </div>
      </div>

      {/* ── Ship To ── */}
      {(bin.consigneeName || addrLines.length > 0) && (
        <div style={{ borderBottom: B, paddingBottom: "2mm", marginBottom: "2mm" }}>
          <div style={{ fontSize: "6pt", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#555", marginBottom: "1mm" }}>Ship To</div>
          <div style={{ borderLeft: "3px solid #000", paddingLeft: "2mm" }}>
            {bin.consigneeName && (
              <div style={{ fontSize: "8pt", fontWeight: 900, color: "#000", marginBottom: "0.5mm" }}>{bin.consigneeName}</div>
            )}
            {addrLines.map((l, i) => (
              <div key={i} style={{ fontSize: "7pt", color: "#000", lineHeight: 1.5 }}>{l}</div>
            ))}
            {bin.consigneeTelLNo && (
              <div style={{ fontSize: "6.5pt", color: "#555", marginTop: "0.5mm" }}>Tel: {bin.consigneeTelLNo}</div>
            )}
          </div>
        </div>
      )}

      {/* ── Items table ── */}
      <div style={{ flex: 1 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: F }}>
          <thead>
            <tr>
              <th style={{ width: "8%", textAlign: "center", padding: "1.5mm 1mm", fontSize: "6pt", fontWeight: 900, border: B2, textTransform: "uppercase", letterSpacing: "0.08em" }}>No.</th>
              <th style={{ textAlign: "left", padding: "1.5mm 2mm", fontSize: "6pt", fontWeight: 900, border: B2, textTransform: "uppercase", letterSpacing: "0.08em" }}>Item</th>
              <th style={{ width: "14%", textAlign: "center", padding: "1.5mm 1mm", fontSize: "6pt", fontWeight: 900, border: B2, textTransform: "uppercase", letterSpacing: "0.08em" }}>Qty</th>
            </tr>
          </thead>
          <tbody>
            {items.length > 0 ? items.map((item, i) => (
              <tr key={i} style={{ verticalAlign: "top", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                <td style={{ textAlign: "center", padding: "2mm 1mm", fontSize: "8pt", fontWeight: 900, border: B, verticalAlign: "middle" }}>{i + 1}</td>
                <td style={{ padding: "1.5mm 2mm", border: B }}>
                  <div style={{ fontSize: "7pt", color: "#000", lineHeight: 1.8 }}>
                    <span style={{ fontWeight: 700 }}>Location: </span>
                    <span style={{ fontFamily: "'Courier New', monospace", fontWeight: 700 }}>{item.locationCode || "—"}</span>
                  </div>
                  <div style={{ fontSize: "7pt", color: "#000", lineHeight: 1.8 }}>
                    <span style={{ fontWeight: 700 }}>SKU: </span>
                    <span style={{ fontFamily: "'Courier New', monospace" }}>{item.sku}</span>
                  </div>
                  {(item.lotNo || item.expireDate) && (
                    <div style={{ fontSize: "6.5pt", color: "#000", lineHeight: 1.8 }}>
                      {item.lotNo && <><span style={{ fontWeight: 700 }}>Lot: </span><span style={{ fontFamily: "'Courier New', monospace" }}>{item.lotNo}</span></>}
                      {item.lotNo && item.expireDate && <span style={{ margin: "0 2mm" }} />}
                      {item.expireDate && <><span style={{ fontWeight: 700 }}>Exp: </span><span style={{ fontFamily: "'Courier New', monospace" }}>{fmtDate(item.expireDate)}</span></>}
                    </div>
                  )}
                </td>
                <td style={{ textAlign: "center", padding: "2mm 1mm", fontSize: "9pt", fontWeight: 900, border: B, verticalAlign: "middle", whiteSpace: "nowrap" }}>
                  {item.qty} EA
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={3} style={{ textAlign: "center", padding: "4mm", fontSize: "7pt", color: "#9ca3af", border: B }}>
                  No items assigned
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ padding: "2mm 2mm", fontSize: "8pt", fontWeight: 900, textAlign: "right", border: B2, borderTop: B2, letterSpacing: "0.08em" }}>TOTAL</td>
              <td style={{ textAlign: "center", padding: "2mm 1mm", fontSize: "10pt", fontWeight: 900, border: B2, borderTop: B2, whiteSpace: "nowrap" }}>{totalQty} EA</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Footer ── */}
      <div style={{ borderTop: B2, paddingTop: "2.5mm", marginTop: "3mm" }}>
        <div style={{ display: "flex", gap: "3mm", marginBottom: "1.5mm" }}>
          {["Picker", "Checked", "Date/Time"].map((label) => (
            <div key={label} style={{ flex: 1 }}>
              <div style={{ fontSize: "6pt", fontWeight: 700, color: "#000", marginBottom: "1.5mm", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
              <div style={{ borderBottom: B2, height: "5mm" }} />
            </div>
          ))}
        </div>
        <div style={{ textAlign: "right", fontSize: "5pt", color: "#000", marginTop: "1mm" }}>
          Generated: {generatedAt}
        </div>
      </div>
    </div>
  );
}

/* ── Main content ── */
function PrintContent() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const idsParam = params.get("ids") ?? "";

  const [clusters, setClusters] = useState<B2CCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const ids = idsParam ? idsParam.split(",").map((s) => s.trim()).filter(Boolean)
                         : id ? [id] : [];
    if (ids.length === 0) { setError("No cluster ID"); setLoading(false); return; }

    Promise.all(
      ids.map((cid) =>
        fetch(`/api/cluster?id=${encodeURIComponent(cid)}`)
          .then((r) => r.json())
          .then((data) => data as B2CCluster | null)
          .catch(() => null)
      )
    ).then((results) => {
      const valid = results.filter(Boolean) as B2CCluster[];
      if (valid.length === 0) setError("No clusters found");
      else setClusters(valid);
    }).finally(() => setLoading(false));
  }, [id, idsParam]);

  useEffect(() => {
    if (clusters.length > 0) setTimeout(() => window.print(), 800);
  }, [clusters]);

  if (loading) return <div style={{ padding: 32, fontFamily: "sans-serif" }}>Loading…</div>;
  if (error || clusters.length === 0) return <div style={{ padding: 32, fontFamily: "sans-serif", color: "red" }}>{error || "Not found"}</div>;

  const totalBins = clusters.reduce((s, c) => s + c.bins.length, 0);

  return (
    <>
      <style>{`
        @media print {
          @page { size: 4in 6in; margin: 3mm; }
          .no-print { display: none !important; }
          .ticket {
            width: 100% !important; min-height: 0 !important; height: auto !important;
            box-sizing: border-box !important;
            border: none !important; box-shadow: none !important;
            page-break-after: always; break-after: page;
          }
          .ticket:last-child { page-break-after: avoid; break-after: avoid; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          tr { page-break-inside: avoid; break-inside: avoid; }
        }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #e2e8f0; }
        .ticket { margin: 0.1in auto; box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
      `}</style>

      {/* Screen-only toolbar */}
      <div className="no-print" style={{
        background: "#1e293b", padding: "10px 20px",
        display: "flex", alignItems: "center", gap: 12,
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <span style={{ color: "white", fontFamily: "sans-serif", fontSize: 14, fontWeight: 600 }}>
          Cluster Pick Tickets
          {clusters.length === 1 && clusters[0].clusterNo != null && ` — #${String(clusters[0].clusterNo).padStart(4, "0")}`}
          {clusters.length > 1 && ` — ${clusters.length} clusters`}
          {" · "}{totalBins} bins total
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
        {clusters.map((cluster) =>
          cluster.bins.map((bin) => (
            <BinTicket key={`${cluster.id}-${bin.binNo}`} bin={bin} cluster={cluster} totalBins={cluster.bins.length} />
          ))
        )}
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
