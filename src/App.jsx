import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";

const TRUCK_CAPACITY = 8;
const INFOTRAK_API = "https://ver.infotrak.com.ar:8144/api";
const RADIO_OBRA = 300;
const RADIO_PLANTA = 200;

const STATUS_CONFIG = {
  pendiente:   { label:"Pendiente",   color:"#F59E0B", bg:"#FEF3C7", dot:"#F59E0B" },
  en_planta:   { label:"En Planta",   color:"#3B82F6", bg:"#DBEAFE", dot:"#3B82F6" },
  en_ruta:     { label:"En Ruta",     color:"#8B5CF6", bg:"#EDE9FE", dot:"#8B5CF6" },
  descargando: { label:"Descargando", color:"#F97316", bg:"#FFEDD5", dot:"#F97316" },
  completado:  { label:"Completado",  color:"#10B981", bg:"#D1FAE5", dot:"#10B981" },
  cancelado:   { label:"Cancelado",   color:"#EF4444", bg:"#FEE2E2", dot:"#EF4444" },
};
const STATUS_FLOW = ["pendiente","en_planta","en_ruta","descargando","completado"];

function genId() { return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function fmtTime(ts) { return new Date(ts).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}); }
function fmtDate(ts) { return new Date(ts).toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit",year:"numeric"}); }
function fmtDateLong(ts) { return new Date(ts).toLocaleDateString("es-AR",{weekday:"long",day:"2-digit",month:"long",year:"numeric"}); }
function dayKey(ts) { const d=new Date(ts); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function parseDay(k) { const [y,m,d]=k.split("-").map(Number); return new Date(y,m-1,d); }
function overlaps(s1,e1,s2,e2) { return s1<e2&&e1>s2; }
function truckConflicts(turns,truck,scheduledAt,endAt,editId=null) {
  return turns.filter(t=>t.id!==editId&&!["cancelado"].includes(t.status)&&Array.isArray(t.trucks)&&t.trucks.includes(truck)&&overlaps(scheduledAt,endAt,t.scheduledAt,t.endAt||t.scheduledAt+3600000));
}
function dbToTurn(row) {
  return { id:row.id,client:row.client,plant:row.plant,trucks:row.trucks,m3:row.m3,status:row.status,operator:row.operator,destination:row.destination,notes:row.notes||"",concreteType:row.concrete_type||"",scheduledAt:row.scheduled_at,endAt:row.end_at,createdAt:row.created_at,destLat:row.dest_lat||null,destLng:row.dest_lng||null };
}
function turnToDb(t) {
  return { id:t.id,client:t.client,plant:t.plant,trucks:t.trucks,m3:t.m3,status:t.status,operator:t.operator,destination:t.destination,notes:t.notes||"",concrete_type:t.concreteType||"",scheduled_at:t.scheduledAt,end_at:t.endAt,created_at:t.createdAt,dest_lat:t.destLat||null,dest_lng:t.destLng||null };
}

function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function fmtRemitoNum(n){return String(n).padStart(8,"0");}
function buildRemitoPrintHTML(r){
  if(!r) return "";
  const row=(label,val)=>`<div class="rp-field"><span class="rp-label">${escapeHtml(label)}</span><span class="rp-val">${escapeHtml(val||"—")}</span></div>`;
  return `
    <div class="rp-sheet">
      <div class="rp-header">
        <div><div class="rp-company">Corralón Domus</div><div class="rp-sub">Materiales para la Construcción</div></div>
        <div class="rp-meta"><div class="rp-num">Remito N° ${fmtRemitoNum(r.numero)}</div><div class="rp-date">${escapeHtml(r.fecha)}</div></div>
      </div>
      <div class="rp-section"><div class="rp-section-title">Datos del cliente</div>
        ${row("Señor(es)",r.cliente)}${row("Domicilio",r.domicilio)}${row("Teléfono",r.telefono)}${row("Cliente N°",r.cliente_numero)}
        ${r.observaciones?`<div class="rp-field"><span class="rp-label">Observaciones</span><span class="rp-val">${escapeHtml(r.observaciones)}</span></div>`:""}
      </div>
      <div class="rp-section"><div class="rp-section-title">Producto y dosificación</div>
        ${row("Producto",r.producto)}${row("Cantidad",r.cantidad?`${r.cantidad} m³`:"")}${row("Asentamiento",r.asentamiento?`${r.asentamiento} cm`:"")}
        ${row("Aditivo",r.aditivo_tipo)}${row("Cant. aditivo",r.aditivo_cantidad)}
      </div>
      <div class="rp-section"><div class="rp-section-title">Entrega en obra</div>
        ${row("Agua agregada",r.agua_agregada?`${r.agua_agregada} L`:"")}
        ${row("Camión",r.camion)}${row("Patente",r.patente)}${row("Chofer",r.chofer)}${row("Confeccionó",r.confeccionado_por)}
      </div>
      <div class="rp-section rp-signature">${row("Firma y aclaración",r.firma_aclaracion)}</div>
      ${r.observaciones_final?`<div class="rp-section"><div class="rp-section-title">Observaciones</div><div class="rp-obs">${escapeHtml(r.observaciones_final)}</div></div>`:""}
    </div>`;
}
function printRemito(r){
  const el=document.getElementById("remito-print-root");
  if(!el) return;
  el.innerHTML=buildRemitoPrintHTML(r);
  window.print();
}

function distancia(lat1,lng1,lat2,lng2) {
  const R=6371000;
  const dLat=(lat2-lat1)*Math.PI/180;
  const dLng=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

async function geocodificar(direccion) {
  try {
    const q=encodeURIComponent(direccion+", Argentina");
    const res=await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`);
    const data=await res.json();
    if(data&&data[0]) return {lat:parseFloat(data[0].lat),lng:parseFloat(data[0].lon)};
  } catch(e) {}
  return null;
}

// Geofencing con hora de entrega como referencia
async function runGeofencing(turns, vehicles, plantsGeo, onUpdateStatus) {
  const activeTurns=turns.filter(t=>!["completado","cancelado"].includes(t.status));
  if(!activeTurns.length||!vehicles.length) return;
  const now=Date.now();

  for(const turn of activeTurns) {
    const turnVehicles=vehicles.filter(v=>
      (turn.trucks||[]).some(name=>v.nombre_hormiturn&&v.nombre_hormiturn.toLowerCase()===name.toLowerCase())
    );
    if(!turnVehicles.length) continue;
    const veh=turnVehicles[0];
    const vLat=veh.latitud, vLng=veh.longitud;
    const isMoving=veh.velocidad>2;
    const plantGeo=plantsGeo?.find(p=>p.nombre.toLowerCase()===turn.plant.toLowerCase());
    const distPlanta=plantGeo?distancia(vLat,vLng,plantGeo.lat,plantGeo.lng):Infinity;
    const enPlanta=distPlanta<RADIO_PLANTA;

    // Calcular margen de tiempo según distancia planta-obra
    let margenMs=60*60000; // 60 min por defecto
    if(plantGeo&&turn.destLat&&turn.destLng) {
      const distObraPlanta=distancia(plantGeo.lat,plantGeo.lng,turn.destLat,turn.destLng);
      if(distObraPlanta<10000) margenMs=40*60000; // <10km → 40 min
    }

    // La hora de inicio de carga es scheduledAt - margen
    const horaInicioCarga=turn.scheduledAt-margenMs;
    const started=now>=horaInicioCarga;

    let enObra=false;
    if(turn.destLat&&turn.destLng) {
      enObra=distancia(vLat,vLng,turn.destLat,turn.destLng)<RADIO_OBRA;
    }

    let nuevoEstado=null;
    if(turn.status==="pendiente"&&enPlanta&&started) nuevoEstado="en_planta";
    else if(turn.status==="en_planta"&&!enPlanta&&isMoving) nuevoEstado="en_ruta";
    else if(turn.status==="en_ruta"&&enObra&&!isMoving) nuevoEstado="descargando";
    else if(turn.status==="descargando"&&!enObra&&enPlanta) nuevoEstado="completado";

    if(nuevoEstado) await onUpdateStatus(turn.id,nuevoEstado);
  }
}

// Enviar email via EmailJS (cliente)
async function enviarEmailResumen(turns, users, userEmails, emailConfig) {
  const manana=new Date(); manana.setDate(manana.getDate()+1); manana.setHours(0,0,0,0);
  const mananaKey=dayKey(manana.getTime());
  const turnosManana=turns.filter(t=>dayKey(t.scheduledAt)===mananaKey&&t.status!=="cancelado").sort((a,b)=>a.scheduledAt-b.scheduledAt);

  if(turnosManana.length===0) return {ok:false,msg:"No hay turnos para mañana"};

  const destinatarios=Object.entries(userEmails).filter(([,email])=>email);
  if(destinatarios.length===0) return {ok:false,msg:"No hay emails configurados"};

  // Construir tabla HTML de turnos
  const filas=turnosManana.map(t=>`
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${fmtTime(t.scheduledAt)}${t.endAt?` → ${fmtTime(t.endAt)}`:""}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;"><strong>${t.client}</strong></td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${t.concreteType||"—"}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${t.m3} m³</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${(t.trucks||[]).join(", ")}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${t.destination}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${t.notes||"—"}</td>
    </tr>`).join("");

  const html=`
    <div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:20px;">
      <div style="background:#1a1a2e;color:white;padding:20px;border-radius:8px 8px 0 0;">
        <h1 style="margin:0;font-size:22px;">⬡ HormiTurn</h1>
        <p style="margin:4px 0 0;opacity:.7;font-size:14px;">Resumen de turnos para mañana</p>
      </div>
      <div style="background:#f9f9f9;padding:16px 20px;border-bottom:3px solid #4F8EF7;">
        <strong style="font-size:16px;">${fmtDateLong(manana.getTime())}</strong>
        <span style="margin-left:16px;color:#666;">${turnosManana.length} turno${turnosManana.length!==1?"s":""} · ${turnosManana.reduce((s,t)=>s+t.m3,0)} m³ totales</span>
      </div>
      <table style="width:100%;border-collapse:collapse;background:white;">
        <thead>
          <tr style="background:#f0f0f0;">
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#666;">Horario</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#666;">Cliente</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#666;">Hormigón</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#666;">m³</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#666;">Camiones</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#666;">Dirección</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#666;">Notas</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
      <div style="padding:16px 20px;background:#f9f9f9;border-radius:0 0 8px 8px;font-size:12px;color:#999;">
        HormiTurn · Sistema de Gestión de Despacho de Hormigón · ${fmtDate(Date.now())}
      </div>
    </div>`;

  // Usar EmailJS para enviar desde el browser
  try {
    const emails=destinatarios.map(([,e])=>e).join(",");
    const res=await fetch("https://api.emailjs.com/api/v1.0/email/send",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        service_id:"service_hormiturn",
        template_id:"template_hormiturn",
        user_id:"YOUR_EMAILJS_PUBLIC_KEY",
        template_params:{
          to_email:emails,
          subject:`HormiTurn — Turnos del ${fmtDateLong(manana.getTime())}`,
          html_content:html,
        }
      })
    });
    if(res.ok) return {ok:true,msg:`Email enviado a ${destinatarios.length} operador${destinatarios.length!==1?"es":""}`};
    return {ok:false,msg:"Error al enviar el email"};
  } catch(e) {
    return {ok:false,msg:"No se pudo conectar con el servicio de email"};
  }
}

function printDayReport(turns,day) {
  const dayTurns=turns.filter(t=>dayKey(t.scheduledAt)===day&&t.status!=="cancelado").sort((a,b)=>a.scheduledAt-b.scheduledAt);
  const rows=dayTurns.map(t=>`<tr><td>${fmtTime(t.scheduledAt)}${t.endAt?` — ${fmtTime(t.endAt)}`:""}</td><td><strong>${t.client}</strong></td><td>${t.concreteType||"—"}</td><td>${t.m3} m³</td><td>${(t.trucks||[]).join(", ")}</td><td>${t.destination}</td><td>${t.notes||"—"}</td></tr>`).join("");
  const html=`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><title>Turnos</title><style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:24px;}h1{font-size:20px;margin-bottom:4px;}.subtitle{color:#555;margin-bottom:20px;font-size:13px;}table{width:100%;border-collapse:collapse;}th{background:#1a1a2e;color:white;padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;}td{padding:8px 10px;border-bottom:1px solid #e5e5e5;vertical-align:top;}tr:nth-child(even) td{background:#f9f9f9;}.total{margin-top:16px;font-size:13px;}.footer{margin-top:32px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:10px;}</style></head><body><h1>⬡ HormiTurn — Turnos del día</h1><div class="subtitle">${fmtDateLong(parseDay(day).getTime())} · ${fmtDate(Date.now())} ${fmtTime(Date.now())}</div>${dayTurns.length===0?"<p>No hay turnos.</p>":`<table><thead><tr><th>Horario</th><th>Cliente</th><th>Hormigón</th><th>Cantidad</th><th>Camiones</th><th>Dirección</th><th>Observaciones</th></tr></thead><tbody>${rows}</tbody></table><div class="total">Total: <strong>${dayTurns.length}</strong> turno${dayTurns.length!==1?"s":""} · <strong>${dayTurns.reduce((s,t)=>s+t.m3,0)} m³</strong></div>`}<div class="footer">HormiTurn · Sistema de Gestión de Despacho de Hormigón</div></body></html>`;
  const w=window.open("","_blank"); w.document.write(html); w.document.close(); w.focus(); setTimeout(()=>w.print(),500);
}

// Exporta lo realmente producido (turnos completados) de un día como CSV.
// dayTurns ya debe venir filtrado por día (y, si corresponde, por planta).
function exportDayCSV(dayTurns,day,plantLabel) {
  const completed=dayTurns.filter(t=>t.status==="completado").sort((a,b)=>a.scheduledAt-b.scheduledAt);
  const esc=v=>`"${String(v??"").replace(/"/g,'""')}"`;
  const numAR=n=>String(n).replace(".",",");
  const headers=["Fecha","Planta","Cliente","Hormigón","m³","Camiones","Horario","Operador","Destino"];
  const rows=completed.map(t=>[fmtDate(t.scheduledAt),t.plant,t.client,t.concreteType||"",numAR(t.m3),(t.trucks||[]).join(" | "),`${fmtTime(t.scheduledAt)}${t.endAt?` - ${fmtTime(t.endAt)}`:""}`,t.operator,t.destination]);
  const totalM3=completed.reduce((s,t)=>s+t.m3,0);
  rows.push(["","","","TOTAL",numAR(totalM3),"","","",""]);
  const csv=[headers,...rows].map(r=>r.map(esc).join(";")).join("\r\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=`resumen_${day}${plantLabel&&plantLabel!=="all"?"_"+plantLabel.replace(/\s+/g,"-"):""}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── MAPA ──────────────────────────────────────────────────────────────────────
function MapView({turns,infotrakConfig,plantsGeo,onUpdateStatus}) {
  const mapRef=useRef(null); const mapInstance=useRef(null); const markersRef=useRef({}); const circlesRef=useRef({});
  const [vehicles,setVehicles]=useState([]); const [loading,setLoading]=useState(true); const [error,setError]=useState(null);
  const [lastUpdate,setLastUpdate]=useState(null); const [geoLog,setGeoLog]=useState([]);

  useEffect(()=>{
    if(document.getElementById("leaflet-css")){if(window.L&&mapRef.current&&!mapInstance.current)initMap();return;}
    const link=document.createElement("link");link.id="leaflet-css";link.rel="stylesheet";link.href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";document.head.appendChild(link);
    const script=document.createElement("script");script.src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";script.onload=()=>initMap();document.head.appendChild(script);
  },[]);
  useEffect(()=>{if(window.L&&mapRef.current&&!mapInstance.current)initMap();},[]);

  function initMap() {
    if(!mapRef.current||mapInstance.current)return;
    const L=window.L;
    const map=L.map(mapRef.current).setView([-36.4,-62.6],9);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:19}).addTo(map);
    mapInstance.current=map;
    if(plantsGeo){plantsGeo.forEach(p=>{
      L.circle([p.lat,p.lng],{radius:p.radioPlanta||RADIO_PLANTA,color:"#4F8EF7",fillColor:"#4F8EF7",fillOpacity:0.1,weight:2}).addTo(map);
      L.marker([p.lat,p.lng],{icon:L.divIcon({className:"",html:`<div style="background:#4F8EF7;color:white;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.3);">🏭 ${p.nombre}</div>`,iconAnchor:[0,0]})}).addTo(map);
    });}
    fetchVehicles();
  }

  function getVehicleName(id){const v=infotrakConfig?.vehiculos?.find(v=>v.id===id);return v?v.nombre:String(id);}
  function getActiveTurn(vehicleName){return turns.find(t=>(t.trucks||[]).some(tr=>tr.toLowerCase()===vehicleName.toLowerCase())&&!["completado","cancelado"].includes(t.status));}

  async function fetchVehicles() {
    if(!infotrakConfig)return;
    setLoading(true);setError(null);
    try {
      const res=await fetch(`${INFOTRAK_API}/vehiculos`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({Usuario:infotrakConfig.usuario,Password:infotrakConfig.password})});
      const data=await res.json();
      if(data.error){setError(data.error);setLoading(false);return;}
      const ids=infotrakConfig.vehiculos.map(v=>v.id);
      const filtered=data.filter(v=>ids.includes(v.id)).map(v=>({...v,nombre_hormiturn:getVehicleName(v.id)}));
      setVehicles(filtered);setLastUpdate(new Date());updateMarkers(filtered);
      if(plantsGeo&&filtered.length){
        const logs=[];
        await runGeofencing(turns,filtered,plantsGeo,async(id,status)=>{
          const t=turns.find(x=>x.id===id);
          if(t){logs.push(`${fmtTime(Date.now())} — ${t.client}: ${STATUS_CONFIG[t.status]?.label} → ${STATUS_CONFIG[status]?.label}`);await onUpdateStatus(id,status);}
        });
        if(logs.length)setGeoLog(prev=>[...logs,...prev].slice(0,10));
      }
    } catch(e){setError("No se pudo conectar con Infotrak");}
    setLoading(false);
  }

  function updateMarkers(vehicleList) {
    const L=window.L;if(!L||!mapInstance.current)return;
    vehicleList.forEach(v=>{
      const name=v.nombre_hormiturn;const isMoving=v.velocidad>2;const activeTurn=getActiveTurn(name);
      const color=isMoving?"#8B5CF6":"#10B981";
      const icon=L.divIcon({className:"",html:`<div style="background:${color};width:38px;height:38px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-size:18px;">🚛</div>`,iconSize:[38,38],iconAnchor:[19,19]});
      if(markersRef.current[v.id]){markersRef.current[v.id].setLatLng([v.latitud,v.longitud]);markersRef.current[v.id].setIcon(icon);}
      else{const marker=L.marker([v.latitud,v.longitud],{icon}).addTo(mapInstance.current);markersRef.current[v.id]=marker;}
      markersRef.current[v.id].bindPopup(`<div style="font-family:sans-serif;min-width:200px;"><div style="font-weight:700;font-size:14px;margin-bottom:6px;">🚛 ${name}</div><div style="font-size:12px;color:#555;margin-bottom:4px;">${v.alias}</div><div style="font-size:12px;margin-bottom:2px;"><b>Velocidad:</b> ${v.velocidad} km/h</div><div style="font-size:12px;margin-bottom:2px;"><b>Dirección:</b> ${v.sentido}</div><div style="font-size:12px;margin-bottom:6px;"><b>Último reporte:</b> ${v.ultimo_Reporte}</div>${activeTurn?`<div style="padding:6px;background:#EDE9FE;border-radius:6px;font-size:12px;"><b style="color:#8B5CF6;">● ${STATUS_CONFIG[activeTurn.status]?.label}</b><br>${activeTurn.client} · ${activeTurn.m3}m³<br>${activeTurn.destination}</div>`:""}</div>`);
      if(activeTurn&&activeTurn.destLat&&activeTurn.destLng){
        if(circlesRef.current[v.id])circlesRef.current[v.id].remove();
        circlesRef.current[v.id]=L.circle([activeTurn.destLat,activeTurn.destLng],{radius:RADIO_OBRA,color:"#F97316",fillColor:"#F97316",fillOpacity:0.1,weight:2,dashArray:"6"}).addTo(mapInstance.current);
      }
    });
    if(vehicleList.length>0)mapInstance.current.fitBounds(vehicleList.map(v=>[v.latitud,v.longitud]),{padding:[60,60]});
  }

  useEffect(()=>{if(!infotrakConfig)return;const i=setInterval(()=>{if(window.L&&mapInstance.current)fetchVehicles();},60000);return()=>clearInterval(i);},[infotrakConfig,turns]);
  useEffect(()=>{if(vehicles.length>0)updateMarkers(vehicles);},[turns,vehicles]);

  return(
    <div style={{display:"flex",flexDirection:"column",gap:16,height:"100%"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",gap:16,flexWrap:"wrap",alignItems:"center"}}>
          {[{color:"#8B5CF6",label:"En movimiento"},{color:"#10B981",label:"Detenido"},{color:"#4F8EF7",label:"Zona planta"},{color:"#F97316",label:"Zona obra"}].map((s,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:C.muted}}><div style={{width:10,height:10,borderRadius:"50%",background:s.color}}/>{s.label}</div>
          ))}
          {lastUpdate&&<div style={{fontSize:11,color:C.muted}}>↺ {fmtTime(lastUpdate.getTime())}</div>}
        </div>
        <button onClick={fetchVehicles} style={{...S.btnSecondary,fontSize:12,padding:"6px 14px"}} disabled={loading}>{loading?"Actualizando…":"↺ Actualizar"}</button>
      </div>
      <div style={{...S.panel,flex:1,padding:0,overflow:"hidden",minHeight:380,position:"relative"}}>
        {error&&<div style={{position:"absolute",top:16,left:"50%",transform:"translateX(-50%)",zIndex:1000,background:"#FEE2E2",color:"#EF4444",padding:"8px 16px",borderRadius:8,fontSize:13,fontWeight:700}}>⚠ {error}</div>}
        <div ref={mapRef} style={{width:"100%",height:"100%",minHeight:380}}/>
      </div>
      {geoLog.length>0&&(
        <div style={{...S.panel,padding:"14px 16px"}}>
          <div style={{...S.panelTitle,marginBottom:8}}>🤖 Cambios automáticos</div>
          {geoLog.map((log,i)=><div key={i} style={{fontSize:12,color:C.muted,padding:"3px 0",borderBottom:i<geoLog.length-1?`1px solid ${C.border}`:""}}>{log}</div>)}
        </div>
      )}
      <div style={S.panel}>
        <div style={{...S.panelTitle,marginBottom:12}}>Vehículos en tiempo real</div>
        {loading&&vehicles.length===0&&<div style={S.empty}>Cargando posiciones…</div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:12}}>
          {vehicles.map(v=>{
            const name=v.nombre_hormiturn;const activeTurn=getActiveTurn(name);const isMoving=v.velocidad>2;
            const plantGeo=plantsGeo?.find(p=>activeTurn&&p.nombre.toLowerCase()===activeTurn?.plant?.toLowerCase());
            const distP=plantGeo?Math.round(distancia(v.latitud,v.longitud,plantGeo.lat,plantGeo.lng)):null;
            return(
              <div key={v.id} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div><div style={{fontWeight:700,fontSize:14}}>🚛 {name}</div><div style={{fontSize:11,color:C.muted,marginTop:2}}>{v.patente}</div></div>
                  <div style={{...S.badge,background:isMoving?"#EDE9FE":"#D1FAE5",color:isMoving?"#8B5CF6":"#10B981"}}>{isMoving?`${v.velocidad} km/h`:"Detenido"}</div>
                </div>
                {distP!==null&&<div style={{fontSize:11,color:C.muted,marginBottom:4}}>📍 {distP}m de la planta</div>}
                <div style={{fontSize:11,color:C.muted,marginBottom:6}}>🕐 {v.ultimo_Reporte}</div>
                {activeTurn
                  ?<div style={{background:"#EDE9FE",borderRadius:6,padding:"6px 8px",fontSize:11}}>
                    <div style={{fontWeight:700,color:"#8B5CF6",marginBottom:2}}>● {STATUS_CONFIG[activeTurn.status]?.label}</div>
                    <div style={{color:"#333"}}>{activeTurn.client} · {activeTurn.m3}m³</div>
                    <div style={{color:"#555",marginTop:2}}>{activeTurn.destination}</div>
                  </div>
                  :<div style={{fontSize:11,color:C.muted}}>Sin turno activo</div>
                }
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [currentUser,setCurrentUser]=useState(null);
  const [turns,setTurns]=useState([]);
  const [plants,setPlants]=useState([]);
  const [trucks,setTrucks]=useState([]);
  const [users,setUsers]=useState([]);
  const [concreteTypes,setConcreteTypes]=useState([]);
  const [passwords,setPasswords]=useState({});
  const [userEmails,setUserEmails]=useState({});
  const [emailConfig,setEmailConfig]=useState(null);
  const [infotrakConfig,setInfotrakConfig]=useState(null);
  const [plantsGeo,setPlantsGeo]=useState([]);
  const [loading,setLoading]=useState(true);
  const [view,setView]=useState("dashboard");
  const [showForm,setShowForm]=useState(false);
  const [editingTurn,setEditingTurn]=useState(null);
  const [showSettings,setShowSettings]=useState(false);
  const [filterStatus,setFilterStatus]=useState("all");
  const [filterPlant,setFilterPlant]=useState("all");
  const [filterTruck,setFilterTruck]=useState("all");
  const [calendarDay,setCalendarDay]=useState(dayKey(Date.now()));
  const [dashDay,setDashDay]=useState(dayKey(Date.now()));
  const [dashPlantFilter,setDashPlantFilter]=useState("all");
  const [now,setNow]=useState(Date.now());
  const [emailStatus,setEmailStatus]=useState(null);
  const [remitos,setRemitos]=useState([]);
  const [choferes,setChoferes]=useState([]);
  const [patentes,setPatentes]=useState({});
  const [showRemitoForm,setShowRemitoForm]=useState(false);
  const [permissions,setPermissions]=useState({});

  useEffect(()=>{
    async function load(){
      setLoading(true);
      const {data:cfg}=await supabase.from("config").select("*");
      if(cfg){cfg.forEach(row=>{
        if(row.key==="plants") setPlants(row.value);
        if(row.key==="trucks") setTrucks(row.value);
        if(row.key==="users"){setUsers(row.value);if(row.passwords)setPasswords(row.passwords);}
        if(row.key==="concrete_types") setConcreteTypes(row.value);
        if(row.key==="infotrak") setInfotrakConfig(row.value);
        if(row.key==="plants_geo") setPlantsGeo(row.value);
        if(row.key==="email_config") setEmailConfig(row.value);
        if(row.key==="user_emails") setUserEmails(row.value||{});
        if(row.key==="choferes") setChoferes(row.value);
        if(row.key==="patentes") setPatentes(row.value||{});
        if(row.key==="permissions") setPermissions(row.value||{});
      });}
      const {data:dbTurns}=await supabase.from("turns").select("*").order("scheduled_at");
      if(dbTurns) setTurns(dbTurns.map(dbToTurn));
      const {data:dbRemitos}=await supabase.from("remitos").select("*").order("numero",{ascending:false});
      if(dbRemitos) setRemitos(dbRemitos);
      setLoading(false);
    }
    load();
  },[]);

  useEffect(()=>{
    const ch=supabase.channel("turns-rt")
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"turns"},p=>setTurns(prev=>[...prev,dbToTurn(p.new)]))
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"turns"},p=>setTurns(prev=>prev.map(t=>t.id===p.new.id?dbToTurn(p.new):t)))
      .on("postgres_changes",{event:"DELETE",schema:"public",table:"turns"},p=>setTurns(prev=>prev.filter(t=>t.id!==p.old.id)))
      .subscribe();
    return()=>supabase.removeChannel(ch);
  },[]);

  useEffect(()=>{
    const ch=supabase.channel("remitos-rt")
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"remitos"},p=>setRemitos(prev=>prev.some(r=>r.numero===p.new.numero)?prev:[p.new,...prev]))
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"remitos"},p=>setRemitos(prev=>prev.map(r=>r.numero===p.new.numero?p.new:r)))
      .on("postgres_changes",{event:"DELETE",schema:"public",table:"remitos"},p=>setRemitos(prev=>prev.filter(r=>r.numero!==p.old.numero)))
      .subscribe();
    return()=>supabase.removeChannel(ch);
  },[]);

  useEffect(()=>{
    const ch=supabase.channel("config-rt")
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"config"},p=>{
        const row=p.new;
        if(row.key==="plants") setPlants(row.value);
        if(row.key==="trucks") setTrucks(row.value);
        if(row.key==="users"){setUsers(row.value);if(row.passwords)setPasswords(row.passwords);}
        if(row.key==="concrete_types") setConcreteTypes(row.value);
        if(row.key==="infotrak") setInfotrakConfig(row.value);
        if(row.key==="plants_geo") setPlantsGeo(row.value);
        if(row.key==="user_emails") setUserEmails(row.value||{});
        if(row.key==="choferes") setChoferes(row.value);
        if(row.key==="patentes") setPatentes(row.value||{});
        if(row.key==="permissions") setPermissions(row.value||{});
      })
      .subscribe();
    return()=>supabase.removeChannel(ch);
  },[]);

  useEffect(()=>{const i=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(i);},[]);

  useEffect(()=>{
    const perm=permissions[currentUser];
    if(perm&&Array.isArray(perm.allowedViews)&&perm.allowedViews.length&&!perm.allowedViews.includes(view)){
      setView(perm.allowedViews[0]);
    }
  },[currentUser,permissions,view]);

  async function saveConfig(key,value,extra={}){await supabase.from("config").update({value,...extra}).eq("key",key);}

  async function handleSaveTurn(data){
    let destLat=data.destLat||null,destLng=data.destLng||null;
    if(data.destination&&(!destLat||!destLng)){const geo=await geocodificar(data.destination);if(geo){destLat=geo.lat;destLng=geo.lng;}}
    const turnData={...data,destLat,destLng};
    if(editingTurn) await supabase.from("turns").update(turnToDb({...editingTurn,...turnData})).eq("id",editingTurn.id);
    else await supabase.from("turns").insert(turnToDb({id:genId(),...turnData,createdAt:Date.now(),operator:currentUser}));
    setShowForm(false);setEditingTurn(null);
  }
  async function handleAdvance(id){const t=turns.find(x=>x.id===id);if(!t)return;const idx=STATUS_FLOW.indexOf(t.status);if(idx<STATUS_FLOW.length-1)await supabase.from("turns").update({status:STATUS_FLOW[idx+1]}).eq("id",id);}
  async function handleUpdateStatus(id,status){await supabase.from("turns").update({status}).eq("id",id);}
  async function handleCancel(id){await supabase.from("turns").update({status:"cancelado"}).eq("id",id);}
  async function handleDelete(id){await supabase.from("turns").delete().eq("id",id);}

  async function handleRemitoGenerated(camion){
    if(!camion) return;
    const active=turns.find(t=>(t.trucks||[]).some(tr=>tr.toLowerCase()===camion.toLowerCase())&&!["completado","cancelado"].includes(t.status));
    if(active&&(active.status==="pendiente"||active.status==="en_planta")){
      await supabase.from("turns").update({status:"en_ruta"}).eq("id",active.id);
    }
  }
  async function handleSaveRemito(data){
    const row={
      fecha:new Date().toISOString().slice(0,10),
      cliente:data.cliente,domicilio:data.domicilio,telefono:data.telefono,
      cliente_numero:data.clienteNumero,observaciones:data.observaciones,
      producto:data.producto,cantidad:data.cantidad,asentamiento:data.asentamiento,
      aditivo_tipo:data.aditivoTipo,aditivo_cantidad:data.aditivoCantidad,
      agua_agregada:data.aguaAgregada,camion:data.camion,patente:data.patente,
      chofer:data.chofer,confeccionado_por:data.confeccionadoPor,
      firma_aclaracion:data.firmaAclaracion,observaciones_final:data.observacionesFinal,
    };
    const {data:inserted,error}=await supabase.from("remitos").insert(row).select().single();
    if(error){window.alert("No se pudo guardar el remito: "+error.message);return null;}
    if(data.camion) await handleRemitoGenerated(data.camion);
    setShowRemitoForm(false);
    printRemito(inserted);
    return inserted;
  }
  async function handleDeleteRemito(numero){await supabase.from("remitos").delete().eq("numero",numero);}

  async function renamePlant(o,n){const next=plants.map(x=>x===o?n:x);setPlants(next);await saveConfig("plants",next);for(const t of turns.filter(t=>t.plant===o))await supabase.from("turns").update({plant:n}).eq("id",t.id);}
  async function renameTruck(o,n){const next=trucks.map(x=>x===o?n:x);setTrucks(next);await saveConfig("trucks",next);for(const t of turns.filter(t=>(t.trucks||[]).includes(o)))await supabase.from("turns").update({trucks:(t.trucks||[]).map(x=>x===o?n:x)}).eq("id",t.id);if(patentes[o]!==undefined){const nextP={...patentes};nextP[n]=nextP[o];delete nextP[o];setPatentes(nextP);await saveConfig("patentes",nextP);}for(const r of remitos.filter(r=>r.camion===o))await supabase.from("remitos").update({camion:n}).eq("numero",r.numero);}
  async function renameUser(o,n){const next=users.map(x=>x===o?n:x);const nextPw={...passwords};if(nextPw[o]!==undefined){nextPw[n]=nextPw[o];delete nextPw[o];}const nextEm={...userEmails};if(nextEm[o]!==undefined){nextEm[n]=nextEm[o];delete nextEm[o];}setUsers(next);setPasswords(nextPw);setUserEmails(nextEm);await saveConfig("users",next,{passwords:nextPw});await supabase.from("config").update({value:nextEm}).eq("key","user_emails");for(const t of turns.filter(t=>t.operator===o))await supabase.from("turns").update({operator:n}).eq("id",t.id);if(currentUser===o)setCurrentUser(n);if(permissions[o]!==undefined){const nextPerm={...permissions};nextPerm[n]=nextPerm[o];delete nextPerm[o];setPermissions(nextPerm);await saveConfig("permissions",nextPerm);}}
  async function renameConcreteType(o,n){const next=concreteTypes.map(x=>x===o?n:x);setConcreteTypes(next);await saveConfig("concrete_types",next);for(const t of turns.filter(t=>t.concreteType===o))await supabase.from("turns").update({concrete_type:n}).eq("id",t.id);}
  async function addPlant(v){if(plants.includes(v))return;const next=[...plants,v];setPlants(next);await saveConfig("plants",next);}
  async function addTruck(v){if(trucks.includes(v))return;const next=[...trucks,v];setTrucks(next);await saveConfig("trucks",next);}
  async function addUser(v){if(users.includes(v))return;const next=[...users,v];setUsers(next);await saveConfig("users",next,{passwords});}
  async function addConcreteType(v){if(concreteTypes.includes(v))return;const next=[...concreteTypes,v];setConcreteTypes(next);await saveConfig("concrete_types",next);}
  async function removePlant(v){const next=plants.filter(x=>x!==v);setPlants(next);await saveConfig("plants",next);await supabase.from("turns").delete().eq("plant",v);}
  async function removeTruck(v){const next=trucks.filter(x=>x!==v);setTrucks(next);await saveConfig("trucks",next);if(patentes[v]!==undefined){const nextP={...patentes};delete nextP[v];setPatentes(nextP);await saveConfig("patentes",nextP);}}
  async function addChofer(v){if(choferes.includes(v))return;const next=[...choferes,v];setChoferes(next);await saveConfig("choferes",next);}
  async function removeChofer(v){const next=choferes.filter(x=>x!==v);setChoferes(next);await saveConfig("choferes",next);}
  async function renameChofer(o,n){const next=choferes.map(x=>x===o?n:x);setChoferes(next);await saveConfig("choferes",next);for(const r of remitos.filter(r=>r.chofer===o))await supabase.from("remitos").update({chofer:n}).eq("numero",r.numero);}
  async function setPatente(camion,patente){const next={...patentes,[camion]:patente};setPatentes(next);await saveConfig("patentes",next);}
  async function setUserPermissions(user,perm){const next={...permissions};if(perm)next[user]=perm;else delete next[user];setPermissions(next);await saveConfig("permissions",next);}
  async function removeUser(v){const next=users.filter(x=>x!==v);const nextPw={...passwords};delete nextPw[v];const nextEm={...userEmails};delete nextEm[v];setUsers(next);setPasswords(nextPw);setUserEmails(nextEm);await saveConfig("users",next,{passwords:nextPw});await supabase.from("config").update({value:nextEm}).eq("key","user_emails");if(permissions[v]!==undefined){const nextPerm={...permissions};delete nextPerm[v];setPermissions(nextPerm);await saveConfig("permissions",nextPerm);}}
  async function removeConcreteType(v){const next=concreteTypes.filter(x=>x!==v);setConcreteTypes(next);await saveConfig("concrete_types",next);}
  async function setPassword(user,pw){const nextPw={...passwords,[user]:pw};setPasswords(nextPw);await saveConfig("users",users,{passwords:nextPw});}
  async function setUserEmail(user,email){const next={...userEmails,[user]:email};setUserEmails(next);await supabase.from("config").update({value:next}).eq("key","user_emails");}
  function handleLogin(user,pw){const stored=passwords[user];if(!stored){setCurrentUser(user);return true;}if(stored===pw){setCurrentUser(user);return true;}return false;}

  async function handleSendEmail(){
    setEmailStatus("sending");
    const result=await enviarEmailResumen(turns,users,userEmails,emailConfig);
    setEmailStatus(result);
    setTimeout(()=>setEmailStatus(null),5000);
  }

  const dashDayTurns=turns.filter(t=>dayKey(t.scheduledAt)===dashDay);
  const dashDayTurnsFiltered=dashPlantFilter==="all"?dashDayTurns:dashDayTurns.filter(t=>t.plant===dashPlantFilter);
  const stats={total:dashDayTurnsFiltered.length,active:dashDayTurnsFiltered.filter(t=>!["completado","cancelado"].includes(t.status)).length,completed:dashDayTurnsFiltered.filter(t=>t.status==="completado").length,m3Today:dashDayTurnsFiltered.filter(t=>t.status==="completado").reduce((s,t)=>s+t.m3,0)};
  const filteredTurns=turns.filter(t=>{if(filterStatus!=="all"&&t.status!==filterStatus)return false;if(filterPlant!=="all"&&t.plant!==filterPlant)return false;if(filterTruck!=="all"&&!(t.trucks||[]).includes(filterTruck))return false;return true;});

  if(loading)return(<div style={{...S.loginBg,flexDirection:"column",gap:16}}><div style={{fontSize:48,color:C.accent}}>⬡</div><div style={{fontSize:18,color:C.text,fontWeight:700}}>Cargando HormiTurn…</div><div style={{fontSize:13,color:C.muted}}>Conectando con la base de datos</div></div>);
  if(!currentUser)return <LoginScreen users={users} passwords={passwords} onLogin={handleLogin}/>;

  const myPerm=permissions[currentUser];
  const allowedViews=(myPerm&&Array.isArray(myPerm.allowedViews)&&myPerm.allowedViews.length)?myPerm.allowedViews:null;
  const fullAccess=!allowedViews;

  return(
    <div style={S.app}>
      <aside style={S.sidebar}>
        <div style={S.sidebarLogo}><div style={S.logoIcon}>⬡</div><div><div style={S.logoTitle}>HormiTurn</div><div style={S.logoSub}>Gestión de Despacho</div></div></div>
        <nav style={S.nav}>
          {[{key:"dashboard",icon:"◈",label:"Dashboard"},{key:"turns",icon:"≡",label:"Turnos"},{key:"remitos",icon:"🧾",label:"Remitos"},{key:"calendar",icon:"▦",label:"Calendario"},{key:"map",icon:"🗺",label:"Mapa GPS"},{key:"trucks",icon:"◉",label:"Camiones"},{key:"plants",icon:"⬟",label:"Plantas"}].filter(item=>!allowedViews||allowedViews.includes(item.key)).map(item=>(
            <button key={item.key} onClick={()=>setView(item.key)} style={{...S.navItem,...(view===item.key?S.navItemActive:{})}}><span style={S.navIcon}>{item.icon}</span>{item.label}</button>
          ))}
          {(!allowedViews||allowedViews.includes("settings"))&&<button onClick={()=>setShowSettings(true)} style={{...S.navItem,marginTop:"auto"}}><span style={S.navIcon}>⚙</span>Configuración</button>}
        </nav>
        <div style={S.sidebarFooter}>
          <div style={S.userBadge}><div style={S.userAvatar}>{currentUser[0]}</div><div><div style={S.userName}>{currentUser}</div><div style={S.userRole}>En línea</div></div></div>
          <button onClick={()=>setCurrentUser(null)} style={S.logoutBtn}>← Salir</button>
        </div>
      </aside>
      <main style={S.main}>
        <header style={S.header}>
          <div>
            <h1 style={S.pageTitle}>{{dashboard:"Dashboard",turns:"Turnos",remitos:"Remitos",calendar:"Calendario",map:"Mapa GPS",trucks:"Camiones",plants:"Plantas"}[view]}</h1>
            <div style={S.pageDate}>{fmtDate(now)} · {fmtTime(now)}</div>
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            {view==="dashboard"&&<>
              <select value={dashPlantFilter} onChange={e=>setDashPlantFilter(e.target.value)} style={{...S.select,fontSize:12}}>
                <option value="all">Todas las plantas</option>
                {plants.map(p=><option key={p} value={p}>{p}</option>)}
              </select>
              <button onClick={handleSendEmail} disabled={emailStatus==="sending"} style={{...S.btnSecondary,fontSize:12,padding:"8px 14px"}}>
                {emailStatus==="sending"?"Enviando…":"📧 Enviar resumen mañana"}
              </button>
              {emailStatus&&emailStatus!=="sending"&&<span style={{fontSize:12,color:emailStatus.ok?"#10B981":"#EF4444"}}>{emailStatus.ok?"✓":"✗"} {emailStatus.msg}</span>}
              <button onClick={()=>exportDayCSV(dashDayTurnsFiltered,dashDay,dashPlantFilter)} style={S.btnSecondary}>📊 Exportar CSV</button>
              <button onClick={()=>printDayReport(dashDayTurnsFiltered,dashDay)} style={S.btnSecondary}>🖨 Imprimir</button>
            </>}
            {view==="calendar"&&<button onClick={()=>printDayReport(turns,calendarDay)} style={S.btnSecondary}>🖨 Imprimir</button>}
            {(view==="turns"||view==="calendar")&&<button onClick={()=>{setEditingTurn(null);setShowForm(true);}} style={S.btnPrimary}>+ Nuevo Turno</button>}
            {view==="remitos"&&<button onClick={()=>setShowRemitoForm(true)} style={S.btnPrimary}>+ Nuevo remito</button>}
          </div>
        </header>
        <div style={view==="calendar"?{...S.content,overflow:"hidden",display:"flex",flexDirection:"column"}:S.content}>
          {view==="dashboard"&&<DashboardView stats={stats} turns={dashDayTurnsFiltered} allTurns={turns} trucks={trucks} onAdvance={handleAdvance} dashDay={dashDay} setDashDay={setDashDay}/>}
          {view==="turns"    &&<TurnsView turns={filteredTurns} filterStatus={filterStatus} setFilterStatus={setFilterStatus} filterPlant={filterPlant} setFilterPlant={setFilterPlant} filterTruck={filterTruck} setFilterTruck={setFilterTruck} plants={plants} trucks={trucks} onAdvance={handleAdvance} onEdit={t=>{setEditingTurn(t);setShowForm(true);}} onCancel={handleCancel} onDelete={handleDelete}/>}
          {view==="calendar" &&<CalendarView turns={turns} selectedDay={calendarDay} setSelectedDay={setCalendarDay} onAdvance={handleAdvance} onEdit={t=>{setEditingTurn(t);setShowForm(true);}} onCancel={handleCancel}/>}
          {view==="map"      &&<MapView turns={turns} infotrakConfig={infotrakConfig} plantsGeo={plantsGeo} onUpdateStatus={handleUpdateStatus}/>}
          {view==="trucks"   &&<TrucksView turns={turns} trucks={trucks}/>}
          {view==="plants"   &&<PlantsView turns={turns} plants={plants} trucks={trucks}/>}
          {view==="remitos"  &&<RemitosView remitos={remitos} onReprint={printRemito} onDelete={fullAccess?handleDeleteRemito:null}/>}
        </div>
      </main>
      {showForm&&<TurnForm initial={editingTurn} plants={plants} trucks={trucks} users={users} concreteTypes={concreteTypes} allTurns={turns} currentUser={currentUser} onSave={handleSaveTurn} onClose={()=>{setShowForm(false);setEditingTurn(null);}}/>}
      {showSettings&&<SettingsModal plants={plants} trucks={trucks} users={users} concreteTypes={concreteTypes} passwords={passwords} userEmails={userEmails} choferes={choferes} patentes={patentes} permissions={permissions} onRenamePlant={renamePlant} onRenameTruck={renameTruck} onRenameUser={renameUser} onRenameConcreteType={renameConcreteType} onAddPlant={addPlant} onAddTruck={addTruck} onAddUser={addUser} onAddConcreteType={addConcreteType} onRemovePlant={removePlant} onRemoveTruck={removeTruck} onRemoveUser={removeUser} onRemoveConcreteType={removeConcreteType} onSetPassword={setPassword} onSetUserEmail={setUserEmail} onAddChofer={addChofer} onRemoveChofer={removeChofer} onRenameChofer={renameChofer} onSetPatente={setPatente} onSetUserPermissions={setUserPermissions} onClose={()=>setShowSettings(false)}/>}
      {showRemitoForm&&<RemitoForm plants={plants} trucks={trucks} choferes={choferes} patentes={patentes} concreteTypes={concreteTypes} turns={turns} currentUser={currentUser} onSave={handleSaveRemito} onClose={()=>setShowRemitoForm(false)}/>}
      <div id="remito-print-root" className="remito-print-sheet"></div>
    </div>
  );
}

