"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Loader2, Printer, AlertCircle, ArrowLeft } from "lucide-react";
import QRCode from "qrcode";
import type { Batch } from "@/app/api/batch/route";

type OrderTicket = {
  orderCode: string;
  customerCode: string;
  consigneeName: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  tel: string;
  items: { sku: string; name: string; qty: number }[];
  qrDataUrl: string;
};

function f(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

const MONO = "'Courier New', Courier, monospace";

function PrintInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const batchId = searchParams.get("id") ?? "";
  const { user } = useAuth();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  const [batch, setBatch] = useState<Batch | null>(null);
  const [tickets, setTickets] = useState<OrderTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadedCount, setLoadedCount] = useState(0);

  useEffect(() => {
    if (!batchId) { setError("No batch ID"); setLoading(false); return; }

    fetch("/api/batch")
      .then((r) => r.json())
      .then(async (data: Batch[]) => {
        const found = Array.isArray(data) ? data.find((b) => b.id === batchId) : null;
        if (!found) { setError("Batch not found"); setLoading(false); return; }
        setBatch(found);

        // ── Step 1: bulk fetch order list to build address lookup map ──────────
        function extractList(json: unknown): Record<string, unknown>[] {
          if (!json || typeof json !== "object") return [];
          const j = json as Record<string, unknown>;
          const arr =
            (j.data as Record<string, unknown>)?.list ??
            (j.data as Record<string, unknown>)?.items ??
            j.data ??
            j.list ??
            j.items ??
            (Array.isArray(j) ? j : []);
          return Array.isArray(arr) ? arr as Record<string, unknown>[] : [];
        }

        const orderMap = new Map<string, Record<string, unknown>>();
        const custCodesSet = found.orders.map((o) => o.customerCode).filter(Boolean);
        const custCodes = custCodesSet.filter((v, i, a) => a.indexOf(v) === i);

        const orderType = found.type?.toUpperCase();

        // Try bulk list endpoints — one call covers all orders of same type/warehouse
        for (const body of [
          { page: 1, pageSize: 500, warehouseCode: found.warehouseCode, orderType },
          { page: 1, pageSize: 500, warehouseCode: found.warehouseCode, orderType, customerCode: custCodes[0] },
          { page: 1, pageSize: 500, warehouseCode: found.warehouseCode },
        ]) {
          for (const ep of [
            `/api/wms/shipping/${found.type}/list`,
            `/api/wms/shipping/list`,
            `/api/wms/outbound/list`,
          ]) {
            try {
              const res = await fetch(ep, { method: "POST", headers, body: JSON.stringify(body) });
              const json = await res.json().catch(() => null);
              if (!res.ok || !json) continue;
              const list = extractList(json);
              list.forEach((o) => {
                const oc = String(o.shippingOrderCode ?? o.orderCode ?? o.outboundCode ?? "");
                if (oc && !orderMap.has(oc)) orderMap.set(oc, o);
              });
              if (orderMap.size > 0) break;
            } catch { /* try next */ }
          }
          if (orderMap.size > 0) break;
        }

        const results = await Promise.all(
          found.orders.map(async (order) => {
            const code = order.orderCode;
            let orderData: Record<string, unknown> = orderMap.get(code) ?? {};
            let items: { sku: string; name: string; qty: number }[] = [];

            // If not found in list, try individual detail endpoints
            if (!f(orderData, "consigneeName", "receiverName", "consigneeAddress1", "deliveryAddress")) {
              for (const ep of [
                `/api/wms/shipping/${encodeURIComponent(code)}`,                        // confirmed 200 OK
                `/api/wms/shipping/${found.type}/${encodeURIComponent(code)}`,
                `/api/wms/shipping/${found.type}/detail/${encodeURIComponent(code)}`,
                `/api/wms/shipping/detail/${encodeURIComponent(code)}`,
                `/api/wms/outbound/${found.type}/detail/${encodeURIComponent(code)}`,
                `/api/wms/outbound/detail/${encodeURIComponent(code)}`,
              ]) {
                try {
                  const res = await fetch(ep, { headers });
                  const json = await res.json().catch(() => null) as Record<string, unknown> | null;
                  if (!res.ok || !json) continue;
                  const d = ((json?.data ?? json) as Record<string, unknown>);
                  if (f(d, "consigneeName", "receiverName", "consigneeAddress1", "deliveryAddress")) {
                    orderData = d; break;
                  }
                } catch { /* try next */ }
              }
            }

            // Items: try items endpoint first, then assignments
            for (const ep of [
              `/api/wms/shipping/items/${encodeURIComponent(code)}`,
              `/api/wms/shipping/${found.type}/items/${encodeURIComponent(code)}`,
            ]) {
              try {
                const res = await fetch(ep, { headers });
                const json = await res.json().catch(() => null) as Record<string, unknown> | null;
                if (!res.ok || !json) continue;
                const d = (json?.data ?? json) as Record<string, unknown>;
                const arr = Array.isArray(d.items) ? d.items : Array.isArray(d.assignments) ? d.assignments : null;
                if (Array.isArray(arr) && arr.length > 0) {
                  items = (arr as Record<string, unknown>[]).map((it) => ({
                    sku:  String(it.productSku ?? it.sku ?? ""),
                    name: String(it.productName ?? it.name ?? it.itemName ?? ""),
                    qty:  Number(it.qty ?? it.quantity ?? it.orderQty ?? 0),
                  })).filter((it) => it.sku);
                  break;
                }
              } catch { /* try next */ }
            }

            if (items.length === 0) {
              items = found.skuList.map((s) => ({ sku: s.sku, name: s.name, qty: s.qty }));
            }

            const qrDataUrl = await QRCode.toDataURL(code, {
              width: 160, margin: 1,
              color: { dark: "#000000", light: "#ffffff" },
            }).catch(() => "");

            setLoadedCount((c) => c + 1);

            return {
              orderCode: code, customerCode: order.customerCode,
              consigneeName: f(orderData, "consigneeName", "receiverName", "customerName"),
              address1:      f(orderData, "consigneeAddress1", "deliveryAddress"),
              address2:      f(orderData, "consigneeAddress2"),
              city:          f(orderData, "consigneeCity"),
              state:         f(orderData, "consigneeState"),
              zip:           f(orderData, "consigneeZipCode", "zipCode"),
              country:       f(orderData, "consigneeNationalCode", "country"),
              tel:           f(orderData, "consigneeTelLNo", "consigneeTelLno", "consigneeCellNo"),
              items, qrDataUrl,
            } as OrderTicket;
          })
        );

        setTickets(results);
        setLoading(false);
      })
      .catch((e) => { setError(e.message ?? "Failed"); setLoading(false); });
  }, [batchId]); // eslint-disable-line

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "white", fontFamily: MONO }}>
      <Loader2 className="w-10 h-10 animate-spin text-slate-400" />
      <p style={{ color: "#64748b", fontSize: 14 }}>
        {batch ? `Loading ${loadedCount} / ${batch.orderCount} orders…` : "Loading batch…"}
      </p>
    </div>
  );

  if (error) return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "white" }}>
      <AlertCircle className="w-10 h-10 text-red-400" />
      <p style={{ color: "#ef4444", fontSize: 14 }}>{error}</p>
      <button onClick={() => router.back()} style={{ color: "#3b82f6", fontSize: 14 }}>← Back</button>
    </div>
  );

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

  return (
    <>
      {/* Toolbar — hidden on print */}
      <div className="no-print" style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 50,
        background: "#0f172a", color: "white",
        padding: "10px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={() => router.back()}
            style={{ display: "flex", alignItems: "center", gap: 6, color: "#94a3b8", fontSize: 13, background: "none", border: "none", cursor: "pointer", padding: "4px 8px", borderRadius: 6 }}
            onMouseOver={(e) => (e.currentTarget.style.color = "white")}
            onMouseOut={(e) => (e.currentTarget.style.color = "#94a3b8")}
          >
            <ArrowLeft size={16} /> Back
          </button>
          <div style={{ width: 1, height: 20, background: "#334155" }} />
          <div>
            <p style={{ fontWeight: 600, fontSize: 13, margin: 0 }}>Pick Tickets — {tickets.length} orders</p>
            <p style={{ color: "#94a3b8", fontSize: 11, margin: 0 }}>
              {batch?.skuList.map(({ sku, qty }) => `${sku} ×${qty}`).join(" · ")} · 4×6 label per order
            </p>
          </div>
        </div>
        <button
          onClick={() => window.print()}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 20px", background: "white", color: "#0f172a",
            border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}
        >
          <Printer size={15} /> Print All ({tickets.length})
        </button>
      </div>

      {/* Preview */}
      <div className="no-print" style={{ background: "#94a3b8", minHeight: "100vh", paddingTop: 64, paddingBottom: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
        {tickets.map((ticket, idx) => (
          <Ticket key={ticket.orderCode} ticket={ticket} idx={idx} total={tickets.length} today={today} batch={batch} />
        ))}
      </div>

      {/* Print-only — no screen rendering */}
      <div className="print-only">
        {tickets.map((ticket, idx) => (
          <Ticket key={ticket.orderCode} ticket={ticket} idx={idx} total={tickets.length} today={today} batch={batch} />
        ))}
      </div>

      <style jsx global>{`
        @media screen {
          .print-only { display: none !important; }
        }
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body, html { margin: 0 !important; padding: 0 !important; background: white !important; }
          @page { size: 4in 6in; margin: 0; }
          .label {
            width: 4in !important;
            height: 6in !important;
            padding: 5mm !important;
            box-sizing: border-box !important;
            page-break-after: always !important;
            page-break-inside: avoid !important;
            display: flex !important;
            flex-direction: column !important;
            overflow: hidden !important;
            border: none !important;
            box-shadow: none !important;
          }
          .label:last-child { page-break-after: avoid !important; }
        }
      `}</style>
    </>
  );
}

