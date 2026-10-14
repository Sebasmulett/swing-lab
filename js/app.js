// Swing Lab · interfaz, sensores y juego
(function(){
"use strict";
const SL=window.SL, CLUBS=SL.CLUBS, DEG=SL.DEG, World=SL.World;
const VERSION="0.7";
const $=id=>document.getElementById(id);
const store={ get(k,d){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):d; }catch(e){ return d; } },
              set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} } };
const S=Object.assign({units:"mph", dist:"m", hand:"R", hold:"phone", invert:false, input:"sensor", camFacing:"user", camGrip:"empty", camView:"front", voice:true, cont:true, guide:false, guideRatio:"24/8"}, store.get("sl2_settings",{}));
let club=store.get("sl2_club","driver"); if(!CLUBS[club]) club="driver";
let mode=store.get("sl3_mode","range"); if(!["range","course","data"].includes(mode)) mode="range";
let calib=Object.assign(Object.fromEntries(Object.keys(CLUBS).map(k=>[k,[]])), store.get("sl2_calib",{}));
let myCarry=store.get("sl5_mycarry",{});
let history=store.get("sl2_hist",[]), traces=store.get("sl2_traces",[]), records=store.get("sl2_records",{});
let rangeMarks=store.get("sl3_rangeMarks",[]);
let course=store.get("sl4_course",null);
let shown=null, lastReal=null, suggested=null, has3D=false;
const saveSettings=()=>store.set("sl2_settings",S);
const launch=(c,ms,h,lie)=>SL.launchFor(c,ms,h,lie,S.hand);

// ================= Derivados y formato =================
const median=a=>{ const r=a.slice().sort((x,y)=>x-y), m=r.length>>1; return r.length%2?r[m]:(r[m-1]+r[m])/2; };
const fcache=new Map();
// Calibración: 1) radar si hay; 2) tus distancias habituales (con al menos 3 swings reales de ese palo); 3) ninguna
// sensor y cámara se calibran por separado: cada uno mide distinto
const srcOf=h=>h && h.source==="camera"?"camera":"sensor";
const realOf=(c,src)=>history.filter(h=>h.club===c && !h.sim && srcOf(h)===src);
function factor(c,src="sensor"){ const p=calib[c]||[]; if(src==="sensor" && p.length) return median(p.map(x=>x.radar/x.est));
  const mc=myCarry[c], mine=realOf(c,src).slice(0,12);
  if(!mc || mine.length<3) return 1;
  const key=c+"|"+src+"|"+mc+"|"+mine.length+"|"+(mine[0]&&mine[0].id); if(fcache.has(key)) return fcache.get(key);
  let lo=5, hi=80; for(let i=0;i<24;i++){ const mid=(lo+hi)/2, sm=SL.simulateLocal(SL.launchFor(c,mid,null,"tee",S.hand),[0,0],null); if(sm.carry<mc) lo=mid; else hi=mid; }
  const f=Math.max(0.5,Math.min(2,((lo+hi)/2)/median(mine.map(h=>h.msRaw)))); fcache.set(key,f); return f; }
const calibKind=(c,src="sensor")=>src==="sensor"&&(calib[c]||[]).length?"radar":(myCarry[c] && realOf(c,src).length>=3)?"distancias":null;
const dcache=new Map();
function derive(h){
  const ms=h.msRaw*factor(h.club,srcOf(h)), key=h.id+"|"+ms.toFixed(3)+"|"+S.hand; if(dcache.has(key)) return dcache.get(key);
  const sim=SL.simulateLocal(launch(h.club,ms,h,"tee"),[0,0],null);
  const out={ms, carry:sim.carry, total:Math.hypot(sim.x,sim.z), lat:sim.x, latLand:sim.landX, apex:sim.apex, ball:sim.ball, launch:sim.launch, spin:sim.spin};
  dcache.set(key,out); if(dcache.size>800) dcache.clear(); return out;
}
function fmtSpeed(ms){ if(S.units==="kmh") return {v:(ms*3.6).toFixed(0),u:"km/h",say:"kilómetros por hora"};
  if(S.units==="ms") return {v:ms.toFixed(1),u:"m/s",say:"metros por segundo"}; return {v:(ms*2.23694).toFixed(0),u:"mph",say:"millas por hora"}; }
const toUnit=ms=>S.units==="kmh"?ms*3.6:S.units==="ms"?ms:ms*2.23694;
const fromUnit=v=>S.units==="kmh"?v/3.6:S.units==="ms"?v:v/2.23694;
const fmtDist=m=>S.dist==="yd"?Math.round(m/0.9144)+" yd":Math.round(m)+" m";
const sayDist=m=>S.dist==="yd"?Math.round(m/0.9144)+" yardas":Math.round(m)+" metros";
const fmtLat=l=>Math.abs(l)<1?"Centro":fmtDist(Math.abs(l))+(l>0?" der":" izq");
const fmtRatio=r=>r?r.toFixed(1)+":1":"—";
function fmtPath(h){ if(!h.pathOk) return "—"; const a=Math.abs(h.path); if(a<1.5) return "Recta"; return a.toFixed(0)+"° "+(h.path>0?"adentro-afuera":"afuera-adentro"); }
const fmtArc=h=>h.arcTop==null?"—":h.arcTop+"°";
// Forma del tiro según el plano D (perspectiva de diestro; la app espeja para zurdos)
function shapeName(h){ if(!h.faceOk) return null; const p=h.pathOk?h.path:0, start=0.78*h.face+0.22*p, curve=h.face-p;
  const side=start>2?"right":start<-2?"left":"mid", c=curve>6?"slice":curve>2?"fade":curve<-6?"hook":curve<-2?"draw":"straight";
  const R_=S.hand==="R";
  if(c==="straight") return side==="mid"?"Recto":(side==="right")===R_?"Push":"Pull";
  if(c==="fade") return side==="left"?(R_?"Fade":"Push-draw"):side==="right"?(R_?"Push-fade":"Draw"):(R_?"Fade":"Draw");
  if(c==="draw") return side==="right"?(R_?"Draw":"Pull-fade"):side==="left"?(R_?"Pull-draw":"Fade"):(R_?"Draw":"Fade");
  if(c==="slice") return R_?"Slice":"Hook"; return R_?"Hook":"Slice"; }
function fmtFace(h){ if(!h.faceOk) return "—"; const a=Math.abs(h.face); if(a<1.5) return "Cuadrada"; return a.toFixed(0)+"° "+(h.face>0?"abierta":"cerrada"); }
const prefixFor=h=>h.sat?(h.method==="fit"?"~":"≥"):"";

// ================= Audio y voz =================
let ac=null;
function audio(){ try{ if(!ac){ const C=window.AudioContext||window.webkitAudioContext; if(C) ac=new C(); } if(ac && ac.state==="suspended") ac.resume(); }catch(_){} return ac; }
function beep(f,d,at){ const a=audio(); if(!a) return; const o=a.createOscillator(), g=a.createGain(), t0=at??a.currentTime;
  o.type="sine"; o.frequency.value=f; g.gain.setValueAtTime(0.0001,t0); g.gain.exponentialRampToValueAtTime(0.4,t0+0.01); g.gain.exponentialRampToValueAtTime(0.0001,t0+d);
  o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0+d+0.03); }
function noise(dur,freq,q,gain,type){ const a=audio(); if(!a) return; try{
  const n=Math.floor(a.sampleRate*dur), b=a.createBuffer(1,n,a.sampleRate), d=b.getChannelData(0);
  for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/n,3);
  const s=a.createBufferSource(), f=a.createBiquadFilter(), g=a.createGain(); f.type=type||"bandpass"; f.frequency.value=freq; f.Q.value=q; g.gain.value=gain;
  s.buffer=b; s.connect(f); f.connect(g); g.connect(a.destination); s.start(); }catch(_){} }
const sfx={ hit:()=>noise(0.07,2600,1.2,1), land:()=>noise(0.12,320,0.8,0.7,"lowpass"), putt:()=>noise(0.05,1800,2,0.5), cup:()=>{ noise(0.08,900,3,0.6); setTimeout(()=>noise(0.06,1200,3,0.4),90); }, splash:()=>noise(0.45,700,0.5,0.6,"lowpass") };
function playRhythm(){ const a=audio(); if(!a) return; const [B,D]=S.guideRatio.split("/").map(Number), t0=a.currentTime+0.5;
  beep(660,0.09,t0); beep(660,0.09,t0+B/30); beep(990,0.15,t0+(B+D)/30); }
function say(txt){ if(!S.voice || !("speechSynthesis" in window)) return;
  try{ speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(txt); const v=speechSynthesis.getVoices().find(v=>/^es/i.test(v.lang));
    if(v) u.voice=v; u.lang=v?v.lang:"es-ES"; u.rate=1.05; speechSynthesis.speak(u); }catch(_){} }

// ================= Mundo: helpers =================
// En la vista 3D (three.js), mirando hacia el objetivo, la derecha de la pantalla es (-cos yaw, sin yaw)
const rightOf=yaw=>[-Math.cos(yaw),Math.sin(yaw)];
const toWorld=(pts,ox,oz,yaw)=>{ const f=[Math.sin(yaw),Math.cos(yaw)], r=rightOf(yaw);
  return pts.map(p=>({t:p.t, x:ox+r[0]*p.x+f[0]*p.z, y:p.y, z:oz+r[1]*p.x+f[1]*p.z})); };
