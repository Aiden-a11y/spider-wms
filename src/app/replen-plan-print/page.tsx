"use client";

import { useEffect, useState } from "react";

interface ReplenPlanEntry {
  sku: string;
  name: string;
  locationCode: string;
  lotNo: string;
  expireDate: string;
  availQty: number;
  orderCount: number;
}

interface ReplenPlan {
  entries: ReplenPlanEntry[];
  warehouseCode: string;
  createdAt: string;
}

const CSS = `
  @media print {
    @page { size: 4in 6in; margin: 0.12in; }
    .no-print { display: none !important; }
    .ticket { page-break-after: always; }
    .ticket:last-child { page-break-after: avoid; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #e2e8f0; }
  .ticket {
    width: 3.76in; height: 5.76in; overflow: hidden; background: #fff;
    padding: 0.14in 0.16in; margin: 0.1in auto;
    border: 1px solid #ccc; display: flex; flex-direction: column; gap: 0;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  }
  .replen-banner {
    background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px;
    padding: 0.08in 0.1in; margin-bottom: 0.1in; text-align: center;
  }
  .replen-banner-label {
    font-size: 7pt; font-weight: 700; color: #92400e;
    text-transform: uppercase; letter-spacing: 1px;
  }
  .replen-banner-title {
    font-size: 18pt; font-weight: 900; color: #78350f; margin-top: 2px;
    letter-spacing: 1px;
  }
  .section-label {
    font-size: 7pt; font-weight: 700; color: #6b7280;
    text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 0.04in;
  }
  .sku-code {
    font-family: 'Courier New', monospace; font-size: 12pt; font-weight: 900;
    color: #111; word-break: break-all; margin-bottom: 2px;
  }
  .sku-name {
    font-size: 8.5pt; color: #374151; margin-bottom: 0.08in;
    line-height: 1.35;
  }
  .loc-box {
    background: #eff6ff; border: 2px solid #3b82f6; border-radius: 8px;
    padding: 0.07in 0.1in; margin-bottom: 0.08in;
  }
  .loc-label {
    font-size: 6.5pt; font-weight: 700; color: #1d4ed8;
    text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;
  }
  .loc-code {
    font-family: 'Courier New', monospace; font-size: 14pt; font-weight: 900; color: #1e3a8a;
  }
  .meta-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 0.06in; margin-bottom: 0.08in;
  }
  .meta-cell {
    background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;
    padding: 0.05in 0.07in;
  }
  .meta-key { font-size: 6pt; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
  .meta-val { font-size: 9pt; font-weight: 700; color: #1e293b; font-family: 'Courier New', monospace; }
  .orders-badge {
    display: inline-flex; align-items: center; gap: 4px;
    background: #fee2e2; border: 1px solid #fca5a5; border-radius: 6px;
    padding: 0.04in 0.08in; margin-bottom: 0.08in;
  }
  .orders-badge-text { font-size: 8pt; font-weight: 700; color: #991b1b; }
  .footer {
    margin-top: auto; padding-top: 0.08in; border-top: 1px dashed #d1d5db;
    display: flex; justify-content: space-between; align-items: center;
    flex-shrink: 0;
  }
  .footer-wh { font-size: 7pt; color: #9ca3af; font-family: 'Courier New', monospace; }
  .footer-date { font-size: 6.5pt; color: #9ca3af; }
  .checkbox-row { display: flex; gap: 0.12in; font-size: 7pt; color: #6b7280; margin-top: 0.06in; }
  .checkbox-row span { display: flex; align-items: center; gap: 3px; }
`;

function ReplenTicket({ entry, warehouseCode, createdAt }: {
  entry: ReplenPlanEntry; warehouseCode: string; createdAt: string;
}) {
  const dateStr = new Date(createdAt).toLocaleDateString();

  return (
    <div className="ticket">
      {/* Replenishment banner */}
      <div className="replen-banner">
        <div className="replen-banner-label">Replenishment Pick</div>
        <div className="replen-banner-title">MOVE TO SHELF</div>
      </div>

      {/* SKU */}
      <div className="section-label">SKU</div>
      <div className="sku-code">{entry.sku}</div>
      <div className="sku-name">{entry.name || "—"}</div>

      {/* Source location */}
      <div className="loc-box">
        <div className="loc-label">Pick From</div>
        <div className="loc-code">{entry.locationCode || "—"}</div>
      </div>

      {/* Lot / Expiry / Qty */}
      <div className="meta-grid">
        {entry.lotNo && (
          <div className="meta-cell">
            <div className="meta-key">Lot No</div>
            <div className="meta-val">{entry.lotNo}</div>
          </div>
        )}
        {entry.expireDate && (
          <div className="meta-cell">
            <div className="meta-key">Expire</div>
            <div className="meta-val">{entry.expireDate}</div>
          </div>
        )}
        <div className="meta-cell">
          <div className="meta-key">Avail Qty</div>
          <div className="meta-val">{entry.availQty}</div>
        </div>
      </div>

      {/* Orders needing this */}
      <div className="orders-badge">
        <span className="orders-badge-text">⚠ {entry.orderCount} order{entry.orderCount !== 1 ? "s" : ""} blocked — replenish to shelf</span>
      </div>

      {/* Checklist */}
      <div className="checkbox-row">
        <span>□ Picked from location</span>
        <span>□ Moved to shelf</span>
      </div>

      <div className="footer">
        <span className="footer-wh">{warehouseCode}</span>
        <span className="footer-date">{dateStr}</span>
      </div>
    </div>
  );
}

export default function ReplenPlanPrintPage() {
  const [plan, setPlan] = useState<ReplenPlan | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem("replen_plan_print");
      if (!raw) { setError("No replenishment plan found"); return; }
      setPlan(JSON.parse(raw) as ReplenPlan);
    } catch {
      setError("Failed to load plan");
    }
  }, []);

  useEffect(() => {
    if (plan && plan.entries.length > 0) {
      const t = setTimeout(() => window.print(), 500);
      return () => clearTimeout(t);
    }
  }, [plan]);

  return (
    <>
      <style>{CSS}</style>
      {error && (
        <div style={{ padding: "2rem", color: "#dc2626", fontFamily: "sans-serif" }}>
          <strong>Error:</strong> {error}
        </div>
      )}
      {!plan && !error && (
        <div style={{ padding: "2rem", color: "#64748b", fontFamily: "sans-serif" }}>Loading…</div>
      )}
      {plan && plan.entries.length === 0 && (
        <div style={{ padding: "2rem", color: "#64748b", fontFamily: "sans-serif" }}>No entries in plan.</div>
      )}
      {plan && plan.entries.map((entry) => (
        <ReplenTicket key={entry.sku} entry={entry} warehouseCode={plan.warehouseCode} createdAt={plan.createdAt} />
      ))}

      <div className="no-print" style={{ padding: "1rem", textAlign: "center", fontFamily: "sans-serif" }}>
        <button
          onClick={() => window.print()}
          style={{ padding: "0.5rem 1.5rem", background: "#3b82f6", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 700 }}
        >
          Print
        </button>
      </div>
    </>
  );
}
