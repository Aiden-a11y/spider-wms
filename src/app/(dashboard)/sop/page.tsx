"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2, AlertTriangle, Info, ChevronDown, ChevronUp,
  Package, Layers, Grid3X3, ArrowRight, ChevronRight,
  Printer, Smartphone, FileText, Star, Zap,
} from "lucide-react";

/* ── Shared primitives ─────────────────────────────── */

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

function Step({ n, title, children, notice, warn, important }: {
  n: number; title: string; children: React.ReactNode;
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
        <div className="flex items-center gap-2 mb-1">
          <p className={`text-sm font-bold ${important ? "text-red-700" : "text-slate-800"}`}>{title}</p>
          {important && (
            <span className="text-xs font-bold px-1.5 py-0.5 bg-red-100 text-red-700 rounded border border-red-200 flex items-center gap-1">
              <Star className="w-3 h-3" /> IMPORTANT
            </span>
          )}
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

function ScreenshotBox({ label }: { label: string }) {
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
  { id: "morning",  label: "Morning Checklist" },
  { id: "priority", label: "Daily Priority" },
  { id: "batch",    label: "B2C Batch Pick" },
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

        {/* ── 01 Morning Checklist ── */}
        <Section id="morning" number="01" title="Morning Checklist" color="bg-slate-100 text-slate-800" icon={CheckCircle2}>
          <Card>
            <p className="text-sm font-bold text-slate-700 mb-4">
              First thing upon arrival — check these three numbers before starting any fulfillment work.
            </p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "B2C Pending Orders", icon: Package,     color: "bg-blue-50 border-blue-200 text-blue-700",   nav: "/shipping/b2c", sub: "Shipping → B2C Shipping" },
                { label: "B2B Pending Orders", icon: Grid3X3,     color: "bg-orange-50 border-orange-200 text-orange-700", nav: "/shipping/b2b", sub: "Shipping → B2B Shipping" },
                { label: "Inbound Scheduled",  icon: ArrowRight,  color: "bg-emerald-50 border-emerald-200 text-emerald-700", nav: "/receiving", sub: "Receiving → Receiving Orders" },
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
          <ScreenshotBox label="Dashboard home — B2C / B2B / Inbound order counts" />
        </Section>

        {/* ── 02 Priority ── */}
        <Section id="priority" number="02" title="Daily Priority Order" color="bg-violet-50 text-violet-800" icon={Zap}>
          <Card>
            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-4">Processing sequence</p>
            <div className="flex items-center gap-2 flex-wrap mb-4">
              {[
                { label: "B2C Batch Pick",    color: "bg-blue-600 text-white",    icon: Layers   },
                { label: "B2C Cluster Pick",  color: "bg-teal-600 text-white",    icon: Grid3X3  },
                { label: "B2B Processing",    color: "bg-orange-500 text-white",  icon: Package  },
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
              <strong>If staffing allows,</strong> run B2C Batch, Cluster, and B2B simultaneously by assigning each to a separate team. Coordinate with your manager before splitting teams.
            </Notice>
          </Card>
        </Section>

        {/* ── 03 B2C Batch Pick ── */}
        <Section id="batch" number="03" title="B2C Batch Pick" color="bg-blue-50 text-blue-800" icon={Layers}>
          <Card>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-5">Step by step</p>
            <div className="space-y-6">

              <Step n={1} title="Open B2C Shipping → Run Batch Detection">
                <p>Navigate to <strong>Shipping → B2C Shipping</strong>, then click <strong>"Batch Pick"</strong> in the top-right area.</p>
                <p>The system automatically groups orders that share identical SKU configurations.</p>
              </Step>
              <ScreenshotBox label="B2C Shipping page — Batch Pick button location" />

              <Step n={2} title="Verify Batch Quantities Against WMS Total Picking"
                notice="Confirm that the total SKU quantities shown in each detected batch match the Total Picking quantities in the original WMS. Report any discrepancy to your manager before creating the batch.">
                <p>Compare the batch-detected SKU × qty with the WMS system's total picking count for the same SKU.</p>
              </Step>

              <Step n={3} title="Batch Eligibility Rule — 5-Order Groups Only" important>
                <p><strong>Only create a batch when exactly 5 orders share the same SKU composition.</strong></p>
                <p>Groups smaller than 5 or with mixed SKUs should not be batched — process them individually or via Cluster Pick.</p>
              </Step>

              <Step n={4} title="High-Volume Orders — Escalate to Manager" important
                warn="If a single SKU group has 100 or more orders (especially 200+), DO NOT process it as a standard batch. Discuss with Steve or your Manager first to determine whether auto-label processing applies. Processing large batches without approval can cause label errors and shipping delays.">
                <p>Large batch groups require a different labeling workflow and resource allocation decision.</p>
              </Step>
              <ScreenshotBox label="Batch detection results — order count / SKU / total qty" />

              <Step n={5} title="Create Batch → Go to Batch Pick Page">
                <p>Click <strong>"Create Batch"</strong> to save the group. Then navigate to <strong>Batch Pick</strong> in the left sidebar.</p>
              </Step>

              <Step n={6} title="Assign Picking Location" important
                warn="⏱ PROCESS ONE BATCH AT A TIME. Wait until the current batch's Assign is fully complete before starting the next. Running multiple Assigns simultaneously can cause inventory conflicts and double-allocation errors.">
                <p>On the Batch Pick page, expand a batch and click <strong>"Load Locations"</strong>.</p>
                <p>Locations are sorted FEFO (earliest expiry first). Select the appropriate location.</p>
                <p>Click <strong>"Assign to All Orders"</strong> to apply the location to every order in the batch at once.</p>
                <p>Watch the progress counter — wait for it to reach 100% before moving to the next batch.</p>
              </Step>
              <ScreenshotBox label="Batch Pick page — Location Assign panel with progress" />

              <Step n={7} title="Start Mobile Picking"
                notice="Once all batches are assigned, they will appear in the mobile app and are ready to pick.">
                <p>On the mobile app, go to <strong>Outbound → Batch / Cluster Pick</strong>. Assigned batches will be listed.</p>
                <p>Select a batch to begin the guided scan flow: <strong>Scan location barcode → Scan product barcode → Confirm qty</strong>.</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <Smartphone className="w-4 h-4 text-slate-400" />
                  <span className="text-xs text-slate-500">Location scan → Product scan → Quantity check</span>
                </div>
              </Step>
              <ScreenshotBox label="Mobile Batch Pick — location and product scan steps" />

              <Step n={8} title="Mark Complete on Mobile" important
                warn="After finishing all picks in a batch, you MUST press the 'Done — Complete' button on the mobile app. If skipped, the batch will not be marked as complete in WMS and inventory counts will not update correctly.">
                <p>Tap <strong>"Done — Complete"</strong> at the bottom of the mobile pick screen after all items are scanned.</p>
              </Step>

              <Step n={9} title="Print Pick Tickets from Dashboard">
                <p>On the Batch Pick page in the dashboard, click the <Printer className="w-3.5 h-3.5 inline" /> icon next to the completed batch.</p>
                <p>A <strong>4×6-inch Pick Ticket</strong> is generated for each order in the batch, including a QR code of the order number.</p>
                <p>Print all tickets and attach them to the corresponding packed items.</p>
              </Step>
              <ScreenshotBox label="Pick Ticket print preview — 4×6 label per order with QR code" />

            </div>
          </Card>
        </Section>

        {/* ── 04 B2C Cluster Pick ── */}
        <Section id="cluster" number="04" title="B2C Cluster Pick" color="bg-teal-50 text-teal-800" icon={Grid3X3}>
          <Card>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-5">Step by step</p>
            <div className="space-y-6">

              <Step n={1} title="Open Cluster Pick Page → Run Check Logic"
                notice="The check logic does NOT run automatically. You must trigger it manually every time.">
                <p>Go to <strong>Cluster Pick</strong> in the left sidebar, then click <strong>"Start Cluster Pick"</strong>.</p>
                <p>The system will scan current B2C orders and group them by proximity of picking locations.</p>
              </Step>
              <ScreenshotBox label="Cluster Pick page — Start button and progress indicator" />

              <Step n={2} title="Review Items Marked 'N' (Out of Stock at Pick Location)" important>
                <p>Any SKU flagged with <strong className="text-red-600">"N"</strong> does not have sufficient inventory at the designated picking location.</p>
                <p>These items appear in <strong>two places</strong>:</p>
                <ul className="list-disc list-inside ml-2 space-y-0.5 text-sm mt-1">
                  <li>The bottom section of the Cluster Pick page</li>
                  <li>
                    <button onClick={() => router.push("/inventory")} className="text-teal-700 underline font-semibold">
                      Inventory → Replenishment page
                    </button>
                  </li>
                </ul>
              </Step>
              <ScreenshotBox label="'N' items — Cluster Pick page footer / Replenishment page" />

              <Step n={3} title="Print Replenishment Ticket → Replenish Stock" important
                warn="Do NOT start cluster picking until all 'N' items have been replenished and confirmed at their pick locations. Starting picks with missing stock will cause mid-pick interruptions and order holds.">
                <p>Go to the Replenishment page and print the replenishment ticket for each flagged SKU.</p>
                <p>A warehouse associate moves stock from the reserve/storage location to the pick location.</p>
                <p>Confirm replenishment is complete before proceeding.</p>
              </Step>

              <Step n={4} title="Pre-Build Clusters">
                <p>Once replenishment is done, return to Cluster Pick and create the clusters.</p>
                <p>Build clusters <strong>before</strong> assigning pickers so they are ready to start immediately.</p>
                <p className="text-xs text-slate-500 mt-1">Tip: Pre-building clusters reduces picker idle time between assignments.</p>
              </Step>

              <Step n={5} title="Request Label Printing BEFORE Picking Starts" important
                warn="Before any picker begins, notify Steve or your Manager to print the shipping labels. Starting picks without labels ready causes packing delays. Always say: 'Starting cluster pick — please print labels.'">
                <p>Inform Steve or Manager: <span className="font-semibold text-slate-700">"Cluster picking is starting — please print labels now."</span></p>
              </Step>
              <ScreenshotBox label="Mobile Cluster Pick — cluster list and picking progress" />

              <Step n={6} title="Mobile Picking"
                notice="The mobile app guides pickers through locations in optimized order. Follow the on-screen scan prompts.">
                <p>Mobile app → <strong>Outbound → Cluster Pick</strong> → select a cluster → start picking.</p>
                <p>Scan each location barcode and product barcode to confirm picks.</p>
              </Step>

              <Step n={7} title="Packing → Complete">
                <p>Bring picked items to the packing station. Complete packing for each order using the <strong>Packing</strong> page.</p>
                <p>Confirm outbound processing in WMS. Workflow complete.</p>
              </Step>
              <ScreenshotBox label="Packing page — complete packing for each order" />

            </div>
          </Card>
        </Section>

        {/* ── 05 B2B ── */}
        <Section id="b2b" number="05" title="B2B Processing" color="bg-orange-50 text-orange-800" icon={Package}>
          <Card>
            <Notice type="info">
              B2B is processed <strong>after</strong> B2C Batch and Cluster, or simultaneously if sufficient staff are available. Always coordinate team allocation with your manager.
            </Notice>
            <div className="mt-5 space-y-6">
              <Step n={1} title="Open B2B Shipping → Review Today's Orders">
                <p>Go to <strong>Shipping → B2B Shipping</strong> and filter for today's outbound orders.</p>
              </Step>
              <Step n={2} title="Assign Picking Locations"
                notice="B2B orders typically have higher quantities per line. Review available stock carefully before assigning.">
                <p>Open each order and use <strong>"Auto Assign"</strong> or manually select locations per SKU line.</p>
              </Step>
              <Step n={3} title="Pick → Pack → Ship">
                <p>After location assignment: pick items from assigned locations → bring to packing station → complete packing → confirm outbound in WMS.</p>
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
                q: "Can I start the next batch Assign while the current one is still running?",
                a: "No. Wait until the current batch shows 100% completion before starting the next Assign. Running multiple Assigns at the same time can cause duplicate allocations on the same inventory, leading to pick errors."
              },
              {
                q: "There are 'N' items — can I start cluster picking anyway?",
                a: "No. All 'N' items must be replenished and confirmed at their pick locations before picking begins. Starting with missing stock will interrupt the pick mid-flow and put orders on hold."
              },
              {
                q: "What happens if a picker forgets to press Complete on mobile?",
                a: "The batch will remain open in WMS and inventory counts will not be updated. The dashboard Batch Pick page will not reflect it as done. If this happens, report to your manager to manually close the batch in WMS."
              },
              {
                q: "Why do I need manager approval for 100+ order batches?",
                a: "Large batches may require auto-label processing through a different workflow. Processing them as standard batches without approval can cause label mismatches and shipping errors. Always check with Steve or your Manager first."
              },
              {
                q: "When should I request label printing for cluster picks?",
                a: "Before picking starts — not during or after. Labels need to be ready at the packing station by the time pickers return with picked items. Notify Steve or Manager as soon as cluster picking is confirmed to begin."
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
              { label: "B2C Shipping",    href: "/shipping/b2c", color: "text-blue-600 bg-blue-50 border-blue-200"       },
              { label: "Batch Pick",      href: "/batches",      color: "text-violet-600 bg-violet-50 border-violet-200"  },
              { label: "Cluster Pick",    href: "/clusters",     color: "text-teal-600 bg-teal-50 border-teal-200"        },
              { label: "Replenishment",   href: "/inventory",    color: "text-amber-600 bg-amber-50 border-amber-200"     },
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
