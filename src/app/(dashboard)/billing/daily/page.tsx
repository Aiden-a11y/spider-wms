"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Plus, Trash2, Pencil, Check, X, TrendingUp, TrendingDown,
  Users, Clock, DollarSign, ChevronLeft, ChevronRight, Loader2,
} from "lucide-react";

/* ─── types ─────────────────────────────────────────────────── */
interface Worker {
  id: string;
  work_date: string;
  worker_name: string;
  hours_worked: number;
  hourly_rate: number;
  notes: string | null;
}
interface RevenueRow {
  work_date: string;
  revenue: number;
  notes: string | null;
}

/* ─── helpers ────────────────────────────────────────────────── */
const fmt  = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toISO = (d: Date)  => d.toISOString().slice(0, 10);
const addDay = (iso: string, n: number) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return toISO(d);
};
const fmtDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

/* ─── empty form state ───────────────────────────────────────── */
const emptyForm = () => ({ worker_name: "", hours_worked: "8", hourly_rate: "17", notes: "" });

export default function DailyInvoicePage() {
  const [date,    setDate]    = useState(toISO(new Date()));
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [revenue, setRevenue] = useState<RevenueRow | null>(null);
  const [loading, setLoading] = useState(false);

  /* form state */
  const [showForm,  setShowForm]  = useState(false);
  const [editId,    setEditId]    = useState<string | null>(null);
  const [form,      setForm]      = useState(emptyForm());
  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState<string | null>(null);

  /* revenue edit */
  const [revEdit,   setRevEdit]   = useState(false);
  const [revInput,  setRevInput]  = useState("");
  const [revSaving, setRevSaving] = useState(false);

  /* ─── load ─────────────────────────────────────────────────── */
  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/daily-labor?date=${date}`);
    const json = await res.json();
    setWorkers(json.workers ?? []);
    setRevenue(json.revenue ?? null);
    setRevInput(json.revenue?.revenue?.toString() ?? "");
    setLoading(false);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  /* ─── derived ───────────────────────────────────────────────── */
  const totalHours   = useMemo(() => workers.reduce((s, w) => s + Number(w.hours_worked), 0), [workers]);
  const totalLabor   = useMemo(() => workers.reduce((s, w) => s + Number(w.hours_worked) * Number(w.hourly_rate), 0), [workers]);
  const rev          = revenue ? Number(revenue.revenue) : null;
  const profit       = rev !== null ? rev - totalLabor : null;
  const margin       = rev && rev > 0 ? (profit! / rev) * 100 : null;

  /* ─── save worker ────────────────────────────────────────────── */
  async function saveWorker() {
    if (!form.worker_name.trim()) return;
    setSaving(true);
    await fetch("/api/daily-labor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id:           editId ?? undefined,
        work_date:    date,
        worker_name:  form.worker_name.trim(),
        hours_worked: parseFloat(form.hours_worked) || 0,
        hourly_rate:  parseFloat(form.hourly_rate)  || 0,
        notes:        form.notes.trim() || null,
      }),
    });
    setSaving(false);
    setShowForm(false);
    setEditId(null);
    setForm(emptyForm());
    load();
  }

  /* ─── delete worker ──────────────────────────────────────────── */
  async function deleteWorker(id: string) {
    setDeleting(id);
    await fetch(`/api/daily-labor?id=${id}`, { method: "DELETE" });
    setDeleting(null);
    load();
  }

  /* ─── save revenue ───────────────────────────────────────────── */
  async function saveRevenue() {
    setRevSaving(true);
    await fetch("/api/daily-labor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "revenue", work_date: date, revenue: parseFloat(revInput) || 0 }),
    });
    setRevSaving(false);
    setRevEdit(false);
    load();
  }

  /* ─── start edit ─────────────────────────────────────────────── */
  function startEdit(w: Worker) {
    setEditId(w.id);
    setForm({ worker_name: w.worker_name, hours_worked: String(w.hours_worked), hourly_rate: String(w.hourly_rate), notes: w.notes ?? "" });
    setShowForm(true);
  }

  /* ─── UI ─────────────────────────────────────────────────────── */
  return (
    <div className="p-8 max-w-5xl mx-auto">

      {/* ── Date nav ── */}
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => setDate(d => addDay(d, -1))} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500">
          <ChevronLeft className="w-4 h-4"/>
        </button>
        <div>
          <h1 className="text-xl font-bold text-slate-900">{fmtDate(date)}</h1>
          <p className="text-sm text-slate-400">Daily Labor Invoice</p>
        </div>
        <button onClick={() => setDate(d => addDay(d, 1))} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500">
          <ChevronRight className="w-4 h-4"/>
        </button>
        <input
          type="date" value={date} onChange={e => setDate(e.target.value)}
          className="ml-2 px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <button onClick={() => setDate(toISO(new Date()))} className="text-xs text-blue-600 hover:underline">Today</button>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400 ml-auto"/>}
      </div>

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {/* Workers */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
              <Users className="w-4 h-4 text-blue-600"/>
            </div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Workers</p>
          </div>
          <p className="text-3xl font-black text-slate-900">{workers.length}</p>
          <p className="text-xs text-slate-400 mt-1">people today</p>
        </div>

        {/* Total hours */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-violet-50 rounded-lg flex items-center justify-center">
              <Clock className="w-4 h-4 text-violet-600"/>
            </div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Total Hours</p>
          </div>
          <p className="text-3xl font-black text-slate-900">{totalHours.toFixed(1)}</p>
          <p className="text-xs text-slate-400 mt-1">hours worked</p>
        </div>

        {/* Labor cost */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-orange-50 rounded-lg flex items-center justify-center">
              <DollarSign className="w-4 h-4 text-orange-600"/>
            </div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Labor Cost</p>
          </div>
          <p className="text-3xl font-black text-slate-900">${fmt(totalLabor)}</p>
          <p className="text-xs text-slate-400 mt-1">total payroll</p>
        </div>

        {/* Profit / Loss */}
        <div className={`rounded-xl border p-5 ${
          profit === null ? "bg-white border-slate-200" :
          profit >= 0    ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
        }`}>
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              profit === null ? "bg-slate-100" : profit >= 0 ? "bg-green-100" : "bg-red-100"
            }`}>
              {profit === null
                ? <DollarSign className="w-4 h-4 text-slate-400"/>
                : profit >= 0
                  ? <TrendingUp className="w-4 h-4 text-green-600"/>
                  : <TrendingDown className="w-4 h-4 text-red-600"/>
              }
            </div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Profit / Loss</p>
          </div>
          {profit !== null ? (
            <>
              <p className={`text-3xl font-black ${profit >= 0 ? "text-green-700" : "text-red-700"}`}>
                {profit >= 0 ? "+" : ""}${fmt(profit)}
              </p>
              <p className={`text-xs mt-1 font-medium ${profit >= 0 ? "text-green-600" : "text-red-600"}`}>
                {margin !== null ? `${margin.toFixed(1)}% margin` : ""}
              </p>
            </>
          ) : (
            <>
              <p className="text-3xl font-black text-slate-300">—</p>
              <p className="text-xs text-slate-400 mt-1">enter revenue below</p>
            </>
          )}
        </div>
      </div>

      {/* ── Revenue input ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <div className="flex items-center gap-4">
          <p className="text-sm font-semibold text-slate-700 w-32 flex-shrink-0">Daily Revenue</p>
          {revEdit ? (
            <div className="flex items-center gap-2 flex-1">
              <span className="text-slate-500 font-medium">$</span>
              <input
                type="number" step="0.01" min="0"
                value={revInput} onChange={e => setRevInput(e.target.value)}
                onKeyDown={e => { if (e.key==="Enter") saveRevenue(); if (e.key==="Escape") setRevEdit(false); }}
                autoFocus
                className="w-40 px-3 py-1.5 text-sm border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="0.00"
              />
              <button onClick={saveRevenue} disabled={revSaving} className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-500">
                {revSaving ? <Loader2 className="w-3 h-3 animate-spin"/> : <Check className="w-3 h-3"/>} Save
              </button>
              <button onClick={() => { setRevEdit(false); setRevInput(revenue?.revenue?.toString() ?? ""); }} className="p-1.5 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4"/>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-1">
              <span className="text-lg font-bold text-slate-900">
                {rev !== null ? `$${fmt(rev)}` : <span className="text-slate-300 font-normal text-sm">Not set</span>}
              </span>
              <button onClick={() => setRevEdit(true)} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                <Pencil className="w-3 h-3"/> {rev !== null ? "Edit" : "Set revenue"}
              </button>
            </div>
          )}
          {rev !== null && (
            <div className="ml-auto text-right text-xs text-slate-400">
              Labor cost: <span className="font-semibold text-slate-700">${fmt(totalLabor)}</span>
              {" → "}
              <span className={`font-bold ${profit! >= 0 ? "text-green-600" : "text-red-600"}`}>
                {profit! >= 0 ? "PROFIT" : "LOSS"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Worker table ── */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">Workers</h2>
          <button
            onClick={() => { setEditId(null); setForm(emptyForm()); setShowForm(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-500 transition-colors"
          >
            <Plus className="w-3.5 h-3.5"/> Add Worker
          </button>
        </div>

        {workers.length === 0 && !showForm ? (
          <div className="py-16 text-center">
            <Users className="w-8 h-8 text-slate-200 mx-auto mb-3"/>
            <p className="text-slate-400 text-sm">No workers recorded for this day.</p>
            <button onClick={() => { setEditId(null); setForm(emptyForm()); setShowForm(true); }} className="mt-3 text-blue-600 text-sm hover:underline">+ Add first worker</button>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                <th className="text-left px-6 py-3 font-semibold">Name</th>
                <th className="text-right px-4 py-3 font-semibold">Hours</th>
                <th className="text-right px-4 py-3 font-semibold">Rate / hr</th>
                <th className="text-right px-4 py-3 font-semibold">Pay</th>
                <th className="text-left px-4 py-3 font-semibold">Notes</th>
                <th className="px-4 py-3"/>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {workers.map(w => (
                <tr key={w.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-3.5 font-medium text-slate-800">{w.worker_name}</td>
                  <td className="px-4 py-3.5 text-right font-mono text-slate-700">{Number(w.hours_worked).toFixed(1)}</td>
                  <td className="px-4 py-3.5 text-right font-mono text-slate-700">${Number(w.hourly_rate).toFixed(2)}</td>
                  <td className="px-4 py-3.5 text-right font-mono font-semibold text-slate-900">${fmt(Number(w.hours_worked)*Number(w.hourly_rate))}</td>
                  <td className="px-4 py-3.5 text-sm text-slate-400">{w.notes ?? "—"}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => startEdit(w)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                        <Pencil className="w-3.5 h-3.5"/>
                      </button>
                      <button onClick={() => deleteWorker(w.id)} disabled={deleting===w.id} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        {deleting===w.id ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Trash2 className="w-3.5 h-3.5"/>}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {/* Totals row */}
              {workers.length > 0 && (
                <tr className="bg-slate-50 font-semibold text-slate-700 border-t-2 border-slate-200">
                  <td className="px-6 py-3 text-sm">Total ({workers.length} workers)</td>
                  <td className="px-4 py-3 text-right font-mono">{totalHours.toFixed(1)}</td>
                  <td className="px-4 py-3 text-right text-slate-400 text-sm">avg ${workers.length ? (totalLabor/totalHours||0).toFixed(2) : "0.00"}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">${fmt(totalLabor)}</td>
                  <td colSpan={2}/>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {/* ── Inline add/edit form ── */}
        {showForm && (
          <div className="border-t border-slate-200 bg-blue-50 px-6 py-4">
            <p className="text-sm font-semibold text-slate-700 mb-3">{editId ? "Edit Worker" : "Add Worker"}</p>
            <div className="flex items-end gap-3 flex-wrap">
              <div className="flex-1 min-w-40">
                <label className="text-xs text-slate-500 font-medium mb-1 block">Name *</label>
                <input
                  type="text" placeholder="Worker name"
                  value={form.worker_name} onChange={e => setForm(f => ({ ...f, worker_name: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
                />
              </div>
              <div className="w-28">
                <label className="text-xs text-slate-500 font-medium mb-1 block">Hours</label>
                <input
                  type="number" step="0.5" min="0" max="24"
                  value={form.hours_worked} onChange={e => setForm(f => ({ ...f, hours_worked: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
                />
              </div>
              <div className="w-32">
                <label className="text-xs text-slate-500 font-medium mb-1 block">Rate / hr ($)</label>
                <input
                  type="number" step="0.01" min="0"
                  value={form.hourly_rate} onChange={e => setForm(f => ({ ...f, hourly_rate: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
                />
              </div>
              <div className="flex-1 min-w-32">
                <label className="text-xs text-slate-500 font-medium mb-1 block">Notes</label>
                <input
                  type="text" placeholder="Optional"
                  value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
                />
              </div>
              <div className="flex items-center gap-2 pb-0.5">
                <div className="text-right text-xs text-slate-400 mr-1">
                  Pay: <span className="font-bold text-slate-700">${fmt((parseFloat(form.hours_worked)||0)*(parseFloat(form.hourly_rate)||0))}</span>
                </div>
                <button
                  onClick={saveWorker} disabled={saving || !form.worker_name.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-500 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Check className="w-3.5 h-3.5"/>}
                  {editId ? "Update" : "Add"}
                </button>
                <button
                  onClick={() => { setShowForm(false); setEditId(null); setForm(emptyForm()); }}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg"
                >
                  <X className="w-4 h-4"/>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── SQL hint (only shown if no data ever) ── */}
      {workers.length === 0 && (
        <details className="mt-6">
          <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">Supabase setup — run once</summary>
          <pre className="mt-2 text-xs bg-slate-900 text-green-400 rounded-xl p-4 overflow-x-auto">{`CREATE TABLE daily_labor (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date    DATE NOT NULL,
  worker_name  TEXT NOT NULL,
  hours_worked NUMERIC(5,2)  NOT NULL DEFAULT 0,
  hourly_rate  NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON daily_labor(work_date DESC);

CREATE TABLE daily_revenue (
  work_date  DATE PRIMARY KEY,
  revenue    NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`}</pre>
        </details>
      )}
    </div>
  );
}
