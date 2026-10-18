// Swing Lab · mundo 3D (three.js): cielo, terreno pintado, árboles, agua, banderas, bola, trazador y cámaras
(function(){
"use strict";
const SL = window.SL;
const W3 = SL.World = { ok:false, active:true };
let T, R, scene, camera, canvas, clock, sky, sunDir, world=null;
let ball, shadow, trOuter, trCore, marks=null, linePool=[], flags=[], detail=null, def=null, hemi, sun;
const S = { anim:null, putt:null, wind:{x:0,z:0}, f:{x:0,z:1}, r:{x:1,z:0}, address:{x:0,z:0,yaw:0},
            cam:{pos:null, look:null, tPos:null, tLook:null, rate:2, lookRate:3}, trail:[], linesData:[] };
const BALL_R = 0.0214;

// ---------------- utilidades ----------------
const hash=(i,j)=>{ const s=Math.sin(i*127.1+j*311.7)*43758.5453; return s-Math.floor(s); };
function lerp(a,b,k){ return a+(b-a)*k; }

// Línea de ancho constante en pantalla (el trazador se ve igual de cerca que de lejos)
function SSLine(maxPts, color, width, opacity){
  const g=new T.BufferGeometry(), n=maxPts*2;
  this.pos=new Float32Array(n*3); this.prev=new Float32Array(n*3); this.next=new Float32Array(n*3);
  const side=new Float32Array(n); for(let i=0;i<maxPts;i++){ side[2*i]=-1; side[2*i+1]=1; }
  const idx=[]; for(let i=0;i<maxPts-1;i++){ const a=2*i; idx.push(a,a+1,a+2, a+1,a+3,a+2); }
  g.setAttribute("position",new T.BufferAttribute(this.pos,3));
  g.setAttribute("prev",new T.BufferAttribute(this.prev,3));
  g.setAttribute("next",new T.BufferAttribute(this.next,3));
  g.setAttribute("side",new T.BufferAttribute(side,1));
  g.setIndex(idx); g.setDrawRange(0,0);
  this.mat=new T.ShaderMaterial({
    uniforms:{color:{value:new T.Color(color)}, opacity:{value:opacity}, width:{value:width}, res:{value:new T.Vector2(1,1)}},
    vertexShader:`attribute vec3 prev; attribute vec3 next; attribute float side; uniform float width; uniform vec2 res;
      void main(){ mat4 m=projectionMatrix*modelViewMatrix; vec4 c=m*vec4(position,1.0); vec4 p=m*vec4(prev,1.0); vec4 n=m*vec4(next,1.0);
        vec2 ps=p.xy/max(p.w,0.001), ns=n.xy/max(n.w,0.001); vec2 d=(ns-ps)*res; float l=length(d); vec2 dir=l>0.0001?d/l:vec2(1.0,0.0);
        vec2 nrm=vec2(-dir.y,dir.x); c.xy+=nrm*side*width/res*c.w; gl_Position=c; }`,
    fragmentShader:`uniform vec3 color; uniform float opacity; void main(){ gl_FragColor=vec4(color,opacity); }`,
    transparent:true, depthWrite:false, side:T.DoubleSide });
  this.mesh=new T.Mesh(g,this.mat); this.mesh.frustumCulled=false; this.mesh.renderOrder=5; this.g=g; this.max=maxPts;
}
SSLine.prototype.set=function(pts){
  // solo el tramo final que queda delante de la cámara
  let s=pts.length; const v=new T.Vector3();
  while(s>0){ v.set(pts[s-1][0],pts[s-1][1],pts[s-1][2]).applyMatrix4(camera.matrixWorldInverse); if(v.z>-0.6) break; s--; }
  const list=pts.slice(s).slice(-this.max), n=list.length;
  if(n<2){ this.g.setDrawRange(0,0); return; }
  for(let i=0;i<n;i++){ const p=list[i], pv=list[Math.max(0,i-1)], nx=list[Math.min(n-1,i+1)];
    const px= i===0 ? [2*p[0]-nx[0],2*p[1]-nx[1],2*p[2]-nx[2]] : pv;
    const nn= i===n-1 ? [2*p[0]-pv[0],2*p[1]-pv[1],2*p[2]-pv[2]] : nx;
    for(let k=0;k<2;k++){ const o=(2*i+k)*3; this.pos.set(p,o); this.prev.set(px,o); this.next.set(nn,o); } }
  ["position","prev","next"].forEach(a=>this.g.attributes[a].needsUpdate=true);
  this.g.setDrawRange(0,(n-1)*6);
};
SSLine.prototype.res=function(w,h){ this.mat.uniforms.res.value.set(w,h); };

// ---------------- pintura del terreno ----------------
// Pinta en un canvas el área [x0,x1]×[z0,z1] en metros; la fila 0 del canvas es z0.
function variation(ctx,B,cell,alpha,seed){
  const i0=Math.floor(B.x0/cell)-1, i1=Math.ceil(B.x1/cell)+1, j0=Math.floor(B.z0/cell)-1, j1=Math.ceil(B.z1/cell)+1;
  const ni=i1-i0, nj=j1-j0, c=document.createElement("canvas"); c.width=ni; c.height=nj;
  const x=c.getContext("2d"), im=x.createImageData(ni,nj);
  for(let j=0;j<nj;j++) for(let i=0;i<ni;i++){ const v=hash(i+i0+seed,j+j0-seed), o=(j*ni+i)*4;
    im.data[o]=lerp(38,128,v); im.data[o+1]=lerp(70,170,v); im.data[o+2]=lerp(22,70,v); im.data[o+3]=255*alpha*(0.4+Math.abs(v-0.5)*1.2); }
  x.putImageData(im,0,0); ctx.imageSmoothingEnabled=true; ctx.drawImage(c,i0*cell,j0*cell,ni*cell,nj*cell);
}
function speckle(ctx,pw,ph,count,cols,alpha){
  ctx.globalAlpha=alpha;
  for(let k=0;k<count;k++){ ctx.fillStyle=cols[k%cols.length]; const s=Math.random()<0.7?1:2; ctx.fillRect(Math.random()*pw|0,Math.random()*ph|0,s,s); }
  ctx.globalAlpha=1;
}
function circlePath(ctx,x,z,r){ ctx.beginPath(); ctx.arc(x,z,r,0,Math.PI*2); }
function stripes(ctx,B,step,c1,c2){ for(let z=Math.floor(B.z0/step)*step; z<B.z1; z+=step){ ctx.fillStyle=(Math.round(z/step)%2)?c1:c2; ctx.fillRect(B.x0,z,B.x1-B.x0,step); } }
function polyPath(ctx,pts,close){ ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.z):ctx.moveTo(p.x,p.z)); if(close!==false) ctx.closePath(); }
function ellPath(ctx,e,pad){ ctx.beginPath(); ctx.ellipse(e.x,e.z,e.rx+(pad||0),e.rz+(pad||0),e.rot,0,Math.PI*2); }
// lienzo auxiliar reutilizado (crear lienzos grandes en cada hoyo agota la memoria del navegador)
const maskPool=[];
function maskCanvas(B,sx,sz,draw,fill){ const m=maskPool.pop()||document.createElement("canvas"); m.width=B.pw; m.height=B.ph; const mc=m.getContext("2d");
  mc.setTransform(sx,0,0,sz,-B.x0*sx,-B.z0*sz); mc.fillStyle="#000"; draw(mc); mc.globalCompositeOperation="source-in"; fill(mc); mc.globalCompositeOperation="source-over"; return m; }
