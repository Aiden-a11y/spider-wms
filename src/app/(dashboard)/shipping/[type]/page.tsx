"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useParams } from "next/navigation";
import {
  RefreshCw, AlertCircle, Truck, Search, Download, X,
  Building2, User, Store, Globe, MapPin, Save, CheckCircle2, ArrowLeftRight,
} from "lucide-react";
import { buildLocationOccupancyLookup, getLocationOccupancyInfo } from "@/lib/wms";
import { supabase } from "@/lib/supabase";

/* ── Shipping type config ── */
const TYPE_META: Record<string, {
  label: string; desc: string; icon: React.ElementType;
  accent: string; accentLight: string; orderType: string;
}> = {
  b2b: { label: "B2B Shipping", desc: "Business to Business",  icon: Building2, accent: "bg-blue-600",   accentLight: "bg-blue-50 text-blue-700 border-blue-200",     orderType: "B2B" },
  b2c: { label: "B2C Shipping", desc: "Business to Consumer",  icon: User,      accent: "bg-purple-600", accentLight: "bg-purple-50 text-purple-700 border-purple-200", orderType: "B2C" },
  b2s: { label: "B2S Shipping", desc: "Business to Store",     icon: Store,     accent: "bg-amber-600",  accentLight: "bg-amber-50 text-amber-700 border-amber-200",    orderType: "B2S" },
  b2e: { label: "B2E Shipping", desc: "Business to eCommerce", icon: Globe,     accent: "bg-teal-600",   accentLight: "bg-teal-50 text-teal-700 border-teal-200",       orderType: "B2E" },
};

const STATUS_META: Record<string, { label: string; badge: string }> = {
  AA: { label: "Out-Bound Request",       badge: "bg-yellow-50  text-yellow-700  border-yellow-200"  },
  CA: { label: "Packing Request",         badge: "bg-blue-50    text-blue-700    border-blue-200"    },
  DA: { label: "Packing Complete",        badge: "bg-cyan-50    text-cyan-700    border-cyan-200"    },
  AR: { label: "Auto Label Request",      badge: "bg-violet-50  text-violet-700  border-violet-200"  },
  AC: { label: "Auto Label Complete",     badge: "bg-indigo-50  text-indigo-700  border-indigo-200"  },
  LR: { label: "Twinny Packing Request",  badge: "bg-amber-50   text-amber-700   border-amber-200"   },
  L2: { label: "Twinny Cancel Request",   badge: "bg-orange-50  text-orange-700  border-orange-200"  },
  LC: { label: "Twinny Packing Complete", badge: "bg-teal-50    text-teal-700    border-teal-200"    },
  HA: { label: "Hold",                    badge: "bg-red-50     text-red-700     border-red-200"     },
  CC: { label: "Cancelled Order",         badge: "bg-slate-100  text-slate-500   border-slate-200"   },
  FA: { label: "Complete",               badge: "bg-green-50   text-green-700   border-green-200"   },
};
const statusBadge  = (c: string) => STATUS_META[c]?.badge  ?? "bg-slate-100 text-slate-500 border-slate-200";
const statusLabel  = (c: string) => STATUS_META[c]?.label  ?? c;

// All changeable statuses (in logical order)
const STATUS_OPTIONS = [
  { code: "CA", label: "CA - Packing Request"         },
  { code: "DA", label: "DA - Packing Complete"         },
  { code: "AR", label: "AR - Auto Label Request"       },
  { code: "AC", label: "AC - Auto Label Complete"      },
  { code: "LR", label: "LR - Twinny Packing Request"  },
  { code: "L2", label: "L2 - Twinny Order Cancel Req" },
  { code: "LC", label: "LC - Twinny Packing Complete" },
  { code: "HA", label: "HA - Hold"                    },
  { code: "CC", label: "CC - Cancelled Order"         },
  { code: "FA", label: "FA - Complete"                },
] as const;

// Rank for forward-only guard (HA / CC are always allowed)
const STATUS_RANK: Record<string, number> = {
  AA: 0, CA: 1, DA: 2, AR: 3, AC: 4, LR: 5, L2: 6, LC: 7, FA: 8,
};

const COL_LABELS: Record<string, string> = {
  shippingOrderCode: "Order Code", orderCode: "Order Code", outboundCode: "Order Code",
  customerCode: "Customer", customerName: "Customer Name",
  status: "Status", orderStatus: "Status",
  orderDate: "Order Date", shippingDate: "Ship Date", requestDate: "Request Date",
  totalQty: "Qty", qty: "Qty",
  warehouseCode: "Warehouse",
  trackingNo: "Tracking #", trackingNumber: "Tracking #",
  receiverName: "Receiver", deliveryAddress: "Address",
  shippingOrderNo: "Shipping Order No", orderType: "Order Type",
  totalWeight: "Total Weight", length: "Length", width: "Width", height: "Height",
  invoiceValue: "Invoice Value", fareValue: "Fare Value", fareEtcValue: "Fare Etc",
  insuranceValue: "Insurance Value", shippingRate: "Shipping Rate", shippingCost: "Shipping Cost",
  consignorName: "Consignor", consignorAddress1: "Address",
  consignorCity: "City", consignorState: "State",
  consignorZip: "ZIP", consignorZipCode: "ZIP",
  consignorNationalCode: "Country", consignorTelLno: "Tel",
  comment: "Comment",
};

/* ── Task types for comment builder ── */
const TASK_TYPES = [
  "Labels",
  "Amazon Labels",
  "Inserts",
  "Picking per Piece",
  "Picking per Carton",
  "Picking per Pallet",
  "Packing with Customer Box",
  "Palletizing and Wrapping",
  "Out per Carton",
  "Out per Pallet",
  "Wrapping",
  "FBA Bundling",
  "FBA Labeling",
  "FBA Repacking",
  "Supplies",
] as const;

type TaskItem = { type: string; qty: number };

/* ── Field display / edit helper ── */
function Field({ label, value, onChange }: { label: string; value: unknown; onChange?: (v: string) => void }) {
  const v = value == null || value === "" ? "-" : String(value);
  if (onChange) {
    return (
      <div>
        <label className="text-xs text-slate-400 uppercase tracking-wide mb-1 block">{label}</label>
        <input
          type="text"
          value={v === "-" ? "" : v}
          onChange={(e) => onChange(e.target.value)}
          placeholder="-"
          className="w-full text-sm text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
        />
      </div>
    );
  }
  return (
    <div>
      <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-sm text-slate-800 font-medium break-all">{v}</p>
    </div>
  );
}

interface Order     { [key: string]: unknown }
interface Customer  { code: string; name: string }
interface Warehouse { id: string; name: string }