function setHudMsg(t){ const m=$("hudMsg"); if(!t){ m.hidden=true; return; } m.textContent=t; m.hidden=false; }
function showCard(sim,toTarget){ $("cCarry").textContent=fmtDist(sim.carry); $("cTotal").textContent=fmtDist(Math.hypot(sim.x,sim.z));
  $("cLat").textContent=fmtLat(sim.x); $("cApex").textContent=fmtDist(sim.apex); $("cBall").textContent=fmtSpeed(sim.ball).v+" "+fmtSpeed(1).u;
  $("cTgt").textContent=toTarget!=null?fmtDist(toTarget):"—"; $("card").hidden=false; }
// ================= Apuntar (estilo TrackMan) =================
// El objetivo es un punto del suelo. El tiro sale hacia él y el desvío se mide respecto a esa línea.
let rangeAim=store.get("sl7_rangeAim",{x:6,z:150}), aimMode=false, rangeProx=store.get("sl7_rangeProx",[]);
const yawTo=(o,p)=>Math.atan2(p.x-o.x,p.z-o.z);
function aimOrigin(){ return mode==="course"&&course ? course.ball : {x:0,z:0}; }
function aimPoint(){ if(mode==="course"&&course){ const h=HOLES[course.hole]; return course.aim||{x:h.pinX,z:h.L}; } return rangeAim; }
function aimYaw(){ return yawTo(aimOrigin(),aimPoint()); }
function aimDist(){ const o=aimOrigin(), p=aimPoint(); return Math.hypot(p.x-o.x,p.z-o.z); }
function setAim(p,quiet){
  const o=aimOrigin(), d=Math.hypot(p.x-o.x,p.z-o.z); if(d<5) return;
  if(mode==="course"&&course){ const h=HOLES[course.hole]; course.aim = Math.hypot(p.x-h.pinX,p.z-h.L)<1 ? null : {x:+p.x.toFixed(1),z:+p.z.toFixed(1)}; saveCourse(); suggestClub(); }
  else { rangeAim={x:+p.x.toFixed(1),z:+p.z.toFixed(1)}; store.set("sl7_rangeAim",rangeAim); }
  if(has3D){ World.setAim(aimPoint()); if(!aimMode) World.address(o.x,o.z,aimYaw(),false); }
  renderAim(); if(!quiet) beep(1200,0.03);
}
function renderAim(){ const d=aimDist(), o=aimOrigin(), p=aimPoint(); let side="";
  if(mode==="course"&&course){ side=course.aim?"":" · al hoyo"; }
  $("aimDist").textContent=`Objetivo ${fmtDist(d)}${side}`; $("aimGo").textContent=aimMode?"Listo":"🎯 Apuntar"; $("aimPin").hidden=!(mode==="course"&&course&&course.aim);
  $("aimBar").hidden=!has3D || mode==="data" || World.busy() || (mode==="course"&&course&&(course.holed||course.done)) || (S.input==="camera" && SL.Cam.on && !$("camVideo").hidden); void o; void p; }
function nudgeAim(deg){ const o=aimOrigin(), p=aimPoint(), d=Math.hypot(p.x-o.x,p.z-o.z), y=yawTo(o,p)+deg*DEG;
  setAim({x:o.x+Math.sin(y)*d, z:o.z+Math.cos(y)*d},true); }
function toggleAimView(on){ aimMode=on; const o=aimOrigin(), p=aimPoint();
  if(on){ const span=mode==="course"&&course ? Math.max(80,Math.hypot(HOLES[course.hole].pinX-o.x,HOLES[course.hole].L-o.z)*1.15) : 330;
    const yaw=aimYaw(), c={x:o.x+Math.sin(yaw)*span*0.5, z:o.z+Math.cos(yaw)*span*0.5}; World.aimView(true,{x:c.x,z:c.z,span});
    setHudMsg("Toca donde quieres que caiga la bola"); $("card").hidden=true; }
  else { World.aimView(false); World.address(o.x,o.z,aimYaw(),false); setHudMsg(null); }
  renderAim(); }
let shotSeq=0;

// ================= Range =================
function setupRange(){ if(!has3D) return; World.setRange({um:S.dist==="yd"?0.9144:1}); World.setMarks(rangeMarks); World.setAim(rangeAim); World.address(0,0,yawTo({x:0,z:0},rangeAim),true); renderAim(); }
function rangeShot(h){
  const dv=derive(h), sim=SL.simulateLocal(launch(h.club,dv.ms,h,"tee"),[0,0],null);
  if(aimMode) toggleAimView(false);
  const yaw=yawTo({x:0,z:0},rangeAim), pts=toWorld(sim.pts,0,0,yaw), seq=++shotSeq, fin=pts[pts.length-1], toT=Math.hypot(fin.x-rangeAim.x,fin.z-rangeAim.z);
  sfx.hit(); setHudMsg(null); $("card").hidden=true; $("skip").hidden=false; $("aimBar").hidden=true;
  camLayer(false);
  World.playShot({pts, landT:sim.landT, onLand:sfx.land, onEnd:()=>{
    $("skip").hidden=true; rangeMarks.push({x:+fin.x.toFixed(1),z:+fin.z.toFixed(1)}); rangeMarks=rangeMarks.slice(-40); store.set("sl3_rangeMarks",rangeMarks);
    if(!h.sim){ rangeProx.push(+toT.toFixed(1)); rangeProx=rangeProx.slice(-30); store.set("sl7_rangeProx",rangeProx); }
    World.setMarks(rangeMarks); showCard(sim,toT); renderHud(); const sh=shapeName(h); setHudMsg(`A ${fmtDist(toT)} del objetivo`+(sh?` · ${sh}`:""));
    say(`A ${sayDist(toT)} del objetivo.`);
    setTimeout(()=>{ if(seq===shotSeq && !World.busy() && mode==="range"){ World.address(0,0,yawTo({x:0,z:0},rangeAim),true); camLayer(true); setHudMsg(null); $("card").hidden=true; renderAim(); } },3800); }});
}

// ================= Campo =================
const HOLES=SL.HOLES;
const newWind=()=>{ const s=Math.random()<0.25?0:1+Math.random()*4.5, a=Math.random()*Math.PI*2; return {s, x:Math.sin(a)*s, z:Math.cos(a)*s}; };
const saveCourse=()=>store.set("sl4_course",course);
function newRound(){ course={hole:0, ball:{x:0,z:0}, lie:"tee", strokes:0, scores:[], lines:[], wind:HOLES.map(newWind), holed:false, done:false};
  saveCourse(); setupHole(true); renderScore(); }
const holeYaw=()=>{ const h=HOLES[course.hole]; return Math.atan2(h.pinX-course.ball.x, h.L-course.ball.z); };
const distToPin=()=>{ const h=HOLES[course.hole]; return Math.hypot(h.pinX-course.ball.x, h.L-course.ball.z); };
let builtHole=-1;
function setupHole(announce){
  if(has3D){ if(builtHole!==course.hole || announce){ World.setHole(HOLES[course.hole]); builtHole=course.hole; }
    World.setWind(course.wind[course.hole]); World.setLines(course.lines); World.setAim(aimPoint()); World.address(course.ball.x,course.ball.z,aimYaw(),true); }
  renderAim();
  suggestClub(); renderHud(); drawMini(); camLayer(true);
  if(announce){ const h=HOLES[course.hole], w=course.wind[course.hole];
    say(`Hoyo ${course.hole+1}, par ${h.par}, ${sayDist(h.L)}.`+(w.s>0.3?` Viento de ${Math.round(w.s)} metros por segundo.`:" Sin viento.")); }
}
function expectedTotal(c,lie){ const mine=history.filter(h=>h.club===c && !h.sim), ms=mine.length?mine.slice(0,10).reduce((a,h)=>a+h.msRaw*factor(c,srcOf(h)),0)/Math.min(10,mine.length):CLUBS[c].def;
  const s=SL.simulateLocal(launch(c,ms,null,lie),[0,0],null); return Math.hypot(s.x,s.z); }