function paintHole(ctx,B,sx,sz,W,P,shadowsOf){
  const h=def.h, G=h.green, inB=(x,z,r)=>x+r>B.x0 && x-r<B.x1 && z+r>B.z0 && z-r<B.z1;
  // fuera de límites: pasto más largo y oscuro
  ctx.fillStyle="rgba(52,82,30,0.38)"; for(const p of h.ob){ polyPath(ctx,p); ctx.fill(); }
  // calles: primer corte + franjas de corte
  const fwShape=(mc,extra)=>{ mc.beginPath(); for(const f of h.fairSamples){ const r=f.w+extra; if(!inB(f.x,f.z,r)) continue; mc.moveTo(f.x+r,f.z); mc.arc(f.x,f.z,r,0,Math.PI*2); }
    for(const e of h.swales){ mc.moveTo(e.x+e.rx+extra,e.z); mc.ellipse(e.x,e.z,e.rx+extra,e.rz+extra,e.rot,0,Math.PI*2); } mc.fill(); };
  if(h.fairSamples.length || h.swales.length){
    const use=m=>{ ctx.drawImage(m,0,0); m.width=m.height=1; maskPool.push(m); };
    P(); use(maskCanvas(B,sx,sz,mc=>fwShape(mc,2.6),mc=>{ mc.fillStyle="#6d9e44"; mc.fillRect(B.x0,B.z0,B.x1-B.x0,B.z1-B.z0); }));
    use(maskCanvas(B,sx,sz,mc=>fwShape(mc,0),mc=>{ stripes(mc,B,12,"#86be5a","#76ad4c"); mc.globalCompositeOperation="source-atop"; variation(mc,B,6,0.1,9); })); W();
    for(const e of h.swales){ const g=ctx.createRadialGradient(e.x,e.z,0,e.x,e.z,Math.max(e.rx,e.rz)); g.addColorStop(0,"rgba(30,60,15,0.22)"); g.addColorStop(1,"rgba(30,60,15,0)"); ctx.fillStyle=g; ellPath(ctx,e); ctx.fill(); }
  }
  // agua: orilla y lámina
  for(const w of h.water){
    const shore=w.closed?w.pts.concat([w.pts[0]]):w.pts.slice(0,w.shore);
    ctx.lineJoin="round"; ctx.lineCap="round";
    if(w.kind==="ocean" && w.beach){ polyPath(ctx,shore,false); ctx.strokeStyle="#ead9ad"; ctx.lineWidth=w.beach*2; ctx.stroke(); ctx.strokeStyle="#d3bf8c"; ctx.lineWidth=3; ctx.stroke(); }
    else if(w.kind==="ocean"){ polyPath(ctx,shore,false); ctx.strokeStyle="#cdbb8e"; ctx.lineWidth=9; ctx.stroke(); ctx.strokeStyle="#6a6253"; ctx.lineWidth=4; ctx.stroke(); }
    else if(w.kind==="burn"){ polyPath(ctx,shore,false); ctx.strokeStyle="#8f8a7d"; ctx.lineWidth=1.6; ctx.stroke(); }
    else { polyPath(ctx,shore,false); ctx.strokeStyle="#3f6e2f"; ctx.lineWidth=5; ctx.stroke(); }
    ctx.fillStyle=w.kind==="ocean"?(w.beach?"#1f7a96":"#1b5577"):"#1f5a80"; polyPath(ctx,w.pts); ctx.fill();
    if(w.edge==="wood"){ polyPath(ctx,shore,false); ctx.strokeStyle="#4a3826"; ctx.lineWidth=0.8; ctx.stroke(); }
  }
  // tierra dentro del agua (isla y pasillo)
  for(const l of h.land){ ctx.fillStyle="#6d9e44"; polyPath(ctx,l.pts); ctx.fill(); ctx.save(); polyPath(ctx,l.pts); ctx.clip(); stripes(ctx,B,4,"#86be5a","#7cb352"); ctx.restore();
    polyPath(ctx,l.pts); ctx.strokeStyle="#4a3826"; ctx.lineWidth=0.8; ctx.stroke(); }
  // caminos y carreteras
  for(const r of h.roads){ polyPath(ctx,r.pts,false); ctx.lineCap="butt"; ctx.strokeStyle="#7d786d"; ctx.lineWidth=r.w+0.8; ctx.stroke(); ctx.strokeStyle="#8f897c"; ctx.lineWidth=r.w; ctx.stroke(); }
  for(const w of h.walls){ polyPath(ctx,w.pts,false); ctx.strokeStyle="rgba(40,40,30,0.35)"; ctx.lineWidth=2.2; ctx.stroke(); }
  // tee
  ctx.save(); ctx.beginPath(); ctx.rect(-5.5,-4,11,11); ctx.clip(); stripes(ctx,B,2,"#86be5a","#7cb352"); ctx.restore();
  // bunkers (los pot bunkers con borde de tepes)
  for(const b of h.bunkers){ ctx.fillStyle=b.pot?"#4c5a2d":"#8f7d4f"; ellPath(ctx,b,b.pot?1.1:0.7); ctx.fill();
    ctx.save(); ellPath(ctx,b); ctx.clip(); const R=Math.max(b.rx,b.rz); ctx.fillStyle="#e2cf9c"; ctx.fillRect(b.x-R,b.z-R,R*2,R*2);
    ctx.strokeStyle="rgba(170,145,95,0.35)"; ctx.lineWidth=0.18; for(let k=-R;k<R;k+=0.8){ ctx.beginPath(); ctx.moveTo(b.x-R,b.z+k); ctx.lineTo(b.x+R,b.z+k+1.5); ctx.stroke(); }
    const g=ctx.createRadialGradient(b.x,b.z,R*0.3,b.x,b.z,R); g.addColorStop(0,"rgba(0,0,0,0)"); g.addColorStop(1,b.pot?"rgba(60,45,20,0.55)":"rgba(90,70,30,0.35)"); ctx.fillStyle=g; ctx.fillRect(b.x-R,b.z-R,R*2,R*2); ctx.restore(); }
  // green
  ctx.fillStyle="#76b24d"; ellPath(ctx,G,3); ctx.fill();
  ctx.save(); ellPath(ctx,G); ctx.clip(); stripes(ctx,B,2.5,"#95d068","#8ac55f");
  const GR=Math.max(G.rx,G.rz), g=ctx.createRadialGradient(G.x-3,G.z-3,1,G.x,G.z,GR); g.addColorStop(0,"rgba(255,255,220,0.10)"); g.addColorStop(1,"rgba(0,40,0,0.10)"); ctx.fillStyle=g; ctx.fillRect(G.x-GR,G.z-GR,GR*2,GR*2); ctx.restore();
  ctx.fillStyle="#141c0e"; circlePath(ctx,h.pinX,h.L,0.13); ctx.fill();
  // placas de distancia en la calle (100 rojo, 150 blanco, 200 azul) medidas al centro del green
  for(const [dd,col] of [[100,"#d23c2c"],[150,"#f4f4f4"],[200,"#2f63c8"]]){ const s=h.cs[h.cs.length-1].s-dd; if(s<40) continue; const c=h.cs[Math.max(0,Math.min(h.cs.length-1,Math.round(s/4)))];
    ctx.fillStyle="rgba(0,0,0,0.25)"; circlePath(ctx,c.x,c.z,0.75); ctx.fill(); ctx.fillStyle=col; circlePath(ctx,c.x,c.z,0.6); ctx.fill(); }
  // sombras de edificios
  ctx.fillStyle="rgba(18,30,10,0.32)"; for(const b of h.buildings){ ctx.save(); ctx.translate(b.x+b.h*0.25,b.z+b.h*0.35); ctx.rotate(b.rot); ctx.fillRect(-b.w/2,-b.d/2,b.w,b.d); ctx.restore(); }
  shadowsOf(def.trees);
}
function paint(B){
  const c=document.createElement("canvas"); c.width=B.pw; c.height=B.ph; const ctx=c.getContext("2d");
  const sx=B.pw/(B.x1-B.x0), sz=B.ph/(B.z1-B.z0);
  const W=()=>ctx.setTransform(sx,0,0,sz,-B.x0*sx,-B.z0*sz), P=()=>ctx.setTransform(1,0,0,1,0,0);
  P(); ctx.fillStyle="#5a893a"; ctx.fillRect(0,0,B.pw,B.ph);
  W(); variation(ctx,B,23,0.35,11); variation(ctx,B,6,0.22,3);
  P(); speckle(ctx,B.pw,B.ph,(B.pw*B.ph/22)|0,["#4a7a2f","#6a9b45","#557f36","#79a952","#466f2b"],0.55);
  W();
  const shadowsOf=(trees)=>{ ctx.fillStyle="rgba(18,38,10,0.34)";
    for(const t of trees){ const d=SL.treeDims(t), r=d.r*1.05, o=(d.y0+d.y1)*0.12; ctx.beginPath(); ctx.ellipse(t.x+r*0.4+o,t.z+r*0.6+o*1.4,r,r*1.35,0.5,0,Math.PI*2); ctx.fill(); } };
  if(def.kind==="range"){
    ctx.save(); ctx.beginPath(); ctx.rect(-72,-14,144,352); ctx.clip();
    stripes(ctx,B,10,"#7db353","#70a649"); W(); variation(ctx,B,6,0.12,5); ctx.restore();
    // zona de tiro con divots
    ctx.fillStyle="#86bb5b"; ctx.fillRect(-26,-6,52,9);
    for(let k=0;k<160;k++){ const x=-24+Math.random()*48, z=-1+Math.random()*4; ctx.fillStyle=Math.random()<0.5?"#8a7a52":"#6e8f45"; ctx.fillRect(x,z,0.25,0.12); }
    for(const t of SL.RANGE_TARGETS){ const z=t.d*def.um;
      ctx.fillStyle="#73ae4c"; circlePath(ctx,t.x,z,11.5); ctx.fill();
      ctx.save(); circlePath(ctx,t.x,z,8.5); ctx.clip(); stripes(ctx,B,2,"#93ce67","#89c55e"); ctx.restore();
      ctx.fillStyle="#1d2a14"; circlePath(ctx,t.x,z,0.25); ctx.fill(); }
    shadowsOf(def.trees);
  } else paintHole(ctx,B,sx,sz,W,P,shadowsOf);
  P(); speckle(ctx,B.pw,B.ph,(B.pw*B.ph/60)|0,["#ffffff","#000000"],0.04);
  const tex=new T.CanvasTexture(c); tex.anisotropy=Math.min(8,R.capabilities.getMaxAnisotropy()); tex.generateMipmaps=true; tex.minFilter=T.LinearMipmapLinearFilter;
  return tex;
}
function groundPlane(B, tex, y, offset, transparent){
  const m=new T.Mesh(new T.PlaneGeometry(B.x1-B.x0,B.z1-B.z0), new T.MeshLambertMaterial({map:tex, transparent:!!transparent, polygonOffset:true, polygonOffsetFactor:offset, polygonOffsetUnits:offset*2}));
  m.rotation.x=-Math.PI/2; m.position.set((B.x0+B.x1)/2,y,(B.z0+B.z1)/2); return m;
}

