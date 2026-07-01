"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2, AlertTriangle, Info, ChevronDown, ChevronUp,
  Package, Grid3X3, ArrowRight, ChevronRight,
  Printer, Smartphone, FileText, Star, Zap, Monitor, Globe,
} from "lucide-react";

/* ── System badge ──────────────────────────────────────── */

type SystemTag = "dashboard" | "mobile" | "wms";

const SYSTEM_META: Record<SystemTag, { label: string; bg: string; text: string; border: string; Icon: React.ElementType }> = {
  dashboard: { label: "Dashboard",  bg: "bg-blue-50",   text: "text-blue-700",  border: "border-blue-200",  Icon: Monitor   },
  mobile:    { label: "Mobile App", bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", Icon: Smartphone },
  wms:       { label: "WMS",        bg: "bg-amber-50",   text: "text-amber-700",  border: "border-amber-200",  Icon: Globe     },
};

function Tag({ system }: { system: SystemTag }) {
  const m = SYSTEM_META[system];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border ${m.bg} ${m.text} ${m.border}`}>
      <m.Icon className="w-2.5 h-2.5" />
      {m.label}
    </span>
  );
}

/* ── Shared primitives ─────────────────────────────────── */

function Section({ id, number, title, color, icon: Icon, children }: {
  id: string; number: string; title: string;
  color: string; icon: React.ElementType; children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6">
      <div className={`flex items-center gap-3 px-5 py-3 rounded-xl mb-4 ${color}`}>
        <span className="text-lg font-black opacity-50">{number}</span>
        <Icon className="w-5 h-5" />
        <h2 className="text-base font-bold">{title}</h2>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Step({ n, title, systems, children, notice, warn, important }: {
  n: number; title: string; systems?: SystemTag[];
  children: React.ReactNode;
  notice?: string; warn?: string; important?: boolean;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 mt-0.5">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black text-white ${important ? "bg-red-500" : "bg-slate-700"}`}>
          {n}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <p className={`text-sm font-bold ${important ? "text-red-700" : "text-slate-800"}`}>{title}</p>
          {important && (
            <span className="text-xs font-bold px-1.5 py-0.5 bg-red-100 text-red-700 rounded border border-red-200 flex items-center gap-1">
              <Star className="w-3 h-3" /> IMPORTANT
            </span>
          )}
          {systems?.map((s) => <Tag key={s} system={s} />)}
        </div>
        <div className="text-sm text-slate-600 leading-relaxed space-y-1">{children}</div>
        {notice && (
          <div className="mt-2 flex items-start gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{notice}</span>
          </div>
        )}
        {warn && (
          <div className="mt-2 flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-900 font-semibold">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{warn}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ScreenshotBox({ label, src }: { label: string; src?: string }) {
  if (src) {
    return (
      <div className="w-full rounded-xl overflow-hidden border border-slate-200 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={label} className="w-full object-cover" />
        <div className="px-3 py-1.5 bg-slate-50 border-t border-slate-200 text-xs text-slate-400 font-medium">{label}</div>
      </div>
    );
  }
  return (
    <div className="w-full rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center py-8 gap-2 text-slate-400 text-xs font-medium select-none">
      <FileText className="w-6 h-6 opacity-40" />
      <span>📷 Screenshot — {label}</span>
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-slate-200 rounded-2xl p-5 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function Notice({ children, type = "info" }: { children: React.ReactNode; type?: "info" | "warn" | "error" }) {
  const styles = {
    info:  "bg-blue-50  border-blue-200  text-blue-800",
    warn:  "bg-amber-50 border-amber-300 text-amber-900",
    error: "bg-red-50   border-red-300   text-red-800",
  };
  const icons = { info: Info, warn: AlertTriangle, error: AlertTriangle };
  const Icon = icons[type];
  return (
    <div className={`flex items-start gap-2.5 px-4 py-3 rounded-xl border text-sm font-medium ${styles[type]}`}>
      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

const SECTIONS = [
  { id: "legend",   label: "System Legend" },
  { id: "morning",  label: "Morning Checklist" },
  { id: "priority", label: "Daily Priority" },
  { id: "cluster",  label: "B2C Cluster Pick" },
  { id: "b2b",      label: "B2B Processing" },
];

export default function SopPage() {
  const router = useRouter();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Sticky header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30 print:hidden">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-black text-slate-900">WMS Operations SOP</h1>
            <p className="text-xs text-slate-500">Standard Operating Procedure — Daily Warehouse Workflow</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded font-mono">Rev. 2026-06</span>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-semibold transition-colors"
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
          </div>
        </div>
        {/* TOC */}
        <div className="max-w-5xl mx-auto px-6 flex gap-1 pb-2 overflow-x-auto">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`}
              className="flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors">
              {s.label}
            </a>
          ))}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-10">

        {/* ── 00 System Legend ── */}
        <section id="legend" className="scroll-mt-6">
          <div className="flex items-center gap-3 px-5 py-3 rounded-xl mb-4 bg-slate-100 text-slate-800">
            <span className="text-lg font-black opacity-50">00</span>
            <h2 className="text-base font-bold">System Legend — Color Guide</h2>
          </div>
          <Card>
            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-4">
              Each step is tagged with the system where the action takes place
            </p>
            <div className="grid grid-cols-3 gap-3">
              {(Object.entries(SYSTEM_META) as [SystemTag, typeof SYSTEM_META[SystemTag]][]).map(([key, m]) => (
                <div key={key} className={`rounded-xl border-2 p-4 flex flex-col gap-2 ${m.bg} ${m.border}`}>
                  <div className={`flex items-center gap-2 ${m.text}`}>
                    <m.Icon className="w-5 h-5" />
                    <span className="text-sm font-extrabold">{m.label}</span>
                  </div>
                  <p className={`text-xs font-medium opacity-80 ${m.text}`}>
                    {key === "dashboard" && "wms-dashboard — this app (PC browser)"}
                    {key === "mobile"    && "wms-mobile — mobile app (iOS/Android)"}
                    {key === "wms"       && "External WMS system (separate login)"}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        </section>

        {/* ── 01 Morning Checklist ── */}
        <Section id="morning" number="01" title="Morning Checklist" color="bg-slate-100 text-slate-800" icon={CheckCircle2}>
          <Card>
            <p className="text-sm font-bold text-slate-700 mb-1">
              First thing upon arrival — check these three numbers before starting any fulfillment work.
            </p>
            <p className="text-xs text-slate-400 mb-4 flex items-center gap-1">Check in <Tag system="dashboard" /></p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "B2C Pending Orders", icon: Package,    color: "bg-blue-50 border-blue-200 text-blue-700",    nav: "/shipping/b2c", sub: "Shipping → B2C Shipping" },
                { label: "B2B Pending Orders", icon: Grid3X3,    color: "bg-orange-50 border-orange-200 text-orange-700", nav: "/shipping/b2b", sub: "Shipping → B2B Shipping" },
                { label: "Inbound Scheduled",  icon: ArrowRight, color: "bg-emerald-50 border-emerald-200 text-emerald-700", nav: "/receiving", sub: "Receiving → Receiving Orders" },
              ].map(({ label, icon: Icon, color, nav, sub }) => (
                <button key={label} onClick={() => router.push(nav)}
                  className={`rounded-xl border-2 p-4 text-left hover:shadow-md transition-all ${color}`}>
                  <Icon className="w-5 h-5 mb-2 opacity-70" />
                  <p className="text-sm font-extrabold">{label}</p>
                  <p className="text-xs opacity-60 mt-0.5">{sub}</p>
                  <p className="text-xs font-semibold mt-2 underline underline-offset-2">Go →</p>
                </button>
              ))}
            </div>
          </Card>
          <ScreenshotBox label="Dashboard home — B2C / B2B / Inbound order counts" src="/sop/sop_dashboard.png" />
        </Section>

        {/* ── 02 Priority ── */}
        <Section id="priority" number="02" title="Daily Priority Order" color="bg-violet-50 text-violet-800" icon={Zap}>
          <Card>
            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-4">Processing sequence</p>
            <div className="flex items-center gap-2 flex-wrap mb-4">
              {[
                { label: "B2C Cluster Pick", color: "bg-teal-600 text-white",   icon: Grid3X3 },
                { label: "B2B Processing",   color: "bg-orange-500 text-white", icon: Package },
              ].map(({ label, color, icon: Icon }, i, arr) => (
                <div key={label} className="flex items-center gap-2">
                  <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm ${color} shadow-sm`}>
                    <Icon className="w-4 h-4" />
                    {label}
                  </div>
                  {i < arr.length - 1 && <ChevronRight className="w-5 h-5 text-slate-300" />}
                </div>
              ))}
            </div>
            <Notice type="info">
              <strong>If staffing allows,</strong> run B2C Cluster and B2B simultaneously by assigning each to a separate team. Coordinate with your manager before splitting teams.
            </Notice>
          </Card>
        </Section>

        {/* ── 03 B2C Cluster Pick ── */}
        <Section id="cluster" number="03" title="B2C Cluster Pick" color="bg-teal-50 text-teal-800" icon={Grid3X3}>
          <Card>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-5">Step by step</p>
            <div className="space-y-6">

              <Step n={1} title="Check B2C Shipping" systems={["dashboard"]}>
                <p>Go to <strong>Shipping → B2C Shipping</strong> and check the number of B2C orders to be processed today.</p>
                <p>If orders exist, proceed to Cluster Pick.</p>
              </Step>

              <Step n={2} title="Create Cluster" systems={["dashboard"]}
                notice="Cluster creation is not automatic — you must manually click Start each time.">
                <p>Go to the <strong>Cluster Pick</strong> page (left sidebar) → click <strong>"Start Cluster Pick"</strong>.</p>
                <p>The system groups B2C orders by pick location proximity and auto-assigns inventory via the WMS API.</p>
                <p>Progress is shown in real time in the dialog (e.g., [2/25] order code — checking shelf stock…).</p>
              </Step>
              <ScreenshotBox label="Cluster Pick page — Start button and creation progress dialog" src="/sop/sop_cluster_pick.png" />

              <Step n={3} title="Handle 'N' Items (insufficient stock)" systems={["dashboard"]} important>
                <p>SKUs marked <strong className="text-red-600">"N"</strong> have insufficient stock at the designated pick location.</p>
                <p>These items can be found in two places:</p>
                <ul className="list-disc list-inside ml-2 space-y-0.5 text-sm mt-1">
                  <li>Bottom of the Cluster Pick page</li>
                  <li>
                    <button onClick={() => router.push("/inventory")} className="text-teal-700 underline font-semibold">
                      Inventory → Replenishment page
                    </button>
                  </li>
                </ul>
              </Step>

              <Step n={4} title="Print replenishment ticket → replenish stock" systems={["dashboard", "wms"]} important
                warn="Starting cluster picking before all 'N' items are replenished will cause out-of-stock errors mid-pick and put orders on hold. Always complete replenishment first.">
                <p>Print the replenishment ticket for the affected SKU from the Replenishment page.</p>
                <p>A warehouse associate moves the stock from bulk storage to the pick location.</p>
                <p>Confirm replenishment is complete before proceeding.</p>
              </Step>
              <ScreenshotBox label="'N' items — Replenishment page" src="/sop/sop_replenishment.png" />

              <Step n={5} title="Request label printing (before picking starts)" systems={["wms"]} important
                warn="Labels must be requested from Steve or a manager before pickers leave. If labels are not ready when picking finishes, packing will be delayed. Always notify: 'Cluster picking starting — please print labels now.'">
                <p>Notify Steve or a manager: <span className="font-semibold text-slate-700">"Cluster picking starting — please print labels now."</span></p>
              </Step>

              <Step n={6} title="Start mobile picking" systems={["mobile"]}
                notice="The mobile app guides you through locations in an optimized order. Follow the scan instructions on screen.">
                <p>Mobile app → <strong>Outbound → Cluster Pick</strong> → select the active cluster → start picking.</p>
                <p>Scan each location barcode and item barcode to confirm each pick.</p>
                <p>When the last location is completed, the <strong>cluster is automatically marked done</strong> and disappears from the list.</p>
              </Step>
              <ScreenshotBox label="Mobile Cluster Pick — cluster list and picking progress" />

              <Step n={7} title="Complete from dashboard (manual option)" systems={["dashboard"]}
                notice="If auto-completion on mobile did not trigger, you can manually complete the cluster from the dashboard.">
                <p>On the Cluster Pick page, click the <strong>"Complete"</strong> button for the cluster.</p>
                <p>Review the confirmation popup (bin count, location count, CA status update) then click <strong>"Complete"</strong>.</p>
                <p>After completion the cluster moves to history and disappears from the list.</p>
              </Step>

              <Step n={8} title="Packing → outbound complete" systems={["dashboard", "wms"]}>
                <p>Bring the picked items to the packing station.</p>
                <p>Complete packing for each order on the <strong>Packing</strong> page.</p>
                <p>Confirm outbound in WMS. Workflow complete.</p>
              </Step>
              <ScreenshotBox label="Packing page — packing complete for each order" />

            </div>
          </Card>
        </Section>

        {/* ── 04 B2B ── */}
        <Section id="b2b" number="04" title="B2B Processing" color="bg-orange-50 text-orange-800" icon={Package}>
          <Card>
            <Notice type="info">
              B2B is processed <strong>after</strong> B2C Cluster Pick, or simultaneously when staffing allows. Always coordinate team assignments with your manager.
            </Notice>
            <div className="mt-5 space-y-6">

              <Step n={1} title="Check B2B Shipping" systems={["dashboard"]}>
                <p>Go to <strong>Shipping → B2B Shipping</strong> and filter for today's outbound orders.</p>
              </Step>

              <Step n={2} title="Assign pick locations (Auto Assign)" systems={["dashboard"]}
                notice="B2B orders typically have high quantities per line. Verify available stock carefully before assigning.">
                <p>Open each order and click <strong>"Auto Assign"</strong>, or manually select a location per SKU line.</p>
                <p>Auto Assign prioritizes FEFO (earliest expiry first) and GOOD-condition stock automatically.</p>
                <p>If any lines remain unassigned, use the <strong>"Assign"</strong> button to pick a location manually.</p>
              </Step>

              <Step n={3} title="Pick → Pack → Ship" systems={["wms", "dashboard"]}>
                <p>Once locations are assigned: pick items from designated locations → bring to packing station → complete packing → confirm outbound in WMS.</p>
              </Step>

            </div>
          </Card>
        </Section>

        {/* ── FAQ ── */}
        <section>
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Frequently Asked Questions</h2>
          <div className="space-y-2">
            {[
              {
                q: "Can I start cluster picking even if there are 'N' items?",
                a: "No. All 'N' items must be replenished and confirmed before picking begins. Starting without sufficient stock will cause out-of-stock errors mid-pick and put orders on hold."
              },
              {
                q: "What if the cluster doesn't auto-complete on mobile?",
                a: "Click the 'Complete' button for that cluster on the dashboard's Cluster Pick page. Review the confirmation popup and click 'Complete' to manually close it."
              },
              {
                q: "I completed a cluster but it's still showing in the list — what do I do?",
                a: "On completion, the system calls /api/cluster/close to update the Redis status to 'completed' and sends a CA status change to the WMS. Press the refresh button (↻) on the list page to reload the latest state."
              },
              {
                q: "When should I request label printing for cluster picking?",
                a: "Before picking starts — not during or after. Labels must be ready when pickers return to the packing station. As soon as the cluster is confirmed, notify Steve or a manager right away."
              },
              {
                q: "What if B2B Auto Assign can't fill some lines?",
                a: "An 'Assign' button appears on the unassigned rows in the picking table. Click it to see available stock for that SKU sorted by FEFO. Select a location, enter the quantity, and confirm the assignment. If stock is truly insufficient, report to your manager."
              },
            ].map(({ q, a }, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <button
                  className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span>Q. {q}</span>
                  {openFaq === i
                    ? <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />}
                </button>
                {openFaq === i && (
                  <div className="px-4 pb-4 pt-3 text-sm text-slate-600 border-t border-slate-100">
                    {a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── Quick links ── */}
        <section className="pb-8">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Quick Links</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: "B2C Shipping",  href: "/shipping/b2c", color: "text-blue-600 bg-blue-50 border-blue-200"     },
              { label: "B2B Shipping",  href: "/shipping/b2b", color: "text-orange-600 bg-orange-50 border-orange-200" },
              { label: "Cluster Pick",  href: "/clusters",     color: "text-teal-600 bg-teal-50 border-teal-200"      },
              { label: "Replenishment", href: "/inventory",    color: "text-amber-600 bg-amber-50 border-amber-200"   },
            ].map(({ label, href, color }) => (
              <button key={href} onClick={() => router.push(href)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-semibold flex items-center justify-between hover:shadow-sm transition-all ${color}`}>
                {label}
                <ChevronRight className="w-4 h-4 opacity-50" />
              </button>
            ))}
          </div>
        </section>

      </div>

      <style jsx global>{`
        @media print {
          .print\\:hidden { display: none !important; }
          body { background: white; }
        }
      `}</style>
    </div>
  );
}