function LoginScreen({users,passwords,onLogin}){const [sel,setSel]=useState(null);const [pw,setPw]=useState("");const [error,setError]=useState(false);function handleLogin(){const ok=onLogin(sel,pw);if(!ok){setError(true);setPw("");}}const needsPw=sel&&passwords[sel];return(<div style={S.loginBg}><div style={S.loginCard}><div style={S.loginLogo}>⬡</div><h1 style={S.loginTitle}>HormiTurn</h1><p style={S.loginSub}>Sistema de Gestión de Despacho de Hormigón</p><p style={S.loginLabel}>Seleccione su usuario</p><div style={S.loginUsers}>{users.map(u=>(<button key={u} onClick={()=>{setSel(u);setPw("");setError(false);}} style={{...S.loginUser,...(sel===u?S.loginUserActive:{})}}><div style={S.loginUserAvatar}>{u[0]}</div><span>{u}</span>{passwords[u]&&<span style={{marginLeft:"auto",fontSize:10,color:"#6B7280"}}>🔒</span>}</button>))}</div>{needsPw&&(<div style={{marginBottom:16}}><input type="password" value={pw} onChange={e=>{setPw(e.target.value);setError(false);}} placeholder="Contraseña" style={{...S.input,width:"100%",boxSizing:"border-box",textAlign:"center"}} onKeyDown={e=>e.key==="Enter"&&sel&&handleLogin()} autoFocus/>{error&&<div style={{color:"#EF4444",fontSize:12,marginTop:6,textAlign:"center"}}>Contraseña incorrecta</div>}</div>)}<button disabled={!sel} onClick={handleLogin} style={{...S.btnPrimary,width:"100%",opacity:sel?1:.4,marginTop:4}}>Ingresar →</button></div></div>);}

