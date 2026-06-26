"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Loader2, Printer } from "lucide-react";
import QRCode from "qrcode";

type SkuRow = { sku: string; name: string; qtyPerOrder: number; totalQty: number };

function PrintInner() {
  const searchParams = useSearchParams();
  const batchCode  = searchParams.get("batchCode")  ?? "";
  const batchName  = searchParams.get("batchName")  ?? batchCode;
  const batchDate  = searchParams.get("batchDate")  ?? "";
  const whCode     = searchParams.get("warehouseCode") ?? "";
  const custCode   = searchParams.get("customerCode")  ?? "";
  const orderCount = Number(searchParams.get("orderCount") ?? 0);

  const { user } = useAuth();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  const [skus, setSkus] = useState<SkuRow[]>([]);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!batchCode) { setError("No batch code"); setLoading(false); return; }
    (async () => {
      try {
        // QR code
        const qr = await QRCode.toDataURL(batchCode, { width: 200, margin: 1, color: { dark: "#000", light: "#fff" } }).catch(() => "");
        setQrDataUrl(qr);

        // Orders → first order → items
        const ordRes = await fetch("/api/wms/batch/orders", {
          method: "POST", headers, body: JSON.stringify([batchCode]),
        });
        const ordJson = await ordRes.json();
        const orders: { shippingOrderCode: string }[] = Array.isArray(ordJson?.data) ? ordJson.data : [];
        if (!orders.length) { setSkus([]); setLoading(false); return; }

        const firstCode = orders[0].shippingOrderCode;
        const itemRes = await fetch(`/api/wms/shipping/items/${encodeURIComponent(firstCode)}`, { headers });
        const itemJson = await itemRes.json();
        const items: Record<string, unknown>[] = Array.isArray(itemJson?.data?.items) ? itemJson.data.items : [];

        setSkus(items
          .map((it) => ({
            sku: String(it.productSku ?? ""),
            name: String(it.productName ?? ""),
            qtyPerOrder: Number(it.qty ?? 0),
            totalQty: Number(it.qty ?? 0) * orderCount,
          }))
          .filter((s) => s.sku)
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally { setLoading(false); }
    })();
  }, [batchCode]); // eslint-disable-line

  const dateDisplay = batchDate.length === 8
    ? `${batchDate.slice(0, 4)}-${batchDate.slice(4, 6)}-${batchDate.slice(6, 8)}`
    : batchDate;

  const generatedAt = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    + ", " + new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const totalQty = skus.reduce((s, r) => s + r.totalQty, 0);

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", gap: 10, background: "#fff", fontFamily: "Arial, sans-serif" }}>
      <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#94a3b8" }} />
      <span style={{ color: "#64748b", fontSize: 13 }}>Loading…</span>
    </div>
  );

  if (error) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#ef4444", fontFamily: "Arial, sans-serif" }}>
      {error}
    </div>
  );

  const ticket = (
    <Ticket
      batchName={batchName} batchCode={batchCode} dateDisplay={dateDisplay}
      whCode={whCode} custCode={custCode} orderCount={orderCount}
      skus={skus} totalQty={totalQty} qrDataUrl={qrDataUrl} generatedAt={generatedAt}
    />
  );

  return (
    <>
      {/* Toolbar */}
      <div className="no-print" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 20px", background: "#0f172a", color: "white",
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 50,
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
      }}>
        <div style={{ fontSize: 13 }}>
          <span style={{ fontWeight: 700 }}>{batchName}</span>
          <span style={{ color: "#94a3b8", marginLeft: 10 }}>
            {orderCount} orders · {skus.length} SKU{skus.length !== 1 ? "s" : ""} · Total {totalQty} pcs · 4×6
          </span>
        </div>
        <button onClick={() => window.print()} style={{
          display: "flex", alignItems: "center", gap: 8, padding: "8px 20px",
          background: "white", color: "#0f172a", border: "none", borderRadius: 8,
          fontSize: 13, fontWeight: 700, cursor: "pointer",
        }}>
          <Printer size={15} /> Print
        </button>
      </div>

      {/* Screen preview */}
      <div className="no-print" style={{
        background: "#94a3b8", minHeight: "100vh", paddingTop: 68, paddingBottom: 40,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 24,
      }}>
        {ticket}
      </div>

      {/* Print-only */}
      <div className="print-only">{ticket}</div>

      <style>{`
        @media screen { .print-only { display: none !important; } }
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body, html { margin: 0 !important; padding: 0 !important; background: white !important; }
          @page { size: 4in auto; margin: 4mm; }
          .label {
            width: 100% !important; height: auto !important; min-height: 0 !important;
            padding: 0 !important; box-sizing: border-box !important;
            border: none !important; box-shadow: none !important;
          }
        }
      `}</style>
    </>
  );
}

