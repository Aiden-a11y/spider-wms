"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import { Maximize2, Minimize2, X, RefreshCw, Loader2 } from "lucide-react";
import type { B2CCluster } from "@/lib/b2c-cluster";

/* ─── palette ───────────────────────────────────────────────────── */
const BG   = "#080d14";
const C1   = "#0d1624";
const BRDR = "#1e2d42";
const LBL  = "#b0c4d8";  // secondary labels — visible

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

/* ─── helpers ───────────────────────────────────────────────────── */
type Row = Record<string, unknown>;

/* exact same parseList as dashboard/page.tsx */
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

/* ─── KPI card ─────────────────────────────────────────────────── */
function KpiCard({ label, value, sub }: { label:string; value:string|number; sub?:string }) {
  return (
    <div style={{ background:C1, border:`1px solid ${BRDR}`, borderRadius:0, padding:"16px 20px 12px", display:"flex", flexDirection:"column", gap:6, minWidth:0 }}>
      <p style={{ fontSize:12, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:LBL }}>{label}</p>
      <p style={{ fontSize:52, fontWeight:900, color:"#fff", lineHeight:1, fontVariantNumeric:"tabular-nums" }}>
        {typeof value==="number" ? value.toLocaleString() : value}
      </p>
      {sub && <p style={{ fontSize:13, color:LBL }}>{sub}</p>}
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
      <p style={{ fontSize:12, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:LBL, marginBottom:10 }}>
        {title}{isYest && orders.length>0 && <span style={{ color:"#fbbf24", marginLeft:6 }}>({orders.length})</span>}
      </p>
      {STATUS_ORDER
        .filter(c => isYest ? ACTIVE_S.includes(c) : true)
        .map(code => {
          const cnt = byStatus[code]??0;
          if (!cnt) return null;
          const cfg = STATUS_CFG[code]??{label:code,color:"#94a3b8"};
          return (
            <div key={code} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 10px", borderRadius:0, background:"rgba(255,255,255,0.04)", borderLeft:`3px solid ${cfg.color}`, marginBottom:4 }}>
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

  const [inventory, setInventory] = useState<Row[]>([]);
  const [locations, setLocations] = useState<Row[]>([]);
  const [b2b,      setB2b]        = useState<Row[]>([]);
  const [b2c,      setB2c]        = useState<Row[]>([]);
  const [clusters, setClusters]   = useState<B2CCluster[]>([]);

  /* match dashboard exactly — non-null token assertion after user guard */
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${user!.token}`, "Content-Type": "application/json" }),
    [user]
  );

  /* fullscreen */
  function toggleFs() {
    if (!document.fullscreenElement) ref.current?.requestFullscreen();
    else document.exitFullscreen();
  }
  useEffect(()=>{
    const fn=()=>setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange",fn);
    return ()=>document.removeEventListener("fullscreenchange",fn);
  },[]);

  /* load orders */
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
      const [rInv, rLoc, ordB2B, ordB2C, rClusters] = await Promise.all([
        fetch("/api/wms/inventory/detail", { method:"POST", headers, body:JSON.stringify({ pageSize:9999 }) })
          .then(r=>r.json()).catch(()=>({})),
        fetch("/api/wms/warehouse/location/list", { method:"POST", headers, body:JSON.stringify({ page:1, pageSize:9999, warehouseCode:"", search:"", sortField:"WarehouseCode", sortDir:"asc" }) })
          .then(r=>r.json()).catch(()=>({})),
        loadOrders("b2b"),
        loadOrders("b2c"),
        fetch("/api/cluster").then(r=>r.json()).catch(()=>[]),
      ]);

      /* exact same paths as dashboard/page.tsx */
      setInventory(parseList(rInv, ["data"], ["data","list"], ["list"], []));
      setLocations(parseList(rLoc, ["data","list"],["data"],[]));
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

  const totalQty  = useMemo(()=>inventory.reduce((s,i)=>s+(Number(i.qty)||0),0),[inventory]);
  const totalSkus = useMemo(()=>new Set(inventory.map(i=>String(i.productSku??i.sku??"")).filter(Boolean)).size,[inventory]);
  const totalLocs = locations.length;

  const norm = (s:string) => s.toLowerCase().replace(/[\s\-_/]+/g,"");
  const invSet = useMemo(()=>new Set(inventory.map(i=>norm(String(i.locationCode??i.location??""))).filter(Boolean)),[inventory]); // eslint-disable-line react-hooks/exhaustive-deps
  const occupiedLocs = useMemo(()=>locations.filter(l=>invSet.has(norm(String(l.locationCode??l.location??"")))||Number(l.currentQty??l.qty??0)>0).length,[locations,invSet]); // eslint-disable-line react-hooks/exhaustive-deps

  const b2bToday = useMemo(()=>b2b.filter(o=>orderDateOf(o)===today_),[b2b,today_]);
  const b2bYest  = useMemo(()=>b2b.filter(o=>orderDateOf(o)===yest_), [b2b,yest_]);
  const b2cToday = useMemo(()=>b2c.filter(o=>orderDateOf(o)===today_),[b2c,today_]);
  const b2cYest  = useMemo(()=>b2c.filter(o=>orderDateOf(o)===yest_), [b2c,yest_]);

  const todayC   = useMemo(()=>clusters.filter(c=>c.completedAt&&isoOf(c.completedAt)===today_).map(c=>({c,s:clusterStats(c)})).sort((a,b)=>new Date(b.c.completedAt!).getTime()-new Date(a.c.completedAt!).getTime()),[clusters,today_]);
  const avgUph       = useMemo(()=>{ const v=todayC.filter(x=>x.s.uph!==null); return v.length?Math.round(v.reduce((s,x)=>s+x.s.uph!,0)/v.length):null; },[todayC]);
  const totUnits     = useMemo(()=>todayC.reduce((s,x)=>s+x.s.units,0),[todayC]);
  const totOrders    = useMemo(()=>todayC.reduce((s,x)=>s+x.s.orders,0),[todayC]);
  const avgMinPerOrd = useMemo(()=>{
    const v = todayC.filter(x=>x.s.min!==null && x.s.orders>0);
    if(!v.length) return null;
    const total = v.reduce((s,x)=>s + x.s.min!/x.s.orders, 0);
    return Math.round(total/v.length*10)/10;
  },[todayC]);

  const locByType = useMemo(()=>{
    const m:Record<string,{t:number;o:number}>={};
    for(const l of locations){
      const k=String(l.occupancyInfo??l.locationType??"Other");
      if(!m[k]) m[k]={t:0,o:0};
      m[k].t++;
      if(invSet.has(norm(String(l.locationCode??l.location??"")))||Number(l.currentQty??l.qty??0)>0) m[k].o++;
    }
    return Object.entries(m).sort((a,b)=>b[1].o-a[1].o);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[locations,invSet]);

  const timeStr = now.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
  const dateStr = now.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"});

  if (authLoading||!user) return null;

  return (
    <div ref={ref} style={{
      width:"100vw", height:"100vh", overflow:"hidden",
      background:BG, display:"grid",
      gridTemplateRows:"72px 168px 1fr 1fr 26px",
      fontFamily:"Inter, system-ui, -apple-system, sans-serif", color:"#fff",
      boxSizing:"border-box",
    }}>

      {/* ── Header ── */}
      <header style={{ display:"flex", alignItems:"center", padding:"0 20px", borderBottom:`1px solid ${BRDR}`, gap:14 }}>
        <span style={{ fontSize:15, fontWeight:800, color:"#fff", letterSpacing:"0.04em" }}>WMS · KPI Display</span>

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
          <button onClick={toggleFs} style={{ padding:8, borderRadius:0, background:C1, border:`1px solid ${BRDR}`, color:LBL, cursor:"pointer", display:"flex" }}>
            {isFs?<Minimize2 style={{width:16,height:16}}/>:<Maximize2 style={{width:16,height:16}}/>}
          </button>
          <button onClick={()=>router.push("/dashboard")} style={{ padding:8, borderRadius:0, background:C1, border:`1px solid ${BRDR}`, color:LBL, cursor:"pointer", display:"flex" }}>
            <X style={{width:16,height:16}}/>
          </button>
        </div>
      </header>

      {/* ── KPI tiles ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:1, padding:"0", boxSizing:"border-box", borderBottom:`1px solid ${BRDR}` }}>
        <KpiCard label="Total Inventory"    value={totalQty}   sub="units on hand"/>
        <KpiCard label="Total SKUs"         value={totalSkus}  sub="distinct products"/>
        <KpiCard label="Occupied Locs"      value={`${occupiedLocs}/${totalLocs}`} sub={totalLocs>0?`${Math.round(occupiedLocs/totalLocs*100)}% utilized`:""}/>
        <KpiCard label="B2B Today"          value={b2bToday.length} sub={`${b2bToday.filter(o=>statusOf(o)==="FA").length} done · ${b2bToday.filter(o=>ACTIVE_S.includes(statusOf(o))).length} active`}/>
        <KpiCard label="B2C Today"          value={b2cToday.length} sub={`${b2cToday.filter(o=>statusOf(o)==="FA").length} done · ${b2cToday.filter(o=>ACTIVE_S.includes(statusOf(o))).length} active`}/>
        <KpiCard label="Cluster Units / hr" value={avgUph!==null?avgUph:"—"} sub={todayC.length?`${todayC.length} runs · ${totUnits} units · ${totOrders} orders`:"No clusters today"}/>
        <KpiCard label="Min / Order"        value={avgMinPerOrd!==null?avgMinPerOrd:"—"} sub={avgMinPerOrd!==null?"avg min per order":"No clusters today"}/>
      </div>

      {/* ── B2B + B2C ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:1, padding:"0", boxSizing:"border-box", minHeight:0 }}>
        <OrderPanel title="B2B Orders" todayOrders={b2bToday} yestOrders={b2bYest}/>
        <OrderPanel title="B2C Orders" todayOrders={b2cToday} yestOrders={b2cYest}/>
      </div>

      {/* ── Location + Cluster ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:1, padding:"0", boxSizing:"border-box", minHeight:0 }}>

        {/* Location occupancy */}
        <div style={{ background:C1, border:`0px solid ${BRDR}`, borderTop:`1px solid ${BRDR}`, borderRadius:0, display:"flex", flexDirection:"column", minHeight:0, overflow:"hidden" }}>
          <div style={{ padding:"10px 18px", borderBottom:`1px solid ${BRDR}`, display:"flex", alignItems:"center", flexShrink:0 }}>
            <p style={{ fontSize:17, fontWeight:800, color:"#fff", flex:1 }}>Location Occupancy</p>
            <span style={{ fontSize:14, color:LBL }}>{occupiedLocs} / {totalLocs} used</span>
          </div>
          <div style={{ flex:1, overflowY:"auto", padding:"10px 18px", display:"flex", flexDirection:"column", gap:8 }}>
            {locByType.map(([type,d])=>{
              const pct=d.t>0?Math.round(d.o/d.t*100):0;
              const bar=pct>=90?"#ef4444":pct>=70?"#f59e0b":"#3b82f6";
              return (
                <div key={type}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                    <span style={{ fontSize:14, color:"#fff", fontWeight:600 }}>{type}</span>
                    <div style={{ display:"flex", gap:14 }}>
                      <span style={{ fontSize:14, color:LBL, fontVariantNumeric:"tabular-nums" }}>{d.o}/{d.t}</span>
                      <span style={{ fontSize:15, fontWeight:900, color:"#fff", fontVariantNumeric:"tabular-nums", width:38, textAlign:"right" }}>{pct}%</span>
                    </div>
                  </div>
                  <div style={{ height:5, borderRadius:0, background:"rgba(255,255,255,0.07)" }}>
                    <div style={{ height:"100%", borderRadius:0, background:bar, width:`${pct}%`, transition:"width 1s ease" }}/>
                  </div>
                </div>
              );
            })}
            {locByType.length===0 && <p style={{ fontSize:14, color:LBL, textAlign:"center", paddingTop:20 }}>No location data</p>}
          </div>
        </div>

        {/* Cluster pick */}
        <div style={{ background:C1, borderTop:`1px solid ${BRDR}`, borderLeft:`1px solid ${BRDR}`, borderRadius:0, display:"flex", flexDirection:"column", minHeight:0, overflow:"hidden" }}>
          <div style={{ padding:"10px 18px", borderBottom:`1px solid ${BRDR}`, display:"flex", alignItems:"center", gap:20, flexShrink:0 }}>
            <p style={{ fontSize:17, fontWeight:800, color:"#fff", flex:1 }}>Cluster Pick · Today</p>
            <span style={{ fontSize:14, color:LBL }}>Orders <strong style={{ color:"#fff", fontSize:17 }}>{totOrders}</strong></span>
            <span style={{ fontSize:14, color:LBL }}>Units <strong style={{ color:"#fff", fontSize:17 }}>{totUnits}</strong></span>
            {avgUph!==null && <span style={{ fontSize:15, fontWeight:800, color:"#4ade80" }}>avg {avgUph} u/hr</span>}
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
                        <th key={h} style={{ padding:"9px 16px", textAlign:"left", fontSize:12, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:LBL, whiteSpace:"nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {todayC.map(({c,s})=>(
                      <tr key={c.id} style={{ borderBottom:`1px solid ${BRDR}` }}>
                        <td style={{ padding:"10px 16px", fontWeight:800, color:"#60a5fa", fontVariantNumeric:"tabular-nums", fontSize:15 }}>#{String(c.clusterNo??"").padStart(4,"0")}</td>
                        <td style={{ padding:"10px 16px", fontWeight:700, color:"#fff", fontSize:16, fontVariantNumeric:"tabular-nums" }}>{s.orders}</td>
                        <td style={{ padding:"10px 16px", fontWeight:700, color:"#fff", fontSize:16, fontVariantNumeric:"tabular-nums" }}>{s.units}</td>
                        <td style={{ padding:"10px 16px", color:"#fff", fontSize:15, fontVariantNumeric:"tabular-nums" }}>
                          {s.min!==null?(s.min>=60?`${Math.floor(s.min/60)}h ${s.min%60}m`:`${s.min}m`):"—"}
                        </td>
                        <td style={{ padding:"10px 16px", fontWeight:900, fontSize:24, color:s.uph&&s.uph>0?"#4ade80":"#475569", fontVariantNumeric:"tabular-nums" }}>{s.uph??"-"}</td>
                        <td style={{ padding:"10px 16px", fontWeight:700, color:"#fff", fontSize:16, fontVariantNumeric:"tabular-nums" }}>{s.oph??"-"}</td>
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
        <span>Auto-refresh every {REFRESH_SEC}s</span>
      </footer>
    </div>
  );
}
