// Swing Lab · interfaz, sensores y juego
(function(){
"use strict";
const SL=window.SL, CLUBS=SL.CLUBS, DEG=SL.DEG, World=SL.World;
const VERSION="0.10";
const $=id=>document.getElementById(id);
const store={ get(k,d){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):d; }catch(e){ return d; } },
              set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} } };
const S=Object.assign({units:"mph", dist:"m", hand:"R", hold:"phone", invert:false, input:"sensor", camFacing:"user", camGrip:"empty", camView:"front", camModel:"auto", voice:true, cont:true, guide:false, guideRatio:"24/8"}, store.get("sl2_settings",{}));
let club=store.get("sl2_club","driver"); if(!CLUBS[club]) club="driver";
let mode=store.get("sl3_mode","range"); if(!["range","course","data","rank"].includes(mode)) mode="range";
let calib=Object.assign(Object.fromEntries(Object.keys(CLUBS).map(k=>[k,[]])), store.get("sl2_calib",{}));
let myCarry=store.get("sl5_mycarry",{});
let history=store.get("sl2_hist",[]), traces=store.get("sl2_traces",[]), records=store.get("sl2_records",{});
let rangeMarks=store.get("sl3_rangeMarks",[]);
// campos: cada uno guarda su propia ronda en curso
// jugadores: varios pueden turnarse en el mismo teléfono; cada uno con su ronda en cada campo
let players=store.get("sl10_players",null); if(!Array.isArray(players)||!players.length) players=["Yo"];
if(!S.player || !players.includes(S.player)) S.player=players[0];
let rounds=store.get("sl8_rounds",null); if(!rounds){ rounds={}; const old=store.get("sl4_course",null); if(old) rounds.swinglab=old; }
for(const k of Object.keys(rounds)) if(!k.includes("|")){ rounds[k+"|"+players[0]]=rounds[k]; delete rounds[k]; }
const roundKey=(cid=courseId,p=S.player)=>cid+"|"+p;
let courseId=store.get("sl8_courseId","standrews"), CUR=SL.courseById(courseId); courseId=CUR.id;
let HOLES=CUR.holes;
const validRound=c=>c && c.hole>=0 && c.hole<HOLES.length && Array.isArray(c.wind) && c.wind.length===HOLES.length;
let course=validRound(rounds[roundKey()])?rounds[roundKey()]:null;
let board=Object.assign({rounds:[],drives:[],speeds:[],prox:[]}, store.get("sl10_board",{}));
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
// el radar se guarda por fuente (sensor o cámara); las entradas viejas sin fuente son del sensor
const radarOf=(c,src)=>(calib[c]||[]).filter(x=>(x.src||"sensor")===src);
function clubFactor(c,src){ const p=radarOf(c,src); if(p.length) return {f:median(p.map(x=>x.radar/x.est)), kind:"radar"};
  const mc=myCarry[c], mine=realOf(c,src).slice(0,12);
  if(!mc || mine.length<3) return null;
  const key=c+"|"+src+"|"+mc+"|"+mine.length+"|"+(mine[0]&&mine[0].id); if(fcache.has(key)) return fcache.get(key);
  let lo=5, hi=80; for(let i=0;i<24;i++){ const mid=(lo+hi)/2, sm=SL.simulateLocal(SL.launchFor(c,mid,null,"tee",S.hand),[0,0],null); if(sm.carry<mc) lo=mid; else hi=mid; }
  const r={f:Math.max(0.5,Math.min(2,((lo+hi)/2)/median(mine.map(h=>h.msRaw)))), kind:"distancias"}; fcache.set(key,r); return r; }
// un palo sin calibrar usa lo aprendido con tus otros palos (la diferencia entre palos ya la pone el modelo)
function factor(c,src="sensor"){ const own=clubFactor(c,src); if(own) return own.f;
  const o=Object.keys(CLUBS).filter(k=>k!==c).map(k=>clubFactor(k,src)).filter(Boolean).map(x=>x.f); return o.length?median(o):1; }
