"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import {
  SlidersHorizontal,
  RefreshCw,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  buildDefaultLineItems,
  applyRateMaster,
  formatUSD,
  type BillingLineItem,
  type CustomerRateMaster,
} from "@/lib/billing-calc";
import {
  BILLING_CATEGORIES,
  RATE_VERSION,
} from "@/lib/billing-rates";
import type { BillingCategory } from "@/lib/billing-rates";

const CATEGORY_COLOR: Record<BillingCategory, string> = {
  "Inbound Handling":  "bg-blue-50 border-blue-200 text-blue-800",
  "Storage":           "bg-purple-50 border-purple-200 text-purple-800",
  "Fulfillment B2B":   "bg-emerald-50 border-emerald-200 text-emerald-800",
  "Fulfillment B2C":   "bg-teal-50 border-teal-200 text-teal-800",
  "Return Management": "bg-orange-50 border-orange-200 text-orange-800",
  "Warehouse Labor":   "bg-red-50 border-red-200 text-red-800",
};

const DEFAULT_ITEMS = buildDefaultLineItems();

export default function RateMasterPage() {
  const { user } = useAuth();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  // ── state ──
  const [customers, setCustomers] = useState<{ code: string; name: string }[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [selectedCustomerName, setSelectedCustomerName] = useState("");

  // rates[itemId] = custom rate value (or undefined = use default)
  const [rates, setRates] = useState<Record<string, number>>({});
  const [hasMaster, setHasMaster] = useState(false);
  const [masterUpdatedAt, setMasterUpdatedAt] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [collapsed, setCollapsed] = useState<Set<BillingCategory>>(new Set());
  const [loadingMaster, setLoadingMaster] = useState(false);

  // ── fetch customer list ──
  useEffect(() => {
    fetch("/api/wms/combo/customer-by-ordertype/B2B?warehouseCode=", { headers })
      .then((r) => r.json())
      .then((j) => {
        const list = j?.data ?? j ?? [];
        if (Array.isArray(list)) {
          setCustomers(
            list.map((c: Record<string, unknown>) => ({
              code: String(c.customerCode ?? c.code ?? ""),
              name: String(c.customerName ?? c.name ?? ""),
            }))
          );
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── fetch rate master when customer changes ──
  const loadMaster = useCallback(async (customerCode: string) => {
    if (!customerCode) return;
    setLoadingMaster(true);
    setHasMaster(false);
    setMasterUpdatedAt("");
    try {
      const res = await fetch(`/api/billing/rates?customer=${encodeURIComponent(customerCode)}`);
      if (res.ok) {
        const data: CustomerRateMaster | null = await res.json();
        if (data) {
          setRates(data.rates);
          setHasMaster(true);
          setMasterUpdatedAt(data.updatedAt);
        } else {
          setRates({});
        }
      }
    } finally {
      setLoadingMaster(false);
    }
  }, []);

  function handleSelectCustomer(code: string) {
    setSelectedCustomer(code);
    setSelectedCustomerName(customers.find((c) => c.code === code)?.name ?? "");
    setRates({});
    setSaveOk(false);
    setSaveError("");
    loadMaster(code);
  }

  // ── current line items with overrides applied ──
  const currentItems: BillingLineItem[] = applyRateMaster(DEFAULT_ITEMS, rates);

  // ── update a single rate ──
  function updateRate(id: string, raw: string) {
    const v = raw === "" ? undefined : parseFloat(raw);
    setRates((prev) => {
      const next = { ...prev };
      if (v === undefined || isNaN(v)) {
        delete next[id];
      } else {
        next[id] = v;
      }
      return next;
    });
    setSaveOk(false);
  }

  // ── reset to defaults ──
  function resetToDefault() {
    setRates({});
    setSaveOk(false);
    setSaveError("");
  }

  // ── save ──
  async function saveMaster() {
    if (!selectedCustomer) return;
    setSaving(true);
    setSaveOk(false);
    setSaveError("");
    try {
      const payload: CustomerRateMaster = {
        customerCode: selectedCustomer,
        customerName: selectedCustomerName,
        rates,
        updatedAt: new Date().toISOString(),
      };
      const res = await fetch("/api/billing/rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      setHasMaster(true);
      setMasterUpdatedAt(payload.updatedAt);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 3000);
    } catch (e) {
      setSaveError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  function toggleCollapse(cat: BillingCategory) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-5xl">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <SlidersHorizontal className="w-6 h-6 text-slate-400" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900">Rate Master</h1>
          <p className="text-slate-400 text-xs mt-0.5">Set custom rates per customer. Saved rates are automatically applied when creating invoices.</p>
        </div>
      </div>

      {/* Customer selector */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm mb-6">
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <label className="text-xs text-slate-500 uppercase tracking-wide mb-1.5 block">
              Customer
            </label>
            <select
              value={selectedCustomer}
              onChange={(e) => handleSelectCustomer(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Select a customer —</option>
              {customers.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>
          {selectedCustomer && (
            <div className="text-xs text-slate-400 pb-2.5">
              {loadingMaster ? (
                <span className="flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Loading…
                </span>
              ) : hasMaster ? (
                <span className="text-emerald-600">
                  ✓ Rate master saved ({new Date(masterUpdatedAt).toLocaleDateString("en-US")})
                </span>
              ) : (
                <span className="text-slate-400">Showing default rates (no master saved)</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Rate table (only shown when customer selected) */}
      {selectedCustomer && !loadingMaster && (
        <>
          <div className="space-y-3 mb-6">
            {BILLING_CATEGORIES.map((cat) => {
              const catItems = currentItems.filter((i) => i.category === cat);
              const isOpen = !collapsed.has(cat);
              return (
                <div
                  key={cat}
                  className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden"
                >
                  {/* Category header */}
                  <button
                    onClick={() => toggleCollapse(cat)}
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors"
                  >
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${CATEGORY_COLOR[cat]}`}>
                      {cat}
                    </span>
                    <span className="flex-1" />
                    {isOpen ? (
                      <ChevronUp className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    )}
                  </button>

                  {/* Rate rows */}
                  {isOpen && (
                    <div className="border-t border-slate-100">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-100">
                            <th className="px-5 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Description</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide w-36">Unit</th>
                            <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide w-32">Default Rate</th>
                            <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide w-36">Custom Rate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {catItems.map((item) => {
                            const defaultItem = DEFAULT_ITEMS.find((d) => d.id === item.id);
                            const defaultRate = defaultItem?.rate ?? 0;
                            const customRate = rates[item.id];
                            const isCustomized = customRate !== undefined;

                            return (
                              <tr
                                key={item.id}
                                className={`border-b border-slate-50 last:border-0 ${isCustomized ? "bg-amber-50/40" : ""}`}
                              >
                                <td className="px-5 py-2.5 text-slate-700">
                                  {item.description}
                                  {isCustomized && (
                                    <span className="ml-2 text-xs text-amber-600 font-medium">custom</span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-slate-500 text-xs">{item.unit}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums text-slate-400 text-xs">
                                  {item.costPlus ? "cost+10%" : formatUSD(defaultRate)}
                                </td>
                                <td className="px-4 py-2.5 text-right">
                                  {item.costPlus ? (
                                    <span className="text-xs text-slate-400 italic">fixed</span>
                                  ) : (
                                    <div className="flex items-center justify-end gap-1">
                                      <span className="text-slate-400 text-xs">$</span>
                                      <input
                                        type="number"
                                        min={0}
                                        step="any"
                                        value={customRate !== undefined ? customRate : ""}
                                        onChange={(e) => updateRate(item.id, e.target.value)}
                                        placeholder={String(defaultRate)}
                                        className="w-24 text-right text-sm tabular-nums border border-slate-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white placeholder:text-slate-300"
                                      />
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Action bar */}
          <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4 shadow-sm">
            <div className="flex items-center gap-3">
              {saveOk && (
                <span className="flex items-center gap-1.5 text-sm text-emerald-600">
                  <CheckCircle2 className="w-4 h-4" />
                  Saved
                </span>
              )}
              {saveError && (
                <span className="flex items-center gap-1.5 text-sm text-red-500">
                  <AlertCircle className="w-4 h-4" />
                  {saveError}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={resetToDefault}
                className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset to Default
              </button>
              <button
                onClick={saveMaster}
                disabled={saving}
                className="flex items-center gap-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-4 py-2 disabled:opacity-50 transition-colors"
              >
                {saving ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          {/* Info note */}
          <p className="text-xs text-slate-400 mt-3 text-right">
            Leave Custom Rate blank to use the default. Base rate version: <span className="font-mono">{RATE_VERSION}</span>
          </p>
        </>
      )}

      {/* Empty state */}
      {!selectedCustomer && (
        <div className="text-center py-20 text-slate-400">
          <SlidersHorizontal className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Select a customer to view and edit their rates.</p>
        </div>
      )}
    </div>
  );
}