// ---------------- objetos ----------------
function makeFlag(){
  const g=new T.Group();
  const pole=new T.Mesh(new T.CylinderGeometry(0.022,0.022,2.4,6), new T.MeshLambertMaterial({color:0xf5f5f0})); pole.position.y=1.2; g.add(pole);
  const geo=new T.PlaneGeometry(0.62,0.42,12,4); geo.translate(0.31,0,0);
  const cloth=new T.Mesh(geo,new T.MeshLambertMaterial({color:0xd8392b, side:T.DoubleSide})); cloth.position.y=2.18; g.add(cloth);
  g.userData={cloth, base:Float32Array.from(geo.attributes.position.array), phase:Math.random()*6};
  return g;
}
// Árboles por especie (las alturas coinciden con SL.treeDims, que usa la física para los choques)
// copa: lóbulos [dx, y, dz, ancho, alto, fondo, tono, saturación, luz] en unidades de escala del árbol
const TREE_KIND={
  round:  {trunk:[3.2,1,1],   blobs:[[0.2,4.1,0,3.0,2.7,3.0,0.25,0.48,0.25]]},
  cypress:{trunk:[4.6,1.1,1.1], blobs:[[0,5.2,0,4.0,1.4,3.8,0.31,0.38,0.21],[1.4,4.7,0.8,2.6,1.1,2.4,0.30,0.36,0.23]]},
  gorse:  {trunk:null,          blobs:[[0.3,0.6,0.2,2.1,0.9,2.0,0.2,0.42,0.25]]},
  palm:   {trunk:[9,0.55,0.55], palm:true},
  euca:   {trunk:[9.5,1.15,1.15], pale:true, blobs:[[0,10.8,0,3.1,3.0,3.0,0.27,0.34,0.27],[0.4,12.8,-0.3,2.0,1.8,2.0,0.27,0.3,0.31]]},
  cone:   {trunk:[2.6,1,1],     cone:[1.35,7.5,2.1,0.33,0.42,0.2]} };
// ruido fijo por posición (los vértices repetidos se mueven igual: la malla no se abre)
const hash3=(x,y,z)=>{ const v=Math.sin(x*127.1+y*311.7+z*74.7)*43758.5453; return v-Math.floor(v); };
function mergeGeos(list){ let n=0; list.forEach(g=>n+=g.attributes.position.count); const pos=new Float32Array(n*3), col=new Float32Array(n*3); let o=0;
  list.forEach(g=>{ pos.set(g.attributes.position.array,o*3); if(g.attributes.color) col.set(g.attributes.color.array,o*3); else col.fill(1,o*3,(o+g.attributes.position.count)*3); o+=g.attributes.position.count; });
  const out=new T.BufferGeometry(); out.setAttribute("position",new T.BufferAttribute(pos,3)); out.setAttribute("color",new T.BufferAttribute(col,3)); out.computeVertexNormals(); return out; }
// copa "esponjosa": varios lóbulos de icosaedro con borde irregular, más oscura abajo (sombra propia) y clara arriba
function crownGeo(seed, low){
  const Rn=SL.rng(seed), parts=[], nL=low?3:4+Math.floor(Rn()*2);
  for(let k=0;k<nL;k++){ const g=new T.IcosahedronGeometry(1,!low&&k<1?1:0).toNonIndexed(), r=k===0?0.78:0.42+Rn()*0.28, a=Rn()*Math.PI*2, d=k===0?0:0.38+Rn()*0.3, oy=k===0?0:(Rn()-0.3)*0.55;
    const P=g.attributes.position; for(let i=0;i<P.count;i++){ const x=P.getX(i), y=P.getY(i), z=P.getZ(i), nz=1+(hash3(x+k,y,z)-0.5)*0.32;
      P.setXYZ(i, x*r*nz+Math.cos(a)*d, y*r*nz*0.92+oy, z*r*nz+Math.sin(a)*d); } parts.push(g); }
  const g=mergeGeos(parts), P=g.attributes.position, C=g.attributes.color; let y0=1e9,y1=-1e9; for(let i=0;i<P.count;i++){ y0=Math.min(y0,P.getY(i)); y1=Math.max(y1,P.getY(i)); }
  for(let i=0;i<P.count;i++){ const u=(P.getY(i)-y0)/(y1-y0||1), v=0.5+0.62*Math.pow(u,0.8)+(hash3(P.getX(i),P.getY(i),P.getZ(i))-0.5)*0.12; C.setXYZ(i,v,v,v); }
  return g; }
// pino: tres pisos de conos con el borde dentado
function pineGeo(){ const parts=[];
  [[0.0,1.0,0.55],[0.32,0.78,0.45],[0.6,0.52,0.4]].forEach(([y,r,h],k)=>{ const g=new T.ConeGeometry(r,h,9,1,true).toNonIndexed(); g.translate(0,y+h/2,0);
    const P=g.attributes.position, C=new Float32Array(P.count*3); for(let i=0;i<P.count;i++){ const yy=P.getY(i), base=yy<y+0.01; if(base){ const x=P.getX(i), z=P.getZ(i), j=1+(hash3(x,k,z)-0.5)*0.35; P.setXYZ(i,x*j,yy-0.04*hash3(z,x,k),z*j); }
      const v=base?0.55:0.95+0.15*k/2; C[i*3]=C[i*3+1]=C[i*3+2]=v; } g.setAttribute("color",new T.BufferAttribute(C,3)); parts.push(g); });
  return mergeGeos(parts); }
// hojas de palma: 9 frondas que se doblan hacia abajo, con la nervadura más clara
function frondGeo(){ const pos=[], col=[], N=8, segs=5;
  for(let f=0;f<N;f++){ const a=f/N*Math.PI*2+(f%2)*0.2, ca=Math.cos(a), sa=Math.sin(a), len=0.85+0.15*((f*7)%3)/2, droop=0.9+0.25*((f*5)%3)/2;
    const at=u=>{ const r=u*len, y=0.35*Math.sin(u*Math.PI*0.9)-droop*u*u; return [r,y]; };
    for(let k=0;k<segs;k++){ const u0=k/segs, u1=(k+1)/segs, [r0,y0]=at(u0), [r1,y1]=at(u1), w0=0.2*Math.sin(Math.PI*Math.min(1,u0*1.15)), w1=0.2*Math.sin(Math.PI*Math.min(1,u1*1.15));
      const P=(r,y,w,dy)=>[ca*r-sa*w, y+dy, sa*r+ca*w];
      const c0=0.75+0.35*u0, c1=0.75+0.35*u1, edge=0.6;
      for(const sd of [-1,1]){ const a0=P(r0,y0,0,0.03), a1=P(r1,y1,0,0.03), b0=P(r0,y0,sd*w0,-0.06*w0*5), b1=P(r1,y1,sd*w1,-0.06*w1*5);
        pos.push(...a0,...b0,...a1, ...a1,...b0,...b1); col.push(c0,c0,c0, edge*c0,edge*c0,edge*c0, c1,c1,c1, c1,c1,c1, edge*c0,edge*c0,edge*c0, edge*c1,edge*c1,edge*c1); } } }
  const g=new T.BufferGeometry(); g.setAttribute("position",new T.Float32BufferAttribute(pos,3)); g.setAttribute("color",new T.Float32BufferAttribute(col,3)); g.computeVertexNormals(); return g; }
// vaivén con el viento (en el sombreador: cada árbol con su propia fase, más arriba se mueve más)
const treeU={uTime:{value:0}, uAmp:{value:0.4}};
function swayMat(opts){ const m=new T.MeshPhongMaterial(Object.assign({color:0xffffff, vertexColors:true, flatShading:true, shininess:3, specular:0x0a0a0a},opts||{}));
  m.onBeforeCompile=sh=>{ sh.uniforms.uTime=treeU.uTime; sh.uniforms.uAmp=treeU.uAmp;
    sh.vertexShader="uniform float uTime; uniform float uAmp;\n"+sh.vertexShader.replace("#include <begin_vertex>",`#include <begin_vertex>
    #ifdef USE_INSTANCING
      vec3 ip=instanceMatrix[3].xyz; float ph=ip.x*0.071+ip.z*0.053;
      float hk=max(0.0,position.y+1.0);
      transformed.x+=(sin(uTime*1.7+ph)*0.6+sin(uTime*2.9+ph*1.7)*0.25)*uAmp*hk*0.05;
      transformed.z+=cos(uTime*1.3+ph*1.3)*uAmp*hk*0.035;
    #endif`); };
  return m; }
let GEO=null;
function treeGeos(){ if(GEO) return GEO;
  const trunk=new T.CylinderGeometry(0.13,0.26,1,7,3); trunk.translate(0,0.5,0);
  { const P=trunk.attributes.position; for(let i=0;i<P.count;i++){ const y=P.getY(i); P.setX(i,P.getX(i)+Math.sin(y*4.1)*0.04); P.setZ(i,P.getZ(i)+Math.cos(y*3.3)*0.04); } trunk.computeVertexNormals(); }
  const palmT=new T.CylinderGeometry(0.16,0.24,1,7,6); palmT.translate(0,0.5,0);
  { const P=palmT.attributes.position; for(let i=0;i<P.count;i++){ const y=P.getY(i); P.setX(i,P.getX(i)+0.18*y*y); } palmT.computeVertexNormals(); }   // tronco curvo
  GEO={trunk, palmT, crowns:[crownGeo(11),crownGeo(23),crownGeo(37),crownGeo(51,true)], pine:pineGeo(), frond:frondGeo(), nut:new T.IcosahedronGeometry(0.22,0)}; return GEO; }
