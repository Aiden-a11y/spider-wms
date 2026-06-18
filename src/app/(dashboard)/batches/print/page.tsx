"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Loader2, Printer, AlertCircle } from "lucide-react";
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

function PrintInner() {
  const searchParams = useSearchParams();
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

        const results = await Promise.all(
          found.orders.map(async (order) => {
            const code = order.orderCode;
            const custCode = order.customerCode;
            let orderData: Record<string, unknown> = {};
            let items: { sku: string; name: string; qty: number }[] = [];

            // Try order detail endpoints for address
            for (const ep of [
              `/api/wms/shipping/${found.type}/detail/${encodeURIComponent(code)}`,
              `/api/wms/shipping/detail/${encodeURIComponent(code)}`,
              `/api/wms/outbound/detail/${encodeURIComponent(code)}`,
            ]) {
              try {
                const res = await fetch(ep, { headers });
                const json = await res.json().catch(() => null) as Record<string, unknown> | null;
                if (!res.ok || !json) continue;
                const d = ((json?.data ?? json) as Record<string, unknown>);
                if (f(d, "consigneeName", "receiverName") || f(d, "consigneeAddress1", "deliveryAddress")) {
                  orderData = d; break;
                }
              } catch { /* try next */ }
            }

            // If no address from detail, try list endpoint
            if (!f(orderData, "consigneeName", "receiverName")) {
              try {
                const body = { page: 1, pageSize: 500, warehouseCode: found.warehouseCode, customerCode: custCode };
                const res = await fetch(`/api/wms/shipping/${found.type}/list`, { method: "POST", headers, body: JSON.stringify(body) });
                const json = await res.json().catch(() => null) as Record<string, unknown> | null;
                if (res.ok && json) {
                  const d = (json?.data ?? {}) as Record<string, unknown>;
                  const list: Record<string, unknown>[] = (Array.isArray(d.list) ? d.list : Array.isArray(d.items) ? d.items : Array.isArray(json?.data) ? json?.data as Record<string, unknown>[] : []) as Record<string, unknown>[];
                  const match = list.find((r) => String(r.shippingOrderCode ?? r.orderCode ?? "") === code);
                  if (match) orderData = match;
                }
              } catch { /* ignore */ }
            }

            // Fetch items
            for (const ep of [
              `/api/wms/shipping/items/${encodeURIComponent(code)}`,
              `/api/wms/shipping/${found.type}/items/${encodeURIComponent(code)}`,
            ]) {
              try {
                const res = await fetch(ep, { headers });
                const json = await res.json().catch(() => null) as Record<string, unknown> | null;
                if (!res.ok || !json) continue;
                const d = (json?.data ?? json) as Record<string, unknown>;
                const arr = Array.isArray(d.items) ? d.items
                  : Array.isArray(d.assignments) ? d.assignments
                  : null;
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
              orderCode: code, customerCode: custCode,
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
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-white">
      <Loader2 className="w-10 h-10 animate-spin text-slate-400" />
      <p className="text-slate-500 text-sm font-medium">
        {batch ? `Loading ${loadedCount} / ${batch.orderCount} orders…` : "Loading batch…"}
      </p>
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-white">
      <AlertCircle className="w-10 h-10 text-red-400" />
      <p className="text-red-500 text-sm">{error}</p>
    </div>
  );

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

  return (
    <>
      {/* Screen toolbar */}
      <div className="no-print sticky top-0 z-50 bg-slate-900 text-white px-6 py-3 flex items-center justify-between">
        <div>
          <p className="font-semibold text-sm">Pick Tickets — {tickets.length} orders</p>
          <p className="text-xs text-slate-400">
            {batch?.skuList.map(({ sku, qty }) => `${sku} ×${qty}`).join(" · ")} · 4×6 label per order
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-5 py-2 bg-white text-slate-900 rounded-lg text-sm font-bold hover:bg-slate-100 transition-colors"
        >
          <Printer className="w-4 h-4" />
          Print All ({tickets.length})
        </button>
      </div>

      {/* Preview area */}
      <div className="no-print bg-slate-300 min-h-screen p-8 flex flex-col items-center gap-6">
        {tickets.map((ticket, idx) => (
          <Ticket key={ticket.orderCode} ticket={ticket} idx={idx} total={tickets.length} today={today} batch={batch} />
        ))}
      </div>

      {/* Print-only area */}
      <div className="print-only">
        {tickets.map((ticket, idx) => (
          <Ticket key={ticket.orderCode} ticket={ticket} idx={idx} total={tickets.length} today={today} batch={batch} />
        ))}
      </div>

      <style jsx global>{`
        @media screen {
          .print-only { display: none; }
        }
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block; }
          body, html { margin: 0; padding: 0; background: white; }
          @page {
            size: 4in 6in;
            margin: 0;
          }
          .label {
            width: 4in;
            height: 6in;
            padding: 5mm;
            box-sizing: border-box;
            page-break-after: always;
            page-break-inside: avoid;
            overflow: hidden;
            border: none !important;
            box-shadow: none !important;
          }
          .label:last-child {
            page-break-after: avoid;
          }
        }
      `}</style>
    </>
  );
}

function Ticket({ ticket, idx, total, today, batch }: {
  ticket: OrderTicket;
  idx: number;
  total: number;
  today: string;
  batch: Batch | null;
}) {
  const MONO = "'Courier New', Courier, monospace";
  const addressLine = [ticket.city, ticket.state, ticket.zip].filter(Boolean).join(", ");

  return (
    <div className="label" style={{
      fontFamily: MONO,
      width: "4in",
      height: "6in",
      padding: "5mm",
      boxSizing: "border-box",
      background: "white",
      border: "1px solid #ccc",
      boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>

      {/* ── Header: order code + QR ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", borderBottom: "2px solid #000", paddingBottom: "3mm", marginBottom: "3mm" }}>
        <div style={{ flex: 1, minWidth: 0, paddingRight: "3mm" }}>
          <div style={{ fontSize: "6pt", fontWeight: "bold", letterSpacing: "0.15em", color: "#666", textTransform: "uppercase", marginBottom: "1mm" }}>
            PICK TICKET &nbsp;·&nbsp; {idx + 1}/{total}
          </div>
          <div style={{ fontSize: "14pt", fontWeight: "900", color: "#000", lineHeight: 1.1, wordBreak: "break-all" }}>
            {ticket.orderCode}
          </div>
          <div style={{ fontSize: "6.5pt", color: "#555", marginTop: "1.5mm", display: "flex", gap: "4px", flexWrap: "wrap" }}>
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

      {/* ── Ship To ── */}
      <div style={{ marginBottom: "3mm" }}>
        <div style={{ fontSize: "5.5pt", fontWeight: "bold", letterSpacing: "0.15em", color: "#888", textTransform: "uppercase", marginBottom: "1mm" }}>
          SHIP TO
        </div>
        {ticket.consigneeName ? (
          <>
            <div style={{ fontSize: "10pt", fontWeight: "bold", color: "#000", lineHeight: 1.3 }}>{ticket.consigneeName}</div>
            {ticket.address1 && <div style={{ fontSize: "8pt", color: "#222", lineHeight: 1.3 }}>{ticket.address1}</div>}
            {ticket.address2 && <div style={{ fontSize: "8pt", color: "#222", lineHeight: 1.3 }}>{ticket.address2}</div>}
            {addressLine && <div style={{ fontSize: "8pt", color: "#222", lineHeight: 1.3 }}>{addressLine}</div>}
            {ticket.country && <div style={{ fontSize: "8pt", color: "#555", lineHeight: 1.3 }}>{ticket.country}</div>}
            {ticket.tel    && <div style={{ fontSize: "7pt",  color: "#777", lineHeight: 1.3, marginTop: "0.5mm" }}>Tel: {ticket.tel}</div>}
          </>
        ) : (
          <div style={{ fontSize: "8pt", color: "#aaa", fontStyle: "italic" }}>—</div>
        )}
      </div>

      {/* ── Divider ── */}
      <div style={{ borderTop: "1px solid #ddd", marginBottom: "2.5mm" }} />

      {/* ── Items ── */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "7.5pt" }}>
          <thead>
            <tr style={{ borderBottom: "1.5px solid #000" }}>
              <th style={{ textAlign: "left",  padding: "1mm 1mm 1mm 0", fontWeight: "bold", letterSpacing: "0.1em", fontSize: "5.5pt", color: "#666", textTransform: "uppercase" }}>SKU</th>
              <th style={{ textAlign: "left",  padding: "1mm",           fontWeight: "bold", letterSpacing: "0.1em", fontSize: "5.5pt", color: "#666", textTransform: "uppercase" }}>Product</th>
              <th style={{ textAlign: "right", padding: "1mm",           fontWeight: "bold", letterSpacing: "0.1em", fontSize: "5.5pt", color: "#666", textTransform: "uppercase" }}>Qty</th>
              <th style={{ textAlign: "center",padding: "1mm 0 1mm 1mm", fontWeight: "bold", letterSpacing: "0.1em", fontSize: "5.5pt", color: "#666", textTransform: "uppercase" }}>✓</th>
            </tr>
          </thead>
          <tbody>
            {ticket.items.map((item) => (
              <tr key={item.sku} style={{ borderBottom: "0.5px solid #eee" }}>
                <td style={{ padding: "1.5mm 1mm 1.5mm 0", fontFamily: MONO, fontSize: "7pt", color: "#333", whiteSpace: "nowrap" }}>{item.sku}</td>
                <td style={{ padding: "1.5mm 1mm",           fontSize: "7.5pt", color: "#111", maxWidth: "42mm", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name || "—"}</td>
                <td style={{ padding: "1.5mm 1mm",           fontSize: "9pt",   fontWeight: "900", color: "#000", textAlign: "right" }}>{item.qty}</td>
                <td style={{ padding: "1.5mm 0 1.5mm 1mm",  textAlign: "center" }}>
                  <span style={{ display: "inline-block", width: "4mm", height: "4mm", border: "1.5px solid #999", borderRadius: "1px" }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Footer ── */}
      <div style={{ borderTop: "1px solid #ccc", paddingTop: "2mm", marginTop: "2mm", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "5.5pt", color: "#aaa", fontFamily: MONO }}>{ticket.orderCode}</span>
        <span style={{ fontSize: "6pt", color: "#555" }}>□ Picked &nbsp; □ Packed &nbsp; □ Shipped</span>
      </div>
    </div>
  );
}

export default function BatchPrintPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    }>
      <PrintInner />
    </Suspense>
  );
}
