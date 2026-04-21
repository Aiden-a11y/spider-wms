"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { RefreshCw, AlertCircle, Truck, Search } from "lucide-react";

interface Order {
  [key: string]: unknown;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  PROCESSING: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-green-100 text-green-800",
  CANCELLED: "bg-red-100 text-red-800",
  SHIPPED: "bg-purple-100 text-purple-800",
};

function statusColor(status: string) {
  return STATUS_COLORS[status?.toUpperCase()] ?? "bg-slate-100 text-slate-600";
}

export default function ShippingPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [rawResponse, setRawResponse] = useState<object | null>(null);

  const headers = useMemo(
    () => ({ "Authorization": `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/wms/shipping/list", {
        method: "POST",
        headers,
        body: JSON.stringify({ page: 1, limit: 100 }),
      });
      const json = await res.json();
      setRawResponse(json);
      const list = json?.data?.list ?? json?.data ?? json?.list ?? json ?? [];
      setOrders(Array.isArray(list) ? list : []);
    } catch {
      setError("주문 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) =>
      Object.values(o).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [orders, search]);

  const cols = useMemo(() => {
    if (orders.length === 0) return [];
    return Object.keys(orders[0]).slice(0, 8);
  }, [orders]);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">출고 주문</h1>
          <p className="text-slate-500 text-sm mt-0.5">Shipping order 목록</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          새로고침
        </button>
      </div>

      <div className="relative mb-5 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="주문번호, 고객사 검색..."
          className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
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

      {!loading && filtered.length === 0 && !error && (
        <div className="text-center py-20 text-slate-400">
          <Truck className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">주문 데이터가 없습니다</p>
        </div>
      )}

      {!loading && filtered.length > 0 && cols.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {cols.map((c) => (
                    <th key={c} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((order, idx) => (
                  <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                    {cols.map((c) => {
                      const val = String(order[c] ?? "-");
                      const isStatus = c.toLowerCase().includes("status");
                      return (
                        <td key={c} className="px-4 py-2.5 whitespace-nowrap">
                          {isStatus ? (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColor(val)}`}>
                              {val}
                            </span>
                          ) : (
                            <span className="text-slate-700">{val}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rawResponse && (
        <details className="mt-6 bg-slate-800 rounded-xl p-4 text-xs">
          <summary className="text-slate-400 cursor-pointer select-none">Raw API 응답 (개발용)</summary>
          <pre className="text-green-400 overflow-auto max-h-60 mt-3">{JSON.stringify(rawResponse, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
