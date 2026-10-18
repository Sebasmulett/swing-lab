// Swing Lab · interfaz, sensores y juego
(function(){
"use strict";
const SL=window.SL, CLUBS=SL.CLUBS, DEG=SL.DEG, World=SL.World;
const VERSION="0.17";
const $=id=>document.getElementById(id);
const store={ get(k,d){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):d; }catch(e){ return d; } },
              set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} } };
const S=Object.assign({units:"mph", dist:"m", hand:"R", hold:"phone", invert:false, input:"sensor", camFacing:"user", camGrip:"empty", camView:"front", camModel:"auto", camSound:(/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1))?"off":"on", camShutter:"auto", bag:"4", sgBase:"hcp15", ambient:true, alt:0, shot:"normal", qcDone:false, voice:true, cont:true, guide:false, guideRatio:"24/8"}, store.get("sl2_settings",{}));
let club=store.get("sl2_club","driver"); if(!CLUBS[club]) club="driver";
let mode=store.get("sl3_mode","range"); if(!["range","course","data","rank"].includes(mode)) mode="range";
let calib=Object.assign(Object.fromEntries(Object.keys(CLUBS).map(k=>[k,[]])), store.get("sl2_calib",{}));
let myCarry=store.get("sl5_mycarry",{}), myKind=store.get("sl11_mykind",{});   // distancia típica por palo (m) y si es carry o total
let history=store.get("sl2_hist",[]), traces=store.get("sl2_traces",[]), records=store.get("sl2_records",{});
let rangeMarks=store.get("sl3_rangeMarks",[]);
// campos: cada uno guarda su propia ronda en curso
// jugadores: varios pueden turnarse en el mismo teléfono; cada uno con su ronda en cada campo
let players=store.get("sl10_players",null); if(!Array.isArray(players)||!players.length) players=["Yo"];
if(!S.player || !players.includes(S.player)) S.player=players[0];
let rounds=store.get("sl8_rounds",null); if(!rounds){ rounds={}; const old=store.get("sl4_course",null); if(old) rounds.swinglab=old; }
for(const k of Object.keys(rounds)){ const n=k.split("|").length; if(n===1){ rounds[k+"|all|"+players[0]]=rounds[k]; delete rounds[k]; } else if(n===2){ const [c,p]=k.split("|"); rounds[c+"|all|"+p]=rounds[k]; delete rounds[k]; } }
// recorrido: en los campos de 18 hoyos se juega la ida (1-9), la vuelta (10-18) o los 18
let sels=store.get("sl12_sel",{});
const selOf=cid=>{ const c=SL.courseById(cid); return c.n>9 ? (sels[cid]||"front") : "all"; };
const holesFor=(c,sel)=>c.n>9 ? (sel==="front"?c.holes.slice(0,9):sel==="back"?c.holes.slice(9):c.holes) : c.holes;
const SEL_NAME={front:"Ida (1-9)", back:"Vuelta (10-18)", all:"18 hoyos"};
const roundKey=(cid=courseId,p=S.player,sel=selOf(cid))=>cid+"|"+sel+"|"+p;
let courseId=store.get("sl8_courseId","standrews"), CUR=SL.courseById(courseId); courseId=CUR.id;
let HOLES=holesFor(CUR,selOf(courseId));
const parOf=()=>HOLES.reduce((a,h)=>a+h.par,0);
const validRound=c=>c && c.hole>=0 && c.hole<HOLES.length && Array.isArray(c.wind) && c.wind.length===HOLES.length;
let course=validRound(rounds[roundKey()])?rounds[roundKey()]:null;
let board=Object.assign({rounds:[],drives:[],speeds:[],prox:[]}, store.get("sl10_board",{}));
let shown=null, lastReal=null, suggested=null, has3D=false;
const saveSettings=()=>store.set("sl2_settings",S);
// salida según el palo, el swing medido y el tipo de golpe elegido (draw, fade, alto, bajo, flop)
const launch=(c,ms,h,lie)=>{ const o=SL.launchFor(c,ms,h,lie,S.hand), t=h&&h.shot; return t&&t!=="normal" ? SL.applyShot(o,t,S.hand) : o; };
// ===== Wedges y bolsa =====
const isWedge=c=>SL.WEDGES.includes(c);
const inBag=c=>c==="gw"?S.bag!=="2":c==="lw"?S.bag==="4":true;
const bagWedges=()=>SL.WEDGES.filter(inBag);
// Sistema del reloj (Dave Pelz): el brazo izquierdo como aguja de un reloj; para zurdos el reloj se espeja
const CLOCK=[{k:"730",arm:45,sp:0.52},{k:"900",arm:90,sp:0.71},{k:"1030",arm:135,sp:0.86},{k:"full",arm:165,sp:1}];
const clockName=k=>k==="full"?"completo":(S.hand==="L"?{730:"4:30",900:"3:00",1030:"1:30"}:{730:"7:30",900:"9:00",1030:"10:30"})[k];
const clockAt=k=>k==="full"?"con swing completo":`a las ${clockName(k)}`;
// la cámara mide el ángulo del brazo; el sensor, el del palo (que suma el quiebre de muñecas)
function clockOf(h){ if(!h || h.arcTop==null) return null; const a=h.arcTop;
  if(h.source==="camera") return a<67?"730":a<112?"900":a<146?"1030":"full";
  return a<100?"730":a<160?"900":a<205?"1030":"full"; }
const shotFor=c=>SL.SHOTS[S.shot] && (!SL.SHOTS[S.shot].wedges || isWedge(c)||c==="iron9") ? S.shot : "normal";
// altura: en el range, donde juegas normalmente; en un campo, la del campo
const curAlt=()=>mode==="course" ? (CUR.alt||0) : (+S.alt||0);
function applyAlt(){ SL.setAlt(curAlt()); }

// ================= Derivados y formato =================
const median=a=>{ const r=a.slice().sort((x,y)=>x-y), m=r.length>>1; return r.length%2?r[m]:(r[m-1]+r[m])/2; };
const fcache=new Map();
// Calibración: 1) radar si hay; 2) tus distancias habituales (con al menos 3 swings reales de ese palo); 3) ninguna
// sensor y cámara se calibran por separado: cada uno mide distinto
const srcOf=h=>h && h.source==="camera"?"camera":"sensor";
const realOf=(c,src)=>history.filter(h=>h.club===c && !h.sim && srcOf(h)===src);
// el radar se guarda por fuente (sensor o cámara); las entradas viejas sin fuente son del sensor
const radarOf=(c,src)=>(calib[c]||[]).filter(x=>(x.src||"sensor")===src);
function clubFactor(c,src){ const p=radarOf(c,src); if(p.length) return {f:median(p.map(x=>x.radar/x.est)), kind:"radar"};
  const mc=myCarry[c], mine=realOf(c,src).slice(0,12);
  if(!mc || mine.length<3) return null;
  const key=c+"|"+src+"|"+mc+"|"+(myKind[c]||"carry")+"|"+S.alt+"|"+mine.length+"|"+(mine[0]&&mine[0].id); if(fcache.has(key)) return fcache.get(key);
  // tu distancia típica es en tu cancha habitual: se calcula con su altura (carry o total, como lo escribiste)
  const tot=myKind[c]==="total"; let lo=5, hi=80; SL.withAlt(+S.alt||0,()=>{ for(let i=0;i<24;i++){ const mid=(lo+hi)/2, sm=SL.simulateLocal(SL.launchFor(c,mid,null,"tee",S.hand),[0,0],null), d=tot?Math.hypot(sm.x,sm.z):sm.carry; if(d<mc) lo=mid; else hi=mid; } });
  const r={f:Math.max(0.5,Math.min(2,((lo+hi)/2)/median(mine.map(h=>h.msRaw)))), kind:"distancias"}; fcache.set(key,r); return r; }
// un palo sin calibrar usa lo aprendido con tus otros palos (la diferencia entre palos ya la pone el modelo)
function factor(c,src="sensor"){ const own=clubFactor(c,src); if(own) return own.f;
  const o=Object.keys(CLUBS).filter(k=>k!==c).map(k=>clubFactor(k,src)).filter(Boolean).map(x=>x.f); return o.length?median(o):1; }
const calibKind=(c,src="sensor")=>{ const own=clubFactor(c,src); if(own) return own.kind; return Object.keys(CLUBS).some(k=>k!==c && clubFactor(k,src))?"tus otros palos":null; };
const dcache=new Map();
function derive(h){
  const ms=h.msRaw*factor(h.club,srcOf(h)), key=h.id+"|"+ms.toFixed(3)+"|"+S.hand+"|"+SL.env.alt+"|"+(h.shot||""); if(dcache.has(key)) return dcache.get(key);
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
function shapeName(h){ if(!h.faceOk && !(h.faceAssumed && h.pathOk)) return null; const f=h.faceOk?h.face:0, p=h.pathOk?h.path:0, start=0.78*f+0.22*p, curve=f-p;
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
  o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0+d+0.03); if(SL.Sound) SL.Sound.mute(t0,d+0.03); }
function noise(dur,freq,q,gain,type){ const a=audio(); if(!a) return; try{
  const n=Math.floor(a.sampleRate*dur), b=a.createBuffer(1,n,a.sampleRate), d=b.getChannelData(0);
  for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/n,3);
  const s=a.createBufferSource(), f=a.createBiquadFilter(), g=a.createGain(); f.type=type||"bandpass"; f.frequency.value=freq; f.Q.value=q; g.gain.value=gain;
  s.buffer=b; s.connect(f); f.connect(g); g.connect(a.destination); s.start(); if(SL.Sound) SL.Sound.mute(a.currentTime,dur); }catch(_){} }
// tono corto que se apaga (el "ping" metálico del driver, el golpe seco de los hierros)
function tone(f,d,gain,type){ const a=audio(); if(!a) return; try{ const o=a.createOscillator(), g=a.createGain(), t0=a.currentTime; o.type=type||"sine"; o.frequency.value=f;
  g.gain.setValueAtTime(gain,t0); g.gain.exponentialRampToValueAtTime(0.0001,t0+d); o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0+d+0.02); if(SL.Sound) SL.Sound.mute(t0,d); }catch(_){} }
// silbido del palo: ruido filtrado que sube de tono justo antes del impacto
function whoosh(dur){ const a=audio(); if(!a) return; try{ dur=dur||0.22; const n=Math.floor(a.sampleRate*dur), b=a.createBuffer(1,n,a.sampleRate), d=b.getChannelData(0);
  for(let i=0;i<n;i++){ const u=i/n; d[i]=(Math.random()*2-1)*Math.sin(Math.PI*u)*Math.pow(u,0.8); }
  const s=a.createBufferSource(), f=a.createBiquadFilter(), g=a.createGain(), t0=a.currentTime; f.type="bandpass"; f.Q.value=1.4; f.frequency.setValueAtTime(350,t0); f.frequency.exponentialRampToValueAtTime(1600,t0+dur);
  g.gain.value=0.5; s.buffer=b; s.connect(f); f.connect(g); g.connect(a.destination); s.start(); if(SL.Sound) SL.Sound.mute(t0,dur); }catch(_){} }
// ===== Ambiente: pájaros, viento y (en la costa) el mar =====
// Sonidos generados (no hay archivos): suaves y en segundo plano mientras juegas en el range o el campo.
const AMB={on:false, nodes:null, birdT:0};
function noiseBuf(a,sec){ const n=Math.floor(a.sampleRate*sec), b=a.createBuffer(1,n,a.sampleRate), d=b.getChannelData(0); let last=0; for(let i=0;i<n;i++){ const w=Math.random()*2-1; last=0.97*last+0.03*w; d[i]=last*6; } return b; }
function ambientStart(){ const a=audio(); if(!a || AMB.on || !S.ambient) return; try{
  const src=a.createBufferSource(); src.buffer=noiseBuf(a,4); src.loop=true; const lp=a.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=380; const g=a.createGain(); g.gain.value=0;
  src.connect(lp); lp.connect(g); g.connect(a.destination); src.start();
  const sea=a.createBufferSource(); sea.buffer=noiseBuf(a,5); sea.loop=true; const sl=a.createBiquadFilter(); sl.type="lowpass"; sl.frequency.value=700; const sg=a.createGain(); sg.gain.value=0;
  sea.connect(sl); sl.connect(sg); sg.connect(a.destination); sea.start();
  AMB.nodes={src,g,sea,sg}; AMB.on=true; ambientTick(); }catch(_){} }
function ambientStop(){ if(!AMB.on) return; try{ AMB.nodes.src.stop(); AMB.nodes.sea.stop(); }catch(_){} AMB.nodes=null; AMB.on=false; clearTimeout(AMB.t); }
function chirp(){ const a=audio(); if(!a) return; const t0=a.currentTime, base=2600+Math.random()*1600, n=2+Math.floor(Math.random()*4);
  for(let k=0;k<n;k++){ const o=a.createOscillator(), g=a.createGain(), ts=t0+k*(0.09+Math.random()*0.05); o.type="sine";
    o.frequency.setValueAtTime(base*(0.9+Math.random()*0.2),ts); o.frequency.exponentialRampToValueAtTime(base*(1.25+Math.random()*0.3),ts+0.06);
    g.gain.setValueAtTime(0.0001,ts); g.gain.exponentialRampToValueAtTime(0.022,ts+0.012); g.gain.exponentialRampToValueAtTime(0.0001,ts+0.07);
    o.connect(g); g.connect(a.destination); o.start(ts); o.stop(ts+0.09); } if(SL.Sound) SL.Sound.mute(t0,n*0.15); }
function ambientTick(){ if(!AMB.on) return; const a=audio(), N=AMB.nodes; if(!a||!N) return;
  const play=(mode==="course"||mode==="range") && !document.hidden && S.ambient;
  const w=mode==="course"&&course&&course.wind?course.wind[course.hole]:{s:2}, ws=w?w.s:2, coast=mode==="course" && CUR && CUR.scenery==="caribe";
  const t=a.currentTime; N.g.gain.setTargetAtTime(play?0.006+Math.min(8,ws)*0.0035*(0.7+0.3*Math.sin(t*0.7)):0,t,0.8);
  N.sg.gain.setTargetAtTime(play&&coast?0.012+0.01*Math.max(0,Math.sin(t*0.9)):0,t,1.2);
  if(play && Math.random()<0.35) chirp();
  AMB.t=setTimeout(ambientTick,1800+Math.random()*2600); }
const sfx={ hit:c=>{ const wood=c==="driver"||c==="wood3"||c==="hybrid";
    if(wood){ noise(0.05,2300,1.0,0.9); tone(1750,0.16,0.16); tone(2620,0.11,0.08); }          // driver: "ping" con un poco de metal
    else if(isWedge(c)){ noise(0.035,3000,1.5,0.85); tone(210,0.05,0.12,"triangle"); }        // wedge: más suave
    else { noise(0.04,3600,1.7,1.05); tone(190,0.06,0.16,"triangle"); tone(3100,0.05,0.05); } }, // hierro: seco y compacto
  whoosh, land:()=>noise(0.12,320,0.8,0.7,"lowpass"), putt:()=>noise(0.05,1800,2,0.5), cup:()=>{ noise(0.08,900,3,0.6); setTimeout(()=>noise(0.06,1200,3,0.4),90); }, splash:()=>noise(0.45,700,0.5,0.6,"lowpass") };
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
function setHudMsg(t){ const m=$("hudMsg"); m.classList.remove("hint"); if(!t){ m.hidden=true; return; } m.textContent=t; m.hidden=false; }
function showCard(sim,toTarget){ $("cCarry").textContent=fmtDist(sim.carry); $("cTotal").textContent=fmtDist(Math.hypot(sim.x,sim.z));
  $("cLat").textContent=fmtLat(sim.x); $("cApex").textContent=fmtDist(sim.apex); $("cBall").textContent=fmtSpeed(sim.ball).v+" "+fmtSpeed(1).u;
  $("cTgt").textContent=toTarget!=null?fmtDist(toTarget):"—"; $("card").hidden=false; }
// ================= Apuntar (estilo TrackMan) =================
// El objetivo es un punto del suelo. El tiro sale hacia él y el desvío se mide respecto a esa línea.
let rangeAim=store.get("sl7_rangeAim",{x:6,z:150}), aimMode=false, rangeProx=store.get("sl7_rangeProx",[]);
const yawTo=(o,p)=>Math.atan2(p.x-o.x,p.z-o.z);
function aimOrigin(){ return mode==="course"&&course ? course.ball : {x:0,z:0}; }
function aimPoint(){ if(mode==="course"&&course){ const h=HOLES[course.hole]; return course.aim||course.auto||{x:h.pinX,z:h.L}; } return rangeAim; }
function aimYaw(){ return yawTo(aimOrigin(),aimPoint()); }
function aimDist(){ const o=aimOrigin(), p=aimPoint(); return Math.hypot(p.x-o.x,p.z-o.z); }
function setAim(p,quiet){
  const o=aimOrigin(), d=Math.hypot(p.x-o.x,p.z-o.z); if(d<5) return;
  if(mode==="course"&&course){ const h=HOLES[course.hole], auto=course.auto||{x:h.pinX,z:h.L}; course.stratClub=null; course.stratK=null;
    course.aim = Math.hypot(p.x-auto.x,p.z-auto.z)<1 ? null : Math.hypot(p.x-h.pinX,p.z-h.L)<1 ? {x:h.pinX,z:h.L} : {x:+p.x.toFixed(1),z:+p.z.toFixed(1)}; saveCourse(); suggestClub(); }
  else { rangeAim={x:+p.x.toFixed(1),z:+p.z.toFixed(1)}; store.set("sl7_rangeAim",rangeAim); suggestClub(); }
  if(has3D){ World.setAim(aimPoint()); if(!aimMode) World.address(o.x,o.z,aimYaw(),false); }
  renderAim(); if(!quiet) beep(1200,0.03);
}
// Libreta de distancias: dónde empieza y termina cada trampa y el green sobre la línea de mira
function yardage(){
  const parts=[];
  if(mode==="course" && course && !course.holed){ const hole=HOLES[course.hole], o=course.ball, p=aimPoint(), dd=Math.hypot(p.x-o.x,p.z-o.z), ux=(p.x-o.x)/(dd||1), uz=(p.z-o.z)/(dd||1);
    let prev=null, start=0; const seen=[]; const maxD=dd+45;
    for(let s=6;s<=maxD;s+=2){ const l=SL.lieAt(hole,o.x+ux*s,o.z+uz*s), k=l==="water"?"water":l==="bunker"?"bunker":l==="green"?"green":l==="ob"?"ob":null;
      if(k!==prev){ if(prev) seen.push([prev,start,s-2]); prev=k; start=s; } }
    if(prev) seen.push([prev,start,maxD]);
    const ico={water:"🌊 Agua",bunker:"⛱ Bunker",green:"⛳ Green",ob:"🚫 Fuera"};
    for(const [k,a,b] of seen.slice(0,3)) parts.push(`${ico[k]} ${Math.round(S.dist==="yd"?a/0.9144:a)}–${Math.round(S.dist==="yd"?b/0.9144:b)}`);
    if(caddieInfo && Math.abs(caddieInfo.wind)>=3) parts.push(`💨 juega como ${fmtDist(caddieInfo.plays)}`); }
  if(mode==="course" && course && !course.holed){ const st=strategy();
    if(st){ const same=(Math.hypot(st.aim.x-aimPoint().x,st.aim.z-aimPoint().z)<3 && st.c===club) || st.eCur-st.e<0.08, side=Math.abs(st.off)<2?"al centro":`${fmtDist(Math.abs(st.off))} ${st.off>0?"a la derecha":"a la izquierda"}`;
      parts.push(same?`🧠 Buena estrategia: ${st.eCur.toFixed(1)} golpes esperados para terminar`
        :`🧠 Mejor: ${CLUBS[st.c].name}${st.k?" "+clockAt(st.k):""}, ${side} · ${st.e.toFixed(1)} golpes esperados (ahora ${st.eCur.toFixed(1)}) <button class="mini" id="useStrat">Usar</button>`); } }
  if((mode==="course"||mode==="range") && caddieInfo && caddieInfo.clock){ const k=caddieInfo.clock; parts.push(`🕘 ${CLUBS[k.c].name} ${clockAt(k.k)} ≈ ${fmtDist(k.cell.total)}${k.cell.est?" (estimado)":""}`); }
  return parts.join(" · "); }