function suggestClub(){
  if(mode!=="course" || !course || course.holed){ suggested=null; renderChips(); return; }
  const R=aimDist(), allowed=SL.CLUB_ORDER.filter(c=>c==="driver"?course.lie==="tee":c==="wood3"?(course.lie==="tee"||course.lie==="fairway"):(course.lie==="bunker"?["sw","wedge","iron9"].includes(c):true));
  const opts=allowed.map(c=>({c,t:expectedTotal(c,course.lie)}));
  suggested=(opts.find(o=>o.t>=R*0.92)||opts[opts.length-1]).c; if(suggested!==club) setClub(suggested,true); renderChips();
}
function puttsFor(d){ const r=Math.random(); if(d<1.5) return 1; if(d<3) return r<0.6?1:2; if(d<8) return r<0.15?1:(r<0.93?2:3); if(d<15) return r<0.05?1:(r<0.8?2:3); return r<0.6?2:3; }
const RESULT={"-3":"¡Albatros!","-2":"¡Eagle!","-1":"Birdie","0":"Par","1":"Bogey","2":"Doble bogey"};
function finishHole(text,voice){
  const hole=HOLES[course.hole]; course.holed=true; course.scores[course.hole]=course.strokes;
  if(course.hole===HOLES.length-1){ course.done=true; const tot=course.scores.reduce((a,b)=>a+b,0), par=HOLES.reduce((a,b)=>a+b.par,0), dd=tot-par;
    if(records.course==null || tot<records.course){ records.course=tot; store.set("sl2_records",records); voice+=" ¡Nuevo récord!"; }
    voice+=` Ronda terminada: ${tot} golpes, ${dd===0?"par del campo":dd>0?dd+" sobre par":(-dd)+" bajo par"}.`; }
  setHudMsg(text); say(voice); saveCourse(); renderHud(); renderScore();
  const seq=shotSeq; if(!course.done) setTimeout(()=>{ if(seq===shotSeq && course.holed && !course.done) nextHole(); },6500);
}
function courseShot(h){
  if(course.done){ say("La ronda terminó. Empieza una nueva."); return; }
  if(course.holed) nextHole();
  if(aimMode) toggleAimView(false);
  const hole=HOLES[course.hole], yaw=aimYaw(), ox=course.ball.x, oz=course.ball.z, w=course.wind[course.hole], tgt=aimPoint();
  const f=[Math.sin(yaw),Math.cos(yaw)], r=rightOf(yaw), windLocal=[w.x*r[0]+w.z*r[1], w.x*f[0]+w.z*f[1]];
  const dv=derive(h), o=launch(h.club,dv.ms,h,course.lie);
  const sim=SL.simulateLocal(o, windLocal, (lx,lz)=>SL.lieAt(hole, ox+r[0]*lx+f[0]*lz, oz+r[1]*lx+f[1]*lz));
  const pts=toWorld(sim.pts,ox,oz,yaw), fx=ox+r[0]*sim.x+f[0]*sim.z, fz=oz+r[1]*sim.x+f[1]*sim.z;
  const endLie = sim.landG==="water"||sim.landG==="ob" ? sim.landG : SL.lieAt(hole,fx,fz);
  const line=pts.filter(p=>p.t<=sim.landT).filter((p,i,a)=>i%4===0||i===a.length-1).map(p=>({x:+p.x.toFixed(1),y:+p.y.toFixed(1),z:+p.z.toFixed(1)}));
  const seq=++shotSeq; sfx.hit(); setHudMsg(null); $("card").hidden=true; $("skip").hidden=false; $("aimBar").hidden=true;
  camLayer(false);
  World.playShot({pts, landT:sim.landT, onLand:()=>(endLie==="water"?sfx.splash():sfx.land()), onEnd:()=>{
    $("skip").hidden=true; showCard(sim, Math.hypot(fx-tgt.x,fz-tgt.z));
    course.lines.push(line); World.setLines(course.lines);
    if(endLie==="water" || endLie==="ob"){
      course.strokes+=2; const text=endLie==="water"?"¡Agua! +1 de penalidad":"Fuera de límites · +1";
      setHudMsg(text); say((endLie==="water"?"Al agua.":"Fuera de límites.")+" Penalidad de un golpe. Juegas de nuevo desde el mismo sitio.");
      saveCourse(); renderHud(); renderScore(); drawMini(); suggestClub();
      setTimeout(()=>{ if(seq===shotSeq && !World.busy()){ setHudMsg(null); setupHole(false); } },2800); return;
    }
    course.strokes+=1; course.ball={x:fx,z:fz}; course.lie=endLie; course.aim=null; drawMini();
    if(Math.hypot(tgt.x-hole.pinX,tgt.z-hole.L)>1) setTimeout(()=>{ if(seq===shotSeq) say(`A ${sayDist(Math.hypot(fx-tgt.x,fz-tgt.z))} del objetivo.`); },2200);
    const d=distToPin();
    if(d<0.3){ const diff=course.strokes-hole.par, name=course.strokes===1?"¡Hoyo en uno!":(RESULT[diff]||(diff>0?`+${diff}`:`${diff}`));
      sfx.cup(); finishHole(`¡Embocada! ${name}`, `¡Embocada! ${name}.`); return; }
    if(endLie==="green"){
      const n=puttsFor(d); setHudMsg(`En el green a ${fmtDist(d)}`); say(`En el green a ${sayDist(d)}.`);
      setTimeout(()=>{ if(seq!==shotSeq) return; setHudMsg(null); $("card").hidden=true;
        World.playPutts({from:{x:fx,z:fz}, pin:{x:hole.pinX,z:hole.L}, n, onPutt:()=>sfx.putt(), onHole:()=>sfx.cup(), onEnd:()=>{
          course.strokes+=n; const diff=course.strokes-hole.par, name=RESULT[diff]||(diff>0?`+${diff}`:`${diff}`);
          course.ball={x:hole.pinX,z:hole.L}; finishHole(`${n} putt${n>1?"s":""} · ${name}`, `${n} putt${n>1?"s":""}. ${name}.`); }}); },1800);
      return;
    }
    if(course.strokes>=hole.par+5){ course.strokes+=1; finishHole("Máximo de golpes · recoges la bola","Llegaste al máximo de golpes en este hoyo."); return; }
    const lieName={fairway:"En la calle",rough:"En el rough",bunker:"En el bunker",tee:"En el tee"}[endLie]||"";
    setHudMsg(`${lieName} · faltan ${fmtDist(d)}`); say(`${lieName}. Faltan ${sayDist(d)}.`);
    saveCourse(); renderHud(); renderScore(); suggestClub();
    setTimeout(()=>{ if(seq===shotSeq && !World.busy()){ setHudMsg(null); setupHole(false); } },3200);
  }});
}
function nextHole(){ if(!course || course.done) return; if(course.hole<HOLES.length-1){ course.hole++; course.ball={x:0,z:0}; course.lie="tee"; course.strokes=0; course.lines=[]; course.holed=false; course.aim=null;
  saveCourse(); setHudMsg(null); $("card").hidden=true; setupHole(true); renderScore(); } }
function renderHud(){
  const R=$("hudR");
  if(mode==="range"){ $("hudL").innerHTML=`<b>Driving range</b>${CLUBS[club].name}`;
    const pr=rangeProx.slice(-10); R.innerHTML=pr.length?`<b>${fmtDist(pr.reduce((a,b)=>a+b,0)/pr.length)}</b>proximidad media · ${pr.length} tiro${pr.length===1?"":"s"}`:`<b>${rangeMarks.length}</b>tiros en pantalla`;
    R.hidden=!pr.length && !rangeMarks.length; renderAim(); return; }
  if(mode!=="course" || !course) return;
  const h=HOLES[course.hole], w=course.wind[course.hole], d=distToPin();
  $("hudL").innerHTML=`<b>Hoyo ${course.hole+1} · Par ${h.par}</b>${h.name} · ${course.holed?"terminado":"faltan "+fmtDist(d)}`;
  const tot=course.scores.reduce((a,b,i)=>a+(b||0)-(b?HOLES[i].par:0),0); R.hidden=false;
  R.innerHTML=`<b>${course.holed?course.strokes+" golpes":"Golpe "+(course.strokes+1)}</b>${w.s>0.3?"Viento "+w.s.toFixed(0)+" m/s "+windArrow(w):"Sin viento"}<br>Ronda: ${tot===0?"par":tot>0?"+"+tot:tot}`;
}
function windArrow(w){ if(!course) return ""; const rel=aimYaw()-Math.atan2(w.x,w.z), a=((rel/DEG)%360+360)%360;
  return ["↑","↗","→","↘","↓","↙","←","↖"][Math.round(a/45)%8]; }
