"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import {
  ScanLine,
  CheckCircle2,
  Circle,
  ArrowRight,
  RefreshCw,
  X,
  PackageCheck,
  AlertCircle,
} from "lucide-react";

/* ── Types ── */
export type ScanItem = {
  sku: string;
  productName: string;
  lot: string;
  location: string;
  qty: number;
  scanned: boolean;
};

export type AddressInfo = {
  name: string;
  company: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  tel: string;
};

export type PackingStorageData = {
  orderCode: string;
  customerCode: string;
  customerName: string;
  items: ScanItem[];
  savedAt: string;
  shipFrom?: Partial<AddressInfo>;
  shipTo?: Partial<AddressInfo>;
};

interface Assignment {
  productSku?: string;
  qty?: number;
  lotNo?: string;
  zoneNm?: string;
  aisleNm?: string;
  bayNm?: string;
  levelNm?: string;
  positionNm?: string;
  [key: string]: unknown;
}

interface WmsResponse {
  data?: {
    assignments?: Assignment[];
    list?: Record<string, unknown>[];
    [key: string]: unknown;
  };
  assignments?: Assignment[];
  [key: string]: unknown;
}

interface ShippingListResponse {
  data?: {
    list?: Array<{
      customerCode?: string;
      customerName?: string;
      consigneeName?: string;
      consigneeAddress1?: string;
      consigneeAddress2?: string;
      consigneeCity?: string;
      consigneeState?: string;
      consigneeZipCode?: string;
      consigneeNationalCode?: string;
      consigneeTelLno?: string;
      receiverName?: string;
      deliveryAddress?: string;
      consignorName?: string;
      consignorAddress1?: string;
      consignorCity?: string;
      consignorState?: string;
      consignorZip?: string;
      consignorZipCode?: string;
      consignorNationalCode?: string;
      consignorTelLno?: string;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/* ── Location formatter ── */
function formatLocation(a: Assignment): string {
  return [a.zoneNm, a.aisleNm, a.bayNm, a.levelNm, a.positionNm]
    .filter(Boolean)
    .join("-");
}

export default function PackingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const orderInputRef = useRef<HTMLInputElement>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  const [orderCode, setOrderCode] = useState("");
  const [items, setItems] = useState<ScanItem[]>([]);
  const [customerCode, setCustomerCode] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [shipFrom, setShipFrom] = useState<Partial<AddressInfo>>({});
  const [shipTo, setShipTo] = useState<Partial<AddressInfo>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [scanError, setScanError] = useState("");
  const [scanWarning, setScanWarning] = useState("");
  const [barcodeMap, setBarcodeMap] = useState<Record<string, string>>({}); // barcode → sku

  /* Pre-fill from ?order= param and auto-fetch */
  useEffect(() => {
    const preOrder = searchParams.get("order");
    if (preOrder) {
      setOrderCode(preOrder);
    }
  }, []); // eslint-disable-line

  /* Auto-fetch when orderCode set from URL param */
  const [didAutoFetch, setDidAutoFetch] = useState(false);
  useEffect(() => {
    const preOrder = searchParams.get("order");
    if (preOrder && orderCode === preOrder && !didAutoFetch) {
      setDidAutoFetch(true);
      fetchItems(preOrder);
    }
  }, [orderCode]); // eslint-disable-line

  /* Auto-focus order input on mount */
  useEffect(() => {
    orderInputRef.current?.focus();
  }, []);

  /* Auto-focus barcode input after items load */
  useEffect(() => {
    if (items.length > 0) {
      barcodeInputRef.current?.focus();
    }
  }, [items.length]);

  const fetchItems = useCallback(
    async (code: string) => {
      if (!code.trim() || !user) return;
      setLoading(true);
      setError("");
      setItems([]);
      setBarcodeMap({});
      setCustomerCode("");
      setCustomerName("");
      setShipFrom({});
      setShipTo({});

      const headers: Record<string, string> = {
        Authorization: `Bearer ${user.token}`,
        "Content-Type": "application/json",
      };

      try {
        /* 1. Fetch assignments */
        const res = await fetch(`/api/wms/shipping/items/${encodeURIComponent(code)}`, {
          headers,
        });
        if (!res.ok) throw new Error(`API error ${res.status}`);
        const json: WmsResponse = await res.json();
        const rawAssignments: Assignment[] =
          (json.data?.assignments ?? json.assignments ?? []) as Assignment[];

        /* Group by sku__lot, sum qty */
        const grouped: Record<string, { sku: string; lot: string; location: string; qty: number }> = {};
        for (const a of rawAssignments) {
          const sku = String(a.productSku ?? "").trim();
          const lot = String(a.lotNo ?? "").trim();
          if (!sku) continue;
          const key = `${sku}__${lot}`;
          const loc = formatLocation(a);
          if (!grouped[key]) {
            grouped[key] = { sku, lot, location: loc, qty: 0 };
          }
          grouped[key].qty += Number(a.qty ?? 0);
          // Update location to last seen (could also keep first)
          if (loc && !grouped[key].location) grouped[key].location = loc;
        }

        /* 2. Fetch product names + barcodes from Supabase */
        const skus = Object.values(grouped).map((g) => g.sku);
        const nameMap: Record<string, string> = {};
        const newBarcodeMap: Record<string, string> = {};

        if (supabase && skus.length > 0) {
          try {
            const { data: products } = await supabase
              .from("product_master")
              .select("sku, product_name, barcode")
              .in("sku", skus);
            if (products) {
              for (const p of products as Array<{ sku: string; product_name: string; barcode?: string }>) {
                nameMap[p.sku] = p.product_name ?? p.sku;
                if (p.barcode) newBarcodeMap[p.barcode] = p.sku;
              }
            }
          } catch { /* ignore supabase errors */ }
        }

        setBarcodeMap(newBarcodeMap);

        /* Build ScanItems */
        const scanItems: ScanItem[] = Object.values(grouped).map((g) => ({
          sku: g.sku,
          productName: nameMap[g.sku] ?? g.sku,
          lot: g.lot,
          location: g.location,
          qty: g.qty,
          scanned: false,
        }));
        setItems(scanItems);

        /* 3. Try to get customer info + addresses */
        try {
          const shRes = await fetch("/api/wms/shipping/list", {
            method: "POST",
            headers,
            body: JSON.stringify({ orderCode: code, page: 1, limit: 1 }),
          });
          if (shRes.ok) {
            const shJson: ShippingListResponse = await shRes.json();
            const first = shJson.data?.list?.[0];
            if (first) {
              setCustomerCode(String(first.customerCode ?? ""));
              setCustomerName(String(first.customerName ?? ""));

              // Ship-To (consignee)
              setShipTo({
                name: String(first.consigneeName ?? first.receiverName ?? ""),
                address1: String(first.consigneeAddress1 ?? first.deliveryAddress ?? ""),
                address2: String(first.consigneeAddress2 ?? ""),
                city: String(first.consigneeCity ?? ""),
                state: String(first.consigneeState ?? ""),
                zip: String(first.consigneeZipCode ?? ""),
                country: String(first.consigneeNationalCode ?? ""),
                tel: String(first.consigneeTelLno ?? ""),
                company: "",
              });

              // Ship-From (consignor, may be empty)
              setShipFrom({
                name: String(first.consignorName ?? ""),
                address1: String(first.consignorAddress1 ?? ""),
                city: String(first.consignorCity ?? ""),
                state: String(first.consignorState ?? ""),
                zip: String(first.consignorZip ?? first.consignorZipCode ?? ""),
                country: String(first.consignorNationalCode ?? ""),
                tel: String(first.consignorTelLno ?? ""),
                company: "",
                address2: "",
              });
            }
          }
        } catch { /* customer info optional */ }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load items");
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  function handleOrderSubmit(e: React.FormEvent) {
    e.preventDefault();
    fetchItems(orderCode.trim());
  }

  function handleBarcodeScan(e: React.FormEvent) {
    e.preventDefault();
    const raw = barcodeInput.trim();
    setBarcodeInput("");
    setScanError("");
    setScanWarning("");
    if (!raw) return;

    // Match: first try exact SKU, then barcode→sku lookup
    const resolvedSku = barcodeMap[raw] ?? raw;

    const idx = items.findIndex((it) => it.sku === resolvedSku);
    if (idx === -1) {
      setScanError(`Not found: "${raw}"`);
      setTimeout(() => setScanError(""), 2000);
      return;
    }
    if (items[idx].scanned) {
      setScanWarning(`Already scanned: ${items[idx].sku}`);
      return;
    }
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, scanned: true } : it))
    );
  }

  const scannedCount = items.filter((it) => it.scanned).length;
  const allScanned = items.length > 0 && scannedCount === items.length;

  function handleProceed() {
    const data: PackingStorageData = {
      orderCode,
      customerCode,
      customerName,
      items,
      savedAt: new Date().toISOString(),
      shipFrom,
      shipTo,
    };
    localStorage.setItem("wms_packing_scan", JSON.stringify(data));
    router.push(`/packing/${encodeURIComponent(orderCode)}`);
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
          <ScanLine className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Packing — Order Scan</h1>
          <p className="text-sm text-slate-500">Scan order code, then verify items</p>
        </div>
      </div>

      {/* Order input */}
      <form onSubmit={handleOrderSubmit} className="flex gap-3">
        <input
          ref={orderInputRef}
          type="text"
          value={orderCode}
          onChange={(e) => setOrderCode(e.target.value)}
          placeholder="Enter or scan order code…"
          className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white shadow-sm"
        />
        <button
          type="submit"
          disabled={loading || !orderCode.trim()}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <ScanLine className="w-4 h-4" />
          )}
          {loading ? "Loading…" : "Fetch"}
        </button>
      </form>