function renderAim(){ const d=aimDist(), o=aimOrigin(), p=aimPoint(); let side="";
  if(mode==="course"&&course){ const h=HOLES[course.hole], q=aimPoint(); side=Math.hypot(q.x-h.pinX,q.z-h.L)<1?" · al hoyo":course.aim?"":" · ruta"; }
  const st=shotFor(club); $("aimDist").textContent=`Objetivo ${fmtDist(d)}${side}`+(st!=="normal"?` · ${SL.SHOTS[st].name}`:"");
  $("aimInfo").innerHTML=yardage(); $("aimInfo").hidden=!$("aimInfo").innerHTML; { const ub=$("useStrat"); if(ub) ub.onclick=e=>{ e.stopPropagation(); useStrategy(); }; } $("aimGo").textContent=aimMode?"Listo":"🎯 Apuntar"; $("aimPin").hidden=!(mode==="course"&&course&&course.aim);
  $("aimBar").hidden=!has3D || mode==="data" || World.busy() || World.flying() || (mode==="course"&&course&&(course.holed||course.done)) || camIsBig(); void o; void p; }
function nudgeAim(deg){ const o=aimOrigin(), p=aimPoint(), d=Math.hypot(p.x-o.x,p.z-o.z), y=yawTo(o,p)+deg*DEG;
  setAim({x:o.x+Math.sin(y)*d, z:o.z+Math.cos(y)*d},true); }
function toggleAimView(on){ aimMode=on; const o=aimOrigin(), p=aimPoint();
  // con la cámara: mientras apuntas no se lee el swing; al terminar tienes unos segundos para ponerte en posición
  if(camState==="on" && !camHold){ if(on){ SL.Cam.pause(true); SL.Cam.flash("En pausa mientras apuntas","wait",1e7); } else { SL.Cam.flash("",null,0); SL.Cam.pause(false,4000,"Ponte en posición"); say("Ponte en posición."); } camBig=false; camLayer(true,on); }
  if(on){ const d=mode==="course"&&course ? Math.max(60,Math.hypot(HOLES[course.hole].pinX-o.x,HOLES[course.hole].L-o.z)) : 290, span=d*1.3;
    const yaw=aimYaw(), c={x:o.x+Math.sin(yaw)*d*0.6, z:o.z+Math.cos(yaw)*d*0.6}; World.aimView(true,{x:c.x,z:c.z,span});
    setHudMsg("Toca donde quieres que caiga la bola"); $("hudMsg").classList.add("hint"); $("card").hidden=true; $("holeTip").hidden=true; }
  else { World.aimView(false); World.address(o.x,o.z,aimYaw(),false); setHudMsg(null); }
  renderAim(); }
let shotSeq=0;

// ================= Range =================
function setupRange(){ if(!has3D) return; World.setScenery(null); World.setRange({um:S.dist==="yd"?0.9144:1}); World.setMarks(rangeMarks); World.setAim(rangeAim); World.address(0,0,yawTo({x:0,z:0},rangeAim),true); renderAim(); }
// tu swing para el golfista 3D: largo de subida y final (la cámara mide el brazo; el sensor, el palo) y ritmo medido
function swingOf(h){ const cam=h.source==="camera", k=cam?1:0.62, cl=(v,a,b)=>Math.max(a,Math.min(b,v));
  return {B:cl((h.back||850)/1000,0.55,1.4), D:cl((h.down||290)/1000,0.2,0.45), top:cl(h.arcTop==null?150:h.arcTop*k,35,175), fin:cl(h.arcFin==null?165:h.arcFin*k,40,200)}; }
function rangeShot(h){
  const dv=derive(h), sim=SL.simulateLocal(launch(h.club,dv.ms,h,"tee"),[0,0],null);
  if(aimMode) toggleAimView(false);
  const yaw=yawTo({x:0,z:0},rangeAim), pts=toWorld(sim.pts,0,0,yaw), seq=++shotSeq, fin=pts[pts.length-1], toT=Math.hypot(fin.x-rangeAim.x,fin.z-rangeAim.z);
  setHudMsg(null); $("card").hidden=true; $("skip").hidden=false; $("aimBar").hidden=true;
  camShot();
  World.playShot({pts, landT:sim.landT, swing:swingOf(h), onDown:()=>sfx.whoosh(), onImpact:()=>sfx.hit(h.club), landKind:"grass", onLand:sfx.land, onEnd:()=>{
    $("skip").hidden=true; rangeMarks.push({x:+fin.x.toFixed(1),z:+fin.z.toFixed(1)}); rangeMarks=rangeMarks.slice(-40); store.set("sl3_rangeMarks",rangeMarks);
    if(!h.sim){ rangeProx.push(+toT.toFixed(1)); rangeProx=rangeProx.slice(-30); store.set("sl7_rangeProx",rangeProx);
      const td=Math.hypot(rangeAim.x,rangeAim.z); if(td>=40) addEntry("prox",{v:+toT.toFixed(1), t:+td.toFixed(0), club:h.club});
      if(h.club==="driver") addEntry("drives",{v:+Math.hypot(fin.x,fin.z).toFixed(1), c:"range"}); }
    World.setMarks(rangeMarks); showCard(sim,toT); renderHud(); const sh=shapeName(h); setHudMsg(`A ${fmtDist(toT)} del objetivo`+(sh?` · ${sh}`:""));
    say(`A ${sayDist(toT)} del objetivo.`);
    setTimeout(()=>{ if(seq===shotSeq && !World.busy() && mode==="range"){ World.address(0,0,yawTo({x:0,z:0},rangeAim),true); camLayer(true); setHudMsg(null); $("card").hidden=true; renderAim(); } },3800); }});
}

// ================= Strokes Gained =================
// Golpes promedio para embocar desde cada distancia y lie (línea base del PGA Tour, aproximada de Mark Broadie,
// "Every Shot Counts"). Distancias en yardas; en el green, en pies. La de hándicap 15 es una aproximación escalada.
const SGB={
  tee:[[100,2.92],[120,2.99],[140,2.97],[160,2.99],[180,3.05],[200,3.12],[220,3.17],[240,3.25],[260,3.45],[280,3.65],[300,3.71],[320,3.79],[340,3.86],[360,3.92],[380,3.96],[400,3.99],[420,4.02],[440,4.08],[460,4.17],[480,4.28],[500,4.41],[520,4.54],[540,4.65],[560,4.74],[580,4.79],[600,4.82]],
  fairway:[[0,1.9],[5,2.1],[10,2.18],[20,2.40],[40,2.60],[60,2.70],[80,2.75],[100,2.80],[120,2.85],[140,2.91],[160,2.98],[180,3.08],[200,3.19],[220,3.32],[240,3.45],[260,3.58],[280,3.69],[300,3.78],[340,3.88],[400,4.11],[460,4.29],[520,4.66],[600,4.94]],
  rough:[[0,2.0],[5,2.2],[10,2.34],[20,2.59],[40,2.78],[60,2.91],[80,2.96],[100,3.02],[120,3.08],[140,3.15],[160,3.23],[180,3.31],[200,3.42],[220,3.53],[240,3.64],[260,3.74],[280,3.83],[300,3.90],[400,4.25],[500,4.70],[600,5.0]],
  sand:[[0,2.1],[5,2.3],[10,2.43],[20,2.53],[40,2.82],[60,3.15],[80,3.24],[100,3.23],[120,3.21],[140,3.22],[160,3.28],[180,3.40],[200,3.55],[220,3.70],[240,3.84],[260,3.93],[300,4.04],[400,4.4]],
  green:[[0,1.0],[1,1.0],[2,1.01],[3,1.04],[4,1.13],[5,1.23],[6,1.34],[7,1.42],[8,1.50],[9,1.56],[10,1.61],[15,1.78],[20,1.87],[30,1.98],[40,2.06],[50,2.14],[60,2.21],[90,2.40],[150,2.6]] };
const interp=(T,x)=>{ if(x<=T[0][0]) return T[0][1]; for(let i=1;i<T.length;i++) if(x<=T[i][0]){ const [a,va]=T[i-1], [b,vb]=T[i]; return va+(vb-va)*(x-a)/(b-a); } const n=T.length; return T[n-1][1]+(T[n-1][1]-T[n-2][1])/(T[n-1][0]-T[n-2][0])*(x-T[n-1][0]); };
const SG_K={tour:1, hcp15:1.28};
function expStrokes(dm, lie, base){ if(dm<0.25) return 0; const k=SG_K[base||S.sgBase||"hcp15"]||1, yd=dm/0.9144;
  const L=lie==="green"?"green":lie==="bunker"?"sand":lie==="tee"?(yd>=100?"tee":"fairway"):lie==="fairway"?"fairway":"rough";
  const e=L==="green"?interp(SGB.green,dm*3.28084):interp(SGB[L],yd); return 1+(e-1)*k; }
// registro de cada golpe del hoyo: de dónde salió, dónde quedó y si hubo penalidad
function logShot(e){ if(!course) return; course.log=course.log||{}; (course.log[course.hole]=course.log[course.hole]||[]).push(e); }
const SG_CAT={ott:"Salida", app:"Al green", arg:"Alrededor del green", putt:"Putts"};
function holeStats(i, base){ const L=(course.log||{})[i]; if(!L || !L.length || course.scores[i]==null) return null; const h=HOLES[i], par=h.par;
  const sg={ott:0, app:0, arg:0, putt:0}; let fw=null, gir=false, putts=0, pen=0, sandTry=false, sandSave=false; const score=course.scores[i];
  L.forEach((e,k)=>{ if(e.putt){ putts+=e.n; sg.putt+=expStrokes(e.d,"green",base)-e.n; return; }
    const cat=e.lie==="tee"&&par>=4?"ott":e.d<=27.4?"arg":"app"; sg[cat]+=expStrokes(e.d,e.lie,base)-expStrokes(e.to,e.toLie,base)-1-(e.pen||0); pen+=e.pen||0;
    if(k===0 && par>=4) fw=e.toLie==="fairway"||(e.toLie==="green");
    if((e.toLie==="green"||e.to<0.25) && e.n<=par-2) gir=true;
    if(e.lie==="bunker" && e.d<=27.4){ sandTry=true; sandSave=score-(e.n-1)<=2; } });
  return {sg, fw, gir, putts, pen, sandTry, sandSave, score, par, scramble:!gir?score<=par:null}; }
function roundStats(base){ if(!course) return null; const H=[]; HOLES.forEach((_,i)=>{ const s=holeStats(i,base); if(s) H.push(s); }); if(!H.length) return null;
  const sum=k=>H.reduce((a,s)=>a+s.sg[k],0), fwH=H.filter(s=>s.fw!=null), sc=H.filter(s=>s.scramble!=null), sd=H.filter(s=>s.sandTry);
  return {n:H.length, sg:{ott:sum("ott"), app:sum("app"), arg:sum("arg"), putt:sum("putt")}, fw:[fwH.filter(s=>s.fw).length,fwH.length], gir:[H.filter(s=>s.gir).length,H.length],
    putts:H.reduce((a,s)=>a+s.putts,0), pen:H.reduce((a,s)=>a+s.pen,0), scr:[sc.filter(s=>s.scramble).length,sc.length], sand:[sd.filter(s=>s.sandSave).length,sd.length],
    strokes:H.reduce((a,s)=>a+s.score,0), par:H.reduce((a,s)=>a+s.par,0)}; }
let sgHist=store.get("sl16_sg",[]);
function saveRoundStats(){ if(!course || course.sim) return; const r=roundStats("tour"); if(!r || r.n<9) return;
  sgHist.unshift(Object.assign({at:Date.now(), c:courseId, sel:selOf(courseId), player:S.player, sgH:roundStats("hcp15").sg},r)); sgHist=sgHist.slice(0,30); store.set("sl16_sg",sgHist); }

// ================= Campo =================
const newWind=()=>{ const w=CUR.wind||[1,5.5], s=Math.random()<(w[0]>2?0.05:0.25)?0:w[0]+Math.random()*(w[1]-w[0]), a=Math.random()*Math.PI*2; return {s, x:Math.sin(a)*s, z:Math.cos(a)*s}; };
const saveCourse=()=>{ if(course) rounds[roundKey()]=course; else delete rounds[roundKey()]; store.set("sl8_rounds",rounds); };
const recKey=(id=courseId)=>"c_"+id+(selOf(id)!=="all"?"_"+selOf(id):""), recOf=id=>records[recKey(id)] ?? (id==="swinglab"?records.course:null) ?? null;
function newRound(){ course={courseId, sel:selOf(courseId), hole:0, ball:{x:0,z:0}, lie:"tee", strokes:0, scores:[], lines:[], wind:HOLES.map(newWind), holed:false, done:false};
  saveCourse(); setupHole(true); renderScore(); renderCourses(); }
const distToPin=()=>{ const h=HOLES[course.hole]; return Math.hypot(h.pinX-course.ball.x, h.L-course.ball.z); };
let builtHole="";
const allowedClubs=lie=>SL.CLUB_ORDER.filter(c=>inBag(c) && (c==="driver"?lie==="tee":c==="wood3"?(lie==="tee"||lie==="fairway"):(lie==="bunker"?(isWedge(c)||c==="iron9"):true)));
// Objetivo automático: sigue la ruta del hoyo (zonas de aterrizaje reales) si el green no está a tu alcance
function routeAim(){
  const h=HOLES[course.hole], b=course.ball, pin={x:h.pinX,z:h.L}, D=(p,q)=>Math.hypot(p.x-q.x,p.z-q.z), dp=D(b,pin);
  if(!h.route.length) return null;
  const reach=Math.max(...allowedClubs(course.lie).map(c=>expectedTotal(c,course.lie)));
  if(dp<=reach*1.05) return null;
  const safe=p=>["fairway","rough","green"].includes(SL.lieAt(h,p.x,p.z));
  const toward=(w,d)=>{ const k=d/D(b,w); return {x:+(b.x+(w.x-b.x)*k).toFixed(1), z:+(b.z+(w.z-b.z)*k).toFixed(1)}; };
  if(dp<=reach*1.15 && safe(toward(pin,reach))) return null;            // casi llegas: ve al green
  const ahead=h.route.filter(w=>D(w,pin)<dp-25 && D(b,w)>30); if(!ahead.length) return null;
  const ok=ahead.filter(w=>D(b,w)<=reach*1.02), best=ok.length?ok.reduce((a,w)=>D(w,pin)<D(a,pin)?w:a):null;
  const far=ahead.filter(w=>!ok.includes(w)).reduce((a,x)=>!a||D(b,x)<D(b,a)?x:a,null);
  if(best && D(b,best)<reach*0.6 && !far){ const p=toward(pin,reach); if(safe(p)) return p; }   // el punto de la ruta queda muy cerca: avanza hacia el green
  if(best && (D(b,best)>=reach*0.6 || !far)) return best;
  if(far){ const p=toward(far,reach); if(safe(p)) return p; }
  return best||far;
}
let tipTimer=0;
function showTip(h){ const t=$("holeTip"); if(!h || !h.tip){ t.hidden=true; return; }
  t.innerHTML=`<b>Hoyo ${h.num} · ${h.name} · par ${h.par} · ${fmtDist(h.len)}</b>${h.tip}`; t.hidden=false; clearTimeout(tipTimer); tipTimer=setTimeout(()=>{ t.hidden=true; },10000); }
function setupHole(announce){
  if(!course.holed && !course.done){ course.auto=routeAim(); course.stratClub=null; course.stratK=null;
    // si tu patrón de tiros dice que otro objetivo ahorra golpes, el objetivo automático pasa a ser ese
    if(!course.aim){ stratCache.key=""; const st=strategy(); if(st && st.eCur-st.e>=0.25){ course.auto=st.aim; course.stratClub=st.c; course.stratK=st.k; stratCache.key=""; } } }
  const key=courseId+":"+course.hole;
  if(has3D){ if(builtHole!==key || announce){ World.setScenery(CUR.scenery); World.setHole(HOLES[course.hole]); builtHole=key; }
    World.setWind(course.wind[course.hole]); World.setLines(course.lines); World.setAim(aimPoint()); World.address(course.ball.x,course.ball.z,aimYaw(),true);
    // al empezar un hoyo: vuelo de presentación de la salida al green (toca para saltarlo)
    if(announce && course.strokes===0 && !course.holed){ const b=course.ball; World.flyover(HOLES[course.hole],()=>{ World.address(b.x,b.z,aimYaw(),false); renderAim(); }); } }
  renderAim();
  suggestClub(); renderHud(); drawMini(); camLayer(true);
  if(announce){ const h=HOLES[course.hole], w=course.wind[course.hole];
    say(`${CUR.name}, hoyo ${h.num}: ${h.name}. Par ${h.par}, ${sayDist(h.len)}.`+(w.s>0.3?` Viento de ${Math.round(w.s)} metros por segundo.`:" Sin viento.")+(h.tip?" "+h.tip.split(". ")[0]+".":""));
    showTip(h); }
}
// ===== Caddie =====
// Velocidad típica de TU palo: mediana de tus últimos golpes reales con él (ya calibrada). Si no hay, se escala
// la típica del palo con tu velocidad en los palos que sí has medido.
// los medios swings (7:30 y 9:00) no cuentan: no son tu velocidad normal con ese palo
function clubSpeed(c){ const real=history.filter(h=>!h.sim && !["730","900"].includes(clockOf(h)));
  const mine=real.filter(h=>h.club===c).slice(0,12).map(h=>h.msRaw*factor(c,srcOf(h)));
  if(mine.length>=2) return median(mine);
  const idx=Object.keys(CLUBS).map(k=>{ const v=real.filter(h=>h.club===k).slice(0,12).map(h=>h.msRaw*factor(k,srcOf(h))); return v.length>=2?median(v)/CLUBS[k].def:null; }).filter(Boolean);
  const base=CLUBS[c].def*(idx.length?median(idx):1); return mine.length? (mine[0]+base)/2 : base; }
