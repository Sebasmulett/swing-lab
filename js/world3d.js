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
function paint(B){
  const c=document.createElement("canvas"); c.width=B.pw; c.height=B.ph; const ctx=c.getContext("2d");
  const sx=B.pw/(B.x1-B.x0), sz=B.ph/(B.z1-B.z0);
  const W=()=>ctx.setTransform(sx,0,0,sz,-B.x0*sx,-B.z0*sz), P=()=>ctx.setTransform(1,0,0,1,0,0);
  P(); ctx.fillStyle="#5a893a"; ctx.fillRect(0,0,B.pw,B.ph);
  W(); variation(ctx,B,23,0.35,11); variation(ctx,B,6,0.22,3);
  P(); speckle(ctx,B.pw,B.ph,(B.pw*B.ph/22)|0,["#4a7a2f","#6a9b45","#557f36","#79a952","#466f2b"],0.55);
  W();
  const shadowsOf=(trees)=>{ ctx.fillStyle="rgba(18,38,10,0.34)";
    for(const t of trees){ const r=(t.kind==="cone"?2.2:2.9)*t.s; ctx.beginPath(); ctx.ellipse(t.x+r*0.9,t.z+r*1.3,r*1.1,r*1.5,0.5,0,Math.PI*2); ctx.fill(); } };
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
  } else {
    const h=def.h, cx=z=>SL.cxAt(h,z), hw=z=>SL.hwAt(h,z);
    // camino de carritos
    ctx.strokeStyle="#b9b3a0"; ctx.lineWidth=2.4; ctx.beginPath();
    for(let z=-6; z<=h.L+25; z+=3){ const x=cx(z)-(h.fw/2+15)+3*Math.sin(z/53); z<-5?ctx.moveTo(x,z):ctx.lineTo(x,z); } ctx.stroke();
    // agua: orilla y lámina
    for(const w of h.water){ ctx.fillStyle="#3f6e2f"; ctx.fillRect(w.x0-2.5,w.z0-2.5,w.x1-w.x0+5,w.z1-w.z0+5); ctx.fillStyle="#1f5a80"; ctx.fillRect(w.x0,w.z0,w.x1-w.x0,w.z1-w.z0); }
    // calle con primer corte y franjas de corte
    const path=(extra)=>{ ctx.beginPath(); const zs=[]; for(let z=h.fwStart; z<=h.L-h.greenR*0.3; z+=3) zs.push(z);
      zs.forEach((z,i)=>{ const x=cx(z)-hw(z)-extra; i?ctx.lineTo(x,z):ctx.moveTo(x,z); });
      for(let i=zs.length-1;i>=0;i--){ const z=zs[i]; ctx.lineTo(cx(z)+hw(z)+extra,z); } ctx.closePath(); };
    if(h.fw>0){ ctx.fillStyle="#6d9e44"; path(2.6); ctx.fill();
      ctx.save(); path(0); ctx.clip(); stripes(ctx,B,12,"#86be5a","#76ad4c"); W(); variation(ctx,B,6,0.1,9); ctx.restore(); }
    // tee
    ctx.save(); ctx.beginPath(); ctx.rect(-5.5,-4,11,11); ctx.clip(); stripes(ctx,B,2,"#86be5a","#7cb352"); ctx.restore();
    // bunkers
    for(const b of h.bunkers){ ctx.fillStyle="#8f7d4f"; circlePath(ctx,b.x,b.z,b.r+0.7); ctx.fill();
      ctx.save(); circlePath(ctx,b.x,b.z,b.r); ctx.clip(); ctx.fillStyle="#e2cf9c"; ctx.fillRect(b.x-b.r,b.z-b.r,b.r*2,b.r*2);
      ctx.strokeStyle="rgba(170,145,95,0.35)"; ctx.lineWidth=0.18; for(let k=-b.r;k<b.r;k+=0.8){ ctx.beginPath(); ctx.moveTo(b.x-b.r,b.z+k); ctx.lineTo(b.x+b.r,b.z+k+1.5); ctx.stroke(); }
      const g=ctx.createRadialGradient(b.x,b.z,b.r*0.5,b.x,b.z,b.r); g.addColorStop(0,"rgba(0,0,0,0)"); g.addColorStop(1,"rgba(90,70,30,0.35)"); ctx.fillStyle=g; ctx.fillRect(b.x-b.r,b.z-b.r,b.r*2,b.r*2); ctx.restore(); }
    // green
    ctx.fillStyle="#76b24d"; circlePath(ctx,h.pinX,h.L,h.greenR+3); ctx.fill();
    ctx.save(); circlePath(ctx,h.pinX,h.L,h.greenR); ctx.clip(); stripes(ctx,B,2.5,"#95d068","#8ac55f");
    const g=ctx.createRadialGradient(h.pinX-3,h.L-3,1,h.pinX,h.L,h.greenR); g.addColorStop(0,"rgba(255,255,220,0.10)"); g.addColorStop(1,"rgba(0,40,0,0.10)"); ctx.fillStyle=g; ctx.fillRect(h.pinX-h.greenR,h.L-h.greenR,h.greenR*2,h.greenR*2); ctx.restore();
    ctx.fillStyle="#141c0e"; circlePath(ctx,h.pinX,h.L,0.13); ctx.fill();
    shadowsOf(def.trees);
  }
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
function trees(list){
  const grp=new T.Group(), round=list.filter(t=>t.kind!=="cone"), cone=list.filter(t=>t.kind==="cone");
  const trunkGeo=new T.CylinderGeometry(0.16,0.28,1,6); trunkGeo.translate(0,0.5,0);
  const trunks=new T.InstancedMesh(trunkGeo,new T.MeshLambertMaterial({color:0x5b4430}),list.length);
  const canGeo=new T.IcosahedronGeometry(1,1), coneGeo=new T.ConeGeometry(1,1,8); coneGeo.translate(0,0.5,0);
  const can=new T.InstancedMesh(canGeo,new T.MeshPhongMaterial({color:0xffffff, flatShading:true, shininess:4, specular:0x111111}),round.length*2);
  const cones=new T.InstancedMesh(coneGeo,new T.MeshPhongMaterial({color:0xffffff, flatShading:true, shininess:4, specular:0x111111}),Math.max(1,cone.length));
  const m=new T.Matrix4(), q=new T.Quaternion(), sc=new T.Vector3(), p=new T.Vector3(), col=new T.Color();
  list.forEach((t,i)=>{ const h=(t.kind==="cone"?5.5:6.5)*t.s; q.setFromAxisAngle(new T.Vector3(0,1,0),t.hue*6);
    m.compose(p.set(t.x,0,t.z),q,sc.set(t.s,t.kind==="cone"?h*0.35:h*0.5,t.s)); trunks.setMatrixAt(i,m); });
  round.forEach((t,i)=>{ const r=2.7*t.s, h=6.5*t.s;
    m.compose(p.set(t.x,h*0.62,t.z),q.setFromAxisAngle(new T.Vector3(0,1,0),t.hue*9),sc.set(r,r*1.08,r)); can.setMatrixAt(2*i,m);
    col.setHSL(0.25+t.hue*0.07,0.48,0.2+t.hue*0.09); can.setColorAt(2*i,col);
    m.compose(p.set(t.x+r*0.45,h*0.48,t.z-r*0.3),q,sc.set(r*0.7,r*0.7,r*0.7)); can.setMatrixAt(2*i+1,m);
    col.setHSL(0.24+t.hue*0.06,0.5,0.25+t.hue*0.08); can.setColorAt(2*i+1,col); });
  cone.forEach((t,i)=>{ const h=7.5*t.s, r=2.1*t.s;
    m.compose(p.set(t.x,h*0.18,t.z),q.set(0,0,0,1),sc.set(r,h,r)); cones.setMatrixAt(i,m);
    col.setHSL(0.33+t.hue*0.04,0.42,0.17+t.hue*0.06); cones.setColorAt(i,col); });
  if(!cone.length) cones.count=0;
  grp.add(trunks,can,cones); return grp;
}
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
function clearWorld(){
  if(world){ linePool.forEach(l=>world.remove(l.mesh)); scene.remove(world); world.traverse(o=>{ if(o.geometry) o.geometry.dispose(); if(o.material){ (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{ if(m.map) m.map.dispose(); m.dispose(); }); } }); }
  if(detail){ scene.remove(detail); detail.geometry.dispose(); detail.material.map.dispose(); detail.material.dispose(); detail=null; }
  world=new T.Group(); scene.add(world); flags=[]; marks=null; S.linesData=[]; linePool.forEach(l=>l.g.setDrawRange(0,0));
}
function mapBounds(){
  const maxT=Math.min(4096,R.capabilities.maxTextureSize);
  if(def.kind==="range") return {x0:-130,x1:130,z0:-40,z1:440,pw:1024,ph:maxT};
  const h=def.h; return {x0:-150,x1:150,z0:-50,z1:h.L+80,pw:1024,ph:maxT};
}
W3.setRange=function(o){
  if(!W3.ok) return; def={kind:"range", um:o.um||1, trees:rangeTrees()}; clearWorld();
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
W3.setHole=function(h){
  if(!W3.ok) return; def={kind:"hole", h, trees:h.trees}; clearWorld();
  const B=mapBounds(); def.B=B; world.add(groundPlane(B,paint(B),0,-1));
  world.add(trees(h.trees));
  for(const w of h.water){ const wm=new T.Mesh(new T.PlaneGeometry(w.x1-w.x0,w.z1-w.z0),
      new T.MeshPhongMaterial({color:0x2a6c96, specular:0xcfe8ff, shininess:120, transparent:true, opacity:0.92, polygonOffset:true, polygonOffsetFactor:-3, polygonOffsetUnits:-6}));
    wm.rotation.x=-Math.PI/2; wm.position.set((w.x0+w.x1)/2,0.03,(w.z0+w.z1)/2); world.add(wm); }
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
  if(!def) return; if(detail){ scene.remove(detail); detail.geometry.dispose(); detail.material.map.dispose(); detail.material.dispose(); detail=null; }
  const B={x0:x-34,x1:x+34,z0:z-34,z1:z+34,pw:1024,ph:1024}; const tex=paint(B);
  const c=tex.image, ctx=c.getContext("2d"); ctx.setTransform(1,0,0,1,0,0); ctx.globalCompositeOperation="destination-in";
  const g=ctx.createRadialGradient(512,512,300,512,512,512); g.addColorStop(0,"rgba(0,0,0,1)"); g.addColorStop(1,"rgba(0,0,0,0)"); ctx.fillStyle=g; ctx.fillRect(0,0,1024,1024);
  ctx.globalCompositeOperation="source-over"; tex.needsUpdate=true;
  detail=groundPlane(B,tex,0.012,-2,true); scene.add(detail);
}

// ---------------- cámara y animación ----------------
W3.address=function(x,z,yaw,immediate){
  if(!W3.ok) return; S.anim=null; S.putt=null; S.trail=[]; S.address={x,z,yaw};
  S.f={x:Math.sin(yaw),z:Math.cos(yaw)}; S.r={x:Math.cos(yaw),z:-Math.sin(yaw)};
  ball.position.set(x,BALL_R,z); ball.visible=true;
  const pos=new T.Vector3(x-S.f.x*5.2, 1.7, z-S.f.z*5.2), look=new T.Vector3(x+S.f.x*90, 1.5, z+S.f.z*90);
  S.cam.tPos=pos; S.cam.tLook=look; S.cam.rate=1.6; S.cam.lookRate=2;
  if(immediate){ S.cam.pos.copy(pos); S.cam.look.copy(look); }
  if(!S.detailAt || Math.hypot(S.detailAt.x-x,S.detailAt.z-z)>0.5 || S.detailDef!==def){ paintDetail(x,z); S.detailAt={x,z}; S.detailDef=def; }
  S.aimView=false;
};
// ---------------- apuntar (estilo TrackMan) ----------------
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
  S.trail=[];
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
W3.skip=function(){ if(S.anim) S.anim.skip=true; if(S.putt) S.putt.skip=true; };
W3.busy=()=>!!(S.anim||S.putt);
let aimRing=null, aimDisc=null, aimLine=null;


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
  aimRing.visible=showAim; aimDisc.visible=showAim;
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

function loop(){ requestAnimationFrame(loop); const dt=Math.min(0.05,clock.getDelta()); if(!W3.active || document.hidden) return; update(dt); R.render(scene,camera); }
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
    hm.scale.set(200+Rn()*300,35+Rn()*85,200+Rn()*300); hm.position.set(Math.sin(a)*rad,-15,Math.cos(a)*rad); scene.add(hm); }
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
  aimDisc=new T.Mesh(new T.CircleGeometry(1.25,40).rotateX(-Math.PI/2), new T.MeshBasicMaterial({color:0xffcf33, transparent:true, opacity:0.35, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-7, polygonOffsetUnits:-14}));
  aimRing.visible=aimDisc.visible=false; scene.add(aimRing,aimDisc);
  clock=new T.Clock();
  S.cam.pos=new T.Vector3(0,1.7,-5.2); S.cam.look=new T.Vector3(0,1.5,90);
  W3.ok=true; W3.resize(); loop(); return true;
};
})();
