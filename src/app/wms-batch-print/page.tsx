"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Loader2, Printer } from "lucide-react";
import QRCode from "qrcode";

type SkuRow = { sku: string; name: string; qtyPerOrder: number; totalQty: number };

type BatchTicketData = {
  batchCode: string; batchName: string; dateDisplay: string;
  whCode: string; custCode: string; orderCount: number;
  skus: SkuRow[]; totalQty: number; qrDataUrl: string;
};

function PrintInner() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  // Support both single batchCode and multiple batchCodes (comma-separated)
  const batchCodesParam = searchParams.get("batchCodes") ?? "";
  const singleCode      = searchParams.get("batchCode")  ?? "";
  const allCodes = batchCodesParam
    ? batchCodesParam.split(",").map((s) => s.trim()).filter(Boolean)
    : singleCode ? [singleCode] : [];

  const [tickets, setTickets] = useState<BatchTicketData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const generatedAt = useMemo(() =>
    new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    + ", " + new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
  , []);

  useEffect(() => {
    if (allCodes.length === 0) { setError("No batch code"); setLoading(false); return; }

    // For single-batch from individual print button, batchName/date/etc come from query params
    const singleName  = searchParams.get("batchName")  ?? singleCode;
    const singleDate  = searchParams.get("batchDate")  ?? "";
    const singleWh    = searchParams.get("warehouseCode") ?? "";
    const singleCust  = searchParams.get("customerCode")  ?? "";
    const singleCount = Number(searchParams.get("orderCount") ?? 0);

    (async () => {
      try {
        const results = await Promise.all(allCodes.map(async (code, idx) => {
          const isFirst = allCodes.length === 1;
          const batchName   = isFirst ? singleName  : code;
          const batchDate   = isFirst ? singleDate  : "";
          const whCode      = isFirst ? singleWh    : searchParams.get("warehouseCode") ?? "";
          const custCode    = isFirst ? singleCust  : searchParams.get("customerCode")  ?? "";
          let   orderCount  = isFirst ? singleCount : 0;

          const [qrDataUrl, ordJson] = await Promise.all([
            QRCode.toDataURL(code, { width: 200, margin: 1, color: { dark: "#000", light: "#fff" } }).catch(() => ""),
            fetch("/api/wms/batch/orders", { method: "POST", headers, body: JSON.stringify([code]) }).then((r) => r.json()).catch(() => ({})),
          ]);

          const orders: { shippingOrderCode: string }[] = Array.isArray(ordJson?.data) ? ordJson.data : [];
          if (!orderCount) orderCount = orders.length;

          let skus: SkuRow[] = [];
          if (orders.length > 0) {
            const itemRes = await fetch(`/api/wms/shipping/items/${encodeURIComponent(orders[0].shippingOrderCode)}`, { headers });
            const itemJson = await itemRes.json().catch(() => ({}));
            const items: Record<string, unknown>[] = Array.isArray(itemJson?.data?.items) ? itemJson.data.items : [];
            skus = items
              .map((it) => ({
                sku: String(it.productSku ?? ""),
                name: String(it.productName ?? ""),
                qtyPerOrder: Number(it.qty ?? 0),
                totalQty: Number(it.qty ?? 0) * orderCount,
              }))
              .filter((s) => s.sku);
          }

          const dateDisplay = batchDate.length === 8
            ? `${batchDate.slice(0,4)}-${batchDate.slice(4,6)}-${batchDate.slice(6,8)}`
            : batchDate;

          return { batchCode: code, batchName, dateDisplay, whCode, custCode, orderCount, skus, totalQty: skus.reduce((s, r) => s + r.totalQty, 0), qrDataUrl } satisfies BatchTicketData;
        }));
        setTickets(results);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally { setLoading(false); }
    })();
  }, []); // eslint-disable-line

  useEffect(() => {
    if (tickets.length > 0) setTimeout(() => window.print(), 600);
  }, [tickets]);

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", gap: 10, background: "#fff", fontFamily: "Arial, sans-serif" }}>
      <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#94a3b8" }} />
      <span style={{ color: "#64748b", fontSize: 13 }}>Loading {allCodes.length} batch{allCodes.length !== 1 ? "es" : ""}…</span>
    </div>
  );

  if (error || tickets.length === 0) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#ef4444", fontFamily: "Arial, sans-serif" }}>
      {error || "No data"}
    </div>
  );

  const ticketEls = tickets.map((t) => (
    <Ticket key={t.batchCode}
      batchName={t.batchName} batchCode={t.batchCode} dateDisplay={t.dateDisplay}
      whCode={t.whCode} custCode={t.custCode} orderCount={t.orderCount}
      skus={t.skus} totalQty={t.totalQty} qrDataUrl={t.qrDataUrl} generatedAt={generatedAt}
    />
  ));

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
          <span style={{ fontWeight: 700 }}>
            {tickets.length === 1 ? tickets[0].batchName : `${tickets.length} batches`}
          </span>
          <span style={{ color: "#94a3b8", marginLeft: 10 }}>
            {tickets.reduce((s, t) => s + t.orderCount, 0)} orders total · 4×6
          </span>
        </div>
        <button onClick={() => window.print()} style={{
          display: "flex", alignItems: "center", gap: 8, padding: "8px 20px",
          background: "white", color: "#0f172a", border: "none", borderRadius: 8,
          fontSize: 13, fontWeight: 700, cursor: "pointer",
        }}>
          <Printer size={15} /> Print All ({tickets.length})
        </button>
      </div>

      {/* Screen preview */}
      <div className="no-print" style={{
        background: "#94a3b8", minHeight: "100vh", paddingTop: 68, paddingBottom: 40,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 24,
      }}>
        {ticketEls}
      </div>

      {/* Print-only */}
      <div className="print-only">{ticketEls}</div>

      <style>{`
        @media screen { .print-only { display: none !important; } }
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body, html { margin: 0 !important; padding: 0 !important; background: white !important; }
          @page { size: 4in 6in; margin: 3mm; }
          .label {
            width: 100% !important; min-height: 0 !important; height: auto !important;
            box-sizing: border-box !important;
            border: none !important; box-shadow: none !important;
            page-break-after: always; break-after: page;
          }
          .label:last-child { page-break-after: avoid; break-after: avoid; }
          tr { page-break-inside: avoid; break-inside: avoid; }
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
  const B = "1px solid #000";
  const B2 = "2px solid #000";

  return (
    <div className="label" style={{
      fontFamily: F, width: "4in", minHeight: "6in", padding: "4mm",
      boxSizing: "border-box", background: "#fff",
      border: "2px solid #000",
      display: "flex", flexDirection: "column", gap: 0,
    }}>

      {/* ── Top: BATCH PICK banner ── */}
      <div style={{ borderBottom: B2, paddingBottom: "2mm", marginBottom: "2mm", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: "7pt", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#000", marginBottom: "1mm" }}>
            ▌ BATCH PICK TICKET
          </div>
          <div style={{ fontSize: "8pt", fontWeight: 900, color: "#000" }}>
            {batchName}
          </div>
        </div>
        {qrDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrDataUrl} alt={batchCode}
            style={{ width: "20mm", height: "20mm", flexShrink: 0, imageRendering: "pixelated" }} />
        )}
      </div>

      {/* ── Info grid (2×2 table) ── */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "3mm", fontSize: "7.5pt", color: "#000" }}>
        <tbody>
          <tr>
            <td style={{ border: B, padding: "1.5mm 2mm", width: "50%", fontWeight: 700 }}>
              Batch No.<br />
              <span style={{ fontFamily: "'Courier New', monospace", fontWeight: 900, fontSize: "8pt" }}>{batchCode}</span>
            </td>
            <td style={{ border: B, padding: "1.5mm 2mm" }}>
              <span style={{ fontWeight: 700 }}>Client: </span><span style={{ fontWeight: 900 }}>{custCode || "ALL"}</span><br />
              <span style={{ fontWeight: 700 }}>WH: </span><span style={{ fontWeight: 900 }}>{whCode}</span>
            </td>
          </tr>
          <tr>
            <td style={{ border: B, padding: "1.5mm 2mm" }}>
              <span style={{ fontWeight: 700 }}>Date: </span><span style={{ fontWeight: 900 }}>{dateDisplay}</span><br />
              <span style={{ fontWeight: 700 }}>Orders: </span><span style={{ fontWeight: 900 }}>{orderCount}</span>
            </td>
            <td style={{ border: B, padding: "1.5mm 2mm" }}>
              <span style={{ fontWeight: 700 }}>Total SKU: </span><span style={{ fontWeight: 900 }}>{skus.length}</span><br />
              <span style={{ fontWeight: 700 }}>Total Qty: </span><span style={{ fontWeight: 900 }}>{totalQty} EA</span>
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── Items table ── */}
      <div style={{ flex: 1 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: F }}>
          <thead>
            <tr>
              <th style={{ width: "8%", textAlign: "center", padding: "2mm 1mm", fontSize: "6.5pt", fontWeight: 900, color: "#000", letterSpacing: "0.1em", border: B2, borderBottom: B2, textTransform: "uppercase" }}>#</th>
              <th style={{ textAlign: "left", padding: "2mm 1.5mm", fontSize: "6.5pt", fontWeight: 900, color: "#000", letterSpacing: "0.1em", border: B2, borderBottom: B2, textTransform: "uppercase" }}>SKU / Item</th>
              <th style={{ width: "22%", textAlign: "center", padding: "2mm 1mm", fontSize: "6.5pt", fontWeight: 900, color: "#000", letterSpacing: "0.1em", border: B2, borderBottom: B2, textTransform: "uppercase" }}>Qty</th>
              <th style={{ width: "12%", textAlign: "center", padding: "2mm 1mm", fontSize: "6.5pt", fontWeight: 900, color: "#000", letterSpacing: "0.1em", border: B2, borderBottom: B2, textTransform: "uppercase" }}>✓</th>
            </tr>
          </thead>
          <tbody>
            {skus.map((row, i) => (
              <tr key={row.sku} style={{ verticalAlign: "top" }}>
                <td style={{ textAlign: "center", padding: "2mm 1mm", fontSize: "8pt", fontWeight: 900, color: "#000", border: B }}>{i + 1}</td>
                <td style={{ padding: "2mm 1.5mm", border: B }}>
                  <div style={{ fontFamily: "'Courier New', monospace", fontSize: "8pt", fontWeight: 900, color: "#000", letterSpacing: "0.02em" }}>{row.sku}</div>
                  <div style={{ fontSize: "6.5pt", fontWeight: 500, color: "#000", lineHeight: 1.3, marginTop: "0.5mm" }}>{row.name || "—"}</div>
                </td>
                <td style={{ textAlign: "center", padding: "2mm 1mm", border: B, verticalAlign: "middle" }}>
                  <div style={{ fontSize: "11pt", fontWeight: 900, color: "#000" }}>{row.totalQty}</div>
                  <div style={{ fontSize: "5.5pt", color: "#000", marginTop: "0.3mm" }}>×{orderCount}</div>
                </td>
                <td style={{ border: B }} />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ padding: "2mm 1.5mm", fontSize: "8.5pt", fontWeight: 900, color: "#000", textAlign: "right", border: B2, borderTop: B2, letterSpacing: "0.1em" }}>TOTAL</td>
              <td style={{ padding: "2mm 1mm", fontSize: "13pt", fontWeight: 900, color: "#000", textAlign: "center", border: B2, borderTop: B2 }}>{totalQty}</td>
              <td style={{ border: B2, borderTop: B2 }} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Footer signature lines ── */}
      <div style={{ borderTop: B2, paddingTop: "2.5mm", marginTop: "3mm" }}>
        <div style={{ display: "flex", gap: "3mm", marginBottom: "1.5mm" }}>
          {["Picker", "Checked", "Date / Time"].map((label) => (
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