function renderScore(){
  if(!course) return; const tbl=$("scoreTbl"), par=HOLES.reduce((a,b)=>a+b.par,0);
  const cells=HOLES.map((h,i)=>{ const s=course.scores[i], cls=s==null?"":s<h.par?"sc-under":s>h.par?"sc-over":"";
    return `<td class="${i===course.hole&&!course.done?"sc-cur":""} ${cls}">${s??(i===course.hole&&course.strokes?course.strokes:"")}</td>`; }).join("");
  const tot=course.scores.reduce((a,b)=>a+(b||0),0);
  tbl.innerHTML=`<thead><tr><th>Hoyo</th>${HOLES.map((h,i)=>`<th>${i+1}</th>`).join("")}<th>Total</th></tr></thead><tbody><tr><td>Par</td>${HOLES.map(h=>`<td>${h.par}</td>`).join("")}<td>${par}</td></tr><tr><td>Golpes</td>${cells}<td><b>${tot||"—"}</b></td></tr></tbody>`;
  $("nextHole").hidden=!(course.holed && !course.done);
  $("courseNote").textContent = course.done ? `Ronda terminada: ${tot} golpes (${tot-par===0?"par del campo":tot-par>0?"+"+(tot-par):tot-par}).`+(records.course?` Tu récord: ${records.course}.`:"")
    : "Tres hoyos: par 4 con bunkers, par 3 con agua delante del green y par 5 con un lago a la izquierda. Los putts se juegan solos según la distancia. El viento cambia en cada hoyo."+(records.course?` Tu récord: ${records.course} golpes.`:"");
}
function drawMini(){
  const cv=$("mini"); if(cv.hidden || !course) return; const dpr=window.devicePixelRatio||1, W=cv.clientWidth, H=cv.clientHeight;
  cv.width=W*dpr; cv.height=H*dpr; const c=cv.getContext("2d"); c.setTransform(dpr,0,0,dpr,0,0);
  const h=HOLES[course.hole], sc=(H-10)/(h.L+40), X=x=>W/2-x*sc, Y=z=>H-6-(z+5)*sc;   // igual que se ve desde el tee en 3D
  c.fillStyle="#5a893a"; c.fillRect(0,0,W,H);
  c.fillStyle="#86be5a"; c.beginPath(); let first=true;
  for(let z=h.fwStart; z<=h.L; z+=6){ const x=SL.cxAt(h,z)-SL.hwAt(h,z); first?(c.moveTo(X(x),Y(z)),first=false):c.lineTo(X(x),Y(z)); }
  for(let z=h.L; z>=h.fwStart; z-=6){ c.lineTo(X(SL.cxAt(h,z)+SL.hwAt(h,z)),Y(z)); } c.fill();
  c.fillStyle="#2a6c96"; h.water.forEach(w=>c.fillRect(X(w.x0),Y(w.z1),(w.x1-w.x0)*sc,(w.z1-w.z0)*sc));
  c.fillStyle="#e2cf9c"; h.bunkers.forEach(b=>{ c.beginPath(); c.arc(X(b.x),Y(b.z),Math.max(1.5,b.r*sc),0,Math.PI*2); c.fill(); });
  c.fillStyle="#95d068"; c.beginPath(); c.arc(X(h.pinX),Y(h.L),Math.max(3,h.greenR*sc),0,Math.PI*2); c.fill();
  c.strokeStyle="rgba(255,255,255,.85)"; c.lineWidth=1; course.lines.forEach(l=>{ c.beginPath(); c.moveTo(X(l[0].x),Y(l[0].z)); c.lineTo(X(l[l.length-1].x),Y(l[l.length-1].z)); c.stroke(); });
  c.fillStyle="#d8392b"; c.fillRect(X(h.pinX)-1,Y(h.L)-7,2,7);
  const b=course.ball; c.fillStyle="#fff"; c.strokeStyle="#000"; c.beginPath(); c.arc(X(b.x),Y(b.z),2.6,0,Math.PI*2); c.fill(); c.stroke();
}

