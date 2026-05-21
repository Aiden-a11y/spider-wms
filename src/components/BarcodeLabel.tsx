"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

export type LabelData = {
  barcodeValue: string;
  orderCode: string;
  sku: string;
  productName: string;
  lotNo?: string;
  expireDate?: string;
  qty: string | number;
  warehouseCode?: string;
  customerCode?: string;
  tagNo?: number;        // Stow Tag 번호 (예: 1, 2, 3…)
};

export default function BarcodeLabel({ data }: { data: LabelData }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current && data.barcodeValue) {
      JsBarcode(svgRef.current, data.barcodeValue, {
        format: "CODE128",
        width: 2.8,
        height: 72,
        displayValue: true,
        fontSize: 12,
        margin: 6,
        background: "#ffffff",
        lineColor: "#000000",
        textMargin: 4,
      });
    }
  }, [data.barcodeValue]);

  return (
    <div
      className="label-card"
      style={{
        width: "4in",
        minHeight: "6in",
        background: "#fff",
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: "10pt",
        color: "#000",
        boxSizing: "border-box",
        padding: "5mm 6mm",
        display: "flex",
        flexDirection: "column",
        gap: 0,
      }}
    >
      {/* ── Header ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "2.5px solid #000",
        paddingBottom: "3mm",
        marginBottom: "3mm",
      }}>
        <div>
          <div style={{ fontSize: "13pt", fontWeight: "900", letterSpacing: "0.04em" }}>
            STL STOW TAG
          </div>
          <div style={{ fontSize: "8.5pt", color: "#444", marginTop: "1mm" }}>
            {data.orderCode}
          </div>
        </div>
        {data.tagNo != null && (
          <div style={{
            border: "2px solid #000",
            borderRadius: "4px",
            padding: "2mm 4mm",
            textAlign: "center",
            minWidth: "16mm",
          }}>
            <div style={{ fontSize: "7pt", color: "#555", letterSpacing: "0.08em" }}>TAG</div>
            <div style={{ fontSize: "18pt", fontWeight: "900", lineHeight: 1 }}>
              {String(data.tagNo).padStart(2, "0")}
            </div>
          </div>
        )}
      </div>

      {/* ── Barcode ── */}
      <div style={{
        display: "flex",
        justifyContent: "center",
        marginBottom: "3mm",
        borderBottom: "1px solid #ccc",
        paddingBottom: "3mm",
      }}>
        <svg ref={svgRef} style={{ maxWidth: "100%" }} />
      </div>

      {/* ── SKU ── */}
      <div style={{
        textAlign: "center",
        fontSize: "15pt",
        fontWeight: "900",
        letterSpacing: "0.06em",
        marginBottom: "1.5mm",
        wordBreak: "break-all",
      }}>
        {data.sku}
      </div>

      {/* ── Product Name ── */}
      <div style={{
        textAlign: "center",
        fontSize: "9pt",
        color: "#222",
        marginBottom: "4mm",
        lineHeight: 1.35,
        borderBottom: "1px solid #ccc",
        paddingBottom: "3mm",
      }}>
        {data.productName}
      </div>

      {/* ── QTY (대형) ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#000",
        color: "#fff",
        padding: "3mm 5mm",
        marginBottom: "3mm",
        borderRadius: "2px",
      }}>
        <span style={{ fontSize: "11pt", fontWeight: "700", letterSpacing: "0.08em" }}>QTY</span>
        <span style={{ fontSize: "26pt", fontWeight: "900", lineHeight: 1 }}>
          {String(data.qty)}
        </span>
      </div>

      {/* ── Info rows ── */}
      <div style={{
        border: "1.5px solid #000",
        borderRadius: "2px",
        overflow: "hidden",
        marginBottom: "3mm",
      }}>
        {data.lotNo && (
          <InfoRow label="LOT NO" value={data.lotNo} />
        )}
        {data.expireDate && (
          <InfoRow label="EXPIRE" value={data.expireDate.slice(0, 10)} border={!!data.lotNo} />
        )}
        {data.customerCode && (
          <InfoRow label="CUSTOMER" value={data.customerCode} border={!!(data.lotNo || data.expireDate)} />
        )}
        {data.warehouseCode && (
          <InfoRow label="WAREHOUSE" value={data.warehouseCode} border={!!(data.lotNo || data.expireDate || data.customerCode)} />
        )}
      </div>

      {/* ── Footer ── */}
      <div style={{
        marginTop: "auto",
        borderTop: "1px solid #ccc",
        paddingTop: "2mm",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: "7.5pt",
        color: "#888",
      }}>
        <span>CTK USA, INC.</span>
        <span>{new Date().toLocaleDateString("en-US")}</span>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  border = false,
}: {
  label: string;
  value: string;
  border?: boolean;
}) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      borderTop: border ? "1px solid #ccc" : "none",
    }}>
      <div style={{
        width: "22mm",
        flexShrink: 0,
        background: "#f0f0f0",
        padding: "2mm 3mm",
        fontSize: "7.5pt",
        fontWeight: "700",
        letterSpacing: "0.06em",
        color: "#333",
        borderRight: "1.5px solid #000",
      }}>
        {label}
      </div>
      <div style={{
        flex: 1,
        padding: "2mm 3mm",
        fontSize: "10.5pt",
        fontWeight: "700",
      }}>
        {value}
      </div>
    </div>
  );
}
