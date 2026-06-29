"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import {
  Layers, RefreshCw, Trash2, Loader2, CheckCircle2, AlertCircle,
  Printer, Plus, Search, ChevronDown, ChevronUp, X, Download, PackageCheck, Tag, MapPin,
} from "lucide-react";
import * as XLSX from "xlsx";
import type {
  B2CCluster, B2CClusterBin, B2CClusterLocationGroup, B2CClusterTask, B2CClusterItem,
} from "@/lib/b2c-cluster";
import { binColor, sortLocationGroups } from "@/lib/b2c-cluster";
import { buildLocationOccupancyLookup, getLocationOccupancyInfo, classifyOccupancy } from "@/lib/wms";

const MAX_BINS = 25;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type ReplenRow = {
  clusterId: string; bin: B2CClusterBin;
  item: NonNullable<B2CClusterBin["replenishmentItems"]>[number];
};

function orderCodeOf(o: Record<string, unknown>): string {
  return String(o.shippingOrderCode ?? o.orderCode ?? o.outboundCode ?? "");
}

function isShelf(zoneNm: unknown): boolean {
  return String(zoneNm ?? "").toLowerCase().includes("shelf");
}

function readableLocation(s: Record<string, unknown>): string {
  const parts = [
    s.zoneNm ?? s.zoneName ?? s.zone ?? "",
    s.aisleNm ?? s.aisleName ?? s.aisle ?? "",
    s.bayNm ?? s.bayName ?? s.bay ?? "",
    s.levelNm ?? s.levelName ?? s.level ?? "",
    s.positionNm ?? s.positionName ?? s.position ?? "",
  ].map(String).filter(Boolean);
  return parts.length > 0 ? parts.join("-") : String(s.location ?? s.locationCode ?? "");
}