const calibKind=(c,src="sensor")=>{ const own=clubFactor(c,src); if(own) return own.kind; return Object.keys(CLUBS).some(k=>k!==c && clubFactor(k,src))?"tus otros palos":null; };
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
  if(mode==="course"&&course){ const h=HOLES[course.hole], auto=course.auto||{x:h.pinX,z:h.L};
    course.aim = Math.hypot(p.x-auto.x,p.z-auto.z)<1 ? null : Math.hypot(p.x-h.pinX,p.z-h.L)<1 ? {x:h.pinX,z:h.L} : {x:+p.x.toFixed(1),z:+p.z.toFixed(1)}; saveCourse(); suggestClub(); }
  else { rangeAim={x:+p.x.toFixed(1),z:+p.z.toFixed(1)}; store.set("sl7_rangeAim",rangeAim); }
  if(has3D){ World.setAim(aimPoint()); if(!aimMode) World.address(o.x,o.z,aimYaw(),false); }
  renderAim(); if(!quiet) beep(1200,0.03);
}
function renderAim(){ const d=aimDist(), o=aimOrigin(), p=aimPoint(); let side="";
  if(mode==="course"&&course){ const h=HOLES[course.hole], q=aimPoint(); side=Math.hypot(q.x-h.pinX,q.z-h.L)<1?" · al hoyo":course.aim?"":" · ruta"; }
  $("aimDist").textContent=`Objetivo ${fmtDist(d)}${side}`; $("aimGo").textContent=aimMode?"Listo":"🎯 Apuntar"; $("aimPin").hidden=!(mode==="course"&&course&&course.aim);
  $("aimBar").hidden=!has3D || mode==="data" || World.busy() || (mode==="course"&&course&&(course.holed||course.done)) || camIsBig(); void o; void p; }
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
function setupRange(){ if(!has3D) return; World.setRange({um:S.dist==="yd"?0.9144:1}); World.setMarks(rangeMarks); World.setAim(rangeAim); World.address(0,0,yawTo({x:0,z:0},rangeAim),true); renderAim(); }
function rangeShot(h){
  const dv=derive(h), sim=SL.simulateLocal(launch(h.club,dv.ms,h,"tee"),[0,0],null);
  if(aimMode) toggleAimView(false);
  const yaw=yawTo({x:0,z:0},rangeAim), pts=toWorld(sim.pts,0,0,yaw), seq=++shotSeq, fin=pts[pts.length-1], toT=Math.hypot(fin.x-rangeAim.x,fin.z-rangeAim.z);
  sfx.hit(); setHudMsg(null); $("card").hidden=true; $("skip").hidden=false; $("aimBar").hidden=true;
  camShot();
  World.playShot({pts, landT:sim.landT, onLand:sfx.land, onEnd:()=>{
    $("skip").hidden=true; rangeMarks.push({x:+fin.x.toFixed(1),z:+fin.z.toFixed(1)}); rangeMarks=rangeMarks.slice(-40); store.set("sl3_rangeMarks",rangeMarks);
    if(!h.sim){ rangeProx.push(+toT.toFixed(1)); rangeProx=rangeProx.slice(-30); store.set("sl7_rangeProx",rangeProx);
      const td=Math.hypot(rangeAim.x,rangeAim.z); if(td>=40) addEntry("prox",{v:+toT.toFixed(1), t:+td.toFixed(0), club:h.club});
      if(h.club==="driver") addEntry("drives",{v:+Math.hypot(fin.x,fin.z).toFixed(1), c:"range"}); }
    World.setMarks(rangeMarks); showCard(sim,toT); renderHud(); const sh=shapeName(h); setHudMsg(`A ${fmtDist(toT)} del objetivo`+(sh?` · ${sh}`:""));
    say(`A ${sayDist(toT)} del objetivo.`);
    setTimeout(()=>{ if(seq===shotSeq && !World.busy() && mode==="range"){ World.address(0,0,yawTo({x:0,z:0},rangeAim),true); camLayer(true); setHudMsg(null); $("card").hidden=true; renderAim(); } },3800); }});
}

// ================= Campo =================
const newWind=()=>{ const s=Math.random()<0.25?0:1+Math.random()*4.5, a=Math.random()*Math.PI*2; return {s, x:Math.sin(a)*s, z:Math.cos(a)*s}; };
const saveCourse=()=>{ if(course) rounds[roundKey()]=course; else delete rounds[roundKey()]; store.set("sl8_rounds",rounds); };
const recKey=()=>"c_"+courseId, recOf=id=>records["c_"+id] ?? (id==="swinglab"?records.course:null) ?? null;
function newRound(){ course={courseId, hole:0, ball:{x:0,z:0}, lie:"tee", strokes:0, scores:[], lines:[], wind:HOLES.map(newWind), holed:false, done:false};
  saveCourse(); setupHole(true); renderScore(); renderCourses(); }
const distToPin=()=>{ const h=HOLES[course.hole]; return Math.hypot(h.pinX-course.ball.x, h.L-course.ball.z); };
let builtHole="";
const allowedClubs=lie=>SL.CLUB_ORDER.filter(c=>c==="driver"?lie==="tee":c==="wood3"?(lie==="tee"||lie==="fairway"):(lie==="bunker"?["sw","wedge","iron9"].includes(c):true));
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
  if(best && (D(b,best)>=reach*0.6 || !far)) return best;
  if(far){ const p=toward(far,reach); if(safe(p)) return p; }
  return best||far;
}
let tipTimer=0;
function showTip(h){ const t=$("holeTip"); if(!h || !h.tip){ t.hidden=true; return; }
  t.innerHTML=`<b>Hoyo ${h.num} · ${h.name} · par ${h.par} · ${fmtDist(h.len)}</b>${h.tip}`; t.hidden=false; clearTimeout(tipTimer); tipTimer=setTimeout(()=>{ t.hidden=true; },10000); }