function EditableList({items,onRename,onAdd,onRemove,label,placeholder}){const [editing,setEditing]=useState(null);const [newVal,setNewVal]=useState("");const [adding,setAdding]=useState(false);return(<div style={{marginBottom:24}}><div style={{...S.panelTitle,marginBottom:10}}>{label}</div>{items.map((item,i)=>(<div key={i} style={S.settingsRow}>{editing?.idx===i?<><input value={editing.val} onChange={e=>setEditing({idx:i,val:e.target.value})} style={{...S.input,flex:1,padding:"5px 10px",fontSize:13}} autoFocus onKeyDown={e=>{if(e.key==="Enter"&&editing.val.trim()){onRename(item,editing.val.trim());setEditing(null);}if(e.key==="Escape")setEditing(null);}}/><button onClick={()=>{if(editing.val.trim())onRename(item,editing.val.trim());setEditing(null);}} style={S.btnSave}>✓</button><button onClick={()=>setEditing(null)} style={S.btnCancelSm}>✕</button></>:<><span style={{flex:1,fontSize:14}}>{item}</span><button onClick={()=>setEditing({idx:i,val:item})} style={S.btnEdit}>✎</button><button onClick={()=>onRemove(item)} style={S.btnDangerSm}>✕</button></>}</div>))}{adding?<div style={S.settingsRow}><input value={newVal} onChange={e=>setNewVal(e.target.value)} placeholder={placeholder} style={{...S.input,flex:1,padding:"5px 10px",fontSize:13}} autoFocus onKeyDown={e=>{if(e.key==="Enter"&&newVal.trim()){onAdd(newVal.trim());setNewVal("");setAdding(false);}if(e.key==="Escape"){setAdding(false);setNewVal("");}}}/><button onClick={()=>{if(newVal.trim()){onAdd(newVal.trim());setNewVal("");setAdding(false);}}} style={S.btnSave}>✓</button><button onClick={()=>{setAdding(false);setNewVal("");}} style={S.btnCancelSm}>✕</button></div>:<button onClick={()=>setAdding(true)} style={S.btnAddItem}>+ Agregar</button>}</div>);}

