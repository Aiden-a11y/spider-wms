"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import { Maximize2, Minimize2, X, RefreshCw, Loader2 } from "lucide-react";
import type { B2CCluster } from "@/lib/b2c-cluster";

/* ─── palette ───────────────────────────────────────────────────── */
const BG   = "#080d14";
const C1   = "#0d1624";
const BRDR = "#1e2d42";
const LBL  = "#b0c4d8";

const REFRESH_SEC = 120;

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  AA: { label: "Outbound Req",      color: "#f59e0b" },
  CA: { label: "Packing Req",       color: "#3b82f6" },
  DA: { label: "Packing Complete",  color: "#22d3ee" },
  AR: { label: "Auto Label Req",    color: "#a78bfa" },
  AC: { label: "Auto Label Comp",   color: "#818cf8" },
  LR: { label: "Twinny Pack Req",   color: "#fb923c" },
  L2: { label: "Twinny Cancel",     color: "#f87171" },
  LC: { label: "Twinny Pack Comp",  color: "#34d399" },
  HA: { label: "Hold",              color: "#f87171" },
  CC: { label: "Cancelled",         color: "#475569" },
  FA: { label: "Complete",          color: "#4ade80" },
};
const ACTIVE_S     = ["AA","CA","DA","AR","AC","LR","L2","LC","HA"];
const STATUS_ORDER = ["AA","CA","DA","AR","AC","LR","L2","LC","HA","CC","FA"];

/* ─── types ─────────────────────────────────────────────────────── */
type Row = Record<string, unknown>;

type TrendPoint = {
  date: string;
  total_qty: number;
  sku_count: number;
  location_count: number;
};

type TrendResponse = {
  trend: TrendPoint[];
  warehouses: string[];
  occupied_locations: string[];
};

/* ─── helpers ───────────────────────────────────────────────────── */
function parseList(json: unknown, ...paths: string[][]): Row[] {
  const j = json as Record<string, unknown>;
  for (const path of paths) {
    let cur: unknown = j;
    for (const p of path) cur = (cur as Record<string, unknown>)?.[p];
    if (Array.isArray(cur)) return cur as Row[];
  }
  return [];
}

function orderDateOf(o: Row): string {
  const raw = String(o.orderDate ?? o.requestDate ?? o.shippingDate ?? o.createdAt ?? "");
  if (!raw) return "";
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
  return raw.slice(0,10);
}
const statusOf  = (o: Row) => String(o.status ?? o.orderStatus ?? "");
const todayISO  = () => new Date().toISOString().slice(0,10);
const yesterISO = () => { const d=new Date(); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); };
const isoOf     = (s: string) => s.slice(0,10);
const fmtK      = (n: number) => n >= 1000 ? `${(n/1000).toFixed(0)}k` : String(n);

/* OPH / UPH thresholds */
const uphColor = (v: number | null) =>
  v === null ? "#475569" : v >= 150 ? "#4ade80" : v >= 75 ? "#fbbf24" : "#f87171";
const ophColor = (v: number | null) =>
  v === null ? "#475569" : v >= 40  ? "#4ade80" : v >= 20 ? "#fbbf24" : "#f87171";

/* ─── clock ─────────────────────────────────────────────────────── */
function useClock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const id=setInterval(()=>setT(new Date()),1000); return ()=>clearInterval(id); },[]);
  return t;
}

/* ─── cluster stats ─────────────────────────────────────────────── */
function clusterStats(c: B2CCluster) {
  const ms  = c.completedAt ? new Date(c.completedAt).getTime()-new Date(c.createdAt).getTime() : null;
  const hr  = ms ? ms/3600000 : null;
  const ord = c.bins.length;
  const uni = c.bins.reduce((s,b)=>s+b.items.reduce((ss,i)=>ss+(i.qty??0),0),0);
  return {
    orders: ord, units: uni,
    uph:  hr&&hr>0 ? Math.round(uni/hr)  : null,
    oph:  hr&&hr>0 ? Math.round(ord/hr)  : null,
    min:  ms       ? Math.round(ms/60000): null,
  };
}