function trees(list){
  const grp=new T.Group(), Rn=SL.rng(7), G=treeGeos();
  // copa: tres variantes cerca y una más liviana para el bosque de fondo
  const vOf=(t,k)=>t.deco?3:(k+Math.floor(t.hue*7))%3;
  let nT=0, nP=0, nC=0, nF=0; const nB=[0,0,0,0];
  for(const t of list){ const K=TREE_KIND[t.kind]||TREE_KIND.round; if(K.palm){ nP++; nF++; } else if(K.trunk) nT++; if(K.cone) nC++; (K.blobs||[]).forEach((b,k)=>nB[vOf(t,k)]++); }
  const bark=new T.MeshLambertMaterial({color:0xffffff, vertexColors:false});
  const trunks=new T.InstancedMesh(G.trunk,bark,Math.max(1,nT)), palms=new T.InstancedMesh(G.palmT,new T.MeshLambertMaterial({color:0x8a7356}),Math.max(1,nP));
  const crowns=G.crowns.map((g,k)=>new T.InstancedMesh(g,swayMat(),Math.max(1,nB[k]))), cones=new T.InstancedMesh(G.pine,swayMat(),Math.max(1,nC));
  const fronds=new T.InstancedMesh(G.frond,swayMat({side:T.DoubleSide}),Math.max(1,nF)), nuts=new T.InstancedMesh(G.nut,new T.MeshLambertMaterial({color:0x5a4526}),Math.max(1,nF));
  const m=new T.Matrix4(), q=new T.Quaternion(), q2=new T.Quaternion(), sc=new T.Vector3(), p=new T.Vector3(), col=new T.Color(), Y=new T.Vector3(0,1,0), E=new T.Euler();
  let it=0, ip=0, ic=0, iF=0; const ib=[0,0,0,0];
  for(const t of list){ const K=TREE_KIND[t.kind]||TREE_KIND.round, s=t.s, rot=t.hue*9; q.setFromAxisAngle(Y,rot); const c=Math.cos(rot), sn=Math.sin(rot);
    if(K.palm){ // palma: tronco curvo e inclinado, frondas y cocos arriba
      const H=K.trunk[0]*s*(0.9+t.hue*0.2), sx=s*K.trunk[1]*1.6, lean=0.06+t.hue*0.14;
      E.set(0,rot,-lean,"YXZ"); q2.setFromEuler(E); m.compose(p.set(t.x,0,t.z),q2,sc.set(sx,H,sx)); palms.setMatrixAt(ip++,m);
      const top=new T.Vector3(0.18*sx,H,0).applyQuaternion(q2).add(new T.Vector3(t.x,0,t.z));
      E.set((t.hue-0.5)*0.25,rot*1.7,(t.hue-0.5)*0.25); q2.setFromEuler(E); m.compose(p.copy(top),q2,sc.set(4.2*s,3.2*s,4.2*s)); fronds.setMatrixAt(iF,m);
      col.setHSL(0.24+t.hue*0.05,0.5,0.3+t.hue*0.06); fronds.setColorAt(iF,col);
      m.compose(p.set(top.x,top.y-0.35*s,top.z),q2,sc.set(s,s,s)); nuts.setMatrixAt(iF++,m); continue; }
    if(K.trunk){ m.compose(p.set(t.x,0,t.z),q,sc.set(s*K.trunk[1],K.trunk[0]*s,s*K.trunk[2])); trunks.setMatrixAt(it,m);
      col.setHSL(K.pale?0.09:0.07, K.pale?0.12:0.32, K.pale?0.62:0.26+t.hue*0.06); trunks.setColorAt(it++,col); }
    (K.blobs||[]).forEach((b,k)=>{ const v=vOf(t,k), dx=b[0]*s, dz=b[2]*s; q2.setFromAxisAngle(Y,rot+k*1.9);
      m.compose(p.set(t.x+dx*c+dz*sn,b[1]*s,t.z-dx*sn+dz*c),q2,sc.set(b[3]*s,b[4]*s,b[5]*s)); crowns[v].setMatrixAt(ib[v],m);
      const yel=t.kind==="gorse" && Rn()<0.35; col.setHSL(yel?0.14:b[6]+t.hue*0.05, yel?0.75:b[7], (yel?0.5:b[8])+t.hue*0.06); crowns[v].setColorAt(ib[v]++,col); });
    if(K.cone){ const k=K.cone; m.compose(p.set(t.x,k[0]*s,t.z),q,sc.set(k[2]*s*1.35,k[1]*s,k[2]*s*1.35)); cones.setMatrixAt(ic,m); col.setHSL(k[3]+t.hue*0.04,k[4],k[5]+t.hue*0.06); cones.setColorAt(ic++,col); } }
  trunks.count=it; palms.count=ip; cones.count=ic; fronds.count=iF; nuts.count=iF; crowns.forEach((cm,k)=>cm.count=ib[k]);
  grp.add(trunks,palms,cones,fronds,nuts,...crowns); return grp;
}
// bosque de fondo (solo se ve, no choca con la bola): llena los costados lejos del juego
function backdrop(h){ const R=SL.rng(h.seed*7+3), out=[], kinds=h.trees.length?h.trees.map(t=>t.kind):["round"], cs=h.cs, L=cs[cs.length-1].s;
  const free=(x,z)=>!h.water.some(w=>SL.geo.inPoly(w.pts,x,z)) && !h.trees.some(t=>Math.abs(t.x-x)<5 && Math.abs(t.z-z)<5) && SL.lieAt(h,x,z)!=="fairway" && SL.lieAt(h,x,z)!=="green";
  for(let i=0;i<cs.length;i+=3){ const c=cs[i]; let base=24; for(const f of h.fairSamples){ const d=Math.hypot(f.x-c.x,f.z-c.z); if(d<26) base=Math.max(base,f.w+d*0.5+10); }
    for(const side of [-1,1]) for(let r=0;r<2;r++){ const off=base+55+r*28+R()*30, x=c.x+c.nx*side*off+(R()-0.5)*10, z=c.z+c.nz*side*off+(R()-0.5)*10;
      if(free(x,z)) out.push({x,z,s:0.95+R()*0.8, kind:kinds[Math.floor(R()*kinds.length)], hue:R(), deco:true}); } }
  for(let k=0;k<26;k++){ const a=(R()-0.5)*2.4, d=45+R()*70, c=cs[cs.length-1], x=c.x+Math.sin(a)*d, z=c.z+Math.cos(a)*d+10;   // detrás del green
    if(free(x,z)) out.push({x,z,s:1+R()*0.8, kind:kinds[Math.floor(R()*kinds.length)], hue:R(), deco:true}); }
  return out; }
function signTex(text, sub){
  const c=document.createElement("canvas"); c.width=256; c.height=128; const x=c.getContext("2d");
  x.fillStyle="#123326"; x.fillRect(0,0,256,128); x.strokeStyle="#f2c230"; x.lineWidth=6; x.strokeRect(6,6,244,116);
  x.fillStyle="#ffffff"; x.font="bold 76px Barlow Condensed, Arial Narrow, sans-serif"; x.textAlign="center"; x.fillText(text,128,88);
  x.font="bold 22px Barlow Condensed, Arial Narrow, sans-serif"; x.fillStyle="#f2c230"; x.fillText(sub,128,116);
  const t=new T.CanvasTexture(c); t.anisotropy=4; return t;
}
function netTex(){ const c=document.createElement("canvas"); c.width=c.height=32; const x=c.getContext("2d");
  x.strokeStyle="rgba(30,30,30,0.9)"; x.lineWidth=2; x.strokeRect(0,0,32,32); const t=new T.CanvasTexture(c); t.wrapS=t.wrapT=T.RepeatWrapping; return t; }

function rangeTrees(){
  const Rn=SL.rng(55), out=[];
  for(let z=-30; z<420; z+=9+Rn()*7) for(const s of [-1,1]) if(Rn()<0.85) out.push({x:s*(92+Rn()*40), z, s:0.9+Rn()*0.8, kind:Rn()<0.3?"cone":"round", hue:Rn()});
  for(let x=-120; x<120; x+=8+Rn()*6) out.push({x, z:385+Rn()*30, s:1+Rn()*0.8, kind:Rn()<0.3?"cone":"round", hue:Rn()});
  return out;
}