function expectedTotal(c,lie){ const s=SL.simulateLocal(launch(c,clubSpeed(c),{shot:shotFor(c)},lie),[0,0],null); return Math.hypot(s.x,s.z); }
// Simula cada palo posible por la línea de mira con viento, altura, lie, tipo de golpe y el terreno real (rodado, agua,
// bunkers); prueba también un poco de desvío a cada lado y elige el que deja la bola más cerca del objetivo sin riesgo.
let caddieInfo=null;
function caddie(){
  if(mode!=="course" || !course || course.holed) return null;
  const hole=HOLES[course.hole], o=course.ball, tgt=aimPoint(), R=Math.hypot(tgt.x-o.x,tgt.z-o.z), yaw=aimYaw(), w=course.wind[course.hole];
  const f=[Math.sin(yaw),Math.cos(yaw)], r=rightOf(yaw), wl=[w.x*r[0]+w.z*r[1], w.x*f[0]+w.z*f[1]];
  const toW=(lx,lz)=>[o.x+r[0]*lx+f[0]*lz, o.z+r[1]*lx+f[1]*lz], ground=(lx,lz)=>{ const q=toW(lx,lz); return SL.lieAt(hole,q[0],q[1]); };
  const PEN={water:70, ob:70, bunker:14, rough:5, road:3};
  const onGreen=Math.hypot(tgt.x-hole.pinX,tgt.z-hole.L)<1;
  let best=null;
  for(const c of allowedClubs(course.lie)){
    const ms=clubSpeed(c), base=launch(c,ms,{shot:shotFor(c)},course.lie), spread=c==="driver"||c==="wood3"?4:c==="hybrid"||c==="iron5"?3.2:2.5;
    let cost=0, mid=null;
    for(const d of [-spread,0,spread]){ const sim=SL.simulateLocal(Object.assign({},base,{dir:base.dir+d}),wl,ground), q=toW(sim.x,sim.z);
      const lie=sim.landG==="water"||sim.landG==="ob"?sim.landG:SL.lieAt(hole,q[0],q[1]), miss=Math.hypot(q[0]-tgt.x,q[1]-tgt.z);
      const pen=(PEN[lie]||0)*(onGreen&&lie==="rough"?0.6:1), short=Math.max(0,R-Math.hypot(q[0]-o.x,q[1]-o.z));
      cost+=(d===0?2:1)*(miss+pen+0.3*short); if(d===0) mid={sim, q, lie, miss}; }
    if(!best || cost<best.cost) best={c, cost, mid, ms};
  }
  if(!best) return null;
  // "juega como": distancia equivalente sin viento
  const still=SL.simulateLocal(launch(best.c,best.ms,{shot:shotFor(best.c)},course.lie),[0,0],null), wind=Math.hypot(best.mid.sim.x,best.mid.sim.z)-Math.hypot(still.x,still.z);
  return {club:best.c, total:Math.hypot(best.mid.q[0]-o.x,best.mid.q[1]-o.z), lie:best.mid.lie, plays:R-wind, wind, R};
}
function suggestClub(){
  if(mode==="range"){ const R=Math.hypot(rangeAim.x,rangeAim.z); let b=null; for(const c of SL.CLUB_ORDER.filter(inBag)){ const t=expectedTotal(c,"tee"), k=t<R?(R-t)*1.3:t-R; if(!b||k<b.k) b={c,k}; }
    caddieInfo=null; if(has3D) World.setPattern(null); const pk=R<=maxWedge()*1.04 ? clockPick(R) : null; if(pk) caddieInfo={clock:pk}; suggested=pk?pk.c:b.c; renderChips(); renderAim(); return; }
  if(mode!=="course" || !course || course.holed){ suggested=null; caddieInfo=null; if(has3D) World.setPattern(null); renderChips(); return; }
  caddieInfo=caddie(); suggested=caddieInfo?caddieInfo.club:club;
  // dentro del alcance de los wedges: qué wedge y a qué hora del reloj, según tu matriz
  if(caddieInfo && course.lie!=="green" && caddieInfo.plays<=maxWedge()*1.04){ const pk=clockPick(caddieInfo.plays); if(pk){ caddieInfo.clock=pk; suggested=pk.c; } }
  if(course.stratClub && inBag(course.stratClub)){ suggested=course.stratClub; if(caddieInfo) caddieInfo.clock=course.stratK?{c:course.stratClub,k:course.stratK,cell:wedgeMatrix()[course.stratClub][course.stratK]}:null; }
  if(suggested!==club) setClub(suggested,true); renderChips(); renderAim(); if(has3D) World.setPattern(patternFor());
}
// ===== Estrategia según tu dispersión (gestión de campo) =====
// Tu patrón con cada palo: hacia dónde fallas en promedio (sesgo) y cuánto se abren tus tiros de lado y de largo.
// Con pocos tiros se mezcla con un patrón típico de aficionado (7% de la distancia de lado, 5% de largo).
const patCache=new Map();
function patternOf(c){ const key=c+"|"+history.length+"|"+(history[0]&&history[0].id)+"|"+SL.env.alt; if(patCache.has(key)) return patCache.get(key);
  const d=history.filter(h=>!h.sim && h.club===c && !["730","900","1030"].includes(clockOf(h))).slice(0,25).map(derive), n=d.length;
  const exp=expectedTotal(c,"tee"), defL=0.07*exp+2, defD=0.05*exp+3; let out;
  if(n<2) out={n, bias:0, sl:defL, sd:defD};
  else { const ml=d.reduce((a,x)=>a+x.lat,0)/n, mt=d.reduce((a,x)=>a+x.total,0)/n, sl=Math.sqrt(d.reduce((a,x)=>a+(x.lat-ml)**2,0)/(n-1)), sd=Math.sqrt(d.reduce((a,x)=>a+(x.total-mt)**2,0)/(n-1)), w=Math.min(1,n/8);
    out={n, bias:ml*w, sl:Math.max(3,w*sl+(1-w)*defL), sd:Math.max(3,w*sd+(1-w)*defD)}; }
  patCache.set(key,out); if(patCache.size>60) patCache.clear(); return out; }
// cuadratura gaussiana 5×5 sobre la elipse (±2,2 σ)
const GQ=(()=>{ const z=[-2.2,-1.1,0,1.1,2.2], w=z.map(v=>Math.exp(-v*v/2)), s=w.reduce((a,b)=>a+b,0); return z.map((v,i)=>[v,w[i]/s]); })();
let stratCache={key:"",res:null};
function strategy(){
  if(mode!=="course"||!course||course.holed||course.done||course.lie==="green") return null;
  const hole=HOLES[course.hole], o=course.ball, pin={x:hole.pinX,z:hole.L}, R=Math.hypot(pin.x-o.x,pin.z-o.z), w=course.wind[course.hole], base=S.sgBase||"hcp15";
  if(R<45) return null;
  const cur=aimPoint(), key=[course.hole,o.x,o.z,course.lie,cur.x,cur.z,history.length,base,S.bag,club].join("|"); if(stratCache.key===key) return stratCache.res;
  const yaw=yawTo(o,pin), f=[Math.sin(yaw),Math.cos(yaw)], r=rightOf(yaw), wl=[w.x*r[0]+w.z*r[1], w.x*f[0]+w.z*f[1]], E0=expStrokes(R,course.lie,base);
  const toW=(lx,lz)=>({x:o.x+r[0]*lx+f[0]*lz, z:o.z+r[1]*lx+f[1]*lz}), ground=(lx,lz)=>{ const q=toW(lx,lz); return SL.lieAt(hole,q.x,q.z); };
  const cost=p=>{ const lie=SL.lieAt(hole,p.x,p.z), dp=Math.hypot(p.x-pin.x,p.z-pin.z);
    return lie==="water"?2+expStrokes(dp,"rough",base) : lie==="ob"?2+E0 : 1+expStrokes(dp,lie,base); };
  // opciones: cada palo con swing completo y, a tiro de wedge, cada casilla de tu matriz
  const opts=[];
  for(const c of allowedClubs(course.lie)){ const sim=SL.simulateLocal(launch(c,clubSpeed(c),{shot:shotFor(c)},course.lie),wl,ground), tot=sim.z;
    if(tot<R*0.3 || tot>R+30) continue; const P=patternOf(c); opts.push({c, k:null, tot, drift:sim.x, P}); }
  if(R<=maxWedge()*1.1){ const M=wedgeMatrix(); for(const c of bagWedges()) for(const p of CLOCK){ if(p.k==="full") continue; const cell=M[c][p.k]; if(Math.abs(cell.total-R)>25) continue;
    const P=patternOf(c), kk=cell.total/Math.max(1,M[c].full.total); opts.push({c, k:p.k, tot:cell.total, drift:0, P:{n:P.n, bias:P.bias*kk, sl:Math.max(2.5,P.sl*kk), sd:Math.max(2.5,P.sd*kk*1.1)}}); } }
  if(!opts.length) return null;
  opts.sort((a,b)=>Math.abs(a.tot-R)-Math.abs(b.tot-R)); const cand=opts.slice(0,7);
  const ES=(op,a)=>{ let s=0; for(const [gx,wx] of GQ) for(const [gz,wz] of GQ) s+=wx*wz*cost(toW(a+op.drift+op.P.bias+gx*op.P.sl, op.tot+gz*op.P.sd)); return s; };
  let best=null;
  for(const op of cand){ const st=Math.max(1.5,op.P.sl/2); for(let a=-2.5*op.P.sl; a<=2.5*op.P.sl+1e-6; a+=st){ const e=ES(op,a); if(!best||e<best.e) best={op,a,e}; } }
  // tu objetivo actual con el palo que tienes en la mano
  const curOp=cand.find(x=>x.c===club && !x.k) || cand.find(x=>x.c===club) || cand[0], cl=r[0]*(cur.x-o.x)+r[1]*(cur.z-o.z), cf=f[0]*(cur.x-o.x)+f[1]*(cur.z-o.z);
  const eCur=ES(curOp, cl/Math.max(1,cf)*curOp.tot);
  const aim=toW(best.a, best.op.tot), res={c:best.op.c, k:best.op.k, e:best.e, eCur, curC:curOp.c, aim:{x:+aim.x.toFixed(1), z:+aim.z.toFixed(1)}, off:best.a, tot:best.op.tot, P:best.op.P, drift:best.op.drift, yaw};
  stratCache={key,res}; return res; }
function patternFor(){ // la elipse que se dibuja: tu patrón con el palo en la mano hacia el objetivo actual
  if(mode!=="course"||!course||course.holed||course.done||course.lie==="green") return null;
  const o=course.ball, p=aimPoint(), yaw=yawTo(o,p), d=Math.hypot(p.x-o.x,p.z-o.z); if(d<35) return null;
  const P=course.stratClub&&course.stratK ? null : patternOf(club); const pp=P||patternOf(club), r=rightOf(yaw), f=[Math.sin(yaw),Math.cos(yaw)];
  const ck=caddieInfo&&caddieInfo.clock&&caddieInfo.clock.c===club ? caddieInfo.clock.cell.total/Math.max(1,wedgeMatrix()[club]?wedgeMatrix()[club].full.total:1) : 1;
  return {x:p.x+r[0]*pp.bias*ck, z:p.z+r[1]*pp.bias*ck, yaw, sl:Math.max(2.5,pp.sl*ck), sd:Math.max(2.5,pp.sd*ck), n:pp.n}; }
function useStrategy(){ const s=strategy(); if(!s) return; setAim(s.aim,true); course.stratClub=s.c; course.stratK=s.k; saveCourse(); setClub(s.c,true); suggestClub(); beep(1200,0.03);
  say(`Apunta ${Math.abs(s.off)<2?"al centro":Math.round(Math.abs(s.off))+" metros a la "+((s.off>0)?"derecha":"izquierda")} con ${CLUBS[s.c].name}${s.k?" "+clockAt(s.k):""}.`); }

// ===== Matriz de wedges =====
// Cada casilla: mediana de carry y total de tus últimos swings reales con ese wedge y ese largo de swing.
// Sin datos, se estima con tu velocidad de ese palo y la fracción típica de cada largo (estimado).
let wmCache=null, wmKey="";
function wedgeMatrix(){ const key=history.length+"|"+(history[0]&&history[0].id)+"|"+S.bag+"|"+SL.env.alt+"|"+S.hand+"|"+JSON.stringify(calib).length;
  if(wmCache && wmKey===key) return wmCache;
  const real=history.filter(h=>!h.sim && isWedge(h.club) && h.arcTop!=null), M={};
  for(const c of bagWedges()){ M[c]={}; for(const p of CLOCK){ const d=real.filter(h=>h.club===c && clockOf(h)===p.k).slice(0,12).map(derive);
      if(d.length){ const ca=d.map(x=>x.carry), m=median(ca), sd=Math.sqrt(ca.reduce((a,x)=>a+(x-m)**2,0)/ca.length); M[c][p.k]={n:d.length, carry:m, total:median(d.map(x=>x.total)), sd}; }
      else { const s=SL.simulateLocal(launch(c,clubSpeed(c)*p.sp,{},"tee"),[0,0],null); M[c][p.k]={n:0, carry:s.carry, total:Math.hypot(s.x,s.z), est:true}; } } }
  wmCache=M; wmKey=key; return M; }
function maxWedge(){ const M=wedgeMatrix(); return Math.max(0,...bagWedges().map(c=>M[c].full.total)); }
// el wedge y la hora del reloj que mejor dejan la bola a esa distancia (prefiere casillas medidas)
function clockPick(d){ const M=wedgeMatrix(); let b=null;
  for(const c of bagWedges()) for(const p of CLOCK){ const cell=M[c][p.k], e=Math.abs(cell.total-d)+(cell.est?4:0)+(p.k==="730"?1:0); if(!b||e<b.e) b={c,k:p.k,cell,e}; }
  return b && Math.abs(b.cell.total-d)<14 ? b : null; }
// ---- entrenamiento guiado de la matriz en el range ----
let drill=null;
function nextDrillCell(){ const M=wedgeMatrix(); let b=null; for(const c of bagWedges()) for(const p of CLOCK){ const n=M[c][p.k].n; if(n<5 && (!b||n<b.n)) b={c,k:p.k,n}; } return b; }
function startDrill(c,k,auto){
  if(!c){ const nx=nextDrillCell(); if(!nx){ msg("Tu matriz ya está completa: cada casilla tiene 5 swings o más.",false); return; } c=nx.c; k=nx.k; }
  drill={c,k,goal:5,hits:[],auto:!!auto,last:""}; if(mode!=="range") setMode("range"); setClub(c);
  const cell=wedgeMatrix()[c][k]; if(has3D) setAim({x:0,z:Math.max(15,Math.round(cell.total))},true);
  renderDrill(); window.scrollTo({top:0,behavior:"smooth"});
  say(`Matriz de wedges: ${CLUBS[c].name} ${clockAt(k)}. Haz cinco swings.`); }
function stopDrill(){ drill=null; renderDrill(); }
function renderDrill(){ const el=$("drillTip"); if(!el) return; if(!drill || mode!=="range"){ el.hidden=true; return; }
  const n=drill.hits.length, avg=n?median(drill.hits):null;
  el.innerHTML=`<button class="x" id="drillX" aria-label="Terminar entrenamiento">✕</button><b>Matriz · ${CLUBS[drill.c].name} · ${drill.k==="full"?"completo":clockName(drill.k)}</b>`+
    `<span class="dots">${Array.from({length:drill.goal},(_,i)=>`<i class="${i<n?"on":""}"></i>`).join("")}</span> ${n}/${drill.goal}`+(avg!=null?` · ${fmtDist(avg)}`:"")+
    (drill.last?`<div class="last">${drill.last}</div>`:`<div class="last">${clockHelp(drill.k)}</div>`);
  el.hidden=false; $("drillX").onclick=e=>{ e.stopPropagation(); stopDrill(); }; }
function clockHelp(k){ return k==="730"?"Brazo izquierdo a la altura de la cadera: un swing corto y suave."
  : k==="900"?"Brazo izquierdo paralelo al suelo, con las muñecas quebradas (el palo apunta al cielo)."
  : k==="1030"?"Manos a la altura del hombro o un poco más: tres cuartos de swing."
  : "Swing completo, con el mismo ritmo de siempre."; }
const CLK_ORD={730:0,900:1,1030:2,full:3};
function drillShot(h){ if(!drill || h.sim || mode!=="range") return;
  if(h.club!==drill.c){ drill.last=`Ese swing fue con ${CLUBS[h.club].name}: para la matriz usa el ${CLUBS[drill.c].name}.`; renderDrill(); return; }
  const k=clockOf(h), dv=derive(h);
  if(!k){ drill.last="No pude ver el largo de ese swing: quédate quieto antes de empezar."; renderDrill(); return; }
  if(k===drill.k){ drill.hits.push(dv.carry); const n=drill.hits.length;
    drill.last=`✓ ${clockName(k)} (${h.arcTop}°) · carry ${fmtDist(dv.carry)}`;
    if(n>=drill.goal){ const m=median(drill.hits), sd=Math.sqrt(drill.hits.reduce((a,x)=>a+(x-m)**2,0)/n);
      drill.last=`Casilla lista: ${CLUBS[drill.c].name} ${clockAt(drill.k)} = ${fmtDist(m)} de carry (±${fmtDist(sd)}).`; say(`Listo. ${CLUBS[drill.c].name} ${clockAt(drill.k)}: ${sayDist(m)}.`);
      if(drill.auto){ const nx=nextDrillCell(); renderDrill(); setTimeout(()=>{ if(drill && nx) startDrill(nx.c,nx.k,true); else stopDrill(); },3500); return; }
      renderDrill(); setTimeout(()=>{ if(drill && drill.hits.length>=drill.goal) stopDrill(); },6000); return; } }
  else drill.last=`Ese fue ${clockAt(k)} (${h.arcTop}°): ${CLK_ORD[k]<CLK_ORD[drill.k]?"sube un poco más las manos":"un poco más corto"}. No cuenta para esta casilla, pero sí para tu matriz.`;
  renderDrill(); }
// ---- pestaña Wedges en Datos ----
function clockSvg(k){ const h={730:7.5,900:9,1030:10.5,full:11.6}[k], a=(S.hand==="L"?12-h:h)/12*Math.PI*2, x=13+9*Math.sin(a), y=13-9*Math.cos(a);
  return `<svg class="clk" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="11.5"/><line x1="13" y1="13" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/><circle class="c" cx="13" cy="13" r="1.8"/></svg>`; }
function renderWedges(){ const t=$("wedgeTbl"); if(!t || t.closest("[hidden]")) return; const M=wedgeMatrix(), u=S.dist==="yd"?"yd":"m", cv=v=>Math.round(S.dist==="yd"?v/0.9144:v);
  t.innerHTML=`<thead><tr><th>Carry (${u})</th>${CLOCK.map(p=>`<th>${clockSvg(p.k)}<span>${p.k==="full"?"Completo":clockName(p.k)}</span></th>`).join("")}</tr></thead><tbody>`+
    bagWedges().map(c=>`<tr><th>${CLUBS[c].name}<small>${{wedge:"46°",gw:"52°",sw:"56°",lw:"60°"}[c]}</small></th>`+CLOCK.map(p=>{ const e=M[c][p.k];
      return `<td><button class="wcell${e.est?" est":""}${drill&&drill.c===c&&drill.k===p.k?" on":""}" data-c="${c}" data-k="${p.k}" aria-label="${CLUBS[c].name} ${clockAt(p.k)}: ${e.est?"estimado ":""}${cv(e.carry)} ${u}">`+
        `<b>${e.est?"≈":""}${cv(e.carry)}</b><small>${e.est?"estimado":`${e.n} swing${e.n>1?"s":""}`+(e.n>=3?` · ±${cv(e.sd)}`:"")}</small></button></td>`; }).join("")+`</tr>`).join("")+`</tbody>`;
  t.querySelectorAll(".wcell").forEach(b=>b.addEventListener("click",()=>startDrill(b.dataset.c,b.dataset.k,false)));
  const M2=M, gaps=[]; const ws=bagWedges(); for(let i=0;i<ws.length-1;i++){ const A=M2[ws[i]].full, B=M2[ws[i+1]].full, g=A.carry-B.carry; if(A.n && B.n && g>16) gaps.push(`entre ${CLUBS[ws[i]].name} y ${CLUBS[ws[i+1]].name} hay ${fmtDist(g)}`); }
  const filled=bagWedges().reduce((a,c)=>a+CLOCK.filter(p=>M[c][p.k].n>=3).length,0), total=bagWedges().length*CLOCK.length;
  $("wedgeNote").textContent=`${filled} de ${total} casillas con 3 swings o más.`+(gaps.length?` Ojo: ${gaps.join("; ")} con swing completo; un wedge intermedio o un swing a las 10:30 cubre ese hueco.`:"");
}
function puttsFor(d){ const r=Math.random(); if(d<1.5) return 1; if(d<3) return r<0.6?1:2; if(d<8) return r<0.15?1:(r<0.93?2:3); if(d<15) return r<0.05?1:(r<0.8?2:3); return r<0.6?2:3; }
const RESULT={"-3":"¡Albatros!","-2":"¡Eagle!","-1":"Birdie","0":"Par","1":"Bogey","2":"Doble bogey"};
// celebración en pantalla según el resultado del hoyo
function celebrate(strokes,par){ const d=strokes-par, el=$("celebrate"); if(!el) return;
  const txt=strokes===1?"¡HOYO EN UNO!":d<=-3?"¡ALBATROS!":d===-2?"¡EAGLE!":d===-1?"¡BIRDIE!":d===0?"PAR":null; if(!txt) return;
  el.innerHTML=`<b>${txt}</b>`; el.className="celebrate"+(d<0||strokes===1?" big":""); el.hidden=false;
  if(d<0 || strokes===1){ for(let i=0;i<46;i++){ const c=document.createElement("i"); c.style.left=(Math.random()*100)+"%"; c.style.background=["#f2c230","#7dff9a","#ffffff","#ff6b6b","#66c7ff"][i%5];
      c.style.animationDelay=(Math.random()*0.5)+"s"; c.style.animationDuration=(1.6+Math.random()*1.2)+"s"; c.style.transform=`rotate(${Math.random()*360}deg)`; el.appendChild(c); } }
  clearTimeout(celebrate.t); celebrate.t=setTimeout(()=>{ el.hidden=true; el.innerHTML=""; },3200); }