function Ticket({ batchName, batchCode, dateDisplay, whCode, custCode, orderCount, skus, totalQty, qrDataUrl, generatedAt }: {
  batchName: string; batchCode: string; dateDisplay: string;
  whCode: string; custCode: string; orderCount: number;
  skus: SkuRow[]; totalQty: number; qrDataUrl: string; generatedAt: string;
}) {
  const F = "Arial, sans-serif";

  return (
    <div className="label" style={{
      fontFamily: F, width: "4in", minHeight: "6in", padding: "5mm",
      boxSizing: "border-box", background: "white",
      border: "1px solid #cbd5e1", boxShadow: "0 2px 12px rgba(0,0,0,0.1)",
      display: "flex", flexDirection: "column",
    }}>

      {/* ── Top header: client info + QR ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "2.5mm" }}>
        <div>
          <div style={{ fontSize: "9.5pt", fontWeight: 700, color: "#000", marginBottom: "1mm" }}>
            Client: <span style={{ fontWeight: 900 }}>{custCode || "ALL"}</span>
          </div>
          <div style={{ fontSize: "8pt", color: "#334155", lineHeight: 1.6 }}>
            Total SKU: <strong>{skus.length}</strong>
          </div>
          <div style={{ fontSize: "8pt", color: "#334155", lineHeight: 1.6 }}>
            Total Qty: <strong>{totalQty}</strong>
          </div>
          <div style={{ marginTop: "1.5mm" }}>
            <span style={{
              display: "inline-block", fontSize: "6.5pt", fontWeight: 700,
              background: "#e2e8f0", color: "#475569", padding: "1px 6px", borderRadius: 3,
              letterSpacing: "0.05em",
            }}>
              Batch Pick
            </span>
          </div>
        </div>
        {qrDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrDataUrl} alt={batchCode}
            style={{ width: "22mm", height: "22mm", flexShrink: 0, imageRendering: "pixelated" }} />
        )}
      </div>

      {/* ── Batch info rows ── */}
      <div style={{ borderTop: "1.5px solid #000", borderBottom: "1px solid #e2e8f0", padding: "2mm 0", marginBottom: "2.5mm" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontSize: "7.5pt", color: "#475569" }}>
            Batch No.: &nbsp;<span style={{ fontFamily: "'Courier New', monospace", fontWeight: 700, color: "#000", fontSize: "8pt" }}>{batchCode}</span>
          </div>
          <div style={{ fontSize: "8pt", fontWeight: 800, color: "#000" }}>
            {orderCount} orders
          </div>
        </div>
        <div style={{ fontSize: "7.5pt", color: "#475569", marginTop: "0.8mm" }}>
          Date: <strong>{dateDisplay}</strong> &nbsp;·&nbsp; WH: <strong>{whCode}</strong>
        </div>
      </div>

      {/* ── Batch name block (like "Ship To") ── */}
      <div style={{ borderLeft: "3.5px solid #3b82f6", paddingLeft: "3mm", marginBottom: "3mm" }}>
        <div style={{ fontSize: "6pt", fontWeight: 700, letterSpacing: "0.1em", color: "#94a3b8", textTransform: "uppercase", marginBottom: "1mm" }}>
          Batch Name
        </div>
        <div style={{ fontSize: "11pt", fontWeight: 900, color: "#000", lineHeight: 1.2 }}>{batchName}</div>
      </div>

      {/* ── Items table ── */}
      <div style={{ flex: 1 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: F, border: "1.5px solid #000" }}>
          <thead>
            <tr style={{ background: "#1e293b" }}>
              <th style={{ width: "8%", textAlign: "center", padding: "2mm 1.5mm", fontSize: "6.5pt", fontWeight: 800, color: "#fff", letterSpacing: "0.1em", border: "1px solid #334155", borderBottom: "1.5px solid #000" }}>#</th>
              <th style={{ textAlign: "left", padding: "2mm 1.5mm", fontSize: "6.5pt", fontWeight: 800, color: "#fff", letterSpacing: "0.1em", border: "1px solid #334155", borderBottom: "1.5px solid #000" }}>SKU / ITEM</th>
              <th style={{ width: "20%", textAlign: "center", padding: "2mm 1.5mm", fontSize: "6.5pt", fontWeight: 800, color: "#fff", letterSpacing: "0.1em", border: "1px solid #334155", borderBottom: "1.5px solid #000" }}>QTY</th>
            </tr>
          </thead>
          <tbody>
            {skus.map((row, i) => (
              <tr key={row.sku} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc", verticalAlign: "top" }}>
                <td style={{ textAlign: "center", padding: "2mm 1.5mm", fontSize: "8pt", fontWeight: 800, color: "#0f172a", border: "1px solid #cbd5e1", borderColor: "#cbd5e1" }}>{i + 1}</td>
                <td style={{ padding: "2mm 1.5mm", border: "1px solid #cbd5e1" }}>
                  <div style={{ fontFamily: "'Courier New', monospace", fontSize: "7.5pt", fontWeight: 700, color: "#000", marginBottom: "0.8mm", letterSpacing: "0.02em" }}>{row.sku}</div>
                  <div style={{ fontSize: "7pt", fontWeight: 500, color: "#334155", lineHeight: 1.3 }}>{row.name || "—"}</div>
                </td>
                <td style={{ textAlign: "center", padding: "2mm 1.5mm", border: "1px solid #cbd5e1", verticalAlign: "middle" }}>
                  <div style={{ fontSize: "10pt", fontWeight: 900, color: "#000", lineHeight: 1.1 }}>{row.totalQty}</div>
                  <div style={{ fontSize: "6pt", color: "#64748b", marginTop: "0.5mm" }}>×{orderCount} orders</div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: "#0f172a" }}>
              <td colSpan={2} style={{ padding: "2.5mm 2mm", fontSize: "8pt", fontWeight: 800, color: "#fff", textAlign: "right", letterSpacing: "0.08em", border: "1.5px solid #000" }}>TOTAL</td>
              <td style={{ padding: "2.5mm 1.5mm", fontSize: "12pt", fontWeight: 900, color: "#fff", textAlign: "center", border: "1.5px solid #000" }}>{totalQty} EA</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Footer signature lines ── */}
      <div style={{ borderTop: "1px solid #cbd5e1", paddingTop: "2.5mm", marginTop: "auto" }}>
        <div style={{ display: "flex", gap: "4mm", marginBottom: "2mm" }}>
          {["Picker", "Checked", "Date/Time"].map((label) => (
            <div key={label} style={{ flex: 1 }}>
              <div style={{ fontSize: "6pt", color: "#94a3b8", marginBottom: "1.5mm" }}>{label}</div>
              <div style={{ borderBottom: "1px solid #334155", height: "4mm" }} />
            </div>
          ))}
        </div>
        <div style={{ textAlign: "right", fontSize: "5.5pt", color: "#94a3b8" }}>
          Generated: {generatedAt}
        </div>
      </div>
    </div>
  );
}

export default function WmsBatchPrintPage() {
  return (
    <Suspense fallback={
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#fff" }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#94a3b8" }} />
      </div>
    }>
      <PrintInner />
    </Suspense>
  );
}
