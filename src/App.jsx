// src/App.jsx
// Reemplazar todo el contenido del archivo con este código.
// Requiere: npm install @supabase/supabase-js

import { useState, useEffect } from "react";
import { supabase } from "./supabase";

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const TRUCK_CAPACITY = 8;
const STATUS_CONFIG = {
  pendiente:   { label:"Pendiente",   color:"#F59E0B", bg:"#FEF3C7", dot:"#F59E0B" },
  en_planta:   { label:"En Planta",   color:"#3B82F6", bg:"#DBEAFE", dot:"#3B82F6" },
  en_ruta:     { label:"En Ruta",     color:"#8B5CF6", bg:"#EDE9FE", dot:"#8B5CF6" },
  descargando: { label:"Descargando", color:"#F97316", bg:"#FFEDD5", dot:"#F97316" },
  completado:  { label:"Completado",  color:"#10B981", bg:"#D1FAE5", dot:"#10B981" },
  cancelado:   { label:"Cancelado",   color:"#EF4444", bg:"#FEE2E2", dot:"#EF4444" },
};
const STATUS_FLOW = ["pendiente","en_planta","en_ruta","descargando","completado"];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function genId() { return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function fmtTime(ts) { return new Date(ts).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}); }
function fmtDate(ts) { return new Date(ts).toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit",year:"numeric"}); }
function dayKey(ts) { const d=new Date(ts); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function parseDay(k) { const [y,m,d]=k.split("-").map(Number); return new Date(y,m-1,d); }
function estDuration(m3) { return (m3*10+60)*60000; }
function overlaps(s1,e1,s2,e2) { return s1<e2&&e1>s2; }
function truckConflicts(turns,truck,scheduledAt,m3,editId=null) {
  const s1=scheduledAt,e1=scheduledAt+estDuration(m3);
  return turns.filter(t=>t.id!==editId&&!["cancelado"].includes(t.status)&&Array.isArray(t.trucks)&&t.trucks.includes(truck)&&overlaps(s1,e1,t.scheduledAt,t.scheduledAt+estDuration(t.m3)));
}

// Supabase devuelve snake_case, convertimos a camelCase
function dbToTurn(row) {
  return {
    id:          row.id,
    client:      row.client,
    plant:       row.plant,
    trucks:      row.trucks,
    m3:          row.m3,
    status:      row.status,
    operator:    row.operator,
    destination: row.destination,
    notes:       row.notes||"",
    scheduledAt: row.scheduled_at,
    createdAt:   row.created_at,
  };
}
function turnToDb(t) {
  return {
    id:           t.id,
    client:       t.client,
    plant:        t.plant,
    trucks:       t.trucks,
    m3:           t.m3,
    status:       t.status,
    operator:     t.operator,
    destination:  t.destination,
    notes:        t.notes||"",
    scheduled_at: t.scheduledAt,
    created_at:   t.createdAt,
  };
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [currentUser,setCurrentUser] = useState(null);
  const [turns,setTurns]   = useState([]);
  const [plants,setPlants] = useState([]);
  const [trucks,setTrucks] = useState([]);
  const [users,setUsers]   = useState([]);
  const [loading,setLoading] = useState(true);

  const [view,setView]               = useState("dashboard");
  const [showForm,setShowForm]       = useState(false);
  const [editingTurn,setEditingTurn] = useState(null);
  const [showSettings,setShowSettings] = useState(false);
  const [filterStatus,setFilterStatus] = useState("all");
  const [filterPlant,setFilterPlant]   = useState("all");
  const [filterTruck,setFilterTruck]   = useState("all");
  const [calendarDay,setCalendarDay]   = useState(dayKey(Date.now()));
  const [dashDay,setDashDay]           = useState(dayKey(Date.now()));
  const [now,setNow] = useState(Date.now());

  // ── Cargar datos iniciales ──
  useEffect(()=>{
    async function load() {
      setLoading(true);
      // Config
      const {data:cfg} = await supabase.from("config").select("*");
      if (cfg) {
        cfg.forEach(row=>{
          if(row.key==="plants") setPlants(row.value);
          if(row.key==="trucks") setTrucks(row.value);
          if(row.key==="users")  setUsers(row.value);
        });
      }
      // Turnos
      const {data:dbTurns} = await supabase.from("turns").select("*").order("scheduled_at");
      if (dbTurns) setTurns(dbTurns.map(dbToTurn));
      setLoading(false);
    }
    load();
  },[]);

  // ── Suscripción en tiempo real para turnos ──
  useEffect(()=>{
    const channel = supabase
      .channel("turns-realtime")
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"turns"},payload=>{
        setTurns(p=>[...p,dbToTurn(payload.new)]);
      })
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"turns"},payload=>{
        setTurns(p=>p.map(t=>t.id===payload.new.id?dbToTurn(payload.new):t));
      })
      .on("postgres_changes",{event:"DELETE",schema:"public",table:"turns"},payload=>{
        setTurns(p=>p.filter(t=>t.id!==payload.old.id));
      })
      .subscribe();
    return ()=>supabase.removeChannel(channel);
  },[]);

  // ── Suscripción en tiempo real para config ──
  useEffect(()=>{
    const channel = supabase
      .channel("config-realtime")
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"config"},payload=>{
        const row=payload.new;
        if(row.key==="plants") setPlants(row.value);
        if(row.key==="trucks") setTrucks(row.value);
        if(row.key==="users")  setUsers(row.value);
      })
      .subscribe();
    return ()=>supabase.removeChannel(channel);
  },[]);

  useEffect(()=>{ const i=setInterval(()=>setNow(Date.now()),30000); return()=>clearInterval(i); },[]);

  // ── Helpers para config en Supabase ──
  async function saveConfig(key,value) {
    await supabase.from("config").update({value}).eq("key",key);
  }

  // ── CRUD de turnos ──
  async function handleSaveTurn(data) {
    if (editingTurn) {
      const updated = {...editingTurn,...data};
      await supabase.from("turns").update(turnToDb(updated)).eq("id",editingTurn.id);
    } else {
      const newTurn = {id:genId(),...data,createdAt:Date.now(),operator:currentUser};
      await supabase.from("turns").insert(turnToDb(newTurn));
    }
    setShowForm(false); setEditingTurn(null);
  }
  async function handleAdvance(id) {
    const t=turns.find(x=>x.id===id); if(!t)return;
    const idx=STATUS_FLOW.indexOf(t.status);
    if(idx<STATUS_FLOW.length-1){
      await supabase.from("turns").update({status:STATUS_FLOW[idx+1]}).eq("id",id);
    }
  }
  async function handleCancel(id) {
    await supabase.from("turns").update({status:"cancelado"}).eq("id",id);
  }
  async function handleDelete(id) {
    await supabase.from("turns").delete().eq("id",id);
  }

  // ── Config: plants / trucks / users ──
  async function renamePlant(o,n) {
    const next=plants.map(x=>x===o?n:x);
    setPlants(next); await saveConfig("plants",next);
    // actualizar turnos afectados
    const affected=turns.filter(t=>t.plant===o);
    for(const t of affected) await supabase.from("turns").update({plant:n}).eq("id",t.id);
  }
  async function renameTruck(o,n) {
    const next=trucks.map(x=>x===o?n:x);
    setTrucks(next); await saveConfig("trucks",next);
    const affected=turns.filter(t=>(t.trucks||[]).includes(o));
    for(const t of affected) await supabase.from("turns").update({trucks:(t.trucks||[]).map(x=>x===o?n:x)}).eq("id",t.id);
  }
  async function renameUser(o,n) {
    const next=users.map(x=>x===o?n:x);
    setUsers(next); await saveConfig("users",next);
    const affected=turns.filter(t=>t.operator===o);
    for(const t of affected) await supabase.from("turns").update({operator:n}).eq("id",t.id);
    if(currentUser===o) setCurrentUser(n);
  }
  async function addPlant(v) { if(plants.includes(v))return; const next=[...plants,v]; setPlants(next); await saveConfig("plants",next); }
  async function addTruck(v) { if(trucks.includes(v))return; const next=[...trucks,v]; setTrucks(next); await saveConfig("trucks",next); }
  async function addUser(v)  { if(users.includes(v))return;  const next=[...users,v];  setUsers(next);  await saveConfig("users",next); }
  async function removePlant(v) { const next=plants.filter(x=>x!==v); setPlants(next); await saveConfig("plants",next); await supabase.from("turns").delete().eq("plant",v); }
  async function removeTruck(v) { const next=trucks.filter(x=>x!==v); setTrucks(next); await saveConfig("trucks",next); }
  async function removeUser(v)  { const next=users.filter(x=>x!==v);  setUsers(next);  await saveConfig("users",next); }

  // ── Stats del dashboard filtradas por día ──
  const dashDayTurns = turns.filter(t=>dayKey(t.scheduledAt)===dashDay);
  const stats = {
    total:     dashDayTurns.length,
    active:    dashDayTurns.filter(t=>!["completado","cancelado"].includes(t.status)).length,
    completed: dashDayTurns.filter(t=>t.status==="completado").length,
    m3Today:   dashDayTurns.filter(t=>t.status==="completado").reduce((s,t)=>s+t.m3,0),
  };

  const filteredTurns = turns.filter(t=>{
    if(filterStatus!=="all" && t.status!==filterStatus) return false;
    if(filterPlant!=="all"  && t.plant!==filterPlant)   return false;
    if(filterTruck!=="all"  && !(t.trucks||[]).includes(filterTruck)) return false;
    return true;
  });

  if (loading) return (
    <div style={{...S.loginBg,flexDirection:"column",gap:16}}>
      <div style={{fontSize:48,color:C.accent}}>⬡</div>
      <div style={{fontSize:18,color:C.text,fontWeight:700}}>Cargando HormiTurn…</div>
      <div style={{fontSize:13,color:C.muted}}>Conectando con la base de datos</div>
    </div>
  );

  if (!currentUser) return <LoginScreen users={users} onLogin={setCurrentUser}/>;

  return (
    <div style={S.app}>
      <aside style={S.sidebar}>
        <div style={S.sidebarLogo}>
          <div style={S.logoIcon}>⬡</div>
          <div><div style={S.logoTitle}>HormiTurn</div><div style={S.logoSub}>Gestión de Despacho</div></div>
        </div>
        <nav style={S.nav}>
          {[{key:"dashboard",icon:"◈",label:"Dashboard"},{key:"turns",icon:"≡",label:"Turnos"},{key:"calendar",icon:"▦",label:"Calendario"},{key:"trucks",icon:"◉",label:"Camiones"},{key:"plants",icon:"⬟",label:"Plantas"}].map(item=>(
            <button key={item.key} onClick={()=>setView(item.key)} style={{...S.navItem,...(view===item.key?S.navItemActive:{})}}><span style={S.navIcon}>{item.icon}</span>{item.label}</button>
          ))}
          <button onClick={()=>setShowSettings(true)} style={{...S.navItem,marginTop:"auto"}}><span style={S.navIcon}>⚙</span>Configuración</button>
        </nav>
        <div style={S.sidebarFooter}>
          <div style={S.userBadge}>
            <div style={S.userAvatar}>{currentUser[0]}</div>
            <div><div style={S.userName}>{currentUser}</div><div style={S.userRole}>En línea</div></div>
          </div>
          <button onClick={()=>setCurrentUser(null)} style={S.logoutBtn}>← Salir</button>
        </div>
      </aside>

      <main style={S.main}>
        <header style={S.header}>
          <div>
            <h1 style={S.pageTitle}>{{dashboard:"Dashboard",turns:"Turnos",calendar:"Calendario",trucks:"Camiones",plants:"Plantas"}[view]}</h1>
            <div style={S.pageDate}>{fmtDate(now)} · {fmtTime(now)}</div>
          </div>
          {(view==="turns"||view==="calendar")&&(
            <button onClick={()=>{setEditingTurn(null);setShowForm(true);}} style={S.btnPrimary}>+ Nuevo Turno</button>
          )}
        </header>
        <div style={S.content}>
          {view==="dashboard" && <DashboardView stats={stats} turns={dashDayTurns} allTurns={turns} trucks={trucks} onAdvance={handleAdvance} dashDay={dashDay} setDashDay={setDashDay}/>}
          {view==="turns"     && <TurnsView turns={filteredTurns} filterStatus={filterStatus} setFilterStatus={setFilterStatus} filterPlant={filterPlant} setFilterPlant={setFilterPlant} filterTruck={filterTruck} setFilterTruck={setFilterTruck} plants={plants} trucks={trucks} onAdvance={handleAdvance} onEdit={t=>{setEditingTurn(t);setShowForm(true);}} onCancel={handleCancel} onDelete={handleDelete}/>}
          {view==="calendar"  && <CalendarView turns={turns} selectedDay={calendarDay} setSelectedDay={setCalendarDay} onAdvance={handleAdvance} onEdit={t=>{setEditingTurn(t);setShowForm(true);}} onCancel={handleCancel}/>}
          {view==="trucks"    && <TrucksView turns={turns} trucks={trucks}/>}
          {view==="plants"    && <PlantsView turns={turns} plants={plants} trucks={trucks}/>}
        </div>
      </main>

      {showForm&&<TurnForm initial={editingTurn} plants={plants} trucks={trucks} users={users} allTurns={turns} currentUser={currentUser} onSave={handleSaveTurn} onClose={()=>{setShowForm(false);setEditingTurn(null);}}/>}
      {showSettings&&<SettingsModal plants={plants} trucks={trucks} users={users} onRenamePlant={renamePlant} onRenameTruck={renameTruck} onRenameUser={renameUser} onAddPlant={addPlant} onAddTruck={addTruck} onAddUser={addUser} onRemovePlant={removePlant} onRemoveTruck={removeTruck} onRemoveUser={removeUser} onClose={()=>setShowSettings(false)}/>}
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginScreen({users,onLogin}) {
  const [sel,setSel]=useState(null);
  return (
    <div style={S.loginBg}>
      <div style={S.loginCard}>
        <div style={S.loginLogo}>⬡</div>
        <h1 style={S.loginTitle}>HormiTurn</h1>
        <p style={S.loginSub}>Sistema de Gestión de Despacho de Hormigón</p>
        <p style={S.loginLabel}>Seleccione su usuario</p>
        <div style={S.loginUsers}>{users.map(u=><button key={u} onClick={()=>setSel(u)} style={{...S.loginUser,...(sel===u?S.loginUserActive:{})}}><div style={S.loginUserAvatar}>{u[0]}</div><span>{u}</span></button>)}</div>
        <button disabled={!sel} onClick={()=>onLogin(sel)} style={{...S.btnPrimary,width:"100%",opacity:sel?1:.4,marginTop:8}}>Ingresar →</button>
      </div>
    </div>
  );
}

// ─── SETTINGS ────────────────────────────────────────────────────────────────
function EditableList({items,onRename,onAdd,onRemove,label,placeholder}) {
  const [editing,setEditing]=useState(null);
  const [newVal,setNewVal]=useState("");
  const [adding,setAdding]=useState(false);
  return (
    <div style={{marginBottom:24}}>
      <div style={{...S.panelTitle,marginBottom:10}}>{label}</div>
      {items.map((item,i)=>(
        <div key={i} style={S.settingsRow}>
          {editing?.idx===i
            ?<><input value={editing.val} onChange={e=>setEditing({idx:i,val:e.target.value})} style={{...S.input,flex:1,padding:"5px 10px",fontSize:13}} autoFocus onKeyDown={e=>{if(e.key==="Enter"&&editing.val.trim()){onRename(item,editing.val.trim());setEditing(null);}if(e.key==="Escape")setEditing(null);}}/><button onClick={()=>{if(editing.val.trim())onRename(item,editing.val.trim());setEditing(null);}} style={S.btnSave}>✓</button><button onClick={()=>setEditing(null)} style={S.btnCancelSm}>✕</button></>
            :<><span style={{flex:1,fontSize:14}}>{item}</span><button onClick={()=>setEditing({idx:i,val:item})} style={S.btnEdit}>✎</button><button onClick={()=>onRemove(item)} style={S.btnDangerSm}>✕</button></>
          }
        </div>
      ))}
      {adding
        ?<div style={S.settingsRow}><input value={newVal} onChange={e=>setNewVal(e.target.value)} placeholder={placeholder} style={{...S.input,flex:1,padding:"5px 10px",fontSize:13}} autoFocus onKeyDown={e=>{if(e.key==="Enter"&&newVal.trim()){onAdd(newVal.trim());setNewVal("");setAdding(false);}if(e.key==="Escape"){setAdding(false);setNewVal("");}}}/><button onClick={()=>{if(newVal.trim()){onAdd(newVal.trim());setNewVal("");setAdding(false);}}} style={S.btnSave}>✓</button><button onClick={()=>{setAdding(false);setNewVal("");}} style={S.btnCancelSm}>✕</button></div>
        :<button onClick={()=>setAdding(true)} style={S.btnAddItem}>+ Agregar</button>
      }
    </div>
  );
}
function SettingsModal({plants,trucks,users,onRenamePlant,onRenameTruck,onRenameUser,onAddPlant,onAddTruck,onAddUser,onRemovePlant,onRemoveTruck,onRemoveUser,onClose}) {
  const [tab,setTab]=useState("plants");
  return (
    <div style={S.modalOverlay}>
      <div style={{...S.modal,maxWidth:520}}>
        <div style={S.modalHeader}><h2 style={S.modalTitle}>⚙ Configuración</h2><button onClick={onClose} style={S.modalClose}>✕</button></div>
        <div style={{display:"flex",gap:4,padding:"14px 24px 0",borderBottom:`1px solid ${C.border}`}}>
          {[["plants","🏭 Plantas"],["trucks","🚛 Camiones"],["users","👤 Operadores"]].map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)} style={{...S.tabBtn,...(tab===k?S.tabBtnActive:{})}}>{l}</button>
          ))}
        </div>
        <div style={{padding:24}}>
          {tab==="plants"&&<EditableList items={plants} onRename={onRenamePlant} onAdd={onAddPlant} onRemove={onRemovePlant} label="Plantas" placeholder="Nueva planta…"/>}
          {tab==="trucks"&&<EditableList items={trucks} onRename={onRenameTruck} onAdd={onAddTruck} onRemove={onRemoveTruck} label="Camiones" placeholder="Nuevo camión…"/>}
          {tab==="users" &&<EditableList items={users}  onRename={onRenameUser}  onAdd={onAddUser}  onRemove={onRemoveUser}  label="Operadores" placeholder="Nuevo operador…"/>}
          <p style={{fontSize:12,color:C.muted,marginTop:4}}>Los cambios se sincronizan para todos los usuarios.</p>
        </div>
        <div style={S.modalFooter}><button onClick={onClose} style={S.btnPrimary}>Listo</button></div>
      </div>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function DashboardView({stats,turns,allTurns,trucks,onAdvance,dashDay,setDashDay}) {
  const today=dayKey(Date.now());
  const refDate=new Date(); refDate.setHours(0,0,0,0);
  const weekDays=Array.from({length:15},(_,i)=>{ const d=new Date(refDate); d.setDate(d.getDate()+i-7); return dayKey(d.getTime()); });
  const hasAct=k=>allTurns.some(t=>dayKey(t.scheduledAt)===k);
  const active=turns.filter(t=>!["completado","cancelado"].includes(t.status));
  return (
    <div>
      <div style={{...S.panel,marginBottom:20,padding:"14px 16px"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
          <span style={{fontSize:13,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:.5}}>Filtrando por día</span>
          {dashDay!==today&&<button onClick={()=>setDashDay(today)} style={{...S.btnEdit,fontSize:11,padding:"2px 8px"}}>Hoy</button>}
        </div>
        <div style={{display:"flex",gap:5,overflowX:"auto",paddingBottom:4}}>
          {weekDays.map(k=>{ const d=parseDay(k); const isSel=k===dashDay; const isToday=k===today;
            return <button key={k} onClick={()=>setDashDay(k)} style={{...S.calDayBtn,...(isSel?S.calDayBtnActive:{}),...(isToday&&!isSel?S.calDayBtnToday:{}),minWidth:50}}>
              <span style={{fontSize:9,fontWeight:600,textTransform:"uppercase",opacity:.7}}>{d.toLocaleDateString("es-AR",{weekday:"short"})}</span>
              <span style={{fontSize:15,fontWeight:700}}>{String(d.getDate()).padStart(2,"0")}</span>
              {hasAct(k)&&<div style={{...S.calDot,...(isSel?{background:"#fff"}:{})}}/>}
            </button>; })}
        </div>
      </div>
      <div style={S.statsGrid}>
        {[{label:"Turnos Activos",value:stats.active,icon:"◎",color:"#3B82F6"},{label:"Completados",value:stats.completed,icon:"✓",color:"#10B981"},{label:"m³ Despachados",value:stats.m3Today,icon:"⬡",color:"#8B5CF6"},{label:"Total del día",value:stats.total,icon:"≡",color:"#F59E0B"}].map((s,i)=>(
          <div key={i} style={S.statCard}><div style={{...S.statIcon,color:s.color}}>{s.icon}</div><div style={S.statValue}>{s.value}</div><div style={S.statLabel}>{s.label}</div></div>
        ))}
      </div>
      <div style={S.dashGrid}>
        <div style={S.panel}>
          <h2 style={S.panelTitle}>Turnos en Curso</h2>
          {active.length===0?<div style={S.empty}>Sin turnos activos en este día</div>:active.map(t=><TurnCard key={t.id} turn={t} onAdvance={onAdvance} compact/>)}
        </div>
        <div style={S.panel}>
          <h2 style={S.panelTitle}>Estado de Camiones</h2>
          {trucks.map(tr=>{ const act=allTurns.find(t=>(t.trucks||[]).includes(tr)&&!["completado","cancelado"].includes(t.status)); const cfg=act?STATUS_CONFIG[act.status]:{label:"Libre",color:"#10B981",bg:"#D1FAE5"};
            return <div key={tr} style={S.truckRow}><div style={S.truckIcon}>🚛</div><div style={{flex:1}}><div style={S.truckName}>{tr}</div>{act&&<div style={S.truckClient}>{act.client} · {act.m3}m³</div>}</div><div style={{...S.badge,background:cfg.bg,color:cfg.color}}>{cfg.label}</div></div>; })}
        </div>
      </div>
    </div>
  );
}

// ─── TURNS VIEW ───────────────────────────────────────────────────────────────
function TurnsView({turns,filterStatus,setFilterStatus,filterPlant,setFilterPlant,filterTruck,setFilterTruck,plants,trucks,onAdvance,onEdit,onCancel,onDelete}) {
  return (
    <div>
      <div style={S.filters}>
        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={S.select}><option value="all">Todos los estados</option>{Object.entries(STATUS_CONFIG).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select>
        <select value={filterPlant}  onChange={e=>setFilterPlant(e.target.value)}  style={S.select}><option value="all">Todas las plantas</option>{plants.map(p=><option key={p} value={p}>{p}</option>)}</select>
        <select value={filterTruck}  onChange={e=>setFilterTruck(e.target.value)}  style={S.select}><option value="all">Todos los camiones</option>{trucks.map(t=><option key={t} value={t}>{t}</option>)}</select>
      </div>
      {turns.length===0&&<div style={S.empty}>Sin turnos con los filtros seleccionados</div>}
      <div style={{display:"flex",flexDirection:"column",gap:12}}>{turns.map(t=><TurnCard key={t.id} turn={t} onAdvance={onAdvance} onEdit={onEdit} onCancel={onCancel} onDelete={onDelete}/>)}</div>
    </div>
  );
}

// ─── TURN CARD ────────────────────────────────────────────────────────────────
function TurnCard({turn:t,onAdvance,onEdit,onCancel,onDelete,compact}) {
  const cfg=STATUS_CONFIG[t.status];
  const canAdv=STATUS_FLOW.includes(t.status)&&t.status!=="completado";
  const truckList=(t.trucks||[]).join(", ");
  return (
    <div style={S.turnCard}>
      <div style={S.turnCardTop}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{...S.statusDot,background:cfg.dot}}/>
          <div><div style={S.turnClient}>{t.client}</div><div style={S.turnMeta}>{t.plant} · {truckList} · {t.m3}m³ · {fmtTime(t.scheduledAt)}</div></div>
        </div>
        <div style={{...S.badge,background:cfg.bg,color:cfg.color}}>{cfg.label}</div>
      </div>
      {!compact&&<div style={S.turnDetails}><span>📍 {t.destination}</span><span>👤 {t.operator}</span>{t.notes&&<span>📝 {t.notes}</span>}</div>}
      {!compact&&<div style={S.turnActions}>
        {canAdv&&<button onClick={()=>onAdvance(t.id)} style={S.btnAdvance}>→ {STATUS_CONFIG[STATUS_FLOW[STATUS_FLOW.indexOf(t.status)+1]]?.label}</button>}
        {onEdit&&!["completado","cancelado"].includes(t.status)&&<button onClick={()=>onEdit(t)} style={S.btnSecondary}>Editar</button>}
        {onCancel&&!["completado","cancelado"].includes(t.status)&&<button onClick={()=>onCancel(t.id)} style={S.btnDanger}>Cancelar</button>}
        {onDelete&&["completado","cancelado"].includes(t.status)&&<button onClick={()=>onDelete(t.id)} style={S.btnDanger}>Eliminar</button>}
      </div>}
      {compact&&canAdv&&<div style={{marginTop:8}}><button onClick={()=>onAdvance(t.id)} style={S.btnAdvance}>→ {STATUS_CONFIG[STATUS_FLOW[STATUS_FLOW.indexOf(t.status)+1]]?.label}</button></div>}
    </div>
  );
}

// ─── CALENDAR VIEW ────────────────────────────────────────────────────────────
function CalendarView({turns,selectedDay,setSelectedDay,onAdvance,onEdit,onCancel}) {
  const today=dayKey(Date.now());
  const refDate=new Date(); refDate.setHours(0,0,0,0);
  const weekDays=Array.from({length:14},(_,i)=>{ const d=new Date(refDate); d.setDate(d.getDate()+i-3); return dayKey(d.getTime()); });
  const dayTurns=turns.filter(t=>dayKey(t.scheduledAt)===selectedDay).sort((a,b)=>a.scheduledAt-b.scheduledAt);
  const HOUR_H=60,START_H=6,END_H=22,totalH=END_H-START_H;
  const hours=Array.from({length:totalH+1},(_,i)=>START_H+i);
  const nowD=new Date(); const nowFrac=(nowD.getHours()+nowD.getMinutes()/60-START_H)/totalH;
  const showNow=selectedDay===today&&nowFrac>=0&&nowFrac<=1;
  function assignCols(turns) {
    const cols=[]; const assigned=turns.map(t=>{ const s=new Date(t.scheduledAt); const sm=s.getHours()*60+s.getMinutes(); const em=sm+Math.max(60,t.m3*10); let col=0; while(cols[col]&&cols[col]>sm)col++; cols[col]=em; return {...t,col,startMin:sm,endMin:em}; });
    return {assigned,totalCols:Math.max(0,...assigned.map(t=>t.col))+1};
  }
  const {assigned,totalCols}=assignCols(dayTurns);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16,height:"100%"}}>
      <div style={S.calDayStrip}>
        {weekDays.map(k=>{ const d=parseDay(k); const isSel=k===selectedDay; const isToday=k===today; const hasAct=turns.some(t=>dayKey(t.scheduledAt)===k);
          return <button key={k} onClick={()=>setSelectedDay(k)} style={{...S.calDayBtn,...(isSel?S.calDayBtnActive:{}),...(isToday&&!isSel?S.calDayBtnToday:{})}}>
            <span style={{fontSize:10,fontWeight:600,textTransform:"uppercase",opacity:.7}}>{d.toLocaleDateString("es-AR",{weekday:"short"})}</span>
            <span style={{fontSize:16,fontWeight:700}}>{String(d.getDate()).padStart(2,"0")}</span>
            {hasAct&&<div style={{...S.calDot,...(isSel?{background:"#fff"}:{})}}/>}
          </button>; })}
      </div>
      <div style={{...S.panel,flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <h2 style={{...S.panelTitle,margin:0}}>{parseDay(selectedDay).toLocaleDateString("es-AR",{weekday:"long",day:"2-digit",month:"long",year:"numeric"})}</h2>
          <span style={{fontSize:13,color:C.muted}}>{dayTurns.length} turno{dayTurns.length!==1?"s":""}</span>
        </div>
        {dayTurns.length===0?<div style={{...S.empty,flex:1,display:"flex",alignItems:"center",justifyContent:"center"}}>Sin turnos para este día</div>
          :<div style={{flex:1,overflowY:"auto",position:"relative"}}>
            <div style={{display:"flex",position:"relative",minHeight:totalH*HOUR_H}}>
              <div style={{width:46,flexShrink:0,position:"relative"}}>
                {hours.map(h=><div key={h} style={{position:"absolute",top:(h-START_H)*HOUR_H-8,right:8,fontSize:11,color:C.muted,userSelect:"none"}}>{String(h).padStart(2,"0")}:00</div>)}
              </div>
              <div style={{flex:1,position:"relative"}}>
                {hours.map(h=><div key={h} style={{position:"absolute",top:(h-START_H)*HOUR_H,left:0,right:0,borderTop:`1px solid ${C.border}`,pointerEvents:"none"}}/>)}
                {hours.slice(0,-1).map(h=><div key={h+"h"} style={{position:"absolute",top:(h-START_H)*HOUR_H+HOUR_H/2,left:0,right:0,borderTop:`1px dashed ${C.border}44`,pointerEvents:"none"}}/>)}
                {showNow&&<div style={{position:"absolute",top:nowFrac*totalH*HOUR_H,left:0,right:0,borderTop:"2px solid #EF4444",zIndex:10,pointerEvents:"none"}}><div style={{position:"absolute",left:-4,top:-5,width:8,height:8,borderRadius:"50%",background:"#EF4444"}}/></div>}
                {assigned.map(t=>{ const cfg=STATUS_CONFIG[t.status]; const topPx=(t.startMin/60-START_H)*HOUR_H; const hPx=Math.max(36,(t.endMin-t.startMin)/60*HOUR_H-4); const cW=100/totalCols; const canAdv=STATUS_FLOW.includes(t.status)&&t.status!=="completado";
                  return <div key={t.id} style={{position:"absolute",top:topPx+2,height:hPx,left:`calc(${t.col*cW}% + 2px)`,width:`calc(${cW}% - 4px)`,background:cfg.bg,border:`1.5px solid ${cfg.color}55`,borderLeft:`4px solid ${cfg.color}`,borderRadius:8,padding:"6px 8px",overflow:"hidden",cursor:"pointer",boxSizing:"border-box",zIndex:2}}>
                    <div style={{fontSize:11,fontWeight:800,color:cfg.color}}>{fmtTime(t.scheduledAt)}</div>
                    <div style={{fontSize:12,fontWeight:700,color:"#1a1a2e",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.client}</div>
                    <div style={{fontSize:10,color:"#555",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{(t.trucks||[]).join(", ")} · {t.m3}m³</div>
                    {hPx>90&&<div style={{display:"flex",gap:4,marginTop:6,flexWrap:"wrap"}}>
                      {canAdv&&<button onClick={e=>{e.stopPropagation();onAdvance(t.id);}} style={{...S.calEventBtn,background:cfg.color,color:"#fff",fontSize:9}}>→ Avanzar</button>}
                      <button onClick={e=>{e.stopPropagation();onEdit(t);}} style={{...S.calEventBtn,fontSize:9}}>✎</button>
                    </div>}
                  </div>; })}
              </div>
            </div>
          </div>}
      </div>
      {dayTurns.length>0&&<div style={{...S.panel,maxHeight:220,overflowY:"auto"}}>
        <div style={{...S.panelTitle,marginBottom:10}}>Detalle del día</div>
        {dayTurns.map(t=><TurnCard key={t.id} turn={t} onAdvance={onAdvance} onEdit={onEdit} onCancel={onCancel} compact/>)}
      </div>}
    </div>
  );
}

// ─── TRUCKS & PLANTS ─────────────────────────────────────────────────────────
function TrucksView({turns,trucks}) {
  return <div style={S.truckGrid}>{trucks.map(tr=>{ const hist=turns.filter(t=>(t.trucks||[]).includes(tr)); const act=hist.find(t=>!["completado","cancelado"].includes(t.status)); const comp=hist.filter(t=>t.status==="completado"); const cfg=act?STATUS_CONFIG[act.status]:{label:"Libre",color:"#10B981",bg:"#D1FAE5"};
    return <div key={tr} style={S.truckCard}><div style={S.truckCardHeader}><span style={{fontSize:28}}>🚛</span><div><div style={S.truckCardName}>{tr}</div><div style={{...S.badge,background:cfg.bg,color:cfg.color}}>{cfg.label}</div></div></div>
      {act&&<div style={S.truckActive}><div style={S.truckActiveLabel}>Turno activo:</div><div style={S.truckActiveClient}>{act.client}</div><div style={S.truckActiveMeta}>{act.plant} · {act.m3}m³</div></div>}
      <div style={S.truckStats}><div style={S.truckStat}><span style={S.truckStatNum}>{comp.length}</span>Completados</div><div style={S.truckStat}><span style={S.truckStatNum}>{comp.reduce((s,t)=>s+t.m3,0)}</span>m³</div></div>
    </div>; })}</div>;
}
function PlantsView({turns,plants,trucks}) {
  return <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>{plants.map(plant=>{ const pt=turns.filter(t=>t.plant===plant); const act=pt.filter(t=>!["completado","cancelado"].includes(t.status)); const comp=pt.filter(t=>t.status==="completado");
    return <div key={plant} style={S.plantCard}><div style={S.plantHeader}><span style={{fontSize:32}}>🏭</span><div><div style={S.plantName}>{plant}</div><div style={S.plantStatus}>{act.length>0?`${act.length} turno(s) activo(s)`:"Sin actividad activa"}</div></div></div>
      <div style={S.plantStats}>{[{label:"Activos",val:act.length},{label:"Completados",val:comp.length},{label:"m³ desp.",val:comp.reduce((s,t)=>s+t.m3,0)},{label:"m³ proc.",val:act.reduce((s,t)=>s+t.m3,0)}].map((s,i)=><div key={i} style={S.plantStat}><div style={S.plantStatNum}>{s.val}</div><div style={S.plantStatLabel}>{s.label}</div></div>)}</div>
      <div style={{marginTop:16}}><div style={S.panelTitle}>Camiones</div>{trucks.map(tr=>{ const tAct=act.find(t=>(t.trucks||[]).includes(tr));
        return <div key={tr} style={S.truckRow}><div style={S.truckIcon}>🚛</div><div style={{flex:1}}><div style={S.truckName}>{tr}</div>{tAct&&<div style={S.truckClient}>{tAct.client} · {tAct.m3}m³</div>}</div>
          {tAct?<div style={{...S.badge,background:STATUS_CONFIG[tAct.status].bg,color:STATUS_CONFIG[tAct.status].color}}>{STATUS_CONFIG[tAct.status].label}</div>:<div style={{...S.badge,background:"#D1FAE5",color:"#10B981"}}>Libre</div>}
        </div>; })}</div>
    </div>; })}</div>;
}

// ─── TURN FORM ────────────────────────────────────────────────────────────────
function TurnForm({initial,plants,trucks,users,allTurns,currentUser,onSave,onClose}) {
  const [form,setForm]=useState({
    client:initial?.client||"",plant:initial?.plant||plants[0]||"",
    trucks:initial?.trucks||(initial?.truck?[initial.truck]:[trucks[0]||""]),
    m3:initial?.m3||6,destination:initial?.destination||"",notes:initial?.notes||"",
    status:initial?.status||"pendiente",scheduledAt:initial?.scheduledAt||Date.now(),
  });
  const [conflicts,setConflicts]=useState([]);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const neededTrucks=Math.ceil(form.m3/TRUCK_CAPACITY);
  function toggleTruck(tr){ set("trucks",form.trucks.includes(tr)?form.trucks.filter(x=>x!==tr):[...form.trucks,tr]); }
  useEffect(()=>{
    const found=[];
    form.trucks.forEach(tr=>{ const c=truckConflicts(allTurns,tr,form.scheduledAt,form.m3,initial?.id||null); c.forEach(cf=>{if(!found.find(f=>f.id===cf.id))found.push({...cf,conflictTruck:tr});}); });
    setConflicts(found);
  },[form.trucks,form.scheduledAt,form.m3]);
  const canSave=form.client&&form.destination&&form.trucks.length>0&&conflicts.length===0;
  return (
    <div style={S.modalOverlay}>
      <div style={{...S.modal,maxWidth:600}}>
        <div style={S.modalHeader}><h2 style={S.modalTitle}>{initial?"Editar Turno":"Nuevo Turno"}</h2><button onClick={onClose} style={S.modalClose}>✕</button></div>
        <div style={{...S.formGrid,gap:14}}>
          <div style={S.formGroup}><label style={S.label}>Cliente *</label><input value={form.client} onChange={e=>set("client",e.target.value)} style={S.input} placeholder="Nombre del cliente"/></div>
          <div style={S.formGroup}><label style={S.label}>Destino *</label><input value={form.destination} onChange={e=>set("destination",e.target.value)} style={S.input} placeholder="Dirección de entrega"/></div>
          <div style={S.formGroup}><label style={S.label}>Planta</label><select value={form.plant} onChange={e=>set("plant",e.target.value)} style={S.input}>{plants.map(p=><option key={p}>{p}</option>)}</select></div>
          <div style={S.formGroup}><label style={S.label}>Fecha y hora</label><input type="datetime-local" value={new Date(form.scheduledAt-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16)} onChange={e=>set("scheduledAt",new Date(e.target.value).getTime())} style={S.input}/></div>
          <div style={{...S.formGroup,gridColumn:"1/-1"}}><label style={S.label}>Volumen total (m³) — {TRUCK_CAPACITY}m³/camión → necesita {neededTrucks} camión{neededTrucks!==1?"es":""}</label><input type="number" min="1" max="100" value={form.m3} onChange={e=>set("m3",Number(e.target.value))} style={{...S.input,maxWidth:120}}/></div>
          <div style={{...S.formGroup,gridColumn:"1/-1"}}>
            <label style={S.label}>Camiones ({form.trucks.length} seleccionado{form.trucks.length!==1?"s":""} · cap: {form.trucks.length*TRUCK_CAPACITY}m³){form.trucks.length<neededTrucks&&<span style={{color:"#F59E0B",marginLeft:8}}>⚠ Faltan {neededTrucks-form.trucks.length}</span>}</label>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:4}}>
              {trucks.map(tr=>{ const sel=form.trucks.includes(tr); const hasConfl=conflicts.some(c=>c.conflictTruck===tr);
                return <button key={tr} onClick={()=>toggleTruck(tr)} style={{padding:"8px 14px",borderRadius:8,border:`2px solid ${hasConfl?"#EF4444":sel?"#4F8EF7":C.border}`,background:hasConfl?"#FEE2E2":sel?`${C.accent}22`:C.bg,color:hasConfl?"#EF4444":sel?C.accent:C.muted,fontWeight:sel?700:400,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",gap:6}}>🚛 {tr} {hasConfl&&"⚠"}</button>; })}
            </div>
          </div>
          {conflicts.length>0&&<div style={{...S.formGroup,gridColumn:"1/-1"}}><div style={{background:"#FEE2E2",border:"1px solid #EF444455",borderRadius:8,padding:12}}><div style={{fontWeight:700,color:"#EF4444",marginBottom:6}}>⚠ Conflicto de horario</div>{conflicts.map(c=><div key={c.id} style={{fontSize:13,color:"#7f1d1d",marginBottom:4}}>{c.conflictTruck}: <strong>{c.client}</strong> ({fmtTime(c.scheduledAt)} — {fmtTime(c.scheduledAt+estDuration(c.m3))})</div>)}<div style={{fontSize:12,color:"#7f1d1d",marginTop:6}}>Cambiá el horario o seleccioná otros camiones.</div></div></div>}
          {initial&&<div style={S.formGroup}><label style={S.label}>Estado</label><select value={form.status} onChange={e=>set("status",e.target.value)} style={S.input}>{Object.entries(STATUS_CONFIG).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></div>}
          <div style={{...S.formGroup,gridColumn:"1/-1"}}><label style={S.label}>Notas</label><textarea value={form.notes} onChange={e=>set("notes",e.target.value)} style={{...S.input,minHeight:52,resize:"vertical"}} placeholder="Observaciones…"/></div>
        </div>
        <div style={S.modalFooter}><button onClick={onClose} style={S.btnSecondary}>Cancelar</button><button onClick={()=>{if(canSave)onSave(form);}} style={{...S.btnPrimary,opacity:canSave?1:.45,cursor:canSave?"pointer":"not-allowed"}}>{initial?"Guardar":"Crear turno"}</button></div>
      </div>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const C={bg:"#0F1117",sidebar:"#161820",panel:"#1C1F2E",border:"#2A2D3E",text:"#E8EAF0",muted:"#6B7280",accent:"#4F8EF7"};
const S={
  app:{display:"flex",height:"100vh",background:C.bg,fontFamily:"'IBM Plex Sans','Segoe UI',sans-serif",color:C.text,overflow:"hidden"},
  sidebar:{width:220,background:C.sidebar,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",padding:"20px 0",flexShrink:0},
  sidebarLogo:{display:"flex",alignItems:"center",gap:10,padding:"0 20px 24px",borderBottom:`1px solid ${C.border}`},
  logoIcon:{fontSize:28,color:C.accent,lineHeight:1},logoTitle:{fontSize:16,fontWeight:700,letterSpacing:1},logoSub:{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1},
  nav:{padding:"16px 12px",flex:1,display:"flex",flexDirection:"column",gap:4},
  navItem:{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderRadius:8,border:"none",background:"transparent",color:C.muted,fontSize:14,cursor:"pointer",textAlign:"left"},
  navItemActive:{background:`${C.accent}22`,color:C.accent,fontWeight:600},navIcon:{fontSize:16,width:20,textAlign:"center"},
  sidebarFooter:{padding:"16px 16px 0",borderTop:`1px solid ${C.border}`},
  userBadge:{display:"flex",alignItems:"center",gap:10,marginBottom:12},
  userAvatar:{width:32,height:32,borderRadius:"50%",background:C.accent,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:14,flexShrink:0},
  userName:{fontSize:13,fontWeight:600},userRole:{fontSize:11,color:C.muted},
  logoutBtn:{width:"100%",padding:"8px",background:"transparent",border:`1px solid ${C.border}`,color:C.muted,borderRadius:6,cursor:"pointer",fontSize:12},
  main:{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"},
  header:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"20px 28px",borderBottom:`1px solid ${C.border}`,background:C.sidebar,flexShrink:0},
  pageTitle:{fontSize:20,fontWeight:700,margin:0},pageDate:{fontSize:12,color:C.muted,marginTop:2},
  content:{flex:1,overflow:"auto",padding:24},
  statsGrid:{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:24},
  statCard:{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:20,textAlign:"center"},
  statIcon:{fontSize:22,marginBottom:8},statValue:{fontSize:32,fontWeight:800,lineHeight:1},statLabel:{fontSize:12,color:C.muted,marginTop:4,textTransform:"uppercase",letterSpacing:.5},
  dashGrid:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20},
  panel:{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:20},
  panelTitle:{fontSize:13,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:1,margin:"0 0 14px"},
  empty:{color:C.muted,textAlign:"center",padding:"24px 0",fontSize:14},
  filters:{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap"},
  select:{background:C.panel,border:`1px solid ${C.border}`,color:C.text,padding:"8px 12px",borderRadius:8,fontSize:13,cursor:"pointer"},
  turnCard:{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:16},
  turnCardTop:{display:"flex",justifyContent:"space-between",alignItems:"flex-start"},
  statusDot:{width:10,height:10,borderRadius:"50%",flexShrink:0,marginTop:4},
  turnClient:{fontWeight:700,fontSize:15},turnMeta:{fontSize:12,color:C.muted,marginTop:2},
  turnDetails:{display:"flex",flexWrap:"wrap",gap:"6px 16px",marginTop:12,fontSize:13,color:C.muted},
  turnActions:{display:"flex",gap:8,marginTop:14,flexWrap:"wrap"},
  badge:{fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,letterSpacing:.3,whiteSpace:"nowrap"},
  truckRow:{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:`1px solid ${C.border}`},
  truckIcon:{fontSize:20},truckName:{fontSize:14,fontWeight:600},truckClient:{fontSize:12,color:C.muted},
  truckGrid:{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:20},
  truckCard:{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:20},
  truckCardHeader:{display:"flex",gap:14,alignItems:"center",marginBottom:16},
  truckCardName:{fontSize:18,fontWeight:800,marginBottom:6},
  truckActive:{background:`${C.border}88`,borderRadius:8,padding:12,marginBottom:14},
  truckActiveLabel:{fontSize:11,color:C.muted,textTransform:"uppercase",letterSpacing:.5,marginBottom:4},
  truckActiveClient:{fontWeight:700,fontSize:14},truckActiveMeta:{fontSize:12,color:C.muted,marginTop:2},
  truckStats:{display:"flex",gap:20},truckStat:{textAlign:"center",fontSize:12,color:C.muted},
  truckStatNum:{display:"block",fontSize:22,fontWeight:800,color:C.text},
  plantCard:{flex:1,minWidth:360,background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:24},
  plantHeader:{display:"flex",gap:16,alignItems:"center",marginBottom:20},
  plantName:{fontSize:22,fontWeight:800},plantStatus:{fontSize:13,color:C.muted,marginTop:4},
  plantStats:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:20},
  plantStat:{background:`${C.border}55`,borderRadius:8,padding:12,textAlign:"center"},
  plantStatNum:{fontSize:24,fontWeight:800},plantStatLabel:{fontSize:11,color:C.muted,marginTop:2},
  btnPrimary:{background:C.accent,color:"#fff",border:"none",padding:"10px 20px",borderRadius:8,cursor:"pointer",fontWeight:700,fontSize:14},
  btnSecondary:{background:"transparent",color:C.muted,border:`1px solid ${C.border}`,padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:13},
  btnAdvance:{background:`${C.accent}22`,color:C.accent,border:`1px solid ${C.accent}55`,padding:"7px 14px",borderRadius:8,cursor:"pointer",fontWeight:700,fontSize:13},
  btnDanger:{background:"#EF444422",color:"#EF4444",border:"1px solid #EF444455",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontSize:13},
  modalOverlay:{position:"fixed",inset:0,background:"#000A",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100},
  modal:{background:C.panel,border:`1px solid ${C.border}`,borderRadius:16,width:"90%",maxWidth:560,maxHeight:"90vh",overflow:"auto"},
  modalHeader:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"20px 24px",borderBottom:`1px solid ${C.border}`},
  modalTitle:{fontSize:18,fontWeight:800,margin:0},modalClose:{background:"transparent",border:"none",color:C.muted,fontSize:18,cursor:"pointer"},
  formGrid:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,padding:24},
  formGroup:{display:"flex",flexDirection:"column",gap:6},
  label:{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:.5},
  input:{background:C.bg,border:`1px solid ${C.border}`,color:C.text,padding:"9px 12px",borderRadius:8,fontSize:14,outline:"none"},
  modalFooter:{display:"flex",justifyContent:"flex-end",gap:10,padding:"16px 24px",borderTop:`1px solid ${C.border}`},
  loginBg:{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:C.bg,fontFamily:"'IBM Plex Sans','Segoe UI',sans-serif"},
  loginCard:{background:C.panel,border:`1px solid ${C.border}`,borderRadius:20,padding:40,width:420,textAlign:"center"},
  loginLogo:{fontSize:48,color:C.accent,marginBottom:8},loginTitle:{fontSize:28,fontWeight:900,margin:"0 0 6px",color:C.text},
  loginSub:{fontSize:13,color:C.muted,marginBottom:28},loginLabel:{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:14},
  loginUsers:{display:"flex",flexDirection:"column",gap:8,marginBottom:20},
  loginUser:{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",borderRadius:10,border:`1px solid ${C.border}`,background:"transparent",color:C.text,cursor:"pointer",fontSize:14},
  loginUserActive:{border:`1px solid ${C.accent}`,background:`${C.accent}22`,color:C.accent},
  loginUserAvatar:{width:28,height:28,borderRadius:"50%",background:C.accent,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:13,color:"#fff"},
  calDayStrip:{display:"flex",gap:6,overflowX:"auto",paddingBottom:4},
  calDayBtn:{display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"10px 12px",borderRadius:10,border:`1px solid ${C.border}`,background:C.panel,color:C.muted,cursor:"pointer",minWidth:56,flexShrink:0},
  calDayBtnActive:{background:C.accent,border:`1px solid ${C.accent}`,color:"#fff"},
  calDayBtnToday:{border:`1px solid ${C.accent}`,color:C.accent},
  calDot:{width:5,height:5,borderRadius:"50%",background:C.accent},
  calEventBtn:{border:"none",borderRadius:4,padding:"2px 7px",cursor:"pointer",fontWeight:700,background:`${C.border}`,color:C.muted},
  settingsRow:{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderBottom:`1px solid ${C.border}`},
  btnSave:{background:"#10B98122",color:"#10B981",border:"1px solid #10B98155",padding:"5px 10px",borderRadius:6,cursor:"pointer",fontWeight:700,fontSize:12},
  btnCancelSm:{background:"transparent",color:C.muted,border:`1px solid ${C.border}`,padding:"5px 10px",borderRadius:6,cursor:"pointer",fontSize:12},
  btnEdit:{background:`${C.accent}22`,color:C.accent,border:`1px solid ${C.accent}44`,padding:"5px 10px",borderRadius:6,cursor:"pointer",fontSize:12,whiteSpace:"nowrap"},
  btnDangerSm:{background:"#EF444422",color:"#EF4444",border:"1px solid #EF444444",padding:"5px 8px",borderRadius:6,cursor:"pointer",fontSize:12},
  btnAddItem:{marginTop:10,background:"transparent",color:C.accent,border:`1px dashed ${C.accent}88`,padding:"7px 14px",borderRadius:8,cursor:"pointer",fontSize:13,width:"100%"},
  tabBtn:{padding:"8px 16px",borderRadius:"8px 8px 0 0",border:"none",background:"transparent",color:C.muted,cursor:"pointer",fontSize:13,fontWeight:600},
  tabBtnActive:{background:C.panel,color:C.accent,borderBottom:`2px solid ${C.accent}`},
};