function finishHole(text,voice){
  course.holed=true; course.scores[course.hole]=course.strokes; course.auto=null; celebrate(course.strokes,HOLES[course.hole].par);
  if(course.hole===HOLES.length-1){ course.done=true; saveRoundStats(); const tot=course.scores.reduce((a,b)=>a+b,0), par=parOf(), dd=tot-par, rec=recOf(courseId);
    if(!course.sim && (rec==null || tot<rec)){ records[recKey()]=tot; store.set("sl2_records",records); voice+=" ¡Nuevo récord en "+CUR.name+"!"; }
    if(course.sim) text+=" · con golpes de prueba: no entra al ranking";
    else { const pos=addEntry("rounds",{v:tot, d:tot-par, c:courseId, sel:selOf(courseId), sc:course.scores.slice()}); if(pos===1) voice+=" ¡Primer lugar del ranking!"; else if(pos<=3) voice+=` Quedas ${pos}º en el ranking.`; }
    voice+=` Ronda terminada: ${tot} golpes, ${dd===0?"par del campo":dd>0?dd+" sobre par":(-dd)+" bajo par"}.`; }
  setHudMsg(text); say(voice); saveCourse(); renderHud(); renderScore(); renderCourses();
  const seq=shotSeq; if(!course.done) setTimeout(()=>{ if(seq===shotSeq && course.holed && !course.done) nextHole(); },6500);
}
const CHIP_MAX=40;
function speedFor(c,dist,lie,h,ground){ let lo=1, hi=CLUBS[c].def*1.2; for(let i=0;i<22;i++){ const m=(lo+hi)/2, s=SL.simulateLocal(launch(c,m,h,lie),[0,0],ground||null); if(Math.hypot(s.x,s.z)<dist) lo=m; else hi=m; } return (lo+hi)/2; }
const WATER_TXT={ocean:["¡Al mar!","Al mar."], burn:["¡Al arroyo!","Al arroyo."], pond:["¡Agua!","Al agua."]};
function courseShot(h){
  if(course.done){ say("La ronda terminó. Empieza una nueva."); return; }
  if(course.holed) nextHole();
  if(aimMode) toggleAimView(false);
  const hole=HOLES[course.hole], yaw=aimYaw(), ox=course.ball.x, oz=course.ball.z, w=course.wind[course.hole], tgt=aimPoint(), fromD=distToPin(), fromLie=course.lie;
  if(h.sim) course.sim=true;
  const f=[Math.sin(yaw),Math.cos(yaw)], r=rightOf(yaw), windLocal=[w.x*r[0]+w.z*r[1], w.x*f[0]+w.z*f[1]];
  const toLocal=(x,z)=>[r[0]*(x-ox)+r[1]*(z-oz), f[0]*(x-ox)+f[1]*(z-oz)];
  // Golpe corto asistido: cerca del green el sensor no mide bien un swing tan suave,
  // así que la distancia se ajusta al objetivo (con un poco de error) y la cara y la ruta mandan la dirección
  const dv=derive(h), ad=Math.hypot(tgt.x-ox,tgt.z-oz), chip=ad<=CHIP_MAX && course.lie!=="tee";
  let ms=dv.ms; if(chip){ const need=speedFor(h.club,ad,course.lie,h,(lx,lz)=>SL.lieAt(hole, ox+r[0]*lx+f[0]*lz, oz+r[1]*lx+f[1]*lz)), k=Math.max(0.5,Math.min(3,dv.ms/need)); ms=need*(1+0.12*Math.log2(k))*(1+gauss()*0.045); }
  const o=launch(h.club,ms,h,course.lie);
  const sim=SL.simulateLocal(o, windLocal, (lx,lz)=>SL.lieAt(hole, ox+r[0]*lx+f[0]*lz, oz+r[1]*lx+f[1]*lz));
  let pts=toWorld(sim.pts,ox,oz,yaw), landT=sim.landT, fx=ox+r[0]*sim.x+f[0]*sim.z, fz=oz+r[1]*sim.x+f[1]*sim.z;
  let wx=ox+r[0]*sim.landX+f[0]*sim.landZ, wz=oz+r[1]*sim.landX+f[1]*sim.landZ, card=sim, tree=false;
  // choque con un árbol: la bola cae al pie de la copa
  const th=SL.treeHit(hole,pts);
  if(th){ const p=pts[th.i], q=pts[th.i-1], dl=Math.hypot(p.x-q.x,p.z-q.z)||1, bx=-(p.x-q.x)/dl*1.5, bz=-(p.z-q.z)/dl*1.5, tf=Math.sqrt(2*Math.max(0.05,p.y)/9.81), fall=[];
    for(let k=1;k<=10;k++){ const u=k/10; fall.push({t:p.t+tf*u, x:p.x+bx*u, y:p.y*(1-u*u), z:p.z+bz*u}); }
    pts=pts.slice(0,th.i+1).concat(fall); landT=fall[9].t; fx=wx=fall[9].x; fz=wz=fall[9].z; tree=true;
    const lc=toLocal(fx,fz); card=Object.assign({},sim,{carry:Math.hypot(lc[0],lc[1]), x:lc[0], z:lc[1], apex:Math.min(sim.apex,Math.max(...pts.map(q=>q.y)))}); }
  let endLie = !tree && (sim.landG==="water"||sim.landG==="ob") ? sim.landG : SL.lieAt(hole,fx,fz);
  if(endLie==="water" && !SL.waterAt(hole,wx,wz)){ wx=fx; wz=fz; }
  const line=pts.filter(p=>p.t<=landT).filter((p,i,a)=>i%4===0||i===a.length-1).map(p=>({x:+p.x.toFixed(1),y:+p.y.toFixed(1),z:+p.z.toFixed(1)}));
  const seq=++shotSeq; setHudMsg(null); $("holeTip").hidden=true; $("card").hidden=true; $("skip").hidden=false; $("aimBar").hidden=true;
  camShot();
  const wood=["driver","wood3"].includes(h.club), impact=fromLie==="bunker"?"sandShot":(fromLie==="fairway"||fromLie==="rough")&&!wood&&!chip?"divot":null;
  const landKind=tree?null:endLie==="water"?"water":endLie==="bunker"?"sand":endLie==="ob"?null:"grass";
  World.playShot({pts, landT, swing:swingOf(h), onDown:()=>sfx.whoosh(), onImpact:()=>sfx.hit(h.club), impact, landKind, onLand:()=>(endLie==="water"?sfx.splash():sfx.land()), onEnd:()=>{
    $("skip").hidden=true; showCard(card, Math.hypot(fx-tgt.x,fz-tgt.z));
    course.lines.push(line); World.setLines(course.lines);
    if(endLie==="water" || endLie==="ob"){
      course.strokes+=2; course.aim=null; let text, voice;
      if(endLie==="water"){ const wa=SL.waterAt(hole,wx,wz)||{kind:"pond"}, tx=WATER_TXT[wa.kind]||WATER_TXT.pond, d=SL.dropFor(hole,{x:ox,z:oz},{x:wx,z:wz});
        course.ball={x:+d.x.toFixed(1), z:+d.z.toFixed(1)}; const l=SL.lieAt(hole,d.x,d.z); course.lie=["water","ob","green"].includes(l)?"rough":l;
        text=`${tx[0]} +1 de penalidad`; voice=`${tx[1]} Un golpe de penalidad. Dropeas ${hole.drop?"en la zona de dropeo":"cerca de donde entró"}.`; }
      else { text="Fuera de límites · +1"; voice="Fuera de límites. Penalidad de un golpe. Juegas de nuevo desde el mismo sitio."; }
      logShot({d:fromD, lie:fromLie, to:distToPin(), toLie:course.lie, pen:1, n:course.strokes, club:h.club});
      setHudMsg(text); say(voice);
      if(course.strokes>=hole.par+5){ finishHole("Máximo de golpes · recoges la bola","Llegaste al máximo de golpes en este hoyo."); return; }
      saveCourse(); renderHud(); renderScore(); drawMini(); suggestClub();
      setTimeout(()=>{ if(seq===shotSeq && !World.busy()){ setHudMsg(null); setupHole(false); } },2800); return;
    }
    if(!h.sim && h.club==="driver") addEntry("drives",{v:+Math.hypot(fx-ox,fz-oz).toFixed(1), c:courseId});
    course.strokes+=1; course.ball={x:fx,z:fz}; course.lie=endLie; course.aim=null; course.auto=null; drawMini();
    { const dd=distToPin(); logShot({d:fromD, lie:fromLie, to:dd<0.3?0:dd, toLie:dd<0.3?"green":endLie, n:course.strokes, club:h.club}); }
    if(Math.hypot(tgt.x-hole.pinX,tgt.z-hole.L)>1) setTimeout(()=>{ if(seq===shotSeq) say(`A ${sayDist(Math.hypot(fx-tgt.x,fz-tgt.z))} del objetivo.`); },2200);
    const d=distToPin();
    if(d<0.3){ const diff=course.strokes-hole.par, name=course.strokes===1?"¡Hoyo en uno!":(RESULT[diff]||(diff>0?`+${diff}`:`${diff}`));
      sfx.cup(); finishHole(`¡Embocada! ${name}`, `¡Embocada! ${name}.`); return; }
    if(endLie==="green"){
      const n=puttsFor(d); setHudMsg(`${chip?"Chip · ":""}En el green a ${fmtDist(d)}`); say(`En el green a ${sayDist(d)}.`);
      setTimeout(()=>{ if(seq!==shotSeq) return; setHudMsg(null); $("card").hidden=true;
        World.playPutts({from:{x:fx,z:fz}, pin:{x:hole.pinX,z:hole.L}, n, onPutt:()=>sfx.putt(), onHole:()=>sfx.cup(), onEnd:()=>{
          course.strokes+=n; logShot({putt:true, d, n}); const diff=course.strokes-hole.par, name=RESULT[diff]||(diff>0?`+${diff}`:`${diff}`);
          course.ball={x:hole.pinX,z:hole.L}; finishHole(`${n} putt${n>1?"s":""} · ${name}`, `${n} putt${n>1?"s":""}. ${name}.`); }}); },1800);
      return;
    }
    if(course.strokes>=hole.par+5){ course.strokes+=1; logShot({d, lie:endLie, to:0, toLie:"green", n:course.strokes, pickup:true}); finishHole("Máximo de golpes · recoges la bola","Llegaste al máximo de golpes en este hoyo."); return; }
    const lieName={fairway:"En la calle",rough:"En el rough",bunker:"En el bunker",tee:"En el tee",road:"En el camino"}[endLie]||"";
    setHudMsg(`${tree?"¡Árbol! ":chip?"Chip · ":""}${lieName} · faltan ${fmtDist(d)}`); say(`${tree?"Pegó en un árbol. ":""}${lieName}. Faltan ${sayDist(d)}.`);
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
  $("hudL").innerHTML=`<b>Hoyo ${h.num} · Par ${h.par}</b>${CUR.name} · ${course.holed?"terminado":"faltan "+fmtDist(d)}`;
  const tot=course.scores.reduce((a,b,i)=>a+(b||0)-(b?HOLES[i].par:0),0); R.hidden=false;
  R.innerHTML=`<b>${players.length>1?S.player.replace(/</g,"&lt;")+" · ":""}${course.holed?course.strokes+" golpes":"Golpe "+(course.strokes+1)}</b>${w.s>0.3?"Viento "+w.s.toFixed(0)+" m/s "+windArrow(w):"Sin viento"}<br>Ronda: ${tot===0?"par":tot>0?"+"+tot:tot}`;
}
function windArrow(w){ if(!course) return ""; const rel=aimYaw()-Math.atan2(w.x,w.z), a=((rel/DEG)%360+360)%360;
  return ["↑","↗","→","↘","↓","↙","←","↖"][Math.round(a/45)%8]; }
// símbolos de la tarjeta: círculo birdie, doble círculo eagle, cuadrado bogey, doble cuadrado doble bogey o más
const scCls=(s,par)=>s==null?"":s<=par-2?"sc-eagle":s===par-1?"sc-birdie":s===par+1?"sc-bogey":s>=par+2?"sc-dbl":"sc-par";
function renderScore(){
  const tbl=$("scoreTbl"), par=parOf(), rec=recOf(courseId);
  renderSel();
  if(!course){ tbl.innerHTML=""; $("nextHole").hidden=true; $("courseNote").textContent=CUR.desc; return; }
  const part=(from,to,lab)=>{ const H=HOLES.slice(from,to); if(!H.length) return ""; const pp=H.reduce((a,h)=>a+h.par,0), ss=H.reduce((a,h,j)=>a+(course.scores[from+j]||0),0);
    const cells=H.map((h,j)=>{ const i=from+j, s=course.scores[i]; return `<td class="${i===course.hole&&!course.done?"sc-cur":""}"><span class="${scCls(s,h.par)}">${s??(i===course.hole&&course.strokes?course.strokes:"")}</span></td>`; }).join("");
    return `<thead><tr><th>Hoyo</th>${H.map(h=>`<th>${h.num}</th>`).join("")}<th>${lab}</th></tr></thead><tbody><tr><td>Par</td>${H.map(h=>`<td>${h.par}</td>`).join("")}<td>${pp}</td></tr><tr><td>Golpes</td>${cells}<td><b>${ss||"—"}</b></td></tr></tbody>`; };
  const tot=course.scores.reduce((a,b)=>a+(b||0),0);
  tbl.innerHTML = HOLES.length>9 ? part(0,9,"Ida")+part(9,18,"Vuelta") : part(0,HOLES.length,"Total");
  $("scoreTot").textContent = HOLES.length>9 ? `Total: ${tot||"—"} · par ${par}` : "";
  $("nextHole").hidden=!(course.holed && !course.done);
  renderStats();
  $("courseNote").textContent = course.done ? `Ronda terminada en ${CUR.name}: ${tot} golpes (${tot-par===0?"par del campo":tot-par>0?"+"+(tot-par):tot-par}).`+(rec?` Tu récord aquí: ${rec}.`:"")
    : CUR.desc+" Los putts se juegan solos según la distancia y el viento cambia en cada hoyo."+(rec?` Tu récord aquí: ${rec} golpes.`:"");
}
// ===== Estadísticas de la ronda =====
let statScope="round";
function renderStats(){ const cv=$("sgChart"); if(!cv || cv.closest("[hidden]")) return; const base=S.sgBase||"hcp15", vs=base==="tour"?"el PGA Tour":"un hándicap 15";
  let R=null, label="";
  if(statScope==="round"){ R=roundStats(base); label=R?`en ${R.n} hoyo${R.n>1?"s":""}`:""; }
  else { const L=sgHist.filter(r=>r.player===S.player||!r.player).slice(0,10); if(L.length){ const per=r=>18/r.n, avg=f=>L.reduce((a,r)=>a+f(r)*per(r),0)/L.length, sgOf=r=>base==="tour"?r.sg:(r.sgH||r.sg);
      R={n:18, sg:{ott:avg(r=>sgOf(r).ott), app:avg(r=>sgOf(r).app), arg:avg(r=>sgOf(r).arg), putt:avg(r=>sgOf(r).putt)},
        fw:[L.reduce((a,r)=>a+r.fw[0],0),L.reduce((a,r)=>a+r.fw[1],0)], gir:[L.reduce((a,r)=>a+r.gir[0],0),L.reduce((a,r)=>a+r.gir[1],0)],
        putts:avg(r=>r.putts), pen:avg(r=>r.pen), scr:[L.reduce((a,r)=>a+r.scr[0],0),L.reduce((a,r)=>a+r.scr[1],0)], sand:[L.reduce((a,r)=>a+r.sand[0],0),L.reduce((a,r)=>a+r.sand[1],0)], avgRound:true}; label=`promedio por 18 hoyos en ${L.length} ronda${L.length>1?"s":""}`; } }
  const g=canvasFor("sgChart"); if(!g) return; const {c,W,H}=g, ink=css("--ink"), mut=css("--muted"), line=css("--line");
  if(!R){ c.fillStyle=mut; c.font="12px "+css("--body"); c.textAlign="center"; c.fillText(statScope==="round"?"Termina un hoyo para ver tus estadísticas":"Termina una ronda de 9 o 18 hoyos para ver el promedio",W/2,H/2);
    $("statTiles").innerHTML=""; $("statNote").textContent=""; return; }
  const cats=["ott","app","arg","putt"], tot=cats.reduce((a,k)=>a+R.sg[k],0), rows=[...cats.map(k=>[SG_CAT[k],R.sg[k],false]),["Total",tot,true]];
  const mx=Math.max(1.5,...rows.map(r=>Math.abs(r[1])))*1.15, L0=118, Rr=46, cx=L0+(W-L0-Rr)/2, sc=(W-L0-Rr)/2/mx, rh=(H-22)/rows.length;
  c.strokeStyle=line; c.lineWidth=1; c.beginPath(); c.moveTo(cx,4); c.lineTo(cx,H-18); c.stroke();
  c.fillStyle=mut; c.font="10px "+css("--body"); c.textAlign="center"; c.fillText("pierdes",cx-(W-L0-Rr)/4,H-5); c.fillText("ganas",cx+(W-L0-Rr)/4,H-5);
  rows.forEach(([name,v,bold],i)=>{ const y=6+i*rh, bh=Math.min(18,rh-8), by=y+(rh-bh)/2;
    if(bold){ c.strokeStyle=line; c.beginPath(); c.moveTo(4,y); c.lineTo(W-4,y); c.stroke(); }
    c.fillStyle=ink; c.font=(bold?"700 ":"500 ")+"12px "+css("--body"); c.textAlign="left"; c.fillText(name,4,by+bh-4);
    const w=Math.abs(v)*sc, x0=v>=0?cx:cx-w; c.fillStyle=v>=0?css("--green"):"#c4553a"; c.beginPath(); if(c.roundRect) c.roundRect(x0,by,Math.max(2,w),bh,v>=0?[0,4,4,0]:[4,0,0,4]); else c.rect(x0,by,Math.max(2,w),bh); c.fill();
    c.fillStyle=ink; c.font="600 12px "+css("--body"); c.textAlign="right"; c.fillText((v>0?"+":v<0?"−":"")+Math.abs(v).toFixed(1),W-4,by+bh-4); });
  const pct=a=>a[1]?`${a[0]}/${a[1]}`:"—", pc=a=>a[1]?` · ${Math.round(a[0]/a[1]*100)}%`:"";
  const tiles=[["Calles",pct(R.fw),pc(R.fw)],["Greens en regulación",pct(R.gir),pc(R.gir)],["Putts",R.avgRound?R.putts.toFixed(1):String(R.putts),R.avgRound?" por ronda":` · ${(R.putts/R.n).toFixed(1)} por hoyo`],
    ["Up & down",pct(R.scr),pc(R.scr)],["Salidas de bunker",pct(R.sand),pc(R.sand)],["Penalidades",R.avgRound?R.pen.toFixed(1):String(R.pen),R.avgRound?" por ronda":""]];
  $("statTiles").innerHTML=tiles.map(([k,v,s])=>`<div><span>${k}</span><strong>${v}</strong><small>${s.replace(/^ · /,"")}</small></div>`).join("");
  const worst=cats.reduce((a,k)=>R.sg[k]<R.sg[a]?k:a,cats[0]), best=cats.reduce((a,k)=>R.sg[k]>R.sg[a]?k:a,cats[0]);
  const tip={ott:"Prioriza calles: con la salida en juego el resto del hoyo se vuelve más fácil. Usa la estrategia según tu dispersión.", app:"Trabaja los hierros y la elección de palo: apunta al centro del green, no siempre a la bandera.",
    arg:"Llena tu matriz de wedges y practica chips: es donde un amateur ahorra más golpes.", putt:"Practica putts de 1 a 2 metros y el control de distancia en los largos."}[worst];
  $("statNote").innerHTML=`Comparado con ${vs}, ${label}. `+(R.sg[worst]<-0.3?`Donde más golpes pierdes: <b>${SG_CAT[worst].toLowerCase()}</b> (${R.sg[worst].toFixed(1).replace("-","−")}). ${tip}`:"Vas parejo en todo.")+(R.sg[best]>0.3?` Tu fuerte: ${SG_CAT[best].toLowerCase()} (+${R.sg[best].toFixed(1)}).`:""); }
function renderSel(){ const box=$("selSeg"); box.hidden=CUR.n<=9; if(CUR.n<=9) return; const cur=selOf(courseId);
  box.innerHTML=["front","back","all"].map(k=>`<button data-s="${k}" aria-pressed="${k===cur}">${SEL_NAME[k]}</button>`).join("");
  box.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>selectSel(b.dataset.s))); }
function selectSel(sel){ if(World.busy() || sel===selOf(courseId)) return; sels[courseId]=sel; store.set("sl12_sel",sels);
  HOLES=holesFor(CUR,sel); builtHole=""; course=validRound(rounds[roundKey()])?rounds[roundKey()]:null; $("card").hidden=true; setHudMsg(null);
  if(mode==="course"){ if(!course) newRound(); else { setupHole(true); renderScore(); } } else renderScore(); renderCourses(); }
// Selector de campo
function renderCourses(){ const box=$("coursePick"); if(!box) return;
  box.innerHTML=SL.COURSES.map(c=>{ const sl=selOf(c.id), r=rounds[roundKey(c.id)], rec=recOf(c.id), playing=r && !r.done && (r.hole>0||r.strokes>0), hn=c.n>9?null:c.nums;
    return `<button class="cp" data-c="${c.id}" aria-pressed="${c.id===courseId}"><span class="cp-tag">${c.style}</span><b>${c.name}</b><span>${c.place}</span>`+
      `<small>${hn?`Hoyos ${hn.join(" · ")} · par ${c.par}`:`18 hoyos · par ${c.par}`}${rec?` · récord ${rec}`:""}${playing?` · en juego (hoyo ${holesFor(c,sl)[r.hole]?.num??"?"})`:""}</small></button>`; }).join("");
  box.querySelectorAll(".cp").forEach(b=>b.addEventListener("click",()=>selectCourse(b.dataset.c))); }
function selectCourse(id){
  if(World.busy()) return; const c=SL.courseById(id); if(c.id===courseId && course) return;
  courseId=c.id; CUR=c; HOLES=holesFor(c,selOf(c.id)); store.set("sl8_courseId",courseId); builtHole=""; applyAlt();
  course=validRound(rounds[roundKey()])?rounds[roundKey()]:null; $("card").hidden=true; setHudMsg(null); if(aimMode) aimMode=false;
  if(mode!=="course"){ renderCourses(); renderScore(); return; }
  if(!course) newRound(); else { setupHole(true); renderScore(); }
  renderCourses(); window.scrollTo({top:0, behavior:"smooth"});
}
function drawMini(){
  const cv=$("mini"); if(cv.hidden || !course) return; const dpr=window.devicePixelRatio||1, W=cv.clientWidth, H=cv.clientHeight;
  cv.width=W*dpr; cv.height=H*dpr; const c=cv.getContext("2d"); c.setTransform(dpr,0,0,dpr,0,0);
  const h=HOLES[course.hole], xs=h.cs.map(p=>p.x), zs=h.cs.map(p=>p.z), x0=Math.min(...xs)-16, x1=Math.max(...xs)+16, z0=-8, z1=Math.max(...zs)+16;
  const sc=Math.min((W-6)/(x1-x0),(H-8)/(z1-z0)), cxm=(x0+x1)/2, X=x=>W/2-(x-cxm)*sc, Y=z=>H-4-(z-z0)*sc;   // igual que se ve desde el tee en 3D
  const poly=pts=>{ c.beginPath(); pts.forEach((p,i)=>i?c.lineTo(X(p.x),Y(p.z)):c.moveTo(X(p.x),Y(p.z))); c.closePath(); };
  const ell=(e,pad)=>{ c.beginPath(); c.ellipse(X(e.x),Y(e.z),Math.max(1.2,(e.rx+pad)*sc),Math.max(1.2,(e.rz+pad)*sc),e.rot,0,Math.PI*2); };
  c.fillStyle="#5a893a"; c.fillRect(0,0,W,H);
  c.fillStyle="#46702c"; h.ob.forEach(p=>{ poly(p); c.fill(); });
  c.fillStyle="#86be5a"; c.beginPath(); h.fairSamples.forEach((f,i)=>{ if(i%3) return; const r=Math.max(1,f.w*sc); c.moveTo(X(f.x)+r,Y(f.z)); c.arc(X(f.x),Y(f.z),r,0,Math.PI*2); }); c.fill();
  c.fillStyle="#2a6c96"; h.water.forEach(w=>{ poly(w.pts); c.fill(); });
  c.fillStyle="#86be5a"; h.land.forEach(l=>{ poly(l.pts); c.fill(); });
  c.strokeStyle="#9a9384"; c.lineWidth=1.2; h.roads.forEach(r=>{ c.beginPath(); r.pts.forEach((p,i)=>i?c.lineTo(X(p.x),Y(p.z)):c.moveTo(X(p.x),Y(p.z))); c.stroke(); });
  c.fillStyle="#e2cf9c"; h.bunkers.forEach(b=>{ ell(b,0); c.fill(); });
  c.fillStyle="#95d068"; ell(h.green,0); c.fill();
  c.fillStyle="#d9d2c0"; h.buildings.forEach(b=>{ c.save(); c.translate(X(b.x),Y(b.z)); c.rotate(b.rot); c.fillRect(-b.w*sc/2,-b.d*sc/2,Math.max(1.5,b.w*sc),Math.max(1.5,b.d*sc)); c.restore(); });
  c.strokeStyle="rgba(255,255,255,.85)"; c.lineWidth=1; course.lines.forEach(l=>{ c.beginPath(); c.moveTo(X(l[0].x),Y(l[0].z)); c.lineTo(X(l[l.length-1].x),Y(l[l.length-1].z)); c.stroke(); });
  const pt=patternFor(); if(pt){ const r=rightOf(pt.yaw), f=[Math.sin(pt.yaw),Math.cos(pt.yaw)];
    for(const [k,al] of [[2,0.18],[1,0.32]]){ c.beginPath(); for(let i=0;i<=40;i++){ const t=i/40*Math.PI*2, lx=Math.cos(t)*pt.sl*k, lz=Math.sin(t)*pt.sd*k, x=pt.x+r[0]*lx+f[0]*lz, z=pt.z+r[1]*lx+f[1]*lz; i?c.lineTo(X(x),Y(z)):c.moveTo(X(x),Y(z)); }
      c.fillStyle=`rgba(255,207,51,${al})`; c.fill(); c.strokeStyle="rgba(255,255,255,.8)"; c.lineWidth=0.8; c.stroke(); } }
  if(!course.holed){ const a=aimPoint(); c.setLineDash([2,2]); c.strokeStyle="rgba(255,207,51,.9)"; c.beginPath(); c.moveTo(X(course.ball.x),Y(course.ball.z)); c.lineTo(X(a.x),Y(a.z)); c.stroke(); c.setLineDash([]); }
  c.fillStyle="#d8392b"; c.fillRect(X(h.pinX)-1,Y(h.L)-7,2,7);
  const b=course.ball; c.fillStyle="#fff"; c.strokeStyle="#000"; c.beginPath(); c.arc(X(b.x),Y(b.z),2.6,0,Math.PI*2); c.fill(); c.stroke();
}

// ================= Jugadores y ranking =================
// Solo cuentan golpes reales (no los de prueba). Se guardan en el teléfono y, si hay conexión, en el ranking en línea.
const RANK_CATS={ rounds:{name:"Rondas", online:"round", better:"min"}, drives:{name:"Drive", online:"drive", better:"max"}, speeds:{name:"Velocidad", online:"speed", better:"max"}, prox:{name:"Precisión", online:"prox", better:"min"} };
let pids=store.get("sl12_pids",{});
const pidOf=name=>{ if(!pids[name]){ pids[name]=(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2,12)); store.set("sl12_pids",pids); } return pids[name]; };
function addEntry(cat, e){
  e.p=S.player; e.at=Date.now(); const L=board[cat]; L.push(e);
  const same=x=>cat==="rounds"?x.c===e.c&&(x.sel||"all")===(e.sel||"all"):true, cmp=RANK_CATS[cat].better==="max"?(a,b)=>b.v-a.v||a.at-b.at:(a,b)=>a.v-b.v||a.at-b.at;
  const group=L.filter(same).sort(cmp), keep=new Set(group.slice(0,50)); board[cat]=L.filter(x=>!same(x)||keep.has(x));
  saveBoard(); const pos=group.indexOf(e)+1;
  if(pos===1 && cat!=="rounds" && group.length>1){ const msgTxt={drives:"¡Drive más largo del ranking!",speeds:"¡Swing más rápido del ranking!",prox:"¡El más cerca del ranking!"}[cat]; setTimeout(()=>say(msgTxt),2600); }
  if(S.nameSet) SL.Online.submit({kind:RANK_CATS[cat].online, player:S.player, pid:pidOf(S.player), course:e.c||"", sel:e.sel||"", value:e.v, par_diff:e.d??null, src:e.src||null, club:e.club||null, app:VERSION});
  return pos; }