// ---------------- construcción de escenas ----------------
function freeImg(im){ if(im && im.tagName==="CANVAS" && im.width>256 && !im.__keep){ im.width=im.height=1; } }
function clearWorld(){
  if(world){ linePool.forEach(l=>world.remove(l.mesh)); scene.remove(world); world.traverse(o=>{ if(o.geometry) o.geometry.dispose(); if(o.material){ (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{ if(m.map){ m.map.dispose(); freeImg(m.map.image); } m.dispose(); }); } }); }
  if(detail){ scene.remove(detail); detail.geometry.dispose(); detail.material.map.dispose(); freeImg(detail.material.map.image); detail.material.dispose(); detail=null; }
  world=new T.Group(); scene.add(world); flags=[]; marks=null; S.linesData=[]; linePool.forEach(l=>l.g.setDrawRange(0,0));
}
function mapBounds(){
  const maxT=Math.min(4096,R.capabilities.maxTextureSize);
  if(def.kind==="range") return {x0:-130,x1:130,z0:-40,z1:440,pw:1024,ph:maxT};
  const b=def.h.bounds, xs=b.x1-b.x0, zs=b.z1-b.z0, k=Math.min(6, Math.sqrt(4.5e6/(xs*zs)), maxT/zs, maxT/xs);
  return {x0:b.x0, x1:b.x1, z0:b.z0, z1:b.z1, pw:Math.round(xs*k), ph:Math.round(zs*k)};
}
W3.setRange=function(o){
  if(!W3.ok) return; def={kind:"range", um:o.um||1, trees:rangeTrees()}; clearWorld(); hills.forEach(hm=>hm.visible=true);
  const B=mapBounds(); def.B=B; world.add(groundPlane(B,paint(B),0,-1));
  world.add(trees(def.trees));
  for(const t of SL.RANGE_TARGETS){ const z=t.d*def.um, f=makeFlag(); f.position.set(t.x,0,z); world.add(f); flags.push(f);
    const dark=new T.MeshLambertMaterial({color:0x1d2b24}), face=new T.MeshBasicMaterial({map:signTex(String(t.d), def.um===1?"METROS":"YARDAS")});
    const sign=new T.Mesh(new T.BoxGeometry(5.2,2.6,0.18), [dark,dark,dark,dark,dark,face]);
    sign.position.set(t.x+15,2.9,z); world.add(sign);
    for(const dx of [-2,2]){ const post=new T.Mesh(new T.CylinderGeometry(0.08,0.08,1.6,5),new T.MeshLambertMaterial({color:0x2a2a2a})); post.position.set(t.x+15+dx,0.8,z); world.add(post); } }
  // redes laterales
  const nt=netTex(); nt.repeat.set(160,12);
  for(const s of [-1,1]){ const net=new T.Mesh(new T.PlaneGeometry(360,22),new T.MeshBasicMaterial({map:nt, transparent:true, opacity:0.32, side:T.DoubleSide, depthWrite:false}));
    net.rotation.y=Math.PI/2; net.position.set(s*80,11,170); world.add(net);
    for(let z=-10; z<=350; z+=40){ const pole=new T.Mesh(new T.CylinderGeometry(0.15,0.2,23,6),new T.MeshLambertMaterial({color:0x3a3a3a})); pole.position.set(s*80,11.5,z); world.add(pole); } }
  // tapetes y bolas de práctica regadas
  for(const x of [-9,-4.5,0,4.5,9]){ const mat=new T.Mesh(new T.BoxGeometry(1.6,0.04,1.6),new T.MeshLambertMaterial({color:0x2f5a32})); mat.position.set(x,0.02,0); world.add(mat); }
  const Rn=SL.rng(9), bl=new T.InstancedMesh(new T.SphereGeometry(0.06,6,4),new T.MeshLambertMaterial({color:0xf3f1e6}),420), m=new T.Matrix4();
  for(let i=0;i<420;i++){ const z=30+Math.pow(Rn(),0.8)*260, x=(Rn()-0.5)*(40+z*0.35); m.makeTranslation(x,0.05,z); bl.setMatrixAt(i,m); } world.add(bl);
  makeMarks(); W3.setWind({x:0.6,z:1.2});
};
// textura de fachada con ventanas
const facadeCache={};
function facadeTex(color,win){ const k=color+"|"+win; if(facadeCache[k]) return facadeCache[k];
  const c=document.createElement("canvas"); c.width=c.height=64; const x=c.getContext("2d"); x.fillStyle="#"+new T.Color(color).getHexString(); x.fillRect(0,0,64,64);
  x.globalAlpha=0.08; for(let i=0;i<120;i++){ x.fillStyle=Math.random()<0.5?"#000":"#fff"; x.fillRect(Math.random()*64|0,Math.random()*64|0,3,2); } x.globalAlpha=1;
  if(win){ x.fillStyle="#2f3a44"; x.fillRect(20,16,24,30); x.fillStyle="rgba(255,255,255,0.18)"; x.fillRect(20,16,24,6); x.fillStyle="rgba(0,0,0,0.25)"; x.fillRect(18,46,28,3); }
  const t=new T.CanvasTexture(c); t.wrapS=t.wrapT=T.RepeatWrapping; return (facadeCache[k]=t); }
function building(b){
  const g=new T.Group(), tex=facadeTex(b.color,b.win).clone(); tex.needsUpdate=true; tex.repeat.set(Math.max(1,Math.round(b.w/4.5)),Math.max(1,Math.round(b.h/3.6)));
  const tex2=tex.clone(); tex2.needsUpdate=true; tex2.repeat.set(Math.max(1,Math.round(b.d/4.5)),tex.repeat.y);
  const mw=new T.MeshLambertMaterial({map:tex}), md=new T.MeshLambertMaterial({map:tex2}), top=new T.MeshLambertMaterial({color:b.roofColor});
  const body=new T.Mesh(new T.BoxGeometry(b.w,b.h,b.d),[md,md,top,top,mw,mw]); body.position.y=b.h/2; g.add(body);
  if(b.roof==="hip" || b.roof==="gable"){ const rh=Math.min(b.w,b.d)*0.32, roof=new T.Mesh(new T.ConeGeometry(Math.SQRT1_2,1,4,1), new T.MeshLambertMaterial({color:b.roofColor}));
    roof.rotation.y=Math.PI/4; roof.geometry.rotateY(Math.PI/4); roof.rotation.y=0; roof.scale.set(b.w*(b.roof==="gable"?1.02:1.04),rh,b.d*1.04); roof.position.y=b.h+rh/2; g.add(roof); }
  g.position.set(b.x,0,b.z); g.rotation.y=-b.rot; return g; }
function shapeGeo(pts,y){ const sh=new T.Shape(pts.map(p=>new T.Vector2(p.x,-p.z))), g=new T.ShapeGeometry(sh); g.rotateX(-Math.PI/2); g.translate(0,y,0); return g; }
function groundUV(g,B){ const pos=g.attributes.position, uv=g.attributes.uv; for(let i=0;i<pos.count;i++){ uv.setXY(i,(pos.getX(i)-B.x0)/(B.x1-B.x0), 1-(pos.getZ(i)-B.z0)/(B.z1-B.z0)); } uv.needsUpdate=true; return g; }
// textura de olas suaves para el brillo del agua (se desplaza con el tiempo)
function makeWaterNormal(){ const N=128, c=document.createElement("canvas"); c.width=c.height=N; const x=c.getContext("2d"), im=x.createImageData(N,N);
  for(let j=0;j<N;j++) for(let i=0;i<N;i++){ const a=Math.sin((i/N)*Math.PI*2*3+Math.sin(j/N*Math.PI*2)*1.5), b=Math.sin((j/N)*Math.PI*2*4+Math.cos(i/N*Math.PI*2*2)), o=(j*N+i)*4;
    im.data[o]=128+a*60; im.data[o+1]=128+b*60; im.data[o+2]=230; im.data[o+3]=255; }
  x.putImageData(im,0,0); const t=new T.CanvasTexture(c); t.wrapS=t.wrapT=T.RepeatWrapping; t.__keep=true; c.__keep=true; return t; }
