"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { RefreshCw, AlertCircle, PackageCheck } from "lucide-react";

export default function ReceivingPage() {
  const { user } = useAuth();
  const [data, setData] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [raw, setRaw] = useState<object | null>(null);

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/wms/receiving/list", {
        method: "POST",
        headers,
        body: JSON.stringify({ page: 1, limit: 100 }),
      });
      const json = await res.json();
      setRaw(json);
      const list = json?.data?.list ?? json?.data ?? json?.list ?? json ?? [];
      setData(Array.isArray(list) ? list : []);
    } catch {
      setError("입고 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line

  const cols = useMemo(() => {
    if (data.length === 0) return [];
    return Object.keys(data[0] as object).slice(0, 8);
  }, [data]);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">입고</h1>
          <p className="text-slate-500 text-sm mt-0.5">Receiving 목록</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          새로고침
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-5">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-100 h-12 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && data.length === 0 && !error && (
        <div className="text-center py-20 text-slate-400">
          <PackageCheck className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">입고 데이터가 없습니다</p>
        </div>
      )}

      {!loading && data.length > 0 && cols.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {cols.map((c) => (
                    <th key={c} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row, idx) => (
                  <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                    {cols.map((c) => (
                      <td key={c} className="px-4 py-2.5 text-slate-700 whitespace-nowrap">
                        {String((row as Record<string, unknown>)[c] ?? "-")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {raw && (
        <details className="mt-6 bg-slate-800 rounded-xl p-4 text-xs">
          <summary className="text-slate-400 cursor-pointer select-none">Raw API 응답 (개발용)</summary>
          <pre className="text-green-400 overflow-auto max-h-60 mt-3">{JSON.stringify(raw, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