const saveBoard=()=>store.set("sl10_board",board);
let rankCat="rounds", rankScope=SL.Online.configured()?"online":"local", rankCourse=null, rankSel=null, rankCache={}, rankLoading=false;
const fmtDate=t=>new Date(t).toLocaleDateString("es",{day:"numeric",month:"short"});
const vsPar=d=>d==null?"":d===0?"E":d>0?"+"+d:String(d);
const esc=v=>String(v).replace(/[<&]/g,c=>c==="<"?"&lt;":"&amp;");
function rankSpec(){ const c=SL.courseById(rankCourse||courseId), sel=c.n>9?(rankSel||selOf(c.id)):"all";
  if(rankCat==="rounds") return {c, sel, head:["#","Jugador","Golpes","Par","Fecha"], row:(r,i)=>[i+1,r.p,r.v,vsPar(r.d),fmtDate(r.at)],
    note:`${c.name}${c.n>9?" · "+SEL_NAME[sel]:""}: rondas completas (par ${holesFor(c,sel).reduce((a,h)=>a+h.par,0)}).`, share:x=>`${x[1]}: ${x[2]} golpes (${x[3]})`, asc:true};
  if(rankCat==="drives") return {head:["#","Jugador","Distancia","Dónde","Fecha"], row:(r,i)=>[i+1,r.p,fmtDist(r.v),r.c==="range"?"Range":r.c?SL.courseById(r.c).name:"",fmtDate(r.at)], note:"Distancia total (vuelo y rodado) de golpes reales con el driver.", share:x=>`${x[1]}: ${x[2]}`, asc:false};
  if(rankCat==="speeds") return {head:["#","Jugador","Velocidad","Con","Fecha"], row:(r,i)=>{ const f=fmtSpeed(r.v); return [i+1,r.p,f.v+" "+f.u,r.src==="camera"?"Cámara":"Sensor",fmtDate(r.at)]; }, note:"Velocidad del palo con el driver. Para que sea justo, calibra con radar o con tus distancias.", share:x=>`${x[1]}: ${x[2]}`, asc:false};
  return {head:["#","Jugador","Al objetivo","Palo","Fecha"], row:(r,i)=>[i+1,r.p,fmtDist(r.v),r.club&&CLUBS[r.club]?CLUBS[r.club].name:"",fmtDate(r.at)], note:"En el range: a qué distancia quedó la bola del objetivo (objetivos desde 40 m).", share:x=>`${x[1]}: ${x[2]}`, asc:true}; }
function localRows(sp){ let L=board[rankCat].slice(); if(rankCat==="rounds") L=L.filter(r=>r.c===sp.c.id && (r.sel||"all")===sp.sel);
  L.sort(sp.asc?(a,b)=>a.v-b.v||a.at-b.at:(a,b)=>b.v-a.v||a.at-b.at); return L.slice(0,20); }
async function loadOnline(sp){ const key=[rankCat,sp.c?sp.c.id:"",sp.sel||""].join("|");
  if(rankCache[key] && Date.now()-rankCache[key].at<60000) return rankCache[key].rows;
  const rows=await SL.Online.top({kind:RANK_CATS[rankCat].online, course:rankCat==="rounds"?sp.c.id:null, sel:rankCat==="rounds"?sp.sel:null, asc:sp.asc, limit:50});
  const out=rows.map(x=>({p:x.player, v:x.value, d:x.par_diff, c:x.course, sel:x.sel, src:x.src, club:x.club, at:Date.parse(x.created_at), pid:x.pid}));
  rankCache[key]={at:Date.now(), rows:out}; return out; }
function renderPlayers(){
  $("players").innerHTML=players.map(p=>`<button class="pchip" data-p="${encodeURIComponent(p)}" aria-pressed="${p===S.player}">${esc(p)}${players.length>1?`<span class="x" data-del="1" aria-label="Quitar">×</span>`:""}</button>`).join("");
  $("players").querySelectorAll(".pchip").forEach(b=>b.addEventListener("click",e=>{ const p=decodeURIComponent(b.dataset.p);
    if(e.target.dataset.del){ players=players.filter(x=>x!==p); if(!players.length) players=["Yo"]; if(S.player===p) setPlayer(players[0]); store.set("sl10_players",players); renderRank(); return; }
    setPlayer(p); })); }
function setPlayer(p){ if(p===S.player) return; S.player=p; saveSettings(); builtHole="";
  course=validRound(rounds[roundKey()])?rounds[roundKey()]:null;
  if(mode==="course"){ if(!course) newRound(); else setupHole(true); }
  renderRank(); renderCourses(); renderScore(); say(`Juega ${p}.`); }
$("addPlayer").addEventListener("click",()=>{ const v=cleanName($("newPlayer").value); if(!v) return;
  if(!players.includes(v)){ players.push(v); store.set("sl10_players",players); } $("newPlayer").value=""; setPlayer(v); renderRank(); });
$("newPlayer").addEventListener("keydown",e=>{ if(e.key==="Enter") $("addPlayer").click(); });
const cleanName=v=>String(v||"").replace(/[<>"]/g,"").replace(/\s+/g," ").trim().slice(0,18);
// renombrar al jugador actual: las rondas y marcas guardadas pasan al nuevo nombre (su identificador en línea se conserva)
function renamePlayer(oldN,newN){ if(oldN===newN) return;
  players=players.map(x=>x===oldN?newN:x).filter((x,i,a)=>a.indexOf(x)===i); store.set("sl10_players",players);
  for(const k of Object.keys(rounds)){ const parts=k.split("|"); if(parts[2]===oldN){ parts[2]=newN; rounds[parts.join("|")]=rounds[k]; delete rounds[k]; } } store.set("sl8_rounds",rounds);
  for(const cat of Object.keys(board)) board[cat].forEach(e=>{ if(e.p===oldN) e.p=newN; }); saveBoard();
  if(pids[oldN] && !pids[newN]){ pids[newN]=pids[oldN]; } delete pids[oldN]; store.set("sl12_pids",pids);
  if(S.player===oldN) S.player=newN; saveSettings(); }
// nombre obligatorio: aparece en el ranking en línea
function askName(force){ if(S.nameSet && !force) return; $("nameIn").value=S.nameSet?S.player:""; $("nameErr").textContent=""; $("nameModal").hidden=false; setTimeout(()=>{ try{ $("nameIn").focus(); }catch(_){} },50); }
$("nameOk").addEventListener("click",()=>{ const v=cleanName($("nameIn").value);
  if(v.length<2){ $("nameErr").textContent="Escribe tu nombre (al menos 2 letras)."; return; }
  const old=S.player; if(old!==v){ if(players.includes(v) && S.nameSet){ setPlayer(v); } else renamePlayer(old,v); }
  S.nameSet=true; saveSettings(); $("nameModal").hidden=true; renderAll(); renderRank(); renderCourses(); SL.Online.flush(); });
$("nameIn").addEventListener("keydown",e=>{ if(e.key==="Enter") $("nameOk").click(); });
$("renameBtn").addEventListener("click",()=>askName(true));
function renderRank(){
  renderPlayers(); $("meName").textContent=S.player;
  const on=SL.Online.configured();
  $("rankScope").innerHTML=[["online","🌎 En línea"],["local","📱 Este teléfono"]].map(([k,n])=>`<button data-k="${k}" aria-pressed="${k===rankScope}">${n}</button>`).join("");
  $("rankScope").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{ rankScope=b.dataset.k; renderRank(); }));
  $("rankTabs").innerHTML=Object.entries(RANK_CATS).map(([k,v])=>`<button class="pchip" data-t="${k}" aria-pressed="${k===rankCat}">${v.name}</button>`).join("");
  $("rankTabs").querySelectorAll(".pchip").forEach(b=>b.addEventListener("click",()=>{ rankCat=b.dataset.t; renderRank(); }));
  const sp=rankSpec();
  $("rankFilters").hidden=rankCat!=="rounds";
  if(rankCat==="rounds"){ $("rankCourse").innerHTML=SL.COURSES.map(c=>`<option value="${c.id}" ${c.id===sp.c.id?"selected":""}>${c.name}</option>`).join("");
    $("rankSel").hidden=sp.c.n<=9; $("rankSel").innerHTML=["front","back","all"].map(k=>`<option value="${k}" ${k===sp.sel?"selected":""}>${SEL_NAME[k]}</option>`).join(""); }
  $("rankHead").innerHTML="<tr>"+sp.head.map(h=>`<th>${h}</th>`).join("")+"</tr>";
  const draw=(L,note)=>{ $("rankBody").innerHTML=L.length?L.map((r,i)=>{ const x=sp.row(r,i); return `<tr class="${(rankScope==="online"?r.pid===pids[S.player]:r.p===S.player)?"me":""}">`+x.map(v=>`<td>${esc(v)}</td>`).join("")+"</tr>"; }).join("")
      :`<tr><td colspan="${sp.head.length}" class="note">Aún no hay registros${rankScope==="online"?" en línea":""}. Los golpes de prueba no cuentan.</td></tr>`; $("rankNote").textContent=note; };
  if(rankScope==="local" || !on){
    draw(localRows(sp), (!on && rankScope==="online") ? "El ranking en línea todavía no está conectado: por ahora ves los registros de este teléfono. "+sp.note : sp.note);
    if(!on && rankScope==="online") $("rankNote").textContent="🌎 El ranking en línea todavía no está conectado en esta versión. Mientras tanto ves los registros de este teléfono. "+sp.note;
  } else {
    $("rankBody").innerHTML=`<tr><td colspan="${sp.head.length}" class="note">Cargando el ranking en línea…</td></tr>`;
    loadOnline(sp).then(L=>{ if(rankSpec().head.join()===sp.head.join()) draw(L, sp.note+(SL.Online.pending()?` · ${SL.Online.pending()} puntaje(s) tuyos por enviar.`:"")); })
      .catch(()=>{ draw(localRows(sp), "Sin conexión con el ranking en línea: muestro los de este teléfono. "+sp.note); });
  }
  // récords en tarjetas (de este teléfono)
  const best=(L,f)=>L.length?L.reduce((a,b)=>f(b,a)?b:a):null;
  const r=best(board.rounds,(a,b)=>a.d<b.d||(a.d===b.d&&a.at<b.at)), dr=best(board.drives,(a,b)=>a.v>b.v), spd=best(board.speeds,(a,b)=>a.v>b.v), px=best(board.prox,(a,b)=>a.v<b.v);
  const tile=(lab,val,sub)=>`<div><span>${lab}</span><strong>${val}</strong><small>${esc(sub)}</small></div>`;
  $("podium").innerHTML=tile("Mejor ronda", r?vsPar(r.d):"—", r?`${r.p} · ${SL.courseById(r.c).name}`:"Termina una ronda")+
    tile("Drive más largo", dr?fmtDist(dr.v):"—", dr?dr.p:"Pega con el driver")+
    tile("Swing más rápido", spd?fmtSpeed(spd.v).v+" "+fmtSpeed(spd.v).u:"—", spd?`${spd.p} · driver`:"Mide un swing con el driver")+
    tile("Más cerca", px?fmtDist(px.v):"—", px?`${px.p} · range`:"Apunta en el range");
}
$("rankCourse").addEventListener("change",e=>{ rankCourse=e.target.value; rankSel=null; renderRank(); });
$("rankSel").addEventListener("change",e=>{ rankSel=e.target.value; renderRank(); });
$("rankShare").addEventListener("click",async()=>{ const sp=rankSpec(); let L=localRows(sp);
  if(rankScope==="online" && SL.Online.configured()) try{ L=await loadOnline(sp); }catch(_){}
  const title=RANK_CATS[rankCat].name+(rankCat==="rounds"?` · ${sp.c.name}${sp.c.n>9?" · "+SEL_NAME[sp.sel]:""}`:"");
  const text=`Swing Lab · ${title}\n`+(L.length?L.slice(0,5).map((r,i)=>{ const x=sp.row(r,i); return `${x[0]}. ${sp.share(x)}`; }).join("\n"):"Aún sin registros")+"\n¿Me superas?";
  const url=location.href.split("#")[0];
  try{ if(navigator.share){ await navigator.share({title:"Swing Lab · Ranking", text, url}); return; } }catch(_){ return; }
  try{ await navigator.clipboard.writeText(text+"\n"+url); msg("Ranking copiado: pégalo en tu chat."); }catch(_){ msg(text); } });