W3.setHole=function(h){
  if(!W3.ok) return; def={kind:"hole", h, trees:h.trees.concat(backdrop(h))}; clearWorld();
  const B=mapBounds(); def.B=B; const tex=paint(B); world.add(groundPlane(B,tex,0,-1));
  world.add(trees(def.trees));
  const inB=(p,m)=>p.x>B.x0-m && p.x<B.x1+m && p.z>B.z0-m && p.z<B.z1+m;
  // agua (mar, lagos y arroyos)
  waterMats=[]; if(!waterNormal) waterNormal=makeWaterNormal();
  for(const w of h.water){ const geo=shapeGeo(w.pts,0.03); { const pos=geo.attributes.position, uv=geo.attributes.uv; for(let i=0;i<pos.count;i++) uv.setXY(i,pos.getX(i)/14,pos.getZ(i)/14); uv.needsUpdate=true; }
    const mat=new T.MeshPhongMaterial({color:w.kind==="ocean"?(w.beach?0x2a8aa8:0x1f5f86):0x2a6c96, specular:0xe8f4ff, shininess:w.kind==="ocean"?70:90, transparent:true, opacity:0.94, normalMap:waterNormal, normalScale:new T.Vector2(0.35,0.35), polygonOffset:true, polygonOffsetFactor:-3, polygonOffsetUnits:-6});
    waterMats.push(mat); const wm=new T.Mesh(geo,mat);
    world.add(wm);
    if(w.kind==="ocean" && w.rocks){ // rocas a lo largo de la costa
      const sh=w.pts.slice(0,w.shore), Rn=SL.rng(h.seed*13), list=[];
      for(let i=0;i<sh.length-1;i++){ const a=sh[i], b=sh[i+1], L=Math.hypot(b.x-a.x,b.z-a.z); for(let s=0;s<L;s+=2.6){ const u=s/L, x=a.x+(b.x-a.x)*u, z=a.z+(b.z-a.z)*u; if(!inB({x,z},40)) continue;
        const nx=-(b.z-a.z)/L, nz=(b.x-a.x)/L, sg=SL.geo.inPoly(w.pts,x+nx*2,z+nz*2)?1:-1, o=Rn()*3.5; list.push({x:x+nx*sg*o, z:z+nz*sg*o, s:0.5+Rn()*1.7, r:Rn()}); } }
      const rk=new T.InstancedMesh(new T.DodecahedronGeometry(1,0),new T.MeshLambertMaterial({color:0xffffff}),Math.max(1,list.length)), m=new T.Matrix4(), q=new T.Quaternion(), col=new T.Color();
      list.forEach((r,i)=>{ q.setFromEuler(new T.Euler(r.r*3,r.r*7,r.r*5)); m.compose(new T.Vector3(r.x,r.s*0.05,r.z),q,new T.Vector3(r.s*1.3,r.s*0.75,r.s)); rk.setMatrixAt(i,m); col.setHSL(0.08,0.12,0.3+r.r*0.18); rk.setColorAt(i,col); });
      rk.count=list.length; world.add(rk); }
    if(w.kind==="burn"){ // muros de piedra del arroyo
      const sh=w.pts, mat=new T.MeshLambertMaterial({color:0x8d877a});
      for(let i=0;i<sh.length-1;i++){ const a=sh[i], b=sh[i+1]; if(i===sh.length/2-1) continue; const L=Math.hypot(b.x-a.x,b.z-a.z); if(!inB(a,20)) continue;
        const wl=new T.Mesh(new T.BoxGeometry(L,0.5,0.35),mat); wl.position.set((a.x+b.x)/2,0.05,(a.z+b.z)/2); wl.rotation.y=-Math.atan2(b.z-a.z,b.x-a.x); world.add(wl); } }
  }
  // islas y pasillos sobre el agua, con la misma textura del suelo
  for(const l of h.land) world.add(new T.Mesh(groundUV(shapeGeo(l.pts,0.05),B), new T.MeshLambertMaterial({map:tex, polygonOffset:true, polygonOffsetFactor:-4, polygonOffsetUnits:-8})));
  // edificios, muros y estacas de fuera de límites
  for(const b of h.buildings) world.add(building(b));
  const stone=new T.MeshLambertMaterial({color:0x9a9283});
  for(const w of h.walls) for(let i=0;i<w.pts.length-1;i++){ const a=w.pts[i], b=w.pts[i+1], L=Math.hypot(b.x-a.x,b.z-a.z);
    const wl=new T.Mesh(new T.BoxGeometry(L,w.h,0.6),stone); wl.position.set((a.x+b.x)/2,w.h/2,(a.z+b.z)/2); wl.rotation.y=-Math.atan2(b.z-a.z,b.x-a.x); world.add(wl); }
  const st=[]; for(const line of h.stakes) for(let i=0;i<line.length-1;i++){ const a=line[i], b=line[i+1], L=Math.hypot(b.x-a.x,b.z-a.z); if(L>600) continue;
    for(let s=0;s<L;s+=11){ const u=s/L, p={x:a.x+(b.x-a.x)*u, z:a.z+(b.z-a.z)*u}; if(inB(p,0)) st.push(p); } }
  if(st.length){ const sm=new T.InstancedMesh(new T.CylinderGeometry(0.05,0.05,1,6).translate(0,0.5,0),new T.MeshLambertMaterial({color:0xf4f4f4}),st.length), m=new T.Matrix4();
    st.forEach((p,i)=>{ m.makeTranslation(p.x,0,p.z); sm.setMatrixAt(i,m); }); world.add(sm); }
  hills.forEach(hm=>{ hm.visible=!h.water.some(w=>w.kind==="ocean" && SL.geo.inPoly(w.pts,hm.position.x,hm.position.z)); });
  const f=makeFlag(); f.position.set(h.pinX,0,h.L); world.add(f); flags.push(f);
  for(const [x,c] of [[-3.5,0xe8e8e8],[3.5,0xe8e8e8]]){ const tm=new T.Mesh(new T.SphereGeometry(0.16,10,8),new T.MeshLambertMaterial({color:c})); tm.position.set(x,0.12,1); world.add(tm); }
};
function makeMarks(){
  marks=new T.InstancedMesh(new T.CircleGeometry(0.5,12).rotateX(-Math.PI/2), new T.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0.85, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-4, polygonOffsetUnits:-8}), 60);
  marks.count=0; world.add(marks);
}
W3.setMarks=function(list){ if(!W3.ok || !marks) return; const m=new T.Matrix4(); const L=list.slice(-60);
  L.forEach((p,i)=>{ m.makeTranslation(p.x,0.04,p.z); marks.setMatrixAt(i,m); }); marks.count=L.length; marks.instanceMatrix.needsUpdate=true; };
W3.setLines=function(lines){ S.linesData=lines.map(l=>l.map(p=>[p.x,p.y+0.05,p.z]));
  while(linePool.length<S.linesData.length){ const l=new SSLine(140,0xffffff,2,0.55); l.res(canvas.clientWidth,canvas.clientHeight); linePool.push(l); }
  linePool.forEach((l,i)=>{ if(l.mesh.parent!==world) world.add(l.mesh); if(i>=S.linesData.length) l.g.setDrawRange(0,0); }); };
W3.setWind=function(w){ S.wind={x:w.x||0,z:w.z||0}; };

// parche de alta definición alrededor de la bola
function paintDetail(x,z){
  if(!def) return; if(detail){ scene.remove(detail); detail.geometry.dispose(); detail.material.map.dispose(); freeImg(detail.material.map.image); detail.material.dispose(); detail=null; }
  const B={x0:x-34,x1:x+34,z0:z-34,z1:z+34,pw:1024,ph:1024}; const tex=paint(B);
  const c=tex.image, ctx=c.getContext("2d"); ctx.setTransform(1,0,0,1,0,0); ctx.globalCompositeOperation="destination-in";
  const g=ctx.createRadialGradient(512,512,300,512,512,512); g.addColorStop(0,"rgba(0,0,0,1)"); g.addColorStop(1,"rgba(0,0,0,0)"); ctx.fillStyle=g; ctx.fillRect(0,0,1024,1024);
  ctx.globalCompositeOperation="source-over"; tex.needsUpdate=true;
  detail=groundPlane(B,tex,0.012,-2,true); scene.add(detail);
}

// ---------------- cámara y animación ----------------
W3.address=function(x,z,yaw,immediate){
  if(!W3.ok) return; S.anim=null; S.putt=null; S.fly=null; S.trail=[]; S.address={x,z,yaw};
  S.f={x:Math.sin(yaw),z:Math.cos(yaw)}; S.r={x:Math.cos(yaw),z:-Math.sin(yaw)};
  ball.position.set(x,BALL_R,z); ball.visible=true;
  const pos=new T.Vector3(x-S.f.x*5.2, 1.7, z-S.f.z*5.2), look=new T.Vector3(x+S.f.x*90, 1.5, z+S.f.z*90);
  S.cam.tPos=pos; S.cam.tLook=look; S.cam.rate=1.6; S.cam.lookRate=2;
  if(immediate){ S.cam.pos.copy(pos); S.cam.look.copy(look); }
  if(!S.detailAt || Math.hypot(S.detailAt.x-x,S.detailAt.z-z)>0.5 || S.detailDef!==def){ paintDetail(x,z); S.detailAt={x,z}; S.detailDef=def; }
  S.aimView=false;
};
// ---------------- apuntar (estilo TrackMan) ----------------
// patrón de dispersión del jugador: elipses de 1 y 2 desviaciones (≈40% y ≈86% de los tiros), orientadas con el tiro
let patG=null;
W3.setPattern=function(p){ S.pattern=p||null; if(!patG) return; patG.visible=!!p; if(!p) return;
  patG.position.set(p.x,0.07,p.z); patG.rotation.y=Math.PI+p.yaw; patG.children[0].scale.set(p.sl,1,p.sd); patG.children[1].scale.set(p.sl,1,p.sd); patG.children[2].scale.set(2*p.sl,1,2*p.sd); patG.children[3].scale.set(2*p.sl,1,2*p.sd); };
W3.setAim=function(p){ S.aim=p?{x:p.x,z:p.z}:null; if(aimRing) aimRing.visible=!!p; };
W3.pick=function(cx,cy){ if(!W3.ok) return null; const r=canvas.getBoundingClientRect();
  const ndc=new T.Vector2(((cx-r.left)/r.width)*2-1, -((cy-r.top)/r.height)*2+1), rc=new T.Raycaster(); rc.setFromCamera(ndc,camera);
  const hit=new T.Vector3(); if(!rc.ray.intersectPlane(new T.Plane(new T.Vector3(0,1,0),0),hit)) return null;
  if(hit.distanceTo(camera.position)>1500) return null; return {x:hit.x, z:hit.z}; };
// vista aérea para elegir el objetivo; o: {x,z,span} centro y tamaño del área
W3.aimView=function(on,o){ if(!W3.ok) return; S.aimView=!!on;
  if(on){ const h=Math.max(60,o.span*1.05), f=S.f; S.cam.tPos=new T.Vector3(o.x-f.x*h*0.18, h, o.z-f.z*h*0.18); S.cam.tLook=new T.Vector3(o.x+f.x*h*0.04,0,o.z+f.z*h*0.04); S.cam.rate=3; S.cam.lookRate=3; }
  else { const a=S.address; W3.address(a.x,a.z,a.yaw,false); } };
function interp(a,tt){ let i=a.i||0; while(i<a.pts.length-2 && a.pts[i+1].t<tt) i++; a.i=i; const p=a.pts[i], q=a.pts[i+1]||p, k=Math.max(0,Math.min(1,(tt-p.t)/((q.t-p.t)||1)));
  return [p.x+(q.x-p.x)*k, p.y+(q.y-p.y)*k, p.z+(q.z-p.z)*k]; }