function PasswordList({users,passwords,onSetPassword}){const [editing,setEditing]=useState(null);const [val,setVal]=useState("");return(<div><div style={{...S.panelTitle,marginBottom:10}}>Contraseñas</div><p style={{fontSize:12,color:C.muted,marginBottom:14}}>Sin contraseña asignada el operador ingresa libremente.</p>{users.map((u,i)=>(<div key={i} style={S.settingsRow}><div style={S.userAvatar}>{u[0]}</div><span style={{flex:1,fontSize:14}}>{u}</span>{editing===u?<><input type="password" value={val} onChange={e=>setVal(e.target.value)} placeholder="Nueva contraseña" style={{...S.input,width:160,padding:"5px 10px",fontSize:13}} autoFocus onKeyDown={e=>{if(e.key==="Enter"){onSetPassword(u,val);setEditing(null);setVal("");}if(e.key==="Escape"){setEditing(null);setVal("");}}}/><button onClick={()=>{onSetPassword(u,val);setEditing(null);setVal("");}} style={S.btnSave}>✓</button><button onClick={()=>{setEditing(null);setVal("");}} style={S.btnCancelSm}>✕</button></>:<><span style={{fontSize:12,color:passwords[u]?"#10B981":C.muted,marginRight:8}}>{passwords[u]?"🔒 Protegido":"Sin contraseña"}</span><button onClick={()=>{setEditing(u);setVal("");}} style={S.btnEdit}>{passwords[u]?"Cambiar":"Asignar"}</button>{passwords[u]&&<button onClick={()=>onSetPassword(u,"")} style={S.btnDangerSm}>✕</button>}</>}</div>))}</div>);}

