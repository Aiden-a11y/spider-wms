"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Loader2, Printer } from "lucide-react";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!batchCode) { setError("No batch code"); setLoading(false); return; }
    (async () => {
      try {
        // Step 1: get orders to find the first order code
        const ordRes = await fetch("/api/wms/batch/orders", {
          method: "POST", headers, body: JSON.stringify([batchCode]),
        });
        const ordJson = await ordRes.json();
        const orders: { shippingOrderCode: string }[] = Array.isArray(ordJson?.data) ? ordJson.data : [];
        if (!orders.length) { setSkus([]); setLoading(false); return; }

        // Step 2: fetch items from first order
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
  const printedOn = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", gap: 12, background: "#fff", fontFamily: "Arial, sans-serif" }}>
      <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#94a3b8" }} />
      <span style={{ color: "#64748b", fontSize: 14 }}>Loading…</span>
    </div>
  );

  if (error) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#ef4444", fontFamily: "Arial, sans-serif" }}>
      {error}
    </div>
  );

  return (
    <>
      {/* Toolbar — hidden on print */}
      <div className="no-print" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 20px", background: "#0f172a", color: "white",
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 50,
      }}>
        <div style={{ fontSize: 13 }}>
          <span style={{ fontWeight: 700 }}>{batchName}</span>
          <span style={{ color: "#94a3b8", marginLeft: 10 }}>{orderCount} orders · {skus.length} SKU{skus.length !== 1 ? "s" : ""} · 4×6</span>
        </div>
        <button onClick={() => window.print()} style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 20px", background: "white", color: "#0f172a",
          border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
        }}>
          <Printer size={15} /> Print
        </button>
      </div>

      {/* Screen preview */}
      <div className="no-print" style={{ background: "#94a3b8", minHeight: "100vh", paddingTop: 64, paddingBottom: 40, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <Label batchName={batchName} batchCode={batchCode} dateDisplay={dateDisplay} whCode={whCode} custCode={custCode} orderCount={orderCount} skus={skus} printedOn={printedOn} />
      </div>

      {/* Print-only */}
      <div className="print-only">
        <Label batchName={batchName} batchCode={batchCode} dateDisplay={dateDisplay} whCode={whCode} custCode={custCode} orderCount={orderCount} skus={skus} printedOn={printedOn} />
      </div>

      <style>{`
        @media screen { .print-only { display: none !important; } }
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body, html { margin: 0 !important; padding: 0 !important; background: white !important; }
          @page { size: 4in 6in; margin: 0; }
        }
      `}</style>
    </>
  );
}

