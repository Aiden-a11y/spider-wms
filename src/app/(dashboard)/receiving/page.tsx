"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { RefreshCw, AlertCircle, PackageCheck, X, Search, ArrowLeftRight } from "lucide-react";

type Row = Record<string, unknown>;

function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm text-slate-800 font-medium">{String(value ?? "-")}</p>
    </div>
  );
}

const STATUS_OPTIONS = [
  { code: "AA", label: "AA - Pre Alert" },
  { code: "CA", label: "CA - Processing" },
  { code: "DA", label: "DA - Complete" },
  { code: "EA", label: "EA - Hold" },
];

function StatusBadge({ status, name }: { status: string; name?: string }) {
  const colors: Record<string, string> = {
    DA: "bg-green-100 text-green-700",
    AA: "bg-yellow-100 text-yellow-700",
    CA: "bg-blue-100 text-blue-700",
    EA: "bg-red-100 text-red-700",
    WA: "bg-purple-100 text-purple-700",
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
  const [filterStatus, setFilterStatus] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("");
  const [filterCustomer, setFilterCustomer] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [detailRaw, setDetailRaw] = useState<unknown>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"info" | "items" | "docs" | "raw">("info");
  const [statusModal, setStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  const [cancelComment, setCancelComment] = useState("");
  const [statusChanging, setStatusChanging] = useState(false);
  const [statusError, setStatusError] = useState("");

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
      // fetch detail + items in parallel
      const warehouseCode = String(row.warehouseCode ?? "");
      const customerCode = String(row.customerCode ?? "");

      const [detailRes, itemsRes] = await Promise.all([
        fetch(`/api/wms/receiving/${code}`, { headers }),
        fetch(`/api/wms/receiving/items/${code}`, { headers }),
      ]);
      const detailJson = await detailRes.json();
      const itemsJson = await itemsRes.json().catch(() => null);

      const d: Row = (detailJson?.data ?? detailJson) as Row;
      const itemList: Row[] = Array.isArray(itemsJson?.data?.items)
        ? itemsJson.data.items
        : Array.isArray(itemsJson?.data?.list)
        ? itemsJson.data.list
        : Array.isArray(itemsJson?.data)
        ? itemsJson.data
        : Array.isArray(itemsJson)
        ? itemsJson
        : [];

      const merged = { ...d, _itemList: itemList };
      setDetailRaw({ detail: detailJson, items: itemsJson });
      setDetail(merged);
    } catch {
      setDetail(row);
      setDetailRaw(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setSelected(null);
    setDetail(null);
    setDetailRaw(null);
    setStatusModal(false);
    setNewStatus("");
    setCancelComment("");
    setStatusError("");
  }

  async function changeStatus() {
    if (!newStatus) return;
    setStatusChanging(true);
    setStatusError("");
    const code = String(d.receiveOrderCode ?? d.orderCode ?? "");
    try {
      const res = await fetch("/api/wms/receiving/status-change", {
        method: "POST",
        headers,
        body: JSON.stringify({
          warehouseCode: String(d.warehouseCode ?? ""),
          customerCode: String(d.customerCode ?? ""),
          orderCodes: [code],
          newStatus,
          completeDate: "",
          cancelComment,
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.success === false || json?.code === "ERROR") {
        throw new Error(json?.message ?? "Status change failed");
      }
      setStatusModal(false);
      setNewStatus("");
      setCancelComment("");
      // refresh list and re-fetch detail
      await load();
      const updatedRow = { ...selected!, status: newStatus };
      await openDetail(updatedRow);
    } catch (e) {
      setStatusError(String(e instanceof Error ? e.message : e));
    } finally {
      setStatusChanging(false);
    }
  }

  const warehouseOptions = useMemo(() =>
    Array.from(new Set(data.map((r) => String(r.warehouseCode ?? "")).filter(Boolean))).sort(),
    [data]
  );
  const customerOptions = useMemo(() =>
    Array.from(new Set(data.map((r) => String(r.customerCode ?? "")).filter(Boolean))).sort(),
    [data]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.filter((r) => {
      if (q && !Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q))) return false;
      if (filterStatus && String(r.status ?? "") !== filterStatus) return false;
      if (filterWarehouse && String(r.warehouseCode ?? "") !== filterWarehouse) return false;
      if (filterCustomer && String(r.customerCode ?? "") !== filterCustomer) return false;
      return true;
    });
  }, [data, search, filterStatus, filterWarehouse, filterCustomer]);

  const activeFilterCount = [filterStatus, filterWarehouse, filterCustomer].filter(Boolean).length;

  const d = detail ?? selected ?? {};
  const items: Row[] = Array.isArray(d._itemList)
    ? (d._itemList as Row[])
    : Array.isArray(d.receiveItemList ?? d.itemList ?? d.items)
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

      {/* Search + Filters */}
      <div className="flex flex-wrap gap-3 mb-5 items-center">
        {/* Global search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order no, customer..."
            className="border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-56" />
        </div>

        {/* Status filter */}
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.code} value={s.code}>{s.label}</option>
          ))}
        </select>

        {/* Warehouse filter */}
        <select value={filterWarehouse} onChange={(e) => setFilterWarehouse(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Warehouses</option>
          {warehouseOptions.map((w) => (
            <option key={w} value={w}>{w}</option>
          ))}
        </select>

        {/* Customer filter */}
        <select value={filterCustomer} onChange={(e) => setFilterCustomer(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Customers</option>
          {customerOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        {/* Clear filters */}
        {activeFilterCount > 0 && (
          <button
            onClick={() => { setFilterStatus(""); setFilterWarehouse(""); setFilterCustomer(""); }}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Clear ({activeFilterCount})
          </button>
        )}

        {/* Result count */}
        <span className="text-xs text-slate-400 ml-auto">
          {filtered.length} / {data.length} records
        </span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/50" onClick={closeDetail} />
          <div className="relative w-full max-w-5xl bg-white shadow-2xl flex flex-col rounded-2xl overflow-hidden" style={{ height: "90vh" }}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-semibold text-slate-900 text-sm">
                Receiving — {String(d.receiveOrderCode ?? d.orderCode ?? "")}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setStatusModal(true); setStatusError(""); setNewStatus(""); setCancelComment(""); }}
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  Change Status
                </button>
                <button onClick={closeDetail} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Status Change Sub-modal */}
            {statusModal && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 rounded-2xl">
                <div className="bg-white rounded-xl shadow-xl w-80 p-6">
                  <h3 className="font-semibold text-slate-900 text-sm mb-4">Change Status</h3>
                  <div className="mb-4">
                    <label className="text-xs text-slate-500 uppercase tracking-wide mb-1.5 block">New Status</label>
                    <select
                      value={newStatus}
                      onChange={(e) => setNewStatus(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- Select --</option>
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s.code} value={s.code}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                  {newStatus === "EA" && (
                    <div className="mb-4">
                      <label className="text-xs text-slate-500 uppercase tracking-wide mb-1.5 block">Hold Reason</label>
                      <textarea
                        value={cancelComment}
                        onChange={(e) => setCancelComment(e.target.value)}
                        rows={2}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                        placeholder="Optional reason..."
                      />
                    </div>
                  )}
                  {statusError && (
                    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{statusError}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setStatusModal(false); setStatusError(""); }}
                      className="flex-1 text-sm border border-slate-200 rounded-lg py-2 text-slate-600 hover:bg-slate-50 transition-colors"
                    >Cancel</button>
                    <button
                      onClick={changeStatus}
                      disabled={!newStatus || statusChanging}
                      className="flex-1 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg py-2 font-medium transition-colors flex items-center justify-center gap-1.5"
                    >
                      {statusChanging && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                      {statusChanging ? "Saving..." : "Confirm"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {detailLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                {/* Tabs */}
                <div className="flex border-b border-slate-200 px-6">
                  {(["info", "items", "docs", "raw"] as const).map((tab) => (
                    <button key={tab} onClick={() => setActiveTab(tab)}
                      className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                        activeTab === tab
                          ? "border-blue-600 text-blue-600"
                          : "border-transparent text-slate-500 hover:text-slate-700"
                      }`}>
                      {tab === "info" ? "Info" : tab === "items" ? "Products" : tab === "docs" ? `Documents (${docs.length})` : "Raw"}
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
                      <Field label="Warehouse" value={`${d.warehouseCode ?? ""} - ${d.warehouseName ?? ""}`.replace(" - ", d.warehouseName ? " - " : "")} />
                      <Field label="Customer" value={`${d.customerCode ?? ""} - ${d.customerName ?? ""}`} />
                      <Field label="PO Number" value={d.poNum ?? d.poNo ?? d.poNumber} />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <Field label="Order Date" value={d.orderDate} />
                      <Field label="ETA Date" value={d.etaDate} />
                      <Field label="In Date" value={d.inDate ?? d.receiveDate} />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <Field label="Container No" value={d.containerNo} />
                      <Field label="Container Size" value={d.containerSize} />
                      <Field label="Seal No" value={d.sealNo ?? d.sealNo} />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <Field label="Pallet Count" value={d.palletCount ?? d.palletQty} />
                      <Field label="Item Count" value={d.itemCount} />
                      <Field label="Total Qty" value={d.totalQty} />
                    </div>

                    {/* Remarks */}
                    {d.comment != null && String(d.comment).trim() !== "" && (
                      <div>
                        <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Remarks</p>
                        <p className="text-sm text-slate-700 bg-slate-50 rounded-lg px-4 py-3 border border-slate-100">{String(d.comment)}</p>
                      </div>
                    )}

                    {/* Additional fields */}
                    {(() => {
                      const SKIP = new Set([
                        "receiveOrderCode","orderCode","receiveOrderNo","orderNo","status","statusName",
                        "warehouseCode","warehouseName","customerCode","customerName","poNo","poNumber","poNum",
                        "orderDate","etaDate","inDate","receiveDate","containerNo","containerSize",
                        "sealNo","palletCount","palletQty","itemCount","totalQty","assignedQty",
                        "receiveItemList","itemList","items","documentList","documents","_itemList","comment",
                      ]);
                      const LABELS: Record<string, string> = {
                        omsReceiveOrderCode: "OMS Order Code",
                        originCode: "Origin",
                        itemsValue: "Cargo Value",
                        cancelDate: "Cancel Date",
                        cancelComment: "Cancel Reason",
                        add1: "Extra Info 1", add2: "Extra Info 2",
                        add3: "Extra Info 3", add4: "Extra Info 4",
                        createdBy: "Created By", createdAt: "Created At",
                        updatedBy: "Updated By", updatedAt: "Updated At",
                      };
                      const extra = Object.keys(d).filter(k => !SKIP.has(k) && d[k] != null && String(d[k]).trim() !== "");
                      if (extra.length === 0) return null;
                      return (
                        <div>
                          <p className="text-xs text-slate-400 uppercase tracking-wide mb-3">Additional Info</p>
                          <div className="border border-slate-200 rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                              <tbody>
                                {extra.map((k, i) => (
                                  <tr key={k} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                                    <td className="px-4 py-2.5 text-slate-500 font-medium w-48 border-r border-slate-100">
                                      {LABELS[k] ?? k}
                                    </td>
                                    <td className="px-4 py-2.5 text-slate-800">
                                      {typeof d[k] === "object" ? JSON.stringify(d[k]) : String(d[k])}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })()}
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
                              <th className="px-3 py-2 text-left text-slate-500 font-medium">LOT</th>
                              <th className="px-3 py-2 text-left text-slate-500 font-medium">Expire</th>
                              <th className="px-3 py-2 text-right text-slate-500 font-medium">Order Qty</th>
                              <th className="px-3 py-2 text-right text-slate-500 font-medium">Assigned</th>
                              <th className="px-3 py-2 text-right text-slate-500 font-medium">Unassigned</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((item, i) => (
                              <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                                <td className="px-3 py-2 text-slate-400">{item.seq != null ? String(item.seq) : i + 1}</td>
                                <td className="px-3 py-2 font-mono font-medium text-slate-900">{String(item.productSku ?? "-")}</td>
                                <td className="px-3 py-2 text-slate-700 max-w-xs truncate">{String(item.productName ?? "-")}</td>
                                <td className="px-3 py-2 font-mono text-slate-500">{String(item.lotNo ?? "-")}</td>
                                <td className="px-3 py-2 text-slate-500">{String(item.expireDate ?? "-")}</td>
                                <td className="px-3 py-2 text-right font-semibold">{String(item.orderQty ?? "-")}</td>
                                <td className="px-3 py-2 text-right text-slate-500">{String(item.assignedQty ?? "-")}</td>
                                <td className="px-3 py-2 text-right text-slate-500">{String(item.unassignedQty ?? "-")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "raw" && (
                  <div className="p-6">
                    <pre className="text-xs text-green-400 bg-slate-800 rounded-xl p-4 overflow-auto max-h-[60vh]">
                      {JSON.stringify(detailRaw, null, 2)}
                    </pre>
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