// ================= Panel de datos =================
function css(v){ return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
function postureTips(po){ const t=[];
  if(Math.abs(po.head)>=8) t.push(`Tu cabeza se movió ${Math.abs(po.head)} cm ${po.head>0?"hacia el objetivo":"hacia atrás"} antes del impacto: intenta mantenerla quieta.`);
  if(po.sway<=-10) t.push(`Tu cadera se deslizó ${-po.sway} cm hacia atrás en la subida: gira sin desplazarte.`);
  if(po.shTurn<60) t.push(`Giraste los hombros unos ${po.shTurn}°: un giro más completo da más distancia.`);
  else if(po.shTurn>=75) t.push(`Buen giro de hombros (unos ${po.shTurn}°).`);
  return t; }
function verdictFor(h){
  const p=[];
  if(h.ratio==null) p.push("Medí la velocidad, pero no pude separar la subida de la bajada para calcular el tempo.");
  else if(h.ratio>=2.6 && h.ratio<=3.4) p.push("<em>Tempo de libro.</em> Cerca del 3:1 de los profesionales.");
  else if(h.ratio<2.6) p.push("<em>Subida apurada.</em> Lleva el palo arriba más lento y deja que la bajada acelere.");
  else p.push("<em>Subida muy lenta</em> o pausa arriba. Busca un ritmo continuo.");
  if(h.arcTop!=null){ p.push(h.len==="completo"?`Swing completo: ${h.arcTop}° de subida y ${h.arcFin}° de final.`:h.len==="tres cuartos"?`Tres cuartos de swing (${h.arcTop}° de subida).`:`Medio swing (${h.arcTop}° de subida): para pegar más lejos, sube más el palo.`);
    if(h.arcFin!=null && h.arcFin<h.arcTop*0.6) p.push("Frenaste el final: termina el swing con las manos arriba."); }
  const sh=shapeName(h); if(sh) p.push(`<em>${sh}.</em> Cara ${fmtFace(h).toLowerCase()}`+(h.pathOk?`, ruta ${fmtPath(h).toLowerCase()}.`:"."));
  if(h.sat) p.push(h.method==="fit"?"El sensor topó y reconstruí el pico.":"El sensor topó: tu velocidad real es mayor que esta.");
  if(h.source==="camera"){ if(h.posture) p.push(...postureTips(h.posture)); p.push("Con la cámara el tiro sale recto: la cara y la ruta solo se miden con el sensor."); }
  if(h.sim) p.push("Golpe de prueba generado, no se guarda.");
  return p.join(" ");
}
function renderBoard(h,flash){
  const b=$("board"); if(flash){ b.classList.remove("flash"); void b.offsetWidth; b.classList.add("flash"); }
  if(!h) return; b.classList.remove("stale");
  const dv=derive(h), s=fmtSpeed(dv.ms);
  $("prefix").textContent=prefixFor(h); $("speed").textContent=s.v; $("unitLab").textContent=s.u;
  $("tempo").textContent=fmtRatio(h.ratio); $("tempoSub").textContent=h.back!=null?(h.back/1000).toFixed(2)+" / "+(h.down/1000).toFixed(2)+" s":"";
  $("arc").textContent=fmtArc(h); $("arcSub").textContent=h.arcFin!=null?"final "+h.arcFin+"°":"";
  $("face").textContent=fmtFace(h); $("path").textContent=fmtPath(h);
  $("carry").textContent=fmtDist(dv.carry);
  $("clubLab").textContent=CLUBS[h.club].name; const ck=calibKind(h.club,srcOf(h)); $("calibTag").textContent=ck?"· calibrado con "+ck:"";
  if(h.source==="camera") $("quality").textContent=`Cámara a ${h.hz} cuadros por segundo · manos a ${h.hand} m/s en el impacto · lanzamiento ${dv.launch.toFixed(0)}° · spin ${Math.round(dv.spin/100)*100} rpm.`+(h.hz<45?" Con 60 cuadros por segundo la medición es más precisa.":"");
  else $("quality").textContent=`Sensor a ${h.hz} lecturas por segundo · giro en el impacto ${h.omega??h.peak}°/s${h.sat?" (sensor saturado)":""}`+(h.aoa&&h.pathOk?` · ataque ${h.aoa>0?"+":""}${h.aoa}°`:"")+` · lanzamiento ${dv.launch.toFixed(0)}° · spin ${Math.round(dv.spin/100)*100} rpm.`+(h.hz<90?" A menos de 90 lecturas por segundo el pico puede quedar un poco bajo.":"");
}
const setVerdict=html=>{ $("verdict").innerHTML=html; };
function renderHist(){
  const tb=$("hist");
  if(!history.length) tb.innerHTML='<tr><td colspan="7" class="note">Aún no hay swings guardados.</td></tr>';
  else{ const best={}; history.forEach(h=>{ const m=derive(h).ms; if(!(best[h.club]>=m)) best[h.club]=m; });
    tb.innerHTML=history.slice(0,25).map((h,i)=>{ const dv=derive(h), s=fmtSpeed(dv.ms);
      return `<tr><td>${history.length-i}</td><td>${CLUBS[h.club].name}</td><td class="${dv.ms===best[h.club]?"best":""}">${prefixFor(h)}${s.v} ${s.u}</td><td>${fmtRatio(h.ratio)}</td><td>${fmtDist(dv.carry)}</td><td>${fmtDist(dv.total)}</td><td>${shapeName(h)||"—"}</td></tr>`; }).join(""); }
  const mine=history.filter(h=>h.club===club), sp=mine.map(h=>toUnit(derive(h).ms)), u=fmtSpeed(1).u;
  if(!sp.length){ ["kAvg","kBest","kStd","kStreak"].forEach(k=>$(k).textContent="—"); $("kNote").textContent="Aún no hay swings con "+CLUBS[club].name+"."; return; }
  const avg=sp.reduce((a,b)=>a+b,0)/sp.length, sd=Math.sqrt(sp.reduce((a,b)=>a+(b-avg)**2,0)/sp.length);
  let streak=0; for(const h of mine){ if(h.ratio && h.ratio>=2.6 && h.ratio<=3.4) streak++; else break; }
  const dec=S.units==="ms"?1:0;
  $("kAvg").textContent=avg.toFixed(dec)+" "+u; $("kBest").textContent=Math.max(...sp).toFixed(dec)+" "+u;
  $("kStd").textContent=sp.length>1?"±"+sd.toFixed(dec):"—"; $("kStreak").textContent=streak;
  $("kNote").textContent=`${sp.length} swings con ${CLUBS[club].name}. Consistencia: cuanto más bajo, más repetible tu swing. Racha: swings seguidos con tempo entre 2,6 y 3,4.`;
}
function drawTrace(){
  const cv=$("plot"); if(cv.closest("[hidden]")) return; const dpr=window.devicePixelRatio||1, W=cv.clientWidth, H=cv.clientHeight;
  cv.width=W*dpr; cv.height=H*dpr; const c=cv.getContext("2d"); c.setTransform(dpr,0,0,dpr,0,0); c.clearRect(0,0,W,H);
  const tr=shown && shown.trace; if(!tr) return; drawSwingViz();
  const usePhi=!!tr.phi; const D=usePhi?tr.phi.map(v=>v??0):tr.d;
  let lo=0, hi=0; D.forEach(v=>{ lo=Math.min(lo,v); hi=Math.max(hi,v); });
  const T=tr.t[tr.t.length-1]||1, pad=16, x=t=>pad+t/T*(W-2*pad), y=v=>pad+(hi-v)/(hi-lo||1)*(H-2*pad-14);
  c.strokeStyle=css("--line"); c.lineWidth=1; c.beginPath(); c.moveTo(pad,y(0)); c.lineTo(W-pad,y(0)); c.stroke();
  const seg=(a,b,col)=>{ c.strokeStyle=col; c.lineWidth=2.5; c.beginPath(); for(let i=a;i<=b;i++){ const X=x(tr.t[i]),Y=y(D[i]); i===a?c.moveTo(X,Y):c.lineTo(X,Y);} c.stroke(); };
  const top=tr.top ?? 0; seg(0,top,css("--muted")); seg(top,tr.d.length-1,css("--accent"));
  c.fillStyle=css("--ink"); c.font="13px "+css("--body"); c.textAlign="center";
  const mark=(i,ch,dy)=>{ if(i!=null) c.fillText(ch,x(tr.t[i]),y(D[i])+dy); }; mark(tr.start,"▲",16); mark(tr.top,"●",usePhi?-8:16); mark(tr.imp,"★",usePhi?16:-8); if(tr.fin!=null) mark(tr.fin,"■",16);
  c.fillStyle=css("--muted"); c.font="11px "+css("--body"); c.textAlign="left"; c.fillText(usePhi?"ángulo del palo (°)":"giro °/s",pad,H-4); c.textAlign="right"; c.fillText((T/1000).toFixed(1)+" s",W-pad,H-4);
}
function drawField(){
  const cv=$("range"); if(cv.closest("[hidden]")) return; const dpr=window.devicePixelRatio||1, W=cv.clientWidth, H=cv.clientHeight;
  cv.width=W*dpr; cv.height=H*dpr; const c=cv.getContext("2d"); c.setTransform(dpr,0,0,dpr,0,0);
  c.fillStyle=css("--rough"); c.fillRect(0,0,W,H);
  const shots=history.filter(h=>h.club===club).slice(0,20), cur=shown && shown.club===club?shown:null;
  const tots=shots.map(h=>derive(h).total); if(cur) tots.push(derive(cur).total);
  const maxD=Math.max(120,...tots)*1.15, tee={x:W/2,y:H-18}, sc=(H-36)/maxD;
  c.fillStyle=css("--fairway"); c.beginPath(); c.moveTo(tee.x-14,tee.y+10); c.lineTo(tee.x+14,tee.y+10); c.lineTo(tee.x+22*sc+12,0); c.lineTo(tee.x-22*sc-12,0); c.fill();
  const um=S.dist==="yd"?0.9144:1, ul=S.dist==="yd"?" yd":" m", step=maxD/um>180?50:25;
  c.strokeStyle=css("--line"); c.lineWidth=1; c.fillStyle=css("--muted"); c.font="11px "+css("--body"); c.textAlign="left";
  for(let dd=step; dd*um<maxD; dd+=step){ const R=dd*um*sc; c.beginPath(); c.arc(tee.x,tee.y,R,-Math.PI*0.75,-Math.PI*0.25); c.stroke();
    const lx=tee.x+R*Math.cos(-Math.PI*0.75), ly=tee.y+R*Math.sin(-Math.PI*0.75); if(ly>10) c.fillText(dd+ul,Math.max(4,lx-4),ly-3); }
  const pos=h=>{ const dv=derive(h); return {x:Math.max(6,Math.min(W-6,tee.x+dv.lat*sc)), y:tee.y-dv.total*sc, dv}; };
  c.fillStyle=css("--muted"); shots.forEach(h=>{ if(cur && h.id===cur.id) return; const p=pos(h); c.beginPath(); c.arc(p.x,p.y,3.5,0,Math.PI*2); c.fill(); });
  c.fillStyle=css("--ink"); c.beginPath(); c.arc(tee.x,tee.y,3,0,Math.PI*2); c.fill();
  if(cur){ const p=pos(cur); c.fillStyle=css("--accent"); c.strokeStyle=css("--surface"); c.lineWidth=2; c.beginPath(); c.arc(p.x,p.y,6.5,0,Math.PI*2); c.fill(); c.stroke();
    c.fillStyle=css("--ink"); c.font="600 12px "+css("--body"); c.textAlign=p.x>W*0.6?"right":"left";
    c.fillText(fmtDist(p.dv.total)+" · "+fmtLat(p.dv.lat)+(cur.example?" · ejemplo":""), p.x+(p.x>W*0.6?-10:10), Math.max(14,p.y-8)); }
}
function renderCalib(){
  const u=fmtSpeed(1).u; $("radarUnit").textContent=u;
  if(lastReal){ const v=toUnit(lastReal.msRaw); $("calibLast").textContent=`Último swing (${CLUBS[lastReal.club].name}), sin calibrar: ${v.toFixed(S.units==="ms"?1:0)} ${u}. ¿Cuánto marcó el radar?`; }
  const mc=myCarry[club], nReal=realOf(club,S.input).length;
  $("myCarryIn").value = mc ? (S.dist==="yd"?Math.round(mc/0.9144):Math.round(mc)) : ""; $("myCarryUnit").textContent=S.dist==="yd"?"yd":"m"; $("myCarryClub").textContent=CLUBS[club].name;
  $("myCarryState").textContent = !mc ? `Escribe cuánto vuela normalmente tu ${CLUBS[club].name} (carry).` :
     nReal<3 ? `Guardado. Haz ${3-nReal} swing${3-nReal>1?"s":""} real${3-nReal>1?"es":""} más con el ${CLUBS[club].name} usando ${S.input==="camera"?"la cámara":"el sensor"} para ajustar.` :
     S.input==="sensor" && (calib[club]||[]).length ? "Este palo ya está calibrado con radar; el radar tiene prioridad." : `Ajustado para ${S.input==="camera"?"la cámara":"el sensor"}: tu swing típico con el ${CLUBS[club].name} ahora vuela ${fmtDist(mc)}.`;
  const p=calib[club]||[]; $("calibState").textContent=p.length?`${CLUBS[club].name}: ${p.length} swing${p.length>1?"s":""} comparados, factor ${factor(club).toFixed(2)}.`+(p.length<3?" Agrega algunos más para que sea confiable.":""):`${CLUBS[club].name}: sin calibrar.`;
}
function buildChips(){ const row=$("clubRow"); row.innerHTML=Object.keys(CLUBS).map(k=>`<button class="chip" data-club="${k}" aria-pressed="false">${CLUBS[k].name}</button>`).join("");
  row.querySelectorAll(".chip").forEach(b=>b.addEventListener("click",()=>{ setClub(b.dataset.club); renderHud(); })); }
function renderChips(){ document.querySelectorAll(".chip").forEach(x=>{ x.setAttribute("aria-pressed",String(x.dataset.club===club));
  const old=x.querySelector(".sug"); if(old) old.remove();
  if(mode==="course" && suggested===x.dataset.club){ const s=document.createElement("span"); s.className="sug"; s.textContent="Sugerido"; x.appendChild(s); } });
  const cur=document.querySelector('.chip[aria-pressed="true"]'); if(cur && cur.scrollIntoView) try{ cur.scrollIntoView({block:"nearest",inline:"center",behavior:"smooth"}); }catch(_){} 
  document.querySelectorAll("#distSeg button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.d===S.dist))); }
function renderAll(){ if(typeof renderAim==="function" && $("aimBar")) renderAim(); renderBoard(shown,false); renderHist(); drawTrace(); drawField(); renderCalib(); renderChips(); renderHud(); renderScore(); drawMini(); }

// ================= Resultado de un swing =================
function handleResult(res){
  lastPeakSeen = res.obs ?? res.peak ?? lastPeakSeen;
  if(res.error){ $("board").classList.add("stale"); setVerdict(res.error); beep(220,0.25); say("No reconocí el swing"); updateLive(); return; }
  const {rawSamples,poseFrames,marks,...h}=res;
  if(poseFrames){ lastPose={poseFrames,marks}; $("replayBtn").hidden=false; } else if(!h.sim) { lastPose=null; $("replayBtn").hidden=true; }
  if(S.invert && !h.sim){ h.face=-h.face; h.path=-h.path; }
  if(!h.sim){ history.unshift(h); history=history.slice(0,300); store.set("sl2_hist",history);
    traces.unshift({id:h.id, club:h.club, hz:h.hz, s:rawSamples}); traces=traces.slice(0,25); store.set("sl2_traces",traces); lastReal=h; }
  shown=h; renderBoard(h,true); setVerdict(verdictFor(h)); renderHist(); drawTrace(); drawField(); renderCalib(); updateLive();
  if(navigator.vibrate) try{ navigator.vibrate(60); }catch(_){}
  const dv=derive(h), s=fmtSpeed(dv.ms);
  const sh=shapeName(h);
  if(mode==="range" && has3D){ rangeShot(h); say(`${s.v} ${s.say}. Carry ${sayDist(dv.carry)}.`+(sh?` ${sh}.`:"")); }
  else if(mode==="course" && has3D) courseShot(h);
  else say(`${s.v} ${s.say}.`+(h.ratio?` Tempo ${h.ratio.toFixed(1).replace(".",",")} a 1.`:""));
}

// ================= Sensores =================
// Se mide siempre que los sensores estén activos: quedarse quieto solo sirve para el tono y para afinar la medición.
const TRIGGER=350, QUIET=80, QUIET_MS=260, MAX_CAPTURE=2400, COOLDOWN_MS=1100;
const IOS=/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
let lastG=null, capStart=0, quietSince=null, capMax=0;
// gravedad del teléfono (convención Android: el vector apunta hacia arriba). Safari la entrega con el signo contrario.
function onGravity(e){ const a=e.accelerationIncludingGravity; if(!a || a.x==null) return; const k=IOS?-1:1; lastG=[a.x*k,a.y*k,a.z*k]; }
let phase="off", buf=[], captureEnd=0, stillSince=null, cooldownUntil=0, lastEvent=0, wake=null, gyro=null, hzTimes=[];
let unitScale=1, unitLocked=false, maxRm=0, radVotes=0, liveRate=0, lastPeakSeen=null, readyBeeped=false;
function setPhase(p){
  phase=p; const g=$("go"), st=$("status"); g.className="go"; st.className="pill";
  if(p==="off"){ g.textContent="Activar sensores"; st.textContent="Sensores apagados"; }
  else if(p==="idle"){ g.textContent="Empezar a medir"; st.textContent="En pausa"; st.classList.add("on"); }
  else if(p==="armed"){ g.textContent=readyBeeped?"¡Listo! Haz tu swing":"Midiendo · tocar para pausar"; g.classList.add(readyBeeped?"ready":"live"); st.textContent=readyBeeped?"Listo":"Midiendo"; st.classList.add(readyBeeped?"ready":"on"); }
  else if(p==="capturing"){ g.textContent="Leyendo swing…"; g.classList.add("ready"); }
}
function onSample(s){
  if(!s.g && lastG) s.g=lastG;
  lastEvent=s.t; buf.push(s); while(buf.length && s.t-buf[0].t>6000) buf.shift();
  hzTimes.push(s.t); if(hzTimes.length>120) hzTimes.shift();
  const m=Math.hypot(s.x,s.y,s.z); liveRate=m;
  if(phase==="armed"){
    if(s.t<cooldownUntil){ stillSince=null; return; }
    if(m<25){ if(stillSince==null) stillSince=s.t; else if(!readyBeeped && s.t-stillSince>=400){ readyBeeped=true; setPhase("armed"); if(S.guide) playRhythm(); else beep(880,0.08); } }
    else if(m>40) stillSince=null;
    if(m>TRIGGER){ setPhase("capturing"); capStart=s.t; quietSince=null; capMax=m; clearTimeout(capTimer); capTimer=setTimeout(finishCapture,MAX_CAPTURE+200); }
  } else if(phase==="capturing"){
    // se sigue leyendo hasta que el swing termina: el giro queda bajo por un rato (la pausa de arriba es mucho más corta)
    capMax=Math.max(capMax,m);
    if(m<QUIET){ if(quietSince==null) quietSince=s.t; } else quietSince=null;
    const quiet = quietSince!=null && s.t-quietSince>=QUIET_MS && capMax>TRIGGER*1.25 && s.t-capStart>300;
    if(quiet || s.t-capStart>=MAX_CAPTURE) finishCapture();
  }
}
let capTimer=0;
function finishCapture(){
  clearTimeout(capTimer); if(phase!=="capturing") return;
  handleResult(SL.analyze(buf.slice(), club, {mode:S.hold, hand:S.hand}));
  cooldownUntil=performance.now()+COOLDOWN_MS; stillSince=null; readyBeeped=false; buf=[];
  setPhase(S.cont?"armed":"idle");
}
function onMotion(e){
  onGravity(e); const r=e.rotationRate; if(!r || (r.alpha==null && r.beta==null && r.gamma==null)) return;
  let x=r.beta||0, y=r.gamma||0, z=r.alpha||0;
  // Algunos navegadores entregan rad/s en vez de °/s: si hay mucha aceleración con giro mínimo, corrige la unidad
  if(!unitLocked){ const a=e.accelerationIncludingGravity, am=a?Math.hypot(a.x||0,a.y||0,a.z||0):0, rm=Math.hypot(x,y,z);
    maxRm=Math.max(maxRm,rm); if(maxRm>200) unitLocked=true;            // claramente °/s
    else if(am>25 && rm>0.5 && rm<45 && ++radVotes>=15){ unitScale=180/Math.PI; unitLocked=true; buf.forEach(b=>{ b.x*=unitScale; b.y*=unitScale; b.z*=unitScale; }); } }
  onSample({t:performance.now(), x:x*unitScale, y:y*unitScale, z:z*unitScale});
}
function tryGenericGyro(){ return new Promise(res=>{ try{
  const g=new Gyroscope({frequency:200}); let got=false;
  g.addEventListener("reading",()=>{ if(g.x==null) return; got=true; onSample({t:g.timestamp??performance.now(), x:g.x/DEG, y:g.y/DEG, z:g.z/DEG}); });
  g.addEventListener("error",()=>{ try{g.stop();}catch(_){} res(false); }); g.start(); gyro=g;
  setTimeout(()=>{ if(!got){ try{g.stop();}catch(_){} gyro=null; res(false); } else res(true); },700); }catch(e){ res(false); } }); }
function msg(t,alert){ const m=$("msg"); m.textContent=t; m.className="note"+(alert?" alert":""); }
async function enable(){
  msg(""); audio(); say(" ");
  if(window.top!==window){ msg("Dentro de Claude el teléfono no deja leer los sensores. Usa Golpe de prueba o abre la app publicada.",true); return; }
  if(!window.isSecureContext){ msg("Los sensores solo funcionan si abres la app desde un enlace https. Mientras tanto, usa Golpe de prueba.",true); return; }
  if(typeof DeviceMotionEvent!=="undefined" && typeof DeviceMotionEvent.requestPermission==="function"){
    try{ const p=await DeviceMotionEvent.requestPermission(); if(p!=="granted"){ msg("Sin permiso de movimiento. Cierra la app, vuelve a abrirla y toca Permitir.",true); return; } }
    catch(err){ msg("No pude pedir permiso de movimiento: "+err.message,true); return; } }
  let ok=false; if("Gyroscope" in window) ok=await tryGenericGyro();
  if(!ok){ if(typeof DeviceMotionEvent==="undefined"){ msg("Este dispositivo no tiene giroscopio. Usa Golpe de prueba.",true); return; } window.addEventListener("devicemotion",onMotion); }
  else window.addEventListener("devicemotion",onGravity);   // el giroscopio rápido no trae gravedad
  keepAwake(); readyBeeped=false; cooldownUntil=performance.now()+600; setPhase("armed");
  setTimeout(()=>{ if(!lastEvent) msg("No llegan datos del giroscopio. En iPhone revisa Ajustes › Safari › Movimiento y orientación. También puedes usar Golpe de prueba.",true); },1500);
}
async function keepAwake(){ try{ wake=await navigator.wakeLock?.request("screen"); }catch(_){} }
// ================= Cámara =================
let lastPose=null, camState="off";
function camLayer(on){ const show=on && S.input==="camera" && SL.Cam.on && !SL.Cam.replaying();
  $("camVideo").hidden=!show || !!window.__camMock; $("camCanvas").hidden=!show && !SL.Cam.replaying(); $("camMsg").hidden=!show || !$("camMsg").textContent;
  if(show && mode==="data") $("view").hidden=false; renderAim(); }
function camStatus(text,kind){ const m=$("camMsg"); m.textContent=text||""; m.className="camMsg "+(kind||""); m.hidden=!text || $("camVideo").hidden && !window.__camMock;
  const st=$("status"); st.className="pill"+(kind==="ready"?" ready":kind==="bad"?" wait":" on"); if(text) st.textContent=kind==="ready"?"Listo":kind==="bad"?"Sin cuerpo":"Cámara"; }
async function camStart(){
  msg(""); audio(); say(" ");
  if(window.top!==window){ msg("Dentro de Claude no se puede usar la cámara. Abre la app publicada o usa Golpe de prueba.",true); return; }
  if(!SL.Cam.supported() && !window.__camMock){ msg("Este navegador no permite usar la cámara. Prueba con Safari o Chrome.",true); return; }
  if(!has3D || mode==="data") $("view").hidden=false;
  $("go").textContent="Iniciando cámara…"; $("go").className="go live";
  $("camVideo").hidden=!!window.__camMock; $("camCanvas").hidden=false;
  const ok=await SL.Cam.start({facing:S.camFacing, onStatus:camStatus, onReady:()=>{ if(S.guide) playRhythm(); else beep(880,0.08); },
    onSwing:frames=>{ const res=SL.analyzePose(frames, club, {grip:S.camGrip, view:S.camView}); handleResult(res); }});
  if(!ok){ camState="off"; setCamButton(); camLayer(false); return; }
  camState="on"; keepAwake(); setCamButton(); camLayer(true);
}
function camStop(){ SL.Cam.stop(); camState="off"; setCamButton(); camLayer(false); if(mode==="data") $("view").hidden=true; }
function setCamButton(){ const g=$("go"); g.className="go"; if(camState==="on"){ g.textContent="Cámara activa · tocar para apagar"; g.classList.add("live"); } else { g.textContent="Activar cámara"; $("status").className="pill"; $("status").textContent="Cámara apagada"; } }
function setInput(i){
  if(i===S.input) return;
  if(S.input==="camera") camStop(); else if(phase!=="off") setPhase("idle");
  S.input=i; saveSettings(); document.querySelectorAll("#inputSeg button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.i===i)));
  $("live").hidden=true; msg(""); $("camHelp").hidden=i!=="camera";
  if(i==="camera") setCamButton(); else setPhase(phase==="off"?"off":"idle");
  renderCalib();
}
document.querySelectorAll("#inputSeg button").forEach(b=>b.addEventListener("click",()=>setInput(b.dataset.i)));
$("replayBtn").addEventListener("click",e=>{ e.stopPropagation(); if(!lastPose) return; World.skip(); $("camCanvas").hidden=false; $("camVideo").hidden=true; $("camMsg").hidden=true;
  SL.Cam.replay(lastPose,0.3,()=>{ $("camCanvas").hidden=true; camLayer(true); }); });
$("go").addEventListener("click",()=>{
  if(S.input==="camera"){ if(camState==="on") camStop(); else camStart(); return; }
  if(phase==="off") return enable();
  if(phase==="idle"){ audio(); keepAwake(); readyBeeped=false; cooldownUntil=performance.now()+400; setPhase("armed"); msg(""); return; }
  setPhase("idle");
});
function updateLive(){ const el=$("live");
  if(S.input==="camera"){ if(camState!=="on"){ el.hidden=true; return; } el.hidden=false; el.textContent=`Cámara a ${SL.Cam.fps||"—"} cuadros por segundo`+(SL.Cam.speed!=null?` · manos: ${SL.Cam.speed.toFixed(1)} torsos/s (se dispara en 2,2)`:""); return; }
  if(phase==="off"){ el.hidden=true; return; } el.hidden=false;
  el.textContent=`Giro ahora: ${Math.round(liveRate)}°/s · se dispara a ${TRIGGER}°/s`+(lastPeakSeen!=null?` · último pico: ${Math.round(lastPeakSeen)}°/s`:""); }
setInterval(()=>{ if(hzTimes.length>10){ const span=(hzTimes[hzTimes.length-1]-hzTimes[0])/1000; if(span>0){ $("hz").hidden=false; $("hz").textContent=Math.round((hzTimes.length-1)/span)+" Hz"; } } updateLive(); },250);
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible" && phase==="armed") keepAwake(); });

// ================= Golpe de prueba =================
const gauss=()=>{ let u=0; while(!u)u=Math.random(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*Math.random()); };
function testShot(){
  audio(); const c=CLUBS[club]; let ms;
  if(mode!=="data" && !(mode==="course" && (!course || course.holed || course.done))){
    // apunta a la distancia del objetivo (si el palo llega) con error humano
    const target=aimDist(), lie=mode==="course"?course.lie:"tee"; let lo=c.def*0.15, hi=c.def*1.08;
    for(let i=0;i<20;i++){ const mid=(lo+hi)/2, s=SL.simulateLocal(launch(club,mid,null,lie),[0,0],null); if(Math.hypot(s.x,s.z)<target) lo=mid; else hi=mid; }
    ms=(lo+hi)/2*(1+gauss()*0.05);
  } else ms=c.def*(0.92+Math.random()*0.16);
  const full=c.def*0.85, frac=Math.min(1,ms/full);
  if(S.input==="camera"){ const ratio=4.6*(c.radius/1.55)*(S.camGrip==="club"?1:0.92), hand=ms/factor(club,"camera")/ratio*1.03;
    const res=SL.analyzePose(SL.synthPose({fps:30, handSpeed:hand, hand:S.hand, top:85+frac*85+gauss()*6, finish:95+frac*85, back:640+frac*220+gauss()*40, down:290+gauss()*15, sway:Math.max(0,gauss()*6), head:gauss()*4, turn:60+frac*25}), club, {grip:S.camGrip, view:S.camView});
    if(!res.error) res.sim=true; handleResult(res); return; }
  const peak=SL.omegaFor(club, ms/factor(club), S.hold)*1.005;
  const res=SL.analyze(SL.synthKin({hz:100, peak, face:gauss()*2.5, path:gauss()*3.5, hand:S.hand, top:110+frac*140+gauss()*8, finish:120+frac*140, back:640+frac*200+gauss()*40, down:255+gauss()*15}), club, {mode:S.hold, hand:S.hand});
  if(!res.error) res.sim=true; handleResult(res);
}
$("testShot").addEventListener("click",testShot);
$("view").addEventListener("click",e=>{
  if(World.busy()){ World.skip(); return; }
  if(!has3D || mode==="data" || SL.Cam.replaying() || (S.input==="camera" && SL.Cam.on && !$("camVideo").hidden && !window.__camMock)) return;
  if(mode==="course" && course && (course.holed||course.done)) return;
  const p=World.pick(e.clientX,e.clientY); if(!p) return;
  const o=aimOrigin(); if((p.x-o.x)*Math.sin(aimYaw())+(p.z-o.z)*Math.cos(aimYaw())<3 && !aimMode) return;   // no apuntar hacia atrás
  setAim(p); });
$("aimGo").addEventListener("click",e=>{ e.stopPropagation(); toggleAimView(!aimMode); });
$("aimL").addEventListener("click",e=>{ e.stopPropagation(); nudgeAim(1.5); });
$("aimR").addEventListener("click",e=>{ e.stopPropagation(); nudgeAim(-1.5); });
$("aimPin").addEventListener("click",e=>{ e.stopPropagation(); if(course){ course.aim=null; saveCourse(); World.setAim(aimPoint()); World.address(course.ball.x,course.ball.z,aimYaw(),false); suggestClub(); renderAim(); } });

// ================= Modos y controles =================
function setClub(c,silent){ club=c; store.set("sl2_club",club); $("clubLab").textContent=CLUBS[club].name; if(!silent) renderAll(); else renderChips(); }
function setMode(m){
  mode=m; store.set("sl3_mode",mode);
  document.querySelectorAll(".mode").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.mode===m)));
  document.querySelectorAll("[data-for]").forEach(s=>s.hidden=s.dataset.for!==m);
  $("view").hidden=(m==="data"||!has3D) && !(S.input==="camera" && camState==="on"); $("board").classList.toggle("compact",m!=="data"); $("mini").hidden=m!=="course";
  $("card").hidden=true; setHudMsg(null); $("skip").hidden=true; if(aimMode){ aimMode=false; }
  if(has3D) World.setActive(m!=="data");
  if(m==="range") setupRange();
  else if(m==="course"){ if(!course) newRound(); else { builtHole=-1; setupHole(false); } }
  else { drawTrace(); drawField(); }
  suggestClub(); renderAll();
}
document.querySelectorAll(".mode").forEach(b=>b.addEventListener("click",()=>setMode(b.dataset.mode)));
function selectTab(name){ document.querySelectorAll(".tab").forEach(t=>t.setAttribute("aria-selected",String(t.dataset.tab===name)));
  document.querySelectorAll(".panel").forEach(p=>p.hidden=p.dataset.panel!==name); drawTrace(); drawField(); }
document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click",()=>selectTab(t.dataset.tab)));
$("nextHole").addEventListener("click",nextHole);
$("newRound").addEventListener("click",()=>{ $("card").hidden=true; setHudMsg(null); newRound(); });
$("playRhythm").addEventListener("click",playRhythm);
const bindSel=(id,key,after)=>{ $(id).value=S[key]; $(id).addEventListener("change",e=>{ S[key]=e.target.value; saveSettings(); dcache.clear(); renderAll(); after&&after(); }); };
const bindChk=(id,key)=>{ $(id).checked=S[key]; $(id).addEventListener("change",e=>{ S[key]=e.target.checked; saveSettings(); }); };
function setDist(d){ S.dist=d; saveSettings(); $("dist").value=d; dcache.clear(); renderAll(); if(mode==="range") setupRange(); }
bindSel("units","units"); bindSel("dist","dist",()=>{ if(mode==="range") setupRange(); }); bindSel("hand","hand"); bindSel("guideRatio","guideRatio"); bindSel("hold","hold");
bindSel("camFacing","camFacing",()=>{ if(camState==="on"){ camStop(); camStart(); } }); bindSel("camGrip","camGrip"); bindSel("camView","camView");
bindChk("voice","voice"); bindChk("cont","cont"); bindChk("guide","guide"); bindChk("invert","invert");
document.querySelectorAll("#distSeg button").forEach(b=>b.addEventListener("click",()=>setDist(b.dataset.d)));
$("myCarrySave").addEventListener("click",()=>{ const v=parseFloat($("myCarryIn").value);
  if(!(v>5 && v<400)){ msg("Escribe una distancia válida para el "+CLUBS[club].name+".",true); return; }
  myCarry[club]=S.dist==="yd"?v*0.9144:v; store.set("sl5_mycarry",myCarry); fcache.clear(); dcache.clear(); msg(""); renderAll(); });
$("myCarryReset").addEventListener("click",()=>{ delete myCarry[club]; store.set("sl5_mycarry",myCarry); fcache.clear(); dcache.clear(); renderAll(); });
$("introOk").addEventListener("click",()=>{ $("intro").hidden=true; store.set("sl5_intro",true); });
$("introShow").addEventListener("click",()=>{ $("intro").hidden=false; });
$("radarSave").addEventListener("click",()=>{
  const v=parseFloat($("radarIn").value);
  if(!lastReal){ msg("Primero mide un swing real y luego escribe lo que marcó el radar.",true); return; }
  if(!(v>0)){ msg("Escribe la velocidad que marcó el radar.",true); return; }
  const radar=fromUnit(v), r=radar/lastReal.msRaw; if(r<0.5||r>2){ msg("Ese valor está muy lejos de la medición. Revisa la unidad o el número.",true); return; }
  calib[lastReal.club]=(calib[lastReal.club]||[]).concat({est:lastReal.msRaw,radar}).slice(-12); store.set("sl2_calib",calib);
  $("radarIn").value=""; msg("Guardado. Factor de "+CLUBS[lastReal.club].name+": "+factor(lastReal.club).toFixed(2)+"."); renderAll(); });
$("calibReset").addEventListener("click",()=>{ calib[club]=[]; store.set("sl2_calib",calib); renderAll(); });
$("clear").addEventListener("click",()=>{ $("clearConfirm").hidden=false; });
$("clearNo").addEventListener("click",()=>{ $("clearConfirm").hidden=true; });
$("clearYes").addEventListener("click",()=>{ history=[]; traces=[]; rangeMarks=[]; store.set("sl2_hist",history); store.set("sl2_traces",traces); store.set("sl3_rangeMarks",rangeMarks);
  $("clearConfirm").hidden=true; if(has3D) World.setMarks(rangeMarks); renderAll(); });
function download(name,type,text){ const url=URL.createObjectURL(new Blob([text],{type})); const a=document.createElement("a"); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),2000); }
const stamp=()=>new Date().toISOString().slice(0,16).replace(/[:T]/g,"-");
$("expCsv").addEventListener("click",()=>{
  const rows=[["fecha","palo","velocidad_palo_ms","velocidad_palo_mph","factor_calibracion","velocidad_bola_ms","tempo","subida_s","bajada_s","cara_grados","cara_valida","ruta_grados","ruta_valida","ataque_grados","arco_subida","arco_final","forma","carry_m","total_m","lateral_m","altura_m","pico_gyro_dps","saturado","metodo_pico","hz"]];
  history.forEach(h=>{ const dv=derive(h); rows.push([new Date(h.at).toISOString(),CLUBS[h.club].name,dv.ms.toFixed(2),(dv.ms*2.23694).toFixed(1),factor(h.club).toFixed(3),dv.ball.toFixed(1),h.ratio?h.ratio.toFixed(2):"",h.back!=null?(h.back/1000).toFixed(3):"",h.down!=null?(h.down/1000).toFixed(3):"",h.face,h.faceOk,h.path??"",h.pathOk??"",h.aoa??"",h.arcTop??"",h.arcFin??"",shapeName(h)||"",dv.carry.toFixed(1),dv.total.toFixed(1),dv.lat.toFixed(1),dv.apex.toFixed(1),h.peak,h.sat,h.method,h.hz]); });
  download(`swing-lab-${stamp()}.csv`,"text/csv",rows.map(r=>r.join(",")).join("\n")); });