export default function ClustersPage() {
  const { user } = useAuth();
  const router = useRouter();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  // ── Warehouse / Customer ──────────────────────────────────────────────────
  const [warehouseCode, setWarehouseCode] = useState("STOO1");
  const [warehouses, setWarehouses] = useState<{ code: string; name: string }[]>([]);
  const [customers, setCustomers] = useState<{ code: string; name: string }[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState("");

  // ── Orders ────────────────────────────────────────────────────────────────
  const [orders, setOrders] = useState<Record<string, unknown>[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedCodes, setSelectedCodes] = useState<Record<string, boolean>>({});
  const [colFilter, setColFilter] = useState({ orderCode: "", customer: "", consignee: "", qty: "", date: "" });

  // ── Clusters ──────────────────────────────────────────────────────────────
  const [clusters, setClusters] = useState<B2CCluster[]>([]);
  const [loadingClusters, setLoadingClusters] = useState(false);
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Occupancy map (all pages) ─────────────────────────────────────────────
  const [occupancyMap, setOccupancyMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!warehouseCode) return;
    const PAGE_SIZE = 500;
    let cancelled = false;

    (async () => {
      try {
        const all: Record<string, unknown>[] = [];
        let page = 1;
        while (true) {
          const res = await fetch("/api/wms/warehouse/location/list", {
            method: "POST",
            headers,
            body: JSON.stringify({ page, pageSize: PAGE_SIZE, warehouseCode }),
          });
          const j = await res.json().catch(() => ({}));
          const chunk: Record<string, unknown>[] =
            Array.isArray(j?.data?.list) ? j.data.list :
            Array.isArray(j?.data) ? j.data : [];
          all.push(...chunk);
          const total = Number(j?.data?.total ?? j?.total ?? 0);
          if (chunk.length < PAGE_SIZE || (total > 0 && all.length >= total)) break;
          page++;
        }
        if (!cancelled && all.length > 0) setOccupancyMap(buildLocationOccupancyLookup(all));
      } catch { /* ignore */ }
    })();

    return () => { cancelled = true; };
  }, [warehouseCode, headers]);

  const isShelfLoc = (s: Record<string, unknown>) => {
    const occupancy = getLocationOccupancyInfo(occupancyMap, s);
    if (occupancy) return classifyOccupancy(occupancy) === "shelf";
    // OccupancyMap is loaded — location not found means non-shelf (avoid false positives from zone name text)
    if (occupancyMap.size > 0) return false;
    // OccupancyMap not yet loaded: fall back to zone name text
    return String(s.zoneNm ?? s.zoneName ?? s.zone ?? "").toLowerCase().includes("shelf");
  };

  // ── Replenishment assign ──────────────────────────────────────────────────
  const [assigningKeys, setAssigningKeys] = useState<Set<string>>(new Set());
  const [assignedKeys, setAssignedKeys] = useState<Set<string>>(new Set());
  const [assignErrors, setAssignErrors] = useState<Record<string, string>>({});
  const [reAssigningId, setReAssigningId] = useState<string | null>(null);
  const [reAssignStatus, setReAssignStatus] = useState<Record<string, string>>({});

  // ── Shelf location picker modal ───────────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerRows, setPickerRows] = useState<ReplenRow[]>([]);
  const [pickerSku, setPickerSku] = useState("");
  const [pickerSkuName, setPickerSkuName] = useState("");
  const [pickerStock, setPickerStock] = useState<Record<string, unknown>[]>([]);
  const [pickerSelectedIdx, setPickerSelectedIdx] = useState(0);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerConfirming, setPickerConfirming] = useState(false);

  // ── Cluster eligibility check ─────────────────────────────────────────────
  const [checkResults, setCheckResults] = useState<Record<string, "checking" | "yes" | "no">>({});
  const [checkRunning, setCheckRunning] = useState(false);
  const [checkProgress, setCheckProgress] = useState({ done: 0, total: 0 });
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const checkAbortRef = useRef(false);
  const checkAbortCtrlRef = useRef<AbortController | null>(null);
  const stockCacheRef     = useRef<Map<string, Record<string, unknown>[]>>(new Map());
  const stockRemainingRef = useRef<Map<string, number>>(new Map());
  const [replenSkus, setReplenSkus] = useState<Array<{
    sku: string; name: string; orderCount: number; location: string; custCode: string;
  }>>([]);

  // ── Pre-cluster replen plan picker ────────────────────────────────────────
  const [replenPickerOpen, setReplenPickerOpen] = useState(false);
  const [replenPickerSku, setReplenPickerSku] = useState("");
  const [replenPickerName, setReplenPickerName] = useState("");
  const [replenPickerCustCode, setReplenPickerCustCode] = useState("");
  const [replenPickerOrderCount, setReplenPickerOrderCount] = useState(0);
  const [replenPickerStock, setReplenPickerStock] = useState<Record<string, unknown>[]>([]);
  const [replenPickerLoading, setReplenPickerLoading] = useState(false);
  const [replenPickerSelectedIdx, setReplenPickerSelectedIdx] = useState(0);
  const [replenSelectedLocs, setReplenSelectedLocs] = useState<Record<string, { stock: Record<string, unknown>; orderCount: number; name: string }>>({});

  // ── Creating ──────────────────────────────────────────────────────────────
  const [creating, setCreating] = useState(false);
  const [createStep, setCreateStep] = useState("");
  const [createError, setCreateError] = useState("");

  // ── Fetch warehouses & customers ──────────────────────────────────────────
  useEffect(() => {
    fetch("/api/wms/combo/warehouse", { headers })
      .then((r) => r.json())
      .then((j) => {
        const arr: Record<string, unknown>[] = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
        setWarehouses(arr.map((w) => ({ code: String(w.code ?? w.id ?? ""), name: String(w.name ?? w.code ?? "") })));
        const pref = arr.find((w) => String(w.code ?? "") === "STOO1") ?? arr[0];
        if (pref) setWarehouseCode(String(pref.code ?? pref.id ?? "STOO1"));
      })
      .catch(() => {});
  }, []); // eslint-disable-line

  useEffect(() => {
    fetch(`/api/wms/combo/customer-by-ordertype/B2C?warehouseCode=${encodeURIComponent(warehouseCode)}`, { headers })
      .then((r) => r.json())
      .then((j) => {
        const list = j?.data ?? j ?? [];
        if (Array.isArray(list))
          setCustomers(list.map((c: Record<string, unknown>) => ({
            code: String(c.customerCode ?? c.code ?? ""),
            name: String(c.customerName ?? c.name ?? ""),
          })));
      })
      .catch(() => {});
  }, [warehouseCode]); // eslint-disable-line

  // ── Load orders ───────────────────────────────────────────────────────────
  const loadOrders = useCallback(async () => {
    setLoadingOrders(true);
    setOrders([]);
    const PAGE_SIZE = 500;
    const baseBody = {
      limit: PAGE_SIZE, pageSize: PAGE_SIZE,
      orderType: "B2C",
      warehouseCode,
      ...(selectedCustomer ? { customerCode: selectedCustomer } : {}),
    };
    const extractList = (j: Record<string, unknown>): Record<string, unknown>[] => {
      const list = (j?.data as Record<string, unknown>)?.list ?? (j?.data as Record<string, unknown>)?.items ?? j?.data ?? j?.list ?? (Array.isArray(j) ? j : []);
      return Array.isArray(list) ? list : [];
    };
    for (const ep of ["/api/wms/shipping/b2c/list", "/api/wms/shipping/list"]) {
      try {
        const all: Record<string, unknown>[] = [];
        let page = 1;
        while (true) {
          const res = await fetch(ep, { method: "POST", headers, body: JSON.stringify({ ...baseBody, page }) });
          if (!res.ok) break;
          const j = await res.json().catch(() => null);
          const rows = extractList(j);
          all.push(...rows);
          if (rows.length < PAGE_SIZE) break;
          page++;
        }
        if (all.length > 0) {
          // Only show Out-Bound Request orders (AA)
          setOrders(all.filter((o) =>
            ["AA", "Out-Bound Request"].includes(String(o.status ?? o.orderStatus ?? "AA"))
          ));
          setLoadingOrders(false);
          return;
        }
      } catch { /* try next */ }
    }
    setLoadingOrders(false);
  }, [warehouseCode, selectedCustomer, headers]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  // Load cached check results from Redis on warehouseCode / customer change
  const checkTriggeredRef = useRef(false);
  useEffect(() => {
    if (!warehouseCode) return;
    checkTriggeredRef.current = false;
    setCheckedAt(null);
    setCheckResults({});
    setReplenSkus([]);
    fetch(`/api/cluster-check?warehouseCode=${encodeURIComponent(warehouseCode)}&customerCode=${encodeURIComponent(selectedCustomer)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.checkResults) {
          setCheckResults(data.checkResults);
          setReplenSkus(data.replenSkus ?? []);
          setCheckedAt(data.checkedAt);
          checkTriggeredRef.current = true; // skip auto-run
        }
      })
      .catch(() => {});
  }, [warehouseCode, selectedCustomer]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-run eligibility check once both orders AND occupancyMap are ready (only if no cache)
  useEffect(() => {
    if (!loadingOrders && filteredOrders.length > 0 && occupancyMap.size > 0 && !checkTriggeredRef.current) {
      checkTriggeredRef.current = true;
      runClusterCheck(); // eslint-disable-line react-hooks/exhaustive-deps
    }
  }, [loadingOrders, occupancyMap.size]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load clusters ─────────────────────────────────────────────────────────
  const loadClusters = useCallback(async () => {
    setLoadingClusters(true);
    try {
      const res = await fetch("/api/cluster");
      const data = await res.json();
      if (Array.isArray(data)) setClusters(data);
    } finally {
      setLoadingClusters(false);
    }
  }, []);

  useEffect(() => { loadClusters(); }, [loadClusters]);

  // ── Selection helpers ─────────────────────────────────────────────────────
  const clusteredCodes = useMemo(() => {
    const set: Record<string, true> = {};
    clusters.forEach((c) => c.bins.forEach((b) => { set[b.orderCode] = true; }));
    return set;
  }, [clusters]);

  const filteredOrders = useMemo(() => {
    let list = orders.filter((o) => !clusteredCodes[orderCodeOf(o)]);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((o) =>
        orderCodeOf(o).toLowerCase().includes(q) ||
        String(o.customerName ?? "").toLowerCase().includes(q) ||
        String(o.consigneeName ?? "").toLowerCase().includes(q) ||
        String(o.shippingOrderNo ?? "").toLowerCase().includes(q)
      );
    }
    if (colFilter.orderCode) {
      const q = colFilter.orderCode.toLowerCase();
      list = list.filter((o) =>
        orderCodeOf(o).toLowerCase().includes(q) ||
        String(o.shippingOrderNo ?? "").toLowerCase().includes(q)
      );
    }
    if (colFilter.customer) {
      const q = colFilter.customer.toLowerCase();
      list = list.filter((o) =>
        String(o.customerName ?? "").toLowerCase().includes(q) ||
        String(o.customerCode ?? "").toLowerCase().includes(q)
      );
    }
    if (colFilter.consignee) {
      const q = colFilter.consignee.toLowerCase();
      list = list.filter((o) => String(o.consigneeName ?? "").toLowerCase().includes(q));
    }
    if (colFilter.qty) {
      const n = Number(colFilter.qty);
      if (!isNaN(n)) list = list.filter((o) => Number(o.totalQty ?? o.qty ?? 0) >= n);
    }
    if (colFilter.date) {
      list = list.filter((o) => String(o.orderDate ?? "").includes(colFilter.date));
    }
    return list;
  }, [orders, clusteredCodes, search, colFilter]);

  const totalFilteredQty = useMemo(
    () => filteredOrders.reduce((sum, o) => sum + Number(o.totalQty ?? o.qty ?? 0), 0),
    [filteredOrders]
  );

  const selectedList = filteredOrders.filter((o) => selectedCodes[orderCodeOf(o)]);
  const canCreate = selectedList.length > 0 && selectedList.length <= MAX_BINS;

  function setCol(key: keyof typeof colFilter, val: string) {
    setColFilter((p) => ({ ...p, [key]: val }));
  }
  const hasColFilter = Object.values(colFilter).some(Boolean);

  function toggleSelect(code: string) {
    setSelectedCodes((p) => ({ ...p, [code]: !p[code] }));
  }
  function toggleAll() {
    const eligible = filteredOrders.filter((o) => checkResults[orderCodeOf(o)] === "yes");
    const pool = (eligible.length > 0 ? eligible : filteredOrders).slice(0, MAX_BINS);
    const visible = pool.map((o) => orderCodeOf(o));
    const allSelected = visible.every((c) => selectedCodes[c]);
    const next: Record<string, boolean> = {};
    if (!allSelected) visible.forEach((c) => { next[c] = true; });
    setSelectedCodes(next);
  }

  // ── Cluster eligibility check ─────────────────────────────────────────────
  async function runClusterCheck(forceRefresh = false) {
    if (checkRunning) {
      checkAbortRef.current = true;
      checkAbortCtrlRef.current?.abort();
      setCheckRunning(false);
      return;
    }
    if (forceRefresh) {
      fetch(`/api/cluster-check?warehouseCode=${encodeURIComponent(warehouseCode)}&customerCode=${encodeURIComponent(selectedCustomer)}`, { method: "DELETE" }).catch(() => {});
      setCheckedAt(null);
    }
    checkAbortRef.current = false;
    checkAbortCtrlRef.current = new AbortController();
    stockCacheRef.current.clear();
    stockRemainingRef.current.clear();
    setCheckRunning(true);
    setCheckResults({});
    setReplenSkus([]);
    const localResults: Record<string, "yes" | "no"> = {};

    const ordersToCheck = filteredOrders;
    setCheckProgress({ done: 0, total: ordersToCheck.length });

    const replenMap: Record<string, { name: string; orderCodes: Set<string>; location: string; custCode: string }> = {};

    const getItemAssignments = (j: Record<string, unknown>): Record<string, unknown>[] => {
      const d = (j?.data ?? {}) as Record<string, unknown>;
      for (const arr of [d.assignments, j.assignments, d.list, j.list]) {
        if (Array.isArray(arr) && arr.length > 0) return arr as Record<string, unknown>[];
      }
      return [];
    };
    const getLineItems = (j: Record<string, unknown>): Record<string, unknown>[] => {
      const d = (j?.data ?? {}) as Record<string, unknown>;
      for (const arr of [d.items, j.items, d.shippingItems, j.shippingItems, d.orderItems, j.orderItems]) {
        if (Array.isArray(arr) && arr.length > 0) return arr as Record<string, unknown>[];
      }
      return [];
    };

    for (let i = 0; i < ordersToCheck.length; i++) {
      if (checkAbortRef.current) break;
      const o = ordersToCheck[i];
      const code = orderCodeOf(o);
      const custCode = String(o.customerCode ?? "");

      setCheckResults((p) => ({ ...p, [code]: "checking" }));

      let rawAssignments: Record<string, unknown>[] = [];
      let rawItems: Record<string, unknown>[] = [];
      for (const ep of [
        `/api/wms/shipping/b2c/items/${encodeURIComponent(code)}`,
        `/api/wms/shipping/items/${encodeURIComponent(code)}`,
      ]) {
        try {
          const res = await fetch(ep, { headers, signal: checkAbortCtrlRef.current?.signal });
          const j = await res.json().catch(() => ({})) as Record<string, unknown>;
          const asgn = getItemAssignments(j);
          const itms = getLineItems(j);
          if (asgn.length > 0 || itms.length > 0) { rawAssignments = asgn; rawItems = itms; break; }
        } catch { /* try next */ }
      }

      if (rawAssignments.length === 0 && rawItems.length === 0) {
        setCheckResults((p) => ({ ...p, [code]: "no" }));
        setCheckProgress((p) => ({ ...p, done: i + 1 }));
        continue;
      }

      const shelfAssignments = rawAssignments.filter((a) => isShelfLoc(a));
      const assignedSkus = new Set(shelfAssignments.map((a) => String(a.productSku ?? a.sku ?? "")));

      const unassigned: Array<{ sku: string; name: string; qty: number }> = [];
      if (rawAssignments.length === 0) {
        for (const item of rawItems) {
          const sku = String(item.productSku ?? item.sku ?? "");
          const qty = Number(item.qty ?? 0);
          if (!sku || qty <= 0) continue;
          unassigned.push({ sku, name: String(item.productName ?? item.skuName ?? item.itemName ?? ""), qty });
        }
      } else {
        for (const item of rawItems) {
          const sku = String(item.productSku ?? item.sku ?? "");
          if (!sku || assignedSkus.has(sku)) continue;
          const remain = Number(item.remainQty ?? item.unassignedQty ?? item.remainingQty ?? 0);
          if (remain <= 0) continue;
          unassigned.push({ sku, name: String(item.productName ?? item.skuName ?? item.itemName ?? ""), qty: remain });
        }
      }

      if (unassigned.length === 0) {
        // All items covered by shelf assignments — instant Y, no extra API call needed
        setCheckResults((p) => ({ ...p, [code]: "yes" }));
        setCheckProgress((p) => ({ ...p, done: i + 1 }));
        continue;
      }

      // Check shelf stock for each unassigned SKU (cached — same SKU across orders fetched once)
      let canCluster = true;
      for (const { sku, name, qty: requiredQty } of unassigned) {
        if (checkAbortRef.current) break;
        const cacheKey = `${sku}:${custCode}`;
        let allStock: Record<string, unknown>[];
        if (stockCacheRef.current.has(cacheKey)) {
          allStock = stockCacheRef.current.get(cacheKey)!;
        } else {
          const res = await fetch(
            `/api/wms/shipping/available-stock/${encodeURIComponent(warehouseCode)}/${encodeURIComponent(custCode)}?productSku=${encodeURIComponent(sku)}`,
            { headers, signal: checkAbortCtrlRef.current?.signal }
          );
          const j = await res.json().catch(() => ({})) as Record<string, unknown>;
          allStock = (Array.isArray(j?.data) ? j.data : []) as Record<string, unknown>[];
          stockCacheRef.current.set(cacheKey, allStock);
          await sleep(100);
        }
        // Initialize remaining stock on first encounter for this SKU
        if (!stockRemainingRef.current.has(cacheKey)) {
          const totalShelfQty = allStock
            .filter((s) => isShelfLoc(s))
            .reduce((sum, s) => sum + Number(s.availQty ?? 0), 0);
          stockRemainingRef.current.set(cacheKey, totalShelfQty);
        }
        const remaining = stockRemainingRef.current.get(cacheKey)!;
        const hasShelf = remaining >= requiredQty;
        if (hasShelf) {
          // Deduct this order's consumption from the running total
          stockRemainingRef.current.set(cacheKey, remaining - requiredQty);
        } else {
          canCluster = false;
          if (!replenMap[sku]) {
            const anyStock = allStock.find((s) => Number(s.availQty ?? 0) > 0);
            replenMap[sku] = { name, orderCodes: new Set(), location: anyStock ? readableLocation(anyStock) : "—", custCode };
          }
          replenMap[sku].orderCodes.add(code);
        }
      }

      const result = canCluster ? "yes" : "no";
      localResults[code] = result;
      setCheckResults((p) => ({ ...p, [code]: result }));
      setCheckProgress((p) => ({ ...p, done: i + 1 }));
    }

    const finalReplenSkus = Object.entries(replenMap)
      .map(([sku, v]) => ({ sku, name: v.name, orderCount: v.orderCodes.size, location: v.location, custCode: v.custCode }))
      .sort((a, b) => b.orderCount - a.orderCount);
    setReplenSkus(finalReplenSkus);
    const now = new Date().toISOString();
    setCheckedAt(now);
    setCheckRunning(false);

    fetch("/api/cluster-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkResults: localResults, replenSkus: finalReplenSkus, checkedAt: now, warehouseCode, customerCode: selectedCustomer }),
    }).catch(() => {});
  }

  // ── Pre-cluster replen plan picker ────────────────────────────────────────
  async function openReplenPicker(sku: string, name: string, custCode: string, orderCount: number) {
    setReplenPickerSku(sku);
    setReplenPickerName(name);
    setReplenPickerCustCode(custCode);
    setReplenPickerOrderCount(orderCount);
    setReplenPickerStock([]);
    setReplenPickerSelectedIdx(0);
    setReplenPickerLoading(true);
    setReplenPickerOpen(true);
    try {
      const res = await fetch(
        `/api/wms/shipping/available-stock/${encodeURIComponent(warehouseCode)}/${encodeURIComponent(custCode)}?productSku=${encodeURIComponent(sku)}`,
        { headers }
      );
      const j = await res.json().catch(() => ({})) as Record<string, unknown>;
      const all = (Array.isArray(j?.data) ? j.data : []) as Record<string, unknown>[];
      const available = all
        .filter((s) => Number(s.availQty ?? 0) > 0)
        .sort((a, b) => (String(a.expireDate ?? "") || "9").localeCompare(String(b.expireDate ?? "") || "9"));
      setReplenPickerStock(available);
    } finally {
      setReplenPickerLoading(false);
    }
  }

  function confirmReplenPicker() {
    const stock = replenPickerStock[replenPickerSelectedIdx];
    if (!stock) return;
    setReplenSelectedLocs((p) => ({
      ...p,
      [replenPickerSku]: { stock, orderCount: replenPickerOrderCount, name: replenPickerName },
    }));
    setReplenPickerOpen(false);
  }

  function printReplenPlan() {
    if (replenSkus.length === 0) return;
    const entries = replenSkus.map((r) => {
      const sel = replenSelectedLocs[r.sku];
      return {
        sku: r.sku,
        name: r.name,
        locationCode: sel ? readableLocation(sel.stock) : r.location,
        lotNo: sel ? String(sel.stock.lotNo ?? "") : "",
        expireDate: sel ? String(sel.stock.expireDate ?? "") : "",
        availQty: sel ? Number(sel.stock.availQty ?? 0) : 0,
        orderCount: r.orderCount,
      };
    });
    localStorage.setItem("replen_plan_print", JSON.stringify({ entries, warehouseCode, createdAt: new Date().toISOString() }));
    window.open("/replen-plan-print", "_blank");
  }

  // ── Cluster creation ──────────────────────────────────────────────────────
  async function createCluster() {
    if (!canCreate) return;
    setCreating(true);
    setCreateError("");

    const selected = selectedList.slice(0, MAX_BINS);
    const bins: B2CClusterBin[] = [];
    const replenishmentBins: number[] = [];
    const locMap = new Map<string, { locationCode: string; locationId: string; tasks: B2CClusterTask[] }>();

    const parseAssignments = (j: Record<string, unknown>): Record<string, unknown>[] => {
      const d2 = (j?.data ?? {}) as Record<string, unknown>;
      for (const arr of [d2.assignments, j.assignments, d2.list, j.list]) {
        if (Array.isArray(arr) && arr.length > 0) return arr as Record<string, unknown>[];
      }
      return [];
    };
    const parseLineItems = (j: Record<string, unknown>): Record<string, unknown>[] => {
      const d2 = (j?.data ?? {}) as Record<string, unknown>;
      for (const arr of [d2.items, j.items, d2.shippingItems, j.shippingItems, d2.orderItems, j.orderItems]) {
        if (Array.isArray(arr) && arr.length > 0) return arr as Record<string, unknown>[];
      }
      return [];
    };

    try {
      // Phase 1: parallel — fetch all orders' items/assignments simultaneously
      setCreateStep(`Fetching ${selected.length} orders in parallel…`);
      const prefetched = await Promise.all(
        selected.map(async (o) => {
          const code = orderCodeOf(o);
          for (const ep of [
            `/api/wms/shipping/b2c/items/${encodeURIComponent(code)}`,
            `/api/wms/shipping/items/${encodeURIComponent(code)}`,
          ]) {
            try {
              const res = await fetch(ep, { headers });
              const j = await res.json().catch(() => ({})) as Record<string, unknown>;
              const asgn = parseAssignments(j);
              const itms = parseLineItems(j);
              if (asgn.length > 0 || itms.length > 0) return { rawAssignments: asgn, rawItems: itms };
            } catch { /* try next */ }
          }
          return { rawAssignments: [] as Record<string, unknown>[], rawItems: [] as Record<string, unknown>[] };
        })
      );

      // Phase 2: sequential — check shelf stock + auto-assign per order
      for (let i = 0; i < selected.length; i++) {
        const o = selected[i];
        const code = orderCodeOf(o);
        const binNo = i + 1;
        const { rawAssignments, rawItems } = prefetched[i];

        setCreateStep(`[${binNo}/${selected.length}] ${code} — processing…`);

        // 2. Filter to shelf zone assignments
        let shelfAssignments = rawAssignments.filter((a) => isShelfLoc(a));

        // 3. Determine replenishment need
        let needsReplenishment = false;

        // Case A: no items at all
        if (rawAssignments.length === 0 && rawItems.length === 0) {
          needsReplenishment = true;
          setCreateStep(`[${binNo}/${selected.length}] ${code} — ⚠ No items in order. Replenishment required.`);
        }

        // Case B: assignments exist but ALL in non-shelf zones, no unassigned items to re-assign
        if (shelfAssignments.length === 0 && rawAssignments.length > 0 && rawItems.length === 0) {
          const zoneSet: Record<string, true> = {};
          rawAssignments.forEach((a) => { zoneSet[String(a.zoneNm ?? a.zoneName ?? a.zone ?? "—")] = true; });
          const zones = Object.keys(zoneSet).join(", ");
          needsReplenishment = true;
          setCreateStep(`[${binNo}/${selected.length}] ${code} — ⚠ Assigned to non-shelf (${zones}). Move to shelf first.`);
        }

        type ReplenItem = NonNullable<B2CClusterBin["replenishmentItems"]>[number];
        let replenishmentItems: ReplenItem[] = [];
        const custCode = String(o.customerCode ?? "");

        // Helper: fetch available-stock for a SKU
        const fetchStock = async (sku: string): Promise<Record<string, unknown>[]> => {
          const res = await fetch(
            `/api/wms/shipping/available-stock/${encodeURIComponent(warehouseCode)}/${encodeURIComponent(custCode)}?productSku=${encodeURIComponent(sku)}`,
            { headers }
          );
          const j = await res.json().catch(() => ({})) as Record<string, unknown>;
          return (Array.isArray(j?.data) ? j.data : []) as Record<string, unknown>[];
        };
        const byFefo = (a: Record<string, unknown>, b: Record<string, unknown>) =>
          (String(a.expireDate ?? "") || "99999999").localeCompare(String(b.expireDate ?? "") || "99999999");

        if (!needsReplenishment && shelfAssignments.length === 0 && rawItems.length > 0) {
          // Parallel: fetch available-stock for all unassigned SKUs at once
          const unassignedItems = rawItems.filter((item) => {
            const sku = String(item.productSku ?? item.sku ?? "");
            return sku && Number(item.unassignedQty ?? item.qty ?? 0) > 0;
          });

          setCreateStep(`[${binNo}/${selected.length}] ${code} — checking shelf stock (${unassignedItems.length} SKUs)…`);
          const stockResults = await Promise.all(
            unassignedItems.map((item) => fetchStock(String(item.productSku ?? item.sku ?? "")))
          );

          let anyShelfStockFound = false;
          for (let si = 0; si < unassignedItems.length; si++) {
            const item = unassignedItems[si];
            const sku = String(item.productSku ?? item.sku ?? "");
            const unassignedQty = Number(item.unassignedQty ?? item.qty ?? 0);
            const allStock = stockResults[si];
            const shelfStock = allStock.filter((s) => isShelfLoc(s) && Number(s.availQty ?? 0) > 0).sort(byFefo);
            const best = shelfStock[0];
            if (!best) continue;

            anyShelfStockFound = true;
            setCreateStep(`[${binNo}/${selected.length}] ${code} — assigning ${sku}…`);
            await fetch("/api/wms/shipping/assign", {
              method: "POST", headers,
              body: JSON.stringify({
                shippingOrderCode: code, shippingItemId: item.shippingItemId,
                customerCode: custCode, warehouseCode, warehouseCd: best.location,
                productSku: sku, lotNo: String(best.lotNo ?? ""),
                expireDate: String(best.expireDate ?? ""), itemCondition: String(best.itemCondition ?? "GOOD"),
                qty: unassignedQty,
              }),
            });
            shelfAssignments.push({ ...item, ...best, locationCode: readableLocation(best), productSku: sku });
          }

          if (!anyShelfStockFound && shelfAssignments.length === 0) {
            needsReplenishment = true;
            setCreateStep(`[${binNo}/${selected.length}] ${code} — ⚠ No shelf stock. Finding storage locations…`);
            for (let si = 0; si < unassignedItems.length; si++) {
              const item = unassignedItems[si];
              const sku = String(item.productSku ?? item.sku ?? "");
              const unassignedQty = Number(item.unassignedQty ?? item.qty ?? 0);
              const best = stockResults[si].filter((s) => Number(s.availQty ?? 0) > 0).sort(byFefo)[0];
              replenishmentItems.push({
                sku, name: String(item.productName ?? item.skuName ?? item.itemName ?? ""),
                qty: unassignedQty,
                locationCode: best ? readableLocation(best) : "",
                locationId: best ? String(best.inKey ?? best.locationId ?? "") : "",
                lotNo: best ? String(best.lotNo ?? "") : "",
                expireDate: best ? String(best.expireDate ?? "") : "",
                itemCondition: best ? String(best.itemCondition ?? "GOOD") : "",
                shippingItemId: Number(item.shippingItemId ?? 0) || undefined,
              });
            }
          }
        }

        // Mixed: some shelf assignments exist but other SKUs still unassigned
        if (shelfAssignments.length > 0 && rawItems.length > 0) {
          const assignedSkuSet = new Set(shelfAssignments.map((a) => String(a.productSku ?? a.sku ?? "")));
          const unassignedMixed = rawItems.filter((item) => {
            const sku = String(item.productSku ?? item.sku ?? "");
            return sku && !assignedSkuSet.has(sku) && Number(item.remainQty ?? item.unassignedQty ?? item.remainingQty ?? 0) > 0;
          });

          if (unassignedMixed.length > 0) {
            setCreateStep(`[${binNo}/${selected.length}] ${code} — checking ${unassignedMixed.length} unassigned SKUs…`);
            const mixedStock = await Promise.all(
              unassignedMixed.map((item) => fetchStock(String(item.productSku ?? item.sku ?? "")))
            );

            for (let mi = 0; mi < unassignedMixed.length; mi++) {
              const item = unassignedMixed[mi];
              const sku = String(item.productSku ?? item.sku ?? "");
              const unassignedQty = Number(item.remainQty ?? item.unassignedQty ?? item.remainingQty ?? 0);
              const allStock = mixedStock[mi];
              const shelfStock = allStock.filter((s) => isShelfLoc(s) && Number(s.availQty ?? 0) > 0).sort(byFefo);
              const best = shelfStock[0];

              if (best) {
                setCreateStep(`[${binNo}/${selected.length}] ${code} — assigning ${sku}…`);
                await fetch("/api/wms/shipping/assign", {
                  method: "POST", headers,
                  body: JSON.stringify({
                    shippingOrderCode: code, shippingItemId: item.shippingItemId,
                    customerCode: custCode, warehouseCode, warehouseCd: best.location,
                    productSku: sku, lotNo: String(best.lotNo ?? ""),
                    expireDate: String(best.expireDate ?? ""), itemCondition: String(best.itemCondition ?? "GOOD"),
                    qty: unassignedQty,
                  }),
                });
                shelfAssignments.push({ ...item, ...best, locationCode: readableLocation(best), productSku: sku });
              } else {
                needsReplenishment = true;
                const anyBest = allStock.filter((s) => Number(s.availQty ?? 0) > 0).sort(byFefo)[0];
                replenishmentItems.push({
                  sku, name: String(item.productName ?? item.skuName ?? item.itemName ?? ""),
                  qty: unassignedQty,
                  locationCode: anyBest ? readableLocation(anyBest) : "",
                  locationId: anyBest ? String(anyBest.inKey ?? anyBest.locationId ?? "") : "",
                  lotNo: anyBest ? String(anyBest.lotNo ?? "") : "",
                  expireDate: anyBest ? String(anyBest.expireDate ?? "") : "",
                  itemCondition: anyBest ? String(anyBest.itemCondition ?? "GOOD") : "",
                  shippingItemId: Number(item.shippingItemId ?? 0) || undefined,
                });
              }
            }
          }
        }

        // Case B fallback: assigned to non-shelf → build replenishmentItems from rawAssignments
        if (needsReplenishment && rawAssignments.length > 0 && replenishmentItems.length === 0) {
          replenishmentItems = rawAssignments.map((a) => ({
            sku: String(a.productSku ?? a.sku ?? ""),
            name: String(a.productName ?? a.skuName ?? a.itemName ?? ""),
            qty: Number(a.qty ?? a.assignQty ?? a.assignedQty ?? 0),
            locationCode: readableLocation(a),
            locationId: String(a.inKey ?? a.locationId ?? ""),
            lotNo: String(a.lotNo ?? ""),
            expireDate: String(a.expireDate ?? ""),
            itemCondition: String(a.itemCondition ?? "GOOD"),
            shippingItemId: Number(a.shippingItemId ?? 0) || undefined,
          })).filter((r) => r.sku);
        }

        if (needsReplenishment) replenishmentBins.push(binNo);

        // 4. Build bin items
        const binItems: B2CClusterItem[] = shelfAssignments.map((a) => ({
          sku: String(a.productSku ?? a.sku ?? ""),
          name: String(a.productName ?? a.skuName ?? a.itemName ?? ""),
          qty: Number(a.qty ?? a.assignQty ?? a.assignedQty ?? 0),
          locationCode: readableLocation(a),
          locationId: String(a.inKey ?? a.locationId ?? ""),
          lotNo: String(a.lotNo ?? ""),
          expireDate: String(a.expireDate ?? ""),
          itemCondition: String(a.itemCondition ?? "GOOD"),
          shippingItemId: Number(a.shippingItemId ?? 0) || undefined,
        }));

        bins.push({
          binNo,
          orderCode: code,
          customerCode: String(o.customerCode ?? ""),
          orderNo: String(o.shippingOrderNo ?? ""),
          consigneeName: String(o.consigneeName ?? o.receiverName ?? ""),
          consigneeAddress1: String(o.consigneeAddress1 ?? o.consigneeAddr1 ?? o.receiverAddr1 ?? o.addr1 ?? o.address1 ?? o.shipToAddress ?? ""),
          consigneeAddress2: String(o.consigneeAddress2 ?? o.consigneeAddr2 ?? o.receiverAddr2 ?? o.addr2 ?? o.address2 ?? ""),
          consigneeCity: String(o.consigneeCity ?? o.receiverCity ?? o.city ?? ""),
          consigneeState: String(o.consigneeState ?? o.receiverState ?? o.state ?? o.province ?? ""),
          consigneeZipCode: String(o.consigneeZipCode ?? o.consigneeZip ?? o.receiverZip ?? o.zipCode ?? o.zip ?? ""),
          consigneeNationalCode: String(o.consigneeNationalCode ?? o.consigneeCountry ?? o.countryCode ?? o.country ?? ""),
          consigneeTelLNo: String(o.consigneeTelLNo ?? o.consigneeCellNo ?? o.receiverTel ?? o.receiverPhone ?? ""),
          items: binItems,
          needsReplenishment,
          ...(replenishmentItems.length > 0 ? { replenishmentItems } : {}),
        });

        // 5. Accumulate location groups
        for (const item of binItems) {
          const key = item.locationCode;
          if (!key) continue;
          if (!locMap.has(key)) locMap.set(key, { locationCode: key, locationId: item.locationId ?? "", tasks: [] });
          locMap.get(key)!.tasks.push({
            binNo, orderCode: code, sku: item.sku, skuName: item.name, qty: item.qty,
            locationId: item.locationId, lotNo: item.lotNo, expireDate: item.expireDate,
            itemCondition: item.itemCondition, shippingItemId: item.shippingItemId,
          });
        }
      }

      setCreateStep("Building cluster…");
      const locationGroups: B2CClusterLocationGroup[] = sortLocationGroups(
        Array.from(locMap.values())
      );

      const cluster: B2CCluster = {
        id: `cluster_${Date.now()}`,
        warehouseCode,
        createdAt: new Date().toISOString(),
        createdBy: user!.userId,
        status: "active",
        bins,
        locationGroups,
        ...(replenishmentBins.length > 0 ? { replenishmentBins } : {}),
      };

      const saveRes = await fetch("/api/cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cluster),
      });
      if (!saveRes.ok) {
        const errBody = await saveRes.json().catch(() => ({}));
        throw new Error(errBody?.error ?? `Failed to save cluster (${saveRes.status})`);
      }

      await loadClusters();
      setSelectedCodes({});
      setCreateStep("");
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Cluster creation failed");
    } finally {
      setCreating(false);
    }
  }

  // ── Delete cluster ────────────────────────────────────────────────────────
  async function deleteCluster(id: string) {
    setDeletingId(id);
    await fetch(`/api/cluster?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setClusters((p) => p.filter((c) => c.id !== id));
    setDeletingId(null);
  }

  // ── Complete cluster ──────────────────────────────────────────────────────
  const [completingId, setCompletingId] = useState<string | null>(null);

  async function completeCluster(id: string) {
    setCompletingId(id);
    const cluster = clusters.find((c) => c.id === id);
    if (cluster) {
      // Group bins by customerCode to batch status-change calls
      const grouped = new Map<string, string[]>();
      for (const bin of cluster.bins) {
        if (!grouped.has(bin.customerCode)) grouped.set(bin.customerCode, []);
        grouped.get(bin.customerCode)!.push(bin.orderCode);
      }
      await Promise.all(
        Array.from(grouped.entries()).map(([customerCode, orderCodes]) =>
          fetch("/api/wms/shipping/status-change", {
            method: "POST",
            headers,
            body: JSON.stringify({
              warehouseCode: cluster.warehouseCode,
              customerCode,
              orderCodes,
              newStatus: "CA",
              completeDate: "",
              cancelComment: "",
            }),
          }).catch(() => {})
        )
      );
    }
    await fetch("/api/cluster", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ id, status: "completed", completedAt: new Date().toISOString() }),
    });
    setCompletingId(null);
    await loadClusters();
  }

  // ── Shelf location picker ─────────────────────────────────────────────────
  async function openSkuPicker(sku: string, skuName: string, rows: ReplenRow[], custCode: string) {
    setPickerSku(sku);
    setPickerSkuName(skuName);
    setPickerRows(rows);
    setPickerStock([]);
    setPickerSelectedIdx(0);
    setPickerLoading(true);
    setPickerOpen(true);
    try {
      const res = await fetch(
        `/api/wms/shipping/available-stock/${encodeURIComponent(warehouseCode)}/${encodeURIComponent(custCode)}?productSku=${encodeURIComponent(sku)}`,
        { headers }
      );
      const j = await res.json().catch(() => ({})) as Record<string, unknown>;
      const all = (Array.isArray(j?.data) ? j.data : []) as Record<string, unknown>[];
      const shelf = all
        .filter((s) => isShelfLoc(s) && Number(s.availQty ?? 0) > 0)
        .sort((a, b) => (String(a.expireDate ?? "") || "9").localeCompare(String(b.expireDate ?? "") || "9"));
      setPickerStock(shelf);
    } finally {
      setPickerLoading(false);
    }
  }

  async function confirmSkuPicker() {
    const stock = pickerStock[pickerSelectedIdx];
    if (!stock) return;
    setPickerConfirming(true);
    for (const row of pickerRows) {
      const key = `${row.clusterId}_${row.bin.binNo}_${row.item.sku}`;
      if (assignedKeys.has(key)) continue;
      setAssigningKeys((p) => new Set(p).add(key));
      setAssignErrors((p) => { const n = { ...p }; delete n[key]; return n; });
      try {
        const body = {
          shippingOrderCode: row.bin.orderCode,
          orderCode: row.bin.orderCode,
          shippingItemId: row.item.shippingItemId,
          customerCode: row.bin.customerCode,
          warehouseCode,
          warehouseCd: String(stock.location ?? stock.inKey ?? stock.locationId ?? ""),
          productSku: row.item.sku,
          qty: row.item.qty,
          lotNo: String(stock.lotNo ?? ""),
          expireDate: String(stock.expireDate ?? ""),
          itemCondition: String(stock.itemCondition ?? "GOOD"),
        };
        const res = await fetch("/api/wms/shipping/assign", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j2 = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (!res.ok || j2?.isSuccess === false) throw new Error(String(j2?.message ?? j2?.msg ?? `HTTP ${res.status}`));
        setAssignedKeys((p) => new Set(p).add(key));
      } catch (e) {
        setAssignErrors((p) => ({ ...p, [key]: e instanceof Error ? e.message : "Failed" }));
      } finally {
        setAssigningKeys((p) => { const n = new Set(p); n.delete(key); return n; });
      }
      await sleep(300);
    }
    setPickerConfirming(false);
    setPickerOpen(false);
  }

  // ── Replenishment assign helpers ──────────────────────────────────────────

  async function assignRow(row: ReplenRow) {
    const key = `${row.clusterId}_${row.bin.binNo}_${row.item.sku}`;
    setAssigningKeys((p) => new Set(p).add(key));
    setAssignErrors((p) => { const n = { ...p }; delete n[key]; return n; });
    try {
      const body = {
        shippingOrderCode: row.bin.orderCode,
        orderCode: row.bin.orderCode,
        shippingItemId: row.item.shippingItemId,
        customerCode: row.bin.customerCode,
        warehouseCode,
        locationCode: row.item.locationCode,
        locationId: row.item.locationId,
        inKey: row.item.locationId,
        warehouseCd: row.item.locationId || row.item.locationCode,
        productSku: row.item.sku,
        qty: row.item.qty,
        lotNo: row.item.lotNo ?? "",
        expireDate: row.item.expireDate ?? "",
        itemCondition: row.item.itemCondition ?? "GOOD",
      };
      const res = await fetch("/api/wms/shipping/assign", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok || j?.isSuccess === false) {
        throw new Error(String(j?.message ?? j?.msg ?? `HTTP ${res.status}`));
      }
      setAssignedKeys((p) => new Set(p).add(key));
    } catch (e) {
      setAssignErrors((p) => ({ ...p, [key]: e instanceof Error ? e.message : "Failed" }));
    } finally {
      setAssigningKeys((p) => { const n = new Set(p); n.delete(key); return n; });
    }
  }

  async function assignAllRows(rows: ReplenRow[]) {
    for (const row of rows) {
      const key = `${row.clusterId}_${row.bin.binNo}_${row.item.sku}`;
      if (assignedKeys.has(key)) continue;
      await assignRow(row);
      await sleep(300);
    }
  }

  async function reAssignReplenishment(cluster: B2CCluster) {
    setReAssigningId(cluster.id);
    setReAssignStatus({});
    const updatedBins = cluster.bins.map((b) => ({ ...b }));
    const newReplenishmentBins: number[] = [];

    for (const bin of cluster.bins) {
      if (!bin.needsReplenishment || !bin.replenishmentItems?.length) continue;
      const custCode = bin.customerCode;
      const newItems: B2CClusterItem[] = [];
      let allAssigned = true;

      for (const ri of bin.replenishmentItems) {
        const sku = ri.sku;
        const qty = ri.qty;
        if (!sku || qty <= 0) continue;

        // Skip if already assigned (manually via Assign button, or by a previous Re-assign run)
        const alreadyInItems = bin.items.some(
          (it) => (ri.shippingItemId && it.shippingItemId === ri.shippingItemId) || it.sku === sku
        );
        if (alreadyInItems) {
          const existing = bin.items.find(
            (it) => (ri.shippingItemId && it.shippingItemId === ri.shippingItemId) || it.sku === sku
          )!;
          newItems.push(existing);
          continue;
        }

        // Skip if already added in this run (duplicate replenishmentItems entries)
        if (newItems.some((it) => it.sku === sku)) continue;

        setReAssignStatus((p) => ({ ...p, [cluster.id]: `Bin ${bin.binNo} — checking shelf stock for ${sku}…` }));
        const stockRes = await fetch(
          `/api/wms/shipping/available-stock/${encodeURIComponent(warehouseCode)}/${encodeURIComponent(custCode)}?productSku=${encodeURIComponent(sku)}`,
          { headers }
        );
        const stockJson = await stockRes.json().catch(() => ({})) as Record<string, unknown>;
        const stockList = (Array.isArray(stockJson?.data) ? stockJson.data : []) as Record<string, unknown>[];
        const shelfStock = stockList
          .filter((s) => isShelfLoc(s) && Number(s.availQty ?? 0) > 0)
          .sort((a, b) => (String(a.expireDate ?? "") || "9").localeCompare(String(b.expireDate ?? "") || "9"));

        const best = shelfStock[0];
        if (!best) { allAssigned = false; continue; }

        setReAssignStatus((p) => ({ ...p, [cluster.id]: `Bin ${bin.binNo} — assigning ${sku} from ${readableLocation(best)}…` }));
        const assignBody = {
          shippingOrderCode: bin.orderCode,
          shippingItemId: ri.shippingItemId,
          customerCode: custCode,
          warehouseCode,
          warehouseCd: String(best.inKey ?? best.location ?? best.locationId ?? ""),
          productSku: sku,
          lotNo: String(best.lotNo ?? ""),
          expireDate: String(best.expireDate ?? ""),
          itemCondition: String(best.itemCondition ?? "GOOD"),
          qty,
        };
        const assignRes = await fetch("/api/wms/shipping/assign", { method: "POST", headers, body: JSON.stringify(assignBody) });
        const assignJson = await assignRes.json().catch(() => ({})) as Record<string, unknown>;
        if (assignRes.ok && assignJson?.isSuccess !== false) {
          newItems.push({
            sku, name: ri.name, qty,
            locationCode: readableLocation(best),
            locationId: String(best.inKey ?? best.locationId ?? ""),
            lotNo: String(best.lotNo ?? ""),
            expireDate: String(best.expireDate ?? ""),
            itemCondition: String(best.itemCondition ?? "GOOD"),
            shippingItemId: ri.shippingItemId,
          });
        } else {
          allAssigned = false;
        }
        await sleep(300);
      }

      const binIdx = updatedBins.findIndex((b) => b.binNo === bin.binNo);
      if (binIdx >= 0) {
        updatedBins[binIdx] = {
          ...updatedBins[binIdx],
          // Append newly assigned items to existing shelf items (don't replace)
          items: newItems.length > 0
            ? [...updatedBins[binIdx].items, ...newItems]
            : updatedBins[binIdx].items,
          needsReplenishment: !allAssigned || newItems.length === 0,
          replenishmentItems: allAssigned && newItems.length > 0 ? undefined : bin.replenishmentItems,
        };
        if (!allAssigned || newItems.length === 0) newReplenishmentBins.push(bin.binNo);
      }
    }

    // Rebuild locationGroups from all updated bins so new shelf locations appear in pick route
    const locMap = new Map<string, { locationCode: string; locationId: string; tasks: B2CClusterLocationGroup["tasks"] }>();
    for (const bin of updatedBins) {
      for (const item of bin.items) {
        if (!item.locationCode) continue;
        if (!locMap.has(item.locationCode)) {
          locMap.set(item.locationCode, { locationCode: item.locationCode, locationId: item.locationId ?? "", tasks: [] });
        }
        locMap.get(item.locationCode)!.tasks.push({
          binNo: bin.binNo,
          orderCode: bin.orderCode,
          sku: item.sku,
          skuName: item.name,
          qty: item.qty,
          locationId: item.locationId,
          lotNo: item.lotNo,
          expireDate: item.expireDate,
          itemCondition: item.itemCondition,
          shippingItemId: item.shippingItemId,
        });
      }
    }
    const updatedLocationGroups = sortLocationGroups(Array.from(locMap.values()));

    setReAssignStatus((p) => ({ ...p, [cluster.id]: "Saving…" }));
    await fetch("/api/cluster", {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        id: cluster.id,
        bins: updatedBins,
        locationGroups: updatedLocationGroups,
        replenishmentBins: newReplenishmentBins.length > 0 ? newReplenishmentBins : [],
      }),
    });

    setReAssignStatus((p) => ({ ...p, [cluster.id]: "" }));
    setReAssigningId(null);
    await loadClusters();
  }

  function downloadReplenishment(cluster: B2CCluster) {
    const rows: Record<string, unknown>[] = [];
    for (const bin of cluster.bins) {
      if (!bin.needsReplenishment || !bin.replenishmentItems?.length) continue;
      for (const ri of bin.replenishmentItems) {
        rows.push({
          "Bin #": bin.binNo,
          "Order Code": bin.orderCode,
          "Order No": bin.orderNo ?? "",
          "Consignee": bin.consigneeName ?? "",
          "SKU": ri.sku,
          "Product": ri.name,
          "Qty": ri.qty,
          "Current Location": ri.locationCode ?? "",
          "Lot No": ri.lotNo ?? "",
          "Expire Date": ri.expireDate ?? "",
          "Condition": ri.itemCondition ?? "",
        });
      }
    }
    if (rows.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(rows);
    const colWidths = [6, 22, 20, 20, 16, 30, 6, 18, 12, 14, 10];
    ws["!cols"] = colWidths.map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Replenishment");
    XLSX.writeFile(wb, `replenishment_${cluster.id.replace("cluster_", "")}.xlsx`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
            <Layers className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">B2C Cluster Pick</h1>
            <p className="text-sm text-slate-500">Create up to 25-order clusters with shelf location assignment</p>
          </div>
        </div>
        <button onClick={loadClusters} disabled={loadingClusters}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors">
          <RefreshCw className={`w-4 h-4 ${loadingClusters ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* ── Existing clusters ── */}
      {clusters.filter((c) => c.status !== "completed").length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide">Active Clusters</h2>
          {clusters.filter((c) => c.status !== "completed").map((cluster) => {
            const isExpanded = expandedCluster === cluster.id;
            const isDeleting = deletingId === cluster.id;
            return (
              <div key={cluster.id} className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                {/* Card header */}
                <div className="px-5 py-4 flex items-start gap-4">
                  {/* Bin color grid */}
                  <div className="grid grid-cols-5 gap-0.5 flex-shrink-0">
                    {Array.from({ length: Math.min(cluster.bins.length, 25) }).map((_, i) => (
                      <div key={i}
                        style={{ backgroundColor: binColor(i + 1), width: 14, height: 14, borderRadius: 2 }}
                        title={`Bin ${i + 1}: ${cluster.bins[i]?.orderCode ?? ""}`}
                      />
                    ))}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-base font-extrabold text-slate-900">{cluster.bins.length} bins</span>
                      <span className="text-sm text-slate-400">· {cluster.locationGroups.length} locations</span>
                      <span className="text-sm text-slate-400">· {cluster.warehouseCode}</span>
                      {cluster.replenishmentBins && cluster.replenishmentBins.length > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
                          <AlertCircle className="w-3 h-3" />
                          Replenishment needed: Bin {cluster.replenishmentBins.join(", ")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">Created: {new Date(cluster.createdAt).toLocaleString()}</p>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => router.push(`/clusters-print?id=${encodeURIComponent(cluster.id)}`)}
                      className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                      title="Print Pick Tickets"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { isDeleting ? null : deleteCluster(cluster.id); }}
                      disabled={isDeleting}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => completeCluster(cluster.id)}
                      disabled={completingId === cluster.id}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                      title="Mark cluster as completed"
                    >
                      {completingId === cluster.id
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Completing…</>
                        : <><CheckCircle2 className="w-3.5 h-3.5" /> Complete</>}
                    </button>
                    <button
                      onClick={() => setExpandedCluster(isExpanded ? null : cluster.id)}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                    >
                      {isExpanded ? <><ChevronUp className="w-3.5 h-3.5" /> Collapse</> : <><ChevronDown className="w-3.5 h-3.5" /> Detail</>}
                    </button>
                  </div>
                </div>

                {/* Expanded: bins + location groups */}
                {isExpanded && (
                  <div className="border-t border-slate-100">

                    {/* Replenishment panel */}
                    {cluster.replenishmentBins && cluster.replenishmentBins.length > 0 && (() => {
                      const allRows: ReplenRow[] = [];
                      cluster.bins.forEach((bin) => {
                        if (!bin.needsReplenishment || !bin.replenishmentItems?.length) return;
                        bin.replenishmentItems.forEach((item) => {
                          allRows.push({ clusterId: cluster.id, bin, item });
                        });
                      });
                      if (allRows.length === 0) return null;
                      const pendingRows = allRows.filter((r) => !assignedKeys.has(`${r.clusterId}_${r.bin.binNo}_${r.item.sku}`));
                      return (
                        <div className="border-b border-amber-100">
                          {/* Header */}
                          <div className="px-5 py-2.5 bg-amber-50 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                              <span className="text-xs font-bold text-amber-700 uppercase tracking-wide">
                                Replenishment — {(() => { const s = new Set(allRows.map(r => r.item.sku)); return s.size; })()} SKUs · {cluster.replenishmentBins.length} bins
                              </span>
                              {pendingRows.length < allRows.length && (
                                <span className="text-xs text-emerald-600 font-semibold">
                                  ({allRows.length - pendingRows.length} rows assigned)
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <button
                                onClick={() => window.open(`/clusters-replen-print?id=${encodeURIComponent(cluster.id)}`, "_blank")}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 transition-colors"
                              >
                                <Tag className="w-3.5 h-3.5" /> Print Labels
                              </button>
                              <button
                                onClick={() => downloadReplenishment(cluster)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                              >
                                <Download className="w-3.5 h-3.5" /> Excel
                              </button>
                              {pendingRows.length > 0 && (
                                <button
                                  onClick={() => assignAllRows(pendingRows)}
                                  disabled={assigningKeys.size > 0}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
                                >
                                  {assigningKeys.size > 0
                                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Assigning…</>
                                    : <><PackageCheck className="w-3.5 h-3.5" /> Assign All ({pendingRows.length})</>}
                                </button>
                              )}
                              <button
                                onClick={() => reAssignReplenishment(cluster)}
                                disabled={reAssigningId === cluster.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                              >
                                {reAssigningId === cluster.id
                                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {reAssignStatus[cluster.id] || "Re-assigning…"}</>
                                  : <><RefreshCw className="w-3.5 h-3.5" /> Re-assign after Replenishment</>}
                              </button>
                            </div>
                          </div>

                          {/* SKU-grouped table */}
                          {(() => {
                            // Group allRows by SKU
                            const skuGroupMap: Record<string, { sku: string; name: string; locationCode: string; locationId?: string; lotNo?: string; expireDate?: string; totalQty: number; rows: ReplenRow[] }> = {};
                            allRows.forEach((row) => {
                              const k = row.item.sku;
                              if (!skuGroupMap[k]) skuGroupMap[k] = { sku: row.item.sku, name: row.item.name, locationCode: row.item.locationCode || "", locationId: row.item.locationId, lotNo: row.item.lotNo, expireDate: row.item.expireDate, totalQty: 0, rows: [] };
                              skuGroupMap[k].totalQty += row.item.qty;
                              skuGroupMap[k].rows.push(row);
                            });
                            const skuGroups = Object.values(skuGroupMap);
                            return (
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs border-collapse">
                                  <thead>
                                    <tr className="bg-amber-50/70 border-b border-amber-100">
                                      <th className="px-3 py-2 text-left font-semibold text-amber-700">SKU</th>
                                      <th className="px-3 py-2 text-left font-semibold text-amber-700">Product</th>
                                      <th className="px-3 py-2 text-left font-semibold text-amber-700">Current Location</th>
                                      <th className="px-3 py-2 text-left font-semibold text-amber-700">Lot</th>
                                      <th className="px-3 py-2 text-left font-semibold text-amber-700">Expiry</th>
                                      <th className="px-3 py-2 text-right font-semibold text-amber-700 w-14">Total Qty</th>
                                      <th className="px-3 py-2 text-left font-semibold text-amber-700">Bins</th>
                                      <th className="px-3 py-2 w-24"></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {skuGroups.map((grp, gi) => {
                                      const pendingGrpRows = grp.rows.filter((r) => !assignedKeys.has(`${r.clusterId}_${r.bin.binNo}_${r.item.sku}`));
                                      const isGrpDone = pendingGrpRows.length === 0;
                                      const isGrpAssigning = grp.rows.some((r) => assigningKeys.has(`${r.clusterId}_${r.bin.binNo}_${r.item.sku}`));
                                      const grpErrMsgs = grp.rows.map((r) => assignErrors[`${r.clusterId}_${r.bin.binNo}_${r.item.sku}`]).filter(Boolean);
                                      return (
                                        <tr key={grp.sku} className={`border-b border-amber-50 last:border-0 ${isGrpDone ? "bg-emerald-50" : gi % 2 === 0 ? "bg-white" : "bg-amber-50/30"}`}>
                                          <td className="px-3 py-2 font-mono font-bold text-slate-800">{grp.sku}</td>
                                          <td className="px-3 py-2 text-slate-600 max-w-[160px]"><span className="truncate block">{grp.name || "—"}</span></td>
                                          <td className="px-3 py-2 font-mono font-bold text-blue-700">{grp.locationCode || "—"}</td>
                                          <td className="px-3 py-2 font-mono text-slate-500">{grp.lotNo || "—"}</td>
                                          <td className="px-3 py-2 text-slate-500">{grp.expireDate || "—"}</td>
                                          <td className="px-3 py-2 text-right font-black text-slate-900 text-sm">{grp.totalQty}</td>
                                          <td className="px-3 py-2">
                                            <div className="flex flex-wrap gap-1">
                                              {grp.rows.map((r) => (
                                                <div key={r.bin.binNo} className="w-5 h-5 rounded flex items-center justify-center text-xs font-black text-white flex-shrink-0"
                                                  style={{ backgroundColor: binColor(r.bin.binNo) }}>
                                                  {r.bin.binNo}
                                                </div>
                                              ))}
                                            </div>
                                          </td>
                                          <td className="px-3 py-2 text-right">
                                            {isGrpDone ? (
                                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                                                <CheckCircle2 className="w-3.5 h-3.5" /> Done
                                              </span>
                                            ) : (
                                              <div className="flex flex-col items-end gap-0.5">
                                                <button
                                                  onClick={() => openSkuPicker(grp.sku, grp.name, pendingGrpRows, pendingGrpRows[0]?.bin.customerCode ?? "")}
                                                  disabled={isGrpAssigning}
                                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors whitespace-nowrap"
                                                >
                                                  {isGrpAssigning ? <Loader2 className="w-3 h-3 animate-spin" /> : <PackageCheck className="w-3 h-3" />}
                                                  Assign ({pendingGrpRows.length})
                                                </button>
                                                {grpErrMsgs.length > 0 && <span className="text-xs text-red-500 max-w-[100px] text-right leading-tight">{grpErrMsgs[0]}</span>}
                                              </div>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })()}

                    {/* Bin list */}
                    <div className="px-5 py-3 border-b border-slate-100">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Bins ({cluster.bins.length})</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {cluster.bins.map((bin) => (
                          <div key={bin.binNo}
                            className={`flex items-start gap-2 p-2.5 rounded-xl border ${bin.needsReplenishment ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-slate-50"}`}>
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                              style={{ backgroundColor: binColor(bin.binNo) }}>
                              {bin.binNo}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-mono text-xs font-bold text-slate-700 truncate">{bin.orderNo || bin.orderCode}</p>
                              {bin.consigneeName && <p className="text-xs text-slate-400 truncate">{bin.consigneeName}</p>}
                              {bin.needsReplenishment ? (
                                <div className="mt-1 space-y-0.5">
                                  {bin.replenishmentItems && bin.replenishmentItems.length > 0
                                    ? bin.replenishmentItems.map((ri, ri_i) => (
                                        <p key={ri_i} className="text-xs text-amber-700 font-mono flex items-center gap-1">
                                          <span className="font-bold">{ri.sku}</span>
                                          <span className="text-amber-500">×{ri.qty}</span>
                                          {ri.locationCode && <span className="text-slate-400">@ {ri.locationCode}</span>}
                                        </p>
                                      ))
                                    : <p className="text-xs font-semibold text-amber-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Replenishment needed</p>
                                  }
                                </div>
                              ) : (
                                <p className="text-xs text-slate-400">{bin.items.length} item{bin.items.length !== 1 ? "s" : ""}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Location group list */}
                    <div className="px-5 py-3">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Pick Route ({cluster.locationGroups.length} locations)</p>
                      <div className="space-y-1.5">
                        {cluster.locationGroups.map((grp, idx) => (
                          <div key={grp.locationCode} className="flex items-start gap-3 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                            <span className="text-xs font-bold text-slate-400 w-5 flex-shrink-0 mt-0.5">{idx + 1}</span>
                            <span className="font-mono text-sm font-bold text-slate-800 flex-shrink-0">{grp.locationCode}</span>
                            <div className="flex flex-wrap gap-1">
                              {grp.tasks.map((t, ti) => (
                                <span key={ti} className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md font-medium"
                                  style={{ backgroundColor: `${binColor(t.binNo)}20`, color: binColor(t.binNo) }}>
                                  Bin {t.binNo} · {t.sku} ×{t.qty}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Shelf location picker modal ── */}
      {pickerOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <div>
                <p className="text-sm font-bold text-slate-900">Select Shelf Location</p>
                <p className="text-xs text-slate-500 mt-0.5 font-mono">{pickerSku}{pickerSkuName ? ` · ${pickerSkuName}` : ""}</p>
              </div>
              <button onClick={() => setPickerOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Bin summary */}
            {pickerRows.length > 0 && (
              <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-100 flex flex-shrink-0 gap-1.5 flex-wrap">
                {pickerRows.map((r) => (
                  <div key={r.bin.binNo}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: binColor(r.bin.binNo) }}>
                    Bin {r.bin.binNo} <span className="opacity-75">×{r.item.qty}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Stock list */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
              {pickerLoading ? (
                <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Loading shelf locations…</span>
                </div>
              ) : pickerStock.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-400">
                  <AlertCircle className="w-5 h-5 text-amber-400" />
                  <p className="text-sm font-medium text-slate-600">No shelf stock available for this SKU</p>
                  <p className="text-xs text-slate-400">Complete replenishment first, then re-assign</p>
                </div>
              ) : (
                pickerStock.map((s, idx) => {
                  const loc = readableLocation(s);
                  const isSelected = pickerSelectedIdx === idx;
                  const occupancy = getLocationOccupancyInfo(occupancyMap, s);
                  const zone = classifyOccupancy(occupancy ?? "");
                  return (
                    <button key={idx} onClick={() => setPickerSelectedIdx(idx)}
                      className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${isSelected ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${isSelected ? "border-blue-500" : "border-slate-300"}`}>
                          {isSelected && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm font-bold text-slate-900">{loc}</span>
                            {zone === "shelf" && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Shelf</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                            {s.lotNo ? <span>Lot: <span className="font-mono">{String(s.lotNo)}</span></span> : null}
                            {s.expireDate ? <span>Exp: {String(s.expireDate)}</span> : null}
                            <span className="font-semibold text-slate-700">Avail: {String(s.availQty ?? 0)}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-3 flex-shrink-0">
              <button onClick={() => setPickerOpen(false)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
                Cancel
              </button>
              <button
                onClick={confirmSkuPicker}
                disabled={pickerLoading || pickerStock.length === 0 || pickerConfirming}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {pickerConfirming ? <><Loader2 className="w-4 h-4 animate-spin" /> Assigning…</> : <><PackageCheck className="w-4 h-4" /> Assign {pickerRows.length} bin{pickerRows.length !== 1 ? "s" : ""}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pre-cluster replen plan picker modal ── */}
      {replenPickerOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <div>
                <p className="text-sm font-bold text-slate-900">Select Source Location</p>
                <p className="text-xs text-slate-500 mt-0.5 font-mono">{replenPickerSku}{replenPickerName ? ` · ${replenPickerName}` : ""}</p>
                <p className="text-xs text-slate-400 mt-0.5">{replenPickerOrderCount} order{replenPickerOrderCount !== 1 ? "s" : ""} need replenishment</p>
              </div>
              <button onClick={() => setReplenPickerOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
              {replenPickerLoading ? (
                <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Loading available stock…</span>
                </div>
              ) : replenPickerStock.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-400">
                  <AlertCircle className="w-5 h-5 text-amber-400" />
                  <p className="text-sm font-medium text-slate-600">No available stock found</p>
                </div>
              ) : (
                replenPickerStock.map((s, idx) => {
                  const loc = readableLocation(s);
                  const isSelected = replenPickerSelectedIdx === idx;
                  const occupancy = getLocationOccupancyInfo(occupancyMap, s);
                  const zone = classifyOccupancy(occupancy ?? "");
                  return (
                    <button key={idx} onClick={() => setReplenPickerSelectedIdx(idx)}
                      className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${isSelected ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${isSelected ? "border-blue-500" : "border-slate-300"}`}>
                          {isSelected && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm font-bold text-slate-900">{loc}</span>
                            {zone === "shelf" && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Shelf</span>
                            )}
                            {zone === "storage" && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Storage</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                            {s.lotNo ? <span>Lot: <span className="font-mono">{String(s.lotNo)}</span></span> : null}
                            {s.expireDate ? <span>Exp: {String(s.expireDate)}</span> : null}
                            <span className="font-semibold text-slate-700">Avail: {String(s.availQty ?? 0)}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-3 flex-shrink-0">
              <button onClick={() => setReplenPickerOpen(false)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
                Cancel
              </button>
              <button
                onClick={confirmReplenPicker}
                disabled={replenPickerLoading || replenPickerStock.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                <MapPin className="w-4 h-4" /> Select This Location
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Creating progress overlay ── */}
      {creating && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              <h3 className="text-base font-bold text-slate-900">Creating Cluster…</h3>
            </div>
            <p className="text-sm text-slate-600 min-h-[2.5rem] leading-relaxed">{createStep}</p>
            {createError && (
              <div className="mt-3 flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-xl p-3">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                {createError}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Order selection ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide">Select B2C Orders</h2>
            {!loadingOrders && orders.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
                  {filteredOrders.length} orders
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">
                  Total Qty: {totalFilteredQty.toLocaleString()}
                </span>
                {hasColFilter && (
                  <button onClick={() => setColFilter({ orderCode: "", customer: "", consignee: "", qty: "", date: "" })}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors border border-slate-200">
                    <X className="w-3 h-3" /> Clear filters
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {checkRunning && (
              <span className="text-xs text-slate-400 tabular-nums">
                {checkProgress.done} / {checkProgress.total}
              </span>
            )}
            {checkedAt && !checkRunning && (
              <span className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-md whitespace-nowrap">
                Checked {new Date(checkedAt).toLocaleString()}
              </span>
            )}
            <button
              onClick={() => runClusterCheck(!!checkedAt)}
              disabled={loadingOrders || filteredOrders.length === 0}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors disabled:opacity-40 ${checkRunning ? "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              {checkRunning
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Stop</>
                : checkedAt
                  ? <><RefreshCw className="w-3.5 h-3.5" /> Refresh</>
                  : <><Search className="w-3.5 h-3.5" /> Check</>}
            </button>
            {selectedList.length > 0 && (
              <span className="text-xs text-slate-500">{selectedList.length} / {MAX_BINS} selected</span>
            )}
            <button
              onClick={createCluster}
              disabled={!canCreate || creating}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Cluster {selectedList.length > 0 ? `(${selectedList.length})` : ""}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <select value={warehouseCode} onChange={(e) => setWarehouseCode(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {warehouses.map((w) => <option key={w.code} value={w.code}>{w.name || w.code}</option>)}
            {warehouses.length === 0 && <option value="STOO1">STOO1</option>}
          </select>
          <select value={selectedCustomer} onChange={(e) => setSelectedCustomer(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Customers</option>
            {customers.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
          </select>
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search order, customer, consignee…"
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {search && <button onClick={() => setSearch("")} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>}
          </div>
          <button onClick={loadOrders} disabled={loadingOrders}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-sm transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${loadingOrders ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Order table */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-4 py-3 w-10">
                  <input type="checkbox"
                    checked={filteredOrders.slice(0, MAX_BINS).length > 0 && filteredOrders.slice(0, MAX_BINS).every((o) => selectedCodes[orderCodeOf(o)])}
                    onChange={toggleAll}
                    className="accent-blue-600 w-4 h-4" />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Order Code</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Customer</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Consignee</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide w-16">Qty</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide w-28">Date</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-400 uppercase tracking-wide w-24">Status</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-blue-500 uppercase tracking-wide w-20">Cluster</th>
              </tr>
              <tr className="bg-white border-b border-slate-100">
                <th />
                <th className="px-3 py-1.5">
                  <input value={colFilter.orderCode} onChange={(e) => setCol("orderCode", e.target.value)}
                    placeholder="Filter…"
                    className="w-full border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400 font-normal" />
                </th>
                <th className="px-3 py-1.5">
                  <input value={colFilter.customer} onChange={(e) => setCol("customer", e.target.value)}
                    placeholder="Filter…"
                    className="w-full border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400 font-normal" />
                </th>
                <th className="px-3 py-1.5">
                  <input value={colFilter.consignee} onChange={(e) => setCol("consignee", e.target.value)}
                    placeholder="Filter…"
                    className="w-full border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400 font-normal" />
                </th>
                <th className="px-3 py-1.5">
                  <input value={colFilter.qty} onChange={(e) => setCol("qty", e.target.value)}
                    placeholder="≥"
                    type="number" min={0}
                    className="w-full border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400 font-normal text-right" />
                </th>
                <th className="px-3 py-1.5">
                  <input value={colFilter.date} onChange={(e) => setCol("date", e.target.value)}
                    placeholder="e.g. 2026-06"
                    className="w-full border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400 font-normal" />
                </th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {loadingOrders && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                  Loading orders…
                </td></tr>
              )}
              {!loadingOrders && filteredOrders.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400 text-sm">No Out-Bound Request orders found</td></tr>
              )}
              {filteredOrders.map((o, i) => {
                const code = orderCodeOf(o);
                const isSelected = !!selectedCodes[code];
                const isOver = !isSelected && selectedList.length >= MAX_BINS;
                return (
                  <tr key={code}
                    onClick={() => !isOver && toggleSelect(code)}
                    className={`border-b border-slate-50 last:border-0 transition-colors ${isOver ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:bg-slate-50"} ${isSelected ? "bg-blue-50" : ""}`}>
                    <td className="px-4 py-2.5">
                      <input type="checkbox" checked={isSelected} readOnly disabled={isOver}
                        className="accent-blue-600 w-4 h-4 cursor-pointer" />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {isSelected && (
                          <span className="w-5 h-5 rounded flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                            style={{ backgroundColor: binColor(selectedList.findIndex((s) => orderCodeOf(s) === code) + 1) }}>
                            {selectedList.findIndex((s) => orderCodeOf(s) === code) + 1}
                          </span>
                        )}
                        <span className="font-mono text-xs font-bold text-slate-700">{code}</span>
                      </div>
                      {!!o.shippingOrderNo && <p className="font-mono text-xs text-slate-400 mt-0.5">{String(o.shippingOrderNo)}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 text-xs">{String(o.customerName ?? o.customerCode ?? "")}</td>
                    <td className="px-4 py-2.5 text-slate-600 text-xs">{String(o.consigneeName ?? "")}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-700">{String(o.totalQty ?? o.qty ?? "")}</td>
                    <td className="px-4 py-2.5 text-slate-400 text-xs">{String(o.orderDate ?? "")}</td>
                    <td className="px-4 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const st = String(o.status ?? o.orderStatus ?? "");
                        if (!st) return null;
                        const STATUS_LABEL: Record<string, string> = {
                          AA: "Out-Bound Request", CA: "Packing Request", DA: "Packing Complete",
                          AR: "Auto Label Request", AC: "Auto Label Complete",
                          LR: "Twinny Packing Req", LC: "Twinny Packing Done",
                          HA: "Hold", CC: "Cancelled", FA: "Complete",
                        };
                        const STATUS_COLOR: Record<string, string> = {
                          AA: "bg-yellow-50 text-yellow-700",
                          CA: "bg-blue-50 text-blue-700",
                          DA: "bg-cyan-50 text-cyan-700",
                          AR: "bg-violet-50 text-violet-700",
                          AC: "bg-indigo-50 text-indigo-700",
                          LR: "bg-amber-50 text-amber-700",
                          LC: "bg-teal-50 text-teal-700",
                          HA: "bg-red-50 text-red-700",
                          CC: "bg-slate-100 text-slate-500",
                          FA: "bg-green-50 text-green-700",
                        };
                        const label = STATUS_LABEL[st] ?? st;
                        const color = STATUS_COLOR[st] ?? "bg-slate-100 text-slate-600";
                        return (
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${color}`}>
                            {label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                      {checkResults[code] === "checking" && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 mx-auto" />}
                      {checkResults[code] === "yes" && (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700">Y</span>
                      )}
                      {checkResults[code] === "no" && (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-600">N</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Replenishment SKU summary */}
        {replenSkus.length > 0 && (
          <div className="mt-4 bg-white border border-red-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-red-50 border-b border-red-100 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                <span className="text-xs font-bold text-red-700 uppercase tracking-wide">
                  Replenishment Required — {replenSkus.length} SKU{replenSkus.length !== 1 ? "s" : ""} blocking cluster eligibility
                </span>
              </div>
              <button
                onClick={printReplenPlan}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors flex-shrink-0"
              >
                <Tag className="w-3.5 h-3.5" /> Print Tickets ({replenSkus.length})
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-red-50/50 border-b border-red-100">
                    <th className="px-4 py-2 text-left font-semibold text-red-700">SKU</th>
                    <th className="px-4 py-2 text-left font-semibold text-red-700">Product</th>
                    <th className="px-4 py-2 text-center font-semibold text-red-700 w-24">Orders blocked</th>
                    <th className="px-4 py-2 text-left font-semibold text-red-700">Replen Plan</th>
                  </tr>
                </thead>
                <tbody>
                  {replenSkus.map((r, i) => {
                    const selected = replenSelectedLocs[r.sku];
                    return (
                      <tr key={r.sku} className={`border-b border-red-50 last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-red-50/20"}`}>
                        <td className="px-4 py-2 font-mono font-bold text-slate-800">{r.sku}</td>
                        <td className="px-4 py-2 text-slate-600 max-w-[200px]"><span className="truncate block">{r.name || "—"}</span></td>
                        <td className="px-4 py-2 text-center">
                          <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-600">{r.orderCount}</span>
                        </td>
                        <td className="px-4 py-2">
                          {selected ? (
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                {readableLocation(selected.stock)}
                              </span>
                              <button
                                onClick={() => openReplenPicker(r.sku, r.name, r.custCode, r.orderCount)}
                                className="text-xs text-slate-400 hover:text-slate-600 underline"
                              >
                                Change
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => openReplenPicker(r.sku, r.name, r.custCode, r.orderCount)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
                            >
                              <MapPin className="w-3 h-3" /> Select Location
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