W3.playShot=function(o){ // o: {pts:[{t,x,y,z}] mundo, landT, onLand, onEnd}
  if(!W3.ok){ o.onLand&&o.onLand(); o.onEnd&&o.onEnd(); return; }
  const last=o.pts[o.pts.length-1], land=o.pts.find(p=>p.t>=o.landT)||last;
  S.anim={pts:o.pts, landT:o.landT, dur:last.t, t0:clock.elapsedTime, onLand:o.onLand, onEnd:o.onEnd, landed:false, land, last, green:false, i:0};
  S.trail=[]; S.fly=null;
};
W3.playPutts=function(o){ // o: {from:{x,z}, pin:{x,z}, n, onPutt, onHole, onEnd}
  if(!W3.ok){ o.onHole&&o.onHole(); o.onEnd&&o.onEnd(); return; }
  const segs=[]; let cur={...o.from}; const Rn=Math.random;
  for(let k=0;k<o.n;k++){
    const dx=o.pin.x-cur.x, dz=o.pin.z-cur.z, d=Math.hypot(dx,dz)||0.01, ux=dx/d, uz=dz/d, last=k===o.n-1;
    let to; if(last) to={x:o.pin.x,z:o.pin.z};
    else { const miss=Math.min(2.5,0.35+d*0.09), along=(Rn()<0.6?1:-1)*miss*(0.4+Rn()*0.6), side=(Rn()-0.5)*miss;
      to={x:o.pin.x+ux*along-uz*side, z:o.pin.z+uz*along+ux*side}; }
    const dist=Math.hypot(to.x-cur.x,to.z-cur.z); segs.push({from:cur,to,dur:1.0+Math.sqrt(dist)*0.55,holed:last}); cur=to;
  }
  S.anim=null; S.trail=[]; S.putt={segs, k:0, t0:clock.elapsedTime+0.6, pin:o.pin, onPutt:o.onPutt, onHole:o.onHole, onEnd:o.onEnd, started:false, done:false};
};
W3.skip=function(){ if(S.anim) S.anim.skip=true; if(S.putt) S.putt.skip=true; if(S.fly) S.fly.skip=true; };
// Vuelo sobre el hoyo al empezar: de la salida al green, como en la TV
W3.flyover=function(h,onEnd){ if(!W3.ok){ onEnd&&onEnd(); return; } S.fly={h, t0:clock.elapsedTime, dur:Math.min(6.5,3.2+h.len/170), onEnd, skip:false}; };
W3.flying=()=>!!S.fly;
W3.busy=()=>!!(S.anim||S.putt);
let aimRing=null, aimDisc=null, aimLine=null, hills=[], hillMatRef=null, mtns=null, waterMats=[], waterNormal=null;
// Paisaje según el campo: montañas (Bogotá), mar abierto (Caribe) o colinas suaves
W3.setScenery=function(kind){ if(!W3.ok) return;
  const andes=kind==="andes";
  hills.forEach(hm=>{ const u=hm.userData; if(!u.s) return; hm.scale.copy(u.s); hm.position.copy(u.p);
    if(andes){ hm.scale.y=u.s.y*1.8+50; hm.scale.x=u.s.x*1.3; hm.scale.z=u.s.z*1.3; hm.position.y=-20; } });
  if(hillMatRef) hillMatRef.color.set(andes?0x46683f:kind==="caribe"?0x5f9a50:0x56824a);
  if(mtns) mtns.visible=andes;
  scene.fog.color.set(andes?0xc3d3dc:kind==="caribe"?0xd2e8f0:0xc8dde8); scene.fog.far=andes?3400:2300;
};


function update(dt){
  const now=clock.elapsedTime, C=S.cam, f=S.f, r=S.r;
  // vuelo
  if(S.anim){ const a=S.anim, tt=a.skip?a.dur:now-a.t0;
    const b=interp(a,Math.min(tt,a.dur)); ball.position.set(b[0],b[1]+BALL_R,b[2]);
    S.trail=a.pts.filter(p=>p.t<=Math.min(tt,a.landT)).map(p=>[p.x,p.y+0.02,p.z]); if(tt<a.landT) S.trail.push([b[0],b[1],b[2]]);
    if(!a.landed && tt>=a.landT){ a.landed=true; a.onLand&&a.onLand(); }
    const land=a.land, hold=Math.min(1.0,a.landT*0.3);
    if(a.landT<2.6){ C.tPos=new T.Vector3(S.address.x-f.x*5.2,2.2,S.address.z-f.z*5.2); C.tLook=new T.Vector3(b[0]+f.x*3,b[1]*0.8,b[2]+f.z*3); C.rate=2; C.lookRate=4; }
    else if(tt<hold){ C.tLook=new T.Vector3(b[0]+f.x*25,b[1]+2,b[2]+f.z*25); C.lookRate=3; }
    else if(tt<a.landT-1.5){ C.tPos=new T.Vector3(b[0]-f.x*30, Math.max(3,b[1]*0.55+3), b[2]-f.z*30); C.tLook=new T.Vector3(b[0]+f.x*20,b[1]*0.85,b[2]+f.z*20); C.rate=2.4; C.lookRate=4; }
    else { if(!a.green){ a.green=true; C.pos.set(land.x+f.x*27-r.x*9, 3.4, land.z+f.z*27-r.z*9); C.look.set(b[0],b[1],b[2]); }
      C.tPos=new T.Vector3(land.x+f.x*27-r.x*9, 3.4, land.z+f.z*27-r.z*9); C.tLook=new T.Vector3(b[0],b[1]*0.9+0.3,b[2]); C.rate=1; C.lookRate=a.landed?3:7; }
    if(tt>=a.dur){ const cb=a.onEnd; S.anim=null; if(!a.green && a.landT>=2.6){ /* deja la cámara donde va */ } cb&&cb(); }
  }
  // putts
  if(S.putt){ const P=S.putt, s=P.segs[P.k];
    if(s){ const u=P.skip?1:Math.max(0,Math.min(1,(now-P.t0)/s.dur)), e=1-Math.pow(1-u,2);
      if(!P.started && now>=P.t0){ P.started=true; P.onPutt&&P.onPutt(P.k); }
      const x=lerp(s.from.x,s.to.x,e), z=lerp(s.from.z,s.to.z,e);
      ball.position.set(x, BALL_R - (s.holed && u>=1 ? 0.08:0), z); ball.visible=!(s.holed && u>=1);
      const dx=P.pin.x-s.from.x, dz=P.pin.z-s.from.z, d=Math.hypot(dx,dz)||1;
      C.tPos=new T.Vector3(s.from.x-dx/d*3.4, 1.05, s.from.z-dz/d*3.4); C.tLook=new T.Vector3(P.pin.x,0.1,P.pin.z); C.rate=2.5; C.lookRate=3;
      if(!P.cut){ P.cut=true; C.pos.copy(C.tPos); C.look.copy(C.tLook); }
      if(u>=1){ if(s.holed && !P.holed){ P.holed=true; P.onHole&&P.onHole(); } P.k++; P.started=false; P.cut=false; P.t0=now+(P.skip?0:0.7); }
    } else if(!P.done){ P.done=true; const cb=P.onEnd; S.putt=null; cb&&cb(); }
  }
  // vuelo de presentación del hoyo
  if(S.fly && !S.anim && !S.putt){ const F=S.fly, h=F.h, cs=h.cs, u=F.skip?1:Math.min(1,(now-F.t0)/F.dur), e=u<0.5?2*u*u:1-Math.pow(-2*u+2,2)/2;
    const L=cs[cs.length-1].s, at=s=>{ s=Math.max(0,Math.min(L,s)); let i=Math.min(cs.length-1,Math.round(s/4)); return cs[i]; };
    const p=at(e*L-30), q=at(Math.min(L,e*L+120)), hgt=38-18*e;
    C.tPos=new T.Vector3(p.x, hgt, p.z); C.tLook=new T.Vector3(e>0.8?h.pinX:q.x, 0, e>0.8?h.L:q.z); C.rate=3; C.lookRate=2.5;
    if(!F.started){ F.started=true; C.pos.copy(C.tPos); C.look.copy(C.tLook); }
    if(u>=1){ const cb=F.onEnd; S.fly=null; cb&&cb(); } }
  treeU.uTime.value=now; treeU.uAmp.value=0.25+Math.min(8,Math.hypot(S.wind.x,S.wind.z))*0.12;
  if(waterMats.length && waterNormal){ waterNormal.offset.x=(now*0.012)%1; waterNormal.offset.y=(now*0.007)%1; }
  // cámara suave
  if(C.tPos){ C.pos.lerp(C.tPos,1-Math.exp(-dt*C.rate)); }
  if(C.tLook){ C.look.lerp(C.tLook,1-Math.exp(-dt*C.lookRate)); }
  camera.position.copy(C.pos); camera.lookAt(C.look); camera.updateMatrixWorld();
  sky.position.copy(camera.position);
  // bola y sombra con tamaño legible a distancia
  const d=camera.position.distanceTo(ball.position), s=Math.max(1.4,d*0.21);
  ball.scale.setScalar(s); if(!S.putt) ball.position.y=Math.max(ball.position.y,BALL_R*s);
  shadow.position.set(ball.position.x,0.03,ball.position.z); const hgt=Math.max(0,ball.position.y-BALL_R*s);
  shadow.scale.setScalar(s*(1+hgt*0.02)); shadow.material.opacity=ball.visible?0.42*Math.exp(-hgt/22):0; shadow.visible=ball.visible;
  // trazador
  trOuter.set(S.trail); trCore.set(S.trail);
  S.linesData.forEach((l,i)=>linePool[i] && linePool[i].set(l));
  // objetivo y línea de mira (solo en address)
  const showAim=!!S.aim && !S.anim && !S.putt;
  aimRing.visible=showAim; aimDisc.visible=showAim; if(patG) patG.visible=!!S.pattern && !S.anim && !S.putt && !S.fly;
  if(showAim){ const a=S.aim, dd=camera.position.distanceTo(new T.Vector3(a.x,0,a.z)), sc=Math.max(1,dd/32)*(1+0.06*Math.sin(now*4));
    aimRing.position.set(a.x,0.08,a.z); aimRing.scale.setScalar(sc); aimDisc.position.set(a.x,0.07,a.z); aimDisc.scale.setScalar(sc);
    const b=S.address, n=40, pts=[]; for(let i=0;i<=n;i++){ const k=i/n; pts.push([b.x+(a.x-b.x)*k, 0.09, b.z+(a.z-b.z)*k]); } aimLine.set(pts); }
  else aimLine.g.setDrawRange(0,0);
  // banderas al viento
  const ws=Math.hypot(S.wind.x,S.wind.z), wy=Math.atan2(-S.wind.z,S.wind.x);
  for(const fl of flags){ const u=fl.userData, pos=u.cloth.geometry.attributes.position, b=u.base;
    for(let i=0;i<pos.count;i++){ const x=b[3*i], amp=(0.03+Math.min(ws,6)*0.012)*(x/0.62);
      pos.array[3*i+2]=b[3*i+2]+Math.sin(x*10-now*(4+ws*1.2)+u.phase)*amp; pos.array[3*i+1]=b[3*i+1]-(ws<0.5?x*0.35:0); }
    pos.needsUpdate=true; u.cloth.geometry.computeVertexNormals(); fl.rotation.y=ws>0.2?wy:0;
    const fd=camera.position.distanceTo(fl.position); fl.scale.setScalar(Math.max(1,fd/45)); }
}

