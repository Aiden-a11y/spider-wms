"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { RefreshCw, AlertCircle, PackageCheck, X, Search } from "lucide-react";

type Row = Record<string, unknown>;

function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm text-slate-800 font-medium">{String(value ?? "-")}</p>
    </div>
  );
}

function StatusBadge({ status, name }: { status: string; name?: string }) {
  const colors: Record<string, string> = {
    DA: "bg-green-100 text-green-700",
    AA: "bg-yellow-100 text-yellow-700",
    CA: "bg-red-100 text-red-700",
    WA: "bg-blue-100 text-blue-700",
  };
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${colors[status] ?? "bg-slate-100 text-slate-600"}`}>
      {name ?? status}
    </span>
  );
}

export default function ReceivingPage() {
  const { user } = useAuth();
  const [data, setData] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"info" | "items" | "docs">("info");

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
        body: JSON.stringify({ page: 1, limit: 200 }),
      });
      const json = await res.json();
      const list = json?.data?.list ?? json?.data ?? json?.list ?? json ?? [];
      setData(Array.isArray(list) ? list : []);
    } catch {
      setError("Failed to load receiving data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line

  async function openDetail(row: Row) {
    setSelected(row);
    setDetail(null);
    setActiveTab("info");
    setDetailLoading(true);
    const code = String(row.receiveOrderCode ?? row.orderCode ?? row.id ?? "");
    try {
      // try GET detail endpoint
      const res = await fetch(`/api/wms/receiving/${code}`, { headers });
      const json = await res.json();
      const d = json?.data ?? json;
      setDetail(typeof d === "object" && d !== null ? d as Row : row);
    } catch {
      setDetail(row);
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setSelected(null);
    setDetail(null);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((r) =>
      Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q))
    );
  }, [data, search]);

  const d = detail ?? selected ?? {};
  const items: Row[] = Array.isArray(d.receiveItemList ?? d.itemList ?? d.items)
    ? (d.receiveItemList ?? d.itemList ?? d.items) as Row[]
    : [];
  const docs: Row[] = Array.isArray(d.documentList ?? d.documents)
    ? (d.documentList ?? d.documents) as Row[]
    : [];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Receiving</h1>
          <p className="text-slate-500 text-sm mt-0.5">Receiving list</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-5 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search order no, customer..."
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

      {!loading && data.length === 0 && !error && (
        <div className="text-center py-20 text-slate-400">
          <PackageCheck className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No receiving data found</p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {["ORDER CODE","ORDER NO","WAREHOUSE","CUSTOMER","CUSTOMER NAME","ORDER DATE","STATUS","STATUS NAME"].map((c) => (
                    <th key={c} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, idx) => {
                  const status = String(row.status ?? row.STATUS ?? "");
                  const statusName = String(row.statusName ?? row.STATUSNAME ?? "");
                  return (
                    <tr key={idx}
                      onClick={() => openDetail(row)}
                      className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs text-blue-600 font-medium whitespace-nowrap">{String(row.receiveOrderCode ?? row.orderCode ?? "-")}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{String(row.receiveOrderNo ?? row.orderNo ?? "-")}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{String(row.warehouseCode ?? "-")}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{String(row.customerCode ?? "-")}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{String(row.customerName ?? "-")}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{String(row.orderDate ?? "-")}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <StatusBadge status={status} name={statusName || undefined} />
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{statusName || "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={closeDetail} />
          <div className="relative ml-auto w-full max-w-3xl bg-white shadow-2xl flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-semibold text-slate-900 text-sm">
                Receiving — {String(d.receiveOrderCode ?? d.orderCode ?? "")}
              </h2>
              <button onClick={closeDetail} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {detailLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                {/* Tabs */}
                <div className="flex border-b border-slate-200 px-6">
                  {(["info", "items", "docs"] as const).map((tab) => (
                    <button key={tab} onClick={() => setActiveTab(tab)}
                      className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                        activeTab === tab
                          ? "border-blue-600 text-blue-600"
                          : "border-transparent text-slate-500 hover:text-slate-700"
                      }`}>
                      {tab === "info" ? "Info" : tab === "items" ? `Receiving & Received Products` : `Documents (${docs.length})`}
                    </button>
                  ))}
                </div>

                {activeTab === "info" && (
                  <div className="p-6 space-y-6">
                    <div className="grid grid-cols-3 gap-4">
                      <Field label="Order Code" value={d.receiveOrderCode ?? d.orderCode} />
                      <Field label="Order No" value={d.receiveOrderNo ?? d.orderNo} />
                      <div>
                        <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Status</p>
                        <StatusBadge
                          status={String(d.status ?? "")}
                          name={String(d.statusName ?? d.status ?? "")}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <Field label="Warehouse" value={`${d.warehouseCode ?? ""} - ${d.warehouseName ?? ""}`} />
                      <Field label="Customer" value={`${d.customerCode ?? ""} - ${d.customerName ?? ""}`} />
                      <Field label="PO Number" value={d.poNo ?? d.poNumber} />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <Field label="Order Date" value={d.orderDate} />
                      <Field label="ETA Date" value={d.etaDate} />
                      <Field label="In Date" value={d.inDate ?? d.receiveDate} />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <Field label="Container No" value={d.containerNo} />
                      <Field label="Container Size" value={d.containerSize} />
                      <Field label="Seal No" value={d.sealNo} />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <Field label="Pallet Count" value={d.palletCount ?? d.palletQty} />
                    </div>

                    {/* Show all extra fields from API */}
                    {Object.keys(d).filter(k => ![
                      "receiveOrderCode","orderCode","receiveOrderNo","orderNo","status","statusName",
                      "warehouseCode","warehouseName","customerCode","customerName","poNo","poNumber",
                      "orderDate","etaDate","inDate","receiveDate","containerNo","containerSize",
                      "sealNo","palletCount","palletQty","receiveItemList","itemList","items",
                      "documentList","documents"
                    ].includes(k)).length > 0 && (
                      <div>
                        <p className="text-xs text-slate-400 uppercase tracking-wide mb-3">Additional Info</p>
                        <div className="grid grid-cols-3 gap-4">
                          {Object.keys(d).filter(k => ![
                            "receiveOrderCode","orderCode","receiveOrderNo","orderNo","status","statusName",
                            "warehouseCode","warehouseName","customerCode","customerName","poNo","poNumber",
                            "orderDate","etaDate","inDate","receiveDate","containerNo","containerSize",
                            "sealNo","palletCount","palletQty","receiveItemList","itemList","items",
                            "documentList","documents"
                          ].includes(k)).map(k => (
                            <Field key={k} label={k} value={typeof d[k] === "object" ? JSON.stringify(d[k]) : d[k]} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "items" && (
                  <div className="p-6">
                    {items.length === 0 ? (
                      <p className="text-slate-400 text-sm text-center py-10">No items data</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200">
                              <th className="px-3 py-2 text-left text-slate-500 font-medium">#</th>
                              <th className="px-3 py-2 text-left text-slate-500 font-medium">SKU</th>
                              <th className="px-3 py-2 text-left text-slate-500 font-medium">Product</th>
                              <th className="px-3 py-2 text-left text-slate-500 font-medium">Location</th>
                              <th className="px-3 py-2 text-left text-slate-500 font-medium">Condition</th>
                              <th className="px-3 py-2 text-left text-slate-500 font-medium">Lot</th>
                              <th className="px-3 py-2 text-left text-slate-500 font-medium">Expire</th>
                              <th className="px-3 py-2 text-right text-slate-500 font-medium">Qty</th>
                              <th className="px-3 py-2 text-right text-slate-500 font-medium">Remain</th>
                              <th className="px-3 py-2 text-left text-slate-500 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((item, i) => (
                              <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                                <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                                <td className="px-3 py-2 font-mono font-medium text-slate-900">{String(item.productSku ?? item.sku ?? "-")}</td>
                                <td className="px-3 py-2 text-slate-700 max-w-xs truncate">{String(item.productName ?? item.product ?? "-")}</td>
                                <td className="px-3 py-2 font-mono text-slate-500">{String(item.locationCode ?? item.location ?? "-")}</td>
                                <td className="px-3 py-2 text-slate-500">{String(item.condition ?? item.conditionCode ?? "-")}</td>
                                <td className="px-3 py-2 text-slate-500">{String(item.lotNo ?? item.lot ?? "-")}</td>
                                <td className="px-3 py-2 text-slate-500">{String(item.expireDate ?? item.expire ?? "-")}</td>
                                <td className="px-3 py-2 text-right font-semibold">{String(item.qty ?? item.quantity ?? "-")}</td>
                                <td className="px-3 py-2 text-right text-slate-400">{String(item.remainQty ?? item.remain ?? "-")}</td>
                                <td className="px-3 py-2">
                                  <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-medium">
                                    {String(item.status ?? item.statusName ?? "-")}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "docs" && (
                  <div className="p-6">
                    {docs.length === 0 ? (
                      <p className="text-slate-400 text-sm text-center py-10">No documents</p>
                    ) : (
                      <div className="space-y-2">
                        {docs.map((doc, i) => (
                          <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg text-sm">
                            <span className="text-slate-700">{String(doc.fileName ?? doc.name ?? `Document ${i + 1}`)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
