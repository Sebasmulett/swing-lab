// Swing Lab · motor: análisis del swing y física del vuelo de la bola
(function(){
"use strict";
const SL = window.SL = window.SL || {};
const DEG = Math.PI/180; SL.DEG = DEG;

// radius: brazo + palo (m). smash: velocidad bola / palo. launch°, spin rpm de referencia a vref m/s. def: velocidad típica amateur (m/s)
SL.CLUBS = {
  driver:{name:"Driver",   short:"Dr", radius:1.55, smash:1.46, launch:12.5, spin:2700,  vref:46, def:42},
  wood3: {name:"Madera 3", short:"M3", radius:1.48, smash:1.44, launch:11.5, spin:3600,  vref:44, def:40},
  hybrid:{name:"Híbrido",  short:"Hy", radius:1.42, smash:1.40, launch:13,   spin:4400,  vref:42, def:38},
  iron5: {name:"Hierro 5", short:"5",  radius:1.38, smash:1.36, launch:13,   spin:5300,  vref:41, def:37},
  iron7: {name:"Hierro 7", short:"7",  radius:1.35, smash:1.33, launch:17,   spin:7000,  vref:40, def:35},
  iron9: {name:"Hierro 9", short:"9",  radius:1.31, smash:1.29, launch:21,   spin:8300,  vref:38, def:33},
  wedge: {name:"PW",       short:"PW", radius:1.28, smash:1.24, launch:24,   spin:9300,  vref:37, def:32},
  sw:    {name:"SW",       short:"SW", radius:1.25, smash:1.17, launch:30,   spin:10000, vref:35, def:30}
};
SL.CLUB_ORDER = ["sw","wedge","iron9","iron7","iron5","hybrid","wood3","driver"];

// ---------- vectores y cuaterniones ----------
const norm = v => Math.hypot(v[0],v[1],v[2]);
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const scale=(a,k)=>[a[0]*k,a[1]*k,a[2]*k], add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]], sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const unit=a=>scale(a,1/(norm(a)||1)), lerpv=(a,b,k)=>add(a,scale(sub(b,a),k)), clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const horiz=(v,U)=>unit(sub(v,scale(U,dot(v,U))));
const sangle=(a,b,axis)=>Math.atan2(dot(cross(a,b),axis), dot(a,b));
const qmul=(a,b)=>[a[0]*b[0]-a[1]*b[1]-a[2]*b[2]-a[3]*b[3], a[0]*b[1]+a[1]*b[0]+a[2]*b[3]-a[3]*b[2],
                   a[0]*b[2]-a[1]*b[3]+a[2]*b[0]+a[3]*b[1], a[0]*b[3]+a[1]*b[2]-a[2]*b[1]+a[3]*b[0]];
const qconj=q=>[q[0],-q[1],-q[2],-q[3]];
function qrot(q,v){ const p=qmul(qmul(q,[0,v[0],v[1],v[2]]),qconj(q)); return [p[1],p[2],p[3]]; }
function qstep(w,dt){ const th=norm(w)*dt; if(th<1e-9) return [1,0,0,0]; const s=Math.sin(th/2)/norm(w); return [Math.cos(th/2), w[0]*s, w[1]*s, w[2]*s]; }
function qaxis(axis,ang){ const s=Math.sin(ang/2), a=unit(axis); return [Math.cos(ang/2), a[0]*s, a[1]*s, a[2]*s]; }
function qbasis(x,y,z){ const m00=x[0],m01=y[0],m02=z[0],m10=x[1],m11=y[1],m12=z[1],m20=x[2],m21=y[2],m22=z[2], tr=m00+m11+m22; let S;
  if(tr>0){ S=Math.sqrt(tr+1)*2; return [0.25*S,(m21-m12)/S,(m02-m20)/S,(m10-m01)/S]; }
  if(m00>m11&&m00>m22){ S=Math.sqrt(1+m00-m11-m22)*2; return [(m21-m12)/S,0.25*S,(m01+m10)/S,(m02+m20)/S]; }
  if(m11>m22){ S=Math.sqrt(1+m11-m00-m22)*2; return [(m02-m20)/S,(m01+m10)/S,0.25*S,(m12+m21)/S]; }
  S=Math.sqrt(1+m22-m00-m11)*2; return [(m10-m01)/S,(m02+m20)/S,(m12+m21)/S,0.25*S]; }
