// Swing Lab · motor: análisis del swing y física del vuelo de la bola
(function(){
"use strict";
const SL = window.SL = window.SL || {};
const DEG = Math.PI/180; SL.DEG = DEG;

SL.CLUBS = {
  driver:{name:"Driver",   radius:1.55, smash:1.46, launch:12.5, spin:2700, vref:46, def:42},
  iron7: {name:"Hierro 7", radius:1.35, smash:1.33, launch:17,   spin:7000, vref:40, def:35},
  wedge: {name:"Wedge",    radius:1.25, smash:1.20, launch:26,   spin:9000, vref:37, def:31}
};
SL.CLUB_ORDER = ["wedge","iron7","driver"];

// ---------- utilidades ----------
const norm = v => Math.hypot(v[0],v[1],v[2]);
function smooth3(a){
  const n=a.length;
  return a.map((v,i)=>{ const p=a[Math.max(0,i-1)], q=a[Math.min(n-1,i+1)];
    return [(p[0]+v[0]+q[0])/3,(p[1]+v[1]+q[1])/3,(p[2]+v[2]+q[2])/3]; });
}
const inRange=(v,a,b)=>v!=null && v>=a && v<=b;

// Segmentación 1: proyecta el giro sobre el eje del impacto (+ bajada, − subida)
function segment(Sm,bias){
  const t=Sm.map(s=>s.t);
  const r=Sm.map(s=>[s.x-bias[0],s.y-bias[1],s.z-bias[2]]);
  const sm=smooth3(r), mag=sm.map(norm), raw=r.map(norm);
  let imp=0; for(let i=1;i<mag.length;i++) if(mag[i]>mag[imp]) imp=i;
  const m=mag[imp]||1, u=sm[imp].map(v=>v/m);
  const d=sm.map(v=>v[0]*u[0]+v[1]*u[1]+v[2]*u[2]);
  let top=imp; while(top>0 && d[top]>0) top--;
  let start=null;
  if(top>0){
    let bsPeak=top;
    for(let i=top;i>=0 && t[top]-t[i]<=2500;i--) if(d[i]<d[bsPeak]) bsPeak=i;
    const bsMax=-d[bsPeak];
    if(bsMax>40){ start=bsPeak; while(start>0 && -d[start]>Math.max(8,bsMax*0.1)) start--; }
  }
  return {t,r,mag,raw,d,imp,top,start};
}
// Segmentación 2 (respaldo): usa solo la magnitud del giro; el punto más lento antes del impacto es "arriba"
function segmentMag(seg){
  const {t,mag,imp}=seg; let top=-1;
  for(let i=imp-1;i>=0 && t[imp]-t[i]<=750;i--){ if(t[imp]-t[i]<70) continue; if(top<0 || mag[i]<mag[top]) top=i; }
  if(top<=0) return null;
  let bp=-1; for(let i=top-1;i>=0 && t[top]-t[i]<=2500;i--){ if(bp<0 || mag[i]>mag[bp]) bp=i; }
  let start=null;
  if(bp>0 && mag[bp]>30){ start=bp; while(start>0 && mag[start]>Math.max(12,mag[bp]*0.15)) start--; }
  return {top,start};
}
function findStill(seg, before){
  const {raw,t}=seg; let e=before-1;
  while(e>0 && raw[e]>=25) e--;
  if(e<=0) return null;
  let b=e; while(b>0 && raw[b-1]<25 && t[e]-t[b-1]<=500) b--;
  return t[e]-t[b]>=150 ? {b,e} : null;
}
function fitQuad(pts){
  let s0=0,s1=0,s2=0,s3=0,s4=0,y0=0,y1=0,y2=0;
  for(const [x,y] of pts){ const x2=x*x; s0++; s1+=x; s2+=x2; s3+=x2*x; s4+=x2*x2; y0+=y; y1+=x*y; y2+=x2*y; }
  const M=[[s4,s3,s2,y2],[s3,s2,s1,y1],[s2,s1,s0,y0]];
  for(let i=0;i<3;i++){ let p=i; for(let k=i+1;k<3;k++) if(Math.abs(M[k][i])>Math.abs(M[p][i])) p=k;
    [M[i],M[p]]=[M[p],M[i]]; if(Math.abs(M[i][i])<1e-12) return null;
    for(let k=0;k<3;k++) if(k!==i){ const f=M[k][i]/M[i][i]; for(let j=i;j<4;j++) M[k][j]-=f*M[i][j]; } }
  return {a:M[0][3]/M[0][0], b:M[1][3]/M[1][1], c:M[2][3]/M[2][2]};
}
const qmul=(a,b)=>[a[0]*b[0]-a[1]*b[1]-a[2]*b[2]-a[3]*b[3], a[0]*b[1]+a[1]*b[0]+a[2]*b[3]-a[3]*b[2],
                   a[0]*b[2]-a[1]*b[3]+a[2]*b[0]+a[3]*b[1], a[0]*b[3]+a[1]*b[2]-a[2]*b[1]+a[3]*b[0]];
function qstep(w,dt){ const th=norm(w)*dt; if(th<1e-9) return [1,0,0,0]; const s=Math.sin(th/2)/norm(w);
  return [Math.cos(th/2), w[0]*s, w[1]*s, w[2]*s]; }
function twist(q){ let a=2*Math.atan2(q[2],q[0])/DEG; while(a>180)a-=360; while(a<=-180)a+=360; return a; }

// ---------- análisis de un swing ----------
SL.MIN_PEAK = 250; // °/s: por debajo no se cuenta como swing
SL.analyze = function(Sm, clubKey){
  const n=Sm.length, C=SL.CLUBS[clubKey];
  if(n<12) return {error:"Llegaron muy pocos datos del sensor. Intenta de nuevo.", code:"few"};
  let seg=segment(Sm,[0,0,0]), bias=[0,0,0];
  const still=findStill(seg, seg.start ?? (seg.top>0?seg.top:seg.imp));
  if(still){ for(let i=still.b;i<=still.e;i++){ bias[0]+=Sm[i].x; bias[1]+=Sm[i].y; bias[2]+=Sm[i].z; }
    const k=still.e-still.b+1; bias=bias.map(v=>v/k); seg=segment(Sm,bias); }
  const {t,imp,raw}=seg;

  // Pico de giro
  let pi=imp; for(let i=Math.max(0,imp-3);i<=Math.min(n-1,imp+3);i++) if(raw[i]>raw[pi]) pi=i;
  const obs=raw[pi];
  if(obs<SL.MIN_PEAK) return {error:`Giro muy lento para contarlo como swing (${Math.round(obs)}°/s). Haz el movimiento con más decisión.`, code:"slow", obs};

  // Tiempos: primero por eje, si no cuadra por magnitud; si nada cuadra, el swing vale igual pero sin tempo
  let top=seg.top, start=seg.start, seg_method="axis";
  const valid=(tp,st)=> tp>0 && st!=null && inRange(t[tp]-t[st],250,3000) && inRange(t[imp]-t[tp],90,700);
  if(!valid(top,start)){
    const m=segmentMag(seg);
    if(m && valid(m.top,m.start)){ top=m.top; start=m.start; seg_method="mag"; }
    else { start=null; top = m && inRange(t[imp]-t[m.top],90,700) ? m.top : (top>0 && inRange(t[imp]-t[top],90,700) ? top : null); seg_method="none"; }
  }
  const back = start!=null ? t[top]-t[start] : null;
  const down = top!=null ? t[imp]-t[top] : null;

  // Saturación del giroscopio y reconstrucción del pico
  const from = top ?? Math.max(0,imp-30), hi=Math.min(n-1,imp+6);
  let maxC=0; for(let i=from;i<=hi;i++){ const s=Sm[i]; maxC=Math.max(maxC,Math.abs(s.x),Math.abs(s.y),Math.abs(s.z)); }
  const clip=[];
  if(maxC>=900) for(let i=from;i<=hi;i++){ const s=Sm[i]; if(Math.max(Math.abs(s.x),Math.abs(s.y),Math.abs(s.z))>=maxC*0.995) clip.push(i); }
  const sat = clip.some((v,j)=>j>0 && v===clip[j-1]+1);
  let peak=obs, method="direct";
  if(sat){
    method="floor";
    const c0=clip[0], c1=clip[clip.length-1], lim=maxC*0.995, ref=seg.r[Math.max(0,c0-1)], rn=norm(ref)||1, uref=ref.map(v=>v/rn);
    let rec=0;
    for(const i of clip){ const s=[Sm[i].x,Sm[i].y,Sm[i].z]; let num=0, den=0;
      for(let k=0;k<3;k++) if(Math.abs(s[k])<lim){ num+=seg.r[i][k]**2; den+=uref[k]**2; }
      if(den>=0.06) rec=Math.max(rec, Math.sqrt(num/den)); }
    if(rec>obs){ peak=Math.min(rec,obs*1.8); method="fit"; }
    if(method!=="fit"){
      const pts=[]; for(let i=Math.max(from,c0-6);i<=Math.min(n-1,c1+4);i++) if(!clip.includes(i)) pts.push([(t[i]-t[c0])/1000, raw[i]]);
      const pre=pts.filter(p=>p[0]<0).length, post=pts.length-pre;
      if(pre>=2 && post>=1 && pts.length>=4){ const f=fitQuad(pts);
        if(f && f.a<0){ const v=f.c-f.b*f.b/(4*f.a); if(isFinite(v) && v>obs){ peak=Math.min(v,obs*1.6); method="fit"; } } }
    }
  } else if(pi>0 && pi<n-1){
    const y0=raw[pi-1], y1=raw[pi], y2=raw[pi+1], den=y0-2*y1+y2;
    if(den<0){ const p=0.5*(y0-y2)/den; peak=Math.min(Math.max(y1-0.25*(y0-y2)*p,obs),obs*1.08); }
  }

  // Cara del palo (experimental): giro alrededor del eje largo del teléfono desde el address
  let face=0, faceOk=false;
  if(top!=null && start!=null){
    const a0 = still ? still.e : Math.max(0,start-1);
    let q=[1,0,0,0], twTop=0;
    for(let i=a0+1;i<=imp;i++){
      const dt=(t[i]-t[i-1])/1000, w=[0,1,2].map(k=>(seg.r[i][k]+seg.r[i-1][k])/2*DEG);
      q=qmul(q,qstep(w,dt)); const qn=Math.hypot(...q); q=q.map(v=>v/qn);
      if(i===top) twTop=twist(q);
    }
    face=twist(q)*(Math.sign(twTop)||1);
    faceOk = !sat && Math.abs(twTop)>20 && Math.abs(face)<=30;
  }

  const i0=Math.max(0,(start ?? top ?? imp-20)-8), i1=Math.min(n-1,imp+15), r0=still?Math.min(still.b,i0):i0;
  const hz=(n-1)/((t[n-1]-t[0])/1000);
  return {
    id:Date.now()+Math.random(), at:Date.now(), club:clubKey,
    msRaw: peak*DEG*C.radius, peak:Math.round(peak), obs:Math.round(obs), sat, method, seg:seg_method,
    back, down, ratio: back!=null && down ? back/down : null,
    face: Math.round(face*10)/10, faceOk, hz: Math.round(hz),
    trace:{ t:t.slice(i0,i1+1).map(v=>v-t[i0]), d:(seg_method==="axis"?seg.d:seg.mag).slice(i0,i1+1),
            start:start!=null?start-i0:null, top:top!=null?top-i0:null, imp:imp-i0, signed:seg_method==="axis" },
    rawSamples: Sm.slice(r0,i1+1).map(s=>[Math.round(s.t-Sm[r0].t), +s.x.toFixed(1), +s.y.toFixed(1), +s.z.toFixed(1)])
  };
};

// ---------- física del vuelo ----------
// Coeficientes ajustados a datos TrackMan de tour y amateurs (error de carry ~1-3 %)
const AERO={cd0:0.24, cd1:0.2, a:1.8, b:1, clMax:0.3};
SL.LIES={tee:{speed:1,spin:1}, fairway:{speed:1,spin:1}, rough:{speed:0.9,spin:0.6}, bunker:{speed:0.75,spin:0.5}, green:{speed:1,spin:1}};
const GROUND={tee:{e:.25,mu:.25,k:1}, fairway:{e:.25,mu:.25,k:1}, rough:{e:.15,mu:.7,k:.6}, green:{e:.3,mu:.12,k:.95}, bunker:{e:.05,mu:2.5,k:.15}};

SL.launchFor = function(clubKey, ms, face, faceOk, lie, hand){
  const c=SL.CLUBS[clubKey], L=SL.LIES[lie]||SL.LIES.fairway, hs=hand==="L"?-1:1;
  const f = faceOk ? Math.max(-20,Math.min(20,face)) : 0;
  return { v: ms*c.smash*L.speed, launch: c.launch+(lie==="rough"?1.5:0),
           spin: c.spin*(0.6+0.4*ms/c.vref)*L.spin, dir: 0.75*f*hs, tilt: Math.max(-30,Math.min(30,1.8*f))*hs };
};
function flight(o, wind){
  const m=0.04593, r=0.02135, A=Math.PI*r*r, k=0.5*1.2*A/m, g=9.81, dt=0.01;
  let vx=o.v*Math.cos(o.launch*DEG)*Math.sin(o.dir*DEG), vy=o.v*Math.sin(o.launch*DEG), vz=o.v*Math.cos(o.launch*DEG)*Math.cos(o.dir*DEG);
  let x=0,y=0,z=0,w=o.spin*2*Math.PI/60,t=0,apex=0;
  const ct=Math.cos(o.tilt*DEG), st=Math.sin(o.tilt*DEG), W=wind||[0,0], pts=[{t:0,x:0,y:0,z:0}];
  let next=0.03;
  while(t<15){
    const rx=vx-W[0], ry=vy, rz=vz-W[1], v=Math.hypot(rx,ry,rz)||1e-6;
    const Sp=w*r/v, Cl=Math.min(AERO.clMax,Math.max(0,AERO.a*Sp-AERO.b*Sp*Sp)), Cd=AERO.cd0+AERO.cd1*Sp;
    const hz=Math.hypot(rx,rz)||1, px=-rz/hz, pz=rx/hz, sx=px*ct, sy=st, sz=pz*ct;
    const lx=sy*rz-sz*ry, ly=sz*rx-sx*rz, lz=sx*ry-sy*rx, ln=Math.hypot(lx,ly,lz)||1;
    const fD=k*Cd*v*v, fL=k*Cl*v*v;
    vx+=(-fD*rx/v+fL*lx/ln)*dt; vy+=(-fD*ry/v+fL*ly/ln-g)*dt; vz+=(-fD*rz/v+fL*lz/ln)*dt;
    const py=y, px0=x, pz0=z; x+=vx*dt; y+=vy*dt; z+=vz*dt; w*=Math.exp(-dt/30); t+=dt; apex=Math.max(apex,y);
    if(y<0 && t>0.05){ const f=py/(py-y); x=px0+(x-px0)*f; z=pz0+(z-pz0)*f; t=t-dt+dt*f; y=0; pts.push({t,x,y,z}); break; }
    if(t>=next){ pts.push({t,x,y,z}); next+=0.03; }
  }
  const land=Math.atan2(-vy,Math.hypot(vx,vz))/DEG;
  return {pts, x, z, t, vx, vy, vz, apex, land, spin:w*60/(2*Math.PI)};
}
function rollout(st, g){
  const G=GROUND[g]||GROUND.fairway, pts=[]; let x=st.x, z=st.z, t=st.t;
  let vh=Math.hypot(st.vx,st.vz)||1e-6; const hx=st.vx/vh, hz=st.vz/vh; let vv=-st.vy;
  vh*=Math.max(0.05,Math.min(0.6,0.55-st.spin/25000-(st.land-35)/150))*G.k; vv*=G.e;
  let guard=0;
  while(vv>1 && guard++<8){ const T=2*vv/9.81, n=Math.max(2,Math.ceil(T/0.03));
    for(let i=1;i<=n;i++){ const tt=T*i/n; pts.push({t:t+tt, x:x+hx*vh*tt, y:vv*tt-4.905*tt*tt, z:z+hz*vh*tt}); }
    x+=hx*vh*T; z+=hz*vh*T; t+=T; vh*=0.8; vv*=0.3; }
  const a=G.mu*9.81, Tr=vh/a, n=Math.ceil(Tr/0.03);
  for(let i=1;i<=n;i++){ const tt=Tr*i/n, d=vh*tt-0.5*a*tt*tt; pts.push({t:t+tt,x:x+hx*d,y:0,z:z+hz*d}); }
  const d=vh*vh/(2*a); x+=hx*d; z+=hz*d; t+=Tr;
  // En el green, un wedge con mucho spin frena y retrocede un poco
  if(g==="green" && st.spin>7500 && st.land>40){
    const back=Math.min(2.2,(st.spin-7500)/1400), T2=Math.sqrt(2*back/(G.mu*9.81)), a2=2*back/(T2*T2), n2=Math.ceil(T2/0.03);
    for(let i=1;i<=n2;i++){ const tt=T2*i/n2, dd=a2*T2*tt-0.5*a2*tt*tt; pts.push({t:t+0.25+tt,x:x-hx*dd,y:0,z:z-hz*dd}); }
    x-=hx*back; z-=hz*back; t+=0.25+T2;
  }
  return {pts, x, z, t};
}
// Tiro completo en marco local (x derecha, z hacia el objetivo)
SL.simulateLocal = function(o, wind, groundAt){
  const f=flight(o, wind);
  const g = groundAt ? groundAt(f.x, f.z) : "fairway";
  let r = {pts:[], x:f.x, z:f.z, t:f.t};
  if(g!=="water" && g!=="ob") r=rollout(f, g==="tee"?"fairway":g);
  return {pts:f.pts.concat(r.pts), landT:f.t, landN:f.pts.length, carry:Math.hypot(f.x,f.z), landX:f.x, landZ:f.z, landG:g,
          x:r.x, z:r.z, apex:f.apex, ball:o.v, dur:r.t};
};

// ---------- swing sintético (ejemplo y golpe de prueba) ----------
SL.synthSwing = function(o={}){
  const out=[], hz=o.hz||60, dt=1000/hz; let t=performance.now()-3000;
  const bias=[1.8,-1.2,0.9], u0=[0.25,0.35,-0.9], un=norm(u0), U=u0.map(v=>v/un), nz=()=> (Math.random()-.5)*(o.noise??4);
  const ub=o.backAxis ? (()=>{ const b=o.backAxis, bn=norm(b); return b.map(v=>v/bn); })() : U;
  const push=(a,ty,axis)=>{ const A=axis||U; out.push({t, x:a*A[0]+bias[0]+nz(), y:a*A[1]+ty+bias[1]+nz(), z:a*A[2]+bias[2]+nz()}); t+=dt; };
  if(!o.noStill) for(let i=0;i<Math.round(500/dt);i++) push(0,0);
  else for(let i=0;i<Math.round(500/dt);i++) push(60*Math.sin(i/4),0);
  const B=o.back||820, D=o.down||275, P=o.peak||1750, open=80*Math.min(1,P/1500), face=o.face ?? 3;
  const nb=Math.round(B/dt), kb=(open*Math.PI/2)/(B/1000), bAmp=Math.max(55,Math.min(260,P*0.15));
  for(let i=0;i<nb;i++){ const s=Math.sin(Math.PI*i/nb); push(-bAmp*s, kb*s, ub); }
  const nd=Math.round(D/dt), kd=-(open-face)*3.4/(D/1000);
  for(let i=1;i<=nd;i++){ const p=Math.pow(i/nd,2.4); push(P*p, kd*p); }
  for(let i=1;i<25;i++){ const e=Math.exp(-i/5); push(P*e, kd*e*0.3); }
  if(o.clip) out.forEach(s=>{ for(const k of ["x","y","z"]) s[k]=Math.max(-o.clip,Math.min(o.clip,s[k])); });
  return out;
};

// ---------- campo ----------
function rng(seed){ return ()=>{ seed|=0; seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
SL.rng = rng;
SL.HOLES=[
  {name:"El Guayacán", par:4, L:330, pinX:6,  fw:34, fwStart:40,  greenR:15, seed:1, bunkers:[{x:21,z:215,r:9},{x:-15,z:318,r:6}], water:[]},
  {name:"La Laguna",   par:3, L:140, pinX:-4, fw:26, fwStart:112, greenR:14, seed:2, bunkers:[{x:16,z:150,r:6}], water:[{x0:-34,x1:30,z0:82,z1:110}]},
  {name:"Los Samanes", par:5, L:470, pinX:-10,fw:32, fwStart:30,  greenR:16, seed:3, bunkers:[{x:-21,z:250,r:10},{x:13,z:458,r:7}], water:[{x0:22,x1:58,z0:280,z1:400}]}
];
SL.cxAt=(h,z)=>h.pinX*Math.max(0,Math.min(1,z/h.L));
SL.hwAt=(h,z)=>{ let w=h.fw/2+2.2*Math.sin(z/41+h.seed)+1.4*Math.sin(z/17+h.seed*2.3);
  const e=z-h.fwStart; if(e<18) w*=Math.sqrt(Math.max(0,e/18)); return Math.max(0,w); };
SL.HOLES.forEach((h,i)=>{ const R=rng(97+i*31); h.trees=[];
  for(let z=-20; z<h.L+60; z+=11+R()*9){ for(const side of [-1,1]){ if(R()<0.8){
    const cx=SL.cxAt(h,z), off=h.fw/2+20+R()*26, x=cx+side*off;
    if(h.water.some(w=>x>w.x0-6 && x<w.x1+6 && z>w.z0-6 && z<w.z1+6)) continue;
    if(Math.hypot(x-h.pinX,z-h.L)<h.greenR+12) continue;
    h.trees.push({x, z:z+R()*6, s:0.8+R()*0.7, kind:R()<0.28?"cone":"round", hue:R()}); } } }
  for(let k=0;k<70;k++){ const z=-30+R()*(h.L+100), side=R()<0.5?-1:1, x=SL.cxAt(h,z)+side*(h.fw/2+48+R()*45);
    h.trees.push({x,z,s:0.9+R()*0.8, kind:R()<0.35?"cone":"round", hue:R()}); }
});
SL.lieAt=function(h,x,z){
  if(Math.hypot(x-h.pinX, z-h.L)<=h.greenR) return "green";
  for(const w of h.water) if(x>=w.x0 && x<=w.x1 && z>=w.z0 && z<=w.z1) return "water";
  for(const b of h.bunkers) if(Math.hypot(x-b.x,z-b.z)<=b.r) return "bunker";
  const off=Math.abs(x-SL.cxAt(h,z));
  if(off>h.fw/2+45 || z<-8 || z>h.L+45) return "ob";
  if(z<6 && Math.abs(x)<5) return "tee";
  if(z>=h.fwStart && z<=h.L && off<=SL.hwAt(h,z)) return "fairway";
  if(Math.hypot(x-h.pinX, z-h.L)<=h.greenR+3) return "fairway";
  return "rough";
};
SL.RANGE_TARGETS=[{d:50,x:-8},{d:100,x:10},{d:150,x:-12},{d:200,x:6},{d:250,x:-4},{d:300,x:0}];
})();