// con la cámara leyendo el swing, el campo quieto se dibuja a menos cuadros para dejarle el procesador al detector de pose
let lastDraw=0; W3.idleFps=0;
function loop(){ requestAnimationFrame(loop); if(!W3.active || document.hidden) return;
  const now=performance.now(); if(W3.idleFps && !S.anim && !S.putt && now-lastDraw<1000/W3.idleFps) return;
  lastDraw=now; const dt=Math.min(W3.idleFps?0.12:0.05,clock.getDelta()); update(dt); R.render(scene,camera); }
W3.stats=()=>R?{tris:R.info.render.triangles, calls:R.info.render.calls}:null;
W3.resize=function(){ if(!W3.ok) return; const w=canvas.clientWidth||1, h=canvas.clientHeight||1; R.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix();
  [trOuter,trCore,aimLine,...linePool].forEach(l=>l&&l.res(w,h)); };
W3.setActive=function(a){ W3.active=a; if(a) W3.resize(); };

W3.init=function(cv){
  T=window.THREE; if(!T) return false;
  try{ R=new T.WebGLRenderer({canvas:cv, antialias:true, powerPreference:"high-performance"}); }catch(e){ return false; }
  canvas=cv; R.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  scene=new T.Scene(); scene.fog=new T.Fog(0xc8dde8,300,2300);
  camera=new T.PerspectiveCamera(52,1,0.5,4000);
  sunDir=new T.Vector3(-0.42,0.6,-0.68).normalize();
  hemi=new T.HemisphereLight(0xd9ecff,0x4c6b32,0.78); scene.add(hemi);
  sun=new T.DirectionalLight(0xfff1dc,0.82); sun.position.copy(sunDir).multiplyScalar(500); scene.add(sun);
  // cielo
  sky=new T.Mesh(new T.SphereGeometry(3000,32,16), new T.ShaderMaterial({side:T.BackSide, depthWrite:false, fog:false,
    uniforms:{top:{value:new T.Color(0x3f86d1)}, hor:{value:new T.Color(0xcfe3ee)}, sun:{value:sunDir}},
    vertexShader:`varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader:`uniform vec3 top; uniform vec3 hor; uniform vec3 sun; varying vec3 vP;
      void main(){ float h=max(vP.y,0.0); vec3 c=mix(hor,top,pow(h,0.55)); float s=max(dot(normalize(vP),sun),0.0);
        c+=vec3(1.0,0.93,0.78)*(pow(s,900.0)*1.4+pow(s,12.0)*0.18); if(vP.y<0.0) c=hor*0.95; gl_FragColor=vec4(c,1.0); }`}));
  sky.renderOrder=-10; scene.add(sky);
  // nubes suaves
  const cc=document.createElement("canvas"); cc.width=cc.height=128; const cx=cc.getContext("2d"); const gr=cx.createRadialGradient(64,64,4,64,64,64);
  gr.addColorStop(0,"rgba(255,255,255,0.9)"); gr.addColorStop(1,"rgba(255,255,255,0)"); cx.fillStyle=gr; cx.fillRect(0,0,128,128);
  const cloudTex=new T.CanvasTexture(cc), Rn=SL.rng(4);
  for(let i=0;i<26;i++){ const a=Rn()*Math.PI*2, rad=1300+Rn()*900, sp=new T.Sprite(new T.SpriteMaterial({map:cloudTex, transparent:true, opacity:0.55+Rn()*0.3, fog:false, depthWrite:false}));
    sp.scale.set(420+Rn()*500,90+Rn()*80,1); sp.position.set(Math.sin(a)*rad,260+Rn()*260,Math.cos(a)*rad); scene.add(sp); }
  // colinas lejanas
  const hillMat=new T.MeshLambertMaterial({color:0x56824a});
  for(let i=0;i<34;i++){ const a=i/34*Math.PI*2+Rn()*0.2, rad=1500+Rn()*700, hm=new T.Mesh(new T.SphereGeometry(1,18,10),hillMat);
    hm.scale.set(200+Rn()*300,35+Rn()*85,200+Rn()*300); hm.position.set(Math.sin(a)*rad,-15,Math.cos(a)*rad); hm.userData={s:hm.scale.clone(), p:hm.position.clone(), a, r:Rn()}; scene.add(hm); hills.push(hm); }
  hillMatRef=hillMat;
  // cordillera lejana (solo en los campos de montaña, como la sabana de Bogotá)
  const mtnMat=new T.MeshLambertMaterial({color:0x6f8ea0}); mtns=new T.Group();
  for(let i=0;i<30;i++){ const a=i/30*Math.PI*2+Rn()*0.15, rad=2500+Rn()*300, m=new T.Mesh(new T.ConeGeometry(1,1,7),mtnMat);
    m.scale.set(420+Rn()*420,380+Rn()*560,420+Rn()*420); m.position.set(Math.sin(a)*rad,m.scale.y/2-40,Math.cos(a)*rad); m.rotation.y=Rn()*3; mtns.add(m); }
  mtns.visible=false; scene.add(mtns);
  // suelo base con textura repetida
  const bc=document.createElement("canvas"); bc.width=bc.height=256; const bx=bc.getContext("2d"); bx.fillStyle="#5a893a"; bx.fillRect(0,0,256,256);
  for(let k=0;k<5000;k++){ bx.fillStyle=["#4a7a2f","#6a9b45","#557f36","#79a952"][k%4]; bx.globalAlpha=0.5; bx.fillRect(Math.random()*256|0,Math.random()*256|0,2,2); }
  const bt=new T.CanvasTexture(bc); bt.wrapS=bt.wrapT=T.RepeatWrapping; bt.repeat.set(700,700); bt.anisotropy=4;
  const base=new T.Mesh(new T.PlaneGeometry(8000,8000),new T.MeshLambertMaterial({map:bt})); base.rotation.x=-Math.PI/2; base.position.y=-0.15; scene.add(base);
  // bola, sombra y trazador
  ball=new T.Mesh(new T.SphereGeometry(BALL_R,18,12),new T.MeshPhongMaterial({color:0xffffff, emissive:0x333333, shininess:70})); scene.add(ball);
  shadow=new T.Mesh(new T.CircleGeometry(0.03,16).rotateX(-Math.PI/2),new T.MeshBasicMaterial({color:0x000000, transparent:true, opacity:0.4, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-6, polygonOffsetUnits:-12})); scene.add(shadow);
  trOuter=new SSLine(600,0x101010,6.5,0.28); trCore=new SSLine(600,0xffcf33,3,1); scene.add(trOuter.mesh,trCore.mesh);
  aimLine=new SSLine(48,0xffffff,2.2,0.75); scene.add(aimLine.mesh);
  aimRing=new T.Mesh(new T.RingGeometry(1.25,1.6,48).rotateX(-Math.PI/2), new T.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0.95, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-8, polygonOffsetUnits:-16}));
  { const mk=(g,col,op,f)=>new T.Mesh(g,new T.MeshBasicMaterial({color:col, transparent:true, opacity:op, depthWrite:false, polygonOffset:true, polygonOffsetFactor:f, polygonOffsetUnits:f*2}));
    patG=new T.Group(); patG.add(mk(new T.CircleGeometry(1,48).rotateX(-Math.PI/2),0xffcf33,0.3,-5), mk(new T.RingGeometry(0.94,1,64).rotateX(-Math.PI/2),0xffffff,0.95,-6),
      mk(new T.CircleGeometry(1,48).rotateX(-Math.PI/2),0xffcf33,0.12,-4), mk(new T.RingGeometry(0.97,1,64).rotateX(-Math.PI/2),0xffffff,0.7,-6)); patG.visible=false; scene.add(patG); }
  aimDisc=new T.Mesh(new T.CircleGeometry(1.25,40).rotateX(-Math.PI/2), new T.MeshBasicMaterial({color:0xffcf33, transparent:true, opacity:0.35, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-7, polygonOffsetUnits:-14}));
  aimRing.visible=aimDisc.visible=false; scene.add(aimRing,aimDisc);
  clock=new T.Clock();
  S.cam.pos=new T.Vector3(0,1.7,-5.2); S.cam.look=new T.Vector3(0,1.5,90);
  W3.ok=true; W3.resize(); loop(); return true;
};
})();