      {error && (
        <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Items section */}
      {items.length > 0 && (
        <>
          {/* Customer + counter */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-900">
                {customerName || customerCode || "—"}
              </p>
              <p className="text-xs text-slate-500">Order: {orderCode}</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-sm font-semibold border ${
              allScanned
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-slate-100 text-slate-700 border-slate-200"
            }`}>
              {scannedCount} / {items.length} scanned
            </span>
          </div>

          {/* Barcode scan input */}
          <form onSubmit={handleBarcodeScan} className="flex gap-3">
            <input
              ref={barcodeInputRef}
              type="text"
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              placeholder="Scan item barcode or enter SKU…"
              className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white shadow-sm"
            />
            <button
              type="submit"
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors"
            >
              <PackageCheck className="w-4 h-4" />
              Match
            </button>
          </form>

          {scanError && (
            <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm">
              <X className="w-4 h-4 flex-shrink-0" />
              {scanError}
            </div>
          )}
          {scanWarning && (
            <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {scanWarning}
            </div>
          )}

          {/* Items table */}
          <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">SKU</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Product</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Lot</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Location</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Qty</th>
                  <th className="text-center px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide w-12">✓</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={`${item.sku}__${item.lot}`}
                    className={`border-b border-slate-100 last:border-0 transition-colors ${
                      item.scanned ? "bg-emerald-50" : "bg-white"
                    }`}
                  >
                    <td className="px-4 py-2.5 font-mono font-semibold text-slate-800">{item.sku}</td>
                    <td className="px-4 py-2.5 text-slate-700 max-w-xs truncate">{item.productName}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-600">{item.lot || "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-500 text-xs">{item.location || "—"}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{item.qty.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-center">
                      {item.scanned ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto" />
                      ) : (
                        <Circle className="w-5 h-5 text-slate-300 mx-auto" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Proceed button */}
          <div className="flex justify-end">
            <button
              onClick={handleProceed}
              disabled={!allScanned}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Proceed to Packing
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
