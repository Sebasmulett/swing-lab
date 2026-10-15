// Swing Lab · modo cámara: detección de pose con MediaPipe, análisis del swing y repetición
(function(){
"use strict";
const SL=window.SL, DEG=SL.DEG;
const MP_VER="0.10.14";
const MP_URL=`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
const MODEL_URL="https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
// índices de MediaPipe Pose que usamos
const K={nose:0, ls:11, rs:12, le:13, re:14, lw:15, rw:16, lh:23, rh:24, lk:25, rk:26, la:27, ra:28};
const BONES=[["ls","rs"],["ls","le"],["le","lw"],["rs","re"],["re","rw"],["ls","lh"],["rs","rh"],["lh","rh"],["lh","lk"],["lk","la"],["rh","rk"],["rk","ra"]];

const mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const median=a=>{ const r=a.filter(v=>isFinite(v)).sort((x,y)=>x-y); if(!r.length) return NaN; const m=r.length>>1; return r.length%2?r[m]:(r[m-1]+r[m])/2; };

// Convierte el resultado de MediaPipe en un cuadro compacto (coordenadas en píxeles)
function toFrame(lm, wl, t, W, H){
  const f={t, w:W, h:H, p:{}, v:{}, m:{}};
  for(const [k,i] of Object.entries(K)){ const L=lm[i]; f.p[k]=[L.x*W, L.y*H]; f.v[k]=L.visibility??1; if(wl && wl[i]) f.m[k]=[wl[i].x, wl[i].y, wl[i].z]; }
  return f;
}
const visibleBody=f=>["ls","rs","lw","rw","lh","rh"].every(k=>f.v[k]>0.45);

// ---------------- utilidades numéricas ----------------
// mínimos cuadrados polinómicos (coeficientes a0..adeg)
function polyfit(xs, ys, ws, deg){
  const m=deg+1, A=Array.from({length:m},()=>new Float64Array(m)), b=new Float64Array(m);
  for(let i=0;i<xs.length;i++){ const w=ws?ws[i]:1, p=[1]; for(let k=1;k<=2*deg;k++) p[k]=p[k-1]*xs[i];
    for(let r=0;r<m;r++){ b[r]+=w*p[r]*ys[i]; for(let c=0;c<m;c++) A[r][c]+=w*p[r+c]; } }
  for(let c=0;c<m;c++){ let pv=c; for(let r=c+1;r<m;r++) if(Math.abs(A[r][c])>Math.abs(A[pv][c])) pv=r; [A[c],A[pv]]=[A[pv],A[c]]; [b[c],b[pv]]=[b[pv],b[c]];
    if(Math.abs(A[c][c])<1e-12) return null;
    for(let r=c+1;r<m;r++){ const f=A[r][c]/A[c][c]; for(let k=c;k<m;k++) A[r][k]-=f*A[c][k]; b[r]-=f*b[c]; } }
  const x=new Array(m).fill(0); for(let r=m-1;r>=0;r--){ let s=b[r]; for(let k=r+1;k<m;k++) s-=A[r][k]*x[k]; x[r]=s/A[r][r]; } return x;
}
// velocidad en el instante tc con un ajuste cúbico local (no toma el máximo de pasos ruidosos: no se infla con el ruido)
function localVel(T, P, tc, half, dims){
  const idx=[]; for(let i=0;i<T.length;i++) if(Math.abs(T[i]-tc)<=half) idx.push(i);
  if(idx.length<4) return null; const deg=idx.length>=6?3:2, xs=idx.map(i=>(T[i]-tc)/1000), ws=idx.map(i=>1-0.5*Math.abs(T[i]-tc)/half);
  const v=[]; for(let d=0;d<dims;d++){ const c=polyfit(xs, idx.map(i=>P[i][d]), ws, deg); if(!c) return null; v.push(c[1]); } return v;
}
const SINA_MIN=0.6; let HALF_MIN=75, HALF_K=2.05; SL._camTune=(a,b)=>{ HALF_MIN=a; HALF_K=b; };
// pico de una curva muestreada en 15 puntos: vértice de una parábola alrededor del máximo (no el máximo crudo, que se infla con el ruido)
function peakOf(fn){ const v=[]; for(let k=0;k<=14;k++){ const x=fn(k); v.push(x==null?NaN:x); }
  let m=-1; v.forEach((x,k)=>{ if(isFinite(x) && (m<0 || x>v[m])) m=k; }); if(m<0) return 0;
  const ks=[], ys=[]; for(let k=Math.max(0,m-3);k<=Math.min(14,m+3);k++) if(isFinite(v[k])){ ks.push(k-m); ys.push(v[k]); }
  if(ks.length<4) return v[m]; const c=polyfit(ks,ys,null,2); if(!c || c[2]>=0) return v[m];
  const kv=clamp(-c[1]/(2*c[2]),Math.min(...ks),Math.max(...ks)); return c[0]+c[1]*kv+c[2]*kv*kv; }

// ---------------- análisis de un swing grabado ----------------
// Mide la velocidad máxima de las manos en la bajada (como los sensores de mano tipo Enso de PING) y la pasa a velocidad del palo
// según el largo de TU brazo y el largo de ESE palo. También estima el punto bajo del arco y el ángulo de ataque.
// Largos típicos de palo (m) y posición típica de la bola delante del esternón (m)
SL.CLUB_LEN={driver:1.16, wood3:1.09, hybrid:1.02, iron5:0.965, iron7:0.94, iron9:0.915, wedge:0.90, sw:0.89};
SL.BALL_POS={driver:0.10, wood3:0.08, hybrid:0.06, iron5:0.05, iron7:0.03, iron9:0.02, wedge:0.01, sw:0.0};
const HAND_K=1.672;   // con brazo de 0,62 m y driver: palo ≈ 4,8 × manos (golfista promedio: manos 20 mph → palo ~98 mph)
SL.camRatio=(club, arm=0.62, grip="club")=>{ const L=SL.CLUB_LEN[club]||1; return HAND_K*(arm+L)/arm*(grip==="club"?1:0.92); };
SL.analyzePose=function(F, clubKey, opts={}){
  const grip=opts.grip||"empty", view=opts.view||"front";
  F=F.filter(f=>f && f.p && f.p.lw);
  if(F.length<15) return {error:"La cámara no captó suficientes cuadros del swing. Revisa la luz y que se vea todo tu cuerpo.", code:"few"};
  const n=F.length;
  // tiempos: si vienen del bucle de pantalla (con retraso variable) y no hubo cuadros perdidos, se regularizan
  let t=F.map(f=>f.t);
  if(!F[0].exact){ const d=[]; for(let i=1;i<n;i++) d.push(t[i]-t[i-1]); const dm=median(d);
    if(dm>0 && d.every(x=>x>0 && x<1.6*dm)){ const c=polyfit(t.map((_,i)=>i), t, null, 1); if(c){ const res=t.map((v,i)=>v-(c[0]+c[1]*i)), sd=Math.sqrt(res.reduce((a,b)=>a+b*b,0)/n); if(sd<0.45*dm) t=t.map((_,i)=>c[0]+c[1]*i); } } }
  const Hn=F.map(f=>mid(f.p.lw,f.p.rw)), Sh=F.map(f=>mid(f.p.ls,f.p.rs)), Hp=F.map(f=>mid(f.p.lh,f.p.rh));
  const Hs=Hn.map((h,i)=>{ const a=Hn[Math.max(0,i-1)], b=Hn[Math.min(n-1,i+1)]; return [(a[0]+2*h[0]+b[0])/4,(a[1]+2*h[1]+b[1])/4]; });
  const torsoPx=median(F.map((f,i)=>dist(Sh[i],Hp[i])));
  // metros por píxel: de las coordenadas en metros de MediaPipe; si no hay, un torso típico de 0,5 m
  const mpp=median(F.map(f=>{ if(!f.m||!f.m.ls||!f.m.lh) return NaN; const sm=[(f.m.ls[0]+f.m.rs[0])/2,(f.m.ls[1]+f.m.rs[1])/2], hm=[(f.m.lh[0]+f.m.rh[0])/2,(f.m.lh[1]+f.m.rh[1])/2];
    const px=dist(mid(f.p.ls,f.p.rs),mid(f.p.lh,f.p.rh)); return px>5 ? dist(sm,hm)/px : NaN; }));
  const mPerPx = isFinite(mpp) && mpp>0.0005 && mpp<0.02 ? mpp : 0.5/(torsoPx||200);
  const spd=Hs.map((h,i)=>{ const a=Hs[Math.max(0,i-1)], b=Hs[Math.min(n-1,i+1)], dt=(t[Math.min(n-1,i+1)]-t[Math.max(0,i-1)])/1000; return dt>0?dist(a,b)/dt:0; }); // px/s
  let vmax=0; for(let i=1;i<n;i++) if(spd[i]>spd[vmax]) vmax=i;
  if(spd[vmax]*mPerPx<1.2) return {error:"No vi un swing: las manos se movieron muy despacio.", code:"slow", obs:0};
  // address: tramo quieto antes del movimiento rápido
  const still=torsoPx*0.45; let a=-1;
  for(let i=vmax;i>=0;i--){ if(spd[i]<still){ let b=i; while(b>0 && spd[b-1]<still) b--; if(t[i]-t[b]>=250){ a=i; break; } i=b; } }
  if(a<0) a=0;
  // ángulo de las manos alrededor de los hombros, con las manos sin suavizar para no correr la cima ni el impacto
  const v0=[Hn[a][0]-Sh[a][0], Hn[a][1]-Sh[a][1]];
  const ang=[]; let prev=0, sign=0;
  for(let i=a;i<n;i++){ const v=[Hn[i][0]-Sh[i][0], Hn[i][1]-Sh[i][1]]; let th=Math.atan2(v0[0]*v[1]-v0[1]*v[0], v0[0]*v[0]+v0[1]*v[1]);
    while(th-prev>Math.PI) th-=2*Math.PI; while(th-prev<-Math.PI) th+=2*Math.PI; prev=th; ang[i]=th; if(!sign && Math.abs(th)>20*DEG) sign=Math.sign(th); }
  if(!sign) return {error:"No vi la subida del swing. Ponte de frente a la cámara, a 2 o 3 metros.", code:"noback", obs:0};
  for(let i=a;i<n;i++) ang[i]*=sign;
  let top=a; for(let i=a;i<=vmax;i++) if(ang[i]>ang[top]) top=i;
  { const mx=ang[top]; for(let i=top;i<=vmax;i++) if(ang[i]>=mx-1*DEG) top=i; }
  if(ang[top]<40*DEG) return {error:"El swing fue muy corto para medirlo. Sube más las manos.", code:"short", obs:0};
  let imp=-1; for(let i=top+1;i<n && t[i]-t[top]<=1200;i++) if(ang[i]<=0){ imp=i; break; }
  if(imp<0) return {error:"No vi el impacto: termina el swing dentro de la imagen.", code:"noimp", obs:0};
  const fr=ang[imp-1]/((ang[imp-1]-ang[imp])||1), tImp=t[imp-1]+(t[imp]-t[imp-1])*fr;
  let fin=imp; for(let i=imp;i<n && t[i]-tImp<=2200;i++) if(ang[i]<ang[fin]) fin=i;
  let st=a; while(st<top && ang[st]<2*DEG) st++;
  const tSt= st>a ? t[st-1]+(t[st]-t[st-1])*((2*DEG-ang[st-1])/((ang[st]-ang[st-1])||1)) : t[st];
  const tTop=t[top], back=tTop-tSt, down=tImp-tTop, okT=back>200 && back<3500 && down>80 && down<900;
  const fps=(n-1)/((t[n-1]-t[0])/1000);

  // ---- geometría personal: largo del brazo e inclinación del plano (de los cuadros quietos del address) ----
  const adr=[]; for(let i=Math.max(0,a-12);i<=a;i++) adr.push(i);
  const arm3=median(adr.map(i=>{ const m=F[i].m; if(!m||!m.ls||!m.lw||!m.rw) return NaN; const s=[(m.ls[0]+m.rs[0])/2,(m.ls[1]+m.rs[1])/2,(m.ls[2]+m.rs[2])/2], w=[(m.lw[0]+m.rw[0])/2,(m.lw[1]+m.rw[1])/2,(m.lw[2]+m.rw[2])/2];
    return Math.hypot(s[0]-w[0],s[1]-w[1],s[2]-w[2]); }));
  const armProj=median(adr.map(i=>dist(Hn[i],Sh[i])))*mPerPx;
  const arm=clamp(isFinite(arm3)&&arm3>0.3 ? arm3 : armProj/0.87, 0.5, 0.78);
  const sinA=view==="front" ? clamp(armProj/arm, SINA_MIN, 1) : 1;

  // ---- velocidad de las manos ----
  const half=Math.max(HALF_MIN, HALF_K*1000/fps), Hm=Hn.map(h=>[h[0]*mPerPx, h[1]*mPerPx]);
  const speedAt=tc=>{ const v=localVel(t, Hm, tc, half, 2); if(!v) return null; return view==="front" ? Math.hypot(v[0], v[1]/sinA) : Math.hypot(v[0],v[1]); };
  // 1) cámara 2D con ajuste local: máximo de la bajada y valor en el impacto
  // a pocos cuadros por segundo el ajuste local recorta un poco el pico: se compensa según los fps
  const fpsCorr=1+0.09*Math.pow(30/Math.max(20,fps),3);
  let e2dImp=(speedAt(tImp)||0)*fpsCorr; const e2dMax=peakOf(k=>speedAt(tTop+down*(0.35+0.65*k/14)))*fpsCorr;
  // 2) modelo de la bajada (ángulo = θ·(1−(τ/D)^p)): la velocidad angular en el impacto
  let eModel=null; { const ps=[]; for(let i=top+1;i<imp;i++){ const u=(t[i]-tTop)/down, y=1-ang[i]/ang[top]; if(u>0.25 && u<0.97 && y>0.03 && y<0.97) ps.push(Math.log(y)/Math.log(u)); }
    const p=median(ps); if(isFinite(p) && p>1 && p<8){ const rImp=dist(Hn[Math.max(top,imp-1)],Sh[Math.max(top,imp-1)])*mPerPx; eModel=ang[top]*p/(down/1000)*rImp; } }
  // 3) coordenadas 3D de MediaPipe (útiles sobre todo si la cámara está detrás)
  let e3d=null; { const W3=F.map(f=>f.m&&f.m.lw&&f.m.rw?[(f.m.lw[0]+f.m.rw[0])/2,(f.m.lw[1]+f.m.rw[1])/2,(f.m.lw[2]+f.m.rw[2])/2]:null);
    if(W3.every(Boolean)) e3d=peakOf(k=>{ const v=localVel(t,W3,tTop+down*(0.35+0.65*k/14),half*1.3,3); return v?Math.hypot(...v):null; })||null; }
  // fusión: de frente manda la imagen; desde atrás, el 3D y el modelo (el movimiento va hacia la cámara)
  let handMax, cands;
  if(view==="front"){ cands=[[e2dMax,1]]; if(e3d && Math.abs(e3d/e2dMax-1)<0.3) cands.push([e3d,0.25]); }
  else { cands=[]; if(e3d) cands.push([e3d,1]); if(eModel) cands.push([eModel*1.04,0.8]); if(!cands.length) cands.push([e2dMax,1]); }
  handMax=cands.reduce((s,c)=>s+c[0]*c[1],0)/cands.reduce((s,c)=>s+c[1],0);
  if(!(handMax>0.8)) return {error:"No pude medir la velocidad de las manos. Revisa que se vean bien en toda la bajada.", code:"nospeed", obs:0};
  const ratio=SL.camRatio(clubKey, arm, grip);

  // ---- punto bajo del arco y ángulo de ataque (solo de frente) ----
  let lowCm=null, aoa=0, aoaOk=false;
  if(view==="front"){
    const idx=[]; for(let i=Math.max(top,a);i<=fin;i++) if(Math.abs(ang[i])<=72*DEG) idx.push(i);
    const vI=localVel(t, Hm, tImp, half, 2), tg=vI ? Math.sign(vI[0]) : 0;
    if(idx.length>=5 && tg){
      const xs=idx.map(i=>Hn[i][0]), ys=idx.map(i=>Hn[i][1]), x0=Math.min(...xs), x1=Math.max(...xs);
      let best=null; for(let xc=x0; xc<=x1; xc+=0.5){ const u=xs.map(x=>(x-xc)*(x-xc)); const A=xs.map((_,k)=>[1,u[k],u[k]*u[k]]);
        // y = d0 + d2·u + d4·u² (curva simétrica alrededor del punto bajo)
        const c=lsq(A, ys); if(!c) continue; const res=ys.reduce((s,y,k)=>s+(y-(c[0]+c[1]*u[k]+c[2]*u[k]*u[k]))**2,0); if(!best || res<best.res) best={xc,res}; }
      const rms=best?Math.sqrt(best.res/idx.length):1e9, rPx=arm/mPerPx;
      if(best && rms<0.05*rPx && best.xc>x0+1 && best.xc<x1-1){
        const low=(best.xc-Sh[a][0])*tg*mPerPx, R=arm+(SL.CLUB_LEN[clubKey]||1), d=low-(SL.BALL_POS[clubKey]||0);
        lowCm=Math.round(low*100); aoa=Math.round(clamp(-Math.asin(clamp(d/R,-0.3,0.3))/DEG,-10,10)*10)/10; aoaOk=true; }
    }
  }

  // ---- calidad de la lectura ----
  const reasons=[]; let q=1; const pen=(k,why)=>{ if(k<0.97){ q*=k; reasons.push([k,why]); } };
  pen(fps>=50?1:fps>=38?0.88:fps>=27?0.75:0.5, `la cámara va a ${Math.round(fps)} cuadros por segundo (ideal 60)`);
  const nDown=imp-top; pen(nDown>=9?1:nDown>=6?0.88:nDown>=4?0.72:0.5, `solo ${nDown} cuadros en la bajada`);
  let drops=0; for(let i=top+1;i<=Math.min(n-1,imp+1);i++) if(F[i].k!=null && F[i-1].k!=null && F[i].k-F[i-1].k>1) drops+=F[i].k-F[i-1].k-1;
  pen(drops===0?1:drops<=2?0.85:0.65, `se perdieron ${drops} cuadros en la bajada (el teléfono no alcanzó a procesarlos)`);
  const vis=median(F.slice(top,imp+1).map(f=>Math.min(f.v.lw??1,f.v.rw??1)));
  pen(vis>=0.8?1:vis>=0.6?0.85:0.65, "las manos se ven poco en la bajada (luz o ropa del mismo color del fondo)");
  if(eModel && e2dImp){ const dis=Math.abs(eModel/e2dImp-1); pen(dis<0.15?1:dis<0.3?0.85:0.7, "el movimiento fue irregular para la cámara"); }
  if(view!=="front") pen(0.72, "desde atrás la velocidad es menos precisa: para medirla pon la cámara de frente");
  reasons.sort((x,y)=>x[0]-y[0]);
  const camQ={score:Math.round(q*100)/100, level:q>=0.75?"alta":q>=0.5?"media":"baja", why:reasons.map(r=>r[1])};

  // postura (vista de frente)
  let posture=null;
  if(view==="front"){
    const tgt=-Math.sign(Hs[top][0]-Hs[a][0]) || 1;
    const head=(F[imp].p.nose[0]-F[a].p.nose[0])*tgt*mPerPx*100, sway=(Hp[top][0]-Hp[a][0])*tgt*mPerPx*100, slide=(Hp[imp][0]-Hp[a][0])*tgt*mPerPx*100;
    const sw0=dist(F[a].p.ls,F[a].p.rs), swT=dist(F[top].p.ls,F[top].p.rs), hw0=dist(F[a].p.lh,F[a].p.rh), hwT=dist(F[top].p.lh,F[top].p.rh);
    const shTurn=Math.acos(clamp(swT/(sw0||1),0,1))/DEG, hipTurn=Math.acos(clamp(hwT/(hw0||1),0,1))/DEG;
    const headY=(F[imp].p.nose[1]-F[a].p.nose[1])*mPerPx*100;
    posture={head:Math.round(head), headY:Math.round(headY), sway:Math.round(sway), slide:Math.round(slide), shTurn:Math.round(shTurn), hipTurn:Math.round(hipTurn)};
  }
  const arcTop=Math.round(ang[top]/DEG), arcFin=Math.round(-ang[fin]/DEG);
  const i0=Math.max(a,st-4), i1=Math.min(n-1,fin+4);
  return {
    id:Date.now()+Math.random(), at:Date.now(), club:clubKey, source:"camera", mode:"camera", grip, view,
    msRaw: handMax*ratio, hand:+handMax.toFixed(2), handImp:+(e2dImp||0).toFixed(2), arm:+arm.toFixed(2), camRatio:+ratio.toFixed(2),
    est:{img:+e2dMax.toFixed(2), model:eModel?+eModel.toFixed(2):null, w3d:e3d?+e3d.toFixed(2):null},
    omega:null, peak:null, obs:Math.round(handMax*100)/100, sat:false, method:"pose", seg:"pose",
    back:okT?back:null, down:okT?down:null, ratio: okT?back/down:null,
    face:0, faceOk:false, path:0, pathOk:false, aoa, aoaOk, lowCm, arcTop, arcFin, len: arcTop<100?"medio":arcTop<150?"tres cuartos":"completo",
    posture, camQ, hz:Math.round(fps),
    trace:{ t:t.slice(i0,i1+1).map(v=>v-t[i0]), d:ang.slice(i0,i1+1).map(v=>v/DEG), phi:ang.slice(i0,i1+1).map(v=>+(v/DEG).toFixed(1)),
            start:st-i0, top:top-i0, imp:imp-i0, fin:fin-i0, signed:true },
    poseFrames: F.slice(Math.max(0,a-8), Math.min(n,fin+10)).map(f=>({t:f.t, w:f.w, h:f.h, p:f.p})),
    marks:{a, st, top, imp, fin, t0:F[Math.max(0,a-8)].t}
  };
};
// mínimos cuadrados genéricos A·c ≈ y
function lsq(A, y){ const m=A[0].length, N=Array.from({length:m},()=>new Float64Array(m)), b=new Float64Array(m);
  for(let i=0;i<A.length;i++) for(let r=0;r<m;r++){ b[r]+=A[i][r]*y[i]; for(let c=0;c<m;c++) N[r][c]+=A[i][r]*A[i][c]; }
  for(let c=0;c<m;c++){ let pv=c; for(let r=c+1;r<m;r++) if(Math.abs(N[r][c])>Math.abs(N[pv][c])) pv=r; [N[c],N[pv]]=[N[pv],N[c]]; [b[c],b[pv]]=[b[pv],b[c]];
    if(Math.abs(N[c][c])<1e-9) return null; for(let r=c+1;r<m;r++){ const f=N[r][c]/N[c][c]; for(let k=c;k<m;k++) N[r][k]-=f*N[c][k]; b[r]-=f*b[c]; } }
  const x=new Array(m).fill(0); for(let r=m-1;r>=0;r--){ let s=b[r]; for(let k=r+1;k<m;k++) s-=N[r][k]*x[k]; x[r]=s/N[r][r]; } return x; }

// ---------------- swing de cámara sintético (pruebas y golpe de prueba) ----------------
SL.synthPose=function(o={}){
  const fps=o.fps||30, dt=1/fps, W=o.W||480, H=o.H||640, ppm=o.ppm||210, hs=o.hand==="L"?-1:1;
  const cx=W/2, shY=H*0.33, hipY=shY+0.5*ppm, arm=0.62*ppm, sw0=0.4*ppm, hw0=0.32*ppm;
  const top=(o.top??165)*DEG, fin=(o.finish??175)*DEG, B=(o.back??850)/1000, D=(o.down??290)/1000, vh=o.handSpeed??7.5;
  const w=vh/0.62, p=Math.max(1.2,w*D/top), tau=fin/w;
  const out=[]; let tt=0; const t0=o.t0??0, nz=()=>(Math.random()-0.5)*(o.noise??2.5);
  const frame=(th,turn,sway,head,sh=0)=>{ const S=[cx+sway*ppm*0.5+sh*ppm*hs, shY], v=[-Math.sin(th)*hs, Math.cos(th)];
    const hand=[S[0]+v[0]*arm, S[1]+v[1]*arm], sw=sw0*Math.cos(turn), hw=hw0*Math.cos(turn*0.5);
    const P={nose:[cx+head*ppm+nz(), shY-0.28*ppm+nz()], ls:[S[0]+sw/2+nz(),shY+nz()], rs:[S[0]-sw/2+nz(),shY+nz()],
      le:[S[0]+v[0]*arm*0.5+8,S[1]+v[1]*arm*0.5], re:[S[0]+v[0]*arm*0.5-8,S[1]+v[1]*arm*0.5],
      lw:[hand[0]+4+nz(),hand[1]+nz()], rw:[hand[0]-4+nz(),hand[1]+nz()], lh:[cx+sway*ppm+hw/2+nz(),hipY+nz()], rh:[cx+sway*ppm-hw/2+nz(),hipY+nz()],
      lk:[cx+0.12*ppm,hipY+0.45*ppm], rk:[cx-0.12*ppm,hipY+0.45*ppm], la:[cx+0.14*ppm,hipY+0.9*ppm], ra:[cx-0.14*ppm,hipY+0.9*ppm]};
    const v1={}, m={}; for(const k in P){ v1[k]=0.95; m[k]=[(P[k][0]-cx)/ppm,(P[k][1]-hipY)/ppm,0]; }
    out.push({t:t0+tt*1000, w:W, h:H, p:P, v:v1, m}); tt+=dt; };
  const turnTop=(o.turn??80)*DEG, swayTop=(o.sway??0)/100, headImp=(o.head??0)/100*hs;
  for(let i=0;i<Math.round(0.7/dt);i++) frame(0,0,0,0);
  const nb=Math.round(B/dt); for(let i=1;i<=nb;i++){ const u=(1-Math.cos(Math.PI*i/nb))/2; frame(top*u,turnTop*u,-swayTop*hs*u,0); }
  const shI=o.shift??0;   // el centro del giro se mueve hacia el objetivo en la bajada (m): define el punto bajo
  const nd=Math.round(D/dt); for(let i=1;i<=nd;i++){ const u=i/nd; frame(top*(1-Math.pow(u,p)),turnTop*(1-u),-swayTop*hs*(1-u),headImp*u,shI*u*u*(3-2*u)); }
  const nf=Math.round(4*tau/dt); for(let i=1;i<=nf;i++){ const e=1-Math.exp(-i*dt/tau); frame(-fin*e,-turnTop*e,0,headImp,shI); }
  for(let i=0;i<Math.round(0.6/dt);i++) frame(-fin,-turnTop,0,headImp,shI);
  return out;
};

// ---------------- cámara en vivo ----------------
const Cam=SL.Cam={ on:false, loading:false, fps:0, camFps:0, model:null, drops:0, detectMs:0 };
let video, canvas, ctx, stream=null, landmarker=null, modelKind=null, raf=0, vfc=0, lastVT=-1, buf=[], trail=[], cb={}, opts={};
let st="idle", stillSince=null, capStart=0, quietSince=null, coolUntil=0, lastFrame=null, fpsTimes=[], replaying=null, mock=null;
let lastT=0, lastPF=null, detTimes=[], switching=false, mpMod=null, mpFiles=null;
const MODELS={ lite:"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
               full:"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task" };
async function loadModel(kind){
  if(landmarker && modelKind===kind) return;
  if(!mpMod){ mpMod=await import(`${MP_URL}/vision_bundle.mjs`); mpFiles=await mpMod.FilesetResolver.forVisionTasks(`${MP_URL}/wasm`); }
  const o={baseOptions:{modelAssetPath:MODELS[kind]||MODEL_URL, delegate:"GPU"}, runningMode:"VIDEO", numPoses:1, minPoseDetectionConfidence:0.5, minPosePresenceConfidence:0.5, minTrackingConfidence:0.5};
  let lm; try{ lm=await mpMod.PoseLandmarker.createFromOptions(mpFiles,o); }
  catch(e){ o.baseOptions.delegate="CPU"; lm=await mpMod.PoseLandmarker.createFromOptions(mpFiles,o); }
  if(landmarker) try{ landmarker.close(); }catch(_){}
  landmarker=lm; modelKind=kind; Cam.model=kind; detTimes=[];
}
Cam.supported=()=>!!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
Cam.setMock=fn=>{ mock=fn; };   // pruebas: función (t)=>cuadro
Cam.start=async function(o){
  opts=o||{}; cb=opts; video=document.getElementById("camVideo"); canvas=document.getElementById("camCanvas"); ctx=canvas.getContext("2d");
  Cam.loading=true; status("Cargando el detector de movimiento… (solo tarda la primera vez)","wait");
  try{
    if(!mock){
      // se pide la mayor cantidad de cuadros por segundo: es lo que más mejora la medición de la velocidad
      const s=await navigator.mediaDevices.getUserMedia({audio:false, video:{facingMode:opts.facing||"user", width:{ideal:640}, height:{ideal:480}, frameRate:{ideal:60, max:60}}});
      stream=s; video.srcObject=s; video.muted=true; video.playsInline=true; await video.play();
      const tr=s.getVideoTracks()[0], set=tr && tr.getSettings ? tr.getSettings() : {};
      Cam.camFps=Math.round(set.frameRate||0);
      await loadModel(opts.model==="lite"?"lite":"full");
    }
  }catch(e){ Cam.loading=false; stopStream(); status(e && e.name==="NotAllowedError" ? "Sin permiso para usar la cámara. Actívalo en los ajustes del navegador." : "No pude iniciar la cámara o el detector ("+(e&&e.message||e)+"). Revisa la conexión la primera vez.","bad"); cb.onError&&cb.onError(e); return false; }
  Cam.loading=false; Cam.on=true; st="seek"; buf=[]; trail=[]; coolUntil=0; stillSince=null; lastT=0; lastPF=null; Cam.drops=0;
  video.classList.toggle("mirror", (opts.facing||"user")==="user"); canvas.classList.toggle("mirror", (opts.facing||"user")==="user");
  schedule(); return true;
};
function stopStream(){ if(stream){ stream.getTracks().forEach(tr=>tr.stop()); stream=null; } if(video) video.srcObject=null; }
Cam.stop=function(){ Cam.on=false; cancelAnimationFrame(raf); raf=0; if(vfc && video && video.cancelVideoFrameCallback) try{ video.cancelVideoFrameCallback(vfc); }catch(_){} vfc=0; stopStream(); st="idle"; status(null); if(ctx) ctx.clearRect(0,0,canvas.width,canvas.height); };
Cam.pause=function(p){ Cam.paused=p; if(!p){ st="seek"; stillSince=null; coolUntil=performance.now()+500; } };

function status(text,kind){ cb.onStatus && cb.onStatus(text,kind); }
// Cada cuadro de video se procesa con su hora real de captura (requestVideoFrameCallback):
// el bucle de pantalla anota la hora con un retraso que varía y eso infla la velocidad.
function schedule(){ if(!Cam.on) return;
  if(!mock && video.requestVideoFrameCallback) vfc=video.requestVideoFrameCallback(onVideoFrame);
  else raf=requestAnimationFrame(onTick); }
function onTick(){ schedule(); if(!Cam.on) return;
  if(mock){ const f=mock(performance.now()); if(f) handle(f); return; }
  if(video.readyState<2 || video.currentTime===lastVT) return; lastVT=video.currentTime; detect(performance.now(), null, false); }
function onVideoFrame(now, meta){ schedule(); if(!Cam.on || switching) return;
  let t=now; if(meta){ if(meta.captureTime) t=meta.captureTime; else if(meta.mediaTime!=null){ if(Cam._off==null) Cam._off=now-meta.mediaTime*1000; t=meta.mediaTime*1000+Cam._off; } }
  let k=null; if(meta && meta.presentedFrames!=null){ k=meta.presentedFrames; if(lastPF!=null && k-lastPF>1) Cam.drops+=k-lastPF-1; lastPF=k; }
  detect(t, k, !!meta); }
function detect(t, k, exact){
  if(t<=lastT) t=lastT+0.5; lastT=t;
  let res=null; const d0=performance.now(); try{ res=landmarker.detectForVideo(video, t); }catch(e){ return; }
  const dms=performance.now()-d0; detTimes.push(dms); if(detTimes.length>40) detTimes.shift(); Cam.detectMs=Math.round(median(detTimes));
  // modelo automático: si el preciso no alcanza el ritmo de la cámara, pasa al rápido (perder cuadros es peor)
  if(opts.model==="auto" && modelKind==="full" && detTimes.length>=40 && median(detTimes)>Math.max(12, 920/Math.max(15,Cam.camFps||30))){ switching=true; status("Ajustando el detector a tu teléfono…","wait");
    loadModel("lite").then(()=>{ switching=false; status("Quieto en address…","wait"); }).catch(()=>{ switching=false; }); }
  const W=video.videoWidth, H=video.videoHeight; let f;
  if(res && res.landmarks && res.landmarks[0]) f=toFrame(res.landmarks[0], res.worldLandmarks&&res.worldLandmarks[0], t, W, H);
  else f={t, w:W, h:H, none:true};
  f.exact=exact; if(k!=null) f.k=k; handle(f);
}
function handle(f){
  const now=f.t; fpsTimes.push(now); if(fpsTimes.length>40) fpsTimes.shift(); if(fpsTimes.length>5) Cam.fps=Math.round((fpsTimes.length-1)/((fpsTimes[fpsTimes.length-1]-fpsTimes[0])/1000));
  lastFrame=f; if(!replaying) draw(f); step(f);
}
// máquina de estados: buscar cuerpo → quieto en address → swing → final
function step(f){
  if(Cam.paused) return;
  const now=f.t;
  if(f.none || !visibleBody(f)){ if(st!=="capture"){ st="seek"; stillSince=null; status("No te veo completo. Ponte de frente a 2 o 3 metros, con buena luz.","bad"); } return; }
  buf.push(f); while(buf.length && now-buf[0].t>6500) buf.shift();
  const torso=dist(mid(f.p.ls,f.p.rs),mid(f.p.lh,f.p.rh))||1, hand=mid(f.p.lw,f.p.rw);
  const prev=buf[buf.length-2]; let v=0; if(prev && prev.p){ const h0=mid(prev.p.lw,prev.p.rw); v=dist(hand,h0)/Math.max(0.001,(now-prev.t)/1000)/torso; }
  Cam.speed=v; trail.push({t:now, p:hand}); while(trail.length && now-trail[0].t>1400) trail.shift();
  if(now<coolUntil) return;
  if(st==="seek"||st==="ready"){
    if(st==="seek") status("Quieto en address…","wait");
    if(v<0.3){ if(stillSince==null) stillSince=now; else if(st==="seek" && now-stillSince>=450){ st="ready"; status("¡Listo! Haz tu swing","ready"); cb.onReady&&cb.onReady(); } }
    else if(v>0.6) stillSince=null;
    if(v>2.2){ st="capture"; capStart=now; quietSince=null; status("Leyendo swing…","wait"); }
  } else if(st==="capture"){
    if(v<0.35){ if(quietSince==null) quietSince=now; } else quietSince=null;
    if((quietSince!=null && now-quietSince>=450 && now-capStart>600) || now-capStart>3800){
      const frames=buf.slice(); st="seek"; stillSince=null; coolUntil=now+1200; trail=[];
      cb.onSwing && cb.onSwing(frames);
    }
  }
}
function fit(){ const w=canvas.clientWidth, h=canvas.clientHeight, d=Math.min(2,window.devicePixelRatio||1);
  if(canvas.width!==Math.round(w*d) || canvas.height!==Math.round(h*d)){ canvas.width=Math.round(w*d); canvas.height=Math.round(h*d); } return {w,h,d}; }
// la imagen se muestra con object-fit: cover; mismo encuadre para el esqueleto
function mapper(f,w,h){ const s=Math.max(w/f.w,h/f.h), ox=(w-f.w*s)/2, oy=(h-f.h*s)/2; return p=>[ox+p[0]*s, oy+p[1]*s]; }
function skeleton(f, w, h, col, lw, map){
  const M=map||mapper(f,w,h); ctx.lineCap="round"; ctx.strokeStyle=col; ctx.lineWidth=lw;
  for(const [a,b] of BONES){ if(!f.p[a]||!f.p[b]) continue; const A=M(f.p[a]), Bp=M(f.p[b]); ctx.beginPath(); ctx.moveTo(A[0],A[1]); ctx.lineTo(Bp[0],Bp[1]); ctx.stroke(); }
  if(f.p.nose){ const N=M(f.p.nose); ctx.fillStyle=col; ctx.beginPath(); ctx.arc(N[0],N[1],lw*1.6,0,Math.PI*2); ctx.fill(); }
  return M;
}
function draw(f){
  const {w,h,d}=fit(); ctx.setTransform(d,0,0,d,0,0); ctx.clearRect(0,0,w,h);
  if(f.none || !f.p) return;
  const M=skeleton(f,w,h,"rgba(255,210,63,0.95)",4);
  if(trail.length>1){ ctx.strokeStyle="rgba(255,255,255,0.8)"; ctx.lineWidth=3; ctx.beginPath(); trail.forEach((q,i)=>{ const P=M(q.p); i?ctx.lineTo(P[0],P[1]):ctx.moveTo(P[0],P[1]); }); ctx.stroke(); }
}
// repetición en cámara lenta del último swing (solo el esqueleto)
Cam.replay=function(res, speed=0.3, onEnd){
  canvas=document.getElementById("camCanvas"); ctx=canvas.getContext("2d");
  const F=res.poseFrames; if(!F||!F.length) return; const mk=res.marks, t0=F[0].t, T=F[F.length-1].t-t0;
  const start=performance.now(); replaying=true; canvas.hidden=false; canvas.classList.add("replay");
  // el texto no puede ir en espejo: se quita el espejo del lienzo y se espeja el dibujo a mano
  const mir=canvas.classList.contains("mirror"); if(mir) canvas.classList.remove("mirror");
  const restore=()=>{ if(mir) canvas.classList.add("mirror"); };
  const hands=F.map(f=>mid(f.p.lw,f.p.rw));
  const tick=()=>{ if(!replaying) return; const el=(performance.now()-start)*speed; let i=0; while(i<F.length-1 && F[i+1].t-t0<el) i++;
    const {w,h,d}=fit(); ctx.setTransform(d,0,0,d,0,0); ctx.fillStyle="rgba(8,24,18,0.92)"; ctx.fillRect(0,0,w,h);
    const M0=mapper(F[i],w,h), M=mir?(p=>{ const q=M0(p); return [w-q[0],q[1]]; }):M0;
    ctx.strokeStyle="rgba(255,255,255,0.35)"; ctx.lineWidth=2; ctx.beginPath(); hands.forEach((p,j)=>{ const P=M(p); j?ctx.lineTo(P[0],P[1]):ctx.moveTo(P[0],P[1]); }); ctx.stroke();
    ctx.strokeStyle="#ffd23f"; ctx.lineWidth=3.5; ctx.beginPath(); hands.slice(0,i+1).forEach((p,j)=>{ const P=M(p); j?ctx.lineTo(P[0],P[1]):ctx.moveTo(P[0],P[1]); }); ctx.stroke();
    skeleton(F[i],w,h,"#ffffff",4,M);
    const rel=k=>Math.max(0,Math.min(F.length-1,k-(mk.a-8>0?mk.a-8:0)));
    for(const [k,lab] of [[mk.top,"arriba"],[mk.imp,"impacto"]]){ const P=M(hands[rel(k)]); ctx.fillStyle="#ffd23f"; ctx.beginPath(); ctx.arc(P[0],P[1],5,0,Math.PI*2); ctx.fill();
      ctx.font="600 12px Figtree, system-ui, sans-serif"; ctx.fillText(lab,P[0]+8,P[1]-6); }
    ctx.fillStyle="#fff"; ctx.font="700 14px Figtree, system-ui, sans-serif"; ctx.fillText(`Cámara lenta ×${speed}`,12,h-14);
    if(el>=T+400 || !replaying){ replaying=null; canvas.classList.remove("replay"); restore(); onEnd&&onEnd(); return; } requestAnimationFrame(tick); };
  tick();
};
Cam.stopReplay=()=>{ replaying=null; if(canvas) canvas.classList.remove("replay"); };
Cam.replaying=()=>!!replaying;
})();