function twist(q){ let a=2*Math.atan2(q[2],q[0])/DEG; while(a>180)a-=360; while(a<=-180)a+=360; return a; }
function smooth3(a){ const n=a.length; return a.map((v,i)=>{ const p=a[Math.max(0,i-1)], q=a[Math.min(n-1,i+1)]; return [(p[0]+v[0]+q[0])/3,(p[1]+v[1]+q[1])/3,(p[2]+v[2]+q[2])/3]; }); }
const inRange=(v,a,b)=>v!=null && v>=a && v<=b;

// ---------- modelo de velocidad ----------
// "phone": el teléfono es el palo (sin palo real). Un teléfono pesa mucho menos que un palo y se gira más rápido,
// así que el giro alto se comprime y se aplica la palanca de un palo virtual.
// "club": el teléfono va sujeto a un palo real: el giro de las manos es el giro del palo.
SL.speedModel=function(clubKey, omegaDeg, mode){
  const r=SL.CLUBS[clubKey].radius;
  if(mode==="club") return omegaDeg*DEG*r;
  const k=1250, eff = omegaDeg<=k ? omegaDeg : k+(omegaDeg-k)*0.62;
  return eff*DEG*r*0.93;
};
SL.omegaFor=function(clubKey, ms, mode){
  const r=SL.CLUBS[clubKey].radius;
  if(mode==="club") return ms/(DEG*r);
  const k=1250, eff=ms/(DEG*r*0.93); return eff<=k ? eff : k+(eff-k)/0.62;
};

