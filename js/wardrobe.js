// Swing Lab · vestuario del golfista (maqueta): colores de la ropa y espacios para marcas aliadas.
// Las marcas de aquí son INVENTADAS, solo para mostrar cómo se verían los espacios de patrocinio
// (gorra, pecho y bolsa). En el futuro se reemplazan por los kits oficiales de las marcas aliadas.
(function(){
"use strict";
const SL=window.SL=window.SL||{};
const C=(n,h)=>({n,h});
const PAL={
  shirt:[C("Azul",0x1f5f8b),C("Marino",0x1f3a5f),C("Blanco",0xf2f2ef),C("Negro",0x1d1f22),C("Rojo",0xb3262e),C("Verde",0x2e7d4f),C("Turquesa",0x23a6b5),C("Amarillo",0xf2c230),C("Naranja",0xe8752a),C("Rosado",0xe58fae),C("Lila",0x7a5cc4)],
  pants:[C("Grafito",0x2f333a),C("Negro",0x16181b),C("Marino",0x23324d),C("Caqui",0xc8b48a),C("Blanco",0xeeeeea),C("Gris",0x8a9097)],
  cap:[C("Blanco",0xf5f5f2),C("Negro",0x1d1f22),C("Marino",0x1f3a5f),C("Rojo",0xb3262e),C("Verde",0x2e7d4f),C("Caqui",0xc8b48a)],
  shoe:[C("Blanco",0xf2f2ef),C("Negro",0x1e1e1e),C("Café",0x6b4528)],
  glove:[C("Blanco",0xfafafa),C("Negro",0x1d1f22)],
  skin:[C("Tono 1",0xf1c7a5),C("Tono 2",0xe0ac85),C("Tono 3",0xc79068),C("Tono 4",0x9a6a47),C("Tono 5",0x6b4630)],
  bag:[C("Blanco",0xf2f2ef),C("Negro",0x1d1f22),C("Marino",0x1f3a5f),C("Rojo",0xb3262e),C("Verde",0x2e7d4f),C("Caqui",0xc8b48a)]
};
const PARTS=[["shirt","Camiseta"],["pants","Pantalón"],["cap","Gorra"],["shoe","Zapatos"],["glove","Guante"],["skin","Piel"],["bag","Bolsa"]];
const SLOTS=[["capLogo","Gorra"],["chestLogo","Pecho"],["bagLogo","Bolsa"]];
// marcas ficticias de ejemplo (parche con emblema y nombre)
const BRANDS=[
  {id:"none", n:"Sin marca"},
  {id:"yours", n:"Tu marca aquí", tag:"Espacio libre"},
  {id:"volcan", n:"Volcán Golf", bg:"#1d1f22", fg:"#ffffff", ac:"#ff6a2b"},
  {id:"tucan", n:"Tucán Tour", bg:"#0f5132", fg:"#ffffff", ac:"#ffc928"},
  {id:"cafetal", n:"Cafetal", bg:"#f3e7d3", fg:"#4a2c17", ac:"#2e7d4f"},
  {id:"paramo", n:"Páramo Club", bg:"#ffffff", fg:"#1f3a5f", ac:"#5c9b4c"},
  {id:"ola", n:"Ola Golf", bg:"#0b4f8a", fg:"#ffffff", ac:"#7fe0ff"}
];
const brand=id=>BRANDS.find(b=>b.id===id)||BRANDS[0];
const DEF={shirt:0x1f5f8b, pants:0x2f333a, cap:0xf5f5f2, shoe:0xf2f2ef, glove:0xfafafa, skin:0xc79068, bag:0xf2f2ef, capLogo:"none", chestLogo:"none", bagLogo:"none", kit:"clasico"};
// conjuntos listos; los de marca son la maqueta de un "kit oficial" de una marca aliada
const KITS=[
  {id:"clasico", n:"Clásico", o:{shirt:0x1f5f8b, pants:0x2f333a, cap:0xf5f5f2, shoe:0xf2f2ef, glove:0xfafafa, bag:0xf2f2ef, capLogo:"none", chestLogo:"none", bagLogo:"none"}},
  {id:"caribe", n:"Caribe", o:{shirt:0x23a6b5, pants:0xeeeeea, cap:0xf5f5f2, shoe:0xf2f2ef, glove:0xfafafa, bag:0xf2f2ef, capLogo:"ola", chestLogo:"ola", bagLogo:"none"}},
  {id:"sabana", n:"Sabana", o:{shirt:0x2e7d4f, pants:0xc8b48a, cap:0x1f3a5f, shoe:0x6b4528, glove:0xfafafa, bag:0x1f3a5f, capLogo:"paramo", chestLogo:"none", bagLogo:"paramo"}},
  {id:"noche", n:"Noche", o:{shirt:0x1d1f22, pants:0x16181b, cap:0x1d1f22, shoe:0xf2f2ef, glove:0x1d1f22, bag:0x1d1f22, capLogo:"volcan", chestLogo:"volcan", bagLogo:"volcan"}},
  {id:"tucan", n:"Tucán Tour", partner:true, o:{shirt:0xf2c230, pants:0x16181b, cap:0x1d1f22, shoe:0xf2f2ef, glove:0xfafafa, bag:0x0f5132, capLogo:"tucan", chestLogo:"tucan", bagLogo:"tucan"}},
  {id:"cafetal", n:"Cafetal", partner:true, o:{shirt:0xf2f2ef, pants:0x6b4528, cap:0x6b4528, shoe:0x6b4528, glove:0xfafafa, bag:0xc8b48a, capLogo:"cafetal", chestLogo:"cafetal", bagLogo:"cafetal"}},
  {id:"pronto", n:"Kits oficiales", soon:true}
];
// dibuja el parche de una marca en un lienzo (para la textura 3D y para las muestras de la pantalla)
function rr(x,a,b,w,h,r){ x.beginPath(); x.moveTo(a+r,b); x.arcTo(a+w,b,a+w,b+h,r); x.arcTo(a+w,b+h,a,b+h,r); x.arcTo(a,b+h,a,b,r); x.arcTo(a,b,a+w,b,r); x.closePath(); }
function drawLogo(x, W, H, id){
  const B=brand(id); x.clearRect(0,0,W,H); if(B.id==="none") return;
  const s=H/128, pad=6*s;
  if(B.id==="yours"){ x.fillStyle="rgba(255,255,255,0.92)"; rr(x,pad,pad,W-2*pad,H-2*pad,18*s); x.fill(); x.setLineDash([10*s,7*s]); x.lineWidth=5*s; x.strokeStyle="#e0a020"; x.stroke(); x.setLineDash([]);
    x.fillStyle="#3a3a3a"; x.textAlign="center"; x.textBaseline="middle"; x.font=`800 ${34*s}px Figtree, system-ui, sans-serif`; x.fillText("TU MARCA",W/2,H*0.42); x.font=`700 ${22*s}px Figtree, system-ui, sans-serif`; x.fillText("aquí",W/2,H*0.7); return; }
  x.fillStyle=B.bg; rr(x,pad,pad,W-2*pad,H-2*pad,22*s); x.fill(); x.lineWidth=4*s; x.strokeStyle=B.ac; x.stroke();
  const cx=H*0.5+pad, cy=H*0.5, r=H*0.3;
  x.save(); x.fillStyle=B.ac; x.strokeStyle=B.ac; x.lineWidth=6*s; x.lineCap="round"; x.lineJoin="round";
  if(B.id==="volcan"){ x.beginPath(); x.moveTo(cx-r*1.1,cy+r*0.9); x.lineTo(cx-r*0.25,cy-r*0.6); x.lineTo(cx+r*0.25,cy-r*0.6); x.lineTo(cx+r*1.1,cy+r*0.9); x.closePath(); x.fill();
    x.fillStyle=B.fg; x.beginPath(); x.arc(cx,cy-r*0.95,r*0.22,0,Math.PI*2); x.fill(); }
  else if(B.id==="tucan"){ x.beginPath(); x.arc(cx-r*0.35,cy,r*0.62,0,Math.PI*2); x.fillStyle=B.fg; x.fill(); x.fillStyle=B.ac; x.beginPath(); x.moveTo(cx-r*0.05,cy-r*0.35); x.quadraticCurveTo(cx+r*1.4,cy-r*0.25,cx+r*1.2,cy+r*0.15); x.quadraticCurveTo(cx+r*0.6,cy+r*0.05,cx-r*0.05,cy+r*0.2); x.closePath(); x.fill();
    x.fillStyle="#111"; x.beginPath(); x.arc(cx-r*0.35,cy-r*0.12,r*0.14,0,Math.PI*2); x.fill(); }
  else if(B.id==="cafetal"){ x.beginPath(); x.ellipse(cx,cy,r*0.68,r*0.95,0.5,0,Math.PI*2); x.fill(); x.strokeStyle=B.bg; x.lineWidth=5*s; x.beginPath(); x.moveTo(cx-r*0.35,cy-r*0.7); x.bezierCurveTo(cx+r*0.25,cy-r*0.2,cx-r*0.25,cy+r*0.2,cx+r*0.35,cy+r*0.7); x.stroke(); }
  else if(B.id==="paramo"){ x.beginPath(); x.moveTo(cx-r*1.1,cy+r*0.8); x.lineTo(cx-r*0.35,cy-r*0.4); x.lineTo(cx+r*0.05,cy+r*0.15); x.lineTo(cx+r*0.45,cy-r*0.75); x.lineTo(cx+r*1.1,cy+r*0.8); x.stroke(); }
  else if(B.id==="ola"){ for(let k=0;k<3;k++){ const y=cy-r*0.55+k*r*0.55; x.beginPath(); x.moveTo(cx-r,y); x.bezierCurveTo(cx-r*0.5,y-r*0.45,cx,y+r*0.45,cx+r,y); x.stroke(); } }
  x.restore();
  const words=B.n.toUpperCase().split(" "), tx=H*0.98+pad, tw=W-tx-pad*2;
  x.fillStyle=B.fg; x.textAlign="left"; x.textBaseline="middle";
  let fs=(words.length>1?34:44)*s; x.font=`900 ${fs}px Figtree, system-ui, sans-serif`;
  const wmax=Math.max(...words.map(w=>x.measureText(w).width)); if(wmax>tw){ fs*=tw/wmax; x.font=`900 ${fs}px Figtree, system-ui, sans-serif`; }
  if(words.length>1){ x.fillText(words[0],tx,H*0.37); x.fillText(words.slice(1).join(" "),tx,H*0.67); } else x.fillText(words[0],tx,H*0.53);
}
SL.Wardrobe={PAL, PARTS, SLOTS, BRANDS, KITS, DEF, brand, drawLogo,
  hex:n=>"#"+(n>>>0).toString(16).padStart(6,"0"),
  normalize(o){ const r=Object.assign({},DEF,o||{}); for(const [k] of SLOTS) if(!BRANDS.some(b=>b.id===r[k])) r[k]="none"; return r; } };
})();