function Label({ batchName, batchCode, dateDisplay, whCode, custCode, orderCount, skus, printedOn }: {
  batchName: string; batchCode: string; dateDisplay: string; whCode: string; custCode: string;
  orderCount: number; skus: SkuRow[]; printedOn: string;
}) {
  return (
    <div style={{
      width: "4in", height: "6in", padding: "0.22in 0.28in",
      boxSizing: "border-box", background: "white",
      fontFamily: "Arial, sans-serif",
      display: "flex", flexDirection: "column",
      border: "1px solid #cbd5e1",
      boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
    }}>

      {/* ── Header ── */}
      <div style={{ borderBottom: "3px solid #000", paddingBottom: "3mm", marginBottom: "3mm" }}>
        <div style={{ fontSize: "6pt", fontWeight: 700, letterSpacing: "0.18em", color: "#64748b", textTransform: "uppercase", marginBottom: "2mm" }}>
          BATCH PICK TICKET
        </div>
        <div style={{ fontSize: "16pt", fontWeight: 900, color: "#000", lineHeight: 1.1, marginBottom: "1.5mm" }}>
          {batchName}
        </div>
        <div style={{ fontSize: "6.5pt", color: "#64748b", display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <span style={{ fontFamily: "'Courier New', monospace", color: "#475569" }}>{batchCode}</span>
          <span>·</span>
          <span>{dateDisplay}</span>
          <span>·</span>
          <span>{whCode}</span>
          {custCode && <><span>·</span><span>{custCode}</span></>}
        </div>
      </div>

      {/* ── Order count ── */}
      <div style={{ display: "flex", alignItems: "baseline", gap: "5px", marginBottom: "3mm" }}>
        <span style={{ fontSize: "42pt", fontWeight: 900, color: "#000", lineHeight: 1 }}>{orderCount}</span>
        <span style={{ fontSize: "13pt", fontWeight: 800, color: "#334155", letterSpacing: "0.04em" }}>ORDERS</span>
      </div>

      {/* ── Divider ── */}
      <div style={{ borderTop: "2px solid #000", marginBottom: "3mm" }} />

      {/* ── SKU Table ── */}
      <div style={{ fontSize: "7pt", fontWeight: 700, letterSpacing: "0.1em", color: "#64748b", textTransform: "uppercase", marginBottom: "2mm" }}>
        SKU LIST
      </div>

      <div style={{ flex: 1, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Arial, sans-serif" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #000" }}>
              <th style={thStyle("left", "28%")}>SKU</th>
              <th style={thStyle("left")}>Product</th>
              <th style={thStyle("right", "13%")}>/ Order</th>
              <th style={thStyle("right", "13%")}>Total</th>
              <th style={thStyle("center", "8%")}>✓</th>
            </tr>
          </thead>
          <tbody>
            {skus.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: "center", padding: "8px", fontSize: "8pt", color: "#94a3b8" }}>No SKU data</td></tr>
            ) : skus.map((row, i) => (
              <tr key={row.sku} style={{ background: i % 2 === 1 ? "#f8fafc" : "white", borderBottom: "0.5px solid #e2e8f0" }}>
                <td style={tdMono}>{row.sku}</td>
                <td style={tdName}>{row.name || "—"}</td>
                <td style={tdQty}>{row.qtyPerOrder}</td>
                <td style={tdTotal}>{row.totalQty}</td>
                <td style={tdCheck}><span style={{ display: "inline-block", width: "4mm", height: "4mm", border: "1.5px solid #94a3b8", borderRadius: "1px" }} /></td>
              </tr>
            ))}
          </tbody>
          {/* Totals row */}
          {skus.length > 0 && (
            <tfoot>
              <tr style={{ borderTop: "1.5px solid #000" }}>
                <td colSpan={2} style={{ padding: "2px 3px", fontSize: "7.5pt", fontWeight: 800, color: "#000" }}>TOTAL</td>
                <td style={{ ...tdQty, fontWeight: 800, color: "#000" }}>
                  {skus.reduce((s, r) => s + r.qtyPerOrder, 0)}
                </td>
                <td style={{ ...tdTotal, fontSize: "10pt", fontWeight: 900, color: "#000" }}>
                  {skus.reduce((s, r) => s + r.totalQty, 0)}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ── Footer ── */}
      <div style={{ borderTop: "1px solid #cbd5e1", paddingTop: "2mm", marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "5.5pt", color: "#94a3b8", fontFamily: "'Courier New', monospace" }}>{batchCode}</span>
        <span style={{ fontSize: "6pt", color: "#64748b" }}>Printed: {printedOn}</span>
        <span style={{ fontSize: "6pt", color: "#64748b" }}>□ Picked &nbsp; □ Done</span>
      </div>
    </div>
  );
}

function thStyle(align: "left" | "right" | "center", width?: string): React.CSSProperties {
  return {
    textAlign: align, padding: "2px 3px", fontSize: "6.5pt", fontWeight: 800,
    letterSpacing: "0.12em", color: "#475569", textTransform: "uppercase",
    ...(width ? { width } : {}),
  };
}

const tdMono: React.CSSProperties = {
  padding: "3px 3px", fontSize: "7.5pt", fontFamily: "'Courier New', monospace",
  fontWeight: 700, color: "#000", whiteSpace: "nowrap",
};
const tdName: React.CSSProperties = {
  padding: "3px 3px", fontSize: "7pt", color: "#334155",
  maxWidth: "1.4in", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};
const tdQty: React.CSSProperties = {
  padding: "3px 3px", fontSize: "9pt", fontWeight: 600, textAlign: "right", color: "#000",
};
const tdTotal: React.CSSProperties = {
  padding: "3px 3px", fontSize: "9.5pt", fontWeight: 900, textAlign: "right", color: "#000",
};
const tdCheck: React.CSSProperties = {
  padding: "3px 0 3px 3px", textAlign: "center",
};

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