function setupHole(announce){
  if(!course.holed && !course.done) course.auto=routeAim();
  const key=courseId+":"+course.hole;
  if(has3D){ if(builtHole!==key || announce){ World.setHole(HOLES[course.hole]); builtHole=key; }
    World.setWind(course.wind[course.hole]); World.setLines(course.lines); World.setAim(aimPoint()); World.address(course.ball.x,course.ball.z,aimYaw(),true); }
  renderAim();
  suggestClub(); renderHud(); drawMini(); camLayer(true);
  if(announce){ const h=HOLES[course.hole], w=course.wind[course.hole];
    say(`${CUR.name}, hoyo ${h.num}: ${h.name}. Par ${h.par}, ${sayDist(h.len)}.`+(w.s>0.3?` Viento de ${Math.round(w.s)} metros por segundo.`:" Sin viento.")+(h.tip?" "+h.tip.split(". ")[0]+".":""));
    showTip(h); }
}
function expectedTotal(c,lie){ const mine=history.filter(h=>h.club===c && !h.sim), ms=mine.length?mine.slice(0,10).reduce((a,h)=>a+h.msRaw*factor(c,srcOf(h)),0)/Math.min(10,mine.length):CLUBS[c].def;
  const s=SL.simulateLocal(launch(c,ms,null,lie),[0,0],null); return Math.hypot(s.x,s.z); }
