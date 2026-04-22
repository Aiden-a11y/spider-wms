"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import BarcodeLabel from "@/components/BarcodeLabel";

function LabelContent() {
  const params = useSearchParams();
  const router = useRouter();

  const orderCode   = params.get("orderCode")   ?? "";
  const itemId      = params.get("itemId")       ?? "";
  const sku         = params.get("sku")          ?? "";
  const productName = params.get("productName")  ?? sku;
  const lotNo       = params.get("lotNo")        ?? "";
  const expireDate  = params.get("expireDate")   ?? "";
  const qty         = params.get("qty")          ?? "1";
  const warehouseCode = params.get("warehouseCode") ?? "";
  const customerCode  = params.get("customerCode")  ?? "";

  // Barcode value: orderCode::itemId  (or just orderCode if no itemId)
  const barcodeValue = itemId ? `${orderCode}::${itemId}` : orderCode;

  const data = {
    barcodeValue,
    orderCode,
    sku,
    productName,
    lotNo: lotNo || undefined,
    expireDate: expireDate || undefined,
    qty,
    warehouseCode: warehouseCode || undefined,
    customerCode: customerCode || undefined,
  };

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      {/* Top bar — hidden during print */}
      <div className="no-print flex items-center justify-between mb-6 max-w-lg">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Printer className="w-4 h-4" />
          Print Label
        </button>
      </div>

      {/* Label preview */}
      <div className="flex justify-center">
        <BarcodeLabel data={data} />
      </div>

      {/* Print styles */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .label-card,
          .label-card * {
            visibility: visible;
          }
          .label-card {
            position: fixed;
            top: 0;
            left: 0;
            border: none !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}

export default function ReceivingLabelPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-400 text-sm">Loading label…</div>}>
      <LabelContent />
    </Suspense>
  );
}
