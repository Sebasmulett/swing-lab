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
// De perfil (cámara detrás) el hombro, la cadera y la muñeca del lado lejano quedan tapados por el cuerpo:
// basta con ver bien el lado cercano de cada par.
let VIEW="front";
const vis2=(f,a,b,th)=>Math.max(f.v[a]??0,f.v[b]??0)>th;
const visibleBody=f=> VIEW==="behind" ? vis2(f,"ls","rs",0.5) && vis2(f,"lh","rh",0.5) && vis2(f,"lw","rw",0.4) && Math.min(f.v.lw??0,f.v.rw??0)>0.12
                                        : ["ls","rs","lw","rw","lh","rh"].every(k=>f.v[k]>0.45);

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
  let idx=[]; for(let i=0;i<T.length;i++) if(Math.abs(T[i]-tc)<=half) idx.push(i);
  // si faltan cuadros (el detector perdió algunos), toma los 3 más cercanos a cada lado aunque estén más lejos
  const before=idx.filter(i=>T[i]<=tc).length, after=idx.length-before;
  if(before<2 || after<2){ let j=0; while(j<T.length && T[j]<=tc) j++; const sel=[]; for(let k=Math.max(0,j-3);k<Math.min(T.length,j+3);k++) sel.push(k);
    if(sel.length>=4 && j-3>=0 && j+3<=T.length){ idx=sel; half=Math.max(half,...sel.map(i=>Math.abs(T[i]-tc)))+1; } }
  if(idx.length<4) return null; const deg=idx.length>=6?3:2, xs=idx.map(i=>(T[i]-tc)/1000), ws=idx.map(i=>1-0.5*Math.abs(T[i]-tc)/half);
  const v=[]; for(let d=0;d<dims;d++){ const c=polyfit(xs, idx.map(i=>P[i][d]), ws, deg); if(!c) return null; v.push(c[1]); } return v;
}
const SINA_MIN=0.6; let DTL_K=0.8, DTL_SND=1.13, DTL_SND_B=1.01; SL._dtlK=v=>{ DTL_K=v; };
// la profundidad 3D es ruidosa: a pocos cuadros por segundo se atenúa la ruta medida (estimador con encogimiento)
const PATH_SHRINK=fps=>fps>=50?0.8:fps>=35?0.7:0.6; let HALF_MIN=75, HALF_K=2.05; SL._camTune=(a,b)=>{ HALF_MIN=a; HALF_K=b; };
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
SL.CLUB_LEN={driver:1.16, wood3:1.09, hybrid:1.02, iron5:0.965, iron7:0.94, iron9:0.915, wedge:0.90, gw:0.895, sw:0.89, lw:0.885};
SL.BALL_POS={driver:0.10, wood3:0.08, hybrid:0.06, iron5:0.05, iron7:0.03, iron9:0.02, wedge:0.01, gw:0.005, sw:0.0, lw:0.0};
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
    if(dm>0 && d.every(x=>x>0 && x<1.6*dm)){ const c=polyfit(t.map((_,i)=>i), t, null, 1); if(c){ const res=t.map((v,i)=>v-(c[0]+c[1]*i)), sd=Math.sqrt(res.reduce((a,b)=>a+b*b,0)/n); if(sd<0.3*dm && res.every(r=>Math.abs(r)<0.6*dm)) t=t.map((_,i)=>c[0]+c[1]*i); } } }
  const Hn=F.map(f=>mid(f.p.lw,f.p.rw)), Sh=F.map(f=>mid(f.p.ls,f.p.rs)), Hp=F.map(f=>mid(f.p.lh,f.p.rh));
  // saltos imposibles de las manos (el detector se confunde un cuadro): se reemplazan por el punto medio de sus vecinos
  { const tor=median(F.map((f,i)=>dist(Sh[i],Hp[i])))||100; for(let i=1;i<n-1;i++){ const m=mid(Hn[i-1],Hn[i+1]), gap=dist(Hn[i-1],Hn[i+1]);
      if(dist(Hn[i],m)>1.5*gap+0.35*tor) Hn[i]=m; } }
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
  // largo del brazo (hombros a manos) en el address, en 3D si hay coordenadas en metros
  const adr=[]; for(let i=Math.max(0,a-12);i<=a;i++) adr.push(i);
  const arm3=median(adr.map(i=>{ const m=F[i].m; if(!m||!m.ls||!m.lw||!m.rw) return NaN; const s=[(m.ls[0]+m.rs[0])/2,(m.ls[1]+m.rs[1])/2,(m.ls[2]+m.rs[2])/2], w=[(m.lw[0]+m.rw[0])/2,(m.lw[1]+m.rw[1])/2,(m.lw[2]+m.rw[2])/2];
    return Math.hypot(s[0]-w[0],s[1]-w[1],s[2]-w[2]); }));
  const armProj=median(adr.map(i=>dist(Hn[i],Sh[i])))*mPerPx;
  const arm=clamp(isFinite(arm3)&&arm3>0.3 ? arm3 : armProj/0.87, 0.5, 0.78);
  if(view==="behind"){
    // Desde atrás el plano del swing se ve de canto: las manos suben y bajan por la línea manos-hombros.
    // La altura sobre esa línea da el ángulo real de giro: p = r·(1 − cos θ)
    const dv=[Sh[a][0]-Hn[a][0], Sh[a][1]-Hn[a][1]], dl=Math.hypot(...dv)||1, ux=dv[0]/dl, uy=dv[1]/dl;
    for(let i=a;i<n;i++){ const p=((Hn[i][0]-Hn[a][0])*ux+(Hn[i][1]-Hn[a][1])*uy)*mPerPx; ang[i]=Math.acos(clamp(1-p/arm,-1,1)); }
    sign=1;
  } else {
  for(let i=a;i<n;i++){ const v=[Hn[i][0]-Sh[i][0], Hn[i][1]-Sh[i][1]]; let th=Math.atan2(v0[0]*v[1]-v0[1]*v[0], v0[0]*v[0]+v0[1]*v[1]);
    while(th-prev>Math.PI) th-=2*Math.PI; while(th-prev<-Math.PI) th+=2*Math.PI; prev=th; ang[i]=th; if(!sign && Math.abs(th)>20*DEG) sign=Math.sign(th); }
  if(!sign) return {error:"No vi la subida del swing. Ponte de frente a la cámara, a 2 o 3 metros.", code:"noback", obs:0};
  for(let i=a;i<n;i++) ang[i]*=sign; }
  let top=a; for(let i=a;i<=vmax;i++) if(ang[i]>ang[top]) top=i;
  { const mx=ang[top]; for(let i=top;i<=vmax;i++) if(ang[i]>=mx-1*DEG) top=i; }
  if(ang[top]<40*DEG) return {error:"El swing fue muy corto para medirlo. Sube más las manos.", code:"short", obs:0};
  let imp=-1, tImp;
  if(view==="behind"){
    // desde atrás la subida y el final se ven del mismo lado: el impacto es cuando las manos vuelven más cerca del address
    let m=-1; for(let i=top+1;i<n && t[i]-t[top]<=900;i++){ if(m<0 || ang[i]<ang[m]) m=i; if(m>=0 && ang[i]>ang[m]+15*DEG) break; }
    if(m>0 && ang[m]<0.4*ang[top]){ imp=m; const y0=ang[m-1], y1=ang[m], y2=ang[Math.min(n-1,m+1)], den=y0-2*y1+y2;
      const off=den>1e-6?clamp(0.5*(y0-y2)/den,-0.5,0.5):0; tImp=t[m]+off*((t[Math.min(n-1,m+1)]-t[m-1])/2); }
  } else { for(let i=top+1;i<n && t[i]-t[top]<=1200;i++) if(ang[i]<=0){ imp=i; break; }
    if(imp>0){ const fr=ang[imp-1]/((ang[imp-1]-ang[imp])||1); tImp=t[imp-1]+(t[imp]-t[imp-1])*fr; } }
  // impacto por sonido (micrófono): si el golpe se oyó cerca de donde la imagen lo ve, manda el sonido (es exacto al milisegundo)
  let impSrc="imagen";
  const tA=opts.tImpact;
  if(isFinite(tA) && tA>t[top]+80 && tA<t[top]+900 && (imp<0 || Math.abs(tA-tImp)<Math.max(110, 2.6*1000/Math.max(20,(n-1)/((t[n-1]-t[0])/1000))))){
    tImp=tA; impSrc="sonido"; let j=top+1; while(j<n-1 && t[j]<tA) j++; imp=j; }
  if(imp<0) return {error:"No vi el impacto: termina el swing dentro de la imagen.", code:"noimp", obs:0};
  let fin=imp; for(let i=imp;i<n && t[i]-tImp<=2200;i++) if(view==="behind"?ang[i]>ang[fin]:ang[i]<ang[fin]) fin=i;
  let st=a; while(st<top && ang[st]<2*DEG) st++;
  const tSt= st>a ? t[st-1]+(t[st]-t[st-1])*((2*DEG-ang[st-1])/((ang[st]-ang[st-1])||1)) : t[st];
  const tTop=t[top], back=tTop-tSt, down=tImp-tTop, okT=back>200 && back<3500 && down>80 && down<900;
  const fps=(n-1)/((t[n-1]-t[0])/1000);

  // ---- geometría personal: largo del brazo e inclinación del plano (de los cuadros quietos del address) ----
  const sinA=view==="front" ? clamp(armProj/arm, SINA_MIN, 1) : 1;

  // ---- velocidad de las manos ----
  const half=Math.max(HALF_MIN, HALF_K*1000/fps), Hm=Hn.map(h=>[h[0]*mPerPx, h[1]*mPerPx]);
  const speedAt=tc=>{ const v=localVel(t, Hm, tc, half, 2); if(!v) return null; return view==="front" ? Math.hypot(v[0], v[1]/sinA) : Math.hypot(v[0],v[1]); };
  // 1) cámara 2D con ajuste local: máximo de la bajada y valor en el impacto
  // a pocos cuadros por segundo el ajuste local recorta un poco el pico: se compensa según los fps
  const fpsCorr=1+0.09*Math.pow(30/Math.max(20,fps),3);
  let e2dImp=(speedAt(tImp)||0)*fpsCorr; const e2dMax=peakOf(k=>speedAt(tTop+down*(0.35+0.65*k/14)))*fpsCorr;
  // cuándo llegan las manos a su máximo: en jugadores hábiles, unos 50 ms antes del impacto (Neal et al. 2007), y luego frenan
  // mientras el palo se suelta (en los sensores ENSO de PING, ~9-10 mph de freno en los más rápidos del tour)
  let handPeakMs=null; { const NS=24, vals=[]; let bi=-1, bv=-1;
    for(let k=0;k<=NS;k++){ const tc=tTop+down*0.35+(down*0.65+40)*k/NS, v=speedAt(tc); vals.push(v); if(v!=null && v>bv){ bv=v; bi=k; } }
    if(bi>=0){ let off=0; if(bi>0 && bi<NS && vals[bi-1]!=null && vals[bi+1]!=null){ const den=vals[bi-1]-2*bv+vals[bi+1]; if(den<0) off=clamp(0.5*(vals[bi-1]-vals[bi+1])/den,-0.5,0.5); }
      handPeakMs=Math.round(tImp-(tTop+down*0.35+(down*0.65+40)*(bi+off)/NS)); } }
  const handDrop= view==="front" && e2dImp>0 && e2dMax>0 ? clamp(1-e2dImp/e2dMax,0,0.7) : null;
  // 2) modelo de la bajada (ángulo = θ·(1−(τ/D)^p)): la velocidad angular en el impacto
  let eModel=null; { const ps=[]; for(let i=top+1;i<imp;i++){ const u=(t[i]-tTop)/down, y=1-ang[i]/ang[top]; if(u>0.25 && u<0.97 && y>0.03 && y<0.97) ps.push(Math.log(y)/Math.log(u)); }
    const p=median(ps); if(isFinite(p) && p>1 && p<8){ const rImp=dist(Hn[Math.max(top,imp-1)],Sh[Math.max(top,imp-1)])*mPerPx; eModel=ang[top]*p/(down/1000)*rImp; } }
  // 3) coordenadas 3D de MediaPipe (útiles sobre todo si la cámara está detrás)
  let e3d=null; { const W3=F.map(f=>f.m&&f.m.lw&&f.m.rw?[(f.m.lw[0]+f.m.rw[0])/2,(f.m.lw[1]+f.m.rw[1])/2,(f.m.lw[2]+f.m.rw[2])/2]:null);
    if(W3.every(Boolean)) e3d=peakOf(k=>{ const v=localVel(t,W3,tTop+down*(0.35+0.65*k/14),half*1.3,3); return v?Math.hypot(...v):null; })||null; }
  // fusión: de frente manda la imagen; desde atrás, el 3D y el modelo (el movimiento va hacia la cámara)
  let handMax, cands;
  if(view==="front"){ cands=[[e2dMax,1]]; if(e3d && Math.abs(e3d/e2dMax-1)<0.3) cands.push([e3d,0.25]); }
  else {
    // desde atrás: la altura de las manos sobre la línea del plano da el ángulo real de giro (p = r·(1 − cos θ));
    // con su ritmo en la bajada se obtiene la velocidad angular en el impacto
    let eDTL=null; { const T0=ang[top], qs=[];
      for(let i=top+1;i<imp;i++){ const u=(t[i]-tTop)/down, y=1-ang[i]/T0; if(u>0.25 && u<0.95 && y>0.03 && y<0.97) qs.push(Math.log(y)/Math.log(u)); }
      const q=median(qs); if(isFinite(q) && q>1 && q<8 && T0>0.6) eDTL=arm*T0*q/(down/1000)*DTL_K*(impSrc==="sonido"?(opts.tImpactSrc==="behind"?DTL_SND_B:DTL_SND):1); }
    cands=[]; if(eDTL) cands.push([eDTL,1]); if(e3d && (!eDTL || Math.abs(e3d/eDTL-1)<0.35)) cands.push([e3d,0.6]); if(!cands.length && eModel) cands.push([eModel*1.04,0.8]); if(!cands.length) cands.push([e2dMax*1.6,1]); }
  handMax=cands.reduce((s,c)=>s+c[0]*c[1],0)/cands.reduce((s,c)=>s+c[1],0);
  if(!(handMax>0.8)) return {error:"No pude medir la velocidad de las manos. Revisa que se vean bien en toda la bajada.", code:"nospeed", obs:0};
  const ratio=SL.camRatio(clubKey, arm, grip);

  // ---- punto bajo del arco y ángulo de ataque (solo de frente) ----
  // ---- ruta del swing (de adentro hacia afuera o al revés), de la dirección de las manos en el impacto ----
  // De frente: la profundidad sale de las coordenadas 3D de MediaPipe (más ruidosa, por eso se atenúa);
  // desde atrás: el movimiento hacia afuera se ve directo en la imagen. La cara se asume cuadrada al objetivo.
  let path=0, pathOk=false, pathRaw=null;
  if(view==="front"){
    const W3=F.map(f=>f.m&&f.m.lw&&f.m.rw?[(f.m.lw[0]+f.m.rw[0])/2,(f.m.lw[1]+f.m.rw[1])/2,(f.m.lw[2]+f.m.rw[2])/2]:null);
    if(W3.every(Boolean)){ const v=localVel(t,W3,tImp,Math.max(half*1.6,110),3);
      if(v && Math.abs(v[0])>1.5){ pathRaw=Math.atan2(-v[2],Math.abs(v[0]))/DEG; path=Math.round(clamp(pathRaw*PATH_SHRINK(fps),-12,12)*10)/10; pathOk=true; } }
  } else {
    const out=Math.sign(Hn[a][0]-Hp[a][0])||1, v=localVel(t,Hm,tImp,half,2);
    if(v){ const along=Math.max(2,handMax*0.92); pathRaw=Math.atan2(v[0]*out,along)/DEG; path=Math.round(clamp(pathRaw,-12,12)*10)/10; pathOk=true; }
  }
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
  if(view!=="front") pen(impSrc==="sonido"?0.93:0.88, "desde atrás la velocidad es un poco menos precisa que de frente");
  if(view==="front" && handPeakMs!=null && (handPeakMs<-35 || handPeakMs>230)) pen(0.85, "la velocidad de tus manos no tuvo su pico justo antes del impacto, como es normal: pudo fallar la lectura");
  if(opts.shutter===false && fps<27) pen(0.95, "con poca luz el teléfono alarga la exposición y baja los cuadros por segundo: busca más luz");
  reasons.sort((x,y)=>x[0]-y[0]);
  const camQ={score:Math.round(q*100)/100, level:q>=0.75?"alta":q>=0.5?"media":"baja", why:reasons.map(r=>r[1])};

  // postura (vista de frente)
  let posture=null;
  // la postura se lee promediando cuadros vecinos (address: los cuadros quietos; impacto y cima: ±1 cuadro), no de un solo cuadro ruidoso
  const avgOf=(get,i0,i1)=>{ let x=0,y=0,c=0; for(let j=Math.max(0,i0);j<=Math.min(n-1,i1);j++){ const v=get(j); if(!v) continue; x+=v[0]; y+=v[1]; c++; } return c?[x/c,y/c]:get(clamp(i0,0,n-1)); };
  const atA=g=>avgOf(g,a-4,a), atI=g=>avgOf(g,imp-1,imp+1), atT=g=>avgOf(g,top-1,top+1);
  const nose=j=>F[j].p.nose, hipC=j=>Hp[j], shC=j=>Sh[j], wid=(k1,k2)=>j=>[dist(F[j].p[k1],F[j].p[k2]),0];
  if(view==="front"){
    const tgt=-Math.sign(Hs[top][0]-Hs[a][0]) || 1;
    const nA=atA(nose), nI=atI(nose), hA=atA(hipC);
    const head=(nI[0]-nA[0])*tgt*mPerPx*100, sway=(atT(hipC)[0]-hA[0])*tgt*mPerPx*100, slide=(atI(hipC)[0]-hA[0])*tgt*mPerPx*100;
    const sw0=atA(wid("ls","rs"))[0], swT=atT(wid("ls","rs"))[0], hw0=atA(wid("lh","rh"))[0], hwT=atT(wid("lh","rh"))[0];
    const shTurn=Math.acos(clamp(swT/(sw0||1),0,1))/DEG, hipTurn=Math.acos(clamp(hwT/(hw0||1),0,1))/DEG;
    const headY=(nI[1]-nA[1])*mPerPx*100;
    posture={head:Math.round(head), headY:Math.round(headY), sway:Math.round(sway), slide:Math.round(slide), shTurn:Math.round(shTurn), hipTurn:Math.round(hipTurn)};
  } else {
    // Desde atrás: ángulo de la columna, si te levantas o adelantas la cadera hacia la bola (extensión temprana),
    // la cabeza y dónde quedan las manos arriba respecto a la línea manos-hombros del address (el plano)
    const out=Math.sign(Hn[a][0]-Hp[a][0])||1;
    const spineOf=(S,P)=>Math.atan2((S[0]-P[0])*out, P[1]-S[1])/DEG;   // >0: inclinado hacia la bola
    const hA=atA(hipC), hI=atI(hipC), nA=atA(nose), nI=atI(nose);
    const spineA=spineOf(atA(shC),hA), spineI=spineOf(atI(shC),hI);
    const hipThrust=(hI[0]-hA[0])*out*mPerPx*100, headDrop=(nI[1]-nA[1])*mPerPx*100, headIn=(nI[0]-nA[0])*out*mPerPx*100;
    const L0=Hn[a], L1=Sh[a], dl=[L1[0]-L0[0],L1[1]-L0[1]], ln=Math.hypot(...dl)||1;
    // signo: >0 = del lado de la bola / por encima de la línea (con la línea subiendo hacia el cuerpo, ambos son el mismo lado)
    const planeTop=-((Hn[top][0]-L0[0])*dl[1]-(Hn[top][1]-L0[1])*dl[0])/ln*out*mPerPx*100;   // >0: manos del lado de la bola (subida vertical)
    // Bucle de las manos: a la misma altura sobre la línea del plano, ¿la bajada pasa por fuera (por encima) o por dentro (por debajo) de la subida?
    // Por fuera = "por encima" (over the top), tiende a ruta de afuera hacia adentro; por dentro = la bajada se aplana, tiende a de adentro hacia afuera.
    const perp=H=>-((H[0]-L0[0])*dl[1]-(H[1]-L0[1])*dl[0])/ln*out, along=H=>((H[0]-L0[0])*dl[0]+(H[1]-L0[1])*dl[1])/ln;
    let loop=null; { const sTop=along(Hn[top]);
      if(sTop>0.3*ln){ const bk=[], dn=[]; for(let i=st;i<=top;i++) bk.push([along(Hn[i]),perp(Hn[i])]); for(let i=top;i<=imp;i++) dn.push([along(Hn[i]),perp(Hn[i])]);
        // perpendicular interpolada a una altura dada (toma el primer cruce en la subida y el primero en la bajada)
        const at=(seq,sv,up)=>{ for(let k=1;k<seq.length;k++){ const a0=seq[k-1], a1=seq[k]; if(up? (a0[0]<=sv && a1[0]>=sv) : (a0[0]>=sv && a1[0]<=sv)){ const f=(sv-a0[0])/((a1[0]-a0[0])||1e-9); return a0[1]+(a1[1]-a0[1])*f; } } return null; };
        const d=[]; for(let k=0;k<=10;k++){ const sv=sTop*(0.25+0.5*k/10), pb=at(bk,sv,true), pd=at(dn,sv,false); if(pb!=null && pd!=null) d.push(pd-pb); }
        if(d.length>=6) loop=median(d)*mPerPx*100; } }
    posture={dtl:true, spine:Math.round(spineA), spineChg:Math.round(spineI-spineA), hipThrust:Math.round(hipThrust), headDrop:Math.round(headDrop), headIn:Math.round(headIn), planeTop:Math.round(planeTop), loop:loop==null?null:Math.round(loop),
      lines:{hand:L0, sh:L1, hip:Hp[a]}};
  }
  const arcTop=Math.round(ang[top]/DEG), arcFin=Math.round((view==="behind"?ang[fin]:-ang[fin])/DEG);
  const i0=Math.max(a,st-4), i1=Math.min(n-1,fin+4);
  return {
    id:Date.now()+Math.random(), at:Date.now(), club:clubKey, source:"camera", mode:"camera", grip, view,
    msRaw: handMax*ratio, hand:+handMax.toFixed(2), handImp:+(e2dImp||0).toFixed(2), arm:+arm.toFixed(2), camRatio:+ratio.toFixed(2),
    est:{img:+e2dMax.toFixed(2), model:eModel?+eModel.toFixed(2):null, w3d:e3d?+e3d.toFixed(2):null},
    omega:null, peak:null, obs:Math.round(handMax*100)/100, sat:false, method:"pose", seg:"pose",
    back:okT?back:null, down:okT?down:null, ratio: okT?back/down:null,
    face:0, faceOk:false, path, pathOk, pathRaw:pathRaw==null?null:+pathRaw.toFixed(1), faceAssumed:true, aoa, aoaOk, lowCm, arcTop, arcFin, len: arcTop<100?"medio":arcTop<150?"tres cuartos":"completo",
    posture, camQ, hz:Math.round(fps), impSrc, tImpAbs:tImp, tTopAbs:t[top], handPeakMs, handDrop:handDrop==null?null:+handDrop.toFixed(2),
    trace:{ t:t.slice(i0,i1+1).map(v=>v-t[i0]), d:ang.slice(i0,i1+1).map(v=>v/DEG), phi:ang.slice(i0,i1+1).map(v=>+(v/DEG).toFixed(1)),
            start:st-i0, top:top-i0, imp:imp-i0, fin:fin-i0, signed:true },
    poseFrames: F.slice(Math.max(0,a-8), Math.min(n,fin+10)).map(f=>({t:f.t, w:f.w, h:f.h, p:f.p, img:f.img||null})),
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
    // ruta: las manos van hacia la cámara (z negativo) después del punto bajo si es de adentro hacia afuera
    if(o.path){ for(const k of ["lw","rw"]) m[k][2]=-Math.tan(o.path*DEG)*((P[k][0]-S[0])/ppm)*hs; }
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
Cam.setView=v=>{ opts.view=v; VIEW=v||"front"; Cam.addrLines=null; };
Cam.supported=()=>!!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
Cam.setMock=fn=>{ mock=fn; };
Cam.setMockStream=s=>{ stream=s; };   // pruebas: un video de lienzo en lugar de la cámara   // pruebas: función (t)=>cuadro
Cam.start=async function(o){
  opts=o||{}; cb=opts; VIEW=opts.view||"front"; video=document.getElementById("camVideo"); canvas=document.getElementById("camCanvas"); ctx=canvas.getContext("2d");
  Cam.loading=true; status("Cargando el detector de movimiento… (solo tarda la primera vez)","wait");
  try{
    if(!mock){
      // se pide la mayor cantidad de cuadros por segundo: es lo que más mejora la medición de la velocidad
      const vc={facingMode:opts.facing||"user", width:{ideal:640}, height:{ideal:480}, frameRate:{ideal:60, max:60}};
      // con el micrófono (sin filtros de voz, que borran los golpes secos) se oye el impacto
      let s=null; Cam.mic=false;
      if(opts.sound && SL.Sound){ try{ s=await navigator.mediaDevices.getUserMedia({video:vc, audio:{echoCancellation:false, noiseSuppression:false, autoGainControl:false}}); }catch(e){ s=null; } }
      if(!s) s=await navigator.mediaDevices.getUserMedia({audio:false, video:vc});
      stream=s; video.srcObject=new MediaStream(s.getVideoTracks()); video.muted=true; video.playsInline=true; await video.play();
      const at=s.getAudioTracks()[0]; if(at && opts.audioCtx) Cam.mic=await SL.Sound.start(new MediaStream([at]), opts.audioCtx);
      const tr=s.getVideoTracks()[0], set=tr && tr.getSettings ? tr.getSettings() : {};
      Cam.camFps=Math.round(set.frameRate||0);
      await loadModel(opts.model==="lite"?"lite":"full");
      if(opts.shutter!=="off") tuneShutter(tr).then(()=>{ try{ const s2=tr.getSettings(); Cam.camFps=Math.round(s2.frameRate||Cam.camFps); }catch(e){} }).catch(()=>{});
      else { Cam.shutter=null; Cam.shutterTxt="automático"; }
    }
  }catch(e){ Cam.loading=false; stopStream(); status(e && e.name==="NotAllowedError" ? "Sin permiso para usar la cámara. Actívalo en los ajustes del navegador." : "No pude iniciar la cámara o el detector ("+(e&&e.message||e)+"). Revisa la conexión la primera vez.","bad"); cb.onError&&cb.onError(e); return false; }
  if(!mock) window.addEventListener("devicemotion",onMotion);
  Cam.loading=false; Cam.on=true; st="seek"; buf=[]; trail=[]; coolUntil=0; stillSince=null; lastT=0; lastPF=null; Cam.drops=0;
  video.classList.toggle("mirror", (opts.facing||"user")==="user"); canvas.classList.toggle("mirror", (opts.facing||"user")==="user");
  schedule(); return true;
};
// Obturador rápido: con la exposición automática, en interiores el teléfono expone 1/30 s o más (las manos, a 9 m/s,
// se corren 30 cm en una sola foto y el detector las pierde) y además baja a 15-20 cuadros por segundo.
// Donde el navegador lo permite (Chrome en Android) se fija una exposición corta y se sube la sensibilidad;
// si la imagen queda oscura se alarga un paso, y si ni así alcanza se vuelve a la automática.
const EXPS=[1/1000, 1/500, 1/250, 1/125];
function luma(){ try{ const c=luma.c||(luma.c=document.createElement("canvas")); c.width=48; c.height=36; const x=c.getContext("2d",{willReadFrequently:true});
  x.drawImage(video,0,0,48,36); const d=x.getImageData(0,0,48,36).data; let s=0; for(let i=0;i<d.length;i+=4) s+=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; return s/(d.length/4); }catch(e){ return NaN; } }
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function tuneShutter(tr){
  Cam.shutter=null; Cam.shutterTxt="automático";
  if(!tr || !tr.getCapabilities || !tr.applyConstraints) return;
  let cap={}; try{ cap=tr.getCapabilities()||{}; }catch(e){ return; }
  const adv={}; if(cap.focusMode && cap.focusMode.includes && cap.focusMode.includes("continuous")) adv.focusMode="continuous";
  const okExp=cap.exposureMode && cap.exposureMode.includes && cap.exposureMode.includes("manual") && cap.exposureTime && cap.exposureTime.max>0;
  if(!okExp){ if(adv.focusMode) try{ await tr.applyConstraints({advanced:[adv]}); }catch(e){} return; }
  const toU=sec=>clamp(Math.round(sec/100e-6), cap.exposureTime.min||1, cap.exposureTime.max);   // exposureTime va en unidades de 100 µs
  const isoMax=cap.iso&&cap.iso.max ? Math.min(cap.iso.max, 1600) : null;
  let k=1, iso=isoMax;
  for(let step=0; step<6 && stream && tr.readyState!=="ended"; step++){
    const c=Object.assign({}, adv, {exposureMode:"manual", exposureTime:toU(EXPS[k])}); if(iso) c.iso=iso;
    try{ await tr.applyConstraints({advanced:[c]}); }catch(e){ break; }
    await wait(450); const L=luma();
    if(!isFinite(L)) break;
    if(L>=70 && L<=215){ Cam.shutter=EXPS[k]; Cam.shutterTxt="1/"+Math.round(1/EXPS[k])+" s"; return; }
    if(L>215){ if(iso && cap.iso.min && iso>cap.iso.min*1.5){ iso=Math.max(cap.iso.min, Math.round(iso/2)); continue; } if(k>0){ k--; continue; } Cam.shutter=EXPS[k]; Cam.shutterTxt="1/"+Math.round(1/EXPS[k])+" s"; return; }
    if(k<EXPS.length-1){ k++; continue; }
    break;
  }
  // poca luz: vuelve a la exposición automática
  try{ await tr.applyConstraints({advanced:[Object.assign({}, adv, {exposureMode:"continuous"})]}); }catch(e){}
  Cam.shutter=false; Cam.shutterTxt="automático (poca luz)";
}
// nivel del teléfono (con la gravedad del acelerómetro): ladeado, la línea del plano y la columna salen torcidas
function onMotion(e){ const g=e.accelerationIncludingGravity; if(!g || g.x==null) return;
  const ang=(screen.orientation && screen.orientation.angle) ?? (window.orientation||0), land=Math.abs(ang)%180===90;
  const a=land?g.y:g.x, b=land?g.x:g.y; if(Math.abs(g.z)>7 || Math.abs(b)<5){ Cam.tilt=null; return; }
  const t=Math.atan2(a,Math.abs(b))/DEG; Cam.tilt = Cam.tilt==null ? t : Cam.tilt*0.85+t*0.15; }
// ---------------- video de cada swing ----------------
// Se graba desde que quedas quieto en el address hasta el final del swing (con el sonido del golpe si el micrófono está activo).
const Rec={cur:null};
function recMime(){ if(!window.MediaRecorder) return null; for(const m of ["video/mp4;codecs=avc1","video/webm;codecs=vp9","video/webm;codecs=vp8","video/webm","video/mp4"]) try{ if(MediaRecorder.isTypeSupported(m)) return m; }catch(e){} return ""; }
Cam.canRecord=()=>recMime()!==null;
function recStart(){ if(!stream || opts.record===false || Rec.cur || Cam.paused) return; const mime=recMime(); if(mime===null) return;
  try{ const r=new MediaRecorder(stream, Object.assign({videoBitsPerSecond:2500000}, mime?{mimeType:mime}:{})), cur={r, chunks:[], mime:r.mimeType||mime||"video/webm", start:0, t0:performance.now()};
    r.ondataavailable=e=>{ if(e.data && e.data.size) cur.chunks.push(e.data); }; r.onstart=()=>{ cur.start=performance.now(); };
    r.start(); Rec.cur=cur; }catch(e){ Rec.cur=null; } }
// termina una grabación ya separada (así pausar la cámara para ver el tiro no la borra)
function recFinish(cur, keep){ if(!cur) return Promise.resolve(null);
  return new Promise(res=>{ let done=false; const fin=v=>{ if(!done){ done=true; res(v); } };
    cur.r.onstop=()=>fin(keep&&cur.chunks.length?{blob:new Blob(cur.chunks,{type:cur.mime.split(";")[0]}), mime:cur.mime, start:cur.start||cur.t0}:null); setTimeout(()=>fin(null),3000);
    try{ cur.r.stop(); }catch(e){ fin(null); } }); }
function recStop(keep){ const cur=Rec.cur; Rec.cur=null; return recFinish(cur, keep); }
Cam.lastClip=null;
function stopStream(){ recStop(false); window.removeEventListener("devicemotion",onMotion); Cam.tilt=null; if(SL.Sound) SL.Sound.stop(); if(stream){ stream.getTracks().forEach(tr=>tr.stop()); stream=null; } if(video) video.srcObject=null; }
Cam.stop=function(){ Cam.on=false; cancelAnimationFrame(raf); raf=0; if(vfc && video && video.cancelVideoFrameCallback) try{ video.cancelVideoFrameCallback(vfc); }catch(_){} vfc=0; stopStream(); st="idle"; lockUntil=0; status(null); if(ctx) ctx.clearRect(0,0,canvas.width,canvas.height); };
// pausa la lectura (para apuntar o mientras vuela la bola); al seguir, da unos segundos para ponerse en posición
Cam.pause=function(p, grace=500, msg=null){ Cam.paused=p; trail=[]; if(p){ recStop(false); st="seek"; stillSince=null; readyHip=null; return; }
  st="seek"; stillSince=null; readyHip=null; buf=[]; coolUntil=performance.now()+grace; Cam.graceMsg=msg; if(msg) status(msg+" "+Math.ceil(grace/1000),"wait"); };

let lockUntil=0;
function status(text,kind){ if(performance.now()<lockUntil) return; Cam.state=kind; cb.onStatus && cb.onStatus(text,kind); }
// mensaje que se queda unos segundos (por ejemplo, por qué no se midió un swing)
Cam.flash=(text,kind,ms=2500)=>{ lockUntil=0; status(text,kind); lockUntil=performance.now()+ms; };
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
// Fotos pequeñas de cada cuadro (anillo de lienzos reutilizados) para la repetición con video real y los cuadros clave
const RING_N=210, THUMB=168; let ring=[], ringI=0, ringSeq=0;
function grab(){ if(!video || !video.videoWidth || opts.thumbs===false) return null;
  const vw=video.videoWidth, vh=video.videoHeight, k=THUMB/Math.max(vw,vh), w=Math.round(vw*k), h=Math.round(vh*k);
  let c=ring[ringI]; if(!c){ c=document.createElement("canvas"); ring[ringI]=c; } if(c.width!==w||c.height!==h){ c.width=w; c.height=h; }
  try{ c.getContext("2d").drawImage(video,0,0,w,h); }catch(e){ return null; }
  ringI=(ringI+1)%RING_N; c._seq=++ringSeq; return c; }
// al terminar un swing, sus fotos pasan a ser del swing (el anillo sigue con lienzos nuevos)
function keepThumbs(frames){ const own=new Set(); for(const f of frames){ if(f.img && f.img._seq===f.imgSeq) own.add(f.img); else f.img=null; }
  if(own.size) ring=ring.map(c=>own.has(c)?null:c); }
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
  f.exact=exact; if(k!=null) f.k=k; const im=grab(); if(im){ f.img=im; f.imgSeq=im._seq; } handle(f);
}
function handle(f){
  const now=f.t; fpsTimes.push(now); if(fpsTimes.length>40) fpsTimes.shift(); if(fpsTimes.length>5) Cam.fps=Math.round((fpsTimes.length-1)/((fpsTimes[fpsTimes.length-1]-fpsTimes[0])/1000));
  lastFrame=f; if(!replaying) draw(f); step(f);
}
// Guía de colocación: qué falta para que la cámara te lea bien
function missingHint(f){
  if(f.none || !f.v) return "No te veo: ponte frente a la cámara, a 2 o 3 metros";
  if((f.v.la??1)<0.45 && (f.v.ra??1)<0.45) return "No veo tus pies: aleja el teléfono o apúntalo un poco más abajo";
  if((f.v.nose??1)<0.45) return "No veo tu cabeza: aleja el teléfono o apúntalo un poco más arriba";
  if(VIEW==="behind"){ if(!vis2(f,"lw","rw",0.4)) return "No veo bien tus manos: más luz o ropa que contraste con el fondo";
    if(!vis2(f,"ls","rs",0.5)||!vis2(f,"lh","rh",0.5)) return "No te veo completo: el teléfono detrás de ti, a unos 3 metros, con todo tu cuerpo en la imagen"; }
  else if(["lw","rw"].some(k=>f.v[k]<0.45)) return "No veo bien tus manos: más luz o ropa que contraste con el fondo";
  return "No te veo completo: ponte a 2 o 3 metros, con todo el cuerpo en la imagen"; }
