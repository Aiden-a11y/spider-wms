"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Loader2, CheckCircle2, AlertCircle, XCircle } from "lucide-react";

type BatchResult = { batchCode: string; batchName: string; orderCount: number; ok: boolean; msg: string };

export default function BatchCompleteAllPage() {
  const { user } = useAuth();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  const [status, setStatus] = useState<"running" | "done" | "error">("running");
  const [log, setLog] = useState<string[]>([]);
  const [results, setResults] = useState<BatchResult[]>([]);

  function addLog(msg: string) {
    setLog((prev) => [...prev, msg]);
  }

  useEffect(() => {
    (async () => {
      try {
        addLog("Fetching WMS batches (last 90 days)…");

        const from = new Date(); from.setDate(from.getDate() - 90);
        const dateFrom = from.toISOString().slice(0, 10).replace(/-/g, "");
        const dateTo   = new Date().toISOString().slice(0, 10).replace(/-/g, "");

        const listRes = await fetch("/api/wms/batch/list", {
          method: "POST", headers,
          body: JSON.stringify({ searchText: "", warehouseCode: "STOO1", customerCode: "", dateFrom, dateTo, page: 1, pageSize: 500 }),
        });
        const listJson = await listRes.json();
        const batches: { batchCode: string; batchName: string; warehouseCode: string; customerCode: string; orderCount: number }[] =
          Array.isArray(listJson?.data) ? listJson.data : [];

        addLog(`Found ${batches.length} batches. Processing…`);

        const batchResults: BatchResult[] = [];

        for (const batch of batches) {
          addLog(`[${batch.batchCode}] Getting orders…`);

          const ordRes = await fetch("/api/wms/batch/orders", {
            method: "POST", headers, body: JSON.stringify([batch.batchCode]),
          });
          const ordJson = await ordRes.json();
          const orders: { shippingOrderCode: string }[] = Array.isArray(ordJson?.data) ? ordJson.data : [];

          if (!orders.length) {
            addLog(`[${batch.batchCode}] No orders — skipped`);
            batchResults.push({ batchCode: batch.batchCode, batchName: batch.batchName, orderCount: 0, ok: false, msg: "No orders" });
            continue;
          }

          const orderCodes = orders.map((o) => o.shippingOrderCode);
          addLog(`[${batch.batchCode}] Changing status → FA (${orderCodes.length} orders)…`);

          const statusRes = await fetch("/api/wms/shipping/status-change", {
            method: "POST", headers,
            body: JSON.stringify({
              warehouseCode: batch.warehouseCode,
              customerCode: batch.customerCode,
              orderCodes,
              newStatus: "FA",
              completeDate: "",
              cancelComment: "",
            }),
          });
          const statusJson = await statusRes.json();
          const ok = !!(statusRes.ok && ((statusJson as Record<string, unknown>)?.isSuccess ?? true));
          const msg = String((statusJson as Record<string, unknown>)?.message ?? (ok ? "OK" : "Failed"));

          addLog(`[${batch.batchCode}] ${ok ? "✓ Done" : "✗ " + msg}`);
          batchResults.push({ batchCode: batch.batchCode, batchName: batch.batchName, orderCount: orderCodes.length, ok, msg });

          await new Promise((r) => setTimeout(r, 300));
        }

        setResults(batchResults);
        setStatus("done");
        addLog(`\nComplete! ${batchResults.filter((r) => r.ok).length}/${batchResults.length} batches marked FA.`);
      } catch (e) {
        addLog(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
        setStatus("error");
      }
    })();
  }, []); // eslint-disable-line

  const okCount   = results.filter((r) => r.ok).length;
  const failCount = results.filter((r) => !r.ok).length;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8 font-mono">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-white">WMS Batch — Bulk Complete (FA)</h1>
          <p className="text-sm text-slate-400 mt-1">One-time utility · marks all batches as FA (completed)</p>
        </div>

        {/* Status banner */}
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl ${
          status === "running" ? "bg-blue-950 border border-blue-700" :
          status === "done"    ? "bg-green-950 border border-green-700" :
                                 "bg-red-950 border border-red-700"
        }`}>
          {status === "running" && <Loader2 className="w-5 h-5 animate-spin text-blue-400" />}
          {status === "done"    && <CheckCircle2 className="w-5 h-5 text-green-400" />}
          {status === "error"   && <XCircle className="w-5 h-5 text-red-400" />}
          <span className={`text-sm font-semibold ${
            status === "running" ? "text-blue-300" :
            status === "done"    ? "text-green-300" : "text-red-300"
          }`}>
            {status === "running" ? "Processing…" :
             status === "done"    ? `Done — ${okCount} completed, ${failCount} failed` :
                                    "Error occurred"}
          </span>
        </div>

        {/* Log */}
        <div className="bg-slate-900 rounded-xl p-4 max-h-64 overflow-y-auto border border-slate-700">
          {log.map((line, i) => (
            <div key={i} className={`text-xs leading-5 ${
              line.includes("✓") ? "text-green-400" :
              line.includes("✗") || line.includes("ERROR") ? "text-red-400" :
              line.startsWith("\n") ? "text-slate-300 font-bold mt-2" :
              "text-slate-400"
            }`}>{line}</div>
          ))}
        </div>

        {/* Results table */}
        {results.length > 0 && (
          <div className="rounded-xl overflow-hidden border border-slate-700">
            <div className="bg-slate-800 px-4 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
              Results
            </div>
            {results.map((r) => (
              <div key={r.batchCode} className="px-4 py-2.5 flex items-center gap-3 border-t border-slate-800 text-xs">
                {r.ok
                  ? <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                  : <AlertCircle  className="w-4 h-4 text-red-400 flex-shrink-0" />}
                <span className="text-slate-300 font-mono flex-1 truncate">{r.batchCode}</span>
                <span className="text-slate-500">{r.orderCount} orders</span>
                <span className={r.ok ? "text-green-400" : "text-red-400"}>{r.msg}</span>
              </div>
            ))}
          </div>
        )}

        {status === "done" && (
          <p className="text-xs text-slate-500 text-center">
            이 페이지는 삭제해도 됩니다 — 한 번만 사용하는 페이지예요.
          </p>
        )}
      </div>
    </div>
  );
}
