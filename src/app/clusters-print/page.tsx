"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import type { B2CCluster, B2CClusterBin } from "@/lib/b2c-cluster";
import { binColor } from "@/lib/b2c-cluster";

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
      .then((data) => {
        if (!data) { setError("Cluster not found"); return; }
        setCluster(data as B2CCluster);
      })
      .catch(() => setError("Failed to load cluster"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (cluster) setTimeout(() => window.print(), 600);
  }, [cluster]);

  if (loading) return <div style={{ padding: 32, fontFamily: "sans-serif" }}>Loading…</div>;
  if (error || !cluster) return <div style={{ padding: 32, fontFamily: "sans-serif", color: "red" }}>{error}</div>;

  return (
    <>
      <style>{`
        @media print {
          @page { size: 4in 6in; margin: 0.15in; }
          .no-print { display: none !important; }
          .ticket { page-break-after: always; }
          .ticket:last-child { page-break-after: avoid; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        body { margin: 0; font-family: 'Courier New', monospace; background: #f5f5f5; }
        .ticket {
          width: 3.7in; min-height: 5.7in; background: white; padding: 0.15in;
          box-sizing: border-box; margin: 0.1in auto; border: 1px solid #ccc;
          display: flex; flex-direction: column;
        }
        .bin-badge {
          display: flex; align-items: center; justify-content: center;
          border-radius: 8px; width: 2in; height: 0.55in; margin: 0 auto 0.1in;
          font-size: 22pt; font-weight: 900; letter-spacing: 2px;
          color: white;
        }
        .cluster-id { font-size: 6pt; color: #999; text-align: center; margin-bottom: 0.05in; }
        .order-code { font-size: 8pt; font-weight: bold; color: #333; text-align: center; margin-bottom: 0.04in; }
        .section-title { font-size: 6pt; font-weight: bold; color: #666; text-transform: uppercase; letter-spacing: 1px; margin: 0.08in 0 0.04in; border-bottom: 1px solid #eee; padding-bottom: 0.02in; }
        .ship-to { font-size: 7.5pt; line-height: 1.5; color: #222; }
        .items-table { width: 100%; border-collapse: collapse; margin-top: 0.04in; font-size: 7pt; }
        .items-table th { background: #f5f5f5; font-weight: bold; text-align: left; padding: 2px 4px; border: 1px solid #ddd; font-size: 6.5pt; }
        .items-table td { padding: 2px 4px; border: 1px solid #eee; vertical-align: top; }
        .items-table .qty { text-align: right; font-weight: bold; }
        .checklist { margin-top: auto; padding-top: 0.08in; border-top: 1px dashed #ccc; font-size: 6.5pt; color: #555; display: flex; gap: 0.12in; }
      `}</style>

      <div className="no-print" style={{ background: "#1e293b", padding: "12px 20px", display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ color: "white", fontFamily: "sans-serif", fontSize: 14, fontWeight: 600 }}>
          Cluster Pick Tickets — {cluster.bins.length} bins
        </span>
        <button onClick={() => window.print()}
          style={{ background: "#3b82f6", color: "white", border: "none", borderRadius: 8, padding: "6px 16px", fontFamily: "sans-serif", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
          Print All
        </button>
        <button onClick={() => window.history.back()}
          style={{ background: "transparent", color: "#94a3b8", border: "1px solid #475569", borderRadius: 8, padding: "6px 14px", fontFamily: "sans-serif", fontSize: 13, cursor: "pointer" }}>
          ← Back
        </button>
      </div>

      <div style={{ padding: "0.1in 0" }}>
        {cluster.bins.map((bin) => (
          <BinTicket key={bin.binNo} bin={bin} cluster={cluster} />
        ))}
      </div>
    </>
  );
}

function BinTicket({ bin, cluster }: { bin: B2CClusterBin; cluster: B2CCluster }) {
  const color = binColor(bin.binNo);
  const addr = [
    bin.consigneeAddress1,
    bin.consigneeAddress2,
    [bin.consigneeCity, bin.consigneeState, bin.consigneeZipCode].filter(Boolean).join(", "),
    bin.consigneeNationalCode,
  ].filter(Boolean).join("\n");

  return (
    <div className="ticket">
      {/* Bin badge */}
      <div className="bin-badge" style={{ backgroundColor: color }}>
        BIN {bin.binNo}
      </div>

      <div className="cluster-id">Cluster: {cluster.id} · {new Date(cluster.createdAt).toLocaleDateString()}</div>
      <div className="order-code">
        {bin.orderNo && <span style={{ marginRight: 8 }}>#{bin.orderNo}</span>}
        <span style={{ fontSize: "7pt", color: "#666" }}>{bin.orderCode}</span>
      </div>

      {/* Ship To */}
      <div className="section-title">Ship To</div>
      <div className="ship-to">
        <strong>{bin.consigneeName || "—"}</strong>
        {addr && <><br /><span style={{ whiteSpace: "pre-line" }}>{addr}</span></>}
        {bin.consigneeTelLNo && <><br />Tel: {bin.consigneeTelLNo}</>}
      </div>

      {/* Items */}
      <div className="section-title">Items</div>
      <table className="items-table">
        <thead>
          <tr>
            <th>Location</th>
            <th>SKU</th>
            <th>Product</th>
            <th className="qty">Qty</th>
          </tr>
        </thead>
        <tbody>
          {bin.items.length === 0 && (
            <tr><td colSpan={4} style={{ textAlign: "center", color: "#999", padding: "6px" }}>No items assigned</td></tr>
          )}
          {bin.items.map((item, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#fafafa" }}>
              <td style={{ fontFamily: "monospace", fontWeight: "bold", fontSize: "6.5pt" }}>{item.locationCode || "—"}</td>
              <td style={{ fontFamily: "monospace", fontSize: "6.5pt" }}>{item.sku}</td>
              <td style={{ fontSize: "6.5pt" }}>{item.name}</td>
              <td className="qty" style={{ fontSize: "9pt" }}>{item.qty}</td>
            </tr>
          ))}
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

export default function ClustersPrintPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32 }}>Loading…</div>}>
      <PrintContent />
    </Suspense>
  );
}
