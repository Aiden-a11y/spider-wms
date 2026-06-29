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
                    {key === "dashboard" && "wms-dashboard — 이 앱 (PC 브라우저)"}
                    {key === "mobile"    && "wms-mobile — 모바일 앱 (iOS/Android)"}
                    {key === "wms"       && "외부 WMS 시스템 (별도 접속)"}
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
            <p className="text-xs text-slate-400 mb-4 flex items-center gap-1"><Tag system="dashboard" /> 에서 확인</p>
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

              <Step n={1} title="B2C Shipping 확인" systems={["dashboard"]}>
                <p><strong>Shipping → B2C Shipping</strong>으로 이동하여 당일 처리할 B2C 주문 수량을 확인한다.</p>
                <p>주문이 있는 경우 Cluster Pick 진행.</p>
              </Step>

              <Step n={2} title="Cluster 생성" systems={["dashboard"]}
                notice="클러스터 생성은 자동이 아님 — 매번 수동으로 Start를 눌러야 한다.">
                <p><strong>Cluster Pick</strong> 페이지(왼쪽 사이드바)로 이동 → <strong>"Start Cluster Pick"</strong> 클릭.</p>
                <p>시스템이 B2C 주문을 피킹 위치 근접도 기준으로 그룹화하고, WMS API를 통해 재고를 자동 배정한다.</p>
                <p>진행 상황은 다이얼로그에서 실시간 확인 가능 (예: [2/25] 주문코드 — checking shelf stock…).</p>
              </Step>
              <ScreenshotBox label="Cluster Pick 페이지 — Start 버튼 및 생성 진행 다이얼로그" src="/sop/sop_cluster_pick.png" />

              <Step n={3} title="'N' 항목 (재고 부족) 처리" systems={["dashboard"]} important>
                <p><strong className="text-red-600">"N"</strong> 으로 표시된 SKU는 지정 피킹 위치에 재고가 충분하지 않음을 의미한다.</p>
                <p>이 항목들은 두 곳에서 확인 가능:</p>
                <ul className="list-disc list-inside ml-2 space-y-0.5 text-sm mt-1">
                  <li>Cluster Pick 페이지 하단</li>
                  <li>
                    <button onClick={() => router.push("/inventory")} className="text-teal-700 underline font-semibold">
                      Inventory → Replenishment 페이지
                    </button>
                  </li>
                </ul>
              </Step>

              <Step n={4} title="보충 티켓 출력 → 재고 보충" systems={["dashboard", "wms"]} important
                warn="'N' 항목 보충이 완료되기 전에 클러스터 피킹을 시작하면 피킹 중간에 재고 없음 오류가 발생하고 주문이 홀드됩니다. 반드시 보충 완료 후 진행하세요.">
                <p>Replenishment 페이지에서 해당 SKU의 보충 티켓을 출력한다.</p>
                <p>창고 담당자가 보조 창고/보관 위치에서 피킹 위치로 재고를 이동한다.</p>
                <p>보충 완료 확인 후 다음 단계 진행.</p>
              </Step>
              <ScreenshotBox label="'N' 항목 — Replenishment 페이지" src="/sop/sop_replenishment.png" />

              <Step n={5} title="라벨 출력 요청 (피킹 시작 전)" systems={["wms"]} important
                warn="피커가 출발하기 전에 Steve 또는 매니저에게 라벨 출력을 요청해야 합니다. 피킹 완료 후 라벨이 없으면 패킹이 지연됩니다. '클러스터 피킹 시작 — 라벨 출력 부탁드립니다.'라고 반드시 알릴 것.">
                <p>Steve 또는 매니저에게 전달: <span className="font-semibold text-slate-700">"Cluster picking starting — please print labels now."</span></p>
              </Step>

              <Step n={6} title="모바일 피킹 시작" systems={["mobile"]}
                notice="모바일 앱은 최적화된 순서로 위치를 안내합니다. 화면의 스캔 안내를 따르세요.">
                <p>모바일 앱 → <strong>Outbound → Cluster Pick</strong> → 활성 클러스터 선택 → 피킹 시작.</p>
                <p>각 위치 바코드와 상품 바코드를 스캔하여 피킹을 확인한다.</p>
                <p>마지막 위치 완료 시 <strong>자동으로 클러스터가 완료 처리</strong>되어 목록에서 사라진다.</p>
              </Step>
              <ScreenshotBox label="모바일 Cluster Pick — 클러스터 목록 및 피킹 진행" />

              <Step n={7} title="대시보드에서 완료 처리 (수동 옵션)" systems={["dashboard"]}
                notice="모바일에서 자동 완료가 되지 않은 경우 대시보드에서 수동으로 완료 처리 가능.">
                <p>Cluster Pick 페이지에서 해당 클러스터의 <strong>"Complete"</strong> 버튼 클릭.</p>
                <p>확인 팝업에서 bin 수, 위치 수, CA 처리 안내를 확인 후 <strong>"Complete"</strong> 클릭.</p>
                <p>완료 후 클러스터는 히스토리로 이동되고 목록에서 사라진다.</p>
              </Step>

              <Step n={8} title="패킹 → 출고 완료" systems={["dashboard", "wms"]}>
                <p>피킹된 상품을 패킹 스테이션으로 가져온다.</p>
                <p>각 주문에 대해 <strong>Packing</strong> 페이지에서 패킹을 완료한다.</p>
                <p>WMS에서 출고 처리를 확인한다. 워크플로우 완료.</p>
              </Step>
              <ScreenshotBox label="패킹 페이지 — 각 주문 패킹 완료" />

            </div>
          </Card>
        </Section>

        {/* ── 04 B2B ── */}
        <Section id="b2b" number="04" title="B2B Processing" color="bg-orange-50 text-orange-800" icon={Package}>
          <Card>
            <Notice type="info">
              B2B는 B2C Cluster Pick <strong>이후</strong> 처리하거나, 충분한 인원이 있는 경우 동시에 진행합니다. 팀 배정은 항상 매니저와 협의하세요.
            </Notice>
            <div className="mt-5 space-y-6">

              <Step n={1} title="B2B Shipping 확인" systems={["dashboard"]}>
                <p><strong>Shipping → B2B Shipping</strong>으로 이동하여 당일 출고 주문을 필터링한다.</p>
              </Step>

              <Step n={2} title="피킹 위치 배정 (Auto Assign)" systems={["dashboard"]}
                notice="B2B 주문은 라인당 수량이 많습니다. 배정 전 가용 재고를 꼼꼼히 확인하세요.">
                <p>각 주문을 열어 <strong>"Auto Assign"</strong>을 클릭하거나 SKU 라인별로 위치를 수동 선택한다.</p>
                <p>Auto Assign은 FEFO (유효기간 빠른 순) + GOOD 상태 재고 우선으로 자동 배정된다.</p>
                <p>미배정 라인이 있을 경우 <strong>"Assign"</strong> 버튼으로 수동 배정 가능.</p>
              </Step>

              <Step n={3} title="피킹 → 패킹 → 출고" systems={["wms", "dashboard"]}>
                <p>위치 배정 완료 후: 지정 위치에서 상품 피킹 → 패킹 스테이션으로 이동 → 패킹 완료 → WMS에서 출고 확인.</p>
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
                q: "'N' 항목이 있는데 클러스터 피킹을 먼저 시작해도 되나요?",
                a: "안 됩니다. 모든 'N' 항목은 피킹 전에 보충 완료 및 확인이 되어야 합니다. 재고 없이 피킹을 시작하면 피킹 중간에 재고 부족 오류가 발생하고 주문이 홀드됩니다."
              },
              {
                q: "모바일에서 자동 완료가 안 되는 경우는 어떻게 하나요?",
                a: "대시보드 Cluster Pick 페이지에서 해당 클러스터의 'Complete' 버튼을 클릭하면 수동으로 완료 처리할 수 있습니다. 확인 팝업에서 내용을 확인하고 'Complete'를 누르세요."
              },
              {
                q: "클러스터를 완료했는데 대시보드에서 히스토리로 안 빠지는 경우는?",
                a: "완료 처리 시 /api/cluster/close를 통해 Redis 상태가 'completed'로 변경되고 WMS에 CA 상태 변경이 전송됩니다. 목록 페이지에서 새로고침 버튼(↻)을 눌러 최신 상태를 불러오세요."
              },
              {
                q: "클러스터 피킹 라벨은 언제 요청해야 하나요?",
                a: "피킹 시작 전 — 피킹 중이나 완료 후가 아닙니다. 피커들이 피킹을 마치고 패킹 스테이션에 돌아왔을 때 라벨이 준비되어 있어야 합니다. 클러스터 시작이 확정되면 바로 Steve 또는 매니저에게 알리세요."
              },
              {
                q: "B2B Auto Assign이 일부 라인을 배정하지 못하면 어떻게 하나요?",
                a: "피킹 테이블에서 '(미배정)' 행에 'Assign' 버튼이 표시됩니다. 클릭하면 해당 SKU의 가용 재고 목록이 FEFO 순으로 나타납니다. 적절한 위치를 선택하고 수량을 입력하여 수동 배정하세요. 재고가 부족한 경우 매니저에게 보고하세요."
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