$("expJson").addEventListener("click",()=>{ download(`swing-lab-crudo-${stamp()}.json`,"application/json",JSON.stringify({app:"Swing Lab",version:VERSION,exported:new Date().toISOString(),
  units:"t_ms, gyro x/y/z en °/s y gravedad gx/gy/gz en m/s² (marco del teléfono, gravedad hacia arriba)", modo:S.hold, calib, swings:history, traces},null,1)); });
window.addEventListener("resize",()=>{ if(has3D) World.resize(); drawTrace(); drawField(); drawMini(); });

// ================= Diagrama del swing =================
function drawSwingViz(){
  const cv=$("swingViz"); if(!cv || cv.closest("[hidden]")) return; const dpr=window.devicePixelRatio||1, W=cv.clientWidth, H=cv.clientHeight;
  cv.width=W*dpr; cv.height=H*dpr; const c=cv.getContext("2d"); c.setTransform(dpr,0,0,dpr,0,0); c.clearRect(0,0,W,H);
  const h=shown; if(!h) return; const ink=css("--ink"), mut=css("--muted"), acc=css("--accent"), line=css("--line");
  // izquierda: arco del swing visto de frente
  const cx=W*0.27, cy=H*0.55, r=Math.min(W*0.2,H*0.38);
  c.strokeStyle=line; c.lineWidth=1; c.beginPath(); c.arc(cx,cy,r,0,Math.PI*2); c.stroke();
  c.fillStyle=mut; c.font="11px "+css("--body"); c.textAlign="center"; c.fillText("Arco",cx,14);
  const ang=d=>Math.PI/2 - (S.hand==="R"?-1:1)*d*DEG;   // 0° = palo abajo (address)
  const ray=(d,col,w)=>{ c.strokeStyle=col; c.lineWidth=w; c.beginPath(); c.moveTo(cx,cy); c.lineTo(cx+Math.cos(ang(d))*r, cy+Math.sin(ang(d))*r); c.stroke(); };
  if(h.arcTop!=null){
    c.strokeStyle=mut; c.lineWidth=6; c.globalAlpha=0.35; c.beginPath(); c.arc(cx,cy,r*0.82,Math.min(ang(0),ang(h.arcTop)),Math.max(ang(0),ang(h.arcTop))); c.stroke();
    c.strokeStyle=acc; c.beginPath(); c.arc(cx,cy,r*0.68,Math.min(ang(0),ang(-h.arcFin)),Math.max(ang(0),ang(-h.arcFin))); c.stroke(); c.globalAlpha=1;
    ray(0,ink,2); ray(h.arcTop,mut,2); ray(-h.arcFin,acc,2);
    c.fillStyle=ink; c.font="600 12px "+css("--body"); c.fillText(`subida ${h.arcTop}° · final ${h.arcFin}°`,cx,H-6);
  } else { c.fillStyle=mut; c.fillText("Quédate quieto antes del swing",cx,cy); c.fillText("para medir el arco",cx,cy+14); }
  // derecha: cara y ruta vistas desde arriba
  const ox=W*0.74, oy=H*0.62, L=Math.min(W*0.2,H*0.42);
  c.fillStyle=mut; c.font="11px "+css("--body"); c.textAlign="center"; c.fillText("Impacto visto desde arriba",ox,14);
  c.setLineDash([4,4]); c.strokeStyle=line; c.lineWidth=1.5; c.beginPath(); c.moveTo(ox,oy+L*0.5); c.lineTo(ox,oy-L*1.1); c.stroke(); c.setLineDash([]);
  c.fillStyle=mut; c.fillText("objetivo",ox,oy-L*1.1-4);
  const dir=(deg,len,col,label)=>{ const a=-Math.PI/2+(S.hand==="R"?1:-1)*deg*DEG*3; const ex=ox+Math.cos(a)*len, ey=oy+Math.sin(a)*len;
    c.strokeStyle=col; c.fillStyle=col; c.lineWidth=3; c.beginPath(); c.moveTo(ox,oy); c.lineTo(ex,ey); c.stroke();
    c.beginPath(); c.arc(ex,ey,3.5,0,Math.PI*2); c.fill(); c.font="600 11px "+css("--body"); c.textAlign=ex>=ox?"left":"right"; c.fillText(label,ex+(ex>=ox?6:-6),ey+4); };
  if(h.pathOk) dir(h.path,L*0.9,mut,"ruta "+(h.path>0?"+":"")+h.path.toFixed(0)+"°");
  if(h.faceOk) dir(h.face,L,acc,"cara "+(h.face>0?"+":"")+h.face.toFixed(0)+"°");
  c.fillStyle=ink; c.beginPath(); c.arc(ox,oy,4,0,Math.PI*2); c.fill();
  c.textAlign="center"; c.font="600 12px "+css("--body"); c.fillText(shapeName(h)||"",ox,H-6);
}

// ================= Arranque =================
has3D = World.init($("sim"));
if(!has3D) msg("Tu navegador no pudo cargar la vista 3D. La medición del swing sí funciona.",true);
buildChips();
const ex=SL.analyze(SL.synthKin({hz:100,peak:1700,face:1.5,path:-1}),club,{mode:S.hold,hand:S.hand}); if(!ex.error){ const {rawSamples,...h}=ex; h.example=true; h.sim=true; shown=h; }
if(!store.get("sl5_intro",false)) $("intro").hidden=false;
if(window.top!==window){ $("expCsv").hidden=true; $("expJson").hidden=true; }
setClub(club,true); setMode(mode);
document.querySelectorAll("#inputSeg button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.i===S.input))); $("camHelp").hidden=S.input!=="camera"; if(S.input==="camera") setCamButton();
setVerdict("Swing de ejemplo. Activa los sensores para medir el tuyo, o toca Golpe de prueba para ver la simulación.");
if("serviceWorker" in navigator && location.protocol==="https:" && window.top===window) navigator.serviceWorker.register("sw.js").catch(()=>{});
window.__swingLab={SL, testShot, World};
})();
