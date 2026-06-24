"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2, AlertTriangle, Info, ChevronDown, ChevronUp,
  Package, Layers, Grid3X3, ArrowRight, Clock, Users,
  Printer, Smartphone, MapPin, RefreshCw, FileText,
  Star, Zap, ChevronRight,
} from "lucide-react";

/* ── Shared primitives ─────────────────────────────── */

function Section({ id, number, title, color, icon: Icon, children }: {
  id: string; number: string; title: string;
  color: string; icon: React.ElementType; children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6">
      <div className={`flex items-center gap-3 px-5 py-3 rounded-xl mb-4 ${color}`}>
        <span className="text-lg font-black opacity-60">{number}</span>
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
          {important && <span className="text-xs font-bold px-1.5 py-0.5 bg-red-100 text-red-700 rounded border border-red-200">중요</span>}
        </div>
        <div className="text-sm text-slate-600 leading-relaxed space-y-1">{children}</div>
        {notice && (
          <div className="mt-2 flex items-start gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{notice}</span>
          </div>
        )}
        {warn && (
          <div className="mt-2 flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-800 font-semibold">
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
      <span>📷 {label}</span>
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
    warn:  "bg-amber-50 border-amber-300 text-amber-800",
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

/* ── TOC ───────────────────────────────────────────── */

const SECTIONS = [
  { id: "morning",  label: "출근 체크리스트",      color: "text-slate-600" },
  { id: "priority", label: "일일 업무 우선순위",    color: "text-violet-600" },
  { id: "batch",    label: "B2C Batch Pick SOP",    color: "text-blue-600"  },
  { id: "cluster",  label: "B2C Cluster Pick SOP",  color: "text-teal-600"  },
  { id: "b2b",      label: "B2B 처리 SOP",          color: "text-orange-600"},
];

/* ── Page ──────────────────────────────────────────── */

export default function SopPage() {
  const router = useRouter();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30 print:hidden">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-black text-slate-900">WMS 운영 SOP</h1>
            <p className="text-xs text-slate-500">Standard Operating Procedure — 창고 일일 업무 절차</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded font-mono">Rev. 2026-06</span>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-semibold"
            >
              <Printer className="w-3.5 h-3.5" /> 인쇄
            </button>
          </div>
        </div>
        {/* TOC tabs */}
        <div className="max-w-5xl mx-auto px-6 flex gap-1 pb-2 overflow-x-auto">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`}
              className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors ${s.color}`}>
              {s.label}
            </a>
          ))}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-10">

        {/* ── 1. 출근 체크리스트 ── */}
        <Section id="morning" number="01" title="출근 체크리스트" color="bg-slate-100 text-slate-800" icon={CheckCircle2}>
          <Card>
            <p className="text-sm font-bold text-slate-700 mb-4">출근 즉시 아래 세 가지 수치를 확인합니다.</p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "B2C 대기 주문", icon: Package, color: "bg-blue-50 border-blue-200 text-blue-700", nav: "/shipping/b2c", sub: "Shipping → B2C Shipping" },
                { label: "B2B 대기 주문", icon: Grid3X3, color: "bg-orange-50 border-orange-200 text-orange-700", nav: "/shipping/b2b", sub: "Shipping → B2B Shipping" },
                { label: "Inbound 예정", icon: ArrowRight, color: "bg-emerald-50 border-emerald-200 text-emerald-700", nav: "/receiving", sub: "Receiving → Receiving Orders" },
              ].map(({ label, icon: Icon, color, nav, sub }) => (
                <button key={label} onClick={() => router.push(nav)}
                  className={`rounded-xl border-2 p-4 text-left hover:shadow-md transition-all ${color}`}>
                  <Icon className="w-5 h-5 mb-2 opacity-70" />
                  <p className="text-sm font-extrabold">{label}</p>
                  <p className="text-xs opacity-60 mt-0.5">{sub}</p>
                  <p className="text-xs font-semibold mt-2 underline underline-offset-2">바로가기 →</p>
                </button>
              ))}
            </div>
          </Card>
          <ScreenshotBox label="Dashboard 메인화면 — B2C / B2B / Inbound 수치 확인" />
        </Section>

        {/* ── 2. 우선순위 ── */}
        <Section id="priority" number="02" title="일일 업무 우선순위" color="bg-violet-50 text-violet-800" icon={Zap}>
          <Card>
            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-4">처리 순서</p>
            <div className="flex items-center gap-2 flex-wrap">
              {[
                { label: "B2C Batch Pick", color: "bg-blue-600 text-white", icon: Layers },
                { label: "B2C Cluster Pick", color: "bg-teal-600 text-white", icon: Grid3X3 },
                { label: "B2B 처리", color: "bg-orange-500 text-white", icon: Package },
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
              <strong>인원이 충분한 경우</strong> B2C Batch, Cluster, B2B를 동시에 진행할 수 있습니다. 각 팀에 역할을 분배하세요.
            </Notice>
          </Card>
        </Section>

        {/* ── 3. B2C Batch Pick ── */}
        <Section id="batch" number="03" title="B2C Batch Pick SOP" color="bg-blue-50 text-blue-800" icon={Layers}>

          <Card>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-4">STEP BY STEP</p>
            <div className="space-y-6">

              <Step n={1} title="B2C Shipping 페이지 진입 → Batch 감지">
                <p>상단 메뉴 <strong>Shipping → B2C Shipping</strong> 진입 후, 우측 상단 <strong>「Batch Pick」</strong> 버튼을 클릭합니다.</p>
                <p>시스템이 동일 SKU 구성을 가진 주문들을 자동으로 그룹핑합니다.</p>
              </Step>
              <ScreenshotBox label="B2C Shipping 페이지 — Batch Pick 버튼 위치" />

              <Step n={2} title="배치 수량 WMS 대조 확인"
                notice="배치에 표시된 총 수량이 기존 WMS의 Total Picking 수량과 일치하는지 반드시 확인하세요.">
                <p>감지된 배치의 SKU × 수량이 WMS 재고 피킹 수량과 맞는지 대조합니다.</p>
                <p>불일치 시 배치 생성 전에 Manager에게 보고합니다.</p>
              </Step>

              <Step n={3} title="배치 처리 기준 결정" important>
                <p><Star className="w-3.5 h-3.5 inline text-red-500 mr-1" /><strong>동일 SKU 5개 오더 묶음만 배치로 처리합니다.</strong></p>
                <p>묶음 수가 5개 미만이거나 SKU 구성이 다른 경우 배치 대상에서 제외합니다.</p>
              </Step>

              <Step n={4} title="대량 오더 처리 — Manager 협의 필수" important
                warn="100개 또는 200개 이상의 오더가 동일 SKU로 묶이는 경우, 자동 라벨 처리 여부를 반드시 Steve 또는 Manager와 사전 협의하십시오. 임의로 배치 처리하지 마세요.">
                <p>대량 배치는 라벨 발행 방식, 피킹 순서, 인력 배분에 영향을 줍니다.</p>
              </Step>
              <ScreenshotBox label="배치 감지 결과 화면 — 오더 수 / SKU / 총 수량 확인" />

              <Step n={5} title="배치 생성 → Batch Pick 페이지 진입">
                <p>「Create Batch」 버튼으로 배치를 생성합니다.</p>
                <p>이후 좌측 메뉴 <strong>Batch Pick</strong> 페이지로 이동합니다.</p>
              </Step>

              <Step n={6} title="로케이션 Assign" important
                warn="⏱ Assign은 반드시 한 배치씩 순서대로 진행하세요. 한 배치의 Assign이 완전히 완료된 후 다음 배치를 시작합니다. 동시에 여러 배치를 Assign하면 재고 충돌이 발생할 수 있습니다.">
                <p>Batch Pick 페이지에서 배치를 펼쳐 「Load Locations」를 클릭합니다.</p>
                <p>FEFO(선입선출) 순으로 자동 정렬된 로케이션 목록에서 적절한 위치를 선택합니다.</p>
                <p>「Assign to All Orders」 버튼으로 해당 배치의 모든 오더에 한 번에 배정합니다.</p>
              </Step>
              <ScreenshotBox label="Batch Pick 페이지 — Location Assign 화면" />

              <Step n={7} title="모바일 피킹 시작"
                notice="모든 배치의 Assign이 완료되면 모바일 앱에서 배치 목록이 활성화됩니다.">
                <p>모바일 앱 → <strong>Outbound → Batch/Cluster Pick</strong> 진입 시 할당된 배치가 표시됩니다.</p>
                <p>배치를 선택하면 위치 → SKU 스캔 순서로 피킹을 진행합니다.</p>
                <div className="flex items-center gap-2 mt-2">
                  <Smartphone className="w-4 h-4 text-slate-400" />
                  <span className="text-xs text-slate-500">위치 바코드 스캔 → 상품 바코드 스캔 → 수량 확인</span>
                </div>
              </Step>
              <ScreenshotBox label="모바일 Batch Pick 화면 — 위치/상품 스캔 단계" />

              <Step n={8} title="모바일 피킹 완료 처리" important
                warn="피킹이 끝나면 반드시 모바일에서 「Complete」 버튼을 눌러야 합니다. 누르지 않으면 WMS에 완료로 반영되지 않습니다.">
                <p>모바일 피킹 완료 후 화면 하단의 <strong>「Done — Complete」</strong> 버튼을 누릅니다.</p>
              </Step>

              <Step n={9} title="Pick Ticket 발행">
                <p>Dashboard의 Batch Pick 페이지에서 해당 배치 우측 <Printer className="w-3.5 h-3.5 inline" /> 아이콘을 클릭합니다.</p>
                <p>각 배치의 구성 오더별로 <strong>4×6인치 Pick Ticket</strong>이 생성됩니다 (QR코드 포함).</p>
              </Step>
              <ScreenshotBox label="Pick Ticket 출력 화면 — 오더별 4×6 라벨 미리보기" />

            </div>
          </Card>
        </Section>

        {/* ── 4. B2C Cluster Pick ── */}
        <Section id="cluster" number="04" title="B2C Cluster Pick SOP" color="bg-teal-50 text-teal-800" icon={Grid3X3}>

          <Card>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-4">STEP BY STEP</p>
            <div className="space-y-6">

              <Step n={1} title="Cluster Pick 페이지 진입 → 체크 로직 실행"
                notice="체크 로직은 자동으로 실행되지 않습니다. 반드시 수동으로 실행해야 합니다.">
                <p>좌측 메뉴 <strong>Cluster Pick</strong> 진입 후 <strong>「Start Cluster Pick」</strong> 버튼을 누릅니다.</p>
                <p>시스템이 B2C 주문들을 로케이션 기준으로 클러스터링합니다.</p>
              </Step>
              <ScreenshotBox label="Cluster Pick 페이지 — Start 버튼 및 진행 상태" />

              <Step n={2} title="재고 부족(N) 항목 확인" important>
                <p>체크 결과에서 <strong className="text-red-600">「N」</strong>으로 표시된 SKU는 재고가 피킹 위치에 없거나 부족한 항목입니다.</p>
                <p>이 항목들은 두 곳에서 확인 가능합니다:</p>
                <ul className="list-disc list-inside ml-2 space-y-0.5 text-sm">
                  <li>Cluster Pick 페이지 하단 목록</li>
                  <li><button onClick={() => router.push("/inventory")} className="text-teal-700 underline font-semibold">Inventory → Replenishment 페이지</button></li>
                </ul>
              </Step>
              <ScreenshotBox label="N 표시 항목 — Cluster Pick 페이지 하단 / Replenishment 페이지" />

              <Step n={3} title="Replenishment 티켓 발행 → 보충 처리" important
                warn="N 항목은 Replenishment 처리 완료 후 클러스터 피킹을 시작해야 합니다. 재고 없이 피킹을 시작하면 피킹 중단이 발생합니다.">
                <p>Replenishment 페이지에서 해당 SKU의 보충 티켓을 발행합니다.</p>
                <p>창고 담당자가 보충 위치에서 피킹 위치로 이동 완료 후 클러스터 피킹을 시작합니다.</p>
              </Step>

              <Step n={4} title="클러스터 미리 생성">
                <p>재고 보충이 완료되면 Cluster Pick 페이지에서 클러스터를 생성합니다.</p>
                <p>클러스터가 생성되면 모바일 앱에 표시되어 피킹 진행이 가능합니다.</p>
                <p className="text-xs text-slate-500 mt-1">※ 피킹 전 클러스터를 미리 생성해두면 피커가 바로 시작할 수 있습니다.</p>
              </Step>

              <Step n={5} title="피킹 시작 전 — 라벨 발행 요청 필수" important
                warn="클러스터 피킹을 시작하기 전에 반드시 Manager 또는 Steve에게 라벨 발행을 요청하세요. 라벨 없이 피킹을 시작하면 패킹 단계에서 지연이 발생합니다.">
                <p>피커가 피킹을 시작하기 전, Steve 또는 Manager에게:</p>
                <p className="font-semibold text-slate-700">→ 「클러스터 피킹 시작합니다. 라벨 발행 부탁드립니다.」</p>
              </Step>
              <ScreenshotBox label="모바일 Cluster Pick 화면 — 클러스터 목록 및 진행" />

              <Step n={6} title="모바일 피킹 진행"
                notice="모바일 앱에서 클러스터를 선택하면 위치 순서대로 피킹을 안내합니다.">
                <p>모바일 앱 → <strong>Outbound → Cluster Pick</strong> 진입 → 클러스터 선택 → 피킹 시작</p>
                <p>각 위치에서 바코드 스캔으로 상품을 확인하며 피킹합니다.</p>
              </Step>

              <Step n={7} title="패킹 및 완료">
                <p>피킹 완료된 오더는 패킹 스테이션에서 <strong>Packing</strong> 처리합니다.</p>
                <p>패킹 완료 후 WMS에서 출고 처리까지 확인하면 종료입니다.</p>
              </Step>
              <ScreenshotBox label="Packing 화면 — 패킹 완료 처리" />

            </div>
          </Card>
        </Section>

        {/* ── 5. B2B ── */}
        <Section id="b2b" number="05" title="B2B 처리 SOP" color="bg-orange-50 text-orange-800" icon={Package}>
          <Card>
            <Notice type="info">
              B2B는 B2C 배치 및 클러스터 처리 이후, 또는 인원이 충분한 경우 동시에 진행합니다.
            </Notice>
            <div className="mt-4 space-y-6">
              <Step n={1} title="B2B Shipping 페이지에서 당일 오더 확인">
                <p><strong>Shipping → B2B Shipping</strong> 진입 후 오늘 출고 예정 오더를 확인합니다.</p>
              </Step>
              <Step n={2} title="Auto Assign 또는 수동 로케이션 배정"
                notice="B2B는 오더별 수량이 많으므로 로케이션 선택에 주의합니다.">
                <p>오더 상세에서 <strong>「Auto Assign」</strong> 또는 수동 Assign으로 피킹 위치를 배정합니다.</p>
              </Step>
              <Step n={3} title="피킹 → 패킹 → 출고">
                <p>로케이션 배정 후 피킹 → 패킹 → 출고 처리 순으로 진행합니다.</p>
              </Step>
            </div>
          </Card>
        </Section>

        {/* ── FAQ ── */}
        <section>
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">자주 묻는 질문</h2>
          <div className="space-y-2">
            {[
              {
                q: "배치 Assign 중에 다음 배치를 시작해도 되나요?",
                a: "안 됩니다. 한 배치의 Assign이 100% 완료된 것을 확인한 후 다음 배치를 진행하세요. 동시 진행 시 동일 재고에 중복 배정이 발생할 수 있습니다."
              },
              {
                q: "N 항목이 있는데 바로 클러스터 피킹을 시작해도 되나요?",
                a: "안 됩니다. N 항목은 Replenishment 처리 후 재고가 피킹 위치에 확보된 것을 확인한 뒤 피킹을 시작하세요."
              },
              {
                q: "모바일에서 Complete를 누르지 않으면 어떻게 되나요?",
                a: "WMS에 완료 처리가 반영되지 않습니다. 대시보드의 Batch Pick 목록에서 해당 배치가 완료로 표시되지 않으며, 재고 오류가 발생할 수 있습니다."
              },
              {
                q: "100개 이상 오더 배치를 Manager 협의 없이 처리하면?",
                a: "자동 라벨 처리 여부에 따라 출고 방식이 달라집니다. 임의 처리 시 라벨 누락, 출고 오류가 발생할 수 있으므로 반드시 Steve 또는 Manager와 사전 확인 후 진행하세요."
              },
            ].map(({ q, a }, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <button
                  className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span>Q. {q}</span>
                  {openFaq === i ? <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />}
                </button>
                {openFaq === i && (
                  <div className="px-4 pb-3 text-sm text-slate-600 border-t border-slate-100 pt-3">
                    {a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── Quick links ── */}
        <section className="pb-8">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">바로가기</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: "B2C Shipping",   href: "/shipping/b2c",   color: "text-blue-600 bg-blue-50 border-blue-200" },
              { label: "Batch Pick",     href: "/batches",         color: "text-violet-600 bg-violet-50 border-violet-200" },
              { label: "Cluster Pick",   href: "/clusters",        color: "text-teal-600 bg-teal-50 border-teal-200" },
              { label: "Replenishment",  href: "/inventory",       color: "text-amber-600 bg-amber-50 border-amber-200" },
            ].map(({ label, href, color }) => (
              <button key={href} onClick={() => router.push(href)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-semibold flex items-center justify-between ${color} hover:shadow-sm transition-all`}>
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
