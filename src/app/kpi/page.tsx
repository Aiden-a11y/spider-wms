"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import { Maximize2, Minimize2, RefreshCw, X, Loader2 } from "lucide-react";
import type { B2CCluster } from "@/lib/b2c-cluster";

/* ─── constants ─────────────────────────────────────────────── */
const BG       = "#0d1117";
const CARD_BG  = "#161c27";
const BORDER   = "#1e2a3a";
const TEXT_DIM = "#6b7a90";
const REFRESH_SEC = 120;

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  AA: { label: "Outbound Req",     color: "#f59e0b" },
  CA: { label: "Packing Req",      color: "#3b82f6" },
  DA: { label: "Packing Complete", color: "#06b6d4" },
  AR: { label: "Auto Label Req",   color: "#8b5cf6" },
  AC: { label: "Auto Label Comp",  color: "#6366f1" },
  LR: { label: "Twinny Pack Req",  color: "#f97316" },
  L2: { label: "Twinny Cancel",    color: "#ef4444" },
  LC: { label: "Twinny Pack Comp", color: "#14b8a6" },
  HA: { label: "Hold",             color: "#ef4444" },
  CC: { label: "Cancelled",        color: "#475569" },
  FA: { label: "Complete",         color: "#22c55e" },
};
const ACTIVE_S = ["AA","CA","DA","AR","AC","LR","L2","LC","HA"];
const STATUS_ORDER = ["AA","CA","DA","AR","AC","LR","L2","LC","HA","CC","FA"];

/* ─── helpers ────────────────────────────────────────────────── */
function arrOf(json: unknown): Record<string, unknown>[] {
  const j = json as Record<string, unknown>;
  const d = j?.data as Record<string, unknown> | undefined;
  const list = d?.list ?? d?.items ?? (Array.isArray(d) ? d : null)
    ?? j?.list ?? j?.items ?? (Array.isArray(json) ? json : []);
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
}

function orderDateOf(o: Record<string, unknown>): string {
  const raw = String(o.orderDate ?? o.requestDate ?? o.shippingDate ?? o.createdAt ?? "");
  if (!raw) return "";
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
  return raw.slice(0, 10);
}

function statusOf(o: Record<string, unknown>): string {
  return String(o.status ?? o.orderStatus ?? "");
}

function todayISO()     { return new Date().toISOString().slice(0,10); }
function yesterdayISO() { const d=new Date(); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); }
function isoOf(s: string) { return s.slice(0,10); }

/* ─── clock ──────────────────────────────────────────────────── */
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = setInterval(()=>setNow(new Date()), 1000); return ()=>clearInterval(id); }, []);
  return now;
}

/* ─── cluster calc ───────────────────────────────────────────── */
function clusterStats(c: B2CCluster) {
  const start   = new Date(c.createdAt);
  const end     = c.completedAt ? new Date(c.completedAt) : null;
  const ms      = end ? end.getTime()-start.getTime() : null;
  const hr      = ms ? ms/3600000 : null;
  const orders  = c.bins.length;
  const units   = c.bins.reduce((s,b)=>s+b.items.reduce((ss,i)=>ss+(i.qty??0),0),0);
  const uph     = hr && hr>0 ? Math.round(units/hr) : null;
  const oph     = hr && hr>0 ? Math.round(orders/hr) : null;
  const minTotal= ms ? Math.round(ms/60000) : null;
  return { orders, units, uph, oph, minTotal };
}