function setupHint(f){
  const p=f.p, W=f.w||1, H=f.h||1, sw=dist(p.ls,p.rs), tor=dist(mid(p.ls,p.rs),mid(p.lh,p.rh))||1, r=sw/tor;
  const top=Math.min(p.nose[1], p.ls[1]), bot=Math.max(p.la?p.la[1]:0, p.ra?p.ra[1]:0), hgt=(bot-top)/H, cx=mid(p.lh,p.rh)[0]/W;
  if(hgt>0.93) return "Muy cerca: aleja el teléfono un paso";
  if(hgt<0.42) return "Muy lejos: acércate un poco a la cámara";
  if(cx<0.22 || cx>0.78) return "Muévete al centro de la imagen";
  if(opts.view!=="behind" && r<0.42) return "Ponte de frente a la cámara (el objetivo a un lado)";
  if(opts.view==="behind" && r>0.62) return "Para la vista desde atrás, la cámara va detrás de ti, mirando al objetivo";
  if(opts.view==="behind"){ const hy=mid(p.lw,p.rw)[1]/H; if(hy<0.35) return "Baja el teléfono: a la altura de tus manos"; if(hy>0.85) return "Sube el teléfono: a la altura de tus manos";
    // sobre la línea de tiro los pies se ven uno detrás del otro; si se separan de lado, la cámara quedó corrida
    if((f.v.la??0)>0.5 && (f.v.ra??0)>0.5 && p.la && p.ra){ const out=Math.sign(mid(p.lw,p.rw)[0]-mid(p.lh,p.rh)[0])||1, far=p.la[1]<p.ra[1]?p.la:p.ra, near=far===p.la?p.ra:p.la, k=(far[0]-near[0])*out/tor;
      if(k>0.5) return "Corre el teléfono un poco hacia tu lado: debe quedar sobre la línea de tiro, detrás de tus manos";
      if(k<-0.25) return "Corre el teléfono un poco hacia la bola: debe quedar sobre la línea de tiro, detrás de tus manos"; } }
  if(Cam.tilt!=null && Math.abs(Cam.tilt)>7) return `Endereza el teléfono: está ladeado ${Math.round(Math.abs(Cam.tilt))}°`;
  return null; }