// ---------- segmentación por giro (respaldo) ----------
function segment(Sm,bias){
  const t=Sm.map(s=>s.t), r=Sm.map(s=>[s.x-bias[0],s.y-bias[1],s.z-bias[2]]), sm=smooth3(r), mag=sm.map(norm), raw=r.map(norm);
  let imp=0; for(let i=1;i<mag.length;i++) if(mag[i]>mag[imp]) imp=i;
  const m=mag[imp]||1, u=sm[imp].map(v=>v/m), d=sm.map(v=>v[0]*u[0]+v[1]*u[1]+v[2]*u[2]);
  let top=imp; while(top>0 && d[top]>0) top--;
  let start=null;
  if(top>0){ let bp=top; for(let i=top;i>=0 && t[top]-t[i]<=2500;i--) if(d[i]<d[bp]) bp=i;
    const bm=-d[bp]; if(bm>40){ start=bp; while(start>0 && -d[start]>Math.max(8,bm*0.1)) start--; } }
  return {t,r,mag,raw,d,imp,top,start};
}
function segmentMag(seg){
  const {t,mag,imp}=seg; let top=-1;
  for(let i=imp-1;i>=0 && t[imp]-t[i]<=750;i--){ if(t[imp]-t[i]<70) continue; if(top<0 || mag[i]<mag[top]) top=i; }
  if(top<=0) return null;
  let bp=-1; for(let i=top-1;i>=0 && t[top]-t[i]<=2500;i--){ if(bp<0 || mag[i]>mag[bp]) bp=i; }
  let start=null; if(bp>0 && mag[bp]>30){ start=bp; while(start>0 && mag[start]>Math.max(12,mag[bp]*0.15)) start--; }
  return {top,start};
}
function findStill(seg, before){
  const {raw,t}=seg; let e=before-1;
  while(e>0 && raw[e]>=25) e--;
  if(e<=0) return null;
  let b=e; while(b>0 && raw[b-1]<25 && t[e]-t[b-1]<=500) b--;
  return t[e]-t[b]>=120 ? {b,e} : null;
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

// ---------- seguimiento de orientación desde el address ----------
// Integra el giroscopio desde la posición quieta inicial. Con la gravedad del address sabe dónde es "arriba",
// hacia dónde apunta el palo y hacia dónde está el objetivo. Así detecta inicio, arriba, impacto real y final.
function track(Sm, seg, still){
  if(!still) return null;
  const n=Sm.length, t=seg.t, a0=still.e;
  let g=[0,0,0], gc=0; for(let i=still.b;i<=still.e;i++) if(Sm[i].g){ g=add(g,Sm[i].g); gc++; }
  const gm=norm(g)/(gc||1), U = gc && gm>6 && gm<14 ? unit(g) : null;
  const yb=[0,1,0], sB = U ? (dot(yb,U)<0 ? yb : scale(yb,-1)) : yb;   // eje del palo: el extremo que apunta abajo
  const Q=new Array(n); let q=[1,0,0,0]; Q[a0]=q;
  for(let i=a0+1;i<n;i++){ const dt=(t[i]-t[i-1])/1000, w=[0,1,2].map(k=>(seg.r[i][k]+seg.r[i-1][k])/2*DEG);
    q=qmul(q,qstep(w,dt)); const qn=Math.hypot(...q); q=q.map(v=>v/qn); Q[i]=q; }
  const s=[], W=[]; for(let i=a0;i<n;i++){ s[i]=qrot(Q[i],sB); W[i]=qrot(Q[i],seg.r[i].map(v=>v*DEG)); }
  let k=a0; while(k<n-1 && Math.acos(clamp(dot(s[k],sB),-1,1))<25*DEG) k++;
  if(k>=n-1) return null;
  const A=unit(cross(sB,s[k]));
  const phi=[]; let prev=0;
  for(let i=a0;i<n;i++){ let a=Math.atan2(dot(cross(sB,s[i]),A), dot(sB,s[i])); while(a-prev>Math.PI)a-=2*Math.PI; while(a-prev<-Math.PI)a+=2*Math.PI; phi[i]=a; prev=a; }
  let top=a0; for(let i=a0;i<n;i++) if(phi[i]>phi[top]) top=i;
  if(phi[top]<50*DEG) return null;
  let imp=-1; for(let i=top+1;i<n && t[i]-t[top]<=900;i++) if(phi[i]<=0){ imp=i; break; }
  if(imp<0) return null;
  const fr=phi[imp-1]/((phi[imp-1]-phi[imp])||1);
  let st=a0; while(st<top && phi[st]<1.5*DEG) st++;
  // instante exacto de arriba (parábola) y de arranque (interpolado)
  let tTop=t[top]; if(top>a0 && top<n-1){ const y0=phi[top-1],y1=phi[top],y2=phi[top+1], den=y0-2*y1+y2; if(den<0){ const p=0.5*(y0-y2)/den; tTop=t[top]+p*(t[top+1]-t[top-1])/2; } }
  const tSt = st>a0 ? t[st-1]+(t[st]-t[st-1])*((1.5*DEG-phi[st-1])/((phi[st]-phi[st-1])||1)) : t[st];
  let fin=imp; for(let i=imp;i<n;i++) if(phi[i]<phi[fin]) fin=i;
  const om=norm(seg.r[imp-1])+(norm(seg.r[imp])-norm(seg.r[imp-1]))*fr;
  const tImp=t[imp-1]+(t[imp]-t[imp-1])*fr;
  const Wi=lerpv(W[imp-1],W[imp],fr), si=unit(lerpv(s[imp-1],s[imp],fr)), v=cross(Wi,si);
  let face=null, path=null, aoa=null;
  if(U){
    const negU=scale(U,-1), T0=horiz([0,0,1],U);
    const kb=Math.min(top, st+Math.max(1,Math.round((top-st)*0.25))), vb=horiz(cross(W[kb],s[kb]),U);
    const T=dot(vb,T0)>0 ? scale(T0,-1) : T0;   // en la subida la cabeza se aleja del objetivo
    const zi=unit(lerpv(qrot(Q[imp-1],[0,0,1]), qrot(Q[imp],[0,0,1]), fr));
    face=sangle(T0, horiz(zi,U), negU)/DEG;      // giro de la cara respecto al address (+ hacia la derecha del objetivo)
    path=sangle(T, horiz(v,U), negU)/DEG;        // dirección de la cabeza en el impacto (+ hacia la derecha)
    aoa=Math.asin(clamp(dot(unit(v),U),-1,1))/DEG;
  }
  return {a0, st, top, imp, fr, fin, tImp, tTop, tSt, om, arcTop:phi[top]/DEG, arcFin:-phi[fin]/DEG, face, path, aoa, hasG:!!U, phi};
}

SL._internals={track,segment,findStill};
// ---------- análisis de un swing ----------
SL.MIN_PEAK = 250;
SL.analyze = function(Sm, clubKey, opts={}){
  const n=Sm.length, mode=opts.mode||"phone", hs=opts.hand==="L"?-1:1;
  if(n<12) return {error:"Llegaron muy pocos datos del sensor. Intenta de nuevo.", code:"few"};
  let seg=segment(Sm,[0,0,0]), bias=[0,0,0];
  // quietud del address: antes del inicio del movimiento
  let before=seg.start ?? (seg.top>0?seg.top:seg.imp);
  let still=findStill(seg, before);
  if(!still){ for(let i=seg.imp-1;i>0;i--){ if(seg.raw[i]<20){ still=findStill(seg,i+1); if(still) break; } } }
  if(still){ for(let i=still.b;i<=still.e;i++){ bias[0]+=Sm[i].x; bias[1]+=Sm[i].y; bias[2]+=Sm[i].z; }
    const k=still.e-still.b+1; bias=bias.map(v=>v/k); seg=segment(Sm,bias); }
  const {t,imp,raw}=seg;
  let pi=imp; for(let i=Math.max(0,imp-3);i<=Math.min(n-1,imp+3);i++) if(raw[i]>raw[pi]) pi=i;
  const obs=raw[pi];
  if(obs<SL.MIN_PEAK) return {error:`Giro muy lento para contarlo como swing (${Math.round(obs)}°/s). Haz el movimiento con más decisión.`, code:"slow", obs};

  // saturación del giroscopio
  const from=Math.max(0,imp-40), hi=Math.min(n-1,imp+8);
  let maxC=0; for(let i=from;i<=hi;i++){ const s=Sm[i]; maxC=Math.max(maxC,Math.abs(s.x),Math.abs(s.y),Math.abs(s.z)); }
  // un sensor topado entrega el mismo valor exacto varias lecturas seguidas
  const clip=[]; if(maxC>=900) for(let i=from;i<=hi;i++){ const s=Sm[i]; if(Math.max(Math.abs(s.x),Math.abs(s.y),Math.abs(s.z))>=maxC-0.5) clip.push(i); }
  const sat=clip.some((v,j)=>j>0 && v===clip[j-1]+1);
  let peak=obs, method="direct";
  if(sat){
    method="floor";
    const c0=clip[0], c1=clip[clip.length-1], lim=maxC-0.5, ref=seg.r[Math.max(0,c0-1)], uref=unit(ref);
    let rec=0;
    for(const i of clip){ const s=[Sm[i].x,Sm[i].y,Sm[i].z]; let num=0, den=0;
      for(let k=0;k<3;k++) if(Math.abs(s[k])<lim){ num+=seg.r[i][k]**2; den+=uref[k]**2; }
      if(den>=0.06) rec=Math.max(rec,Math.sqrt(num/den)); }
    if(rec>obs){ peak=Math.min(rec,obs*1.8); method="fit"; }
    if(method!=="fit"){ const pts=[]; for(let i=Math.max(from,c0-6);i<=Math.min(n-1,c1+4);i++) if(!clip.includes(i)) pts.push([(t[i]-t[c0])/1000, raw[i]]);
      const pre=pts.filter(p=>p[0]<0).length, post=pts.length-pre;
      if(pre>=2 && post>=1 && pts.length>=4){ const f=fitQuad(pts); if(f && f.a<0){ const v=f.c-f.b*f.b/(4*f.a); if(isFinite(v) && v>obs){ peak=Math.min(v,obs*1.6); method="fit"; } } } }
  } else if(pi>0 && pi<n-1){
    const y0=raw[pi-1], y1=raw[pi], y2=raw[pi+1], den=y0-2*y1+y2;
    if(den<0){ const p=0.5*(y0-y2)/den; peak=Math.min(Math.max(y1-0.25*(y0-y2)*p,obs),obs*1.08); }
  }

  // seguimiento completo del swing
  const tr=track(Sm, seg, still);
  const trOk = tr && !(sat && clip.some(i=>i>=tr.st && i<=tr.imp+1));
  let top, start, back=null, down=null, segm="none", omega=peak, impT=t[imp];
  if(trOk){
    top=tr.top; start=tr.st; back=tr.tTop-tr.tSt; down=tr.tImp-tr.tTop; impT=tr.tImp; segm="track";
    if(!inRange(back,200,3500) || !inRange(down,80,800)){ back=null; down=null; }
    omega = Math.max(tr.om, peak*0.88);   // el pico real suele estar en el impacto o justo después
  } else {
    top=seg.top; start=seg.start; segm="axis";
    const valid=(tp,st)=> tp>0 && st!=null && inRange(t[tp]-t[st],250,3000) && inRange(t[imp]-t[tp],90,700);
    if(!valid(top,start)){ const m=segmentMag(seg); if(m && valid(m.top,m.start)){ top=m.top; start=m.start; segm="mag"; } else { top=null; start=null; segm="none"; } }
    if(top!=null && start!=null){ back=t[top]-t[start]; down=t[imp]-t[top]; }
  }

  // cara y ruta
  let face=0, faceOk=false, path=0, pathOk=false, aoa=0;
  if(trOk && tr.hasG){
    face=tr.face*hs; path=tr.path*hs; aoa=tr.aoa;
    faceOk=Math.abs(face)<=25; pathOk=Math.abs(path)<=20; if(Math.abs(aoa)>15) aoa=0;
  } else if(!sat && top!=null && start!=null){
    const a0=still?still.e:Math.max(0,start-1); let q=[1,0,0,0], twTop=0;
    for(let i=a0+1;i<=imp;i++){ const dt=(t[i]-t[i-1])/1000, w=[0,1,2].map(k=>(seg.r[i][k]+seg.r[i-1][k])/2*DEG);
      q=qmul(q,qstep(w,dt)); const qn=Math.hypot(...q); q=q.map(v=>v/qn); if(i===top) twTop=twist(q); }
    face=twist(q)*(Math.sign(twTop)||1); faceOk=Math.abs(twTop)>20 && Math.abs(face)<=30;
  }
  const arcTop = trOk ? tr.arcTop : null, arcFin = trOk ? tr.arcFin : null;
  const len = arcTop==null ? null : arcTop<110 ? "medio" : arcTop<170 ? "tres cuartos" : "completo";

  const i0=Math.max(0,(start ?? top ?? imp-20)-8), i1=Math.min(n-1,(trOk?tr.fin:imp+15)+4), r0=still?Math.min(still.b,i0):i0;
  const hz=(n-1)/((t[n-1]-t[0])/1000);
  return {
    id:Date.now()+Math.random(), at:Date.now(), club:clubKey, mode,
    msRaw: SL.speedModel(clubKey, omega, mode), omega:Math.round(omega), peak:Math.round(peak), obs:Math.round(obs), sat, method, seg:segm,
    back, down, ratio: back!=null && down ? back/down : null,
    face:Math.round(face*10)/10, faceOk, path:Math.round(path*10)/10, pathOk, aoa:Math.round(aoa*10)/10,
    arcTop: arcTop!=null?Math.round(arcTop):null, arcFin: arcFin!=null?Math.round(arcFin):null, len, hz:Math.round(hz),
    trace:{ t:t.slice(i0,i1+1).map(v=>v-t[i0]), d:(trOk? seg.raw : segm==="axis"?seg.d:seg.mag).slice(i0,i1+1),
            phi: trOk ? t.slice(i0,i1+1).map((_,j)=>{ const p=tr.phi[i0+j]; return p==null?null:+(p/DEG).toFixed(1); }) : null,
            start:start!=null?start-i0:null, top:top!=null?top-i0:null, imp:(trOk?tr.imp:imp)-i0, fin:trOk?tr.fin-i0:null, signed:segm==="axis" },
    rawSamples: Sm.slice(r0,i1+1).map(s=>[Math.round(s.t-Sm[r0].t), +s.x.toFixed(1), +s.y.toFixed(1), +s.z.toFixed(1)].concat(s.g?s.g.map(v=>+v.toFixed(2)):[]))
  };
};

// ---------- física del vuelo ----------
const AERO={cd0:0.24, cd1:0.2, a:1.8, b:1, clMax:0.3};
SL.LIES={tee:{speed:1,spin:1}, fairway:{speed:1,spin:1}, rough:{speed:0.9,spin:0.6}, bunker:{speed:0.75,spin:0.5}, green:{speed:1,spin:1}, road:{speed:1,spin:0.85}};
const GROUND={tee:{e:.25,mu:.25,k:1}, fairway:{e:.25,mu:.25,k:1}, rough:{e:.15,mu:.7,k:.6}, green:{e:.3,mu:.12,k:.95}, bunker:{e:.05,mu:2.5,k:.15}, road:{e:.4,mu:.16,k:1.08}};
// Plano D: la salida la manda sobre todo la cara; la curva, la diferencia entre cara y ruta
SL.launchFor = function(clubKey, ms, h, lie, hand){
  const c=SL.CLUBS[clubKey], L=SL.LIES[lie]||SL.LIES.fairway, hs=hand==="L"?-1:1; h=h||{};
  const f = h.faceOk ? clamp(h.face,-20,20) : 0, p = h.pathOk ? clamp(h.path,-15,15) : 0, aoa = (h.pathOk||h.aoaOk) ? clamp(h.aoa||0,-8,8) : 0;
  const woods = clubKey==="driver"||clubKey==="wood3";
  return { v: ms*c.smash*L.speed, launch: c.launch+(lie==="rough"?1.5:0)+aoa*(woods?0.7:0.4),
           spin: c.spin*(0.6+0.4*ms/c.vref)*L.spin*Math.max(0.6,1-0.035*aoa), dir:(0.78*f+0.22*p)*hs, tilt:clamp(1.9*(f-p),-32,32)*hs };
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
  return {pts, x, z, t, vx, vy, vz, apex, land:Math.atan2(-vy,Math.hypot(vx,vz))/DEG, spin:w*60/(2*Math.PI)};
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
  if(g==="green" && st.spin>7500 && st.land>40){
    const back=Math.min(2.2,(st.spin-7500)/1400), T2=Math.sqrt(2*back/(G.mu*9.81)), a2=2*back/(T2*T2), n2=Math.ceil(T2/0.03);
    for(let i=1;i<=n2;i++){ const tt=T2*i/n2, dd=a2*T2*tt-0.5*a2*tt*tt; pts.push({t:t+0.25+tt,x:x-hx*dd,y:0,z:z-hz*dd}); }
    x-=hx*back; z-=hz*back; t+=0.25+T2;
  }
  return {pts, x, z, t};
}
SL.simulateLocal = function(o, wind, groundAt){
  const f=flight(o, wind), g = groundAt ? groundAt(f.x, f.z) : "fairway";
  let r={pts:[], x:f.x, z:f.z, t:f.t};
  if(g!=="water" && g!=="ob") r=rollout(f, g==="tee"?"fairway":g);
  return {pts:f.pts.concat(r.pts), landT:f.t, carry:Math.hypot(f.x,f.z), landX:f.x, landZ:f.z, landG:g, x:r.x, z:r.z, apex:f.apex, ball:o.v, launch:o.launch, spin:o.spin, dur:r.t};
};

// ---------- swing sintético cinemático ----------
// Simula el teléfono girando como un palo real: address quieto, subida, bajada y final, con cara y ruta dadas.
// Devuelve giroscopio (°/s, marco del teléfono) y gravedad (convención Android: apunta hacia arriba).
SL.synthKin = function(o={}){
  const hz=o.hz||60, dt=1/hz, hs=o.hand==="L"?-1:1, U=[0,1,0], T=[0,0,1], R=cross(T,U);
  const s0=unit(add(scale(U,-1), scale(R,0.8*hs)));
  const zb=T, yb=o.flipPhone? s0 : scale(s0,-1), xb=cross(yb,zb), Q0=qbasis(xb,yb,zb), shaftBody=o.flipPhone?[0,1,0]:[0,-1,0];
  const A=unit(cross(s0,scale(T,-1)));
  const Ad=qrot(qaxis(U,-(o.path||0)*DEG*hs),A);
  const top=(o.top??245)*DEG, fin=(o.finish??255)*DEG, P=(o.peak??1700)*DEG, B=(o.back??820)/1000, D=(o.down??275)/1000;
  const p=Math.max(1.2,P*D/top), tau=fin/P, faceImp=(o.face||0)*DEG*hs, open=70*DEG*hs*Math.min(1,top/(200*DEG));
  const frames=[]; let tt=0;
  const push=(phi,qs,psi)=>{ frames.push({t:tt, q:qmul(qmul(qs,Q0),qaxis(shaftBody,psi))}); tt+=dt; };
  const stillN = o.noStill?0:Math.round(0.5/dt);
  for(let i=0;i<stillN;i++) push(0,[1,0,0,0],0);
  if(o.noStill) for(let i=0;i<Math.round(0.4/dt);i++){ const w=0.06*Math.sin(i/3); push(w,qaxis(A,w),0); }
  const nb=Math.round(B/dt);
  for(let i=1;i<=nb;i++){ const u=i/nb, phi=top*(1-Math.cos(Math.PI*u))/2; push(phi,qaxis(A,phi),open*(1-Math.cos(Math.PI*u))/2); }
  const qTop=qaxis(A,top), nd=Math.round(D/dt);
  for(let i=1;i<=nd;i++){ const u=i/nd, phi=top*(1-Math.pow(u,p)); push(phi,qmul(qaxis(Ad,phi-top),qTop),open+(faceImp-open)*Math.pow(u,1.6)); }
  const nf=Math.round(5*tau/dt);
  for(let i=1;i<=nf;i++){ const tau_i=i*dt, phi=-fin*(1-Math.exp(-tau_i/tau)); push(phi,qmul(qaxis(Ad,phi-top),qTop),faceImp-60*DEG*hs*(1-Math.exp(-tau_i/tau))); }
  for(let i=0;i<Math.round(0.3/dt);i++) frames.push({t:(tt+=dt)-dt, q:frames[frames.length-1].q});
  const out=[], bias=[1.6,-1.1,0.8], nz=()=>(Math.random()-0.5)*(o.noise??3), t0=(o.t0??performance.now()-4000);
  for(let i=0;i<frames.length-1;i++){
    const qa=frames[i].q, qb=frames[i+1].q; let dq=qmul(qconj(qa),qb); if(dq[0]<0) dq=dq.map(v=>-v);
    const ang=2*Math.acos(clamp(dq[0],-1,1)), sn=Math.sin(ang/2)||1, w=ang<1e-9?[0,0,0]:[dq[1]/sn*ang/dt, dq[2]/sn*ang/dt, dq[3]/sn*ang/dt];
    const qm=frames[i].q, gb=scale(qrot(qconj(qm),U),9.81*(o.ios?-1:1));
    const s={t:t0+frames[i].t*1000, x:w[0]/DEG+bias[0]+nz(), y:w[1]/DEG+bias[1]+nz(), z:w[2]/DEG+bias[2]+nz(), g:gb};
    if(o.clip) for(const k of ["x","y","z"]) s[k]=clamp(s[k],-o.clip,o.clip);
    out.push(s);
  }
  return out;
};
// swing sintético simple (sin gravedad), se conserva para pruebas
SL.synthSwing = function(o={}){
  const out=[], hz=o.hz||60, dt=1000/hz; let t=performance.now()-3000;
  const bias=[1.8,-1.2,0.9], U=unit([0.25,0.35,-0.9]), nz=()=> (Math.random()-.5)*(o.noise??4);
  const ub=o.backAxis ? unit(o.backAxis) : U;
  const push=(a,ty,axis)=>{ const A=axis||U; out.push({t, x:a*A[0]+bias[0]+nz(), y:a*A[1]+ty+bias[1]+nz(), z:a*A[2]+bias[2]+nz()}); t+=dt; };
  for(let i=0;i<Math.round(500/dt);i++) o.noStill?push(60*Math.sin(i/4),0):push(0,0);
  const B=o.back||820, D=o.down||275, P=o.peak||1750, open=80*Math.min(1,P/1500), face=o.face ?? 3;
  const nb=Math.round(B/dt), kb=(open*Math.PI/2)/(B/1000), bAmp=Math.max(55,Math.min(260,P*0.15));
  for(let i=0;i<nb;i++){ const s=Math.sin(Math.PI*i/nb); push(-bAmp*s, kb*s, ub); }
  const nd=Math.round(D/dt), kd=-(open-face)*3.4/(D/1000);
  for(let i=1;i<=nd;i++){ const p=Math.pow(i/nd,2.4); push(P*p, kd*p); }
  for(let i=1;i<25;i++){ const e=Math.exp(-i/5); push(P*e, kd*e*0.3); }
  if(o.clip) out.forEach(s=>{ for(const k of ["x","y","z"]) s[k]=clamp(s[k],-o.clip,o.clip); });
  return out;
};

})();