export default function ShippingTypePage() {
  const { user }  = useAuth();
  const params    = useParams();
  const type      = String(params.type ?? "b2b").toLowerCase();
  const meta      = TYPE_META[type] ?? TYPE_META.b2b;
  const Icon      = meta.icon;

  const [warehouses,    setWarehouses]    = useState<Warehouse[]>([]);
  const [warehouseCode, setWarehouseCode] = useState("");
  const [customers,     setCustomers]     = useState<Customer[]>([]);
  const [customerCode,  setCustomerCode]  = useState("ALL");
  const [orders,        setOrders]        = useState<Order[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState("");
  const [search,        setSearch]        = useState("");
  const [colFilters,    setColFilters]    = useState<Record<string, string>>({});
  const [debugInfo,     setDebugInfo]     = useState<{ endpoint?: string; raw?: unknown }>({});

  /* ── Modal state ── */
  const [selected,      setSelected]      = useState<Order | null>(null);
  const [detail,        setDetail]        = useState<Order | null>(null);
  const [itemsRaw,      setItemsRaw]      = useState<Order[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab,     setActiveTab]     = useState<"info" | "address" | "package" | "additional" | "picking" | "raw">("info");
  const [editMode,      setEditMode]      = useState(false);
  const [editData,      setEditData]      = useState<Order>({});
  const [saving,        setSaving]        = useState(false);
  const [saveError,     setSaveError]     = useState("");

  /* ── Picking / Occupancy state ── */
  const [occupancyMap,  setOccupancyMap]  = useState<Map<string, string>>(new Map());
  const [savingPicking, setSavingPicking] = useState(false);
  const [pickingSaved,  setPickingSaved]  = useState(false);

  /* ── Auto Assign state ── */
  const [autoAssigning,    setAutoAssigning]    = useState(false);
  const [autoAssignResult, setAutoAssignResult] = useState<"" | "ok" | "error">("");
  const [autoAssignMsg,    setAutoAssignMsg]    = useState("");

  /* ── Change Status state ── */
  const [statusModal,    setStatusModal]    = useState(false);
  const [newStatus,      setNewStatus]      = useState("");
  const [cancelComment,  setCancelComment]  = useState("");
  const [statusChanging, setStatusChanging] = useState(false);
  const [statusError,    setStatusError]    = useState("");

  /* ── Task comment builder ── */
  const [taskItems,  setTaskItems]  = useState<TaskItem[]>([]);
  const [taskType,   setTaskType]   = useState<string>(TASK_TYPES[0]);
  const [taskQty,    setTaskQty]    = useState<number | "">(1);

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  /* ── 1. Warehouses ── */
  useEffect(() => {
    fetch("/api/wms/combo/warehouse", { headers })
      .then((r) => r.json())
      .then((json) => {
        const arr: Record<string, unknown>[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
        const list = arr.map((w) => ({ id: String(w.code ?? w.id ?? ""), name: String(w.name ?? w.code ?? "") })).filter((w) => w.id);
        setWarehouses(list);
        const pref = list.find((w) => w.id === "STOO1") ?? list[0];
        if (pref) setWarehouseCode(pref.id);
      }).catch(() => {});
  }, []); // eslint-disable-line

  /* ── 2. Customers by order type ── */
  useEffect(() => {
    if (!warehouseCode) return;
    fetch(`/api/wms/combo/customer-by-ordertype/${meta.orderType}?warehouseCode=${warehouseCode}`, { headers })
      .then((r) => r.json())
      .then((json) => {
        const arr: Record<string, unknown>[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
        setCustomers(arr.map((c) => ({ code: String(c.code ?? c.customerCode ?? ""), name: String(c.name ?? c.customerName ?? c.code ?? "") })).filter((c) => c.code));
        setCustomerCode("ALL");
      }).catch(() => setCustomers([]));
  }, [warehouseCode, type]); // eslint-disable-line

  /* ── 3. Orders ── */
  async function loadOrders(whCode = warehouseCode, custCode = customerCode) {
    if (!whCode) return;
    setLoading(true); setError(""); setOrders([]); setColFilters({});
    const body: Record<string, unknown> = { page: 1, limit: 500, pageSize: 500, orderType: meta.orderType, warehouseCode: whCode };
    if (custCode && custCode !== "ALL") body.customerCode = custCode;
    for (const ep of [`/api/wms/shipping/${type}/list`, `/api/wms/shipping/list`, `/api/wms/outbound/${type}/list`, `/api/wms/outbound/list`]) {
      try {
        const res  = await fetch(ep, { method: "POST", headers, body: JSON.stringify(body) });
        const json = await res.json();
        setDebugInfo({ endpoint: ep, raw: json });
        const list = json?.data?.list ?? json?.data?.items ?? json?.data ?? json?.list ?? json?.items ?? (Array.isArray(json) ? json : []);
        if (res.ok) { setOrders(Array.isArray(list) ? list : []); setLoading(false); return; }
      } catch { /* try next */ }
    }
    setError("Could not load orders."); setLoading(false);
  }
  useEffect(() => { if (warehouseCode) loadOrders(); }, [warehouseCode, type]); // eslint-disable-line

  /* ── 4. Fetch order detail on row click ── */
  async function openDetail(order: Order) {
    setSelected(order);
    setDetail(null);
    setItemsRaw([]);
    setActiveTab("info");
    setDetailLoading(true);
    setOccupancyMap(new Map());
    setPickingSaved(false);

    const code = String(order.shippingOrderCode ?? order.orderCode ?? order.outboundCode ?? "");

    // detail endpoints — confirmed working: GET /shipping/{code} (no type prefix)
    const detailEndpoints = [
      `/api/wms/shipping/${code}`,           // ← confirmed 200 OK
      `/api/wms/shipping/${type}/${code}`,
      `/api/wms/shipping/detail/${code}`,
      `/api/wms/outbound/${type}/${code}`,
      `/api/wms/outbound/detail/${code}`,
    ];
    const itemEndpoints = [
      `/api/wms/shipping/${type}/items/${code}`,
      `/api/wms/shipping/items/${code}`,
    ];

    // ── Step 1: set detail from list-row immediately so UI isn't blank
    setDetail(order); setDetailLoading(false);

    // ── Step 2: try GET detail endpoints for extra fields (address, pkg, etc.)
    //   Always merge back onto `order` so we never lose status from the list row.
    for (const ep of detailEndpoints) {
      try {
        const res  = await fetch(ep, { headers });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json) continue;
        const fetched = (json?.data ?? json) as Record<string, unknown>;
        if (!fetched || typeof fetched !== "object" || Array.isArray(fetched)) continue;
        // Only accept if it looks like a real order (has at least one order-code field)
        const hasCode = fetched.shippingOrderCode ?? fetched.orderCode ?? fetched.outboundCode;
        if (!hasCode) continue;
        // Merge: detail wins for everything (it's the freshest single-order GET),
        // but fall back to list-row values for any missing fields.
        // statusName comes from the WMS detail response directly.
        setDetail({
          ...order,
          ...fetched,
          status:     fetched.status     ?? fetched.orderStatus ?? order.status     ?? order.orderStatus,
          orderStatus:fetched.orderStatus?? fetched.status      ?? order.orderStatus?? order.status,
          statusName: fetched.statusName ?? order.statusName,
        });
        break;
      } catch { /* try next */ }
    }

    // ── Step 3: fresh status from WMS — reload the list, find this order
    {
      const whCode   = String(order.warehouseCode ?? order.warehouse ?? warehouseCode ?? "");
      const custCode = String(order.customerCode ?? "");
      const listBody: Record<string, unknown> = {
        page: 1, pageSize: 500, orderType: meta.orderType, warehouseCode: whCode,
      };
      if (custCode) listBody.customerCode = custCode;
      for (const ep of [`/api/wms/shipping/${type}/list`, `/api/wms/shipping/list`, `/api/wms/outbound/list`]) {
        try {
          const res  = await fetch(ep, { method: "POST", headers, body: JSON.stringify(listBody) });
          const json = await res.json().catch(() => null);
          if (!res.ok || !json) continue;
          const list: Record<string, unknown>[] =
            json?.data?.list ?? json?.data?.items ?? json?.data ?? json?.list ?? json?.items ?? (Array.isArray(json) ? json : []);
          if (!Array.isArray(list) || list.length === 0) continue;
          const match = list.find((r) => {
            const rc = String(r.shippingOrderCode ?? r.orderCode ?? r.outboundCode ?? "");
            return rc === code;
          });
          if (match) {
            const freshStatus = match.status ?? match.orderStatus;
            if (freshStatus != null) {
              // Also update the orders list so the table row reflects fresh status
              setOrders((prev) => prev.map((o) => {
                const oc = String(o.shippingOrderCode ?? o.orderCode ?? o.outboundCode ?? "");
                return oc === code ? { ...o, status: freshStatus, orderStatus: freshStatus } : o;
              }));
              setDetail((prev) => prev
                ? { ...prev, status: freshStatus, orderStatus: freshStatus }
                : match as Order
              );
            }
            break;
          }
        } catch { /* ignore */ }
      }
    }

    // Helper: extract item array from any response shape
    // Confirmed: shipping/items/{code} returns { assignments: [...] }
    function parseItemList(json: unknown): Record<string, unknown>[] | null {
      if (!json || typeof json !== "object") return null;
      const j = json as Record<string, unknown>;
      const candidates = [
        j?.assignments,             // ← confirmed shape: { assignments: [...] }
        (j?.data as Record<string, unknown>)?.assignments,
        (j?.data as Record<string, unknown>)?.list,
        (j?.data as Record<string, unknown>)?.items,
        j?.data,
        j?.list,
        j?.items,
        Array.isArray(json) ? json : null,
      ];
      for (const c of candidates) {
        if (Array.isArray(c) && c.length > 0) return c as Record<string, unknown>[];
      }
      return null;
    }

    // Try GET endpoints first (the confirmed working one is shipping/items/{code})
    let itemsFetched = false;
    for (const ep of itemEndpoints) {
      try {
        const res  = await fetch(ep, { headers });
        const json = await res.json().catch(() => null);
        const list = parseItemList(json);
        if (res.ok && list) { setItemsRaw(list); itemsFetched = true; break; }
      } catch { /* ignore */ }
    }
    // Fallback: POST endpoints
    if (!itemsFetched) {
      const itemPostEndpoints = [
        { url: `/api/wms/shipping/${type}/item/list`, body: { shippingOrderCode: code, pageNum: 1, pageSize: 500 } },
        { url: `/api/wms/shipping/item/list`,          body: { shippingOrderCode: code, pageNum: 1, pageSize: 500 } },
        { url: `/api/wms/outbound/item/list`,          body: { shippingOrderCode: code, pageNum: 1, pageSize: 500 } },
      ];
      for (const { url, body } of itemPostEndpoints) {
        try {
          const res  = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
          const json = await res.json().catch(() => null);
          const list = parseItemList(json);
          if (res.ok && list) { setItemsRaw(list); break; }
        } catch { /* try next */ }
      }
    }

    // Load occupancy map for the warehouse (best-effort)
    const whCode = String(order.warehouseCode ?? order.warehouse ?? warehouseCode ?? "");
    if (whCode) {
      try {
        const res = await fetch("/api/wms/warehouse/location/list", {
          method: "POST",
          headers,
          body: JSON.stringify({ page: 1, pageSize: 9999, warehouseCode: whCode }),
        });
        const json = await res.json().catch(() => ({}));
        const arr: Record<string, unknown>[] =
          Array.isArray(json?.data?.list) ? json.data.list :
          Array.isArray(json?.data) ? json.data :
          Array.isArray(json) ? json : [];
        if (arr.length > 0) setOccupancyMap(buildLocationOccupancyLookup(arr));
      } catch { /* ignore */ }
    }
  }

  function closeDetail() {
    setSelected(null); setDetail(null); setItemsRaw([]);
    setEditMode(false); setEditData({}); setSaveError("");
    setTaskItems([]); setTaskType(TASK_TYPES[0]); setTaskQty(1);
    setOccupancyMap(new Map()); setPickingSaved(false);
    setAutoAssigning(false); setAutoAssignResult(""); setAutoAssignMsg("");
    setStatusModal(false); setNewStatus(""); setCancelComment(""); setStatusError("");
  }

  /* ── Auto Assign: call WMS endpoint, then reload picking items ── */
  async function runAutoAssign() {
    if (!selected) return;
    const code = String(
      selected.shippingOrderCode ?? selected.orderCode ?? selected.outboundCode ?? ""
    );
    if (!code) return;

    const whCode   = String(selected.warehouseCode ?? selected.warehouse ?? warehouseCode ?? "");
    const custCode = String(selected.customerCode ?? "");

    setAutoAssigning(true);
    setAutoAssignResult("");
    setAutoAssignMsg("");

    // Confirmed WMS endpoint: POST /shipping/auto-assign
    // Payload: { warehouseCode, customerCode, orderCodes: [code] }
    let succeeded = false;
    try {
      const body = { warehouseCode: whCode, customerCode: custCode, orderCodes: [code] };
      const res  = await fetch("/api/wms/shipping/auto-assign", {
        method: "POST", headers, body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setAutoAssignResult("ok");
        setAutoAssignMsg(String((json as Record<string, unknown>)?.message ?? (json as Record<string, unknown>)?.msg ?? "Auto assign completed"));
        succeeded = true;
      } else {
        setAutoAssignResult("error");
        setAutoAssignMsg(String((json as Record<string, unknown>)?.message ?? (json as Record<string, unknown>)?.msg ?? `HTTP ${res.status}`));
        succeeded = true; // endpoint found, WMS rejected the request
      }
    } catch (e) {
      setAutoAssignResult("error");
      setAutoAssignMsg(String(e instanceof Error ? e.message : "Network error"));
    }

    if (!succeeded) {
      setAutoAssignResult("error");
      setAutoAssignMsg("Auto-assign request failed. Check network connection.");
    }

    setAutoAssigning(false);

    // Reload picking items after successful assign
    if (succeeded) {
      setItemsRaw([]);
      setPickingSaved(false);
      await openDetail(selected);
    }
  }

  /* ── Change Status ── */
  async function changeStatus() {
    if (!newStatus || !selected) return;
    setStatusChanging(true);
    setStatusError("");
    const code   = String(selected.shippingOrderCode ?? selected.orderCode ?? selected.outboundCode ?? "");
    const whCode = String(selected.warehouseCode ?? selected.warehouse ?? warehouseCode ?? "");
    const cust   = String(selected.customerCode ?? "");
    try {
      const res  = await fetch("/api/wms/shipping/change-status", {
        method: "POST", headers,
        body: JSON.stringify({
          warehouseCode: whCode,
          customerCode: cust,
          orderCodes: [code],
          newStatus,
          completeDate: "",
          cancelComment,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String((json as Record<string, unknown>)?.message ?? `HTTP ${res.status}`));
      setStatusModal(false);
      setNewStatus("");
      setCancelComment("");
      await loadOrders();
      const updatedRow = { ...selected, status: newStatus, orderStatus: newStatus };
      await openDetail(updatedRow);
    } catch (e) {
      setStatusError(String(e instanceof Error ? e.message : e));
    } finally {
      setStatusChanging(false);
    }
  }

  /* ── Save picking record to Supabase ── */
  async function savePickingRecord() {
    if (!supabase || itemList.length === 0) return;
    setSavingPicking(true);
    try {
      const orderCode  = String(d.shippingOrderCode ?? d.orderCode ?? d.outboundCode ?? "");
      const whCode     = String(d.warehouseCode ?? d.warehouse ?? warehouseCode ?? "");
      const custCode   = String(d.customerCode ?? "");

      const rows = itemList.map((item) => {
        // Build readable location: zoneNm/aisleNm/bayNm/levelNm/positionNm (confirmed field names)
        const locationParts = [
          item.zoneNm ?? item.zoneName ?? item.zone ?? "",
          item.aisleNm ?? item.aisleName ?? item.aisle ?? "",
          item.bayNm ?? item.bayName ?? item.bay ?? "",
          item.levelNm ?? item.levelName ?? item.level ?? "",
          item.positionNm ?? item.positionName ?? item.position ?? "",
        ].map(String).filter(Boolean);
        const location = locationParts.length > 0
          ? locationParts.join("-")
          : String(item.location ?? item.locationCode ?? "");
        const occupancyInfo = getLocationOccupancyInfo(occupancyMap, item as Record<string, unknown>)
          || (occupancyMap.get(location.replace(/[-_\s]/g, "").toUpperCase()) ?? "");
        // For assignments, qty IS the assigned qty; remain = 0 unless explicitly given
        const qty         = Number(item.qty ?? item.totalQty ?? 0);
        const assignedQty = Number(item.assignedQty ?? item.assigned ?? qty);
        const remainQty   = Number(item.remainQty ?? item.remain ?? 0);

        return {
          order_code:      orderCode,
          order_type:      type.toUpperCase(),
          warehouse_code:  whCode,
          customer_code:   custCode,
          sku:             String(item.productSku ?? item.sku ?? ""),
          product_name:    String(item.productName ?? item.itemName ?? "") || null,
          location,
          location_barcode: String(item.location ?? item.locationCode ?? "") || null,
          occupancy_info:  occupancyInfo || null,
          lot:             String(item.lotNo ?? item.lot ?? "") || null,
          expire_date:     String(item.expireDate ?? item.expiryDate ?? "") || null,
          qty,
          assigned_qty:    assignedQty,
          remain_qty:      remainQty,
          item_status:     String(item.status ?? item.itemStatus ?? item.itemCondition ?? "") || null,
        };
      });

      // Delete existing records for this order then re-insert
      await supabase.from("picking_records").delete().eq("order_code", orderCode);
      const { error } = await supabase.from("picking_records").insert(rows);
      if (error) throw error;
      setPickingSaved(true);
    } catch (e) {
      console.error("Save picking record:", e);
    } finally {
      setSavingPicking(false);
    }
  }

  function addTaskItem() {
    if (!taskType || !taskQty || Number(taskQty) <= 0) return;
    setTaskItems((prev) => {
      const existing = prev.findIndex((t) => t.type === taskType);
      if (existing >= 0) {
        // overwrite qty if same type already added
        return prev.map((t, i) => i === existing ? { ...t, qty: Number(taskQty) } : t);
      }
      return [...prev, { type: taskType, qty: Number(taskQty) }];
    });
  }

  function removeTaskItem(type: string) {
    setTaskItems((prev) => prev.filter((t) => t.type !== type));
  }

  function buildTaskText(items: TaskItem[]): string {
    return items.map((t) => `${t.type}×${t.qty}`).join(", ");
  }

  function startEdit() {
    setEditData({ ...(detail ?? selected ?? {}) });
    setEditMode(true);
    setSaveError("");
  }

  function cancelEdit() {
    setEditMode(false);
    setEditData({});
    setSaveError("");
  }

  async function saveEdit() {
    setSaving(true);
    setSaveError("");
    try {
      // Append task items to comment if any were added
      const mergedData = { ...editData };
      if (taskItems.length > 0) {
        const taskText = buildTaskText(taskItems);
        const existing = String(mergedData.comment ?? "").trim();
        mergedData.comment = existing ? `${existing} | ${taskText}` : taskText;
      }

      // API는 flat primitive 필드만 받음 — 배열/중첩 객체 제거
      const payload = Object.fromEntries(
        Object.entries(mergedData).filter(([, v]) =>
          v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean"
        )
      );
      const res = await fetch("/api/wms/shipping/save", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.isSuccess !== false) {
        setDetail(mergedData);
        setEditMode(false);
        setTaskItems([]);
        setSaving(false);
        return;
      }
      setSaveError(json?.message ?? "Save failed — check the API response.");
    } catch {
      setSaveError("Save failed — network error");
    }
    setSaving(false);
  }

  /* ── Derived ── */
  const cols = useMemo(() => {
    if (orders.length === 0) return [];
    const keys     = Object.keys(orders[0]);
    const priority = Object.keys(COL_LABELS);
    const raw = [...priority.filter((k) => keys.includes(k)), ...keys.filter((k) => !priority.includes(k))].slice(0, 10);
    // De-duplicate aliased columns: if both status+orderStatus or qty+totalQty appear, keep only the first
    const seen = new Set<string>();
    return raw.filter((k) => {
      const group = COL_LABELS[k] ?? k;  // group by display label
      if (seen.has(group)) return false;
      seen.add(group);
      return true;
    });
  }, [orders]);

  const colOptions = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const c of cols) {
      const vals = Array.from(new Set(orders.map((o) => String(o[c] ?? "")).filter(Boolean))).sort();
      if (vals.length > 1 && vals.length <= 100) map[c] = vals;
    }
    return map;
  }, [orders, cols]);

  const filtered = useMemo(() => {
    let list = orders;
    if (customerCode && customerCode !== "ALL") list = list.filter((o) => String(o.customerCode ?? "") === customerCode);
    for (const [col, val] of Object.entries(colFilters)) { if (val) list = list.filter((o) => String(o[col] ?? "") === val); }
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((o) => Object.values(o).some((v) => String(v).toLowerCase().includes(q)));
    return list;
  }, [orders, customerCode, colFilters, search]);

  const statusSummary = useMemo(() => {
    const map: Record<string, number> = {};
    for (const o of orders) { const s = String(o.status ?? o.orderStatus ?? "UNKNOWN"); map[s] = (map[s] ?? 0) + 1; }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [orders]);

  const activeFilters = Object.entries(colFilters).filter(([, v]) => v);
  function clearAllFilters() { setColFilters({}); setSearch(""); }

  async function downloadExcel() {
    const { utils, writeFile } = await import("xlsx");
    const rows = filtered.map((o) => Object.fromEntries(cols.map((c) => [COL_LABELS[c] ?? c, String(o[c] ?? "")])));
    const ws = utils.json_to_sheet(rows); const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, meta.label);
    writeFile(wb, `${type}_shipping_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  /* ── Detail modal content ── */
  const d = detail ?? selected ?? {};
  const orderCode = String(d.shippingOrderCode ?? d.orderCode ?? d.outboundCode ?? "");

  /* edit field helper: read from editData in edit mode, d otherwise */
  const ef = (key: string) => editMode
    ? { value: editData[key], onChange: (v: string) => setEditData((p) => ({ ...p, [key]: v })) }
    : { value: d[key] };
  const itemList: Order[] =
    itemsRaw.length > 0 ? itemsRaw
    : Array.isArray(d.itemList ?? d.items ?? d.shippingItemList)
      ? (d.itemList ?? d.items ?? d.shippingItemList) as Order[]
      : [];

  /* Fields to skip in "extra" section */
  const SKIP_FIELDS = new Set([
    "shippingOrderCode","orderCode","outboundCode","status","orderStatus","statusName",
    "warehouseCode","warehouseName","customerCode","customerName",
    "orderDate","shippingDate","requestDate","deliveryDate",
    "totalQty","qty","trackingNo","trackingNumber",
    "receiverName","receiverPhone","deliveryAddress","zipCode",
    "itemList","items","shippingItemList","documentList",
    "shippingOrderNo","orderType",
    "totalWeight","length","width","height",
    "invoiceValue","fareValue","fareEtcValue","insuranceValue","shippingRate","shippingCost",
    "consignorName","consignorAddress1","consignorCity","consignorState",
    "consignorZip","consignorZipCode","consignorNationalCode","consignorTelLno",
    "consigneeName","consigneeAddress1","consigneeAddress2","consigneeCity","consigneeState",
    "consigneeZipCode","consigneeNationalCode","consigneeTelLno","consigneeCellNo",
    "consigneeDeliveryMessage","consigneeEtc1","consigneeEtc2",
    "comment",
  ]);

  return (
    <div className="p-8">
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl ${meta.accent} flex items-center justify-center shadow-sm`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">{meta.label}</h1>
            <p className="text-slate-500 text-sm mt-0.5">{meta.desc}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={downloadExcel} disabled={filtered.length === 0}
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors disabled:opacity-40">
            <Download className="w-4 h-4" /> Export
          </button>
          <button onClick={() => loadOrders()} disabled={loading}
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* ── Top filters ── */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select value={warehouseCode} onChange={(e) => { setWarehouseCode(e.target.value); loadOrders(e.target.value, customerCode); }}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          {warehouses.length === 0 && <option value="">Loading...</option>}
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name || w.id}</option>)}
        </select>
        {customers.length > 0 && (
          <select value={customerCode} onChange={(e) => { setCustomerCode(e.target.value); loadOrders(warehouseCode, e.target.value); }}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="ALL">All Customers</option>
            {customers.map((c) => <option key={c.code} value={c.code}>{c.name || c.code}</option>)}
          </select>
        )}
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order, customer, tracking..."
            className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {(activeFilters.length > 0 || search) && (
          <button onClick={clearAllFilters}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-600 border border-slate-200 hover:border-red-200 rounded-lg px-3 py-2 hover:bg-red-50 transition-colors">
            <X className="w-3.5 h-3.5" /> Clear filters
          </button>
        )}
      </div>

      {/* ── Active filter chips ── */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {activeFilters.map(([col, val]) => {
            const isStatus = col.toLowerCase().includes("status");
            return (
              <span key={col} className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${isStatus ? statusBadge(val) : "bg-blue-50 text-blue-700 border-blue-200"}`}>
                <span className="opacity-60">{COL_LABELS[col] ?? col}:</span>
                {isStatus ? statusLabel(val) : val}
                <button onClick={() => setColFilters((f) => { const n = { ...f }; delete n[col]; return n; })} className="hover:opacity-60"><X className="w-3 h-3" /></button>
              </span>
            );
          })}
        </div>
      )}

      {/* ── Status pills (clickable filter) ── */}
      {statusSummary.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {statusSummary.map(([s, c]) => {
            const statusCol = cols.find((col) => col === "status" || col === "orderStatus") ?? "status";
            const isActive  = colFilters[statusCol] === s;
            return (
              <button key={s}
                onClick={() => setColFilters((f) => ({ ...f, [statusCol]: isActive ? "" : s }))}
                className={`text-xs font-semibold px-3 py-1 rounded-full border transition-all ${statusBadge(s)} ${isActive ? "ring-2 ring-offset-1 ring-current scale-105" : "hover:scale-105 opacity-80 hover:opacity-100"}`}>
                {statusLabel(s)} <span className="opacity-60">· {c}</span>
              </button>
            );
          })}
          <span className="ml-auto text-xs text-slate-400 self-center">
            {filtered.length !== orders.length ? `${filtered.length.toLocaleString()} / ${orders.length.toLocaleString()}` : `${orders.length.toLocaleString()} total`}
          </span>
        </div>
      )}

      {error && <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-5"><AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}</div>}
      {loading && <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-100 h-11 animate-pulse" />)}</div>}
      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-20 text-slate-400">
          <Truck className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No {meta.label} orders found</p>
        </div>
      )}

      {/* ── Table ── */}
      {!loading && filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  {cols.map((c) => (
                    <th key={c} className="px-4 py-2.5 text-left text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">
                      {COL_LABELS[c] ?? c}
                    </th>
                  ))}
                  {/* Fixed: Packing/Billing Info column */}
                  <th className="px-4 py-2.5 text-center text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">
                    Task
                  </th>
                </tr>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {cols.map((c) => {
                    const opts   = colOptions[c];
                    const active = !!colFilters[c];
                    return (
                      <th key={c} className="px-2 py-1.5">
                        {opts ? (
                          <select value={colFilters[c] ?? ""} onChange={(e) => setColFilters((f) => ({ ...f, [c]: e.target.value }))}
                            className={`w-full text-xs rounded border py-1 px-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 transition-colors ${active ? "border-blue-400 bg-blue-50 text-blue-700 font-medium" : "border-slate-200 bg-white text-slate-500"}`}>
                            <option value="">All</option>
                            {opts.map((v) => {
                              const isSt = c.toLowerCase().includes("status");
                              return <option key={v} value={v}>{isSt ? statusLabel(v) : v}</option>;
                            })}
                          </select>
                        ) : <div className="h-6" />}
                      </th>
                    );
                  })}
                  {/* filter placeholder for Packing Info */}
                  <th className="px-2 py-1.5"><div className="h-6" /></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((order, idx) => {
                  // Task check: tasks are saved as "Labels×3, Picking per Piece×1" (contains ×)
                  // Only show checkmark if comment has actual task entries (not arbitrary comment text)
                  const comment = String(order.comment ?? order.orderComment ?? order.memo ?? "").trim();
                  const hasTask = comment.includes("×");
                  return (
                    <tr key={idx} onClick={() => openDetail(order)}
                      className="border-b border-slate-100 last:border-0 hover:bg-blue-50 cursor-pointer transition-colors group">
                      {cols.map((c) => {
                        const val      = String(order[c] ?? "-");
                        const isStatus = c.toLowerCase().includes("status");
                        const isMono   = c.toLowerCase().includes("code") || c.toLowerCase().includes("no") || c.toLowerCase().includes("tracking");
                        return (
                          <td key={c} className="px-4 py-2.5 whitespace-nowrap">
                            {isStatus ? (
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${statusBadge(val)}`}>{statusLabel(val)}</span>
                            ) : isMono ? (
                              <span className="font-mono font-medium text-slate-700 group-hover:text-blue-700">{val}</span>
                            ) : (
                              <span className="text-slate-600">{val}</span>
                            )}
                          </td>
                        );
                      })}
                      {/* Task cell — ✓ only if task items exist (comment contains ×) */}
                      <td className="px-4 py-2.5 text-center">
                        {hasTask ? (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-600" title={comment}>
                            <CheckCircle2 className="w-4 h-4" />
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Detail Modal ── */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/50" onClick={closeDetail} />
          <div className="relative w-full max-w-4xl bg-white shadow-2xl flex flex-col rounded-2xl overflow-hidden" style={{ height: "88vh" }}>

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className={`w-7 h-7 rounded-lg ${meta.accent} flex items-center justify-center`}>
                  <Icon className="w-3.5 h-3.5 text-white" />
                </div>
                <div>
                  <h2 className="font-semibold text-slate-900 text-sm">{meta.label} — {orderCode}</h2>
                  {!!d.status && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border mt-0.5 inline-block ${statusBadge(String(d.status ?? d.orderStatus))}`}>
                      {d.statusName ? String(d.statusName) : statusLabel(String(d.status ?? d.orderStatus))}
                      {" "}({String(d.status ?? d.orderStatus)})
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Change Status button */}
                {!editMode && (
                  <button
                    onClick={() => { setStatusModal(true); setNewStatus(""); setCancelComment(""); setStatusError(""); }}
                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    Change Status
                  </button>
                )}
                {/* Auto Assign button */}
                {!editMode && (
                  <button
                    onClick={runAutoAssign}
                    disabled={autoAssigning}
                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white transition-colors"
                    title="Auto-assign inventory to this order"
                  >
                    {autoAssigning
                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      : <MapPin className="w-3.5 h-3.5" />}
                    {autoAssigning ? "Assigning…" : "Auto Assign"}
                  </button>
                )}
                {!editMode ? (
                  <button onClick={startEdit}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                    Edit
                  </button>
                ) : (
                  <>
                    <button onClick={cancelEdit}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                      Cancel
                    </button>
                    <button onClick={saveEdit} disabled={saving}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                      {saving ? "Saving…" : "Save"}
                    </button>
                  </>
                )}
                <button onClick={closeDetail} className="text-slate-400 hover:text-slate-700 transition-colors ml-1">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Auto Assign result banner */}
            {autoAssignResult === "ok" && (
              <div className="px-6 py-2 bg-emerald-50 border-b border-emerald-100 text-xs text-emerald-700 flex items-center gap-2 flex-shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                {autoAssignMsg}
              </div>
            )}
            {autoAssignResult === "error" && (
              <div className="px-6 py-2 bg-red-50 border-b border-red-100 text-xs text-red-600 flex items-center gap-2 flex-shrink-0">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {autoAssignMsg}
              </div>
            )}
            {saveError && (
              <div className="px-6 py-2 bg-red-50 border-b border-red-100 text-xs text-red-600 flex-shrink-0">{saveError}</div>
            )}

            {/* ── Change Status Sub-modal ── */}
            {statusModal && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 rounded-2xl">
                <div className="bg-white rounded-xl shadow-xl w-80 p-6">
                  <h3 className="font-semibold text-slate-900 text-sm mb-4 flex items-center gap-2">
                    <ArrowLeftRight className="w-4 h-4 text-slate-400" />
                    Change Status
                  </h3>

                  {/* Current status */}
                  {d.status != null && (
                    <div className="mb-4">
                      <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Current</p>
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${statusBadge(String(d.status))}`}>
                        {d.statusName ? String(d.statusName) : statusLabel(String(d.status))}
                        {" "}({String(d.status)})
                      </span>
                    </div>
                  )}

                  {/* New status select */}
                  <div className="mb-4">
                    <label className="text-xs text-slate-500 uppercase tracking-wide mb-1.5 block">New Status</label>
                    <select
                      value={newStatus}
                      onChange={(e) => setNewStatus(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- Select --</option>
                      {(() => {
                        const curRank = STATUS_RANK[String(d.status ?? "")] ?? -1;
                        return STATUS_OPTIONS.filter((s) => {
                          if (s.code === "HA" || s.code === "CC") return true; // always allowed
                          const rank = STATUS_RANK[s.code as keyof typeof STATUS_RANK] ?? -1;
                          return rank > curRank;
                        });
                      })().map((s) => (
                        <option key={s.code} value={s.code}>{s.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Comment for Hold / Cancel */}
                  {(newStatus === "HA" || newStatus === "CC") && (
                    <div className="mb-4">
                      <label className="text-xs text-slate-500 uppercase tracking-wide mb-1.5 block">
                        {newStatus === "HA" ? "Hold Reason" : "Cancel Reason"}
                      </label>
                      <textarea
                        value={cancelComment}
                        onChange={(e) => setCancelComment(e.target.value)}
                        rows={2}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                        placeholder="Optional reason…"
                      />
                    </div>
                  )}

                  {statusError && (
                    <p className="text-xs text-red-600 mb-3">{statusError}</p>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => { setStatusModal(false); setNewStatus(""); setCancelComment(""); setStatusError(""); }}
                      className="flex-1 text-sm border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg py-2 font-medium transition-colors"
                    >Cancel</button>
                    <button
                      onClick={changeStatus}
                      disabled={!newStatus || statusChanging}
                      className="flex-1 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg py-2 font-medium transition-colors flex items-center justify-center gap-1.5"
                    >
                      {statusChanging && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                      {statusChanging ? "Saving…" : "Confirm"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Tabs */}
            <div className="flex border-b border-slate-200 px-6 flex-shrink-0 overflow-x-auto">
              {(["info", "address", "package", "additional", "picking", "raw"] as const).map((tab) => {
                const label =
                  tab === "info"       ? "Info"
                  : tab === "address"  ? "Address"
                  : tab === "package"  ? "Package"
                  : tab === "additional" ? "Additional"
                  : tab === "picking"  ? `Picking${itemList.length ? ` (${itemList.length})` : ""}`
                  : "Raw";
                return (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                    className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap flex items-center gap-1.5 ${activeTab === tab ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
                    {tab === "picking" && <MapPin className="w-3.5 h-3.5" />}
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Content */}
            {detailLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">

                {/* ── Info tab ── */}
                {activeTab === "info" && (
                  <div className="p-6 space-y-5">
                    <div className="grid grid-cols-3 gap-4">
                      <Field label="Order Code"    value={d.shippingOrderCode ?? d.orderCode ?? d.outboundCode} />
                      <Field label="Customer"      value={d.customerName ?? d.customerCode} />
                      <div>
                        <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Status</p>
                        <span className={`text-sm font-semibold px-2.5 py-1 rounded-full border ${statusBadge(String(d.status ?? d.orderStatus ?? ""))}`}>
                          {d.statusName ? String(d.statusName) : statusLabel(String(d.status ?? d.orderStatus ?? "-"))}
                          {" "}({String(d.status ?? d.orderStatus ?? "-")})
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <Field label="Warehouse"     value={d.warehouseName ?? d.warehouseCode} />
                      <Field label="Order Date"    {...ef("orderDate")} />
                      <Field label="Ship Date"     {...ef("shippingDate")} />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <Field label="Total Qty"     {...ef("totalQty")} />
                      <Field label="Tracking #"    {...ef("trackingNo")} />
                      <Field label="Delivery Date" {...ef("deliveryDate")} />
                    </div>
                    {!!(d.shippingOrderNo || d.orderType || editMode) && (
                      <div className="grid grid-cols-3 gap-4 pt-2 border-t border-slate-100">
                        <Field label="Shipping Order No" {...ef("shippingOrderNo")} />
                        <Field label="Order Type"        {...ef("orderType")} />
                      </div>
                    )}
                  </div>
                )}

                {/* ── Address tab ── */}
                {activeTab === "address" && (
                  <div className="p-6 space-y-6">
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wide mb-3">Consignee</p>
                      <div className="grid grid-cols-3 gap-4">
                        <Field label="Name"             {...ef("consigneeName")} />
                        <Field label="Tel"              {...ef("consigneeTelLno")} />
                        <Field label="Cell"             {...ef("consigneeCellNo")} />
                        <Field label="Address"          {...ef("consigneeAddress1")} />
                        <Field label="Address 2"        {...ef("consigneeAddress2")} />
                        <Field label="City"             {...ef("consigneeCity")} />
                        <Field label="State"            {...ef("consigneeState")} />
                        <Field label="ZIP"              {...ef("consigneeZipCode")} />
                        <Field label="Country"          {...ef("consigneeNationalCode")} />
                        <div className="col-span-3">
                          <Field label="Delivery Message" {...ef("consigneeDeliveryMessage")} />
                        </div>
                      </div>
                    </div>
                    {!!(d.consignorName || d.consignorAddress1 || editMode) && (
                      <div className="border-t border-slate-100 pt-5">
                        <p className="text-xs text-slate-400 uppercase tracking-wide mb-3">Consignor</p>
                        <div className="grid grid-cols-3 gap-4">
                          <Field label="Name"    {...ef("consignorName")} />
                          <Field label="Tel"     {...ef("consignorTelLno")} />
                          <Field label="Country" {...ef("consignorNationalCode")} />
                          <Field label="Address" {...ef("consignorAddress1")} />
                          <Field label="City"    {...ef("consignorCity")} />
                          <Field label="State"   {...ef("consignorState")} />
                          <Field label="ZIP"     {...ef("consignorZipCode")} />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Package tab ── */}
                {activeTab === "package" && (
                  <div className="p-6 space-y-6">
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wide mb-3">Dimensions</p>
                      <div className="grid grid-cols-4 gap-4">
                        <Field label="Total Weight" {...ef("totalWeight")} />
                        <Field label="Length"       {...ef("length")} />
                        <Field label="Width"        {...ef("width")} />
                        <Field label="Height"       {...ef("height")} />
                      </div>
                    </div>
                    <div className="border-t border-slate-100 pt-5">
                      <p className="text-xs text-slate-400 uppercase tracking-wide mb-3">Financial</p>
                      <div className="grid grid-cols-3 gap-4">
                        <Field label="Invoice Value"   {...ef("invoiceValue")} />
                        <Field label="Fare Value"      {...ef("fareValue")} />
                        <Field label="Fare Etc"        {...ef("fareEtcValue")} />
                        <Field label="Insurance Value" {...ef("insuranceValue")} />
                        <Field label="Shipping Rate"   {...ef("shippingRate")} />
                        <Field label="Shipping Cost"   {...ef("shippingCost")} />
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Additional tab ── */}
                {activeTab === "additional" && (
                  <div className="p-6 space-y-5">
                    <div>
                      <Field label="Comment" {...ef("comment")} />
                    </div>

                    {/* ── Task Comment Builder ── */}
                    {editMode && (
                      <div className="border border-slate-200 rounded-xl overflow-hidden">
                        <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Task / Work Order</span>
                          {taskItems.length > 0 && (
                            <span className="text-xs text-slate-400 font-mono truncate max-w-xs">
                              → {buildTaskText(taskItems)}
                            </span>
                          )}
                        </div>

                        {/* Add row */}
                        <div className="p-4 flex items-center gap-2">
                          <select
                            value={taskType}
                            onChange={(e) => setTaskType(e.target.value)}
                            className="flex-1 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white text-slate-800"
                          >
                            {TASK_TYPES.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min={1}
                            value={taskQty}
                            onChange={(e) => setTaskQty(e.target.value === "" ? "" : Number(e.target.value))}
                            placeholder="Qty"
                            className="w-20 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white text-right tabular-nums"
                          />
                          <button
                            onClick={addTaskItem}
                            className="text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                          >
                            + Add
                          </button>
                        </div>

                        {/* Added task list */}
                        {taskItems.length > 0 && (
                          <div className="border-t border-slate-100 px-4 pb-3 pt-2 space-y-1.5">
                            {taskItems.map((t) => (
                              <div key={t.type} className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-lg px-3 py-1.5">
                                <span className="text-sm text-slate-700">{t.type}</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold tabular-nums text-blue-700">×{t.qty}</span>
                                  <button
                                    onClick={() => removeTaskItem(t.type)}
                                    className="text-slate-400 hover:text-red-500 transition-colors text-xs leading-none"
                                  >✕</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {taskItems.length === 0 && (
                          <p className="text-xs text-slate-400 px-4 pb-3">Select a task type and quantity, then click Add. Tasks will be appended to the comment on save.</p>
                        )}
                      </div>
                    )}

                    {/* Show tasks read-only when not editing */}
                    {!editMode && taskItems.length > 0 && (
                      <div className="text-xs text-slate-400 italic">
                        Pending tasks (unsaved): {buildTaskText(taskItems)}
                      </div>
                    )}
                    {(() => {
                      const src = editMode ? editData : d;
                      const extra = Object.entries(src).filter(([k, v]) =>
                        !SKIP_FIELDS.has(k) && v != null && v !== "" && !Array.isArray(v) && typeof v !== "object"
                      );
                      if (!extra.length) return null;
                      return (
                        <div className="border-t border-slate-100 pt-5">
                          <div className="grid grid-cols-3 gap-4">
                            {extra.map(([k]) => <Field key={k} label={COL_LABELS[k] ?? k} {...ef(k)} />)}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* ── Picking tab ── */}
                {activeTab === "picking" && (
                  <div className="p-6 space-y-4">
                    {itemList.length === 0 ? (
                      <div className="text-center py-16 text-slate-400">
                        <MapPin className="w-8 h-8 mx-auto mb-3 opacity-40" />
                        <p className="text-sm font-medium">No picking data available</p>
                        <p className="text-xs mt-1">Items will appear after Auto Assign is run in WMS</p>
                      </div>
                    ) : (
                      <>
                        {/* Summary bar */}
                        <div className="flex items-center gap-6 bg-slate-50 rounded-xl px-4 py-3 text-sm">
                          <div>
                            <span className="text-slate-500 text-xs">Total Lines</span>
                            <p className="font-semibold text-slate-800">{itemList.length}</p>
                          </div>
                          <div>
                            <span className="text-slate-500 text-xs">Total Qty</span>
                            <p className="font-semibold text-slate-800 tabular-nums">
                              {itemList.reduce((s, item) => s + Number(item.qty ?? item.totalQty ?? 0), 0).toLocaleString()}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-500 text-xs">Assigned</span>
                            <p className="font-semibold text-green-700 tabular-nums">
                              {itemList.reduce((s, item) => s + Number(item.assignedQty ?? item.assigned ?? item.qty ?? 0), 0).toLocaleString()}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-500 text-xs">Remain</span>
                            <p className="font-semibold text-amber-600 tabular-nums">
                              {itemList.reduce((s, item) => s + Number(item.remainQty ?? item.remain ?? 0), 0).toLocaleString()}
                            </p>
                          </div>
                          <div className="ml-auto flex items-center gap-2">
                            {pickingSaved ? (
                              <span className="flex items-center gap-1.5 text-xs text-green-700 font-medium bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Saved
                              </span>
                            ) : (
                              <button
                                onClick={savePickingRecord}
                                disabled={savingPicking || !supabase}
                                className="flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg px-3 py-1.5 transition-colors"
                              >
                                {savingPicking
                                  ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  : <Save className="w-3.5 h-3.5" />}
                                {savingPicking ? "Saving…" : "Save Record"}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Picking table */}
                        <div className="overflow-x-auto rounded-xl border border-slate-200">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-200">
                                <th className="px-3 py-2.5 text-left text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">#</th>
                                <th className="px-3 py-2.5 text-left text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">Location</th>
                                <th className="px-3 py-2.5 text-left text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">Occupancy</th>
                                <th className="px-3 py-2.5 text-left text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">SKU</th>
                                <th className="px-3 py-2.5 text-left text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">Product</th>
                                <th className="px-3 py-2.5 text-left text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">Lot</th>
                                <th className="px-3 py-2.5 text-left text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">Expire</th>
                                <th className="px-3 py-2.5 text-right text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">Qty</th>
                                <th className="px-3 py-2.5 text-right text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">Assigned</th>
                                <th className="px-3 py-2.5 text-right text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">Remain</th>
                                <th className="px-3 py-2.5 text-center text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {itemList.map((item, i) => {
                                // Readable location from Nm fields (confirmed: zoneNm/aisleNm/bayNm/levelNm/positionNm)
                                const locParts = [
                                  item.zoneNm ?? item.zoneName ?? item.zone ?? "",
                                  item.aisleNm ?? item.aisleName ?? item.aisle ?? "",
                                  item.bayNm ?? item.bayName ?? item.bay ?? "",
                                  item.levelNm ?? item.levelName ?? item.level ?? "",
                                  item.positionNm ?? item.positionName ?? item.position ?? "",
                                ].map(String).filter(Boolean);
                                const location = locParts.length > 0
                                  ? locParts.join("-")
                                  : String(item.location ?? item.locationCode ?? "");
                                const occupancyInfo = getLocationOccupancyInfo(occupancyMap, item as Record<string, unknown>)
                                  || (occupancyMap.get(location.replace(/[-_\s]/g, "").toUpperCase()) ?? "");
                                const qty      = Number(item.qty ?? item.totalQty ?? 0);
                                const assigned = Number(item.assignedQty ?? item.assigned ?? qty);
                                const remain   = Number(item.remainQty ?? item.remain ?? 0);
                                const status   = String(item.status ?? item.itemStatus ?? item.itemCondition ?? "");
                                const isOk     = status.toUpperCase() === "OK" || remain === 0;
                                return (
                                  <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                                    <td className="px-3 py-2.5 text-slate-400">{i + 1}</td>
                                    <td className="px-3 py-2.5 font-mono text-slate-800 whitespace-nowrap">
                                      <span className="flex items-center gap-1">
                                        <MapPin className="w-3 h-3 text-slate-400 flex-shrink-0" />
                                        {location || "-"}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2.5 whitespace-nowrap">
                                      {occupancyInfo ? (
                                        <span className="text-xs bg-purple-50 text-purple-700 border border-purple-100 px-2 py-0.5 rounded-full font-medium">
                                          {occupancyInfo}
                                        </span>
                                      ) : (
                                        <span className="text-slate-300">—</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2.5 font-mono text-slate-700 whitespace-nowrap">{String(item.productSku ?? item.sku ?? "-")}</td>
                                    <td className="px-3 py-2.5 text-slate-600 max-w-[180px] truncate">{String(item.productName ?? item.itemName ?? "-")}</td>
                                    <td className="px-3 py-2.5 font-mono text-slate-600 whitespace-nowrap">{String(item.lotNo ?? item.lot ?? "-")}</td>
                                    <td className="px-3 py-2.5 font-mono text-slate-500 whitespace-nowrap">{String(item.expireDate ?? item.expiryDate ?? "-")}</td>
                                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{qty.toLocaleString()}</td>
                                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-green-700">{assigned.toLocaleString()}</td>
                                    <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${remain > 0 ? "text-amber-600" : "text-slate-300"}`}>{remain.toLocaleString()}</td>
                                    <td className="px-3 py-2.5 text-center">
                                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isOk ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                                        {status || (isOk ? "OK" : "—")}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="bg-slate-50 border-t border-slate-200">
                                <td colSpan={7} className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase">Total</td>
                                <td className="px-3 py-2.5 text-right tabular-nums font-bold text-slate-800">
                                  {itemList.reduce((s, item) => s + Number(item.qty ?? item.totalQty ?? 0), 0).toLocaleString()}
                                </td>
                                <td className="px-3 py-2.5 text-right tabular-nums font-bold text-green-700">
                                  {itemList.reduce((s, item) => s + Number(item.assignedQty ?? item.assigned ?? item.qty ?? 0), 0).toLocaleString()}
                                </td>
                                <td className="px-3 py-2.5 text-right tabular-nums font-bold text-amber-600">
                                  {itemList.reduce((s, item) => s + Number(item.remainQty ?? item.remain ?? 0), 0).toLocaleString()}
                                </td>
                                <td />
                              </tr>
                            </tfoot>
                          </table>
                        </div>

                        {/* Raw field debug (shown when location is missing on first item) */}
                        {itemList.length > 0 && !itemList[0].location && !itemList[0].locationCode &&
                          !(itemList[0].zoneName ?? itemList[0].zone) && (
                          <details className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
                            <summary className="px-4 py-2.5 text-xs font-semibold text-amber-700 cursor-pointer select-none">
                              ⚠ Location data missing — click to inspect raw item fields
                            </summary>
                            <div className="px-4 pb-4 pt-2">
                              <p className="text-xs text-amber-600 mb-2">
                                Available fields in item[0]: {Object.keys(itemList[0]).join(", ")}
                              </p>
                              <pre className="bg-slate-900 text-green-400 rounded-lg p-3 text-xs overflow-auto max-h-48">
                                {JSON.stringify(itemList[0], null, 2)}
                              </pre>
                            </div>
                          </details>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* ── Raw tab ── */}
                {activeTab === "raw" && (
                  <div className="p-6">
                    <pre className="bg-slate-900 text-green-400 rounded-xl p-4 text-xs overflow-auto max-h-[60vh]">
                      {JSON.stringify(d, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Debug ── */}
      {debugInfo.endpoint && (
        <details className="mt-6 bg-slate-800 rounded-xl p-4 text-xs">
          <summary className="text-slate-400 cursor-pointer select-none">
            Debug · <span className="text-green-400 font-mono">{debugInfo.endpoint}</span>
          </summary>
          <pre className="text-green-400 overflow-auto max-h-60 mt-3">{JSON.stringify(debugInfo.raw, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