/* ─── components ─────────────────────────────────────────────── */
function BigTile({ label, value, sub, accentColor }: {
  label: string; value: string|number; sub?: string; accentColor: string;
}) {
  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderTop: `3px solid ${accentColor}`, borderRadius: 12, padding: "20px 20px 16px" }}>
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: TEXT_DIM, marginBottom: 8 }}>{label}</p>
      <p style={{ fontSize: 40, fontWeight: 900, color: "#fff", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{typeof value==="number"?value.toLocaleString():value}</p>
      {sub && <p style={{ fontSize: 12, color: TEXT_DIM, marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

function StatusRow({ code, count, type }: { code: string; count: number; type: "today"|"yest" }) {
  const cfg = STATUS_CFG[code] ?? { label: code, color: "#94a3b8" };
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 10px", borderRadius:6, background:`${cfg.color}14`, marginBottom:3 }}>
      <span style={{ width:7, height:7, borderRadius:"50%", background:cfg.color, flexShrink:0 }} />
      <span style={{ fontSize:12, color: cfg.color, flex:1 }}>{code} · {cfg.label}</span>
      <span style={{ fontSize:13, fontWeight:800, color: type==="yest" ? "#fbbf24" : "#fff", fontVariantNumeric:"tabular-nums" }}>{count}</span>
    </div>
  );
}

function OrderPanel({ title, accentColor, todayOrders, yestOrders }: {
  title: string; accentColor: string;
  todayOrders: Record<string,unknown>[];
  yestOrders:  Record<string,unknown>[];
}) {
  const todayMap  = useMemo(()=>{ const m:Record<string,number>={}; todayOrders.forEach(o=>{const s=statusOf(o); m[s]=(m[s]??0)+1;}); return m; }, [todayOrders]);
  const yestPend  = useMemo(()=>yestOrders.filter(o=>ACTIVE_S.includes(statusOf(o))), [yestOrders]);
  const yestMap   = useMemo(()=>{ const m:Record<string,number>={}; yestPend.forEach(o=>{const s=statusOf(o); m[s]=(m[s]??0)+1;}); return m; }, [yestPend]);
  const todayDone = todayOrders.filter(o=>statusOf(o)==="FA").length;
  const todayActive= todayOrders.filter(o=>ACTIVE_S.includes(statusOf(o))).length;

  return (
    <div style={{ background: CARD_BG, border:`1px solid ${BORDER}`, borderTop:`3px solid ${accentColor}`, borderRadius:12, overflow:"hidden", display:"flex", flexDirection:"column" }}>
      {/* header */}
      <div style={{ padding:"12px 16px", borderBottom:`1px solid ${BORDER}`, display:"flex", alignItems:"center", gap:12 }}>
        <p style={{ fontSize:13, fontWeight:800, color:"#fff", flex:1 }}>{title}</p>
        <span style={{ fontSize:12, color: TEXT_DIM }}>Today <strong style={{ color:"#fff" }}>{todayOrders.length}</strong></span>
        <span style={{ fontSize:12, color:"#22c55e" }}>Done <strong>{todayDone}</strong></span>
        <span style={{ fontSize:12, color:"#f59e0b" }}>Active <strong>{todayActive}</strong></span>
        {yestPend.length>0 && <span style={{ fontSize:12, color:"#ef4444" }}>Yest Pending <strong>{yestPend.length}</strong></span>}
      </div>
      {/* body: two columns */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", flex:1 }}>
        <div style={{ padding:"12px 12px", borderRight:`1px solid ${BORDER}` }}>
          <p style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:TEXT_DIM, marginBottom:8 }}>Today</p>
          {STATUS_ORDER.map(code=>{
            const cnt=todayMap[code]??0;
            if(!cnt) return null;
            return <StatusRow key={code} code={code} count={cnt} type="today" />;
          })}
          {Object.keys(todayMap).length===0 && <p style={{ fontSize:12, color:TEXT_DIM, padding:"8px 0" }}>No orders today</p>}
        </div>
        <div style={{ padding:"12px 12px" }}>
          <p style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:TEXT_DIM, marginBottom:8 }}>Yesterday Pending</p>
          {STATUS_ORDER.filter(c=>ACTIVE_S.includes(c)).map(code=>{
            const cnt=yestMap[code]??0;
            if(!cnt) return null;
            return <StatusRow key={code} code={code} count={cnt} type="yest" />;
          })}
          {yestPend.length===0 && <p style={{ fontSize:12, color:TEXT_DIM, padding:"8px 0" }}>None pending</p>}
        </div>
      </div>
    </div>
  );
}

/* ─── main ───────────────────────────────────────────────────── */
export default function KpiPage() {
  const { user, loading: authLoading } = useAuth();
  const router   = useRouter();
  const now      = useClock();
  const ref      = useRef<HTMLDivElement>(null);
  const [isFs, setIsFs] = useState(false);
  const [countdown, setCountdown] = useState(REFRESH_SEC);
  const [dataLoading, setDataLoading] = useState(true);

  const [inventory,  setInventory]  = useState<Record<string,unknown>[]>([]);
  const [locations,  setLocations]  = useState<Record<string,unknown>[]>([]);
  const [b2bOrders,  setB2bOrders]  = useState<Record<string,unknown>[]>([]);
  const [b2cOrders,  setB2cOrders]  = useState<Record<string,unknown>[]>([]);
  const [clusters,   setClusters]   = useState<B2CCluster[]>([]);

  const headers = useMemo(
    (): Record<string,string> => ({
      Authorization: `Bearer ${user?.token ?? ""}`,
      "Content-Type": "application/json",
    }),
    [user]
  );

  /* fullscreen */
  function toggleFs() {
    if (!document.fullscreenElement) ref.current?.requestFullscreen();
    else document.exitFullscreen();
  }
  useEffect(() => {
    const fn = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", fn);
    return () => document.removeEventListener("fullscreenchange", fn);
  }, []);

  /* load orders — try multiple endpoints, no date filter (filter client-side) */
  async function loadOrders(type: "b2b"|"b2c"): Promise<Record<string,unknown>[]> {
    const body = { limit:2000, pageSize:2000, orderType:type.toUpperCase(), warehouseCode:"STOO1" };
    const endpoints = [
      `/api/wms/shipping/${type}/list`,
      `/api/wms/shipping/list`,
      `/api/wms/outbound/${type}/list`,
      `/api/wms/outbound/list`,
    ];
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep, { method:"POST", headers, body:JSON.stringify({ ...body, page:1 }) });
        if (!res.ok) continue;
        const json = await res.json().catch(()=>({}));
        const rows = arrOf(json);
        if (rows.length > 0) return rows;
      } catch { /* try next */ }
    }
    return [];
  }

  const load = useCallback(async () => {
    if (!user) return;
    setDataLoading(true);
    try {
      const [rInv, rLoc, b2b, b2c, rClusters] = await Promise.all([
        fetch("/api/wms/inventory/detail", { method:"POST", headers, body:JSON.stringify({ pageSize:9999, page:1 }) }).then(r=>r.json()).catch(()=>({})),
        fetch("/api/wms/warehouse/location/list", { method:"POST", headers, body:JSON.stringify({ page:1, pageSize:9999, warehouseCode:"", search:"", sortField:"WarehouseCode", sortDir:"asc" }) }).then(r=>r.json()).catch(()=>({})),
        loadOrders("b2b"),
        loadOrders("b2c"),
        fetch("/api/cluster").then(r=>r.json()).catch(()=>[]),
      ]);
      setInventory(arrOf(rInv));
      setLocations(arrOf(rLoc));
      setB2bOrders(b2b);
      setB2cOrders(b2c);
      setClusters(Array.isArray(rClusters) ? rClusters as B2CCluster[] : []);
    } catch { /* silent */ }
    setDataLoading(false);
    setCountdown(REFRESH_SEC);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, headers]);

  useEffect(() => { if (!authLoading && !user) router.replace("/login"); }, [user, authLoading, router]);
  useEffect(() => { if (user) load(); }, [user, load]);
  useEffect(() => {
    const id = setInterval(()=>setCountdown(c=>{ if(c<=1){load();return REFRESH_SEC;} return c-1; }), 1000);
    return ()=>clearInterval(id);
  }, [load]);

  /* derived */
  const today_ = todayISO(), yest_ = yesterdayISO();

  const totalQty  = useMemo(()=>inventory.reduce((s,i)=>s+(Number(i.qty)||0),0), [inventory]);
  const totalSkus = useMemo(()=>new Set(inventory.map(i=>String(i.productSku??i.sku??"")).filter(Boolean)).size, [inventory]);
  const totalLocs = locations.length;
  const norm      = (s:string)=>s.toLowerCase().replace(/[\s\-_/]+/g,"");
  const invLocSet = useMemo(()=>new Set(inventory.map(i=>norm(String(i.locationCode??i.location??""))).filter(Boolean)), [inventory]); // eslint-disable-line react-hooks/exhaustive-deps
  const occupiedLocs = useMemo(()=>locations.filter(l=>invLocSet.has(norm(String(l.locationCode??l.location??""))) || Number(l.currentQty??l.qty??0)>0).length, [locations, invLocSet]); // eslint-disable-line react-hooks/exhaustive-deps

  const b2bToday = useMemo(()=>b2bOrders.filter(o=>orderDateOf(o)===today_), [b2bOrders, today_]);
  const b2bYest  = useMemo(()=>b2bOrders.filter(o=>orderDateOf(o)===yest_),  [b2bOrders, yest_]);
  const b2cToday = useMemo(()=>b2cOrders.filter(o=>orderDateOf(o)===today_), [b2cOrders, today_]);
  const b2cYest  = useMemo(()=>b2cOrders.filter(o=>orderDateOf(o)===yest_),  [b2cOrders, yest_]);

  /* clusters today */
  const todayClusters = useMemo(()=>
    clusters
      .filter(c=>c.completedAt && isoOf(c.completedAt)===today_)
      .map(c=>({c, s:clusterStats(c)}))
      .sort((a,b)=>new Date(b.c.completedAt!).getTime()-new Date(a.c.completedAt!).getTime()),
  [clusters, today_]);

  const avgUph = useMemo(()=>{
    const v=todayClusters.filter(x=>x.s.uph!==null);
    return v.length ? Math.round(v.reduce((s,x)=>s+x.s.uph!,0)/v.length) : null;
  }, [todayClusters]);

  const totalUnitsToday  = useMemo(()=>todayClusters.reduce((s,x)=>s+x.s.units,0), [todayClusters]);
  const totalOrdersToday = useMemo(()=>todayClusters.reduce((s,x)=>s+x.s.orders,0), [todayClusters]);

  /* location by type */
  const locByType = useMemo(()=>{
    const map: Record<string,{total:number;occupied:number}> = {};
    for (const loc of locations) {
      const t = String(loc.occupancyInfo ?? loc.locationType ?? "Other");
      if (!map[t]) map[t]={total:0,occupied:0};
      map[t].total++;
      const k=norm(String(loc.locationCode??loc.location??""));
      if(invLocSet.has(k)||Number(loc.currentQty??loc.qty??0)>0) map[t].occupied++;
    }
    return Object.entries(map).sort((a,b)=>b[1].occupied-a[1].occupied);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, invLocSet]);

  /* clock */
  const timeStr = now.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
  const dateStr = now.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"});

  if (authLoading || !user) return null;

  return (
    <div ref={ref} style={{ minHeight:"100vh", background:BG, display:"flex", flexDirection:"column", fontFamily:"Inter, system-ui, sans-serif", color:"#fff" }}>

      {/* ── Header ── */}
      <header style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 20px", borderBottom:`1px solid ${BORDER}`, flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:28, height:28, borderRadius:6, background:"#1d4ed8", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          </div>
          <span style={{ fontSize:14, fontWeight:700, color:"#fff" }}>WMS · KPI Display</span>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:6, marginLeft:16, color:TEXT_DIM, fontSize:12 }}>
          {dataLoading
            ? <Loader2 style={{ width:13, height:13, color:"#3b82f6" }} className="animate-spin" />
            : <RefreshCw style={{ width:12, height:12 }} />}
          <span>Refresh in {countdown}s</span>
          <button onClick={load} style={{ marginLeft:4, color:TEXT_DIM, background:"none", border:"none", cursor:"pointer", display:"flex" }}>
            <RefreshCw style={{ width:12, height:12 }} />
          </button>
        </div>

        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ textAlign:"right" }}>
            <p style={{ fontSize:28, fontWeight:900, color:"#fff", fontVariantNumeric:"tabular-nums", lineHeight:1, letterSpacing:"0.02em" }}>{timeStr}</p>
            <p style={{ fontSize:11, color:TEXT_DIM, marginTop:2 }}>{dateStr}</p>
          </div>
          <button onClick={toggleFs} style={{ padding:8, borderRadius:8, background:"rgba(255,255,255,0.05)", border:`1px solid ${BORDER}`, color:TEXT_DIM, cursor:"pointer", display:"flex" }}>
            {isFs ? <Minimize2 style={{width:15,height:15}} /> : <Maximize2 style={{width:15,height:15}} />}
          </button>
          <button onClick={()=>router.push("/dashboard")} style={{ padding:8, borderRadius:8, background:"rgba(255,255,255,0.05)", border:`1px solid ${BORDER}`, color:TEXT_DIM, cursor:"pointer", display:"flex" }}>
            <X style={{width:15,height:15}} />
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div style={{ flex:1, overflowY:"auto", padding:"16px 20px 20px", display:"flex", flexDirection:"column", gap:14 }}>

        {/* ── Row 1: KPI tiles ── */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:12 }}>
          <BigTile label="Total Inventory" value={totalQty} sub="units on hand" accentColor="#3b82f6" />
          <BigTile label="Total SKUs"      value={totalSkus} sub="distinct products" accentColor="#8b5cf6" />
          <BigTile label="Occupied Locs"   value={`${occupiedLocs}/${totalLocs}`} sub={totalLocs>0?`${Math.round(occupiedLocs/totalLocs*100)}% utilized`:""} accentColor="#14b8a6" />
          <BigTile label="B2B Today"       value={b2bToday.length} sub={`${b2bToday.filter(o=>statusOf(o)==="FA").length} complete · ${b2bToday.filter(o=>ACTIVE_S.includes(statusOf(o))).length} active`} accentColor="#f59e0b" />
          <BigTile label="B2C Today"       value={b2cToday.length} sub={`${b2cToday.filter(o=>statusOf(o)==="FA").length} complete · ${b2cToday.filter(o=>ACTIVE_S.includes(statusOf(o))).length} active`} accentColor="#ec4899" />
          <BigTile label="Cluster Units/hr" value={avgUph!==null?avgUph:"—"} sub={todayClusters.length?`${todayClusters.length} runs · ${totalUnitsToday} units · ${totalOrdersToday} orders`:"No clusters today"} accentColor="#22c55e" />
        </div>

        {/* ── Row 2: Orders ── */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
          <OrderPanel title="B2B Orders" accentColor="#f59e0b" todayOrders={b2bToday} yestOrders={b2bYest} />
          <OrderPanel title="B2C Orders" accentColor="#ec4899" todayOrders={b2cToday} yestOrders={b2cYest} />
        </div>

        {/* ── Row 3: Location + Cluster table ── */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>

          {/* Location occupancy */}
          <div style={{ background:CARD_BG, border:`1px solid ${BORDER}`, borderTop:`3px solid #14b8a6`, borderRadius:12, overflow:"hidden" }}>
            <div style={{ padding:"12px 16px", borderBottom:`1px solid ${BORDER}`, display:"flex", alignItems:"center", gap:8 }}>
              <p style={{ fontSize:13, fontWeight:800, color:"#fff", flex:1 }}>Location Occupancy</p>
              <span style={{ fontSize:12, color:TEXT_DIM }}>{occupiedLocs} / {totalLocs}</span>
            </div>
            <div style={{ padding:"12px 16px", display:"flex", flexDirection:"column", gap:10 }}>
              {locByType.map(([type, d])=>{
                const pct=d.total>0?Math.round(d.occupied/d.total*100):0;
                const barColor=pct>=90?"#ef4444":pct>=70?"#f59e0b":"#3b82f6";
                return (
                  <div key={type}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                      <span style={{ fontSize:12, color:"#cbd5e1" }}>{type}</span>
                      <div style={{ display:"flex", gap:10 }}>
                        <span style={{ fontSize:12, color:TEXT_DIM, fontVariantNumeric:"tabular-nums" }}>{d.occupied}/{d.total}</span>
                        <span style={{ fontSize:12, fontWeight:700, color:"#fff", fontVariantNumeric:"tabular-nums", width:34, textAlign:"right" }}>{pct}%</span>
                      </div>
                    </div>
                    <div style={{ height:5, borderRadius:3, background:"rgba(255,255,255,0.07)" }}>
                      <div style={{ height:"100%", borderRadius:3, background:barColor, width:`${pct}%`, transition:"width 1s ease" }} />
                    </div>
                  </div>
                );
              })}
              {locByType.length===0 && <p style={{ fontSize:12, color:TEXT_DIM, textAlign:"center", padding:"16px 0" }}>No location data</p>}
            </div>
          </div>

          {/* Cluster pick */}
          <div style={{ background:CARD_BG, border:`1px solid ${BORDER}`, borderTop:`3px solid #22c55e`, borderRadius:12, overflow:"hidden", display:"flex", flexDirection:"column" }}>
            <div style={{ padding:"12px 16px", borderBottom:`1px solid ${BORDER}`, display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
              <p style={{ fontSize:13, fontWeight:800, color:"#fff", flex:1 }}>Cluster Pick · Today</p>
              <span style={{ fontSize:12, color:TEXT_DIM }}>Orders: <strong style={{ color:"#fff" }}>{totalOrdersToday}</strong></span>
              <span style={{ fontSize:12, color:TEXT_DIM }}>Units: <strong style={{ color:"#fff" }}>{totalUnitsToday}</strong></span>
              {avgUph!==null && <span style={{ fontSize:12, fontWeight:800, color:"#22c55e" }}>avg {avgUph} u/hr</span>}
            </div>
            {todayClusters.length===0
              ? <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <p style={{ fontSize:12, color:TEXT_DIM }}>No completed clusters today</p>
                </div>
              : <div style={{ overflowY:"auto", flex:1 }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                    <thead>
                      <tr style={{ borderBottom:`1px solid ${BORDER}` }}>
                        {["Cluster #","Orders","Units","Duration","Units/hr","Orders/hr"].map(h=>(
                          <th key={h} style={{ padding:"8px 14px", textAlign:"left", fontWeight:700, fontSize:11, letterSpacing:"0.06em", textTransform:"uppercase", color:TEXT_DIM, whiteSpace:"nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {todayClusters.map(({c,s})=>(
                        <tr key={c.id} style={{ borderBottom:`1px solid ${BORDER}` }}>
                          <td style={{ padding:"9px 14px", fontWeight:800, color:"#60a5fa", fontVariantNumeric:"tabular-nums" }}>#{String(c.clusterNo??"—").padStart(4,"0")}</td>
                          <td style={{ padding:"9px 14px", fontWeight:700, color:"#fff", fontVariantNumeric:"tabular-nums" }}>{s.orders}</td>
                          <td style={{ padding:"9px 14px", fontWeight:700, color:"#fff", fontVariantNumeric:"tabular-nums" }}>{s.units}</td>
                          <td style={{ padding:"9px 14px", color:"#94a3b8", fontVariantNumeric:"tabular-nums" }}>
                            {s.minTotal!==null ? (s.minTotal>=60?`${Math.floor(s.minTotal/60)}h ${s.minTotal%60}m`:`${s.minTotal}m`) : "—"}
                          </td>
                          <td style={{ padding:"9px 14px", fontWeight:900, fontSize:15, color: s.uph&&s.uph>0?"#22c55e":"#94a3b8", fontVariantNumeric:"tabular-nums" }}>{s.uph??"-"}</td>
                          <td style={{ padding:"9px 14px", fontWeight:700, color:"#fff", fontVariantNumeric:"tabular-nums" }}>{s.oph??"-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
            }
          </div>

        </div>
      </div>

      <footer style={{ padding:"6px 20px", borderTop:`1px solid ${BORDER}`, display:"flex", justifyContent:"space-between", fontSize:10, color:"#2a3547", flexShrink:0 }}>
        <span>Spider WMS · KPI Display</span>
        <span>Auto-refresh every {REFRESH_SEC}s</span>
      </footer>
    </div>
  );
}
