"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

export type LabelData = {
  barcodeValue: string;   // value encoded in the barcode
  orderCode: string;
  sku: string;
  productName: string;
  lotNo?: string;
  expireDate?: string;
  qty: string | number;
  warehouseCode?: string;
  customerCode?: string;
};

export default function BarcodeLabel({ data }: { data: LabelData }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current && data.barcodeValue) {
      JsBarcode(svgRef.current, data.barcodeValue, {
        format: "CODE128",
        width: 2,
        height: 60,
        displayValue: true,
        fontSize: 11,
        margin: 8,
        background: "#ffffff",
        lineColor: "#000000",
      });
    }
  }, [data.barcodeValue]);

  return (
    <div
      className="label-card bg-white border-2 border-black rounded-none"
      style={{ width: 360, padding: "16px 20px", fontFamily: "monospace" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2 border-b border-gray-300 pb-2">
        <span className="text-xs font-bold text-gray-600 uppercase tracking-widest">Receiving Label</span>
        <span className="text-xs text-gray-500">{data.orderCode}</span>
      </div>

      {/* Barcode */}
      <div className="flex justify-center my-3">
        <svg ref={svgRef} />
      </div>

      {/* SKU (large) */}
      <div className="text-center mb-1">
        <span className="text-xl font-bold tracking-wide text-black">{data.sku}</span>
      </div>

      {/* Product name */}
      <div className="text-center mb-3">
        <span className="text-sm text-gray-700 leading-tight">{data.productName}</span>
      </div>

      {/* Info rows */}
      <div className="border-t border-gray-300 pt-2 space-y-1">
        <Row label="QTY" value={String(data.qty)} highlight />
        {data.lotNo && <Row label="LOT" value={data.lotNo} />}
        {data.expireDate && <Row label="EXP" value={data.expireDate.slice(0, 10)} />}
        {data.warehouseCode && <Row label="WH" value={data.warehouseCode} />}
        {data.customerCode && <Row label="CUST" value={data.customerCode} />}
      </div>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-gray-500 uppercase tracking-wide w-12">{label}</span>
      <span className={`font-bold ${highlight ? "text-blue-700 text-sm" : "text-black"}`}>{value}</span>
    </div>
  );
}