/* ─── sparkline (KPI tile) ──────────────────────────────────────── */
function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null;
  const W = 100, H = 32;
  const min = Math.min(...points), max = Math.max(...points);
  const range = max - min || 1;
  const xs = points.map((_, i) => (i / (points.length - 1)) * W);
  const ys = points.map(v => H - ((v - min) / range) * H * 0.8 - H * 0.1);
  const line = xs.map((x, i) => `${i===0?"M":"L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const area = `${line} L${xs[xs.length-1].toFixed(1)},${H} L0,${H}Z`;
  return (
    <svg width={W} height={H} style={{ display:"block", flexShrink:0 }}>
      <defs>
        <linearGradient id={`sg-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25"/>
          <stop offset="100%" stopColor={color} stopOpacity="0.02"/>
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${color.replace("#","")})`}/>
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round"/>
      <circle cx={xs[xs.length-1]} cy={ys[ys.length-1]} r={2.5} fill={color}/>
    </svg>
  );
}

/* ─── inventory trend chart ─────────────────────────────────────── */
function TrendChart({ trend }: { trend: TrendPoint[] }) {
  const pts = trend.slice(-14);
  if (pts.length < 2) return (
    <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <p style={{ color:LBL, fontSize:14 }}>No trend data</p>
    </div>
  );

  const W = 100, H = 100;
  const padL = 7, padR = 4, padT = 5, padB = 12;
  const cW = W - padL - padR, cH = H - padT - padB;

  const qtyVals = pts.map(p => p.total_qty);
  const skuVals = pts.map(p => p.sku_count);

  /* add 8% padding above/below each series so flat lines appear mid-chart */
  const pad = (mn: number, mx: number) => {
    const r = (mx - mn) * 0.12 || mx * 0.08 || 1;
    return [mn - r, mx + r] as const;
  };
  const [qtyLo, qtyHi] = pad(Math.min(...qtyVals), Math.max(...qtyVals));
  const [skuLo, skuHi] = pad(Math.min(...skuVals), Math.max(...skuVals));

  const xOf     = (i: number) => padL + (i / (pts.length - 1)) * cW;
  const yOfQty  = (v: number) => padT + (1 - (v - qtyLo) / (qtyHi - qtyLo)) * cH;
  const yOfSku  = (v: number) => padT + (1 - (v - skuLo) / (skuHi - skuLo)) * cH;

  const qtyLine = pts.map((p, i) => `${i===0?"M":"L"}${xOf(i).toFixed(2)},${yOfQty(p.total_qty).toFixed(2)}`).join(" ");
  const qtyArea = `${qtyLine} L${xOf(pts.length-1).toFixed(2)},${(padT+cH).toFixed(2)} L${xOf(0).toFixed(2)},${(padT+cH).toFixed(2)}Z`;
  const skuLine = pts.map((p, i) => `${i===0?"M":"L"}${xOf(i).toFixed(2)},${yOfSku(p.sku_count).toFixed(2)}`).join(" ");

  /* 5 evenly-spaced labels; first=start, last=end so they don't clip */
  const n = pts.length;
  const lblIdxs = [0, Math.round(n*0.25), Math.round(n*0.5), Math.round(n*0.75), n-1]
    .filter((v,i,a) => a.indexOf(v)===i);
  const anchor = (i: number) => i===0 ? "start" : i===n-1 ? "end" : "middle";

  return (
    <div style={{ flex:1, minHeight:0, padding:"8px 14px 8px", display:"flex", flexDirection:"column", gap:6 }}>
      {/* legend */}
      <div style={{ display:"flex", gap:18, alignItems:"center", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <div style={{ width:18, height:2, background:"#3b82f6", borderRadius:1 }}/>
          <span style={{ fontSize:11, color:LBL }}>Total Qty</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <svg width="18" height="2"><line x1="0" y1="1" x2="18" y2="1" stroke="#a855f7" strokeWidth="2" strokeDasharray="3,2"/></svg>
          <span style={{ fontSize:11, color:LBL }}>SKU Count</span>
        </div>
        <span style={{ fontSize:11, color:LBL, marginLeft:"auto" }}>
          Latest: <strong style={{ color:"#fff" }}>{fmtK(qtyVals[qtyVals.length-1])} units</strong>
          {" · "}
          <strong style={{ color:"#a855f7" }}>{skuVals[skuVals.length-1]} SKUs</strong>
        </span>
      </div>

      {/* chart */}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ flex:1, width:"100%", display:"block", overflow:"hidden" }}>
        <defs>
          <linearGradient id="qty-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.35"/>
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02"/>
          </linearGradient>
        </defs>
        {/* horizontal grid */}
        {[0.25, 0.5, 0.75].map(f => (
          <line key={f}
            x1={padL.toFixed(1)} y1={(padT+f*cH).toFixed(2)}
            x2={(padL+cW).toFixed(1)} y2={(padT+f*cH).toFixed(2)}
            stroke={BRDR} strokeWidth="0.35"/>
        ))}
        {/* qty area */}
        <path d={qtyArea} fill="url(#qty-fill)"/>
        {/* qty line */}
        <path d={qtyLine} fill="none" stroke="#3b82f6" strokeWidth="0.4" strokeLinejoin="round"/>
        {/* sku line (independent scale, dashed) */}
        <path d={skuLine} fill="none" stroke="#a855f7" strokeWidth="0.35" strokeLinejoin="round" strokeDasharray="1.5,1"/>
        {/* x-axis labels */}
        {lblIdxs.map(i => (
          <text key={i}
            x={xOf(i).toFixed(2)} y={(padT+cH+4.5).toFixed(2)}
            textAnchor={anchor(i)} fontSize="3.5" fill={LBL}>
            {pts[i].date.slice(5)}
          </text>
        ))}
      </svg>
    </div>
  );
}

/* ─── KPI card ─────────────────────────────────────────────────── */
function KpiCard({ label, value, sub, sparkPoints, sparkColor }: {
  label: string; value: string|number; sub?: string;
  sparkPoints?: number[]; sparkColor?: string;
}) {
  return (
    <div style={{ background:C1, border:`1px solid ${BRDR}`, borderRadius:0, padding:"14px 18px 12px", display:"flex", flexDirection:"column", gap:4, minWidth:0 }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8 }}>
        <p style={{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:LBL }}>{label}</p>
        {sparkPoints && sparkPoints.length > 1 && <Sparkline points={sparkPoints} color={sparkColor ?? "#3b82f6"}/>}
      </div>
      <p style={{ fontSize:48, fontWeight:900, color:"#fff", lineHeight:1, fontVariantNumeric:"tabular-nums" }}>
        {typeof value==="number" ? value.toLocaleString() : value}
      </p>
      {sub && <p style={{ fontSize:12, color:LBL }}>{sub}</p>}
    </div>
  );
}

/* ─── Order column ─────────────────────────────────────────────── */
function OrderCol({ title, orders, type }: { title:string; orders:Row[]; type:"today"|"yest" }) {
  const byStatus = useMemo(()=>{
    const m:Record<string,number>={};
    orders.forEach(o=>{ const s=statusOf(o); m[s]=(m[s]??0)+1; });
    return m;
  },[orders]);
  const isYest = type==="yest";

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", minHeight:0 }}>
      <p style={{ fontSize:11, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:LBL, marginBottom:10 }}>
        {title}{isYest && orders.length>0 && <span style={{ color:"#fbbf24", marginLeft:6 }}>({orders.length})</span>}
      </p>
      {STATUS_ORDER
        .filter(c => isYest ? ACTIVE_S.includes(c) : true)
        .map(code => {
          const cnt = byStatus[code]??0;
          if (!cnt) return null;
          const cfg = STATUS_CFG[code]??{label:code,color:"#94a3b8"};
          return (
            <div key={code} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 10px", background:"rgba(255,255,255,0.04)", borderLeft:`3px solid ${cfg.color}`, marginBottom:4 }}>
              <span style={{ fontSize:14, color:"#fff", flex:1, fontWeight:700 }}>{code} · {cfg.label}</span>
              <span style={{ fontSize:19, fontWeight:900, color:isYest?"#fbbf24":"#fff", fontVariantNumeric:"tabular-nums" }}>{cnt}</span>
            </div>
          );
        })
      }
      {Object.keys(byStatus).length===0 && (
        <p style={{ fontSize:14, color:LBL, padding:"6px 0" }}>{isYest?"None pending":"No orders"}</p>
      )}
    </div>
  );
}

/* ─── Order panel ──────────────────────────────────────────────── */
function OrderPanel({ title, todayOrders, yestOrders }: {
  title:string; todayOrders:Row[]; yestOrders:Row[];
}) {
  const done   = todayOrders.filter(o=>statusOf(o)==="FA").length;
  const active = todayOrders.filter(o=>ACTIVE_S.includes(statusOf(o))).length;
  const yestP  = yestOrders.filter(o=>ACTIVE_S.includes(statusOf(o)));

  return (
    <div style={{ background:C1, border:`1px solid ${BRDR}`, borderRadius:0, display:"flex", flexDirection:"column", minHeight:0, overflow:"hidden" }}>
      <div style={{ padding:"12px 16px 10px", borderBottom:`1px solid ${BRDR}`, display:"flex", alignItems:"center", gap:20, flexShrink:0 }}>
        <p style={{ fontSize:17, fontWeight:800, color:"#fff", flex:1 }}>{title}</p>
        <span style={{ fontSize:13, color:LBL }}>Total <strong style={{ color:"#fff", fontSize:18 }}>{todayOrders.length}</strong></span>
        <span style={{ fontSize:13, color:LBL }}>Done <strong style={{ color:"#4ade80", fontSize:18 }}>{done}</strong></span>
        <span style={{ fontSize:13, color:LBL }}>Active <strong style={{ color:"#fff", fontSize:18 }}>{active}</strong></span>
        {yestP.length>0 && <span style={{ fontSize:13, color:"#fbbf24" }}>Yest Pending <strong style={{ fontSize:18 }}>{yestP.length}</strong></span>}
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:"12px 14px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
        <OrderCol title="Today by status" orders={todayOrders} type="today" />
        <div style={{ borderLeft:`1px solid ${BRDR}`, paddingLeft:16 }}>
          <OrderCol title="Yesterday pending" orders={yestP} type="yest" />
        </div>
      </div>
    </div>
  );
}

/* ─── page ─────────────────────────────────────────────────────── */
export default function KpiPage() {
  const { user, loading:authLoading } = useAuth();
  const router  = useRouter();
  const now     = useClock();
  const ref     = useRef<HTMLDivElement>(null);
  const [isFs, setIsFs] = useState(false);
  const [countdown, setCountdown] = useState(REFRESH_SEC);
  const [busy, setBusy] = useState(true);

  const [trendData,  setTrendData]  = useState<TrendResponse | null>(null);
  const [b2b,        setB2b]        = useState<Row[]>([]);
  const [b2c,        setB2c]        = useState<Row[]>([]);
  const [clusters,   setClusters]   = useState<B2CCluster[]>([]);

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user?.token ?? ""}`, "Content-Type": "application/json" }),
    [user]
  );

  function toggleFs() {
    if (!document.fullscreenElement) ref.current?.requestFullscreen();
    else document.exitFullscreen();
  }
  useEffect(()=>{
    const fn=()=>setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange",fn);
    return ()=>document.removeEventListener("fullscreenchange",fn);
  },[]);

  const loadOrders = useCallback(async (type:"b2b"|"b2c"): Promise<Row[]> => {
    const body = { limit:2000, pageSize:2000, orderType:type.toUpperCase(), warehouseCode:"STOO1" };
    for (const ep of [
      `/api/wms/shipping/${type}/list`,
      `/api/wms/shipping/list`,
      `/api/wms/outbound/${type}/list`,
      `/api/wms/outbound/list`,
    ]) {
      try {
        const res  = await fetch(ep, { method:"POST", headers, body:JSON.stringify({...body,page:1}) });
        if (!res.ok) continue;
        const json = await res.json().catch(()=>({}));
        const rows = parseList(json, ["data","list"],["data"],["list"],[]);
        if (rows.length>0) return rows;
      } catch { /* try next */ }
    }
    return [];
  }, [headers]);

  const load = useCallback(async () => {
    if (!user) return;
    setBusy(true);
    try {
      const [rTrend, ordB2B, ordB2C, rClusters] = await Promise.all([
        fetch("/api/inventory-trend").then(r=>r.json()).catch(()=>null),
        loadOrders("b2b"),
        loadOrders("b2c"),
        fetch("/api/cluster").then(r=>r.json()).catch(()=>[]),
      ]);
      if (rTrend?.trend) setTrendData(rTrend as TrendResponse);
      setB2b(ordB2B);
      setB2c(ordB2C);
      setClusters(Array.isArray(rClusters) ? rClusters as B2CCluster[] : []);
    } catch { /* silent */ }
    setBusy(false);
    setCountdown(REFRESH_SEC);
  }, [user, headers, loadOrders]);

  useEffect(()=>{ if(!authLoading&&!user) router.replace("/login"); },[user,authLoading,router]);
  useEffect(()=>{ if(user) load(); },[user,load]);
  useEffect(()=>{
    const id=setInterval(()=>setCountdown(c=>{ if(c<=1){load();return REFRESH_SEC;} return c-1; }),1000);
    return ()=>clearInterval(id);
  },[load]);

  /* derived */
  const today_ = todayISO(), yest_ = yesterISO();

  const latestSnap  = trendData?.trend[trendData.trend.length - 1] ?? null;
  const totalQty    = latestSnap?.total_qty  ?? 0;
  const totalSkus   = latestSnap?.sku_count  ?? 0;
  const snapOccLocs = trendData?.occupied_locations.length ?? 0;
  const totalLocs   = latestSnap?.location_count ?? 0;

  const qtySparkPoints = useMemo(()=>(trendData?.trend ?? []).slice(-14).map(p=>p.total_qty),[trendData]);
  const skuSparkPoints = useMemo(()=>(trendData?.trend ?? []).slice(-14).map(p=>p.sku_count),[trendData]);

  const b2bToday = useMemo(()=>b2b.filter(o=>orderDateOf(o)===today_),[b2b,today_]);
  const b2bYest  = useMemo(()=>b2b.filter(o=>orderDateOf(o)===yest_), [b2b,yest_]);
  const b2cToday = useMemo(()=>b2c.filter(o=>orderDateOf(o)===today_),[b2c,today_]);
  const b2cYest  = useMemo(()=>b2c.filter(o=>orderDateOf(o)===yest_), [b2c,yest_]);

  const todayC    = useMemo(()=>clusters.filter(c=>c.completedAt&&isoOf(c.completedAt)===today_).map(c=>({c,s:clusterStats(c)})).sort((a,b)=>new Date(b.c.completedAt!).getTime()-new Date(a.c.completedAt!).getTime()),[clusters,today_]);
  const avgUph    = useMemo(()=>{ const v=todayC.filter(x=>x.s.uph!==null); return v.length?Math.round(v.reduce((s,x)=>s+x.s.uph!,0)/v.length):null; },[todayC]);
  const totUnits  = useMemo(()=>todayC.reduce((s,x)=>s+x.s.units,0),[todayC]);
  const totOrders = useMemo(()=>todayC.reduce((s,x)=>s+x.s.orders,0),[todayC]);
  const avgMinPerOrd = useMemo(()=>{
    const v = todayC.filter(x=>x.s.min!==null && x.s.orders>0);
    if(!v.length) return null;
    return Math.round(v.reduce((s,x)=>s+x.s.min!/x.s.orders,0)/v.length*10)/10;
  },[todayC]);

  const timeStr = now.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
  const dateStr = now.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"});

  if (authLoading||!user) return null;

  return (
    <div ref={ref} style={{
      width:"100vw", height:"100vh", overflow:"hidden",
      background:BG, display:"grid",
      gridTemplateRows:"72px 160px 1fr 1fr 26px",
      fontFamily:"Inter, system-ui, -apple-system, sans-serif", color:"#fff",
      boxSizing:"border-box",
    }}>

      {/* ── Header ── */}
      <header style={{ display:"flex", alignItems:"center", padding:"0 20px", borderBottom:`1px solid ${BRDR}`, gap:14 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/stl-logo.png" alt="STL" style={{ height:36, width:"auto", objectFit:"contain" }}/>
        <span style={{ fontSize:15, fontWeight:700, color:LBL, letterSpacing:"0.04em" }}>KPI Display</span>

        <div style={{ display:"flex", alignItems:"center", gap:8, marginLeft:20, color:LBL, fontSize:13 }}>
          {busy
            ? <Loader2 style={{width:14,height:14,color:"#3b82f6"}} className="animate-spin"/>
            : <RefreshCw style={{width:13,height:13}}/>}
          <span>Refresh in {countdown}s</span>
          <button onClick={load} style={{ background:"none", border:"none", cursor:"pointer", color:LBL, display:"flex", padding:4 }}>
            <RefreshCw style={{width:13,height:13}}/>
          </button>
        </div>

        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ textAlign:"right" }}>
            <p style={{ fontSize:52, fontWeight:900, color:"#fff", lineHeight:1, letterSpacing:"0.04em", fontVariantNumeric:"tabular-nums" }}>{timeStr}</p>
            <p style={{ fontSize:13, color:LBL, marginTop:4 }}>{dateStr}</p>
          </div>
          <button onClick={toggleFs} style={{ padding:8, background:C1, border:`1px solid ${BRDR}`, color:LBL, cursor:"pointer", display:"flex" }}>
            {isFs?<Minimize2 style={{width:16,height:16}}/>:<Maximize2 style={{width:16,height:16}}/>}
          </button>
          <button onClick={()=>router.push("/dashboard")} style={{ padding:8, background:C1, border:`1px solid ${BRDR}`, color:LBL, cursor:"pointer", display:"flex" }}>
            <X style={{width:16,height:16}}/>
          </button>
        </div>
      </header>

      {/* ── KPI tiles ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:1, borderBottom:`1px solid ${BRDR}` }}>
        <KpiCard label="Total Inventory"    value={fmtK(totalQty)}            sub={`${totalQty.toLocaleString()} units`}   sparkPoints={qtySparkPoints} sparkColor="#3b82f6"/>
        <KpiCard label="Total SKUs"         value={totalSkus.toLocaleString()} sub="distinct products"                      sparkPoints={skuSparkPoints} sparkColor="#a855f7"/>
        <KpiCard label="Occupied Locs"      value={`${snapOccLocs}/${totalLocs}`} sub={totalLocs>0?`${Math.round(snapOccLocs/(totalLocs||1)*100)}% utilized`:""}/>
        <KpiCard label="B2B Today"          value={b2bToday.length} sub={`${b2bToday.filter(o=>statusOf(o)==="FA").length} done · ${b2bToday.filter(o=>ACTIVE_S.includes(statusOf(o))).length} active`}/>
        <KpiCard label="B2C Today"          value={b2cToday.length} sub={`${b2cToday.filter(o=>statusOf(o)==="FA").length} done · ${b2cToday.filter(o=>ACTIVE_S.includes(statusOf(o))).length} active`}/>
        <KpiCard label="Cluster Units / hr" value={avgUph!==null?avgUph:"—"}   sub={todayC.length?`${todayC.length} runs · ${totUnits} units · ${totOrders} orders`:"No clusters today"}/>
        <KpiCard label="Min / Order"        value={avgMinPerOrd!==null?avgMinPerOrd:"—"} sub={avgMinPerOrd!==null?"avg min per order":"No clusters today"}/>
      </div>

      {/* ── B2B + B2C ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:1, minHeight:0 }}>
        <OrderPanel title="B2B Orders" todayOrders={b2bToday} yestOrders={b2bYest}/>
        <OrderPanel title="B2C Orders" todayOrders={b2cToday} yestOrders={b2cYest}/>
      </div>

      {/* ── Inventory Trend + Cluster ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:1, minHeight:0 }}>

        {/* Inventory trend chart */}
        <div style={{ background:C1, borderTop:`1px solid ${BRDR}`, display:"flex", flexDirection:"column", minHeight:0, overflow:"hidden" }}>
          <div style={{ padding:"10px 18px", borderBottom:`1px solid ${BRDR}`, display:"flex", alignItems:"center", flexShrink:0 }}>
            <p style={{ fontSize:17, fontWeight:800, color:"#fff", flex:1 }}>Inventory Trend · Last 14 days</p>
            <span style={{ fontSize:13, color:LBL }}>Snapshot from Supabase</span>
          </div>
          <TrendChart trend={trendData?.trend ?? []}/>
        </div>

        {/* Cluster pick */}
        <div style={{ background:C1, borderTop:`1px solid ${BRDR}`, borderLeft:`1px solid ${BRDR}`, display:"flex", flexDirection:"column", minHeight:0, overflow:"hidden" }}>
          <div style={{ padding:"10px 18px", borderBottom:`1px solid ${BRDR}`, display:"flex", alignItems:"center", gap:20, flexShrink:0 }}>
            <p style={{ fontSize:17, fontWeight:800, color:"#fff", flex:1 }}>Cluster Pick · Today</p>
            <span style={{ fontSize:13, color:LBL }}>Orders <strong style={{ color:"#fff", fontSize:16 }}>{totOrders}</strong></span>
            <span style={{ fontSize:13, color:LBL }}>Units <strong style={{ color:"#fff", fontSize:16 }}>{totUnits}</strong></span>
            {avgUph!==null && <span style={{ fontSize:14, fontWeight:800, color:uphColor(avgUph) }}>avg {avgUph} u/hr</span>}
          </div>
          {todayC.length===0
            ? <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <p style={{ fontSize:15, color:LBL }}>No completed clusters today</p>
              </div>
            : <div style={{ flex:1, overflowY:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                  <thead>
                    <tr style={{ borderBottom:`1px solid ${BRDR}` }}>
                      {["Cluster #","Orders","Units","Duration","Units / hr","Orders / hr"].map(h=>(
                        <th key={h} style={{ padding:"9px 16px", textAlign:"left", fontSize:11, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:LBL, whiteSpace:"nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {todayC.map(({c,s})=>(
                      <tr key={c.id} style={{ borderBottom:`1px solid ${BRDR}` }}>
                        <td style={{ padding:"9px 16px", fontWeight:800, color:"#60a5fa", fontSize:14, fontVariantNumeric:"tabular-nums" }}>#{String(c.clusterNo??"").padStart(4,"0")}</td>
                        <td style={{ padding:"9px 16px", fontWeight:700, color:"#fff", fontSize:15, fontVariantNumeric:"tabular-nums" }}>{s.orders}</td>
                        <td style={{ padding:"9px 16px", fontWeight:700, color:"#fff", fontSize:15, fontVariantNumeric:"tabular-nums" }}>{s.units}</td>
                        <td style={{ padding:"9px 16px", color:"#fff", fontSize:14, fontVariantNumeric:"tabular-nums" }}>
                          {s.min!==null?(s.min>=60?`${Math.floor(s.min/60)}h ${s.min%60}m`:`${s.min}m`):"—"}
                        </td>
                        <td style={{ padding:"9px 16px", fontWeight:900, fontSize:22, color:uphColor(s.uph), fontVariantNumeric:"tabular-nums" }}>{s.uph??"-"}</td>
                        <td style={{ padding:"9px 16px", fontWeight:900, fontSize:22, color:ophColor(s.oph), fontVariantNumeric:"tabular-nums" }}>{s.oph??"-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
          }
        </div>
      </div>

      {/* ── Footer ── */}
      <footer style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"0 20px", fontSize:11, color:"#2a3d52", borderTop:`1px solid ${BRDR}` }}>
        <span>Spider WMS · KPI Display</span>
        <span style={{ color:"#1e3a20" }}>UPH: 🟢 ≥150 · 🟡 75–149 · 🔴 &lt;75 &nbsp;|&nbsp; OPH: 🟢 ≥40 · 🟡 20–39 · 🔴 &lt;20</span>
        <span>Auto-refresh every {REFRESH_SEC}s</span>
      </footer>
    </div>
  );
}