function EmailList({users,userEmails,onSetUserEmail}){const [editing,setEditing]=useState(null);const [val,setVal]=useState("");return(<div><div style={{...S.panelTitle,marginBottom:10}}>Emails de operadores</div><p style={{fontSize:12,color:C.muted,marginBottom:14}}>Los operadores con email recibirán el resumen de turnos del día siguiente.</p>{users.map((u,i)=>(<div key={i} style={S.settingsRow}><div style={S.userAvatar}>{u[0]}</div><span style={{flex:1,fontSize:14}}>{u}</span>{editing===u?<><input type="email" value={val} onChange={e=>setVal(e.target.value)} placeholder="email@ejemplo.com" style={{...S.input,width:200,padding:"5px 10px",fontSize:13}} autoFocus onKeyDown={e=>{if(e.key==="Enter"){onSetUserEmail(u,val);setEditing(null);setVal("");}if(e.key==="Escape"){setEditing(null);setVal("");}}}/><button onClick={()=>{onSetUserEmail(u,val);setEditing(null);setVal("");}} style={S.btnSave}>✓</button><button onClick={()=>{setEditing(null);setVal("");}} style={S.btnCancelSm}>✕</button></>:<><span style={{fontSize:12,color:userEmails[u]?"#10B981":C.muted,marginRight:8,overflow:"hidden",textOverflow:"ellipsis",maxWidth:180}}>{userEmails[u]||"Sin email"}</span><button onClick={()=>{setEditing(u);setVal(userEmails[u]||"");}} style={S.btnEdit}>{userEmails[u]?"Cambiar":"Asignar"}</button>{userEmails[u]&&<button onClick={()=>onSetUserEmail(u,"")} style={S.btnDangerSm}>✕</button>}</>}</div>))}</div>);}

function PatentesList({trucks,patentes,onSetPatente}){const [editing,setEditing]=useState(null);const [val,setVal]=useState("");return(<div><div style={{...S.panelTitle,marginBottom:10}}>Patentes por camión</div><p style={{fontSize:12,color:C.muted,marginBottom:14}}>Se usa para autocompletar la patente en los remitos.</p>{trucks.length===0&&<div style={S.empty}>Agregá camiones primero en la pestaña "Camiones".</div>}{trucks.map((tr,i)=>(<div key={i} style={S.settingsRow}><div style={S.truckIcon}>🚛</div><span style={{flex:1,fontSize:14}}>{tr}</span>{editing===tr?<><input value={val} onChange={e=>setVal(e.target.value)} placeholder="AB123CD" style={{...S.input,width:140,padding:"5px 10px",fontSize:13,textTransform:"uppercase"}} autoFocus onKeyDown={e=>{if(e.key==="Enter"){onSetPatente(tr,val.trim().toUpperCase());setEditing(null);setVal("");}if(e.key==="Escape"){setEditing(null);setVal("");}}}/><button onClick={()=>{onSetPatente(tr,val.trim().toUpperCase());setEditing(null);setVal("");}} style={S.btnSave}>✓</button><button onClick={()=>{setEditing(null);setVal("");}} style={S.btnCancelSm}>✕</button></>:<><span style={{fontSize:12,color:patentes[tr]?"#10B981":C.muted,marginRight:8}}>{patentes[tr]||"Sin patente"}</span><button onClick={()=>{setEditing(tr);setVal(patentes[tr]||"");}} style={S.btnEdit}>{patentes[tr]?"Cambiar":"Asignar"}</button></>}</div>))}</div>);}

