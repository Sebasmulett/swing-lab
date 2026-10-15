// Swing Lab · ranking en línea (Supabase REST). Sin conexión, los puntajes esperan en una cola y se envían después.
(function(){
"use strict";
const SL=window.SL;
const CFG=window.SL_ONLINE_CONFIG||{};
const store={ get(k,d){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):d; }catch(e){ return d; } },
              set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} } };
const QKEY="sl12_queue";
const O=SL.Online={};
O.configured=()=>!!(CFG.url && CFG.key);
const base=()=>CFG.url.replace(/\/+$/,"")+"/rest/v1/"+(CFG.table||"scores");
const headers=()=>({ "apikey":CFG.key, "Authorization":"Bearer "+CFG.key, "Content-Type":"application/json" });
// límites razonables (el servidor revisa lo mismo)
const OK={ round:v=>v>=3&&v<=200, drive:v=>v>=30&&v<=420, speed:v=>v>=10&&v<=75, prox:v=>v>=0&&v<=150 };
O.submit=function(e){
  if(!OK[e.kind] || !OK[e.kind](e.value)) return;
  const q=store.get(QKEY,[]); q.push(Object.assign({created:Date.now()},e)); store.set(QKEY,q.slice(-200)); O.flush();
};
let flushing=false;
O.flush=async function(){
  if(!O.configured() || flushing || (navigator.onLine===false)) return;
  const q=store.get(QKEY,[]); if(!q.length) return; flushing=true;
  try{
    const rows=q.map(e=>({player:e.player, pid:e.pid, kind:e.kind, course:e.course||"", sel:e.sel||"", value:e.value, par_diff:e.par_diff??null, src:e.src||null, club:e.club||null, app:e.app||null}));
    const r=await fetch(base(),{method:"POST", headers:Object.assign({"Prefer":"return=minimal"},headers()), body:JSON.stringify(rows)});
    if(r.ok){ store.set(QKEY,[]); O.lastError=null; } else { O.lastError="HTTP "+r.status; if(r.status>=400 && r.status<500 && r.status!==429) store.set(QKEY,[]); }
  }catch(err){ O.lastError=String(err&&err.message||err); }
  flushing=false;
  if(!O.lastError && store.get(QKEY,[]).length) setTimeout(()=>O.flush(),300);
};
setInterval(()=>O.flush(),60000);
O.pending=()=>store.get(QKEY,[]).length;
// mejores marcas: una por jugador (la mejor), ordenadas
O.top=async function({kind, course, sel, asc=true, limit=50}){
  if(!O.configured()) throw new Error("sin configurar");
  const p=new URLSearchParams({select:"player,pid,value,par_diff,course,sel,src,club,created_at", kind:"eq."+kind, order:"value."+(asc?"asc":"desc"), limit:"500"});
  if(course) p.set("course","eq."+course); if(sel) p.set("sel","eq."+sel);
  const r=await fetch(base()+"?"+p.toString(),{headers:headers()}); if(!r.ok) throw new Error("HTTP "+r.status);
  const rows=await r.json(), seen=new Set(), out=[];
  // una fila por jugador: por id y también por nombre (si alguien reinstala la app, su nombre no se repite)
  const nk=n=>String(n||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase();
  for(const x of rows){ const k2="n:"+nk(x.player); if(seen.has(x.pid)||seen.has(k2)) continue; seen.add(x.pid); seen.add(k2); out.push(x); if(out.length>=limit) break; }
  return out;
};
window.addEventListener("online",()=>O.flush());
setTimeout(()=>O.flush(),1500);
})();
