// Swing Lab · videos de los swings guardados en el teléfono (IndexedDB): el video y, aparte, sus datos (pose, marcas, miniatura)
(function(){
"use strict";
const SL=window.SL, DB="swinglab-videos", MAX=40;
let dbp=null;
function db(){ if(dbp) return dbp; dbp=new Promise((res,rej)=>{ if(!window.indexedDB){ rej(new Error("sin IndexedDB")); return; }
  const r=indexedDB.open(DB,1); r.onupgradeneeded=()=>{ const d=r.result; if(!d.objectStoreNames.contains("clips")) d.createObjectStore("clips",{keyPath:"id"}); if(!d.objectStoreNames.contains("meta")) d.createObjectStore("meta",{keyPath:"id"}); };
  r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); dbp.catch(()=>{ dbp=null; }); return dbp; }
const tx=(stores,mode,fn)=>db().then(d=>new Promise((res,rej)=>{ const t=d.transaction(stores,mode); let out; const r=fn(t); if(r && "onsuccess" in r) r.onsuccess=()=>{ out=r.result; };
  t.oncomplete=()=>res(out); t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error); }));
const V=SL.VStore={
  ok:()=>!!window.indexedDB,
  // guarda el video y sus datos; después borra los más viejos que no estén en una práctica guardada
  put(id, blob, meta, keep){ return tx(["clips","meta"],"readwrite",t=>{ t.objectStore("clips").put({id, blob}); t.objectStore("meta").put(Object.assign({id, at:Date.now(), size:blob.size},meta)); })
    .then(()=>V.prune(keep)); },
  get(id){ return tx(["clips"],"readonly",t=>t.objectStore("clips").get(id)).then(c=>c&&c.blob||null); },
  meta(id){ return tx(["meta"],"readonly",t=>t.objectStore("meta").get(id)); },
  list(){ return tx(["meta"],"readonly",t=>t.objectStore("meta").getAll()).then(a=>(a||[]).sort((x,y)=>y.at-x.at)); },
  del(id){ return tx(["clips","meta"],"readwrite",t=>{ t.objectStore("clips").delete(id); t.objectStore("meta").delete(id); }); },
  prune(keep){ const K=new Set(keep||[]); return V.list().then(L=>{ const extra=L.filter(m=>!K.has(m.id)).slice(Math.max(0,MAX-K.size)); return Promise.all(extra.map(m=>V.del(m.id))); }).catch(()=>{}); },
  usage(){ return V.list().then(L=>({n:L.length, mb:L.reduce((a,m)=>a+(m.size||0),0)/1048576})); }
};
})();