$("rankClear").addEventListener("click",()=>{ $("rankClearConfirm").hidden=false; });
$("rankClearNo").addEventListener("click",()=>{ $("rankClearConfirm").hidden=true; });
$("rankClearYes").addEventListener("click",()=>{ board={rounds:[],drives:[],speeds:[],prox:[]}; saveBoard(); $("rankClearConfirm").hidden=true; renderRank(); });
$("toRank").addEventListener("click",()=>{ rankCat="rounds"; rankCourse=courseId; rankSel=null; setMode("rank"); window.scrollTo({top:0,behavior:"smooth"}); });

// ================= Panel de datos =================
function css(v){ return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
function postureTips(po){ const t=[];
  if(po.dtl){
    if(po.spine<22) t.push(`En el address estás muy erguido (columna a ${po.spine}°): inclínate desde la cadera, unos 35 a 40°.`);
    else if(po.spine>55) t.push(`En el address estás muy inclinado hacia la bola (${po.spine}°).`);
    if(po.hipThrust>=6 || po.spineChg<=-8) t.push(`<em>Te levantas en la bajada</em> (extensión temprana): tu cadera se acerca ${Math.max(0,po.hipThrust)} cm a la bola y la columna se endereza ${Math.max(0,-po.spineChg)}°. Mantén la inclinación hasta el impacto.`);
    else t.push(`Mantuviste la inclinación de la columna hasta el impacto (${po.spineChg>0?"+":""}${po.spineChg}°): muy bien.`);
    if(Math.abs(po.headDrop)>=7) t.push(`Tu cabeza ${po.headDrop>0?"bajó":"subió"} ${Math.abs(po.headDrop)} cm en el impacto.`);
    if(po.loop!=null){ const L=Math.abs(po.loop);
      if(po.loop>=5) t.push(`<em>Bajada por encima:</em> tus manos bajaron ${L} cm por fuera del camino de la subida. Es lo que suele dar ruta de afuera hacia adentro (slice o pull): empieza la bajada con la cadera y deja caer los brazos antes de girar.`);
      else if(po.loop<=-7) t.push(`<em>Bajada muy por dentro:</em> tus manos bajaron ${L} cm por dentro de la subida. Ayuda al draw, pero si se pasa da push o hook.`);
      else t.push(`Tu bajada siguió ${po.loop<0?"por dentro de":"casi el mismo camino que"} la subida (${po.loop>0?"+":""}${po.loop} cm): buen plano.`); }
    if(po.planeTop>15) t.push("Arriba las manos quedan por fuera de la línea del plano (azul): la subida es muy vertical.");
    else if(po.planeTop<-15) t.push("Arriba las manos quedan muy por detrás de la línea del plano (azul): la subida es muy plana.");
    return t; }
  if(Math.abs(po.head)>=8) t.push(`Tu cabeza se movió ${Math.abs(po.head)} cm ${po.head>0?"hacia el objetivo":"hacia atrás"} antes del impacto: intenta mantenerla quieta.`);
  if(po.sway<=-10) t.push(`Tu cadera se deslizó ${-po.sway} cm hacia atrás en la subida: gira sin desplazarte.`);
  if(po.shTurn<60) t.push(`Giraste los hombros unos ${po.shTurn}°: un giro más completo da más distancia.`);
  else if(po.shTurn>=75) t.push(`Buen giro de hombros (unos ${po.shTurn}°).`);
  return t; }
// Ángulo de ataque según el palo: con el driver se pega subiendo, con hierros y wedges bajando
const sgn=a=>(a>0?"+":"")+a.toFixed(0)+"°";
function aoaTip(h){ if(!h.aoaOk) return null; const c=h.club, a=h.aoa, low=h.lowCm;
  const lowTxt=low==null?"":Math.abs(low)<2?" Tu punto bajo quedó justo debajo del centro de tu postura.":` Tu punto bajo quedó ${Math.abs(low)} cm ${low>0?"delante":"detrás"} del centro de tu postura.`;
  const ideal={driver:[1,6], wood3:[-2,2], hybrid:[-3,1], iron5:[-5,-1], iron7:[-6,-2], iron9:[-7,-2], wedge:[-8,-3], gw:[-8,-3], sw:[-9,-3], lw:[-9,-3]}[c]||[-5,0];
  const name=CLUBS[c].name;
  if(a>=ideal[0] && a<=ideal[1]) return `<em>Ataque ${sgn(a)}</em>: justo lo que pide el ${name}.`+lowTxt;
  if(c==="driver") return `<em>Ataque ${sgn(a)}</em>: con el driver conviene pegar subiendo (+2° a +5°). Pon la bola frente al talón del pie delantero y deja el punto bajo detrás de ella.`+lowTxt;
  if(a>ideal[1]) return `<em>Ataque ${sgn(a)}</em>: con el ${name} vas subiendo y el punto bajo queda detrás de la bola. Lleva el peso al pie delantero en la bajada para pegar primero la bola y luego el pasto.`+lowTxt;
  return `<em>Ataque ${sgn(a)}</em>: muy hacia abajo para el ${name}; te costará distancia y harás divots profundos. Pon la bola un poco más adelante.`+lowTxt; }
function verdictFor(h){
  const p=[];
  if(h.ratio==null) p.push("Medí la velocidad, pero no pude separar la subida de la bajada para calcular el tempo.");
  else if(h.ratio>=2.6 && h.ratio<=3.4) p.push("<em>Tempo de libro.</em> Cerca del 3:1 de los profesionales.");
  else if(h.ratio<2.6) p.push("<em>Subida apurada.</em> Lleva el palo arriba más lento y deja que la bajada acelere.");
  else p.push("<em>Subida muy lenta</em> o pausa arriba. Busca un ritmo continuo.");
  if(h.arcTop!=null){ p.push(h.len==="completo"?`Swing completo: ${h.arcTop}° de subida y ${h.arcFin}° de final.`:h.len==="tres cuartos"?`Tres cuartos de swing (${h.arcTop}° de subida).`:(isWedge(h.club)?`Medio swing (${h.arcTop}° de subida).`:`Medio swing (${h.arcTop}° de subida): para pegar más lejos, sube más el palo.`));
    if(h.arcFin!=null && h.arcFin<h.arcTop*0.6) p.push("Frenaste el final: termina el swing con las manos arriba."); }
  if(isWedge(h.club) && clockOf(h) && !h.example){ const k=clockOf(h), cell=wedgeMatrix()[h.club]&&wedgeMatrix()[h.club][k];
    if(cell) p.push(`<em>Swing ${clockAt(k)}</em> con el ${CLUBS[h.club].name}: en tu matriz vuela ${fmtDist(cell.carry)} de carry${cell.n?` (${cell.n} swing${cell.n>1?"s":""})`:" (estimado)"}.`); }
  const sh=shapeName(h); if(sh) p.push(h.faceOk?`<em>${sh}.</em> Cara ${fmtFace(h).toLowerCase()}`+(h.pathOk?`, ruta ${fmtPath(h).toLowerCase()}.`:"."):`<em>${sh}.</em>`);
  if(h.sat) p.push(h.method==="fit"?"El sensor topó y reconstruí el pico.":"El sensor topó: tu velocidad real es mayor que esta.");
  if(h.source==="camera"){ const at=aoaTip(h); if(at) p.push(at);
    if(h.hand){ const hs=fmtSpeed(h.hand); p.push(`Tus manos llegaron a ${hs.v} ${hs.u} en la bajada (un golfista promedio anda por ${fmtSpeed(8.9).v} y los más rápidos del tour pasan de ${fmtSpeed(12.8).v}).`);
      if(h.view==="front" && !["730","900"].includes(clockOf(h)) && h.handDrop!=null && h.handPeakMs!=null && h.handPeakMs>-35 && h.handPeakMs<230){
        if(h.handDrop<0.06) p.push("Tus manos casi no frenaron antes del impacto: en un swing eficiente las manos frenan justo antes de la bola para que la cabeza del palo las adelante.");
        else p.push(`Tus manos llegaron a su máximo ${Math.max(0,h.handPeakMs)} ms antes del impacto y frenaron un ${Math.round(h.handDrop*100)}% al llegar a la bola: ese freno es el que suelta el palo (en los jugadores hábiles el máximo llega unos 50 ms antes).`); } }
    if(h.impSrc==="sonido") p.push("El impacto lo marcó el sonido del golpe (más exacto que la imagen).");
    else if(h.heard){ const c=SL.Sound.calib(); if(!c.ok) p.push(`Oí el golpe: con ${Math.max(1,3-c.n)} golpe${3-c.n>1?"s":""} más la app aprende a sincronizar el sonido con la imagen.`); }
    if(h.posture) p.push(...postureTips(h.posture));
    if(h.posture && h.posture.dtl){ const sp=[h,...history.filter(x=>x.id!==h.id && x.source==="camera" && x.posture && x.posture.dtl).slice(0,5)].map(x=>x.posture.spine);
      if(sp.length>=4){ const m=sp.reduce((a,b)=>a+b,0)/sp.length, sd=Math.sqrt(sp.reduce((a,b)=>a+(b-m)**2,0)/sp.length);
        p.push(sd<=3?`Tu inclinación en el address se repite muy bien entre swings (±${sd.toFixed(0)}°): repetirla es de lo que más se relaciona con el puntaje.`:`Tu inclinación en el address cambia ±${sd.toFixed(0)}° entre swings: repetirla es de lo que más se relaciona con el puntaje; usa siempre la misma rutina de preparación.`); } }
    if(h.camQ && h.camQ.level!=="alta") p.push(`Lectura de la cámara ${h.camQ.level}: ${h.camQ.why[0]||"revisa la luz y el encuadre"}.`);
    p.push(h.pathOk?`Con la cámara se estima la ruta (${fmtPath(h).toLowerCase()}) y la cara se asume cuadrada al objetivo: la curva del tiro sale de tu ruta${h.view==="front"?"; desde atrás la ruta se ve mejor":""}.`:"Con la cámara la dirección sale recta: no pude estimar la ruta en este swing."); }
  if(h.shot && h.shot!=="normal"){ const want=SL.SHOTS[h.shot].name, got=shapeName(h);
    if((h.shot==="draw"||h.shot==="fade") && h.faceOk && got) p.push(got.toLowerCase().includes(h.shot)?`<em>Te salió el ${want.toLowerCase()} que buscabas.</em>`:`Buscabas un ${want.toLowerCase()} y tu swing dio ${got.toLowerCase()}: la app suma tu error al efecto que elegiste.`);
    else p.push(`Golpe ${want.toLowerCase()} elegido.`); }
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
  // con la cámara no hay cara ni ruta: se muestran el ángulo de ataque y la velocidad de las manos
  const cam=h.source==="camera"; $("faceLab").textContent=cam?"Ataque":"Cara"; $("pathLab").textContent=cam&&h.pathOk?"Ruta (estimada)":cam?"Manos (máx.)":"Ruta";
  $("face").textContent=cam?(h.aoaOk?sgn(h.aoa):"—"):fmtFace(h); $("path").textContent=cam&&!h.pathOk?(h.hand?fmtSpeed(h.hand).v+" "+fmtSpeed(h.hand).u:"—"):fmtPath(h);
  $("carry").textContent=fmtDist(dv.carry);
  $("clubLab").textContent=CLUBS[h.club].name; const ck=calibKind(h.club,srcOf(h)); $("calibTag").textContent=ck?"· calibrado con "+ck:"";
  if(h.source==="camera"){ const hs=fmtSpeed(h.hand||0);
    $("quality").textContent=(h.camQ?`Lectura de cámara ${h.camQ.level} · `:"")+`${h.hz} cuadros por segundo`+(h.shutter?` · obturador ${h.shutter}`:"")+(h.impSrc==="sonido"?" · impacto por sonido":h.heard?" · oí el golpe":"")+` · manos ${hs.v} ${hs.u} (máx.)`+(h.arm?` · brazo ${Math.round(h.arm*100)} cm`:"")+(h.aoaOk?` · ataque ${sgn(h.aoa)}`:"")+` · lanzamiento ${dv.launch.toFixed(0)}° · spin ${Math.round(dv.spin/100)*100} rpm.`+(h.hz<45?" Con 60 cuadros por segundo la medición es más precisa.":""); }
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
  drawKeys(); const tr=shown && shown.trace; if(!tr) return; drawSwingViz();
  const ink=css("--ink"), mut=css("--muted"), acc=css("--accent"), line=css("--line");
  const usePhi=!!tr.phi; const D=usePhi?tr.phi.map(v=>v??0):tr.d;
  let lo=0, hi=0; D.forEach(v=>{ lo=Math.min(lo,v); hi=Math.max(hi,v); });
  const T=tr.t[tr.t.length-1]||1, pad=16, top0=34, x=t=>pad+t/T*(W-2*pad), y=v=>top0+(hi-v)/(hi-lo||1)*(H-top0-30);
  // franjas de fase: subida y bajada, con su duración
  let lastEnd=-1e9; const band=(i0,i1,col,alpha,label)=>{ if(i0==null||i1==null||i1<=i0) return; const x0=x(tr.t[i0]), x1=x(tr.t[i1]); c.globalAlpha=alpha; c.fillStyle=col; c.fillRect(x0,top0-14,x1-x0,H-top0-12); c.globalAlpha=1;
    c.fillStyle=ink; c.font="600 11px "+css("--body"); const tw=c.measureText(label).width; let lx=(x0+x1)/2-tw/2; if(tw>x1-x0) lx=x1+4; lx=Math.max(lx,lastEnd+8); lx=Math.min(lx,W-pad-tw); c.textAlign="left"; c.fillText(label,lx,13); lastEnd=lx+tw; };
  const dur=(a,b)=>((tr.t[b]-tr.t[a])/1000).toFixed(2)+" s";
  band(tr.start,tr.top,mut,0.12,"subida "+(tr.start!=null&&tr.top!=null?dur(tr.start,tr.top):""));
  band(tr.top,tr.imp,acc,0.2,"bajada "+(tr.top!=null&&tr.imp!=null?dur(tr.top,tr.imp):""));
  c.strokeStyle=line; c.lineWidth=1; c.beginPath(); c.moveTo(pad,y(0)); c.lineTo(W-pad,y(0)); c.stroke();
  const seg=(a,b,col)=>{ c.strokeStyle=col; c.lineWidth=2.5; c.lineJoin="round"; c.beginPath(); for(let i=a;i<=b;i++){ const X=x(tr.t[i]),Y=y(D[i]); i===a?c.moveTo(X,Y):c.lineTo(X,Y);} c.stroke(); };
  const top=tr.top ?? 0; seg(0,top,mut); seg(top,tr.d.length-1,acc);
  c.fillStyle=ink; c.font="13px "+css("--body"); c.textAlign="center";
  const mark=(i,ch,dy)=>{ if(i!=null) c.fillText(ch,x(tr.t[i]),y(D[i])+dy); }; mark(tr.start,"▲",16); mark(tr.top,"●",usePhi?-8:16); mark(tr.imp,"★",usePhi?16:-8); if(tr.fin!=null) mark(tr.fin,"■",16);
  if(shown.ratio){ const txt="tempo "+fmtRatio(shown.ratio); c.font="700 12px "+css("--body"); const tw=c.measureText(txt).width+12; c.fillStyle=css("--deep"); c.fillRect(W-pad-tw,H-20,tw,17); c.fillStyle=css("--deep-ink"); c.textAlign="right"; c.fillText(txt,W-pad-6,H-7); }
  c.fillStyle=mut; c.font="11px "+css("--body"); c.textAlign="left"; c.fillText(usePhi?"ángulo de las manos (°) en el tiempo":"giro °/s",pad,H-6);
}
// ---- gráficas ----
const pcache=new Map();
function derivePts(h){ const dv=derive(h), key=h.id+"|"+dv.ms.toFixed(3)+"|"+S.hand+"|"+SL.env.alt+"|"+(h.shot||""); if(pcache.has(key)) return pcache.get(key);
  const sim=SL.simulateLocal(launch(h.club,dv.ms,h,"tee"),[0,0],null), out={fl:sim.pts.filter(q=>q.t<=sim.landT+1e-6), roll:sim.pts.filter(q=>q.t>=sim.landT-1e-6)};
  pcache.set(key,out); if(pcache.size>150) pcache.clear(); return out; }
function canvasFor(id){ const cv=$(id); if(!cv || cv.closest("[hidden]")) return null; const dpr=window.devicePixelRatio||1, W=cv.clientWidth, H=cv.clientHeight; if(!W||!H) return null;
  cv.width=W*dpr; cv.height=H*dpr; const c=cv.getContext("2d"); c.setTransform(dpr,0,0,dpr,0,0); c.clearRect(0,0,W,H); return {cv,c,W,H}; }
const fieldShots=()=>{ const cur=shown && shown.club===club?shown:null; const prev=history.filter(h=>h.club===club && (!cur || h.id!==cur.id)).slice(0,20); return {cur, prev, all:cur?[cur,...prev]:prev}; };
let rangeHits=[], rangePick=null;
function drawField(){
  const g=canvasFor("range"); if(!g) return; const {c,W,H}=g;
  const ink=css("--ink"), mut=css("--muted"), acc=css("--accent"), line=css("--line"), surf=css("--surface");
  c.fillStyle=css("--rough"); c.fillRect(0,0,W,H);
  const {cur,prev,all}=fieldShots(); const dvs=all.map(derive);
  const maxD=Math.max(120,...dvs.map(d=>d.total))*1.12, tee={x:W/2,y:H-20}, sc=(H-40)/maxD;
  // si los tiros quedan muy juntos de lado, el ancho se amplía (hasta ×3) y se avisa en la esquina
  const maxLat=Math.max(12,...dvs.map(d=>Math.abs(d.lat)))*1.25, ex=Math.max(1,Math.min(3,(W/2-24)/maxLat/sc)), sx=sc*ex;
  const X=lat=>Math.max(6,Math.min(W-6,tee.x+lat*sx)), Y=d=>tee.y-d*sc;
  // calle con franjas de corte
  const fw=18; c.save(); c.beginPath(); c.moveTo(X(-5),tee.y+12); c.lineTo(X(5),tee.y+12); c.lineTo(X(fw),Y(maxD*0.6)); c.lineTo(X(fw+4),0); c.lineTo(X(-fw-4),0); c.lineTo(X(-fw),Y(maxD*0.6)); c.closePath(); c.fillStyle=css("--fairway"); c.fill(); c.clip();
  c.fillStyle="rgba(255,255,255,0.10)"; for(let d=0; d<maxD; d+=20){ c.fillRect(0,Y(d+10),W,10*sc); } c.restore();
  // tee
  c.fillStyle=css("--green"); c.fillRect(tee.x-12,tee.y-4,24,10);
  const um=S.dist==="yd"?0.9144:1, ul=S.dist==="yd"?" yd":" m", step=maxD/um>180?50:25;
  c.strokeStyle=line; c.lineWidth=1; c.fillStyle=mut; c.font="11px "+css("--body"); c.textAlign="left";
  for(let dd=step; dd*um<maxD; dd+=step){ const R=dd*um*sc; c.beginPath(); c.ellipse(tee.x,tee.y,R*ex,R,0,-Math.PI*0.78,-Math.PI*0.22); c.stroke();
    const lx=tee.x+R*ex*Math.cos(-Math.PI*0.78), ly=tee.y+R*Math.sin(-Math.PI*0.78); if(ly>10) c.fillText(dd+ul,Math.max(4,lx-2),ly-3); }
  if(ex>1.15){ c.fillStyle=mut; c.font="11px "+css("--body"); c.textAlign="right"; c.fillText(`ancho ×${ex.toFixed(1)}`,W-8,14); }
  // dispersión: promedio y elipse de una desviación
  if(all.length>=3){ const n=dvs.length, mT=dvs.reduce((a,d)=>a+d.total,0)/n, mL=dvs.reduce((a,d)=>a+d.lat,0)/n;
    const sT=Math.sqrt(dvs.reduce((a,d)=>a+(d.total-mT)**2,0)/n), sL=Math.sqrt(dvs.reduce((a,d)=>a+(d.lat-mL)**2,0)/n);
    c.save(); c.setLineDash([5,4]); c.strokeStyle=ink; c.globalAlpha=0.55; c.lineWidth=1.5; c.beginPath(); c.ellipse(X(mL),Y(mT),Math.max(4,sL*sx),Math.max(4,sT*sc),0,0,Math.PI*2); c.stroke();
    c.globalAlpha=0.06; c.fillStyle=ink; c.fill(); c.restore();
    c.strokeStyle=ink; c.lineWidth=1.5; c.beginPath(); c.moveTo(X(mL)-5,Y(mT)); c.lineTo(X(mL)+5,Y(mT)); c.moveTo(X(mL),Y(mT)-5); c.lineTo(X(mL),Y(mT)+5); c.stroke();
    const right=X(mL)<W*0.5, lx=right?X(mL)+Math.max(4,sL*sx)+8:X(mL)-Math.max(4,sL*sx)-8;
    c.fillStyle=ink; c.font="600 11px "+css("--body"); c.textAlign=right?"left":"right"; c.fillText(`prom. ${fmtDist(mT)}`, lx, Y(mT)+4);
    c.fillStyle=mut; c.font="11px "+css("--body"); c.fillText(`±${fmtDist(sT)} largo · ±${fmtDist(sL)} lado`, lx, Y(mT)+18); }
  // vuelos vistos desde arriba
  rangeHits=[];
  const trace=(h,col,w,alpha)=>{ const P=derivePts(h); c.save(); c.globalAlpha=alpha; c.strokeStyle=col; c.lineWidth=w; c.lineCap="round";
    c.beginPath(); P.fl.forEach((q,k)=>{ const x=X(q.x), y=Y(Math.hypot(q.x,q.z)); k?c.lineTo(x,y):c.moveTo(x,y); }); c.stroke();
    if(P.roll.length>1){ c.setLineDash([2,4]); c.beginPath(); P.roll.forEach((q,k)=>{ const x=X(q.x), y=Y(Math.hypot(q.x,q.z)); k?c.lineTo(x,y):c.moveTo(x,y); }); c.stroke(); }
    c.restore(); const dv=derive(h); return {x:X(dv.lat), y:Y(dv.total), dv}; };
  prev.slice().reverse().forEach(h=>{ const p=trace(h,mut,1.2,0.45); c.fillStyle=mut; c.beginPath(); c.arc(p.x,p.y,3.5,0,Math.PI*2); c.fill(); rangeHits.push({h,...p}); });
  c.fillStyle=ink; c.beginPath(); c.arc(tee.x,tee.y,3,0,Math.PI*2); c.fill();
  if(cur){ const p=trace(cur,acc,2.75,1); c.fillStyle=acc; c.strokeStyle=surf; c.lineWidth=2; c.beginPath(); c.arc(p.x,p.y,6.5,0,Math.PI*2); c.fill(); c.stroke(); rangeHits.push({h:cur,...p});
    c.fillStyle=ink; c.font="600 12px "+css("--body"); c.textAlign=p.x>W*0.6?"right":"left";
    c.fillText(fmtDist(p.dv.total)+" · "+fmtLat(p.dv.lat)+(cur.example?" · ejemplo":""), p.x+(p.x>W*0.6?-10:10), Math.max(14,p.y-8)); }
  const pk=rangePick && rangeHits.find(r=>r.h.id===rangePick); if(pk){ c.strokeStyle=ink; c.lineWidth=2; c.beginPath(); c.arc(pk.x,pk.y,9,0,Math.PI*2); c.stroke(); }
}
$("range").addEventListener("click",e=>{ const r=$("range").getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top;
  let best=null, bd=26; for(const q of rangeHits){ const d=Math.hypot(q.x-x,q.y-y); if(d<bd){ bd=d; best=q; } }
  rangePick=best?best.h.id:null; const h=best&&best.h, dv=best&&best.dv, sp=h&&fmtSpeed(dv.ms);
  $("rangeTip").textContent = h ? `${CLUBS[h.club].name} · ${sp.v} ${sp.u} · carry ${fmtDist(dv.carry)} · total ${fmtDist(dv.total)} · ${fmtLat(dv.lat)}`+(shapeName(h)?` · ${shapeName(h)}`:"")+` · altura ${Math.round(dv.apex)} m` : "Toca un tiro para ver sus datos.";
  drawField(); drawSide(); });
// vuelo visto de lado
function drawSide(){
  const g=canvasFor("side"); if(!g) return; const {c,W,H}=g; const ink=css("--ink"), mut=css("--muted"), acc=css("--accent"), line=css("--line");
  const {cur,prev,all}=fieldShots(); if(!all.length){ c.fillStyle=mut; c.font="12px "+css("--body"); c.textAlign="center"; c.fillText("La vista de lado aparece con tu primer tiro",W/2,H/2); return; }
  const dvs=all.map(derive), maxD=Math.max(120,...dvs.map(d=>d.total))*1.05, maxH=Math.max(12,...dvs.map(d=>d.apex))*1.3;
  const L=34, B=20, X=d=>L+d/maxD*(W-L-10), Y=hh=>H-B-hh/maxH*(H-B-10);
  c.strokeStyle=line; c.lineWidth=1; c.fillStyle=mut; c.font="11px "+css("--body"); c.textAlign="right";
  const hs=maxH>45?20:10; for(let hh=hs; hh<maxH; hh+=hs){ c.beginPath(); c.moveTo(L,Y(hh)); c.lineTo(W-10,Y(hh)); c.stroke(); c.fillText(hh+" m",L-4,Y(hh)+4); }
  c.strokeStyle=mut; c.beginPath(); c.moveTo(L,Y(0)); c.lineTo(W-10,Y(0)); c.stroke();
  const um=S.dist==="yd"?0.9144:1, ul=S.dist==="yd"?" yd":" m", step=maxD/um>180?50:25; c.textAlign="center";
  for(let dd=step; dd*um<maxD; dd+=step) c.fillText(dd+ul, X(dd*um), H-5);
  const arc=(h,col,w,alpha)=>{ const P=derivePts(h); c.save(); c.globalAlpha=alpha; c.strokeStyle=col; c.lineWidth=w; c.beginPath();
    P.fl.forEach((q,k)=>{ const x=X(Math.hypot(q.x,q.z)), y=Y(q.y); k?c.lineTo(x,y):c.moveTo(x,y); }); c.stroke();
    if(P.roll.length>1){ c.setLineDash([2,4]); c.beginPath(); P.roll.forEach((q,k)=>{ const x=X(Math.hypot(q.x,q.z)), y=Y(Math.max(0,q.y)); k?c.lineTo(x,y):c.moveTo(x,y); }); c.stroke(); } c.restore(); };
  prev.slice().reverse().forEach(h=>arc(h,mut,1.2,0.4));
  const sel=(rangePick && all.find(h=>h.id===rangePick)) || cur;
  if(sel){ arc(sel,acc,2.5,1); const dv=derive(sel), P=derivePts(sel); let ap=P.fl[0]; P.fl.forEach(q=>{ if(q.y>ap.y) ap=q; });
    const ax=X(Math.hypot(ap.x,ap.z)), ay=Y(ap.y); c.fillStyle=acc; c.beginPath(); c.arc(ax,ay,4,0,Math.PI*2); c.fill();
    c.fillStyle=ink; c.font="600 11px "+css("--body"); c.textAlign="center"; c.fillText(`altura ${Math.round(dv.apex)} m`, ax, Math.max(12,ay-8));
    const lx=X(dv.carry); c.fillStyle=acc; c.beginPath(); c.arc(lx,Y(0),3.5,0,Math.PI*2); c.fill(); c.fillStyle=ink; c.textAlign=lx>W*0.8?"right":"center";
    c.fillText(`carry ${fmtDist(dv.carry)} · ${dv.launch.toFixed(0)}° de salida`, Math.min(lx,W-12), Y(0)-7); }
}
// velocidad de cada swing con este palo (del más viejo al más nuevo)
function drawTrend(){
  const g=canvasFor("trend"); if(!g) return; const {c,W,H}=g; const ink=css("--ink"), mut=css("--muted"), acc=css("--accent"), line=css("--line");
  const mine=history.filter(h=>h.club===club).slice(0,30).reverse(); const u=fmtSpeed(1).u;
  if(mine.length<2){ c.fillStyle=mut; c.font="12px "+css("--body"); c.textAlign="center"; c.fillText("Con 2 swings o más verás tu tendencia de velocidad",W/2,H/2); return; }
  const v=mine.map(h=>toUnit(derive(h).ms)), n=v.length, m=v.reduce((a,b)=>a+b,0)/n, sd=Math.sqrt(v.reduce((a,b)=>a+(b-m)**2,0)/n);
  let lo=Math.min(...v,m-sd), hi=Math.max(...v,m+sd); const pad=(hi-lo)*0.15+1; lo-=pad; hi+=pad;
  const L=36, R=12, T=14, B=18, X=i=>L+(n===1?0.5:i/(n-1))*(W-L-R), Y=y=>T+(hi-y)/(hi-lo)*(H-T-B);
  c.fillStyle=ink; c.globalAlpha=0.06; c.fillRect(L,Y(m+sd),W-L-R,Y(m-sd)-Y(m+sd)); c.globalAlpha=1;
  c.strokeStyle=line; c.lineWidth=1; c.fillStyle=mut; c.font="11px "+css("--body"); c.textAlign="right";
  [lo+pad, (lo+hi)/2, hi-pad].forEach(y=>{ c.fillText(y.toFixed(0),L-4,Y(y)+4); });
  c.setLineDash([5,4]); c.strokeStyle=mut; c.beginPath(); c.moveTo(L,Y(m)); c.lineTo(W-R,Y(m)); c.stroke(); c.setLineDash([]);
  c.strokeStyle=ink; c.globalAlpha=0.75; c.lineWidth=2; c.beginPath(); v.forEach((y,i)=>i?c.lineTo(X(i),Y(y)):c.moveTo(X(i),Y(y))); c.stroke(); c.globalAlpha=1;
  const bi=v.indexOf(Math.max(...v)); v.forEach((y,i)=>{ c.fillStyle=i===bi?acc:ink; c.beginPath(); c.arc(X(i),Y(y),i===bi||i===n-1?4.5:2.5,0,Math.PI*2); c.fill(); });
  c.strokeStyle=css("--surface"); c.lineWidth=2; c.beginPath(); c.arc(X(n-1),Y(v[n-1]),4.5,0,Math.PI*2); c.stroke();
  c.fillStyle=ink; c.font="600 11px "+css("--body"); c.textAlign=X(bi)>W*0.7?"right":"left"; c.fillText(`mejor ${v[bi].toFixed(0)} ${u}`, X(bi)+(X(bi)>W*0.7?-8:8), Math.max(11,Y(v[bi])-6));
  c.fillStyle=mut; c.font="11px "+css("--body"); c.textAlign="left"; c.fillText(`prom. ${m.toFixed(0)} ±${sd.toFixed(0)} ${u}`, L+4, H-4); c.textAlign="right"; c.fillText(`${n} swings · último →`, W-R, H-4);
}
// distancias por palo: carry + rodado, con el rango de tus tiros
function drawGaps(){
  const cv=$("gaps"); if(!cv || cv.closest("[hidden]")) return; const keys=Object.keys(CLUBS).filter(k=>history.some(h=>h.club===k));
  const rowH=30, top=8; cv.style.height=(keys.length?keys.length*rowH+top+16:60)+"px"; const g=canvasFor("gaps"); if(!g) return; const {c,W,H}=g;
  const ink=css("--ink"), mut=css("--muted"), line=css("--line");
  if(!keys.length){ c.fillStyle=mut; c.font="12px "+css("--body"); c.textAlign="center"; c.fillText("Aquí verás cuánto pega cada palo",W/2,H/2); return; }
  const rows=keys.map(k=>{ const d=history.filter(h=>h.club===k).slice(0,30).map(derive); const n=d.length, mc=d.reduce((a,x)=>a+x.carry,0)/n, mt=d.reduce((a,x)=>a+x.total,0)/n;
    return {k, n, mc, mt, lo:Math.min(...d.map(x=>x.total)), hi:Math.max(...d.map(x=>x.total))}; });
  const maxD=Math.max(...rows.map(r=>r.hi))*1.08, L=74, R=10, X=d=>L+d/maxD*(W-L-R);
  const um=S.dist==="yd"?0.9144:1, step=maxD/um>180?50:25; c.strokeStyle=line; c.lineWidth=1; c.fillStyle=mut; c.font="10px "+css("--body"); c.textAlign="center";
  for(let dd=step; dd*um<maxD; dd+=step){ c.beginPath(); c.moveTo(X(dd*um),top); c.lineTo(X(dd*um),H-14); c.stroke(); c.fillText(String(dd),X(dd*um),H-3); }
  rows.forEach((r,i)=>{ const y=top+i*rowH, bh=14, by=y+(rowH-bh)/2-2;
    c.fillStyle=ink; c.font=(r.k===club?"700 ":"500 ")+"12px "+css("--body"); c.textAlign="left"; c.fillText(CLUBS[r.k].name,4,by+bh-2);
    const rr=(x0,x1,col)=>{ c.fillStyle=col; c.beginPath(); const w=Math.max(2,x1-x0); if(c.roundRect) c.roundRect(x0,by,w,bh,[0,4,4,0]); else c.rect(x0,by,w,bh); c.fill(); };
    rr(X(0),X(r.mc),css("--green")); if(r.mt>r.mc+0.5) rr(X(r.mc)+2,X(r.mt),css("--fairway"));
    if(r.n>1){ c.strokeStyle=ink; c.globalAlpha=0.6; c.lineWidth=1.5; const wy=by+bh+4; c.beginPath(); c.moveTo(X(r.lo),wy); c.lineTo(X(r.hi),wy); c.moveTo(X(r.lo),wy-3); c.lineTo(X(r.lo),wy+3); c.moveTo(X(r.hi),wy-3); c.lineTo(X(r.hi),wy+3); c.stroke(); c.globalAlpha=1; }
    c.fillStyle=ink; c.font="600 11px "+css("--body"); const lab=`${fmtDist(r.mt)}`, tx=X(r.mt)+6; c.textAlign=tx>W-40?"right":"left"; c.fillText(lab, tx>W-40?X(r.mt)-6:tx, by+bh-3);  });
}
function drawKeys(){ const cv=$("keyFrames"); if(!cv) return; const ok=!!(lastPose && shown && lastPose.id===shown.id && SL.Cam && SL.Cam.keyFrames);
  cv.hidden=!ok; if(!ok || cv.closest("[hidden]")) return; SL.Cam.keyFrames({poseFrames:lastPose.poseFrames, marks:lastPose.marks, posture:lastPose.posture}, cv, lastPose.mirror); }
function drawCharts(){ drawTrace(); drawField(); drawSide(); drawTrend(); drawGaps(); }
function renderCalib(){
  const u=fmtSpeed(1).u; $("radarUnit").textContent=u;
  if(lastReal){ const v=toUnit(lastReal.msRaw); $("calibLast").textContent=`Último swing (${CLUBS[lastReal.club].name}, con ${srcOf(lastReal)==="camera"?"la cámara":"el sensor"}), sin calibrar: ${v.toFixed(S.units==="ms"?1:0)} ${u}. ¿Cuánto marcó el radar?`; }
  const mc=myCarry[club], nReal=realOf(club,S.input).length;
  $("myCarryIn").value = mc ? (S.dist==="yd"?Math.round(mc/0.9144):Math.round(mc)) : ""; $("myKindSel").value=myKind[club]||"carry"; $("myCarryUnit").textContent=S.dist==="yd"?"yd":"m"; $("myCarryClub").textContent=CLUBS[club].name;
  $("myCarryState").textContent = !mc ? `Escribe cuánto pega normalmente tu ${CLUBS[club].name} y si es carry (vuelo) o total.` :
     nReal<3 ? `Guardado. Haz ${3-nReal} swing${3-nReal>1?"s":""} real${3-nReal>1?"es":""} más con el ${CLUBS[club].name} usando ${S.input==="camera"?"la cámara":"el sensor"} para ajustar.` :
     radarOf(club,S.input).length ? "Este palo ya está calibrado con radar; el radar tiene prioridad." : `Ajustado para ${S.input==="camera"?"la cámara":"el sensor"}: tu swing típico con el ${CLUBS[club].name} ahora vuela ${fmtDist(mc)}.`;
  const p=radarOf(club,S.input), ck=calibKind(club,S.input), via=S.input==="camera"?"la cámara":"el sensor";
  $("calibState").textContent=p.length?`${CLUBS[club].name} con ${via}: ${p.length} swing${p.length>1?"s comparados":" comparado"} con el radar, factor ${factor(club,S.input).toFixed(2)}.`+(p.length<3?" Agrega algunos más para que sea confiable.":"")
    : ck==="tus otros palos" ? `${CLUBS[club].name} con ${via}: sin radar propio; usa lo calibrado con tus otros palos (factor ${factor(club,S.input).toFixed(2)}).` : `${CLUBS[club].name} con ${via}: sin calibrar.`;
}
// Tipos de golpe
function buildShots(){ const row=$("shotRow"); row.innerHTML=Object.entries(SL.SHOTS).map(([k,v])=>`<button class="chip sm" data-shot="${k}" aria-pressed="false">${v.name}</button>`).join("");
  row.querySelectorAll(".chip").forEach(b=>b.addEventListener("click",()=>{ S.shot=b.dataset.shot; saveSettings(); renderShots(); suggestClub(); renderAim(); })); }
function renderShots(){ const eff=shotFor(club); document.querySelectorAll("#shotRow .chip").forEach(b=>{ const k=b.dataset.shot, w=SL.SHOTS[k].wedges && !(isWedge(club)||club==="iron9");
  b.disabled=w; b.setAttribute("aria-pressed",String(k===eff)); b.title=w?"Solo con hierro 9, PW o SW":""; }); $("shotRow").hidden=mode==="data"||mode==="rank"; }
// Calibración rápida: tu distancia típica con el driver y dónde juegas (altura)
function renderQuick(){ const card=$("quickCal"); if(!card) return; const need=!clubFactor("driver",S.input) && !S.qcDone && mode!=="rank";
  card.hidden=!need; $("qcUnit").textContent=S.dist==="yd"?"yd":"m"; $("qcAlt").value=String(S.alt||0);
  if(myCarry.driver){ $("qcDist").value=S.dist==="yd"?Math.round(myCarry.driver/0.9144):Math.round(myCarry.driver); $("qcKind").value=myKind.driver||"carry"; }
  const n=realOf("driver",S.input).length; $("qcState").textContent=myCarry.driver?(n<3?`Guardado. Haz ${3-n} swing${3-n>1?"s":""} real${3-n>1?"es":""} con el driver usando ${S.input==="camera"?"la cámara":"el sensor"} para ajustar.`:""):""; }
function buildChips(){ const row=$("clubRow"); row.innerHTML=Object.keys(CLUBS).filter(inBag).map(k=>`<button class="chip" data-club="${k}" aria-pressed="false">${CLUBS[k].name}</button>`).join("");
  row.querySelectorAll(".chip").forEach(b=>b.addEventListener("click",()=>{ setClub(b.dataset.club); renderHud(); })); }
function renderChips(){ renderShots(); renderQuick(); document.querySelectorAll("#clubRow .chip").forEach(x=>{ x.setAttribute("aria-pressed",String(x.dataset.club===club));
  const old=x.querySelector(".sug"); if(old) old.remove();
  if((mode==="course"||mode==="range") && suggested===x.dataset.club){ const s=document.createElement("span"); s.className="sug"; s.textContent="Sugerido"; x.appendChild(s); } });
  // centra el palo elegido en su fila sin mover la página (antes la página saltaba hacia abajo en pleno vuelo de la bola)
  const cur=document.querySelector('#clubRow .chip[aria-pressed="true"]'), row=$("clubRow"); if(cur && row) try{ row.scrollTo({left:cur.offsetLeft-(row.clientWidth-cur.offsetWidth)/2, behavior:"smooth"}); }catch(_){} 
  document.querySelectorAll("#distSeg button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.d===S.dist))); }
function renderAll(){ if(typeof renderAim==="function" && $("aimBar")) renderAim(); renderBoard(shown,false); renderHist(); drawCharts(); renderWedges(); renderDrill(); renderCalib(); renderChips(); renderHud(); renderScore(); drawMini(); }

// ================= Resultado de un swing =================
function handleResult(res){
  lastPeakSeen = res.obs ?? res.peak ?? lastPeakSeen;
  if(res.error){ $("board").classList.add("stale"); setVerdict(res.error); beep(220,0.25); say("No reconocí el swing"); updateLive(); return; }
  const {rawSamples,poseFrames,marks,...h}=res; h.shot=shotFor(h.club);
  if(poseFrames){ lastPose={id:h.id, poseFrames,marks,posture:h.posture, mirror:S.camFacing==="user"}; $("replayBtn").hidden=false; } else if(!h.sim) { lastPose=null; $("replayBtn").hidden=true; }
  if(S.invert && !h.sim){ h.face=-h.face; h.path=-h.path; }
  if(!h.sim && h.club==="driver") addEntry("speeds",{v:+derive(h).ms.toFixed(2), src:srcOf(h)});
  if(!h.sim){ history.unshift(h); history=history.slice(0,300); store.set("sl2_hist",history);
    traces.unshift({id:h.id, club:h.club, hz:h.hz, s:rawSamples}); traces=traces.slice(0,25); store.set("sl2_traces",traces); lastReal=h; }
  shown=h; drillShot(h); renderBoard(h,true); setVerdict(verdictFor(h)); renderHist(); drawCharts(); renderWedges(); renderCalib(); updateLive();
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
let camBig=false, camHold=false;
const camIsBig=()=>S.input==="camera" && camState==="on" && !$("camBox").hidden && $("camBox").classList.contains("big");
// La cámara va pequeña sobre el campo (ves el campo y apuntas) o en grande; en Datos siempre en grande
function camLayer(on,noResume){
  const box=$("camBox"), rep=SL.Cam.replaying(), show=(on!==false && S.input==="camera" && SL.Cam.on) || rep;
  const big=rep || camBig || mode==="data" || mode==="rank" || !has3D;
  box.hidden=!show; box.classList.toggle("big",big); box.classList.toggle("pip",!big); $("view").classList.toggle("pipOn",show && !big);
  box.classList.toggle("paused",!!SL.Cam.paused && !rep);
  $("camVideo").hidden=!!window.__camMock || rep; $("camCanvas").hidden=false;
  $("camSize").hidden=mode==="data" || !has3D || rep; $("camSize").textContent=big?"▣":"⤢"; $("camSize").setAttribute("aria-label",big?"Ver el campo":"Agrandar la cámara");
  $("camPause").hidden=rep; $("camPause").textContent=camHold?"▶":"⏸";
  // flecha hacia el objetivo según dónde está la cámara, si la imagen va en espejo y si eres diestro o zurdo
  { const mirror=S.camFacing==="user", lead=S.hand==="L"?-1:1, screen=(mirror?-1:1)*lead, big2=big;
    $("camTgt").textContent=S.camView==="behind"?(big2?"🎯 Objetivo ↑ al fondo":"🎯 ↑"):(screen<0?(big2?"🎯 ← Objetivo":"🎯 ←"):(big2?"Objetivo → 🎯":"→ 🎯"));
    $("camTgt").hidden=rep; $("camTgt").style.left=screen>0&&S.camView!=="behind"?"auto":""; $("camTgt").style.right=screen>0&&S.camView!=="behind"?(big2?"12px":"72px"):""; } $("camPause").setAttribute("aria-label",camHold?"Seguir leyendo swings":"Pausar la lectura");
  if(show && mode==="data") $("view").hidden=false;
  // al volver al address después de un tiro, se reanuda la lectura
  if(has3D) World.idleFps = !show || aimMode ? 0 : big ? 3 : 15;
  if(!noResume && show && !rep && SL.Cam.paused && !camHold && !aimMode && !World.busy()){ SL.Cam.flash("",null,0); SL.Cam.pause(false,900); }
  renderAim(); }
// al pegar: la cámara se queda pequeña para ver el vuelo y deja de leer hasta el siguiente address
function camShot(){ if(camState!=="on") return; SL.Cam.pause(true); SL.Cam.flash("Mira tu tiro…","wait",1e7); camBig=false; camLayer(true,true); }
function camStatus(text,kind){ const m=$("camMsg"); m.textContent=text||""; m.className="camMsg "+(kind||""); m.hidden=!text;
  $("camBox").classList.toggle("ready",kind==="ready");
  const st=$("status"); st.className="pill"+(kind==="ready"?" ready":kind==="bad"?" wait":" on"); if(text) st.textContent=kind==="ready"?"Listo":kind==="bad"?"Sin cuerpo":SL.Cam.paused?"En pausa":"Cámara"; }
function showGuide(){ $("guideSide").textContent=S.hand==="L"?"a tu derecha (eres zurdo)":"a tu izquierda (eres diestro)"; $("camGuide").hidden=false; }
$("guideOk").addEventListener("click",()=>{ $("camGuide").hidden=true; store.set("sl11_guide",true); });
$("guideShow").addEventListener("click",showGuide);
$("camBox").addEventListener("click",e=>{ e.stopPropagation(); if(SL.Cam.replaying() || mode==="data" || mode==="rank" || !has3D) return; camBig=!camBig; camLayer(true); });
$("camSize").addEventListener("click",e=>{ e.stopPropagation(); camBig=!camBig; camLayer(true); });
$("camPause").addEventListener("click",e=>{ e.stopPropagation(); camHold=!camHold;
  if(camHold){ SL.Cam.pause(true); SL.Cam.flash("En pausa · toca ▶ para seguir","wait",600000); }
  else { SL.Cam.flash("",null,0); SL.Cam.pause(false,4000,"Ponte en posición"); say("Ponte en posición."); }
  camLayer(true); });
// un intento que no se pudo medir: aviso corto en la cámara, sin dejar la pantalla trabada
function camError(res){
  const soft=["slow","short","noback"].includes(res.code);
  SL.Cam.flash(soft?"Eso no pareció un swing completo":res.error, "bad", soft?2200:4000);
  if(!soft){ beep(220,0.2); say(res.code==="noimp"?"No vi el impacto. Termina el swing dentro de la imagen.":"No pude medir ese swing."); }
  if(mode==="data"){ setVerdict(res.error); }
}
async function camStart(){
  msg(""); audio(); say(" ");
  if(window.top!==window){ msg("Dentro de Claude no se puede usar la cámara. Abre la app publicada o usa Golpe de prueba.",true); return; }
  if(!SL.Cam.supported() && !window.__camMock){ msg("Este navegador no permite usar la cámara. Prueba con Safari o Chrome.",true); return; }
  if(!has3D || mode==="data") $("view").hidden=false;
  $("go").textContent="Iniciando cámara…"; $("go").className="go live"; camHold=false; camBig=false;
  $("camBox").hidden=false; $("camBox").classList.add("pip"); $("camVideo").hidden=!!window.__camMock;
  if(!store.get("sl11_guide",false)) showGuide();
  const ok=await SL.Cam.start({facing:S.camFacing, model:S.camModel, view:S.camView, sound:S.camSound==="on", audioCtx:audio(), shutter:S.camShutter, onStatus:camStatus, onReady:()=>{ if(S.guide) playRhythm(); else beep(880,0.08); },
    onView:v=>{ if(S.camView===v) return; S.camView=v; saveSettings(); $("camView").value=v; SL.Cam.setView(v); camLayer(true,true);
      SL.Cam.flash(v==="behind"?"Te veo de perfil: uso la vista desde atrás":"Te veo de frente: uso la vista de frente","wait",2600); say(v==="behind"?"Te veo de perfil. Uso la vista desde atrás.":"Te veo de frente."); },
    onSwing:frames=>{ if(World.busy() || aimMode) return; const po={grip:S.camGrip, view:S.camView, shutter:SL.Cam.shutter};
      let res=SL.analyzePose(frames, club, po);
      if(res.error){ camError(res); return; }
      // segunda pasada con el impacto que oyó el micrófono (más exacto que el cuadro de video)
      if(SL.Sound && SL.Sound.on){ const hit=SL.Sound.impactFor(res);
        if(hit){ if(hit.t!=null){ const r2=SL.analyzePose(frames, club, Object.assign({tImpact:hit.t, tImpactSrc:hit.src},po)); if(!r2.error) res=r2; } res.heard=true; } }
      res.model=SL.Cam.model; res.camFps=SL.Cam.camFps; res.shutter=SL.Cam.shutterTxt||null; res.mic=!!SL.Cam.mic;
      if(mode==="data"||mode==="rank"||!has3D){ SL.Cam.pause(true); setTimeout(()=>{ if(camState==="on" && !camHold) SL.Cam.pause(false,600); camLayer(true); },1800); }
      handleResult(res); }});
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
$("replayBtn").addEventListener("click",e=>{ e.stopPropagation(); if(!lastPose) return; World.skip(); const was=SL.Cam.paused; if(camState==="on") SL.Cam.pause(true);
  $("camMsg").hidden=true; SL.Cam.replay(lastPose,0.3,()=>{ if(camState==="on" && !was && !camHold) SL.Cam.pause(false,1200); camLayer(camState==="on"); }); camLayer(true); });
$("go").addEventListener("click",()=>{
  if(S.input==="camera"){ if(camState==="on") camStop(); else camStart(); return; }
  if(phase==="off") return enable();
  if(phase==="idle"){ audio(); keepAwake(); readyBeeped=false; cooldownUntil=performance.now()+400; setPhase("armed"); msg(""); return; }
  setPhase("idle");
});
function updateLive(){ const el=$("live");
  if(S.input==="camera"){ if(camState!=="on"){ el.hidden=true; return; } el.hidden=false; el.textContent=`Cámara a ${SL.Cam.fps||"—"} cuadros por segundo`+(SL.Cam.model?` · detector ${SL.Cam.model==="full"?"preciso":"rápido"}${SL.Cam.detectMs?` (${SL.Cam.detectMs} ms)`:""}`:"")+(SL.Cam.speed!=null?` · manos: ${SL.Cam.speed.toFixed(1)} torsos/s (se dispara en 2,2)`:""); return; }
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
    for(let i=0;i<20;i++){ const mid=(lo+hi)/2, s=SL.simulateLocal(launch(club,mid,{shot:shotFor(club)},lie),[0,0],null); if(Math.hypot(s.x,s.z)<target) lo=mid; else hi=mid; }
    ms=(lo+hi)/2*(1+gauss()*0.05);
  } else ms=c.def*(0.92+Math.random()*0.16);
  const full=c.def*0.85, frac=Math.min(1,ms/full);
  if(S.input==="camera"){ const hand=ms/factor(club,"camera")/SL.camRatio(club,0.62,S.camGrip)*1.05;
    const ideal={driver:3, wood3:0, hybrid:-1, iron5:-3, iron7:-4, iron9:-4.5, wedge:-5, gw:-5, sw:-5, lw:-5}[club]??-3, aoa=(ideal+gauss()*2)*DEG, shift=-Math.sin(aoa)*(0.62+(SL.CLUB_LEN[club]||1))+(SL.BALL_POS[club]||0);
    const res=SL.analyzePose(SL.synthPose({fps:30, handSpeed:hand, hand:S.hand, shift, path:gauss()*4, top:85+frac*85+gauss()*6, finish:95+frac*85, back:640+frac*220+gauss()*40, down:290+gauss()*15, sway:Math.max(0,gauss()*6), head:gauss()*4, turn:60+frac*25}), club, {grip:S.camGrip, view:S.camView});
    if(!res.error) res.sim=true; handleResult(res); return; }
  const peak=SL.omegaFor(club, ms/factor(club), S.hold)*1.005;
  const res=SL.analyze(SL.synthKin({hz:100, peak, face:gauss()*2.5, path:gauss()*3.5, hand:S.hand, top:110+frac*140+gauss()*8, finish:120+frac*140, back:640+frac*200+gauss()*40, down:255+gauss()*15}), club, {mode:S.hold, hand:S.hand});
  if(!res.error) res.sim=true; handleResult(res);
}
$("testShot").addEventListener("click",testShot);
$("view").addEventListener("click",e=>{
  if(World.busy() || World.flying()){ World.skip(); return; }
  if(!has3D || mode==="data" || mode==="rank" || SL.Cam.replaying() || camIsBig()) return;
  if(mode==="course" && course && (course.holed||course.done)) return;
  const p=World.pick(e.clientX,e.clientY); if(!p) return;
  const o=aimOrigin(); if((p.x-o.x)*Math.sin(aimYaw())+(p.z-o.z)*Math.cos(aimYaw())<3 && !aimMode) return;   // no apuntar hacia atrás
  setAim(p); });
$("aimGo").addEventListener("click",e=>{ e.stopPropagation(); toggleAimView(!aimMode); });
$("aimL").addEventListener("click",e=>{ e.stopPropagation(); nudgeAim(1.5); });
$("aimR").addEventListener("click",e=>{ e.stopPropagation(); nudgeAim(-1.5); });
$("aimPin").addEventListener("click",e=>{ e.stopPropagation(); if(course){ course.aim=null; course.auto=routeAim(); saveCourse(); World.setAim(aimPoint()); World.address(course.ball.x,course.ball.z,aimYaw(),false); suggestClub(); renderAim(); drawMini(); } });

// ================= Modos y controles =================
function setClub(c,silent){ club=c; if(has3D) World.setGolfer({club:c}); store.set("sl2_club",club); $("clubLab").textContent=CLUBS[club].name; if(!silent) renderAll(); else renderChips(); }
function setMode(m){
  mode=m; store.set("sl3_mode",mode); applyAlt();
  document.querySelectorAll(".mode").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.mode===m)));
  document.querySelectorAll("[data-for]").forEach(s=>s.hidden=s.dataset.for!==m);
  document.body.classList.toggle("m-rank",m==="rank");
  $("view").hidden=m==="rank" || ((m==="data"||!has3D) && !(S.input==="camera" && camState==="on")); $("board").classList.toggle("compact",m!=="data"); $("mini").hidden=m!=="course";
  $("card").hidden=true; setHudMsg(null); $("holeTip").hidden=true; $("skip").hidden=true; if(aimMode){ aimMode=false; } renderDrill();
  if(has3D) World.setActive(m!=="data" && m!=="rank");
  if(m==="range") setupRange();
  else if(m==="course"){ if(!course) newRound(); else { builtHole=""; setupHole(false); } renderCourses(); renderScore(); }
  else if(m==="rank") renderRank();
  else { drawCharts(); }
  if(camState==="on"){ if(m==="rank"){ SL.Cam.pause(true); } camLayer(m!=="rank"); }
  suggestClub(); renderAll();
}
document.querySelectorAll(".mode").forEach(b=>b.addEventListener("click",()=>setMode(b.dataset.mode)));
function selectTab(name){ document.querySelectorAll(".tab").forEach(t=>t.setAttribute("aria-selected",String(t.dataset.tab===name)));
  document.querySelectorAll(".panel").forEach(p=>p.hidden=p.dataset.panel!==name); drawCharts(); renderWedges(); }
document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click",()=>selectTab(t.dataset.tab)));
$("nextHole").addEventListener("click",nextHole);
$("newRound").addEventListener("click",()=>{ $("card").hidden=true; setHudMsg(null); newRound(); });
$("playRhythm").addEventListener("click",playRhythm);
const bindSel=(id,key,after)=>{ $(id).value=S[key]; $(id).addEventListener("change",e=>{ S[key]=e.target.value; saveSettings(); dcache.clear(); renderAll(); after&&after(); }); };
const bindChk=(id,key)=>{ $(id).checked=S[key]; $(id).addEventListener("change",e=>{ S[key]=e.target.checked; saveSettings(); }); };
function setDist(d){ S.dist=d; saveSettings(); $("dist").value=d; dcache.clear(); renderAll(); if(mode==="range") setupRange(); }
bindSel("units","units"); bindSel("dist","dist",()=>{ if(mode==="range") setupRange(); }); bindSel("hand","hand",()=>{ if(camState==="on") camLayer(true,true); if(has3D) World.setGolfer({hand:S.hand}); }); bindSel("guideRatio","guideRatio"); bindSel("hold","hold");
bindSel("camFacing","camFacing",()=>{ if(camState==="on"){ camStop(); camStart(); } }); bindSel("camGrip","camGrip"); bindSel("camView","camView",()=>{ if(camState==="on"){ camStop(); camStart(); } });
bindSel("camModel","camModel",()=>{ if(camState==="on"){ camStop(); camStart(); } });
bindSel("sgBase","sgBase",()=>renderStats());
document.querySelectorAll("#statScope button").forEach(b=>b.addEventListener("click",()=>{ statScope=b.dataset.s; document.querySelectorAll("#statScope button").forEach(x=>x.setAttribute("aria-pressed",String(x===b))); renderStats(); }));
bindSel("bag","bag",()=>{ if(!inBag(club)) setClub("wedge",true); if(drill && !inBag(drill.c)) stopDrill(); buildChips(); suggestClub(); renderAll(); });
$("wedgeAuto").addEventListener("click",()=>startDrill(null,null,true));
bindSel("camSound","camSound",()=>{ if(camState==="on"){ camStop(); camStart(); } }); bindSel("camShutter","camShutter",()=>{ if(camState==="on"){ camStop(); camStart(); } });
bindSel("alt","alt",()=>{ S.alt=+S.alt||0; saveSettings(); applyAlt(); fcache.clear(); dcache.clear(); renderAll(); });
bindChk("voice","voice"); bindChk("ambient","ambient"); $("ambient").addEventListener("change",()=>{ if(S.ambient) ambientStart(); else ambientStop(); }); bindChk("cont","cont"); bindChk("guide","guide"); bindChk("invert","invert");
document.querySelectorAll("#distSeg button").forEach(b=>b.addEventListener("click",()=>setDist(b.dataset.d)));
$("qcSave").addEventListener("click",()=>{ const v=parseFloat($("qcDist").value);
  S.alt=+$("qcAlt").value||0; $("alt").value=String(S.alt);
  if(!(v>40 && v<420)){ msg("Escribe cuánto pegas con el driver.",true); saveSettings(); return; }
  myCarry.driver=S.dist==="yd"?v*0.9144:v; myKind.driver=$("qcKind").value; store.set("sl5_mycarry",myCarry); store.set("sl11_mykind",myKind);
  saveSettings(); applyAlt(); fcache.clear(); dcache.clear(); msg(""); renderAll(); });
$("qcLater").addEventListener("click",()=>{ S.qcDone=true; saveSettings(); renderQuick(); });
$("myCarrySave").addEventListener("click",()=>{ const v=parseFloat($("myCarryIn").value); myKind[club]=$("myKindSel").value; store.set("sl11_mykind",myKind);
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
  const src=srcOf(lastReal); calib[lastReal.club]=(calib[lastReal.club]||[]).concat({est:lastReal.msRaw,radar,src}).slice(-24); store.set("sl2_calib",calib);
  fcache.clear(); dcache.clear(); $("radarIn").value=""; msg("Guardado. Factor de "+CLUBS[lastReal.club].name+" con "+(src==="camera"?"la cámara":"el sensor")+": "+factor(lastReal.club,src).toFixed(2)+"."); renderAll(); });
$("calibReset").addEventListener("click",()=>{ calib[club]=(calib[club]||[]).filter(x=>(x.src||"sensor")!==S.input); store.set("sl2_calib",calib); fcache.clear(); dcache.clear(); renderAll(); });
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
window.addEventListener("resize",()=>{ if(has3D) World.resize(); drawCharts(); drawMini(); });

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
has3D = World.init($("sim")); if(has3D) World.setGolfer({hand:S.hand, club});
// el audio solo puede arrancar después de que la persona toca la pantalla
document.addEventListener("pointerdown",()=>{ if(S.ambient && !AMB.on) ambientStart(); },{passive:true});
if(!has3D) msg("Tu navegador no pudo cargar la vista 3D. La medición del swing sí funciona.",true);
buildChips(); buildShots(); applyAlt();
const ex=SL.analyze(SL.synthKin({hz:100,peak:1700,face:1.5,path:-1}),club,{mode:S.hold,hand:S.hand}); if(!ex.error){ const {rawSamples,...h}=ex; h.example=true; h.sim=true; shown=h; }
if(!store.get("sl5_intro",false)) $("intro").hidden=false;
if(!S.nameSet) askName();
if(window.top!==window){ $("expCsv").hidden=true; $("expJson").hidden=true; }
setClub(club,true); setMode(mode);
document.querySelectorAll("#inputSeg button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.i===S.input))); $("camHelp").hidden=S.input!=="camera"; if(S.input==="camera") setCamButton();
setVerdict("Swing de ejemplo. Activa los sensores para medir el tuyo, o toca Golpe de prueba para ver la simulación.");
if("serviceWorker" in navigator && location.protocol==="https:" && window.top===window) navigator.serviceWorker.register("sw.js").catch(()=>{});
window.__swingLab={SL, testShot, World, selectCourse, addEntry, selectSel, caddie:()=>caddieInfo, get course(){ return course; }, get courseId(){ return courseId; }};
})();