function PermissionsList({users,permissions,onSetUserPermissions}){
  const VIEWS=[
    {key:"dashboard",label:"Dashboard"},
    {key:"turns",label:"Turnos"},
    {key:"remitos",label:"Remitos"},
    {key:"calendar",label:"Calendario"},
    {key:"map",label:"Mapa GPS"},
    {key:"trucks",label:"Camiones"},
    {key:"plants",label:"Plantas"},
    {key:"settings",label:"Configuración"},
  ];
  return(<div>
    <div style={{...S.panelTitle,marginBottom:10}}>Perfiles de acceso</div>
    <p style={{fontSize:12,color:C.muted,marginBottom:14}}>Por defecto un operador tiene acceso completo (ve todas las pantallas y puede eliminar remitos). Activá el acceso limitado para restringirlo — por ejemplo, un plantista que solo pueda generar remitos.</p>
    {users.length===0&&<div style={S.empty}>Agregá operadores primero en la pestaña "Operadores".</div>}
    {users.map((u,i)=>{
      const perm=permissions[u];
      const allowed=perm?.allowedViews||[];
      return(<div key={i} style={{...S.settingsRow,flexDirection:"column",alignItems:"stretch",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={S.userAvatar}>{u[0]}</div>
          <span style={{flex:1,fontSize:14}}>{u}</span>
          <span style={{fontSize:11,color:perm?"#F59E0B":"#10B981",marginRight:4}}>{perm?"Acceso limitado":"Acceso completo"}</span>
          <button onClick={()=>onSetUserPermissions(u,perm?null:{allowedViews:["remitos"]})} style={S.btnEdit}>{perm?"Dar acceso completo":"Limitar acceso"}</button>
        </div>
        {perm&&<div style={{display:"flex",flexWrap:"wrap",gap:"6px 14px",paddingLeft:40}}>
          {VIEWS.map(v=>{
            const checked=allowed.includes(v.key);
            return(<label key={v.key} style={{display:"flex",alignItems:"center",gap:4,fontSize:12,color:C.muted,cursor:"pointer"}}>
              <input type="checkbox" checked={checked} onChange={()=>{
                const next=checked?allowed.filter(x=>x!==v.key):[...allowed,v.key];
                onSetUserPermissions(u,{allowedViews:next});
              }}/> {v.label}
            </label>);
          })}
        </div>}
      </div>);
    })}
  </div>);
}

function SettingsModal({plants,trucks,users,concreteTypes,passwords,userEmails,choferes,patentes,permissions,onRenamePlant,onRenameTruck,onRenameUser,onRenameConcreteType,onAddPlant,onAddTruck,onAddUser,onAddConcreteType,onRemovePlant,onRemoveTruck,onRemoveUser,onRemoveConcreteType,onSetPassword,onSetUserEmail,onAddChofer,onRemoveChofer,onRenameChofer,onSetPatente,onSetUserPermissions,onClose}){const [tab,setTab]=useState("plants");return(<div style={S.modalOverlay}><div style={{...S.modal,maxWidth:560}}><div style={S.modalHeader}><h2 style={S.modalTitle}>⚙ Configuración</h2><button onClick={onClose} style={S.modalClose}>✕</button></div><div style={{display:"flex",gap:4,padding:"14px 24px 0",borderBottom:`1px solid ${C.border}`,flexWrap:"wrap"}}>{[["plants","🏭 Plantas"],["trucks","🚛 Camiones"],["patentes","🔖 Patentes"],["users","👤 Operadores"],["choferes","🧑‍✈️ Choferes"],["concrete","🪨 Hormigón"],["passwords","🔒 Contraseñas"],["emails","📧 Emails"],["permisos","🔑 Perfiles"]].map(([k,l])=>(<button key={k} onClick={()=>setTab(k)} style={{...S.tabBtn,...(tab===k?S.tabBtnActive:{})}}>{l}</button>))}</div><div style={{padding:24,maxHeight:"60vh",overflowY:"auto"}}>{tab==="plants"&&<EditableList items={plants} onRename={onRenamePlant} onAdd={onAddPlant} onRemove={onRemovePlant} label="Plantas" placeholder="Nueva planta…"/>}{tab==="trucks"&&<EditableList items={trucks} onRename={onRenameTruck} onAdd={onAddTruck} onRemove={onRemoveTruck} label="Camiones" placeholder="Nuevo camión…"/>}{tab==="patentes"&&<PatentesList trucks={trucks} patentes={patentes} onSetPatente={onSetPatente}/>}{tab==="users"&&<EditableList items={users} onRename={onRenameUser} onAdd={onAddUser} onRemove={onRemoveUser} label="Operadores" placeholder="Nuevo operador…"/>}{tab==="choferes"&&<EditableList items={choferes} onRename={onRenameChofer} onAdd={onAddChofer} onRemove={onRemoveChofer} label="Choferes" placeholder="Nuevo chofer…"/>}{tab==="concrete"&&<EditableList items={concreteTypes} onRename={onRenameConcreteType} onAdd={onAddConcreteType} onRemove={onRemoveConcreteType} label="Tipos de Hormigón" placeholder="Ej: H-25…"/>}{tab==="passwords"&&<PasswordList users={users} passwords={passwords} onSetPassword={onSetPassword}/>}{tab==="emails"&&<EmailList users={users} userEmails={userEmails} onSetUserEmail={onSetUserEmail}/>}{tab==="permisos"&&<PermissionsList users={users} permissions={permissions} onSetUserPermissions={onSetUserPermissions}/>}<p style={{fontSize:12,color:C.muted,marginTop:4}}>Los cambios se sincronizan para todos los usuarios.</p></div><div style={S.modalFooter}><button onClick={onClose} style={S.btnPrimary}>Listo</button></div></div></div>);}

function DashboardView({stats,turns,allTurns,trucks,onAdvance,dashDay,setDashDay}){const today=dayKey(Date.now());const refDate=new Date();refDate.setHours(0,0,0,0);const weekDays=Array.from({length:15},(_,i)=>{const d=new Date(refDate);d.setDate(d.getDate()+i-7);return dayKey(d.getTime());});const hasAct=k=>allTurns.some(t=>dayKey(t.scheduledAt)===k);const active=turns.filter(t=>!["completado","cancelado"].includes(t.status));return(<div><div style={{...S.panel,marginBottom:20,padding:"14px 16px"}}><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}><span style={{fontSize:13,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:.5}}>Filtrando por día</span>{dashDay!==today&&<button onClick={()=>setDashDay(today)} style={{...S.btnEdit,fontSize:11,padding:"2px 8px"}}>Hoy</button>}</div><div style={{display:"flex",gap:5,overflowX:"auto",paddingBottom:4}}>{weekDays.map(k=>{const d=parseDay(k);const isSel=k===dashDay;const isToday=k===today;return <button key={k} onClick={()=>setDashDay(k)} style={{...S.calDayBtn,...(isSel?S.calDayBtnActive:{}),...(isToday&&!isSel?S.calDayBtnToday:{}),minWidth:50}}><span style={{fontSize:9,fontWeight:600,textTransform:"uppercase",opacity:.7}}>{d.toLocaleDateString("es-AR",{weekday:"short"})}</span><span style={{fontSize:15,fontWeight:700}}>{String(d.getDate()).padStart(2,"0")}</span>{hasAct(k)&&<div style={{...S.calDot,...(isSel?{background:"#fff"}:{})}}/>}</button>;})}</div></div><div style={S.statsGrid}>{[{label:"Turnos Activos",value:stats.active,icon:"◎",color:"#3B82F6"},{label:"Completados",value:stats.completed,icon:"✓",color:"#10B981"},{label:"m³ Despachados",value:stats.m3Today,icon:"⬡",color:"#8B5CF6"},{label:"Total del día",value:stats.total,icon:"≡",color:"#F59E0B"}].map((s,i)=>(<div key={i} style={S.statCard}><div style={{...S.statIcon,color:s.color}}>{s.icon}</div><div style={S.statValue}>{s.value}</div><div style={S.statLabel}>{s.label}</div></div>))}</div><div style={S.dashGrid}><div style={S.panel}><h2 style={S.panelTitle}>Turnos en Curso</h2>{active.length===0?<div style={S.empty}>Sin turnos activos en este día</div>:active.map(t=><TurnCard key={t.id} turn={t} onAdvance={onAdvance} compact/>)}</div><div style={S.panel}><h2 style={S.panelTitle}>Estado de Camiones</h2>{trucks.map(tr=>{const act=allTurns.find(t=>(t.trucks||[]).includes(tr)&&!["completado","cancelado"].includes(t.status));const cfg=act?STATUS_CONFIG[act.status]:{label:"Libre",color:"#10B981",bg:"#D1FAE5"};return <div key={tr} style={S.truckRow}><div style={S.truckIcon}>🚛</div><div style={{flex:1}}><div style={S.truckName}>{tr}</div>{act&&<div style={S.truckClient}>{act.client} · {act.m3}m³</div>}</div><div style={{...S.badge,background:cfg.bg,color:cfg.color}}>{cfg.label}</div></div>;})}</div></div></div>);}

function TurnsView({turns,filterStatus,setFilterStatus,filterPlant,setFilterPlant,filterTruck,setFilterTruck,plants,trucks,onAdvance,onEdit,onCancel,onDelete}){return(<div><div style={S.filters}><select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={S.select}><option value="all">Todos los estados</option>{Object.entries(STATUS_CONFIG).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select><select value={filterPlant} onChange={e=>setFilterPlant(e.target.value)} style={S.select}><option value="all">Todas las plantas</option>{plants.map(p=><option key={p} value={p}>{p}</option>)}</select><select value={filterTruck} onChange={e=>setFilterTruck(e.target.value)} style={S.select}><option value="all">Todos los camiones</option>{trucks.map(t=><option key={t} value={t}>{t}</option>)}</select></div>{turns.length===0&&<div style={S.empty}>Sin turnos con los filtros seleccionados</div>}<div style={{display:"flex",flexDirection:"column",gap:12}}>{turns.map(t=><TurnCard key={t.id} turn={t} onAdvance={onAdvance} onEdit={onEdit} onCancel={onCancel} onDelete={onDelete}/>)}</div></div>);}

function TurnCard({turn:t,onAdvance,onEdit,onCancel,onDelete,compact}){
  const cfg=STATUS_CONFIG[t.status];const canAdv=STATUS_FLOW.includes(t.status)&&t.status!=="completado";
  const truckList=(t.trucks||[]).join(", ");
  const timeRange=t.endAt?`${fmtTime(t.scheduledAt)} → ${fmtTime(t.endAt)}`:`${fmtTime(t.scheduledAt)}`;
  const fechaStr=fmtDate(t.scheduledAt);
  return(<div style={S.turnCard}>
    <div style={S.turnCardTop}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <div style={{...S.statusDot,background:cfg.dot}}/>
        <div>
          <div style={S.turnClient}>{t.client}</div>
          <div style={S.turnMeta}>
            <span style={{background:`${C.accent}22`,color:C.accent,padding:"1px 6px",borderRadius:4,fontSize:11,fontWeight:700,marginRight:6}}>{fechaStr}</span>
            {t.plant} · {truckList} · {t.m3}m³ · {timeRange}{t.concreteType&&` · ${t.concreteType}`}
          </div>
        </div>
      </div>
      <div style={{...S.badge,background:cfg.bg,color:cfg.color}}>{cfg.label}</div>
    </div>
    {!compact&&<div style={S.turnDetails}><span>📍 {t.destination}</span><span>👤 {t.operator}</span>{t.concreteType&&<span>🪨 {t.concreteType}</span>}{t.notes&&<span>📝 {t.notes}</span>}{t.destLat&&<span style={{color:"#10B981"}}>📌 Geocodificado</span>}</div>}
    {!compact&&<div style={S.turnActions}>{canAdv&&<button onClick={()=>onAdvance(t.id)} style={S.btnAdvance}>→ {STATUS_CONFIG[STATUS_FLOW[STATUS_FLOW.indexOf(t.status)+1]]?.label}</button>}{onEdit&&!["completado","cancelado"].includes(t.status)&&<button onClick={()=>onEdit(t)} style={S.btnSecondary}>Editar</button>}{onCancel&&!["completado","cancelado"].includes(t.status)&&<button onClick={()=>onCancel(t.id)} style={S.btnDanger}>Cancelar</button>}{onDelete&&["completado","cancelado"].includes(t.status)&&<button onClick={()=>onDelete(t.id)} style={S.btnDanger}>Eliminar</button>}</div>}
    {compact&&canAdv&&<div style={{marginTop:8}}><button onClick={()=>onAdvance(t.id)} style={S.btnAdvance}>→ {STATUS_CONFIG[STATUS_FLOW[STATUS_FLOW.indexOf(t.status)+1]]?.label}</button></div>}
  </div>);}

function CalendarView({turns,selectedDay,setSelectedDay,onAdvance,onEdit,onCancel}){const [showDetail,setShowDetail]=useState(false);const today=dayKey(Date.now());const refDate=new Date();refDate.setHours(0,0,0,0);const weekDays=Array.from({length:14},(_,i)=>{const d=new Date(refDate);d.setDate(d.getDate()+i-3);return dayKey(d.getTime());});const dayTurns=turns.filter(t=>dayKey(t.scheduledAt)===selectedDay).sort((a,b)=>a.scheduledAt-b.scheduledAt);const HOUR_H=60,START_H=6,END_H=22,totalH=END_H-START_H;const hours=Array.from({length:totalH+1},(_,i)=>START_H+i);const nowD=new Date();const nowFrac=(nowD.getHours()+nowD.getMinutes()/60-START_H)/totalH;const showNow=selectedDay===today&&nowFrac>=0&&nowFrac<=1;function assignCols(turns){const cols=[];const assigned=turns.map(t=>{const s=new Date(t.scheduledAt);const sm=s.getHours()*60+s.getMinutes();const endTs=t.endAt||t.scheduledAt+3600000;const e=new Date(endTs);const em=e.getHours()*60+e.getMinutes();let col=0;while(cols[col]&&cols[col]>sm)col++;cols[col]=em;return{...t,col,startMin:sm,endMin:em};});return{assigned,totalCols:Math.max(0,...assigned.map(t=>t.col))+1};}const{assigned,totalCols}=assignCols(dayTurns);return(<div style={{display:"flex",flexDirection:"column",gap:16,height:"100%"}}><div style={S.calDayStrip}>{weekDays.map(k=>{const d=parseDay(k);const isSel=k===selectedDay;const isToday=k===today;const hasAct=turns.some(t=>dayKey(t.scheduledAt)===k);return <button key={k} onClick={()=>setSelectedDay(k)} style={{...S.calDayBtn,...(isSel?S.calDayBtnActive:{}),...(isToday&&!isSel?S.calDayBtnToday:{})}}><span style={{fontSize:10,fontWeight:600,textTransform:"uppercase",opacity:.7}}>{d.toLocaleDateString("es-AR",{weekday:"short"})}</span><span style={{fontSize:16,fontWeight:700}}>{String(d.getDate()).padStart(2,"0")}</span>{hasAct&&<div style={{...S.calDot,...(isSel?{background:"#fff"}:{})}}/>}</button>;})}</div><div style={{...S.panel,flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><h2 style={{...S.panelTitle,margin:0}}>{parseDay(selectedDay).toLocaleDateString("es-AR",{weekday:"long",day:"2-digit",month:"long",year:"numeric"})}</h2><div style={{display:"flex",alignItems:"center",gap:12}}><span style={{fontSize:13,color:C.muted}}>{dayTurns.length} turno{dayTurns.length!==1?"s":""}</span>{dayTurns.length>0&&<button onClick={()=>setShowDetail(v=>!v)} style={{...S.btnEdit,fontSize:11,padding:"3px 10px"}}>{showDetail?"Ocultar lista":"Ver en lista"}</button>}</div></div>{dayTurns.length===0?<div style={{...S.empty,flex:1,display:"flex",alignItems:"center",justifyContent:"center"}}>Sin turnos para este día</div>:<div style={{flex:1,overflowY:"auto",position:"relative"}}><div style={{display:"flex",position:"relative",minHeight:totalH*HOUR_H}}><div style={{width:46,flexShrink:0,position:"relative"}}>{hours.map(h=><div key={h} style={{position:"absolute",top:(h-START_H)*HOUR_H-8,right:8,fontSize:11,color:C.muted,userSelect:"none"}}>{String(h).padStart(2,"0")}:00</div>)}</div><div style={{flex:1,position:"relative"}}>{hours.map(h=><div key={h} style={{position:"absolute",top:(h-START_H)*HOUR_H,left:0,right:0,borderTop:`1px solid ${C.border}`,pointerEvents:"none"}}/>)}{hours.slice(0,-1).map(h=><div key={h+"h"} style={{position:"absolute",top:(h-START_H)*HOUR_H+HOUR_H/2,left:0,right:0,borderTop:`1px dashed ${C.border}44`,pointerEvents:"none"}}/>)}{showNow&&<div style={{position:"absolute",top:nowFrac*totalH*HOUR_H,left:0,right:0,borderTop:"2px solid #EF4444",zIndex:10,pointerEvents:"none"}}><div style={{position:"absolute",left:-4,top:-5,width:8,height:8,borderRadius:"50%",background:"#EF4444"}}/></div>}{assigned.map(t=>{const cfg=STATUS_CONFIG[t.status];const topPx=(t.startMin/60-START_H)*HOUR_H;const hPx=Math.max(36,(t.endMin-t.startMin)/60*HOUR_H-4);const cW=100/totalCols;const canAdv=STATUS_FLOW.includes(t.status)&&t.status!=="completado";return <div key={t.id} style={{position:"absolute",top:topPx+2,height:hPx,left:`calc(${t.col*cW}% + 2px)`,width:`calc(${cW}% - 4px)`,background:cfg.bg,border:`1.5px solid ${cfg.color}55`,borderLeft:`4px solid ${cfg.color}`,borderRadius:8,padding:"6px 8px",overflow:"hidden",cursor:"pointer",boxSizing:"border-box",zIndex:2}}><div style={{fontSize:11,fontWeight:800,color:cfg.color}}>{fmtTime(t.scheduledAt)}{t.endAt&&` → ${fmtTime(t.endAt)}`}</div><div style={{fontSize:12,fontWeight:700,color:"#1a1a2e",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.client}</div><div style={{fontSize:10,color:"#555",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{(t.trucks||[]).join(", ")} · {t.m3}m³{t.concreteType&&` · ${t.concreteType}`}</div>{hPx>90&&<div style={{display:"flex",gap:4,marginTop:6,flexWrap:"wrap"}}>{canAdv&&<button onClick={e=>{e.stopPropagation();onAdvance(t.id);}} style={{...S.calEventBtn,background:cfg.color,color:"#fff",fontSize:9}}>→ Avanzar</button>}<button onClick={e=>{e.stopPropagation();onEdit(t);}} style={{...S.calEventBtn,fontSize:9}}>✎</button></div>}</div>;})}</div></div></div>}</div>{showDetail&&dayTurns.length>0&&<div style={{...S.panel,maxHeight:220,overflowY:"auto",flexShrink:0}}><div style={{...S.panelTitle,marginBottom:10}}>Detalle del día</div>{dayTurns.map(t=><TurnCard key={t.id} turn={t} onAdvance={onAdvance} onEdit={onEdit} onCancel={onCancel} compact/>)}</div>}</div>);}

function TrucksView({turns,trucks}){return <div style={S.truckGrid}>{trucks.map(tr=>{const hist=turns.filter(t=>(t.trucks||[]).includes(tr));const act=hist.find(t=>!["completado","cancelado"].includes(t.status));const comp=hist.filter(t=>t.status==="completado");const cfg=act?STATUS_CONFIG[act.status]:{label:"Libre",color:"#10B981",bg:"#D1FAE5"};return <div key={tr} style={S.truckCard}><div style={S.truckCardHeader}><span style={{fontSize:28}}>🚛</span><div><div style={S.truckCardName}>{tr}</div><div style={{...S.badge,background:cfg.bg,color:cfg.color}}>{cfg.label}</div></div></div>{act&&<div style={S.truckActive}><div style={S.truckActiveLabel}>Turno activo:</div><div style={S.truckActiveClient}>{act.client}</div><div style={S.truckActiveMeta}>{act.plant} · {act.m3}m³ · {fmtTime(act.scheduledAt)}{act.endAt&&` → ${fmtTime(act.endAt)}`}</div></div>}<div style={S.truckStats}><div style={S.truckStat}><span style={S.truckStatNum}>{comp.length}</span>Completados</div><div style={S.truckStat}><span style={S.truckStatNum}>{comp.reduce((s,t)=>s+t.m3,0)}</span>m³</div></div></div>;})}</div>;}

function PlantsView({turns,plants,trucks}){return <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>{plants.map(plant=>{const pt=turns.filter(t=>t.plant===plant);const act=pt.filter(t=>!["completado","cancelado"].includes(t.status));const comp=pt.filter(t=>t.status==="completado");return <div key={plant} style={S.plantCard}><div style={S.plantHeader}><span style={{fontSize:32}}>🏭</span><div><div style={S.plantName}>{plant}</div><div style={S.plantStatus}>{act.length>0?`${act.length} turno(s) activo(s)`:"Sin actividad activa"}</div></div></div><div style={S.plantStats}>{[{label:"Activos",val:act.length},{label:"Completados",val:comp.length},{label:"m³ desp.",val:comp.reduce((s,t)=>s+t.m3,0)},{label:"m³ proc.",val:act.reduce((s,t)=>s+t.m3,0)}].map((s,i)=><div key={i} style={S.plantStat}><div style={S.plantStatNum}>{s.val}</div><div style={S.plantStatLabel}>{s.label}</div></div>)}</div><div style={{marginTop:16}}><div style={S.panelTitle}>Camiones</div>{trucks.map(tr=>{const tAct=act.find(t=>(t.trucks||[]).includes(tr));return <div key={tr} style={S.truckRow}><div style={S.truckIcon}>🚛</div><div style={{flex:1}}><div style={S.truckName}>{tr}</div>{tAct&&<div style={S.truckClient}>{tAct.client} · {tAct.m3}m³</div>}</div>{tAct?<div style={{...S.badge,background:STATUS_CONFIG[tAct.status].bg,color:STATUS_CONFIG[tAct.status].color}}>{STATUS_CONFIG[tAct.status].label}</div>:<div style={{...S.badge,background:"#D1FAE5",color:"#10B981"}}>Libre</div>}</div>;})}</div></div>;})}</div>;}

function TurnForm({initial,plants,trucks,users,concreteTypes,allTurns,currentUser,onSave,onClose}){
  const defaultEnd=initial?.endAt||(initial?.scheduledAt?initial.scheduledAt+3600000:Date.now()+3600000);
  const [form,setForm]=useState({client:initial?.client||"",plant:initial?.plant||plants[0]||"",trucks:initial?.trucks||(initial?.truck?[initial.truck]:[trucks[0]||""]),m3:initial?.m3||6,destination:initial?.destination||"",notes:initial?.notes||"",status:initial?.status||"pendiente",concreteType:initial?.concreteType||"",scheduledAt:initial?.scheduledAt||Date.now(),endAt:defaultEnd,destLat:initial?.destLat||null,destLng:initial?.destLng||null});
  const [conflicts,setConflicts]=useState([]);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const neededTrucks=Math.ceil(form.m3/TRUCK_CAPACITY);
  function toggleTruck(tr){set("trucks",form.trucks.includes(tr)?form.trucks.filter(x=>x!==tr):[...form.trucks,tr]);}
  useEffect(()=>{const found=[];form.trucks.forEach(tr=>{const c=truckConflicts(allTurns,tr,form.scheduledAt,form.endAt,initial?.id||null);c.forEach(cf=>{if(!found.find(f=>f.id===cf.id))found.push({...cf,conflictTruck:tr});});});setConflicts(found);},[form.trucks,form.scheduledAt,form.endAt]);
  function toLocalDT(ts){return new Date(ts-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);}
  function fromLocalDT(s){return new Date(s).getTime();}
  const canSave=form.client&&form.destination&&form.trucks.length>0&&conflicts.length===0&&form.endAt>form.scheduledAt&&parseFloat(form.m3)>0;
  return(<div style={S.modalOverlay}><div style={{...S.modal,maxWidth:600}}><div style={S.modalHeader}><h2 style={S.modalTitle}>{initial?"Editar Turno":"Nuevo Turno"}</h2><button onClick={onClose} style={S.modalClose}>✕</button></div><div style={{...S.formGrid,gap:14}}>
    <div style={S.formGroup}><label style={S.label}>Cliente *</label><input value={form.client} onChange={e=>set("client",e.target.value)} style={S.input} placeholder="Nombre del cliente"/></div>
    <div style={S.formGroup}><label style={S.label}>Destino *</label><input value={form.destination} onChange={e=>{set("destination",e.target.value);set("destLat",null);set("destLng",null);}} style={S.input} placeholder="Dirección de entrega"/></div>
    <div style={S.formGroup}><label style={S.label}>Planta</label><select value={form.plant} onChange={e=>set("plant",e.target.value)} style={S.input}>{plants.map(p=><option key={p}>{p}</option>)}</select></div>
    <div style={S.formGroup}><label style={S.label}>Tipo de Hormigón</label><select value={form.concreteType} onChange={e=>set("concreteType",e.target.value)} style={S.input}><option value="">— Sin especificar —</option>{concreteTypes.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
    <div style={S.formGroup}><label style={S.label}>Hora de entrega</label><input type="datetime-local" value={toLocalDT(form.scheduledAt)} onChange={e=>set("scheduledAt",fromLocalDT(e.target.value))} style={S.input}/></div>
    <div style={S.formGroup}><label style={S.label}>Hora de finalización {form.endAt<=form.scheduledAt&&<span style={{color:"#EF4444"}}>⚠ debe ser posterior</span>}</label><input type="datetime-local" value={toLocalDT(form.endAt)} onChange={e=>set("endAt",fromLocalDT(e.target.value))} style={{...S.input,...(form.endAt<=form.scheduledAt?{borderColor:"#EF4444"}:{})}}/></div>
    {initial&&<div style={S.formGroup}><label style={S.label}>Estado</label><select value={form.status} onChange={e=>set("status",e.target.value)} style={S.input}>{Object.entries(STATUS_CONFIG).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></div>}
    <div style={{...S.formGroup,gridColumn:"1/-1"}}>
      <label style={S.label}>Volumen (m³) — {TRUCK_CAPACITY}m³/camión → necesita {neededTrucks} camión{neededTrucks!==1?"es":""}</label>
      <input type="number" min="0.01" max="100" step="0.01" value={form.m3} onChange={e=>{ const v=e.target.value; set("m3", v===''?'':v); }} style={{...S.input,maxWidth:120}}/>
    </div>
    <div style={{...S.formGroup,gridColumn:"1/-1"}}><label style={S.label}>Camiones ({form.trucks.length} sel. · cap: {form.trucks.length*TRUCK_CAPACITY}m³){form.trucks.length<neededTrucks&&<span style={{color:"#F59E0B",marginLeft:8}}>⚠ Faltan {neededTrucks-form.trucks.length}</span>}</label><div style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:4}}>{trucks.map(tr=>{const sel=form.trucks.includes(tr);const hasConfl=conflicts.some(c=>c.conflictTruck===tr);return <button key={tr} onClick={()=>toggleTruck(tr)} style={{padding:"8px 14px",borderRadius:8,border:`2px solid ${hasConfl?"#EF4444":sel?"#4F8EF7":C.border}`,background:hasConfl?"#FEE2E2":sel?`${C.accent}22`:C.bg,color:hasConfl?"#EF4444":sel?C.accent:C.muted,fontWeight:sel?700:400,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",gap:6}}>🚛 {tr} {hasConfl&&"⚠"}</button>;})}</div></div>
    {conflicts.length>0&&<div style={{...S.formGroup,gridColumn:"1/-1"}}><div style={{background:"#FEE2E2",border:"1px solid #EF444455",borderRadius:8,padding:12}}><div style={{fontWeight:700,color:"#EF4444",marginBottom:6}}>⚠ Conflicto de horario</div>{conflicts.map(c=><div key={c.id} style={{fontSize:13,color:"#7f1d1d",marginBottom:4}}>{c.conflictTruck}: <strong>{c.client}</strong> ({fmtTime(c.scheduledAt)}{c.endAt?` → ${fmtTime(c.endAt)}`:""})</div>)}<div style={{fontSize:12,color:"#7f1d1d",marginTop:6}}>Cambiá el horario o seleccioná otros camiones.</div></div></div>}
    <div style={{...S.formGroup,gridColumn:"1/-1"}}><label style={S.label}>Notas</label><textarea value={form.notes} onChange={e=>set("notes",e.target.value)} style={{...S.input,minHeight:52,resize:"vertical"}} placeholder="Observaciones…"/></div>
  </div><div style={S.modalFooter}><button onClick={onClose} style={S.btnSecondary}>Cancelar</button><button onClick={()=>{if(canSave)onSave({...form,m3:parseFloat(form.m3)});}} style={{...S.btnPrimary,opacity:canSave?1:.45,cursor:canSave?"pointer":"not-allowed"}}>{initial?"Guardar":"Crear turno"}</button></div></div></div>);}

function RemitosView({remitos,onReprint,onDelete}){
  const [q,setQ]=useState("");
  const [confirming,setConfirming]=useState(null);
  const filtered=q.trim()?remitos.filter(r=>(r.cliente||"").toLowerCase().includes(q.toLowerCase())||String(r.numero).includes(q)||(r.camion||"").toLowerCase().includes(q.toLowerCase())):remitos;
  function handleDeleteClick(numero){
    if(confirming===numero){onDelete(numero);setConfirming(null);}
    else{setConfirming(numero);setTimeout(()=>setConfirming(c=>c===numero?null:c),3000);}
  }
  return(<div>
    <div style={S.filters}><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar por cliente, camión o N°…" style={{...S.select,minWidth:260}}/></div>
    {filtered.length===0&&<div style={S.empty}>Sin remitos{q?" que coincidan":""}</div>}
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      {filtered.map(r=>(
        <div key={r.numero} style={S.turnCard}>
          <div style={S.turnCardTop}>
            <div>
              <div style={S.turnClient}>N° {fmtRemitoNum(r.numero)} · {r.cliente}</div>
              <div style={S.turnMeta}>{r.fecha} · {r.producto}{r.cantidad?` · ${r.cantidad} m³`:""}{r.camion?` · ${r.camion}`:""}{r.chofer?` · ${r.chofer}`:""}</div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>onReprint(r)} style={S.btnSecondary}>🖨 Reimprimir</button>
              {onDelete&&<button onClick={()=>handleDeleteClick(r.numero)} style={S.btnDanger}>{confirming===r.numero?"¿Seguro?":"Eliminar"}</button>}
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>);
}

function RemitoForm({trucks,choferes,patentes,concreteTypes,turns,currentUser,onSave,onClose}){
  const today=dayKey(Date.now());
  const clientesHoy=[...new Set(turns.filter(t=>dayKey(t.scheduledAt)===today&&t.status!=="cancelado").map(t=>t.client).filter(Boolean))];
  const [form,setForm]=useState({
    cliente:"",domicilio:"",telefono:"",clienteNumero:"",observaciones:"",
    producto:concreteTypes[0]||"",cantidad:"",asentamiento:"",aditivoTipo:"",aditivoCantidad:"",
    aguaAgregada:"",camion:trucks[0]||"",chofer:choferes[0]||"",confeccionadoPor:currentUser||"",
    firmaAclaracion:"",observacionesFinal:"",
  });
  const [saving,setSaving]=useState(false);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const patente=form.camion?(patentes[form.camion]||""):"";
  const canSave=form.cliente.trim()&&form.producto.trim()&&!saving;
  async function handleSubmit(){
    if(!canSave) return;
    setSaving(true);
    await onSave({...form,patente});
    setSaving(false);
  }
  return(<div style={S.modalOverlay}><div style={{...S.modal,maxWidth:640}}>
    <div style={S.modalHeader}><h2 style={S.modalTitle}>🧾 Nuevo remito</h2><button onClick={onClose} style={S.modalClose}>✕</button></div>
    <div style={{...S.formGrid,gap:14}}>
      <div style={S.formGroup}><label style={S.label}>Señor(es) / Cliente *</label><input list="remito-clientes-hoy" value={form.cliente} onChange={e=>set("cliente",e.target.value)} style={S.input} placeholder="Nombre del cliente"/>
        <datalist id="remito-clientes-hoy">{clientesHoy.map(c=><option key={c} value={c}/>)}</datalist>
      </div>
      <div style={S.formGroup}><label style={S.label}>Domicilio</label><input value={form.domicilio} onChange={e=>set("domicilio",e.target.value)} style={S.input}/></div>
      <div style={S.formGroup}><label style={S.label}>Teléfono</label><input value={form.telefono} onChange={e=>set("telefono",e.target.value)} style={S.input}/></div>
      <div style={S.formGroup}><label style={S.label}>Cliente N°</label><input value={form.clienteNumero} onChange={e=>set("clienteNumero",e.target.value)} style={S.input}/></div>
      <div style={{...S.formGroup,gridColumn:"1/-1"}}><label style={S.label}>Observaciones</label><input value={form.observaciones} onChange={e=>set("observaciones",e.target.value)} style={S.input}/></div>

      <div style={S.formGroup}><label style={S.label}>Producto *</label>{concreteTypes.length>0?<select value={form.producto} onChange={e=>set("producto",e.target.value)} style={S.input}><option value="">— Seleccionar —</option>{concreteTypes.map(c=><option key={c} value={c}>{c}</option>)}</select>:<input value={form.producto} onChange={e=>set("producto",e.target.value)} style={S.input} placeholder="Ej: H-25"/>}</div>
      <div style={S.formGroup}><label style={S.label}>Cantidad (m³)</label><input type="number" min="0" step="0.01" value={form.cantidad} onChange={e=>set("cantidad",e.target.value)} style={S.input}/></div>
      <div style={S.formGroup}><label style={S.label}>Asentamiento (cm)</label><input value={form.asentamiento} onChange={e=>set("asentamiento",e.target.value)} style={S.input}/></div>
      <div style={S.formGroup}><label style={S.label}>Aditivo — Tipo</label><input value={form.aditivoTipo} onChange={e=>set("aditivoTipo",e.target.value)} style={S.input}/></div>
      <div style={S.formGroup}><label style={S.label}>Aditivo — Cantidad</label><input value={form.aditivoCantidad} onChange={e=>set("aditivoCantidad",e.target.value)} style={S.input}/></div>
      <div style={S.formGroup}><label style={S.label}>Agua agregada en obra (L)</label><input value={form.aguaAgregada} onChange={e=>set("aguaAgregada",e.target.value)} style={S.input} placeholder="— (dejar vacío si no se agregó)"/></div>

      <div style={S.formGroup}><label style={S.label}>Camión</label><select value={form.camion} onChange={e=>set("camion",e.target.value)} style={S.input}>{trucks.length===0&&<option value="">— Sin camiones cargados —</option>}{trucks.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
      <div style={S.formGroup}><label style={S.label}>Patente</label><input value={patente} readOnly style={{...S.input,opacity:.7}} placeholder="— sin asignar —"/></div>
      <div style={S.formGroup}><label style={S.label}>Chofer</label><select value={form.chofer} onChange={e=>set("chofer",e.target.value)} style={S.input}>{choferes.length===0&&<option value="">— Sin choferes cargados —</option>}{choferes.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
      <div style={S.formGroup}><label style={S.label}>Confeccionó</label><input value={form.confeccionadoPor} onChange={e=>set("confeccionadoPor",e.target.value)} style={S.input}/></div>

      <div style={{...S.formGroup,gridColumn:"1/-1"}}><label style={S.label}>Firma y aclaración</label><input value={form.firmaAclaracion} onChange={e=>set("firmaAclaracion",e.target.value)} style={S.input} placeholder="Nombre de quien recibe"/></div>
      <div style={{...S.formGroup,gridColumn:"1/-1"}}><label style={S.label}>Observaciones finales</label><textarea value={form.observacionesFinal} onChange={e=>set("observacionesFinal",e.target.value)} style={{...S.input,minHeight:52,resize:"vertical"}}/></div>
    </div>
    <div style={S.modalFooter}><button onClick={onClose} style={S.btnSecondary}>Cancelar</button><button onClick={handleSubmit} disabled={!canSave} style={{...S.btnPrimary,opacity:canSave?1:.45,cursor:canSave?"pointer":"not-allowed"}}>{saving?"Guardando…":"Guardar e imprimir"}</button></div>
  </div></div>);
}

const C={bg:"#0F1117",sidebar:"#161820",panel:"#1C1F2E",border:"#2A2D3E",text:"#E8EAF0",muted:"#6B7280",accent:"#4F8EF7"};
const S={app:{display:"flex",height:"100vh",background:C.bg,fontFamily:"'IBM Plex Sans','Segoe UI',sans-serif",color:C.text,overflow:"hidden"},sidebar:{width:220,background:C.sidebar,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",padding:"20px 0",flexShrink:0},sidebarLogo:{display:"flex",alignItems:"center",gap:10,padding:"0 20px 24px",borderBottom:`1px solid ${C.border}`},logoIcon:{fontSize:28,color:C.accent,lineHeight:1},logoTitle:{fontSize:16,fontWeight:700,letterSpacing:1},logoSub:{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1},nav:{padding:"16px 12px",flex:1,display:"flex",flexDirection:"column",gap:4},navItem:{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderRadius:8,border:"none",background:"transparent",color:C.muted,fontSize:14,cursor:"pointer",textAlign:"left"},navItemActive:{background:`${C.accent}22`,color:C.accent,fontWeight:600},navIcon:{fontSize:16,width:20,textAlign:"center"},sidebarFooter:{padding:"16px 16px 0",borderTop:`1px solid ${C.border}`},userBadge:{display:"flex",alignItems:"center",gap:10,marginBottom:12},userAvatar:{width:32,height:32,borderRadius:"50%",background:C.accent,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:14,flexShrink:0},userName:{fontSize:13,fontWeight:600},userRole:{fontSize:11,color:C.muted},logoutBtn:{width:"100%",padding:"8px",background:"transparent",border:`1px solid ${C.border}`,color:C.muted,borderRadius:6,cursor:"pointer",fontSize:12},main:{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"},header:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"20px 28px",borderBottom:`1px solid ${C.border}`,background:C.sidebar,flexShrink:0},pageTitle:{fontSize:20,fontWeight:700,margin:0},pageDate:{fontSize:12,color:C.muted,marginTop:2},content:{flex:1,overflow:"auto",padding:24},statsGrid:{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:24},statCard:{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:20,textAlign:"center"},statIcon:{fontSize:22,marginBottom:8},statValue:{fontSize:32,fontWeight:800,lineHeight:1},statLabel:{fontSize:12,color:C.muted,marginTop:4,textTransform:"uppercase",letterSpacing:.5},dashGrid:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20},panel:{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:20},panelTitle:{fontSize:13,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:1,margin:"0 0 14px"},empty:{color:C.muted,textAlign:"center",padding:"24px 0",fontSize:14},filters:{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap"},select:{background:C.panel,border:`1px solid ${C.border}`,color:C.text,padding:"8px 12px",borderRadius:8,fontSize:13,cursor:"pointer"},turnCard:{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:16},turnCardTop:{display:"flex",justifyContent:"space-between",alignItems:"flex-start"},statusDot:{width:10,height:10,borderRadius:"50%",flexShrink:0,marginTop:4},turnClient:{fontWeight:700,fontSize:15},turnMeta:{fontSize:12,color:C.muted,marginTop:2},turnDetails:{display:"flex",flexWrap:"wrap",gap:"6px 16px",marginTop:12,fontSize:13,color:C.muted},turnActions:{display:"flex",gap:8,marginTop:14,flexWrap:"wrap"},badge:{fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,letterSpacing:.3,whiteSpace:"nowrap"},truckRow:{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:`1px solid ${C.border}`},truckIcon:{fontSize:20},truckName:{fontSize:14,fontWeight:600},truckClient:{fontSize:12,color:C.muted},truckGrid:{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:20},truckCard:{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:20},truckCardHeader:{display:"flex",gap:14,alignItems:"center",marginBottom:16},truckCardName:{fontSize:18,fontWeight:800,marginBottom:6},truckActive:{background:`${C.border}88`,borderRadius:8,padding:12,marginBottom:14},truckActiveLabel:{fontSize:11,color:C.muted,textTransform:"uppercase",letterSpacing:.5,marginBottom:4},truckActiveClient:{fontWeight:700,fontSize:14},truckActiveMeta:{fontSize:12,color:C.muted,marginTop:2},truckStats:{display:"flex",gap:20},truckStat:{textAlign:"center",fontSize:12,color:C.muted},truckStatNum:{display:"block",fontSize:22,fontWeight:800,color:C.text},plantCard:{flex:1,minWidth:360,background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:24},plantHeader:{display:"flex",gap:16,alignItems:"center",marginBottom:20},plantName:{fontSize:22,fontWeight:800},plantStatus:{fontSize:13,color:C.muted,marginTop:4},plantStats:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:20},plantStat:{background:`${C.border}55`,borderRadius:8,padding:12,textAlign:"center"},plantStatNum:{fontSize:24,fontWeight:800},plantStatLabel:{fontSize:11,color:C.muted,marginTop:2},btnPrimary:{background:C.accent,color:"#fff",border:"none",padding:"10px 20px",borderRadius:8,cursor:"pointer",fontWeight:700,fontSize:14},btnSecondary:{background:"transparent",color:C.muted,border:`1px solid ${C.border}`,padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:13},btnAdvance:{background:`${C.accent}22`,color:C.accent,border:`1px solid ${C.accent}55`,padding:"7px 14px",borderRadius:8,cursor:"pointer",fontWeight:700,fontSize:13},btnDanger:{background:"#EF444422",color:"#EF4444",border:"1px solid #EF444455",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontSize:13},modalOverlay:{position:"fixed",inset:0,background:"#000A",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100},modal:{background:C.panel,border:`1px solid ${C.border}`,borderRadius:16,width:"90%",maxWidth:560,maxHeight:"90vh",overflow:"auto"},modalHeader:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"20px 24px",borderBottom:`1px solid ${C.border}`},modalTitle:{fontSize:18,fontWeight:800,margin:0},modalClose:{background:"transparent",border:"none",color:C.muted,fontSize:18,cursor:"pointer"},formGrid:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,padding:24},formGroup:{display:"flex",flexDirection:"column",gap:6},label:{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:.5},input:{background:C.bg,border:`1px solid ${C.border}`,color:C.text,padding:"9px 12px",borderRadius:8,fontSize:14,outline:"none"},modalFooter:{display:"flex",justifyContent:"flex-end",gap:10,padding:"16px 24px",borderTop:`1px solid ${C.border}`},loginBg:{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:C.bg,fontFamily:"'IBM Plex Sans','Segoe UI',sans-serif"},loginCard:{background:C.panel,border:`1px solid ${C.border}`,borderRadius:20,padding:40,width:420,textAlign:"center"},loginLogo:{fontSize:48,color:C.accent,marginBottom:8},loginTitle:{fontSize:28,fontWeight:900,margin:"0 0 6px",color:C.text},loginSub:{fontSize:13,color:C.muted,marginBottom:28},loginLabel:{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:14},loginUsers:{display:"flex",flexDirection:"column",gap:8,marginBottom:20},loginUser:{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",borderRadius:10,border:`1px solid ${C.border}`,background:"transparent",color:C.text,cursor:"pointer",fontSize:14},loginUserActive:{border:`1px solid ${C.accent}`,background:`${C.accent}22`,color:C.accent},loginUserAvatar:{width:28,height:28,borderRadius:"50%",background:C.accent,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:13,color:"#fff"},calDayStrip:{display:"flex",gap:6,overflowX:"auto",paddingBottom:4},calDayBtn:{display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"10px 12px",borderRadius:10,border:`1px solid ${C.border}`,background:C.panel,color:C.muted,cursor:"pointer",minWidth:56,flexShrink:0},calDayBtnActive:{background:C.accent,border:`1px solid ${C.accent}`,color:"#fff"},calDayBtnToday:{border:`1px solid ${C.accent}`,color:C.accent},calDot:{width:5,height:5,borderRadius:"50%",background:C.accent},calEventBtn:{border:"none",borderRadius:4,padding:"2px 7px",cursor:"pointer",fontWeight:700,background:`${C.border}`,color:C.muted},settingsRow:{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderBottom:`1px solid ${C.border}`},btnSave:{background:"#10B98122",color:"#10B981",border:"1px solid #10B98155",padding:"5px 10px",borderRadius:6,cursor:"pointer",fontWeight:700,fontSize:12},btnCancelSm:{background:"transparent",color:C.muted,border:`1px solid ${C.border}`,padding:"5px 10px",borderRadius:6,cursor:"pointer",fontSize:12},btnEdit:{background:`${C.accent}22`,color:C.accent,border:`1px solid ${C.accent}44`,padding:"5px 10px",borderRadius:6,cursor:"pointer",fontSize:12,whiteSpace:"nowrap"},btnDangerSm:{background:"#EF444422",color:"#EF4444",border:"1px solid #EF444444",padding:"5px 8px",borderRadius:6,cursor:"pointer",fontSize:12},btnAddItem:{marginTop:10,background:"transparent",color:C.accent,border:`1px dashed ${C.accent}88`,padding:"7px 14px",borderRadius:8,cursor:"pointer",fontSize:13,width:"100%"},tabBtn:{padding:"8px 16px",borderRadius:"8px 8px 0 0",border:"none",background:"transparent",color:C.muted,cursor:"pointer",fontSize:13,fontWeight:600},tabBtnActive:{background:C.panel,color:C.accent,borderBottom:`2px solid ${C.accent}`}};
