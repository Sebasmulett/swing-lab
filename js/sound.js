// Swing Lab · impacto por sonido: el micrófono oye el golpe a la bola (un chasquido de menos de 1 ms).
// La imagen va a 30-60 cuadros por segundo (17-33 ms entre fotos); el sonido marca el impacto al milisegundo.
// La diferencia fija entre el reloj del micrófono y el de la cámara se aprende sola con los primeros golpes.
(function(){
"use strict";
const SL=window.SL;
const store={ get(k,d){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):d; }catch(e){ return d; } }, set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} } };
const CAL_KEY="sl13_sndCal";
// procesador de audio: por cada bloque de 128 muestras busca el salto más brusco (derivada) y lo compara con el ruido de fondo
const WORKLET_URL="js/sound-worklet.js?v=0.18";
const S=SL.Sound={ on:false, ctx:null, cands:[], muted:[], lastErr:null };
let node=null, src=null;
// hora del reloj de la página (la misma de los cuadros de video) para un instante del reloj de audio
// (cada lectura del reloj tiene unos ms de ruido: se usa la mediana de las últimas diferencias entre ambos relojes)
let offs=[];
function toPerf(ctxSec){ const c=S.ctx; let o=null;
  if(c.getOutputTimestamp){ const ts=c.getOutputTimestamp(); if(ts && ts.performanceTime>0 && ts.contextTime>0) o=ts.performanceTime-ts.contextTime*1000; }
  if(o==null) o=performance.now()-c.currentTime*1000;
  offs.push(o); if(offs.length>61) offs.shift(); const r=offs.slice().sort((x,y)=>x-y);
  return ctxSec*1000+r[r.length>>1]; }
S.start=async function(stream, ctx){
  S.stop(); if(!stream || !ctx || !ctx.audioWorklet) { S.lastErr="sin soporte"; return false; }
  try{
    S.ctx=ctx; if(ctx.state==="suspended") try{ await ctx.resume(); }catch(e){}
    if(!S._mod || S._modCtx!==ctx){ await ctx.audioWorklet.addModule(new URL(WORKLET_URL, document.baseURI).href); S._mod=true; S._modCtx=ctx; }
    src=ctx.createMediaStreamSource(stream); node=new AudioWorkletNode(ctx,"sl-onset",{numberOfInputs:1, numberOfOutputs:0});
    node.port.onmessage=e=>{ const d=e.data, sec=d.f/ctx.sampleRate;
      // los sonidos de la propia app (pitidos del ritmo, efectos) no cuentan
      if(S.muted.some(m=>sec>=m[0]-0.02 && sec<=m[1]+0.12)) return;
      const t=toPerf(sec), last=S.cands[S.cands.length-1];
      // un golpe dura unos milisegundos: se queda el pico más fuerte de cada grupo
      if(last && t-last.t<25){ if(d.pk>last.pk){ last.t=t; last.pk=d.pk; last.r=d.r; } return; }
      S.cands.push({t, pk:d.pk, r:d.r}); while(S.cands.length && t-S.cands[0].t>8000) S.cands.shift(); };
    src.connect(node); S.on=true; offs=[]; clearInterval(S._tick); S._tick=setInterval(()=>{ if(S.on) toPerf(0); },100); S.lastErr=null; return true;
  }catch(e){ S.lastErr=String(e&&e.message||e); S.stop(); return false; }
};
S.stop=function(){ clearInterval(S._tick); try{ if(src) src.disconnect(); }catch(e){} try{ if(node){ node.port.onmessage=null; node.disconnect(); } }catch(e){} src=null; node=null; S.on=false; S.cands=[]; };
// la app avisa cuando suena algo suyo (en segundos del reloj de audio)
S.mute=function(t0,dur){ S.muted.push([t0,t0+dur]); const now=S.ctx?S.ctx.currentTime:0; S.muted=S.muted.filter(m=>m[1]>now-5); };
// ---- calibración del desfase micrófono-cámara ----
// se aprende sobre todo de los swings de frente (ahí la imagen ve el impacto con ±3 ms); desde atrás también, pero con menos peso
const cal=()=>{ const c=store.get(CAL_KEY,{}); return {v:c.v||[], b:c.b||[]}; };
const medOf=a=>{ const r=a.slice().sort((x,y)=>x-y), m=r.length>>1; return r.length%2?r[m]:(r[m-1]+r[m])/2; };
S.calib=function(){ const c=cal(), stat=(v,src,need,lim)=>{ if(v.length<need) return null; const off=medOf(v), mad=medOf(v.map(x=>Math.abs(x-off))); return mad<=lim?{ok:true, n:v.length, off, mad, src}:null; };
  return stat(c.v,"front",3,22) || stat(c.b,"behind",4,30) || {ok:false, n:Math.max(c.v.length, c.b.length*0.75|0)}; };
S.resetCalib=()=>store.set(CAL_KEY,{v:[]});
function addCal(d,view){ const c=cal(), k=view==="behind"?"b":"v"; c[k].push(Math.round(d)); c[k]=c[k].slice(-15); store.set(CAL_KEY,c); }
// Busca el golpe para un swing ya analizado con la imagen (res.tImpAbs / res.tTopAbs).
// Devuelve la hora del impacto ya corregida al reloj de la cámara, o null.
S.impactFor=function(res){
  if(!S.on || !res || !isFinite(res.tImpAbs) || !isFinite(res.tTopAbs)) return null;
  const c=S.calib(), imgImp=res.tImpAbs;
  const pool=S.cands.filter(x=>x.t>res.tTopAbs+60 && x.t<res.tTopAbs+1300 && x.r>=8);
  if(!pool.length) return null;
  // ventana alrededor del impacto que ve la imagen: amplia mientras se aprende el desfase, estrecha después
  const lo=c.ok?c.off-Math.max(45,3*c.mad):-80, hi=c.ok?c.off+Math.max(45,3*c.mad):260;
  const win=pool.filter(x=>x.t-imgImp>=lo && x.t-imgImp<=hi); if(!win.length) return null;
  const best=win.reduce((a,b)=>b.pk>a.pk?b:a);
  // la imagen enseña el desfase solo cuando su lectura es buena
  if(res.impSrc!=="sonido" && res.camQ && res.camQ.score>=0.55) addCal(best.t-imgImp, res.view);
  const c2=S.calib();
  return {heard:true, t:c2.ok?best.t-c2.off:null, src:c2.src||null, strength:best.r};
};
})();
