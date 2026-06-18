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

            // Fetch order detail (address + items)
            for (const ep of [
              `/api/wms/shipping/${found.type}/detail/${encodeURIComponent(code)}`,
              `/api/wms/shipping/detail/${encodeURIComponent(code)}`,
              `/api/wms/shipping/items/${encodeURIComponent(code)}`,
            ]) {
              try {
                const res = await fetch(ep, { headers });
                const json = await res.json().catch(() => null) as Record<string, unknown> | null;
                if (!res.ok || !json) continue;
                const d = ((json?.data ?? json) as Record<string, unknown>);
                if (f(d, "consigneeName", "receiverName") || f(d, "consigneeAddress1", "deliveryAddress")) {
                  orderData = d;
                  break;
                }
              } catch { /* try next */ }
            }

            // Fetch items (assignments or items list)
            for (const ep of [
              `/api/wms/shipping/items/${encodeURIComponent(code)}`,
              `/api/wms/shipping/${found.type}/items/${encodeURIComponent(code)}`,
            ]) {
              try {
                const res = await fetch(ep, { headers });
                const json = await res.json().catch(() => null) as Record<string, unknown> | null;
                if (!res.ok || !json) continue;
                const d = (json?.data ?? json) as Record<string, unknown>;
                // Try items[] first (has productSku, productName, qty)
                const itemArr = Array.isArray(d.items) ? d.items
                  : Array.isArray(d.assignments) ? d.assignments
                  : Array.isArray((json?.data as Record<string,unknown>)?.items) ? (json?.data as Record<string,unknown>)?.items as unknown[]
                  : null;
                if (Array.isArray(itemArr) && itemArr.length > 0) {
                  items = (itemArr as Record<string, unknown>[]).map((it) => ({
                    sku:  String(it.productSku  ?? it.sku  ?? ""),
                    name: String(it.productName ?? it.name ?? it.itemName ?? ""),
                    qty:  Number(it.qty ?? it.quantity ?? it.orderQty ?? 0),
                  })).filter((it) => it.sku);
                  break;
                }
              } catch { /* try next */ }
            }

            // Fallback: use skuList from batch
            if (items.length === 0) {
              items = found.skuList.map((s) => ({ sku: s.sku, name: s.name, qty: s.qty }));
            }

            // If we still don't have address from detail, try the orders list
            if (!f(orderData, "consigneeName", "receiverName")) {
              try {
                const listBody = { page: 1, pageSize: 500, warehouseCode: found.warehouseCode, customerCode: custCode };
                const res = await fetch(`/api/wms/shipping/${found.type}/list`, { method: "POST", headers, body: JSON.stringify(listBody) });
                const json = await res.json().catch(() => null) as Record<string, unknown> | null;
                if (res.ok && json) {
                  const list: Record<string, unknown>[] = (json?.data as Record<string,unknown>)?.list as Record<string,unknown>[] ?? (json?.data as Record<string,unknown>)?.items as Record<string,unknown>[] ?? json?.list as Record<string,unknown>[] ?? (Array.isArray(json?.data) ? json?.data as Record<string,unknown>[] : []);
                  const match = Array.isArray(list) ? list.find((r) => String(r.shippingOrderCode ?? r.orderCode ?? "") === code) : null;
                  if (match) orderData = match;
                }
              } catch { /* ignore */ }
            }

            const qrDataUrl = await QRCode.toDataURL(code, { width: 128, margin: 1, color: { dark: "#000000", light: "#ffffff" } }).catch(() => "");

            setLoadedCount((c) => c + 1);

            return {
              orderCode: code,
              customerCode: custCode,
              consigneeName: f(orderData, "consigneeName", "receiverName", "customerName"),
              address1:      f(orderData, "consigneeAddress1", "deliveryAddress"),
              address2:      f(orderData, "consigneeAddress2"),
              city:          f(orderData, "consigneeCity"),
              state:         f(orderData, "consigneeState"),
              zip:           f(orderData, "consigneeZipCode", "zipCode"),
              country:       f(orderData, "consigneeNationalCode", "country"),
              tel:           f(orderData, "consigneeTelLNo", "consigneeTelLno", "consigneeCellNo"),
              items,
              qrDataUrl,
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
        Loading {loadedCount} / {batch?.orderCount ?? "…"} orders…
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
      {/* Screen header — hidden when printing */}
      <div className="no-print sticky top-0 z-50 bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shadow-sm">
        <div>
          <p className="font-bold text-slate-900">Pick Tickets — {tickets.length} orders</p>
          <p className="text-xs text-slate-500">
            {batch?.skuList.map(({ sku, qty }) => `${sku} ×${qty}`).join(" · ")} · {batch?.warehouseCode}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors"
        >
          <Printer className="w-4 h-4" />
          Print All
        </button>
      </div>

      {/* Pick tickets */}
      <div className="bg-slate-100 min-h-screen p-6 print:p-0 print:bg-white">
        <div className="space-y-6 print:space-y-0">
          {tickets.map((ticket, idx) => (
            <div
              key={ticket.orderCode}
              className="ticket bg-white rounded-xl shadow-sm overflow-hidden print:rounded-none print:shadow-none"
              style={{ fontFamily: "'Courier New', Courier, monospace" }}
            >
              {/* Ticket header */}
              <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b-2 border-slate-900">
                <div className="flex-1">
                  <p className="text-xs font-bold tracking-[0.2em] text-slate-500 uppercase mb-1">Pick Ticket</p>
                  <p className="text-2xl font-black text-slate-900 tracking-tight">{ticket.orderCode}</p>
                  <div className="flex items-center gap-4 mt-1.5 text-xs text-slate-500">
                    <span>{today}</span>
                    <span>·</span>
                    <span>{idx + 1} / {tickets.length}</span>
                    <span>·</span>
                    <span>{batch?.warehouseCode}</span>
                    {ticket.customerCode && <><span>·</span><span>{ticket.customerCode}</span></>}
                  </div>
                </div>
                {ticket.qrDataUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ticket.qrDataUrl} alt={ticket.orderCode} width={96} height={96}
                    className="flex-shrink-0 border border-slate-200 rounded-md ml-4" />
                )}
              </div>

              <div className="px-6 py-4 grid grid-cols-2 gap-x-8">
                {/* Ship to */}
                <div>
                  <p className="text-[10px] font-bold tracking-[0.15em] text-slate-400 uppercase mb-1.5">Ship To</p>
                  {ticket.consigneeName ? (
                    <>
                      <p className="font-bold text-slate-900 text-sm">{ticket.consigneeName}</p>
                      {ticket.address1 && <p className="text-sm text-slate-700 mt-0.5">{ticket.address1}</p>}
                      {ticket.address2 && <p className="text-sm text-slate-700">{ticket.address2}</p>}
                      {(ticket.city || ticket.state || ticket.zip) && (
                        <p className="text-sm text-slate-700">
                          {[ticket.city, ticket.state, ticket.zip].filter(Boolean).join(", ")}
                        </p>
                      )}
                      {ticket.country && <p className="text-sm text-slate-700">{ticket.country}</p>}
                      {ticket.tel && <p className="text-xs text-slate-500 mt-1">Tel: {ticket.tel}</p>}
                    </>
                  ) : (
                    <p className="text-sm text-slate-400 italic">—</p>
                  )}
                </div>

                {/* Batch info */}
                <div>
                  <p className="text-[10px] font-bold tracking-[0.15em] text-slate-400 uppercase mb-1.5">Batch Info</p>
                  <p className="text-sm text-slate-700">
                    <span className="text-slate-400">Type: </span>{batch?.type?.toUpperCase()}
                  </p>
                  <p className="text-sm text-slate-700">
                    <span className="text-slate-400">Batch: </span>{batch?.orderCount} orders
                  </p>
                </div>
              </div>

              {/* Items table */}
              <div className="px-6 pb-5">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b-2 border-slate-900">
                      <th className="text-left py-1.5 text-[10px] font-bold tracking-[0.15em] text-slate-500 uppercase">SKU</th>
                      <th className="text-left py-1.5 text-[10px] font-bold tracking-[0.15em] text-slate-500 uppercase">Product</th>
                      <th className="text-right py-1.5 text-[10px] font-bold tracking-[0.15em] text-slate-500 uppercase">Qty</th>
                      <th className="text-right py-1.5 text-[10px] font-bold tracking-[0.15em] text-slate-500 uppercase">Picked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ticket.items.map((item) => (
                      <tr key={item.sku} className="border-b border-slate-100">
                        <td className="py-2 font-mono text-xs text-slate-800 pr-4">{item.sku}</td>
                        <td className="py-2 text-slate-700 pr-4">{item.name || "—"}</td>
                        <td className="py-2 text-right font-bold text-slate-900">{item.qty}</td>
                        <td className="py-2 text-right">
                          <span className="inline-block w-6 h-6 border-2 border-slate-400 rounded" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div className="px-6 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between print:bg-white">
                <p className="text-[10px] text-slate-400 font-mono">{ticket.orderCode}</p>
                <p className="text-[10px] text-slate-400">□ Picked &nbsp; □ Packed &nbsp; □ Shipped</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
          .ticket {
            page-break-after: always;
            border: 1px solid #e2e8f0 !important;
            margin: 0 !important;
          }
          .ticket:last-child { page-break-after: avoid; }
          @page { margin: 12mm; size: A4; }
        }
      `}</style>
    </>
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