function Ticket({ ticket, idx, total, today, batch }: {
  ticket: OrderTicket; idx: number; total: number; today: string; batch: Batch | null;
}) {
  const addressLine = [ticket.city, ticket.state, ticket.zip].filter(Boolean).join(", ");

  return (
    <div className="label" style={{
      fontFamily: MONO,
      width: "4in", height: "6in", padding: "5mm",
      boxSizing: "border-box",
      background: "white",
      border: "1px solid #cbd5e1",
      boxShadow: "0 2px 12px rgba(0,0,0,0.1)",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", borderBottom: "2px solid #000", paddingBottom: "3mm", marginBottom: "3mm" }}>
        <div style={{ flex: 1, minWidth: 0, paddingRight: "3mm" }}>
          <div style={{ fontSize: "5.5pt", fontWeight: "bold", letterSpacing: "0.2em", color: "#64748b", textTransform: "uppercase", marginBottom: "1.5mm" }}>
            PICK TICKET &nbsp;·&nbsp; {idx + 1} / {total}
          </div>
          <div style={{ fontSize: "15pt", fontWeight: "900", color: "#000", lineHeight: 1.1, wordBreak: "break-all" }}>
            {ticket.orderCode}
          </div>
          <div style={{ fontSize: "6pt", color: "#64748b", marginTop: "1.5mm", display: "flex", flexWrap: "wrap", gap: "3px" }}>
            <span>{today}</span>
            <span>·</span>
            <span>{batch?.warehouseCode}</span>
            {ticket.customerCode && <><span>·</span><span>{ticket.customerCode}</span></>}
          </div>
        </div>
        {ticket.qrDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ticket.qrDataUrl} alt={ticket.orderCode}
            style={{ width: "22mm", height: "22mm", flexShrink: 0, imageRendering: "pixelated" }} />
        )}
      </div>

      {/* Ship To */}
      <div style={{ marginBottom: "3mm" }}>
        <div style={{ fontSize: "5pt", fontWeight: "bold", letterSpacing: "0.2em", color: "#94a3b8", textTransform: "uppercase", marginBottom: "1.5mm" }}>SHIP TO</div>
        {ticket.consigneeName ? (
          <>
            <div style={{ fontSize: "10pt", fontWeight: "bold", color: "#000", lineHeight: 1.3 }}>{ticket.consigneeName}</div>
            {ticket.address1 && <div style={{ fontSize: "8pt", color: "#1e293b", lineHeight: 1.4 }}>{ticket.address1}</div>}
            {ticket.address2 && <div style={{ fontSize: "8pt", color: "#1e293b", lineHeight: 1.4 }}>{ticket.address2}</div>}
            {addressLine && <div style={{ fontSize: "8pt", color: "#1e293b", lineHeight: 1.4 }}>{addressLine}</div>}
            {ticket.country && <div style={{ fontSize: "7.5pt", color: "#475569", lineHeight: 1.4 }}>{ticket.country}</div>}
            {ticket.tel    && <div style={{ fontSize: "7pt",   color: "#64748b", lineHeight: 1.4, marginTop: "0.5mm" }}>Tel: {ticket.tel}</div>}
          </>
        ) : (
          <div style={{ fontSize: "8pt", color: "#94a3b8", fontStyle: "italic" }}>—</div>
        )}
      </div>

      <div style={{ borderTop: "1px solid #e2e8f0", marginBottom: "2.5mm" }} />

      {/* Items */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: MONO }}>
          <thead>
            <tr style={{ borderBottom: "1.5px solid #000" }}>
              <th style={{ textAlign: "left",   padding: "1mm 1mm 1mm 0", fontSize: "5pt", fontWeight: "bold", letterSpacing: "0.15em", color: "#64748b", textTransform: "uppercase" }}>SKU</th>
              <th style={{ textAlign: "left",   padding: "1mm",           fontSize: "5pt", fontWeight: "bold", letterSpacing: "0.15em", color: "#64748b", textTransform: "uppercase" }}>Product</th>
              <th style={{ textAlign: "right",  padding: "1mm",           fontSize: "5pt", fontWeight: "bold", letterSpacing: "0.15em", color: "#64748b", textTransform: "uppercase" }}>Qty</th>
              <th style={{ textAlign: "center", padding: "1mm 0 1mm 1mm", fontSize: "5pt", fontWeight: "bold", letterSpacing: "0.15em", color: "#64748b", textTransform: "uppercase" }}>✓</th>
            </tr>
          </thead>
          <tbody>
            {ticket.items.map((item) => (
              <tr key={item.sku} style={{ borderBottom: "0.5px solid #f1f5f9" }}>
                <td style={{ padding: "1.5mm 1mm 1.5mm 0", fontSize: "7pt", color: "#334155", whiteSpace: "nowrap" }}>{item.sku}</td>
                <td style={{ padding: "1.5mm 1mm", fontSize: "7.5pt", color: "#0f172a", maxWidth: "40mm", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name || "—"}</td>
                <td style={{ padding: "1.5mm 1mm", fontSize: "10pt", fontWeight: "900", color: "#000", textAlign: "right" }}>{item.qty}</td>
                <td style={{ padding: "1.5mm 0 1.5mm 1mm", textAlign: "center" }}>
                  <span style={{ display: "inline-block", width: "4mm", height: "4mm", border: "1.5px solid #94a3b8", borderRadius: "1px" }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div style={{ borderTop: "1px solid #cbd5e1", paddingTop: "2mm", marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "5pt", color: "#94a3b8" }}>{ticket.orderCode}</span>
        <span style={{ fontSize: "6pt", color: "#475569" }}>□ Picked &nbsp; □ Packed &nbsp; □ Shipped</span>
      </div>
    </div>
  );
}

export default function BatchPrintPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "white" }}>
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    }>
      <PrintInner />
    </Suspense>
  );
}