function suggestClub(){
  if(mode!=="course" || !course || course.holed){ suggested=null; renderChips(); return; }
  const R=aimDist(), opts=allowedClubs(course.lie).map(c=>({c,t:expectedTotal(c,course.lie)}));
  const cost=o=>o.t<R?(R-o.t)*1.3:(o.t-R);   // el más cercano, castigando un poco quedarse corto
  suggested=opts.reduce((a,o)=>cost(o)<cost(a)?o:a).c; if(suggested!==club) setClub(suggested,true); renderChips();
}
function puttsFor(d){ const r=Math.random(); if(d<1.5) return 1; if(d<3) return r<0.6?1:2; if(d<8) return r<0.15?1:(r<0.93?2:3); if(d<15) return r<0.05?1:(r<0.8?2:3); return r<0.6?2:3; }
const RESULT={"-3":"¡Albatros!","-2":"¡Eagle!","-1":"Birdie","0":"Par","1":"Bogey","2":"Doble bogey"};
function finishHole(text,voice){
  course.holed=true; course.scores[course.hole]=course.strokes; course.auto=null;
  if(course.hole===HOLES.length-1){ course.done=true; const tot=course.scores.reduce((a,b)=>a+b,0), par=CUR.par, dd=tot-par, rec=recOf(courseId);
    if(!course.sim && (rec==null || tot<rec)){ records[recKey()]=tot; store.set("sl2_records",records); voice+=" ¡Nuevo récord en "+CUR.name+"!"; }
    if(course.sim) text+=" · con golpes de prueba: no entra al ranking";
    else { const pos=addEntry("rounds",{v:tot, d:tot-par, c:courseId, sc:course.scores.slice()}); if(pos===1) voice+=" ¡Primer lugar del ranking!"; else if(pos<=3) voice+=` Quedas ${pos}º en el ranking.`; }
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
  const hole=HOLES[course.hole], yaw=aimYaw(), ox=course.ball.x, oz=course.ball.z, w=course.wind[course.hole], tgt=aimPoint();
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
  const seq=++shotSeq; sfx.hit(); setHudMsg(null); $("holeTip").hidden=true; $("card").hidden=true; $("skip").hidden=false; $("aimBar").hidden=true;
  camShot();
  World.playShot({pts, landT, onLand:()=>(endLie==="water"?sfx.splash():sfx.land()), onEnd:()=>{
    $("skip").hidden=true; showCard(card, Math.hypot(fx-tgt.x,fz-tgt.z));
    course.lines.push(line); World.setLines(course.lines);
    if(endLie==="water" || endLie==="ob"){
      course.strokes+=2; course.aim=null; let text, voice;
      if(endLie==="water"){ const wa=SL.waterAt(hole,wx,wz)||{kind:"pond"}, tx=WATER_TXT[wa.kind]||WATER_TXT.pond, d=SL.dropFor(hole,{x:ox,z:oz},{x:wx,z:wz});
        course.ball={x:+d.x.toFixed(1), z:+d.z.toFixed(1)}; const l=SL.lieAt(hole,d.x,d.z); course.lie=["water","ob","green"].includes(l)?"rough":l;
        text=`${tx[0]} +1 de penalidad`; voice=`${tx[1]} Un golpe de penalidad. Dropeas ${hole.drop?"en la zona de dropeo":"cerca de donde entró"}.`; }
      else { text="Fuera de límites · +1"; voice="Fuera de límites. Penalidad de un golpe. Juegas de nuevo desde el mismo sitio."; }
      setHudMsg(text); say(voice);
      if(course.strokes>=hole.par+5){ finishHole("Máximo de golpes · recoges la bola","Llegaste al máximo de golpes en este hoyo."); return; }
      saveCourse(); renderHud(); renderScore(); drawMini(); suggestClub();
      setTimeout(()=>{ if(seq===shotSeq && !World.busy()){ setHudMsg(null); setupHole(false); } },2800); return;
    }
    if(!h.sim && h.club==="driver") addEntry("drives",{v:+Math.hypot(fx-ox,fz-oz).toFixed(1), c:courseId});
    course.strokes+=1; course.ball={x:fx,z:fz}; course.lie=endLie; course.aim=null; drawMini();
    if(Math.hypot(tgt.x-hole.pinX,tgt.z-hole.L)>1) setTimeout(()=>{ if(seq===shotSeq) say(`A ${sayDist(Math.hypot(fx-tgt.x,fz-tgt.z))} del objetivo.`); },2200);
    const d=distToPin();
    if(d<0.3){ const diff=course.strokes-hole.par, name=course.strokes===1?"¡Hoyo en uno!":(RESULT[diff]||(diff>0?`+${diff}`:`${diff}`));
      sfx.cup(); finishHole(`¡Embocada! ${name}`, `¡Embocada! ${name}.`); return; }
    if(endLie==="green"){
      const n=puttsFor(d); setHudMsg(`${chip?"Chip · ":""}En el green a ${fmtDist(d)}`); say(`En el green a ${sayDist(d)}.`);
      setTimeout(()=>{ if(seq!==shotSeq) return; setHudMsg(null); $("card").hidden=true;
        World.playPutts({from:{x:fx,z:fz}, pin:{x:hole.pinX,z:hole.L}, n, onPutt:()=>sfx.putt(), onHole:()=>sfx.cup(), onEnd:()=>{
          course.strokes+=n; const diff=course.strokes-hole.par, name=RESULT[diff]||(diff>0?`+${diff}`:`${diff}`);
          course.ball={x:hole.pinX,z:hole.L}; finishHole(`${n} putt${n>1?"s":""} · ${name}`, `${n} putt${n>1?"s":""}. ${name}.`); }}); },1800);
      return;
    }
    if(course.strokes>=hole.par+5){ course.strokes+=1; finishHole("Máximo de golpes · recoges la bola","Llegaste al máximo de golpes en este hoyo."); return; }
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
function renderScore(){
  const tbl=$("scoreTbl"), par=CUR.par, rec=recOf(courseId);
  if(!course){ tbl.innerHTML=""; $("nextHole").hidden=true; $("courseNote").textContent=CUR.desc; return; }
  const cells=HOLES.map((h,i)=>{ const s=course.scores[i], cls=s==null?"":s<h.par?"sc-under":s>h.par?"sc-over":"";
    return `<td class="${i===course.hole&&!course.done?"sc-cur":""} ${cls}">${s??(i===course.hole&&course.strokes?course.strokes:"")}</td>`; }).join("");
  const tot=course.scores.reduce((a,b)=>a+(b||0),0);
  tbl.innerHTML=`<thead><tr><th>Hoyo</th>${HOLES.map(h=>`<th>${h.num}</th>`).join("")}<th>Total</th></tr></thead><tbody><tr><td>Par</td>${HOLES.map(h=>`<td>${h.par}</td>`).join("")}<td>${par}</td></tr><tr><td>Golpes</td>${cells}<td><b>${tot||"—"}</b></td></tr></tbody>`;
  $("nextHole").hidden=!(course.holed && !course.done);
  $("courseNote").textContent = course.done ? `Ronda terminada en ${CUR.name}: ${tot} golpes (${tot-par===0?"par del campo":tot-par>0?"+"+(tot-par):tot-par}).`+(rec?` Tu récord aquí: ${rec}.`:"")
    : CUR.desc+" Los putts se juegan solos según la distancia y el viento cambia en cada hoyo."+(rec?` Tu récord aquí: ${rec} golpes.`:"");
}
// Selector de campo
function renderCourses(){ const box=$("coursePick"); if(!box) return;
  box.innerHTML=SL.COURSES.map(c=>{ const r=rounds[roundKey(c.id)], rec=recOf(c.id), playing=r && !r.done && (r.hole>0||r.strokes>0);
    return `<button class="cp" data-c="${c.id}" aria-pressed="${c.id===courseId}"><span class="cp-tag">${c.style}</span><b>${c.name}</b><span>${c.place}</span>`+
      `<small>Hoyos ${c.holes.map(h=>h.num).join(" · ")} · par ${c.par}${rec?` · récord ${rec}`:""}${playing?` · en juego (hoyo ${c.holes[r.hole].num})`:""}</small></button>`; }).join("");
  box.querySelectorAll(".cp").forEach(b=>b.addEventListener("click",()=>selectCourse(b.dataset.c))); }
function selectCourse(id){
  if(World.busy()) return; const c=SL.courseById(id); if(c.id===courseId && course) return;
  courseId=c.id; CUR=c; HOLES=c.holes; store.set("sl8_courseId",courseId); builtHole="";
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
  if(!course.holed){ const a=aimPoint(); c.setLineDash([2,2]); c.strokeStyle="rgba(255,207,51,.9)"; c.beginPath(); c.moveTo(X(course.ball.x),Y(course.ball.z)); c.lineTo(X(a.x),Y(a.z)); c.stroke(); c.setLineDash([]); }
  c.fillStyle="#d8392b"; c.fillRect(X(h.pinX)-1,Y(h.L)-7,2,7);
  const b=course.ball; c.fillStyle="#fff"; c.strokeStyle="#000"; c.beginPath(); c.arc(X(b.x),Y(b.z),2.6,0,Math.PI*2); c.fill(); c.stroke();
}

// ================= Jugadores y ranking =================
// Solo cuentan golpes reales (no los de prueba). Rondas por campo; récords de drive, velocidad y precisión.
const RANK_CATS={ drives:{name:"Drive más largo", better:"max"}, speeds:{name:"Swing más rápido", better:"max"}, prox:{name:"Más cerca del objetivo", better:"min"} };
function addEntry(cat, e){
  e.p=S.player; e.at=Date.now(); const L=board[cat]; L.push(e);
  const same=x=>cat==="rounds"?x.c===e.c:true, cmp=cat==="rounds"?(a,b)=>a.v-b.v||a.at-b.at:RANK_CATS[cat].better==="max"?(a,b)=>b.v-a.v||a.at-b.at:(a,b)=>a.v-b.v||a.at-b.at;
  const group=L.filter(same).sort(cmp), keep=new Set(group.slice(0,50)); board[cat]=L.filter(x=>!same(x)||keep.has(x));
  saveBoard(); const pos=group.indexOf(e)+1;
  if(pos===1 && cat!=="rounds" && group.length>1){ const msgTxt={drives:"¡Drive más largo del ranking!",speeds:"¡Swing más rápido del ranking!",prox:"¡El más cerca del ranking!"}[cat]; setTimeout(()=>say(msgTxt),2600); }
  return pos; }
const saveBoard=()=>store.set("sl10_board",board);
let rankTab=null;
const fmtDate=t=>new Date(t).toLocaleDateString("es",{day:"numeric",month:"short"});
const vsPar=d=>d===0?"E":d>0?"+"+d:String(d);
function rankRows(tab){
  if(tab.startsWith("rounds:")){ const cid=tab.slice(7), c=SL.courseById(cid);
    return {head:["#","Jugador","Golpes","Par","Fecha"], rows:board.rounds.filter(r=>r.c===cid).sort((a,b)=>a.v-b.v||a.at-b.at).slice(0,10).map((r,i)=>[i+1,r.p,r.v,vsPar(r.d),fmtDate(r.at)]),
      note:`${c.name}: rondas completas de ${c.holes.length} hoyos (par ${c.par}).`, share:x=>`${x[1]}: ${x[2]} golpes (${x[3]})`}; }
  if(tab==="drives") return {head:["#","Jugador","Distancia","Dónde","Fecha"], rows:board.drives.slice().sort((a,b)=>b.v-a.v).slice(0,10).map((r,i)=>[i+1,r.p,fmtDist(r.v),r.c==="range"?"Range":SL.courseById(r.c).name,fmtDate(r.at)]),
      note:"Distancia total (vuelo y rodado) de tus golpes reales con el driver.", share:x=>`${x[1]}: ${x[2]}`};
  if(tab==="speeds") return {head:["#","Jugador","Velocidad","Con","Fecha"], rows:board.speeds.slice().sort((a,b)=>b.v-a.v).slice(0,10).map((r,i)=>{ const f=fmtSpeed(r.v); return [i+1,r.p,f.v+" "+f.u,r.src==="camera"?"Cámara":"Sensor",fmtDate(r.at)]; }),
      note:"Velocidad del palo con el driver. Para comparar entre amigos, calibra con radar o con tus distancias.", share:x=>`${x[1]}: ${x[2]}`};
  return {head:["#","Jugador","Al objetivo","Objetivo","Fecha"], rows:board.prox.slice().sort((a,b)=>a.v-b.v).slice(0,10).map((r,i)=>[i+1,r.p,fmtDist(r.v),fmtDist(r.t)+" · "+CLUBS[r.club].name,fmtDate(r.at)]),
      note:"En el range, a qué distancia quedó la bola del objetivo que elegiste (desde 40 m).", share:x=>`${x[1]}: ${x[2]} de un objetivo a ${x[3]}`};
}
function renderPlayers(){
  $("players").innerHTML=players.map(p=>`<button class="pchip" data-p="${encodeURIComponent(p)}" aria-pressed="${p===S.player}">${p.replace(/</g,"&lt;")}${players.length>1?`<span class="x" data-del="1" aria-label="Quitar">×</span>`:""}</button>`).join("");
  $("players").querySelectorAll(".pchip").forEach(b=>b.addEventListener("click",e=>{ const p=decodeURIComponent(b.dataset.p);
    if(e.target.dataset.del){ players=players.filter(x=>x!==p); if(!players.length) players=["Yo"]; if(S.player===p) setPlayer(players[0]); store.set("sl10_players",players); renderRank(); return; }
    setPlayer(p); })); }
function setPlayer(p){ if(p===S.player) return; S.player=p; saveSettings(); builtHole="";
  course=validRound(rounds[roundKey()])?rounds[roundKey()]:null;
  if(mode==="course"){ if(!course) newRound(); else setupHole(true); }
  renderRank(); renderCourses(); renderScore(); say(`Juega ${p}.`); }
$("addPlayer").addEventListener("click",()=>{ const v=$("newPlayer").value.trim().slice(0,18); if(!v) return;
  if(!players.includes(v)){ players.push(v); store.set("sl10_players",players); } $("newPlayer").value=""; setPlayer(v); renderRank(); });
$("newPlayer").addEventListener("keydown",e=>{ if(e.key==="Enter") $("addPlayer").click(); });
function renderRank(){
  renderPlayers();
  // récords en tarjetas
  const best=(L,f)=>L.length?L.reduce((a,b)=>f(b,a)?b:a):null;
  const r=best(board.rounds,(a,b)=>a.d<b.d||(a.d===b.d&&a.at<b.at)), dr=best(board.drives,(a,b)=>a.v>b.v), sp=best(board.speeds,(a,b)=>a.v>b.v), px=best(board.prox,(a,b)=>a.v<b.v);
  const tile=(lab,val,sub)=>`<div><span>${lab}</span><strong>${val}</strong><small>${sub}</small></div>`;
  $("podium").innerHTML=tile("Mejor ronda", r?vsPar(r.d):"—", r?`${r.p} · ${SL.courseById(r.c).name}`:"Termina una ronda")+
    tile("Drive más largo", dr?fmtDist(dr.v):"—", dr?dr.p:"Pega con el driver")+
    tile("Swing más rápido", sp?fmtSpeed(sp.v).v+" "+fmtSpeed(sp.v).u:"—", sp?`${sp.p} · driver`:"Mide un swing con el driver")+
    tile("Más cerca", px?fmtDist(px.v):"—", px?`${px.p} · range`:"Apunta en el range");
  const tabs=SL.COURSES.map(c=>["rounds:"+c.id, c.name]).concat([["drives","Drive"],["speeds","Velocidad"],["prox","Precisión"]]);
  if(!rankTab) rankTab="rounds:"+courseId;
  $("rankTabs").innerHTML=tabs.map(([k,n])=>`<button class="pchip" data-t="${k}" aria-pressed="${k===rankTab}">${n}</button>`).join("");
  $("rankTabs").querySelectorAll(".pchip").forEach(b=>b.addEventListener("click",()=>{ rankTab=b.dataset.t; renderRank(); }));
  const R=rankRows(rankTab);
  $("rankHead").innerHTML="<tr>"+R.head.map(h=>`<th>${h}</th>`).join("")+"</tr>";
  $("rankBody").innerHTML=R.rows.length?R.rows.map(x=>`<tr class="${x[1]===S.player?"me":""}">`+x.map(v=>`<td>${String(v).replace(/</g,"&lt;")}</td>`).join("")+"</tr>").join("")
    :`<tr><td colspan="${R.head.length}" class="note">Aún no hay registros. Los golpes de prueba no cuentan.</td></tr>`;
  $("rankNote").textContent=R.note;
}
$("rankShare").addEventListener("click",async()=>{ const R=rankRows(rankTab), t=$("rankTabs").querySelector('[aria-pressed="true"]');
  const text=`Swing Lab · ${t?t.textContent:""}\n`+(R.rows.length?R.rows.slice(0,5).map(x=>`${x[0]}. ${R.share(x)}`).join("\n"):"Aún sin registros")+"\n¿Me superas?";
  const url=location.href.split("#")[0];
  try{ if(navigator.share){ await navigator.share({title:"Swing Lab · Ranking", text, url}); return; } }catch(_){ return; }
  try{ await navigator.clipboard.writeText(text+"\n"+url); msg("Ranking copiado: pégalo en tu chat."); }catch(_){ msg(text); } });
$("rankClear").addEventListener("click",()=>{ $("rankClearConfirm").hidden=false; });
$("rankClearNo").addEventListener("click",()=>{ $("rankClearConfirm").hidden=true; });
$("rankClearYes").addEventListener("click",()=>{ board={rounds:[],drives:[],speeds:[],prox:[]}; saveBoard(); $("rankClearConfirm").hidden=true; renderRank(); });
$("toRank").addEventListener("click",()=>{ rankTab="rounds:"+courseId; setMode("rank"); window.scrollTo({top:0,behavior:"smooth"}); });

// ================= Panel de datos =================
function css(v){ return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
function postureTips(po){ const t=[];
  if(Math.abs(po.head)>=8) t.push(`Tu cabeza se movió ${Math.abs(po.head)} cm ${po.head>0?"hacia el objetivo":"hacia atrás"} antes del impacto: intenta mantenerla quieta.`);
  if(po.sway<=-10) t.push(`Tu cadera se deslizó ${-po.sway} cm hacia atrás en la subida: gira sin desplazarte.`);
  if(po.shTurn<60) t.push(`Giraste los hombros unos ${po.shTurn}°: un giro más completo da más distancia.`);
  else if(po.shTurn>=75) t.push(`Buen giro de hombros (unos ${po.shTurn}°).`);
  return t; }
// Ángulo de ataque según el palo: con el driver se pega subiendo, con hierros y wedges bajando
const sgn=a=>(a>0?"+":"")+a.toFixed(0)+"°";
function aoaTip(h){ if(!h.aoaOk) return null; const c=h.club, a=h.aoa, low=h.lowCm;
  const lowTxt=low==null?"":Math.abs(low)<2?" Tu punto bajo quedó justo debajo del centro de tu postura.":` Tu punto bajo quedó ${Math.abs(low)} cm ${low>0?"delante":"detrás"} del centro de tu postura.`;
  const ideal={driver:[1,6], wood3:[-2,2], hybrid:[-3,1], iron5:[-5,-1], iron7:[-6,-2], iron9:[-7,-2], wedge:[-8,-3], sw:[-9,-3]}[c]||[-5,0];
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
  if(h.arcTop!=null){ p.push(h.len==="completo"?`Swing completo: ${h.arcTop}° de subida y ${h.arcFin}° de final.`:h.len==="tres cuartos"?`Tres cuartos de swing (${h.arcTop}° de subida).`:`Medio swing (${h.arcTop}° de subida): para pegar más lejos, sube más el palo.`);
    if(h.arcFin!=null && h.arcFin<h.arcTop*0.6) p.push("Frenaste el final: termina el swing con las manos arriba."); }
  const sh=shapeName(h); if(sh) p.push(`<em>${sh}.</em> Cara ${fmtFace(h).toLowerCase()}`+(h.pathOk?`, ruta ${fmtPath(h).toLowerCase()}.`:"."));
  if(h.sat) p.push(h.method==="fit"?"El sensor topó y reconstruí el pico.":"El sensor topó: tu velocidad real es mayor que esta.");
  if(h.source==="camera"){ const at=aoaTip(h); if(at) p.push(at);
    if(h.hand){ const hs=fmtSpeed(h.hand); p.push(`Tus manos llegaron a ${hs.v} ${hs.u} en la bajada (un golfista promedio anda por ${fmtSpeed(8.9).v} y los más rápidos del tour pasan de ${fmtSpeed(12.8).v}).`); }
    if(h.posture) p.push(...postureTips(h.posture));
    if(h.camQ && h.camQ.level!=="alta") p.push(`Lectura de la cámara ${h.camQ.level}: ${h.camQ.why[0]||"revisa la luz y el encuadre"}.`);
    p.push("Con la cámara la dirección sale recta: la cara y la ruta solo se miden con el sensor."); }
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
  const cam=h.source==="camera"; $("faceLab").textContent=cam?"Ataque":"Cara"; $("pathLab").textContent=cam?"Manos (máx.)":"Ruta";
  $("face").textContent=cam?(h.aoaOk?sgn(h.aoa):"—"):fmtFace(h); $("path").textContent=cam?(h.hand?fmtSpeed(h.hand).v+" "+fmtSpeed(h.hand).u:"—"):fmtPath(h);
  $("carry").textContent=fmtDist(dv.carry);
  $("clubLab").textContent=CLUBS[h.club].name; const ck=calibKind(h.club,srcOf(h)); $("calibTag").textContent=ck?"· calibrado con "+ck:"";
  if(h.source==="camera"){ const hs=fmtSpeed(h.hand||0);
    $("quality").textContent=(h.camQ?`Lectura de cámara ${h.camQ.level} · `:"")+`${h.hz} cuadros por segundo · manos ${hs.v} ${hs.u} (máx.)`+(h.arm?` · brazo ${Math.round(h.arm*100)} cm`:"")+(h.aoaOk?` · ataque ${sgn(h.aoa)}`:"")+` · lanzamiento ${dv.launch.toFixed(0)}° · spin ${Math.round(dv.spin/100)*100} rpm.`+(h.hz<45?" Con 60 cuadros por segundo la medición es más precisa.":""); }
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
  if(lastReal){ const v=toUnit(lastReal.msRaw); $("calibLast").textContent=`Último swing (${CLUBS[lastReal.club].name}, con ${srcOf(lastReal)==="camera"?"la cámara":"el sensor"}), sin calibrar: ${v.toFixed(S.units==="ms"?1:0)} ${u}. ¿Cuánto marcó el radar?`; }
  const mc=myCarry[club], nReal=realOf(club,S.input).length;
  $("myCarryIn").value = mc ? (S.dist==="yd"?Math.round(mc/0.9144):Math.round(mc)) : ""; $("myCarryUnit").textContent=S.dist==="yd"?"yd":"m"; $("myCarryClub").textContent=CLUBS[club].name;
  $("myCarryState").textContent = !mc ? `Escribe cuánto vuela normalmente tu ${CLUBS[club].name} (carry).` :
     nReal<3 ? `Guardado. Haz ${3-nReal} swing${3-nReal>1?"s":""} real${3-nReal>1?"es":""} más con el ${CLUBS[club].name} usando ${S.input==="camera"?"la cámara":"el sensor"} para ajustar.` :
     radarOf(club,S.input).length ? "Este palo ya está calibrado con radar; el radar tiene prioridad." : `Ajustado para ${S.input==="camera"?"la cámara":"el sensor"}: tu swing típico con el ${CLUBS[club].name} ahora vuela ${fmtDist(mc)}.`;
  const p=radarOf(club,S.input), ck=calibKind(club,S.input), via=S.input==="camera"?"la cámara":"el sensor";
  $("calibState").textContent=p.length?`${CLUBS[club].name} con ${via}: ${p.length} swing${p.length>1?"s comparados":" comparado"} con el radar, factor ${factor(club,S.input).toFixed(2)}.`+(p.length<3?" Agrega algunos más para que sea confiable.":"")
    : ck==="tus otros palos" ? `${CLUBS[club].name} con ${via}: sin radar propio; usa lo calibrado con tus otros palos (factor ${factor(club,S.input).toFixed(2)}).` : `${CLUBS[club].name} con ${via}: sin calibrar.`;
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
  if(!h.sim && h.club==="driver") addEntry("speeds",{v:+derive(h).ms.toFixed(2), src:srcOf(h)});
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
  $("camPause").hidden=rep; $("camPause").textContent=camHold?"▶":"⏸"; $("camPause").setAttribute("aria-label",camHold?"Seguir leyendo swings":"Pausar la lectura");
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
  const ok=await SL.Cam.start({facing:S.camFacing, model:S.camModel, onStatus:camStatus, onReady:()=>{ if(S.guide) playRhythm(); else beep(880,0.08); },
    onSwing:frames=>{ if(World.busy() || aimMode) return; const res=SL.analyzePose(frames, club, {grip:S.camGrip, view:S.camView});
      if(res.error){ camError(res); return; } res.model=SL.Cam.model; res.camFps=SL.Cam.camFps;
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
    for(let i=0;i<20;i++){ const mid=(lo+hi)/2, s=SL.simulateLocal(launch(club,mid,null,lie),[0,0],null); if(Math.hypot(s.x,s.z)<target) lo=mid; else hi=mid; }
    ms=(lo+hi)/2*(1+gauss()*0.05);
  } else ms=c.def*(0.92+Math.random()*0.16);
  const full=c.def*0.85, frac=Math.min(1,ms/full);
  if(S.input==="camera"){ const hand=ms/factor(club,"camera")/SL.camRatio(club,0.62,S.camGrip)*1.05;
    const ideal={driver:3, wood3:0, hybrid:-1, iron5:-3, iron7:-4, iron9:-4.5, wedge:-5, sw:-5}[club]??-3, aoa=(ideal+gauss()*2)*DEG, shift=-Math.sin(aoa)*(0.62+(SL.CLUB_LEN[club]||1))+(SL.BALL_POS[club]||0);
    const res=SL.analyzePose(SL.synthPose({fps:30, handSpeed:hand, hand:S.hand, shift, top:85+frac*85+gauss()*6, finish:95+frac*85, back:640+frac*220+gauss()*40, down:290+gauss()*15, sway:Math.max(0,gauss()*6), head:gauss()*4, turn:60+frac*25}), club, {grip:S.camGrip, view:S.camView});
    if(!res.error) res.sim=true; handleResult(res); return; }
  const peak=SL.omegaFor(club, ms/factor(club), S.hold)*1.005;
  const res=SL.analyze(SL.synthKin({hz:100, peak, face:gauss()*2.5, path:gauss()*3.5, hand:S.hand, top:110+frac*140+gauss()*8, finish:120+frac*140, back:640+frac*200+gauss()*40, down:255+gauss()*15}), club, {mode:S.hold, hand:S.hand});
  if(!res.error) res.sim=true; handleResult(res);
}
$("testShot").addEventListener("click",testShot);
$("view").addEventListener("click",e=>{
  if(World.busy()){ World.skip(); return; }
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
function setClub(c,silent){ club=c; store.set("sl2_club",club); $("clubLab").textContent=CLUBS[club].name; if(!silent) renderAll(); else renderChips(); }
function setMode(m){
  mode=m; store.set("sl3_mode",mode);
  document.querySelectorAll(".mode").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.mode===m)));
  document.querySelectorAll("[data-for]").forEach(s=>s.hidden=s.dataset.for!==m);
  document.body.classList.toggle("m-rank",m==="rank");
  $("view").hidden=m==="rank" || ((m==="data"||!has3D) && !(S.input==="camera" && camState==="on")); $("board").classList.toggle("compact",m!=="data"); $("mini").hidden=m!=="course";
  $("card").hidden=true; setHudMsg(null); $("holeTip").hidden=true; $("skip").hidden=true; if(aimMode){ aimMode=false; }
  if(has3D) World.setActive(m!=="data" && m!=="rank");
  if(m==="range") setupRange();
  else if(m==="course"){ if(!course) newRound(); else { builtHole=""; setupHole(false); } renderCourses(); renderScore(); }
  else if(m==="rank") renderRank();
  else { drawTrace(); drawField(); }
  if(camState==="on"){ if(m==="rank"){ SL.Cam.pause(true); } camLayer(m!=="rank"); }
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
bindSel("camModel","camModel",()=>{ if(camState==="on"){ camStop(); camStart(); } });
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
window.__swingLab={SL, testShot, World, selectCourse, get course(){ return course; }, get courseId(){ return courseId; }};
})();
