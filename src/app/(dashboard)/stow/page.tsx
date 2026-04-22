"use client";

import { useRef, useState, useMemo, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import {
  ScanLine, Package, MapPin, CheckCircle2, AlertCircle,
  Loader2, RotateCcw, ChevronRight, ArrowLeft, Tag, Clock,
} from "lucide-react";
import { fetchPendingStowTags, markStowTagDone, type PersistedStowTag } from "@/lib/stow-tags";

// ── Types ────────────────────────────────────────────────
interface ItemInfo {
  receiveOrderCode: string;
  receiveItemId: number;
  warehouseCode: string;
  warehouseCd: string;
  customerCode: string;
  productSku: string;
  productName: string;
  lotNo: string;
  expireDate: string;
  itemCondition: string;
  qty: number;
  assignedQty?: number;
}

interface LocationInfo {
  locationCode: string;
  locationId?: string;
  zoneName: string;
  aisleName: string;
  bayName: string;
  levelName: string;
  positionName: string;
}

type Step = "tag" | "qty" | "location" | "confirm" | "done";

// ── Step indicator ───────────────────────────────────────
const STEPS: { key: Step; label: string }[] = [
  { key: "tag",      label: "Stow Tag" },
  { key: "qty",      label: "Quantity" },
  { key: "location", label: "Location" },
  { key: "confirm",  label: "Confirm" },
];

function StepBar({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((s, i) => (
        <div key={s.key} className="flex items-center flex-1 last:flex-none">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors ${
            i < idx  ? "bg-blue-600 text-white" :
            i === idx ? "bg-blue-600 text-white ring-4 ring-blue-100" :
                       "bg-slate-200 text-slate-400"
          }`}>
            {i < idx ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
          </div>
          <span className={`ml-1.5 text-xs font-medium whitespace-nowrap ${i === idx ? "text-blue-600" : "text-slate-400"}`}>
            {s.label}
          </span>
          {i < STEPS.length - 1 && (
            <div className={`flex-1 mx-2 h-0.5 ${i < idx ? "bg-blue-600" : "bg-slate-200"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function LocBadge({ loc }: { loc: LocationInfo }) {
  return (
    <div className="inline-flex items-center gap-1.5 bg-slate-100 rounded-lg px-3 py-2 font-mono text-sm">
      <MapPin className="w-4 h-4 text-slate-500" />
      <span className="font-semibold text-slate-700">
        {[loc.zoneName, loc.aisleName, loc.bayName, loc.levelName, loc.positionName]
          .filter(Boolean).join(" - ")}
      </span>
    </div>
  );
}

function ScanInput({
  label, placeholder, onScan, loading, autoFocus = true,
}: {
  label: string;
  placeholder: string;
  onScan: (val: string) => void;
  loading?: boolean;
  autoFocus?: boolean;
}) {
  const [val, setVal] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);

  return (
    <div>
      <label className="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-2 block">{label}</label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            ref={ref}
            type="text"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && val.trim()) { onScan(val.trim()); setVal(""); }
            }}
            placeholder={placeholder}
            disabled={loading}
            className="w-full border-2 border-slate-200 focus:border-blue-500 rounded-xl pl-10 pr-4 py-3 text-sm outline-none transition-colors disabled:bg-slate-50"
          />
        </div>
        <button
          onClick={() => { if (val.trim()) { onScan(val.trim()); setVal(""); } }}
          disabled={!val.trim() || loading}
          className="px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 text-white rounded-xl font-medium text-sm transition-colors flex items-center gap-1.5"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

// ── Pending tag list ─────────────────────────────────────
function PendingTagList({
  tags,
  onLoad,
  disabled,
}: {
  tags: PersistedStowTag[];
  onLoad: (tag: PersistedStowTag) => void;
  disabled: boolean;
}) {
  // Group by orderCode
  const groups = useMemo(() => {
    const map = new Map<string, PersistedStowTag[]>();
    for (const t of tags) {
      const arr = map.get(t.orderCode) ?? [];
      arr.push(t);
      map.set(t.orderCode, arr);
    }
    return Array.from(map.entries());
  }, [tags]);

  if (tags.length === 0) return null;

  return (
    <div className="mt-8">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-4 h-4 text-amber-500" />
        <h2 className="text-sm font-semibold text-slate-700">Pending Stow Tags</h2>
        <span className="ml-auto bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-0.5 rounded-full">
          {tags.length} unassigned
        </span>
      </div>

      <div className="space-y-4">
        {groups.map(([orderCode, orderTags]) => (
          <div key={orderCode} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            {/* Order header */}
            <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-center gap-2">
              <Tag className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-mono text-xs font-semibold text-slate-700">{orderCode}</span>
              <span className="ml-auto text-xs text-slate-400">{orderTags.length} tag{orderTags.length !== 1 ? "s" : ""}</span>
            </div>

            {/* Tags */}
            <div className="divide-y divide-slate-100">
              {orderTags.map((tag) => (
                <div key={tag.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex-shrink-0 bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded-lg min-w-[2.5rem] text-center">
                    T{tag.tagNo}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-sm font-semibold text-slate-900">{tag.sku}</span>
                      <span className="text-xs text-blue-600 font-bold">×{tag.qty}</span>
                    </div>
                    <div className="flex gap-3 mt-0.5 text-xs text-slate-400">
                      {tag.lotNo && <span>LOT: {tag.lotNo}</span>}
                      {tag.expireDate && <span>EXP: {tag.expireDate.slice(0, 10)}</span>}
                      {!tag.lotNo && !tag.expireDate && (
                        <span className="truncate">{tag.productName}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => onLoad(tag)}
                    disabled={disabled}
                    className="flex-shrink-0 flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-slate-100 disabled:text-slate-400 text-white px-3 py-2 rounded-lg transition-colors"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    Stow
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────
export default function StowPage() {
  const { user } = useAuth();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  const [step, setStep] = useState<Step>("tag");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [item, setItem] = useState<ItemInfo | null>(null);
  const [qty, setQty] = useState<number>(0);
  const [location, setLocation] = useState<LocationInfo | null>(null);
  const [assignResult, setAssignResult] = useState<unknown>(null);

  // Track which persisted tag is currently being processed
  const [activePersistedTagId, setActivePersistedTagId] = useState<number | null>(null);

  // Pending tags from localStorage
  const [pendingTags, setPendingTags] = useState<PersistedStowTag[]>([]);

  const refreshPending = useCallback(async () => {
    const tags = await fetchPendingStowTags();
    setPendingTags(tags);
  }, []);

  useEffect(() => { refreshPending(); }, [refreshPending]);

  // ── Reset ──────────────────────────────────────────────
  function reset() {
    setStep("tag");
    setItem(null);
    setQty(0);
    setLocation(null);
    setError("");
    setAssignResult(null);
    setActivePersistedTagId(null);
    refreshPending();
  }

  // ── Load pending tag directly (skip API) ───────────────
  function loadPendingTag(tag: PersistedStowTag) {
    setActivePersistedTagId(tag.id);
    setItem({
      receiveOrderCode: tag.orderCode,
      receiveItemId: tag.receiveItemId,
      warehouseCode: tag.warehouseCode,
      warehouseCd: tag.warehouseCd,
      customerCode: tag.customerCode,
      productSku: tag.sku,
      productName: tag.productName,
      lotNo: tag.lotNo,
      expireDate: tag.expireDate,
      itemCondition: tag.itemCondition,
      qty: tag.qty,
    });
    setQty(tag.qty);
    setError("");
    setStep("qty");
  }

  // ── Step 1: scan stow tag ──────────────────────────────
  async function handleTagScan(raw: string) {
    setLoading(true);
    setError("");
    try {
      // ① Redis pending tags에서 barcodeValue로 먼저 매칭
      const stored = await fetchPendingStowTags();
      const match = stored.find((t) => t.barcodeValue === raw);

      if (match) {
        // 정확히 일치 → API 호출 없이 바로 로드
        setActivePersistedTagId(match.id);
        setItem({
          receiveOrderCode: match.orderCode,
          receiveItemId: match.receiveItemId,
          warehouseCode: match.warehouseCode,
          warehouseCd: match.warehouseCd,
          customerCode: match.customerCode,
          productSku: match.sku,
          productName: match.productName,
          lotNo: match.lotNo,
          expireDate: match.expireDate,
          itemCondition: match.itemCondition,
          qty: match.qty,
        });
        setQty(match.qty);
        setStep("qty");
        return;
      }

      // ② 매칭 없으면 WMS API 폴백 (orderCode / itemId 방식)
      let orderCode = "";
      let itemId: number | null = null;

      if (raw.includes("::")) {
        const [a, b] = raw.split("::");
        orderCode = a.trim();
        itemId = parseInt(b.trim(), 10); // "355-T1" → 355
      } else if (/^\d+$/.test(raw)) {
        itemId = parseInt(raw, 10);
      } else {
        orderCode = raw.trim();
      }

      let found: ItemInfo | null = null;

      if (orderCode) {
        const res = await fetch(`/api/wms/receiving/items/${orderCode}`, { headers });
        const json = await res.json();
        const arr: Record<string, unknown>[] = Array.isArray(
          json?.data?.items ?? json?.data?.list ?? json?.data ?? json?.list ?? json
        )
          ? (json?.data?.items ?? json?.data?.list ?? json?.data ?? json?.list ?? json)
          : [];

        const target = itemId != null
          ? arr.find((i) => Number(i.receiveItemId ?? i.id) === itemId)
          : arr[0];

        if (target) found = normalizeItem(target, orderCode);
      }

      if (!found && itemId != null) {
        const res = await fetch(`/api/wms/receiving/item/${itemId}`, { headers });
        const json = await res.json();
        const d = json?.data ?? json;
        if (d?.productSku) found = normalizeItem(d as Record<string, unknown>, orderCode);
      }

      if (!found) throw new Error("Item not found. Check the stow tag.");

      setItem(found);
      setQty(found.qty);
      setStep("qty");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tag scan failed");
    } finally {
      setLoading(false);
    }
  }

  function normalizeItem(r: Record<string, unknown>, fallbackOrder: string): ItemInfo {
    return {
      receiveOrderCode: String(r.receiveOrderCode ?? r.orderCode ?? fallbackOrder),
      receiveItemId: Number(r.receiveItemId ?? r.id ?? r.itemId ?? 0),
      warehouseCode: String(r.warehouseCode ?? ""),
      warehouseCd: String(r.warehouseCd ?? r.warehouseId ?? ""),
      customerCode: String(r.customerCode ?? ""),
      productSku: String(r.productSku ?? r.sku ?? ""),
      productName: String(r.productName ?? r.itemName ?? ""),
      lotNo: String(r.lotNo ?? r.lot ?? ""),
      expireDate: String(r.expireDate ?? r.expiryDate ?? ""),
      itemCondition: String(r.itemCondition ?? r.condition ?? "GOOD"),
      qty: Number(r.qty ?? r.orderQty ?? r.assignedQty ?? 0),
      assignedQty: Number(r.assignedQty ?? 0),
    };
  }

  // ── Step 2: qty ────────────────────────────────────────
  function handleQtyNext() {
    if (qty <= 0) { setError("Enter a valid quantity."); return; }
    setError("");
    setStep("location");
  }

  // ── Step 3: location ───────────────────────────────────
  async function handleLocationScan(raw: string) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        q: raw,
        warehouseCode: item?.warehouseCode ?? "",
      });
      const res = await fetch(`/api/wms/warehouse/location-search?${params}`, { headers });
      const json = await res.json();

      let loc: LocationInfo | null = null;

      if (res.ok) {
        const d: Record<string, unknown> = (
          json?.data ?? json?.list?.[0] ?? json?.[0] ?? json
        ) as Record<string, unknown>;
        if (d && (d.zoneName || d.locationCode || d.locationId)) {
          loc = normalizeLocation(d, raw);
        }
      }

      if (!loc) {
        const parts = raw.split(/[-_/]/);
        if (parts.length >= 2) {
          loc = {
            locationCode: raw,
            zoneName: parts[0] ?? "",
            aisleName: parts[1] ?? "",
            bayName: parts[2] ?? "",
            levelName: parts[3] ?? "",
            positionName: parts[4] ?? "",
          };
        }
      }

      if (!loc) throw new Error("Location not found. Check the barcode.");

      setLocation(loc);
      setStep("confirm");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Location scan failed");
    } finally {
      setLoading(false);
    }
  }

  function normalizeLocation(r: Record<string, unknown>, raw: string): LocationInfo {
    return {
      locationCode: String(r.locationCode ?? r.code ?? raw),
      locationId: String(r.locationId ?? r.id ?? ""),
      zoneName: String(r.zoneName ?? r.zone ?? ""),
      aisleName: String(r.aisleName ?? r.aisle ?? ""),
      bayName: String(r.bayName ?? r.bay ?? ""),
      levelName: String(r.levelName ?? r.level ?? ""),
      positionName: String(r.positionName ?? r.position ?? ""),
    };
  }

  // ── Step 4: confirm & assign ───────────────────────────
  async function handleAssign() {
    if (!item || !location) return;
    setLoading(true);
    setError("");
    try {
      const payload = {
        receiveOrderCode: item.receiveOrderCode,
        receiveItemId: item.receiveItemId,
        warehouseCode: item.warehouseCode,
        warehouseCd: item.warehouseCd,
        customerCode: item.customerCode,
        productSku: item.productSku,
        lotNo: item.lotNo,
        expireDate: item.expireDate,
        itemCondition: item.itemCondition,
        qty,
        locationCode: location.locationCode,
        locationId: location.locationId,
      };

      const res = await fetch("/api/wms/receiving/assign", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (!res.ok || json?.isSuccess === false) {
        throw new Error(json?.message ?? "Assign failed");
      }

      // Mark the persisted stow tag as done on the server
      if (activePersistedTagId != null) {
        await markStowTagDone(activePersistedTagId);
      }

      setAssignResult(json);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assign failed");
    } finally {
      setLoading(false);
    }
  }

  const inProgress = step !== "tag" && step !== "done";

  // ── Render ─────────────────────────────────────────────
  return (
    <div className="p-8 max-w-xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Stow Process</h1>
          <p className="text-slate-500 text-sm mt-0.5">Scan → Qty → Location → Assign</p>
        </div>
        {inProgress && (
          <button
            onClick={reset}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Reset
          </button>
        )}
      </div>

      {step !== "done" && <StepBar current={step} />}

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-5">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
        </div>
      )}

      {/* ── STEP 1: Tag ── */}
      {step === "tag" && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-blue-100 p-2.5 rounded-xl"><ScanLine className="w-5 h-5 text-blue-600" /></div>
            <div>
              <p className="font-semibold text-slate-900">Scan Stow Tag</p>
              <p className="text-xs text-slate-400">Barcode on the stow label attached to the item</p>
            </div>
          </div>
          <ScanInput
            label="Stow Tag Barcode"
            placeholder="Scan or type tag... (Enter to confirm)"
            onScan={handleTagScan}
            loading={loading}
          />
          <p className="text-xs text-slate-400 pt-1">
            Supported formats: <code className="bg-slate-100 px-1 rounded">OrderCode::ItemId</code> or <code className="bg-slate-100 px-1 rounded">OrderCode</code>
          </p>
        </div>
      )}

      {/* ── STEP 2: Qty ── */}
      {step === "qty" && item && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <Package className="w-4 h-4 text-green-600" />
              <span className="text-xs font-semibold text-green-600 uppercase tracking-wide">Item Found</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-slate-400 mb-0.5">SKU</p><p className="font-mono font-bold text-slate-900">{item.productSku}</p></div>
              <div><p className="text-xs text-slate-400 mb-0.5">Product</p><p className="font-medium text-slate-800 truncate">{item.productName || "-"}</p></div>
              <div><p className="text-xs text-slate-400 mb-0.5">LOT</p><p className="font-mono text-slate-700">{item.lotNo || "-"}</p></div>
              <div><p className="text-xs text-slate-400 mb-0.5">Expiry</p><p className="font-mono text-slate-700">{item.expireDate || "-"}</p></div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Condition</p>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  item.itemCondition === "GOOD" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                }`}>{item.itemCondition}</span>
              </div>
              <div><p className="text-xs text-slate-400 mb-0.5">Tag Qty</p><p className="font-bold text-lg text-slate-900">{item.qty.toLocaleString()}</p></div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4">
            <p className="font-semibold text-slate-900 text-sm">Enter Stow Quantity</p>
            <div className="flex items-center gap-3">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="w-10 h-10 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-lg font-bold transition-colors">−</button>
              <input
                type="number"
                value={qty}
                min={1}
                max={item.qty}
                onChange={(e) => setQty(Math.min(item.qty, Math.max(1, parseInt(e.target.value) || 1)))}
                className="flex-1 text-center text-2xl font-bold border-2 border-blue-200 focus:border-blue-500 rounded-xl py-3 outline-none"
                autoFocus
              />
              <button onClick={() => setQty((q) => Math.min(item.qty, q + 1))}
                className="w-10 h-10 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-lg font-bold transition-colors">+</button>
            </div>
            <button onClick={handleQtyNext}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
              Next — Scan Location <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Location ── */}
      {step === "location" && item && (
        <div className="space-y-4">
          <div className="bg-slate-50 rounded-xl px-4 py-3 flex items-center gap-3 text-sm">
            <Package className="w-4 h-4 text-slate-400" />
            <span className="font-mono font-bold text-slate-900">{item.productSku}</span>
            <span className="text-slate-400">×</span>
            <span className="font-bold text-blue-600">{qty.toLocaleString()}</span>
            <span className="text-slate-400 ml-auto font-mono text-xs">{item.lotNo}</span>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="bg-purple-100 p-2.5 rounded-xl"><MapPin className="w-5 h-5 text-purple-600" /></div>
              <div>
                <p className="font-semibold text-slate-900">Scan Target Location</p>
                <p className="text-xs text-slate-400">Scan the location barcode where you want to stow this item</p>
              </div>
            </div>
            <ScanInput
              label="Location Barcode"
              placeholder="Scan location... (e.g. 01-31-23-01-01)"
              onScan={handleLocationScan}
              loading={loading}
            />
            <p className="text-xs text-slate-400 mt-3">
              Format: <code className="bg-slate-100 px-1 rounded">Zone-Aisle-Bay-Level-Position</code>
            </p>
          </div>
        </div>
      )}

      {/* ── STEP 4: Confirm ── */}
      {step === "confirm" && item && location && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-5">
            <p className="font-semibold text-slate-900 text-sm">Confirm Stow Assignment</p>

            <div className="flex items-center gap-3">
              <div className="flex-1 bg-blue-50 rounded-xl p-4">
                <p className="text-xs text-slate-400 mb-1">Item</p>
                <p className="font-mono font-bold text-slate-900">{item.productSku}</p>
                <p className="text-xs text-slate-500 truncate mt-0.5">{item.productName}</p>
                <div className="mt-2 flex gap-2 flex-wrap">
                  {item.lotNo && <span className="text-xs bg-white border border-slate-200 rounded px-1.5 py-0.5 font-mono">LOT: {item.lotNo}</span>}
                  {item.expireDate && <span className="text-xs bg-white border border-slate-200 rounded px-1.5 py-0.5 font-mono">EXP: {item.expireDate}</span>}
                  <span className="text-xs bg-white border border-slate-200 rounded px-1.5 py-0.5 font-mono">{item.itemCondition}</span>
                </div>
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-xl font-bold text-blue-600">{qty.toLocaleString()}</span>
                <ChevronRight className="w-5 h-5 text-slate-300" />
              </div>
              <div className="flex-1 bg-purple-50 rounded-xl p-4">
                <p className="text-xs text-slate-400 mb-1">Location</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mt-2">
                  {([["Zone", location.zoneName], ["Aisle", location.aisleName], ["Bay", location.bayName], ["Level", location.levelName], ["Position", location.positionName]] as [string, string][])
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <div key={k}>
                        <span className="text-slate-400">{k} </span>
                        <span className="font-bold text-slate-800">{v}</span>
                      </div>
                    ))}
                </div>
                <p className="font-mono text-xs text-slate-500 mt-2">{location.locationCode}</p>
              </div>
            </div>

            <button onClick={handleAssign} disabled={loading}
              className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-semibold py-3.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {loading ? "Assigning..." : "Confirm Stow"}
            </button>

            <button onClick={() => setStep("location")}
              className="w-full text-slate-500 hover:text-slate-800 text-sm py-2 transition-colors">
              ← Change Location
            </button>
          </div>
        </div>
      )}

      {/* ── DONE ── */}
      {step === "done" && item && location && (
        <div className="text-center py-8">
          <div className="bg-green-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 className="w-10 h-10 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-1">Stow Complete!</h2>
          <p className="text-slate-500 text-sm mb-6">Successfully assigned to location</p>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 text-left mb-6 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">SKU</span>
              <span className="font-mono font-bold">{item.productSku}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Qty Stowed</span>
              <span className="font-bold text-green-600">{qty.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Location</span>
              <LocBadge loc={location} />
            </div>
            {item.lotNo && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">LOT</span>
                <span className="font-mono">{item.lotNo}</span>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button onClick={reset}
              className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors">
              <RotateCcw className="w-4 h-4" /> Stow Another
            </button>
          </div>
        </div>
      )}

      {/* ── Pending stow tags list (always visible below) ── */}
      <PendingTagList
        tags={pendingTags}
        onLoad={loadPendingTag}
        disabled={inProgress}
      />
    </div>
  );
}
