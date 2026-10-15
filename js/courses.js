// Swing Lab · campos: geometría de hoyos, terreno (lie), árboles, penalidades y los recorridos
// Los hoyos se escriben como [derecha, adelante] en metros desde el tee (más fácil de leer en un plano);
// el mundo 3D usa x = −derecha (en three.js la derecha de la pantalla mirando hacia +z es −x).
(function(){
"use strict";
const SL = window.SL, DEG = Math.PI/180;
function rng(seed){ return ()=>{ seed|=0; seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
SL.rng = rng;

// ---------------- geometría ----------------
const P = p=>({x:-p[0], z:p[1]});
function inPoly(pts,x,z){ let c=false; for(let i=0,j=pts.length-1;i<pts.length;j=i++){ const a=pts[i], b=pts[j];
  if(((a.z>z)!==(b.z>z)) && (x < (b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)) c=!c; } return c; }
function inEll(e,x,z,pad=0){ const dx=x-e.x, dz=z-e.z, c=Math.cos(e.rot), s=Math.sin(e.rot), u=dx*c+dz*s, v=-dx*s+dz*c;
  return (u*u)/((e.rx+pad)**2)+(v*v)/((e.rz+pad)**2)<=1; }
function inRect(b,x,z,pad=0){ const dx=x-b.x, dz=z-b.z, c=Math.cos(b.rot), s=Math.sin(b.rot);
  return Math.abs(dx*c+dz*s)<=b.w/2+pad && Math.abs(-dx*s+dz*c)<=b.d/2+pad; }
function segDist(ax,az,bx,bz,x,z){ const dx=bx-ax, dz=bz-az, L=dx*dx+dz*dz; let t=L?((x-ax)*dx+(z-az)*dz)/L:0; t=Math.max(0,Math.min(1,t));
  return Math.hypot(ax+dx*t-x, az+dz*t-z); }
function distPoly(pts,x,z){ let m=Infinity; for(let i=0;i<pts.length-1;i++) m=Math.min(m,segDist(pts[i].x,pts[i].z,pts[i+1].x,pts[i+1].z,x,z)); return m; }
function polyLen(pts){ let s=0; for(let i=0;i<pts.length-1;i++) s+=Math.hypot(pts[i+1].x-pts[i].x,pts[i+1].z-pts[i].z); return s; }
// muestras cada `step` m con la normal hacia la derecha del jugador
function sample(pts,step){ const out=[]; let s=0;
  for(let i=0;i<pts.length-1;i++){ const a=pts[i], b=pts[i+1], L=Math.hypot(b.x-a.x,b.z-a.z)||1e-6, dx=(b.x-a.x)/L, dz=(b.z-a.z)/L, n=Math.max(1,Math.ceil(L/step));
    for(let k=0;k<n;k++){ const u=k/n; out.push({x:a.x+(b.x-a.x)*u, z:a.z+(b.z-a.z)*u, s:s+L*u, nx:-dz, nz:dx}); } s+=L; }
  const a=pts[pts.length-2]||pts[0], b=pts[pts.length-1], L=Math.hypot(b.x-a.x,b.z-a.z)||1; out.push({x:b.x, z:b.z, s, nx:-(b.z-a.z)/L, nz:(b.x-a.x)/L});
  return out; }
const E = e=>({x:-e.c[0], z:e.c[1], rx:e.rx, rz:e.rz??e.rx, rot:-(e.rot||0)*DEG, pot:!!e.pot});
// puntos de una elipse en coordenadas de autor (para islas)
function ellArc(c,rx,rz,a0,a1,n){ const out=[]; for(let i=0;i<=n;i++){ const a=(a0+(a1-a0)*i/n)*DEG; out.push([c[0]+rx*Math.cos(a), c[1]+rz*Math.sin(a)]); } return out; }
SL.geo = {inPoly, inEll, inRect, distPoly, polyLen};

// ---------------- árboles ----------------
// Dimensiones compartidas por el dibujo 3D y los choques de la bola: copa entre y0 y y1, radio r
SL.treeDims = t=>{ const s=t.s; switch(t.kind){
  case "cone":    return {r:1.8*s, y0:1.3*s, y1:8.8*s};
  case "cypress": return {r:3.6*s, y0:3.4*s, y1:6.9*s};
  case "gorse":   return {r:1.8*s, y0:0,     y1:1.4*s};
  case "palm":    return {r:2.2*s, y0:8.2*s, y1:9.8*s};
  default:        return {r:2.7*s, y0:1.2*s, y1:7.0*s}; } };
function plant(h, fl, seed){
  const R=rng(seed), out=[], pick=()=>{ let u=R(), acc=0; for(const [k,p] of fl.kinds){ acc+=p; if(u<=acc) return k; } return fl.kinds[0][0]; };
  const ok=(x,z,pad)=>{ const l=SL.lieAt(h,x,z); if(["water","green","bunker","fairway","road","tee"].includes(l)) return false;
    if(inEll(h.green,x,z,12)) return false; if(Math.hypot(x,z)<16) return false;
    if(h.bunkers.some(b=>inEll(b,x,z,3))) return false; if(h.fairSamples.some(f=>Math.hypot(f.x-x,f.z-z)<f.w+pad)) return false;
    if(h.buildings.some(b=>inRect(b,x,z,6))) return false; if(h.roads.some(r=>distPoly(r.pts,x,z)<r.w/2+3)) return false;
    if(h.walls.some(w=>distPoly(w.pts,x,z)<3)) return false; if(h.water.some(w=>inPoly(w.pts,x,z))) return false; return true; };
  const add=(x,z,k)=>out.push({x, z, s:(k==="gorse"?0.8:0.85)+R()*0.7, kind:k, hue:R()});
  const cs=h.cs.filter((_,i)=>i%3===0);
  for(const c of cs){
    let base=14; for(const f of h.fairSamples){ const d=Math.hypot(f.x-c.x,f.z-c.z); if(d<26) base=Math.max(base,f.w+d*0.5); }
    for(const side of [-1,1]) for(let row=0; row<(fl.rows||1); row++){ if(R()>fl.dens*(row?0.7:1)) continue;
      const off=base+fl.gap+row*12+R()*fl.spread, x=c.x+c.nx*side*off+(R()-0.5)*6, z=c.z+c.nz*side*off+(R()-0.5)*6;
      if(ok(x,z,fl.gap*0.6)) add(x,z,pick()); } }
  const L=h.cs[h.cs.length-1].s;
  for(let k=0;k<(fl.far??60);k++){ const s=-20+R()*(L+110), c=h.cs[Math.max(0,Math.min(h.cs.length-1,Math.round(s/4)))], side=R()<0.5?-1:1;
    let base=14; for(const f of h.fairSamples){ const d=Math.hypot(f.x-c.x,f.z-c.z); if(d<26) base=Math.max(base,f.w+d*0.5); }
    const off=base+fl.gap+fl.spread+12+R()*55, ex=s>L?(s-L):s<0?s:0, x=c.x+c.nx*side*off-c.nz*0+(R()-0.5)*8, z=c.z+c.nz*side*off+ex+(R()-0.5)*8;
    if(ok(x,z,fl.gap)) add(x,z,pick()); }
  return out;
}
// Primer árbol que toca el vuelo (pts en mundo {t,x,y,z}); -1 si ninguno
SL.treeHit = function(h, pts){
  const T=h.trees; if(!T || !T.length) return null;
  if(!h._tg){ h._tg=new Map(); T.forEach(t=>{ const k=Math.floor(t.x/20)+","+Math.floor(t.z/20); if(!h._tg.has(k)) h._tg.set(k,[]); h._tg.get(k).push(t); }); }
  const o=pts[0];
  for(let i=1;i<pts.length;i++){ const p=pts[i]; if(Math.hypot(p.x-o.x,p.z-o.z)<8) continue;
    const gx=Math.floor(p.x/20), gz=Math.floor(p.z/20);
    for(let a=-1;a<=1;a++) for(let b=-1;b<=1;b++){ const L=h._tg.get((gx+a)+","+(gz+b)); if(!L) continue;
      for(const t of L){ const d=SL.treeDims(t); if(p.y<d.y0+0.1 || p.y>d.y1) continue; if(Math.hypot(p.x-t.x,p.z-t.z)<=d.r*0.8) return {i, tree:t}; } } }
  return null;
};

// ---------------- construcción de un hoyo ----------------
function build(d, idx, fl){
  const h={num:d.num, name:d.name, par:d.par, tip:d.tip||"", yards:d.yards||0, seed:idx+1};
  const pin=P(d.pin); h.pinX=pin.x; h.L=pin.z;
  h.green=E(d.green); h.greenR=(h.green.rx+h.green.rz)/2;
  h.center=d.center.map(P); h.len=polyLen(h.center); h.cs=sample(h.center,4);
  h.fairways=(d.fairways||[]).map((f,k)=>{ const pts=f.pts.map(P), ss=sample(pts,1.5), Lf=ss[ss.length-1].s;
    ss.forEach(q=>{ const e=Math.min(q.s,Lf-q.s), w0=f.w+((f.w2??f.w)-f.w)*(q.s/(Lf||1));
      q.w=Math.max(2,(w0+1.6*Math.sin(q.s/41+h.seed+k)+1.0*Math.sin(q.s/17+h.seed*2.3))*(0.55+0.45*Math.min(1,e/14))); });
    return {pts, samples:ss}; });
  h.fairSamples=[].concat(...h.fairways.map(f=>f.samples));
  h.bunkers=(d.bunkers||[]).map(E);
  h.swales=(d.swales||[]).map(E);
  h.water=(d.water||[]).map(w=>{ const pts=w.pts.map(P), shore=w.shore??w.pts.length; return {kind:w.kind||"pond", pts, shore, edge:w.edge||null, closed:w.shore==null,
    beach:w.beach||0, rocks:w.rocks!==false, shorePts:w.shore==null?pts.concat([pts[0]]):pts.slice(0,shore)}; });
  h.land=(d.land||[]).map(l=>({pts:l.pts.map(P), kind:l.kind||"fairway"}));
  h.ob=[]; h.stakes=[];
  (d.ob||[]).forEach(o=>{ const pts=o.map(P); h.ob.push(pts); h.stakes.push(pts.concat([pts[0]])); });
  (d.obSide||[]).forEach(o=>{ const sg=o.side==="R"?1:-1, inner=[], outer=[];
    h.cs.filter(c=>c.z>=(o.from??-20) && c.z<=(o.to??1e9)).forEach(c=>{ inner.push({x:c.x+c.nx*sg*o.off, z:c.z+c.nz*sg*o.off}); outer.push({x:c.x+c.nx*sg*(o.off+400), z:c.z+c.nz*sg*(o.off+400)}); });
    if(inner.length>1){ h.ob.push(inner.concat(outer.reverse())); h.stakes.push(inner); } });
  h.roads=(d.roads||[]).map(r=>({pts:r.pts.map(P), w:r.w||4}));
  h.walls=(d.walls||[]).map(w=>({pts:w.pts.map(P), h:w.h||1.1}));
  h.buildings=(d.buildings||[]).map(b=>({x:-b.c[0], z:b.c[1], w:b.w, d:b.d, h:b.h, rot:-(b.rot||0)*DEG, color:b.color??0xd9d2c0, roof:b.roof||"hip", roofColor:b.roofColor??0x5a5f66, win:b.win!==false, ob:b.ob!==false}));
  h.route=(d.route||[]).map(P);
  h.drop=d.drop?P(d.drop):null;
  h.corridor=d.corridor||75;
  // límites del mapa pintado
  const xs=h.cs.map(c=>c.x), zs=h.cs.map(c=>c.z);
  h.bounds={x0:Math.min(...xs)-115, x1:Math.max(...xs)+115, z0:-50, z1:Math.max(...zs,h.L)+90};
  h.trees=plant(h, Object.assign({kinds:[["round",.7],["cone",.3]], dens:.8, gap:20, spread:26}, fl||{}, d.flora||{}), 97+idx*31);
  (d.trees||[]).forEach((t,k)=>h.trees.push({x:-t.c[0], z:t.c[1], s:t.s||1.3, kind:t.kind||"round", hue:(k*0.37)%1, special:true}));
  return h;
}

// ---------------- terreno bajo un punto ----------------
SL.lieAt = function(h,x,z){
  if(inEll(h.green,x,z)) return "green";
  for(const b of h.bunkers) if(inEll(b,x,z)) return "bunker";
  for(const l of h.land) if(inPoly(l.pts,x,z)) return l.kind==="fairway"?"fairway":"rough";
  for(const w of h.water) if(inPoly(w.pts,x,z)) return "water";
  for(const w of h.water) if(w.beach && distPoly(w.shorePts,x,z)<w.beach) return "bunker";   // playa: arena
  for(const b of h.buildings) if(b.ob && inRect(b,x,z)) return "ob";
  for(const p of h.ob) if(inPoly(p,x,z)) return "ob";
  if(z<-14 || distPoly(h.center,x,z)>h.corridor) return "ob";
  for(const r of h.roads) if(distPoly(r.pts,x,z)<=r.w/2) return "road";
  if(Math.abs(x)<5 && z>-5 && z<7) return "tee";
  for(const f of h.fairSamples){ const dx=f.x-x, dz=f.z-z; if(dx*dx+dz*dz<=f.w*f.w) return "fairway"; }
  if(inEll(h.green,x,z,3)) return "fairway";
  for(const s of h.swales) if(inEll(s,x,z)) return "fairway";
  return "rough";
};
SL.waterAt = (h,x,z)=>{ for(const l of h.land) if(inPoly(l.pts,x,z)) return null; return h.water.find(w=>inPoly(w.pts,x,z))||null; };
// Dónde se dropea tras caer al agua: zona de dropeo del hoyo o el último punto seco de la línea del tiro
SL.dropFor = function(h, from, at){
  if(h.drop) return {x:h.drop.x, z:h.drop.z};
  const dx=from.x-at.x, dz=from.z-at.z, L=Math.hypot(dx,dz)||1, ux=dx/L, uz=dz/L;
  for(let s=1; s<L; s+=1){ const x=at.x+ux*s, z=at.z+uz*s, l=SL.lieAt(h,x,z);
    if(l!=="water" && l!=="ob" && l!=="green"){ const k=Math.min(L,s+2.5); return {x:at.x+ux*k, z:at.z+uz*k}; } }
  return {x:from.x, z:from.z};
};

// ---------------- los campos ----------------
// Inspirados en hoyos reales: distancias, forma y ubicación de trampas según guías públicas de cada campo.
const OCEAN_FAR = 3000;
const STONE=0xb9b2a3;
const OLD = [
  { num:1, name:"Burn", par:4, yards:376,
    tip:"Calle amplísima compartida con el 18 y fuera de límites a la derecha. El Swilcan Burn cruza justo delante del green: no te quedes corto.",
    pin:[-2,341], green:{c:[0,342], rx:19, rz:15},
    center:[[0,0],[-6,170],[-2,341]],
    fairways:[{pts:[[-8,22],[-13,150],[-9,282],[-5,309]], w:40, w2:44}, {pts:[[-3,323],[-1,327]], w:16}],
    water:[{kind:"burn", edge:"stone", pts:[[-120,311],[-60,313],[-20,315],[20,316],[60,314],[95,311],[95,315.5],[60,318.5],[20,320.5],[-20,319.5],[-60,317.5],[-120,315.5]]}],
    roads:[{pts:[[-140,92],[90,98]], w:4}],
    obSide:[{side:"R", off:50, from:-10, to:400}],
    route:[[-10,232]], corridor:110 },
  { num:17, name:"Road", par:4, yards:455,
    tip:"Dogleg a la derecha: la salida pasa por encima de los galpones del hotel (fuera de límites a la derecha). El bunker del Road Hole se come la izquierda del green y la carretera está justo detrás.",
    pin:[70,410], green:{c:[78,405], rx:22, rz:8, rot:135},
    center:[[0,0],[12,120],[30,235],[52,325],[70,410]],
    fairways:[{pts:[[3,55],[12,130],[27,225],[45,300],[57,345],[63,365]], w:21}],
    bunkers:[{c:[67,401], rx:3.4, rz:3.1, pot:true}],
    ob:[[[33,40],[180,40],[180,250],[100,250],[64,205],[38,150]], [[170,335],[53,452],[53,600],[320,600],[320,335]]],
    roads:[{pts:[[164,335],[99,400],[49,450]], w:4.5}],
    walls:[{pts:[[170,335],[103,402],[53,452]], h:1.2}],
    buildings:[{c:[48,120], w:11, d:48, h:7, color:0x2f4a3a, roofColor:0x1f2a24, roof:"gable", win:false},
               {c:[98,150], w:42, d:110, h:21, color:0xd8cfbf, roofColor:0x4d5257}],
    route:[[27,232],[50,330]], corridor:100 },
  { num:18, name:"Tom Morris", par:4, yards:357,
    tip:"Calle compartida con el 1 y fuera de límites a la derecha (el pueblo). Apunta al reloj del club house. Delante del green está el Valle del Pecado.",
    pin:[3,320], green:{c:[2,321], rx:19, rz:16, rot:10},
    center:[[0,0],[-6,160],[3,320]],
    fairways:[{pts:[[-10,48],[-12,160],[-6,280],[-2,298]], w:42, w2:38}],
    water:[{kind:"burn", edge:"stone", pts:[[-130,35],[-40,37],[0,38],[40,36],[90,35],[90,39],[40,40],[0,42],[-40,41],[-130,39]]}],
    swales:[{c:[-6,297], rx:12, rz:8, rot:5}],
    roads:[{pts:[[-140,238],[80,242]], w:4}],
    obSide:[{side:"R", off:40, from:30, to:420}],
    buildings:[{c:[-22,38.5], w:2.8, d:9, h:1.0, color:STONE, roof:"none", win:false, ob:false},
               {c:[-42,372], w:44, d:24, h:15, color:0xcdb991, roofColor:0x4a4f55},
               {c:[46,388], w:48, d:22, h:20, color:0xa4583c, roofColor:0x50555c},
               {c:[56,175], w:14, d:26, h:11, color:0xc9bfae}, {c:[57,205], w:14, d:24, h:13, color:0xb7aa95},
               {c:[56,233], w:14, d:24, h:10, color:0xd1c7b6}, {c:[58,262], w:14, d:26, h:12, color:0xbfb29c},
               {c:[57,292], w:14, d:24, h:14, color:0xc8bca7}, {c:[58,322], w:15, d:26, h:12, color:0xb3a690}, {c:[56,350], w:14, d:22, h:13, color:0xcfc4b0}],
    route:[[-6,220]], corridor:110 }
];
const PEB = [
  { num:7, name:"El corto junto al mar", par:3, yards:109,
    tip:"Par 3 corto y cuesta abajo hacia el Pacífico. Green pequeño rodeado de bunkers; detrás y a la derecha, el mar. Con viento, el palo correcto lo es todo.",
    pin:[-2,98], green:{c:[-3,97], rx:10, rz:13, rot:-10},
    center:[[0,0],[-2,98]],
    fairways:[{pts:[[-2,56],[-3,83]], w:9}],
    bunkers:[{c:[-15.5,92], rx:3.5, rz:7}, {c:[4,82], rx:6, rz:2.6}, {c:[10.5,98], rx:2.6, rz:6}, {c:[-12,108], rx:4, rz:3}, {c:[3,113], rx:5, rz:2.4}, {c:[-10,80], rx:3, rz:2.4}],
    water:[{kind:"ocean", shore:12, pts:[[40,-40],[38,10],[30,50],[22,78],[18,100],[14,116],[2,122],[-14,121],[-26,112],[-40,106],[-60,110],[-90,125],
      [-OCEAN_FAR,125],[-OCEAN_FAR,OCEAN_FAR],[OCEAN_FAR,OCEAN_FAR],[OCEAN_FAR,-40]]}],
    corridor:70 },
  { num:8, name:"El abismo", par:4, yards:428,
    tip:"Salida ciega hacia la meseta: no pases el borde del acantilado. El segundo vuela sobre el abismo del océano hasta un green pequeño. Si no llegas, rodea por la izquierda.",
    pin:[6,388], green:{c:[5,389], rx:11, rz:10, rot:20},
    center:[[0,0],[-6,150],[-8,232],[6,388]],
    fairways:[{pts:[[-3,60],[-7,150],[-8,224]], w:21}, {pts:[[-12,336],[0,368]], w:12}, {pts:[[-52,252],[-49,295],[-36,330]], w:11}],
    bunkers:[{c:[-8,379], rx:4, rz:3}, {c:[9,401], rx:5, rz:2.5, rot:15}, {c:[18,386], rx:2.5, rz:5}],
    water:[{kind:"ocean", shore:16, pts:[[62,-40],[50,30],[45,110],[42,200],[34,232],[12,240],[-14,244],[-26,256],[-30,285],[-22,315],[-6,328],[16,334],[30,350],[30,400],[26,440],[32,520],
      [32,OCEAN_FAR],[OCEAN_FAR,OCEAN_FAR],[OCEAN_FAR,-OCEAN_FAR],[62,-OCEAN_FAR]]}],
    route:[[-7,214],[-49,292]], corridor:85 },
  { num:18, name:"El Lodge", par:5, yards:543,
    tip:"Par 5 con el Pacífico por toda la izquierda. El ciprés en medio de la calle te obliga a ir por su izquierda; el bunker largo protege el muro del mar. Detrás del green, el Lodge.",
    pin:[-77,489], green:{c:[-78,488], rx:13, rz:11, rot:30},
    center:[[0,0],[-5,120],[-15,240],[-35,350],[-60,440],[-77,489]],
    fairways:[{pts:[[-4,40],[-6,130],[-16,240],[-34,345],[-55,430],[-66,458]], w:22}],
    bunkers:[{c:[-66,360], rx:38, rz:4, rot:104}, {c:[-91,474], rx:6, rz:3, rot:30}, {c:[-63,492], rx:2.5, rz:6}, {c:[-72,473], rx:4, rz:2}],
    water:[{kind:"ocean", shore:10, pts:[[-5,-60],[-22,-5],[-40,60],[-46,150],[-55,250],[-70,330],[-90,410],[-106,470],[-110,520],[-118,580],
      [-118,OCEAN_FAR],[-OCEAN_FAR,OCEAN_FAR],[-OCEAN_FAR,-OCEAN_FAR],[-5,-OCEAN_FAR]]}],
    trees:[{c:[-8,256], kind:"cypress", s:1.55}, {c:[-61,468], kind:"cypress", s:1.35}],
    obSide:[{side:"R", off:46, from:-10, to:560}],
    buildings:[{c:[-82,532], w:64, d:22, h:12, color:0xe9dfc8, roofColor:0x5d6b5f},
               {c:[60,140], w:18, d:16, h:8, color:0xe8e1d2, roofColor:0x6b4e3d}, {c:[58,215], w:20, d:16, h:9, color:0xded5c3, roofColor:0x4f5a63},
               {c:[45,300], w:18, d:16, h:8, color:0xf0eadc, roofColor:0x6b4e3d}, {c:[28,375], w:20, d:16, h:9, color:0xe2dccd, roofColor:0x4f5a63}],
    route:[[-12,230],[-45,400]], corridor:95 }
];
const SAW = [
  { num:16, name:"Riesgo y premio", par:5, yards:523,
    tip:"Par 5 alcanzable: el agua acompaña la derecha desde el segundo golpe y abraza el green por la derecha y por detrás. Un gran roble a la derecha bloquea el ataque desde ese lado.",
    pin:[16,476], green:{c:[15,474], rx:12, rz:14, rot:10},
    center:[[0,0],[-4,140],[-6,260],[2,370],[16,476]],
    fairways:[{pts:[[-2,40],[-4,140],[-6,260],[0,350],[8,420],[11,446]], w:20}],
    bunkers:[{c:[28,466], rx:3, rz:10}],
    water:[{kind:"pond", edge:"wood", shore:12, pts:[[60,250],[42,300],[36,350],[35,410],[34,450],[33,474],[28,492],[14,500],[-2,501],[-14,508],[-16,560],[-16,700],[160,700],[160,250]]}],
    trees:[{c:[20,382], kind:"round", s:1.7}],
    route:[[-6,250],[6,400]], corridor:80 },
  { num:17, name:"Isla", par:3, yards:137,
    tip:"El green isla: todo es agua salvo el green y su pasillo de atrás. Si cae al agua, juegas desde la zona de dropeo. Hay un pot bunker pequeño adelante a la derecha.",
    pin:[-2,127], green:{c:[0,125], rx:14, rz:12, rot:-5},
    center:[[0,0],[-2,127]],
    bunkers:[{c:[8,113], rx:2.4, rz:2.2, pot:true}],
    water:[{kind:"pond", edge:"wood", pts:[[-40,28],[0,31],[40,26],[65,30],[70,100],[68,190],[20,192],[-30,188],[-52,180],[-50,150],[-44,110],[-40,70]]}],
    land:[{kind:"fairway", pts:[...ellArc([0,125],17.5,15.5,143,487,44), [-53,174], [-56,170]]}],
    drop:[-50,62], corridor:85 },
  { num:18, name:"El regreso", par:4, yards:462,
    tip:"Dogleg a la izquierda con agua en toda la izquierda, del tee al green. Cuanto más agua cortas, más corto el segundo. A la derecha: árboles y bunker.",
    pin:[-63,418], green:{c:[-62,417], rx:12, rz:15, rot:-15},
    center:[[0,0],[-6,120],[-20,230],[-42,320],[-63,418]],
    fairways:[{pts:[[-3,50],[-7,130],[-20,230],[-38,305],[-52,370],[-57,392]], w:19}],
    bunkers:[{c:[12,245], rx:4, rz:14}, {c:[-47,410], rx:2.5, rz:7}],
    water:[{kind:"pond", shore:10, pts:[[-20,-30],[-24,20],[-30,80],[-36,150],[-46,220],[-63,290],[-80,350],[-90,400],[-92,440],[-88,480],[-88,700],[-320,700],[-320,-30]]}],
    buildings:[{c:[-50,512], w:60, d:30, h:14, color:0xeee3cf, roofColor:0xb5653b}],
    route:[[-18,225],[-45,330]], corridor:80 }
];
// Country Club de Bogotá, cancha Los Fundadores (2.600 m): lagos en el 13, 14 y 18, árboles por todas partes
const CCB = [
  { num:13, name:"El más difícil", par:5, yards:585,
    tip:"El hoyo más difícil del campo: por la izquierda hay que volar el lago unos 180 m; por la derecha es más seguro pero más largo. Calle angosta entre árboles.",
    pin:[2,533], green:{c:[1,532], rx:12, rz:15, rot:-5},
    center:[[0,0],[6,190],[-2,360],[2,533]],
    fairways:[{pts:[[12,150],[4,250],[-3,360],[-1,450],[1,505]], w:15}],
    water:[{kind:"pond", pts:[[-6,55],[-3,120],[-8,182],[-30,192],[-62,175],[-72,110],[-55,52],[-25,40]]}],
    bunkers:[{c:[-13,525], rx:3.5, rz:6}, {c:[13,540], rx:3, rz:5}, {c:[16,262], rx:4, rz:9}],
    route:[[10,215],[-2,400]], corridor:60 },
  { num:14, name:"El lago del green", par:4, yards:382,
    tip:"Par 4 con agua a la izquierda a unos 270 m de la salida, frente al green. Si fallas, que sea a la derecha.",
    pin:[7,346], green:{c:[6,347], rx:12, rz:13},
    center:[[0,0],[2,200],[7,346]],
    fairways:[{pts:[[1,40],[2,180],[5,255]], w:15}, {pts:[[8,290],[7,328]], w:11}],
    water:[{kind:"pond", pts:[[-55,250],[-14,262],[-6,292],[-9,326],[-30,336],[-62,315],[-70,270]]}],
    bunkers:[{c:[19,348], rx:3, rz:6}, {c:[2,362], rx:6, rz:2.5}],
    route:[[3,225]], corridor:60 },
  { num:18, name:"Regreso a la casa club", par:5, yards:551,
    tip:"Fuera de límites por toda la izquierda. A unos 120 m del green empieza un lago por la derecha que abraza el green; un bunker separa el green del agua.",
    pin:[-3,503], green:{c:[-3,503], rx:11, rz:14},
    center:[[0,0],[-2,250],[0,390],[-3,503]],
    fairways:[{pts:[[-2,40],[-2,250],[0,370],[-3,470]], w:17}],
    water:[{kind:"pond", pts:[[22,385],[17,440],[13,478],[13,505],[17,524],[45,530],[70,470],[65,385]]}],
    bunkers:[{c:[10.5,500], rx:2.3, rz:8}, {c:[-15,510], rx:3, rz:5}],
    obSide:[{side:"L", off:30, from:-10, to:600}],
    buildings:[{c:[-8,578], w:70, d:26, h:12, color:0xf1ece2, roofColor:0xb5653b}],
    route:[[-2,240],[-4,410]], corridor:60 }
];
// TPC Cartagena at Karibana (Jack Nicklaus): los tres últimos hoyos junto al mar Caribe
const TPCC = [
  { num:16, name:"Junto al Caribe", par:4, yards:467,
    tip:"Par 4 largo con el mar Caribe por toda la derecha y playa antes del agua. La brisa del mar empuja la bola: busca el lado izquierdo de la calle.",
    pin:[-1,427], green:{c:[-1,427], rx:13, rz:14},
    center:[[0,0],[-5,200],[-1,427]],
    fairways:[{pts:[[-2,40],[-5,200],[-3,330],[-1,400]], w:18}],
    water:[{kind:"ocean", beach:12, rocks:false, shore:7, pts:[[48,-40],[42,100],[44,220],[40,330],[34,400],[33,445],[38,520],
      [38,OCEAN_FAR],[OCEAN_FAR,OCEAN_FAR],[OCEAN_FAR,-OCEAN_FAR],[48,-OCEAN_FAR]]}],
    bunkers:[{c:[-15,416], rx:5, rz:3}, {c:[13,433], rx:2.5, rz:6}],
    route:[[-4,215]], corridor:75 },
  { num:17, name:"El corto del Caribe", par:3, yards:127,
    tip:"Par 3 corto pero lleno de problemas: bunkers alrededor y la playa con el mar a la derecha y detrás. Con viento cruzado, apunta al centro del green.",
    pin:[-3,116], green:{c:[-3,116], rx:11, rz:10},
    center:[[0,0],[-3,116]],
    fairways:[{pts:[[-2,78],[-3,101]], w:8}],
    bunkers:[{c:[-2,103], rx:7, rz:2.4}, {c:[-15,115], rx:3, rz:6}, {c:[8,126], rx:4, rz:3}],
    water:[{kind:"ocean", beach:10, rocks:false, shore:7, pts:[[45,-40],[36,50],[24,105],[16,135],[-15,146],[-60,150],[-120,160],
      [-OCEAN_FAR,160],[-OCEAN_FAR,OCEAN_FAR],[OCEAN_FAR,OCEAN_FAR],[OCEAN_FAR,-40]]}],
    corridor:65 },
  { num:18, name:"Riesgo y premio", par:5, yards:496,
    tip:"Par 5 de riesgo y premio: una laguna a la izquierda está en juego en la segunda y en el acercamiento, y protege el frente del green. El mar sigue a la derecha.",
    pin:[-22,452], green:{c:[-22,452], rx:12, rz:13, rot:20},
    center:[[0,0],[3,230],[-2,360],[-22,452]],
    fairways:[{pts:[[1,40],[3,230],[3,330],[2,380]], w:16}, {pts:[[-13,420],[-18,438]], w:9}],
    water:[{kind:"pond", edge:"wood", pts:[[-14,300],[-12,350],[-16,392],[-24,422],[-40,430],[-62,420],[-72,350],[-50,295]]},
           {kind:"ocean", beach:12, rocks:false, shore:4, pts:[[62,-60],[56,200],[58,420],[44,560],[44,OCEAN_FAR],[OCEAN_FAR,OCEAN_FAR],[OCEAN_FAR,-OCEAN_FAR],[62,-OCEAN_FAR]]}],
    bunkers:[{c:[-6,455], rx:3, rz:6}, {c:[-30,468], rx:5, rz:2.5}],
    buildings:[{c:[-25,515], w:60, d:22, h:10, color:0xf4efe6, roofColor:0xc0703f}],
    route:[[3,235],[2,370]], corridor:75 }
];
// el campo ficticio original (mismas posiciones que antes)
const CLASSIC = [
  { num:1, name:"El Guayacán", par:4, tip:"Par 4 recto con bunkers a la izquierda de la calle y a la derecha del green.",
    pin:[-6,330], green:{c:[-6,330], rx:15}, center:[[0,0],[-6,330]], fairways:[{pts:[[-0.7,40],[-5.9,325]], w:17}],
    bunkers:[{c:[-21,215], rx:9}, {c:[15,318], rx:6}], corridor:62 },
  { num:2, name:"La Laguna", par:3, tip:"Par 3 con agua delante del green: hay que volarla.",
    pin:[4,140], green:{c:[4,140], rx:14}, center:[[0,0],[4,140]], fairways:[{pts:[[3.2,112],[4,136]], w:13}],
    bunkers:[{c:[-16,150], rx:6}], water:[{pts:[[-30,82],[34,82],[34,110],[-30,110]]}], corridor:62 },
  { num:3, name:"Los Samanes", par:5, tip:"Par 5 con un lago a la izquierda en la zona del segundo golpe.",
    pin:[10,470], green:{c:[10,470], rx:16}, center:[[0,0],[10,470]], fairways:[{pts:[[0.6,30],[9.7,456]], w:16}],
    bunkers:[{c:[21,250], rx:10}, {c:[-13,458], rx:7}], water:[{pts:[[-58,280],[-22,280],[-22,400],[-58,400]]}], route:[[4,240]], corridor:62 }
];
const COURSES = [
  { id:"standrews", name:"Old Course", place:"St Andrews, Escocia", style:"Links", si:0, alt:0, wind:[2,7],
    desc:"Links junto al mar: calles enormes y sin árboles (solo tojo), el Swilcan Burn, los galpones del hotel en el 17 y el pueblo a la derecha del 18.",
    flora:{kinds:[["gorse",1]], dens:.45, gap:22, spread:34, rows:2, far:90}, holes:OLD },
  { id:"pebble", name:"Pebble Beach", place:"California, EE. UU.", style:"Acantilados", si:1, alt:0, wind:[1,6],
    desc:"El Pacífico en juego: un par 3 cuesta abajo hacia el mar, un segundo golpe sobre el abismo y un par 5 con el océano por toda la izquierda.",
    flora:{kinds:[["cypress",.65],["cone",.35]], dens:.45, gap:22, spread:30, rows:1, far:55}, holes:PEB },
  { id:"sawgrass", name:"TPC Sawgrass", place:"Florida, EE. UU.", style:"Agua", si:2, alt:0, wind:[0,5],
    desc:"El final del Stadium Course: par 5 con agua a la derecha, el green isla del 17 y el 18 con agua por toda la izquierda.",
    flora:{kinds:[["cone",.55],["palm",.2],["round",.25]], dens:.9, gap:18, spread:24, rows:2, far:70}, holes:SAW },
  { id:"bogota", name:"Country Club de Bogotá", place:"Los Fundadores · Bogotá, 2.600 m", style:"Altura", si:4, alt:2600, wind:[0,3],
    desc:"Cancha Los Fundadores: calles angostas entre árboles, lagos en juego en el 13, el 14 y el 18, y la altura de Bogotá: la bola vuela cerca de 10% más.",
    flora:{kinds:[["round",.55],["cone",.45]], dens:.95, gap:15, spread:20, rows:2, far:80}, holes:CCB },
  { id:"cartagena", name:"TPC Cartagena", place:"Karibana · Cartagena, Colombia", style:"Caribe", si:5, alt:0, wind:[3,8],
    desc:"Diseño de Jack Nicklaus junto al mar Caribe: el 16 con el mar por toda la derecha, el 17 corto y lleno de problemas y el 18, un par 5 de riesgo y premio con laguna. Siempre hay brisa.",
    flora:{kinds:[["palm",.6],["round",.4]], dens:.55, gap:22, spread:28, rows:1, far:60}, holes:TPCC },
  { id:"swinglab", name:"Swing Lab", place:"Campo ficticio", style:"Clásico", si:3, alt:0,
    desc:"El campo original de la app: par 4 con bunkers, par 3 con laguna delante y par 5 con lago a la izquierda.",
    flora:{kinds:[["round",.72],["cone",.28]], dens:.8, gap:20, spread:26, rows:1, far:70}, holes:CLASSIC }
];
COURSES.forEach((c,ci)=>{ c.holes=c.holes.map((d,i)=>build(d, (c.si??ci)*10+i, c.flora)); c.par=c.holes.reduce((a,h)=>a+h.par,0); });
SL.COURSES = COURSES;
SL.courseById = id=>COURSES.find(c=>c.id===id)||COURSES[0];
SL.HOLES = SL.courseById("swinglab").holes;
SL.RANGE_TARGETS=[{d:50,x:-8},{d:100,x:10},{d:150,x:-12},{d:200,x:6},{d:250,x:-4},{d:300,x:0}];
})();