// máquina de estados: buscar cuerpo → quieto en address → swing → final
// Solo se dispara desde "listo" (quieto en address): caminar o acomodarse ya no se confunde con un swing.
const coreVisible=f=> VIEW==="behind" ? vis2(f,"ls","rs",0.4) && vis2(f,"lh","rh",0.4) : ["ls","rs","lh","rh"].every(k=>f.v[k]>0.45);
let readyHip=null, viewVotes=0;
function step(f){
  const now=f.t;
  if(Cam.paused){ trail=[]; return; }
  // durante el swing las muñecas se ven borrosas: basta con ver hombros y caderas (las manos se estiman igual)
  const ok=!f.none && (st==="capture" ? coreVisible(f) && ["lw","rw"].every(k=>f.v[k]>0.1) : visibleBody(f));
  if(!ok){ if(st!=="capture"){ st="seek"; stillSince=null; readyHip=null; trail=[]; status(missingHint(f),"bad"); } return; }
  buf.push(f); while(buf.length && now-buf[0].t>6500) buf.shift();
  const torso=dist(mid(f.p.ls,f.p.rs),mid(f.p.lh,f.p.rh))||1, hand=mid(f.p.lw,f.p.rw), hip=mid(f.p.lh,f.p.rh);
  const prev=buf[buf.length-2]; let v=0; if(prev && prev.p){ const h0=mid(prev.p.lw,prev.p.rw); v=dist(hand,h0)/Math.max(0.001,(now-prev.t)/1000)/torso; }
  Cam.speed=v;
  if(now<coolUntil){ trail=[]; if(Cam.graceMsg) status(Cam.graceMsg+" "+Math.ceil((coolUntil-now)/1000),"wait"); return; }
  if(st==="seek"||st==="ready"){
    trail=[];
    if(st==="seek"){ const hn=v<0.6?setupHint(f):null; status(hn||"Quieto en address…", hn?"bad":"wait"); }
    if(v<0.3){ if(stillSince==null) stillSince=now; else if(st==="seek" && now-stillSince>=450){ st="ready"; readyHip=hip; status("¡Listo! Haz tu swing","ready"); recStart(); cb.onReady&&cb.onReady(); } }
    // si esperas mucho en el address, el video vuelve a empezar (para que no quede largo)
    if(st==="ready" && Rec.cur && performance.now()-Rec.cur.t0>9000){ recStop(false).then(()=>{ if(st==="ready") recStart(); }); }
    else if(v>0.6) stillSince=null;
    // si caminas (la cadera se va del sitio) vuelve a esperar el address
    if(st==="ready" && readyHip && dist(hip,readyHip)>0.4*torso && v<2.2){ st="seek"; stillSince=null; readyHip=null; recStop(false); }
    if(st==="ready" && v>2.2){ st="capture"; capStart=now; quietSince=null; status("Leyendo swing…","wait"); }
    // ¿de frente o de perfil? si no coincide con lo elegido, avisa a la app (cambia sola de vista)
    // solo en una postura de address (manos abajo): sosteniendo el final los hombros se ven angostos y parecería "de perfil"
    const handsLow=mid(f.p.lw,f.p.rw)[1]>mid(f.p.ls,f.p.rs)[1]+0.55*torso;
    if(v<0.5 && handsLow){ const r=dist(f.p.ls,f.p.rs)/(dist(mid(f.p.ls,f.p.rs),mid(f.p.lh,f.p.rh))||1), guess=r<0.38?"behind":r>0.6?"front":null;
      viewVotes=guess && guess!==(opts.view||"front") ? viewVotes+1 : 0;
      if(viewVotes>=45){ viewVotes=0; cb.onView && cb.onView(guess); } }
    if(st==="ready" && (opts.view==="behind")) Cam.addrLines={hand:mid(f.p.lw,f.p.rw), sh:mid(f.p.ls,f.p.rs), hip:mid(f.p.lh,f.p.rh)};
    if(st==="seek") Cam.addrLines=null;
  } else if(st==="capture"){
    // fase del trazo: subida hasta el punto más alto; bajada cuando las manos ya cayeron un poco desde ahí
    const minY=trail.reduce((m,q)=>Math.min(m,q.p[1]),hand[1]), down=trail.length>3 && hand[1]>minY+0.12*torso && trail.some(q=>q.p[1]<=minY+0.02*torso && q.t<now-60);
    trail.push({t:now, p:hand, d:down || (trail.length && trail[trail.length-1].d)}); while(trail.length && now-trail[0].t>1600) trail.shift();
    if(v<0.35){ if(quietSince==null) quietSince=now; } else quietSince=null;
    if((quietSince!=null && now-quietSince>=450 && now-capStart>600) || now-capStart>3800){
      { const cur=Rec.cur; Rec.cur=null; Cam.lastClip=cur ? new Promise(r=>setTimeout(()=>recFinish(cur,true).then(r),350)) : null; }
      const frames=buf.slice(); keepThumbs(frames); st="seek"; stillSince=null; readyHip=null; coolUntil=now+1200; Cam.graceMsg=null; trail=[];
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
  if(opts.view==="behind" && Cam.addrLines) planeLines(Cam.addrLines,M,w,h);
  if(trail.length>1){ ctx.lineWidth=3.5; ctx.lineCap="round";
    for(let i=1;i<trail.length;i++){ const A=M(trail[i-1].p), B=M(trail[i].p); ctx.strokeStyle=trail[i].d?"rgba(255,210,63,0.95)":"rgba(120,220,255,0.95)"; ctx.beginPath(); ctx.moveTo(A[0],A[1]); ctx.lineTo(B[0],B[1]); ctx.stroke(); } }
}
// líneas guía de la vista desde atrás: la columna (cadera-hombros) y el plano (manos-hombros), alargadas
function planeLines(L,M,w,h){ const ext=(a,b,k)=>[a[0]+(b[0]-a[0])*k, a[1]+(b[1]-a[1])*k];
  const seg=(a,b,col,dash)=>{ const A=M(a), B=M(b); ctx.save(); ctx.strokeStyle=col; ctx.lineWidth=2.5; ctx.setLineDash(dash||[]); ctx.beginPath(); ctx.moveTo(A[0],A[1]); ctx.lineTo(B[0],B[1]); ctx.stroke(); ctx.restore(); };
  seg(ext(L.hand,L.sh,-0.6), ext(L.hand,L.sh,1.9), "rgba(120,220,255,0.9)", [8,6]);   // plano
  seg(ext(L.hip,L.sh,-0.2), ext(L.hip,L.sh,1.5), "rgba(255,120,120,0.9)", [4,5]); }  // columna
// repetición en cámara lenta del último swing (solo el esqueleto)
Cam.replay=function(res, speed=0.3, onEnd){
  canvas=document.getElementById("camCanvas"); ctx=canvas.getContext("2d");
  const F=res.poseFrames; if(!F||!F.length) return; const mk=res.marks, t0=F[0].t, T=F[F.length-1].t-t0;
  const start=performance.now(); replaying=true; canvas.hidden=false; canvas.classList.add("replay");
  // el texto no puede ir en espejo: se quita el espejo del lienzo y se espeja el dibujo a mano
  const mir=canvas.classList.contains("mirror"); if(mir) canvas.classList.remove("mirror");
  const restore=()=>{ if(mir) canvas.classList.add("mirror"); };
  const hands=F.map(f=>mid(f.p.lw,f.p.rw)), rel=k=>Math.max(0,Math.min(F.length-1,k-(mk.a-8>0?mk.a-8:0)));
  const tick=()=>{ if(!replaying) return; const el=(performance.now()-start)*speed; let i=0; while(i<F.length-1 && F[i+1].t-t0<el) i++;
    const {w,h,d}=fit(); ctx.setTransform(d,0,0,d,0,0);
    const M0=mapper(F[i],w,h), M=mir?(p=>{ const q=M0(p); return [w-q[0],q[1]]; }):M0;
    // la foto real del cuadro (si la hay), un poco oscurecida para que se lean las líneas
    if(F[i].img){ const s=Math.max(w/F[i].w,h/F[i].h), ox=(w-F[i].w*s)/2, oy=(h-F[i].h*s)/2; ctx.save(); if(mir){ ctx.translate(w,0); ctx.scale(-1,1); }
      ctx.drawImage(F[i].img, ox, oy, F[i].w*s, F[i].h*s); ctx.restore(); ctx.fillStyle="rgba(8,24,18,0.35)"; ctx.fillRect(0,0,w,h); }
    else { ctx.fillStyle="rgba(8,24,18,0.92)"; ctx.fillRect(0,0,w,h); }
    const topI=rel(mk.top), impI=rel(mk.imp);
    ctx.strokeStyle="rgba(255,255,255,0.3)"; ctx.lineWidth=2; ctx.beginPath(); hands.forEach((p,j)=>{ const P=M(p); j?ctx.lineTo(P[0],P[1]):ctx.moveTo(P[0],P[1]); }); ctx.stroke();
    const path=(j0,j1,col)=>{ if(j1<j0) return; ctx.strokeStyle=col; ctx.lineWidth=3.5; ctx.beginPath(); for(let j=j0;j<=j1;j++){ const P=M(hands[j]); j===j0?ctx.moveTo(P[0],P[1]):ctx.lineTo(P[0],P[1]); } ctx.stroke(); };
    path(0,Math.min(i,topI),"#78dcff"); if(i>topI) path(topI,i,"#ffd23f");
    skeleton(F[i],w,h,"#ffffff",4,M);
    if(res.posture && res.posture.lines) planeLines(res.posture.lines,M,w,h);

    for(const [k,lab] of [[mk.top,"arriba"],[mk.imp,"impacto"]]){ const P=M(hands[rel(k)]); ctx.fillStyle="#ffd23f"; ctx.beginPath(); ctx.arc(P[0],P[1],5,0,Math.PI*2); ctx.fill();
      ctx.font="600 12px Figtree, system-ui, sans-serif"; ctx.fillText(lab,P[0]+8,P[1]-6); }
    ctx.fillStyle="#fff"; ctx.font="700 14px Figtree, system-ui, sans-serif"; ctx.fillText(`Cámara lenta ×${speed}`,12,h-14);
    ctx.font="600 12px Figtree, system-ui, sans-serif"; ctx.textAlign="right"; ctx.fillStyle="#78dcff"; ctx.fillText("━ subida",w-74,h-14); ctx.fillStyle="#ffd23f"; ctx.fillText("━ bajada",w-12,h-14); ctx.textAlign="left";
    if(el>=T+400 || !replaying){ replaying=null; canvas.classList.remove("replay"); restore(); onEnd&&onEnd(); return; } requestAnimationFrame(tick); };
  tick();
};
// Cuadros clave del swing (address, arriba, impacto, final) con la foto real, el esqueleto, el camino de las manos y las líneas
Cam.keyFrames=function(res, cv, mir){
  const F=res&&res.poseFrames; if(!F||!F.length||!cv) return false; const mk=res.marks, base=mk.a-8>0?mk.a-8:0, rel=k=>Math.max(0,Math.min(F.length-1,k-base));
  const dpr=window.devicePixelRatio||1, W=cv.clientWidth, H=cv.clientHeight; if(!W||!H) return false; cv.width=W*dpr; cv.height=H*dpr;
  const old=ctx; ctx=cv.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);
  try{
    const hands=F.map(f=>mid(f.p.lw,f.p.rw)), keys=[["Address",rel(mk.a)],["Arriba",rel(mk.top)],["Impacto",rel(mk.imp)],["Final",rel(mk.fin)]];
    // recuadro del cuerpo en todo el swing (con margen), para que la figura llene cada cuadro
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9; for(const f of F) for(const k in f.p){ const q=f.p[k]; if(!q) continue; x0=Math.min(x0,q[0]); x1=Math.max(x1,q[0]); y0=Math.min(y0,q[1]); y1=Math.max(y1,q[1]); }
    const pw=(x1-x0)*0.12+10, ph=(y1-y0)*0.08+10; x0-=pw; x1+=pw; y0-=ph; y1+=ph;
    const gap=6, lab=18, cw=(W-gap*3)/4, ch=H-lab;
    keys.forEach(([name,i],c)=>{ const cx0=c*(cw+gap), f=F[i], sc=Math.min(cw/(x1-x0), ch/(y1-y0)), offx=(cw-(x1-x0)*sc)/2, offy=(ch-(y1-y0)*sc)/2;
      const X=p=>{ const x=offx+(p[0]-x0)*sc; return mir? cx0+cw-x : cx0+x; }, M=p=>[X(p), offy+(p[1]-y0)*sc];
      ctx.save(); ctx.beginPath(); ctx.rect(cx0,0,cw,ch); ctx.clip(); ctx.fillStyle="#0f2a20"; ctx.fillRect(cx0,0,cw,ch);
      if(f.img){ ctx.save(); if(mir){ ctx.translate(cx0+cw,0); ctx.scale(-1,1); } else ctx.translate(cx0,0);
        ctx.drawImage(f.img, offx-x0*sc, offy-y0*sc, f.w*sc, f.h*sc); ctx.restore(); ctx.fillStyle="rgba(8,24,18,0.3)"; ctx.fillRect(cx0,0,cw,ch); }
      if(res.posture && res.posture.lines) planeLines(res.posture.lines,M,cw,ch);
      const tI=rel(mk.top), seg=(j0,j1,col)=>{ if(j1<=j0) return; ctx.strokeStyle=col; ctx.lineWidth=2.5; ctx.beginPath(); for(let j=j0;j<=j1;j++){ const P=M(hands[j]); j===j0?ctx.moveTo(P[0],P[1]):ctx.lineTo(P[0],P[1]); } ctx.stroke(); };
      seg(rel(mk.a),Math.min(i,tI),"#78dcff"); if(i>tI) seg(tI,i,"#ffd23f");
      skeleton(f,cw,ch,"#ffffff",2.5,M); ctx.restore();
      ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue("--ink")||"#222"; ctx.font="600 12px Figtree, system-ui, sans-serif"; ctx.textAlign="center"; ctx.fillText(name, cx0+cw/2, H-4); });
  } finally { ctx=old; }
  return true; };
Cam.stopReplay=()=>{ replaying=null; if(canvas) canvas.classList.remove("replay"); };
Cam.replaying=()=>!!replaying;
})();
