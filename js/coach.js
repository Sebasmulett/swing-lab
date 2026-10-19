// Swing Lab · coach: detecta las fallas de cada swing con lo que miden la cámara o el sensor y receta ejercicios
(function(){
"use strict";
const SL=window.SL;
const W=c=>(SL.WEDGES||[]).includes(c), WOOD=c=>c==="driver"||c==="wood3"||c==="hybrid";
const r0=v=>Math.round(v), sg=v=>(v>0?"+":"")+r0(v);
// Cada falla: cuándo aplica, qué tan grave (0..1), el dato del swing y la meta. "ctx.clock": largo de swing del reloj en wedges.
const FAULTS=[
  {id:"tempo_fast", name:"Subida apurada", cat:"Ritmo", test:h=>h.ratio&&h.ratio<2.5, sev:h=>Math.min(1,(2.5-h.ratio)/0.8), val:h=>`tempo ${h.ratio.toFixed(1)}:1`, goal:"entre 2,7 y 3,3 : 1", drill:"tempo"},
  {id:"tempo_slow", name:"Subida lenta o pausa arriba", cat:"Ritmo", test:h=>h.ratio&&h.ratio>3.7, sev:h=>Math.min(1,(h.ratio-3.7)/1.2), val:h=>`tempo ${h.ratio.toFixed(1)}:1`, goal:"entre 2,7 y 3,3 : 1", drill:"tempo"},
  {id:"short_back", name:"Subida corta", cat:"Largo", test:(h,c)=>h.arcTop!=null && !c.partial && (h.source==="camera"?h.arcTop<125:h.arcTop<185), sev:h=>Math.min(1,((h.source==="camera"?125:185)-h.arcTop)/40), val:h=>`${h.arcTop}° de subida`, goal:h=>h.source==="camera"?"brazo a 140° o más (manos sobre el hombro)":"palo a 220° o más", drill:"turn_full"},
  {id:"no_finish", name:"Final frenado", cat:"Largo", test:(h,c)=>h.arcFin!=null && h.arcTop && !c.partial && h.arcFin<h.arcTop*0.6, sev:h=>Math.min(1,(h.arcTop*0.6-h.arcFin)/40), val:h=>`final ${h.arcFin}° (subida ${h.arcTop}°)`, goal:"terminar con las manos arriba, mirando al objetivo", drill:"finish"},
  {id:"head_move", name:"La cabeza se mueve", cat:"Postura", test:h=>h.posture&&!h.posture.dtl&&Math.abs(h.posture.head)>=8, sev:h=>Math.min(1,(Math.abs(h.posture.head)-8)/10+0.3), val:h=>`${Math.abs(h.posture.head)} cm ${h.posture.head>0?"hacia el objetivo":"hacia atrás"}`, goal:"menos de 5 cm hasta el impacto", drill:"head"},
  {id:"head_dip", name:"La cabeza sube o baja", cat:"Postura", test:h=>h.posture&&(h.posture.dtl?Math.abs(h.posture.headDrop)>=7:Math.abs(h.posture.headY||0)>=7), sev:h=>Math.min(1,(Math.abs(h.posture.dtl?h.posture.headDrop:h.posture.headY)-7)/10+0.3), val:h=>{ const v=h.posture.dtl?h.posture.headDrop:h.posture.headY; return `${Math.abs(v)} cm ${v>0?"abajo":"arriba"}`; }, goal:"menos de 4 cm", drill:"head"},
  {id:"sway", name:"Te deslizas hacia atrás", cat:"Postura", test:h=>h.posture&&!h.posture.dtl&&h.posture.sway<=-8, sev:h=>Math.min(1,(-h.posture.sway-8)/10+0.3), val:h=>`cadera ${-h.posture.sway} cm hacia atrás en la subida`, goal:"menos de 5 cm: girar sin desplazarse", drill:"sway"},
  {id:"low_turn", name:"Poco giro de hombros", cat:"Potencia", test:(h,c)=>h.posture&&!h.posture.dtl&&!c.partial&&h.posture.shTurn<60, sev:h=>Math.min(1,(60-h.posture.shTurn)/30+0.2), val:h=>`hombros ${h.posture.shTurn}°`, goal:"75° a 90°", drill:"turn"},
  {id:"driver_down", name:"Le pegas bajando con el driver", cat:"Contacto", test:h=>h.club==="driver"&&h.aoaOk&&h.aoa<0, sev:h=>Math.min(1,(-h.aoa)/4+0.3), val:h=>`ataque ${sg(h.aoa)}°`, goal:"+2° a +5° (subiendo)", drill:"driver_up"},
  {id:"lowpoint_back", name:"Punto bajo detrás de la bola", cat:"Contacto", test:h=>!WOOD(h.club)&&h.aoaOk&&h.lowCm!=null&&(h.lowCm<0||h.aoa>-1), sev:h=>Math.min(1,Math.max(-h.lowCm,0)/6+0.35), val:h=>`punto bajo ${h.lowCm} cm · ataque ${sg(h.aoa)}°`, goal:"punto bajo 3 a 8 cm delante de la bola, ataque negativo", drill:"lowpoint"},
  {id:"early_ext", name:"Extensión temprana (te levantas)", cat:"Postura", test:h=>h.posture&&h.posture.dtl&&(h.posture.hipThrust>=6||h.posture.spineChg<=-8), sev:h=>Math.min(1,Math.max(h.posture.hipThrust-6,-h.posture.spineChg-8,0)/8+0.35), val:h=>`cadera ${Math.max(0,h.posture.hipThrust)} cm hacia la bola · columna ${sg(h.posture.spineChg)}°`, goal:"cadera quieta (menos de 3 cm) y la misma inclinación", drill:"early_ext"},
  {id:"over_top", name:"Bajada por encima", cat:"Plano", test:h=>h.posture&&h.posture.dtl&&h.posture.loop!=null&&h.posture.loop>=5, sev:h=>Math.min(1,(h.posture.loop-5)/8+0.35), val:h=>`la bajada pasa ${h.posture.loop} cm por fuera`, goal:"0 a −5 cm (por dentro o igual que la subida)", drill:"over_top"},
  {id:"under_plane", name:"Bajada muy por dentro", cat:"Plano", test:h=>h.posture&&h.posture.dtl&&h.posture.loop!=null&&h.posture.loop<=-9, sev:h=>Math.min(1,(-h.posture.loop-9)/8+0.3), val:h=>`la bajada pasa ${-h.posture.loop} cm por dentro`, goal:"0 a −5 cm", drill:"under_plane"},
  {id:"plane_steep", name:"Subida muy vertical", cat:"Plano", test:h=>h.posture&&h.posture.dtl&&h.posture.planeTop>15, sev:h=>Math.min(1,(h.posture.planeTop-15)/15+0.3), val:h=>`manos ${h.posture.planeTop} cm por encima de la línea`, goal:"cerca de la línea del plano (±10 cm)", drill:"plane"},
  {id:"plane_flat", name:"Subida muy plana", cat:"Plano", test:h=>h.posture&&h.posture.dtl&&h.posture.planeTop<-15, sev:h=>Math.min(1,(-h.posture.planeTop-15)/15+0.3), val:h=>`manos ${-h.posture.planeTop} cm por debajo de la línea`, goal:"cerca de la línea del plano (±10 cm)", drill:"plane"},
  {id:"setup", name:"Postura del address", cat:"Postura", test:h=>h.posture&&h.posture.dtl&&(h.posture.spine<22||h.posture.spine>55), sev:h=>0.5, val:h=>`columna a ${h.posture.spine}°`, goal:"35° a 45° de inclinación", drill:"setup"},
  {id:"out_in", name:"Ruta de afuera hacia adentro", cat:"Dirección", test:h=>h.pathOk&&h.path<=-3, sev:h=>Math.min(1,(-h.path-3)/5+0.3), val:h=>`ruta ${r0(-h.path)}° afuera-adentro`, goal:"−1° a +3°", drill:"out_in"},
  {id:"in_out", name:"Ruta muy de adentro hacia afuera", cat:"Dirección", test:h=>h.pathOk&&h.path>=6, sev:h=>Math.min(1,(h.path-6)/5+0.3), val:h=>`ruta ${r0(h.path)}° adentro-afuera`, goal:"−1° a +3°", drill:"in_out"},
  {id:"face_open", name:"Cara abierta a la ruta (slice/fade)", cat:"Dirección", test:h=>h.faceOk&&h.pathOk&&h.face-h.path>=4, sev:h=>Math.min(1,(h.face-h.path-4)/6+0.3), val:h=>`cara ${r0(h.face-h.path)}° abierta a la ruta`, goal:"−2° a +2°", drill:"face_open"},
  {id:"face_closed", name:"Cara cerrada a la ruta (hook/draw fuerte)", cat:"Dirección", test:h=>h.faceOk&&h.pathOk&&h.face-h.path<=-5, sev:h=>Math.min(1,(h.path-h.face-5)/6+0.3), val:h=>`cara ${r0(h.path-h.face)}° cerrada a la ruta`, goal:"−2° a +2°", drill:"face_closed"},
  {id:"casting", name:"Sueltas las muñecas antes de tiempo", cat:"Potencia", test:(h,c)=>h.view==="front"&&!c.partial&&h.handDrop!=null&&h.handPeakMs!=null&&h.handPeakMs>-35&&h.handPeakMs<230&&h.handDrop<0.06, sev:h=>0.45, val:h=>`las manos frenaron ${Math.round(h.handDrop*100)}%`, goal:"que las manos frenen antes del impacto (10% o más)", drill:"lag"}
];
// Ejercicios: qué corrige, cómo hacerlo, cuántas veces y cómo saber que funciona (con un dato que la app mide)
const DRILLS={
  tempo:{t:"Ritmo 3:1 con metrónomo", why:"Una subida apurada saca al palo de su plano y quita control; el ritmo de los profesionales es cercano a 3:1 sin importar la velocidad.",
    steps:["En Range → Entrenar ritmo, elige 24/8 (o 21/7 si eres rápido).","Sube con los dos primeros pitidos y pega en el tercero; cuenta \"uuuno-dos… tres\".","Primero sin bola, luego con bola, sin cambiar el ritmo."], reps:"3 series de 8 swings", check:"tempo entre 2,7 y 3,3 en 7 de cada 10 swings"},
  turn_full:{t:"Hombro bajo la barbilla", why:"Una subida corta deja velocidad en el camino: el arco más largo da más tiempo para acelerar.",
    steps:["Sube despacio hasta que tu hombro izquierdo toque o pase bajo la barbilla (diestros).","Deja que el talón izquierdo se levante un poco si te falta movilidad.","Haz una pausa arriba de 1 segundo, revisa la posición y baja."], reps:"2 series de 10, la mitad sin bola", check:"subida de 140° o más con la cámara de frente"},
  finish:{t:"Sostén el final 3 segundos", why:"Frenar el final suele venir de frenar las manos en el impacto; un final completo obliga a acelerar a través de la bola.",
    steps:["Termina con la hebilla del cinturón mirando al objetivo y el peso en el pie delantero.","El talón de atrás arriba, solo la punta del pie apoyada.","Quédate quieto 3 segundos en esa posición: si pierdes el equilibrio, baja la velocidad."], reps:"10 swings seguidos", check:"final mayor que el 60% de la subida"},
  head:{t:"La cabeza en su sitio", why:"Si la cabeza se mueve, se mueve el punto bajo del swing y el contacto se vuelve irregular.",
    steps:["Con la cámara de frente, mira la línea de tu cabeza en la repetición.","Practica con alguien que apoye la punta de un palo suave cerca de tu cabeza (sin tocarla).","Al sol: pon una marca sobre la sombra de tu cabeza y mantenla quieta hasta el impacto."], reps:"3 series de 6 swings a media velocidad", check:"cabeza a menos de 5 cm en la repetición"},
  sway:{t:"Palo vertical junto a la cadera", why:"Deslizarte hacia atrás en vez de girar mueve el punto bajo y quita potencia.",
    steps:["Clava un palo o una sombrilla vertical justo afuera de tu cadera trasera.","Sube girando la cadera dentro de tu postura, sin tocar el palo.","Siente el peso en la parte interna del pie de atrás."], reps:"3 series de 8 swings", check:"menos de 5 cm de deslizamiento con la cámara de frente"},
  turn:{t:"Palo cruzado en los hombros", why:"Más giro de hombros es más arco y más velocidad sin esfuerzo extra de los brazos.",
    steps:["Cruza un palo sobre el pecho, sujetándolo con las dos manos en los hombros.","En tu postura de golf, gira hasta que el palo apunte a la bola (90°).","Repite hacia el final: el palo apunta al objetivo."], reps:"2 series de 15 giros, luego 10 swings", check:"giro de hombros de 75° o más"},
  driver_up:{t:"Tee adelante para pegar subiendo", why:"Con el driver, pegar subiendo (+2° a +5°) da más carry y menos spin.",
    steps:["Bola frente al talón del pie delantero y un poco más alta en el tee.","Inclina un poco la columna hacia atrás (hombro de atrás más bajo).","Pon un segundo tee 10 cm delante de la bola y trata de tocarlo después del impacto."], reps:"3 series de 6 drives", check:"ángulo de ataque positivo en la cámara de frente"},
  lowpoint:{t:"Toalla detrás de la bola", why:"Con hierros, el punto bajo debe quedar delante de la bola: primero la bola, después el pasto.",
    steps:["Pon una toalla doblada 10 cm detrás de la bola.","Peso 60% en el pie delantero desde el address y mantenlo.","Pega sin tocar la toalla; el divot debe salir delante de donde estaba la bola."], reps:"3 series de 8 golpes", check:"punto bajo 3 a 8 cm delante y ataque negativo"},
  early_ext:{t:"Glúteos contra la pared (o una silla)", why:"Levantarte en la bajada (extensión temprana) acerca la cadera a la bola y obliga a compensar con las manos.",
    steps:["En tu postura, apoya los glúteos contra una pared o el respaldo de una silla.","Sube y baja manteniendo el glúteo de adelante en contacto en la bajada.","Mantén la misma inclinación de la columna hasta después del impacto."], reps:"3 series de 10 swings sin bola, luego con bola", check:"cadera quieta (menos de 3 cm) en la vista desde atrás"},
  over_top:{t:"Headcover por fuera de la bola", why:"La bajada por encima lleva la ruta de afuera hacia adentro: slices y pulls.",
    steps:["Pon un headcover 10 cm por fuera de la bola y un poco adelante.","Empieza la bajada con la cadera y deja caer los brazos (\"bombeo\": baja las manos a la cadera dos veces y luego pega).","Si tocas el headcover, la bajada vino por encima."], reps:"3 series de 8 golpes", check:"bucle de las manos de 0 a −5 cm desde atrás"},
  under_plane:{t:"Headcover por dentro", why:"Bajar muy por dentro da pushes y hooks y hace que las manos tengan que salvar el golpe.",
    steps:["Pon un headcover detrás de la bola, del lado de adentro, a 20 cm.","Baja con el pecho más sobre la bola, sin dejar caer la mano de atrás.","Siente que el palo sale hacia el objetivo, no hacia la derecha."], reps:"3 series de 8 golpes", check:"bucle de 0 a −5 cm"},
  plane:{t:"Plano con un palo en el suelo", why:"Una subida en buen plano deja el palo listo para bajar sin compensaciones.",
    steps:["Graba desde atrás: la línea azul es tu plano del address.","A la altura de la cintura el palo debe quedar paralelo a la línea de los pies.","Arriba, las manos deben quedar cerca de la línea azul; ajusta y repite despacio."], reps:"10 subidas lentas revisando la repetición", check:"manos a ±10 cm de la línea del plano"},
  setup:{t:"Postura en 3 pasos", why:"La postura del address define el plano y el equilibrio de todo el swing.",
    steps:["De pie, piernas al ancho de los hombros, palo frente a ti.","Inclínate desde la cadera (no desde la espalda) hasta que el palo toque el suelo.","Flexiona un poco las rodillas y deja los brazos colgando bajo los hombros."], reps:"5 veces antes de cada serie", check:"columna entre 35° y 45° desde atrás"},
  out_in:{t:"Puerta de tees hacia la derecha", why:"La ruta de afuera hacia adentro es la causa más común del slice.",
    steps:["Pon dos tees formando una puerta un poco más ancha que la cabeza del palo, apuntando 5° a la derecha del objetivo.","Pega sacando el palo por la puerta, hacia el \"1 en punto\".","Revisa que los pies y los hombros estén paralelos a la línea (no abiertos)."], reps:"3 series de 8 golpes", check:"ruta de −1° a +3°"},
  in_out:{t:"Puerta de tees recta", why:"Demasiado de adentro hacia afuera da pushes y hooks.",
    steps:["Puerta de tees en la línea del objetivo, justo delante de la bola.","Gira el pecho hasta mirar al objetivo en el final (no te quedes atrás).","Siente que el palo sale hacia el hombro izquierdo después del impacto."], reps:"3 series de 8 golpes", check:"ruta de −1° a +3°"},
  face_open:{t:"Puntera arriba a puntera arriba", why:"La cara abierta respecto a la ruta es lo que hace curvar la bola a la derecha (diestros).",
    steps:["Revisa el grip: deberías ver 2 o 3 nudillos de la mano izquierda.","Medio swing: la puntera del palo apunta al cielo a la altura de la cadera en la subida y otra vez en la salida.","Siente que el antebrazo derecho pasa por encima del izquierdo después del impacto."], reps:"3 series de 10 medios swings", check:"cara a ±2° de la ruta (sensor)"},
  face_closed:{t:"Sostén la cara después del impacto", why:"La cara muy cerrada a la ruta da hooks.",
    steps:["Grip más neutral: 2 nudillos visibles de la mano izquierda.","Después del impacto, mantén la cara mirando al objetivo hasta la altura de la cadera (\"hold-off\").","Gira más el cuerpo y menos las manos."], reps:"3 series de 8 golpes", check:"cara a ±2° de la ruta (sensor)"},
  lag:{t:"De L a L (bombeo)", why:"Soltar las muñecas antes de tiempo quita velocidad en el impacto y adelanta el punto bajo.",
    steps:["Medio swing: el palo forma una L con el brazo izquierdo arriba (9:00) y otra L en la salida.","Lleva las manos por delante de la bola en el impacto.","Bombeo: desde arriba baja las manos a la cadera dos veces manteniendo la L y en la tercera pega."], reps:"3 series de 10 medios swings", check:"las manos frenan antes del impacto (cámara de frente)"}
};
const C=SL.Coach={FAULTS, DRILLS};
// qué partes del swing se pudieron medir en este swing (para no felicitar por algo que no se vio)
C.cats=function(h){ const c=[]; if(h.ratio) c.push("Ritmo"); if(h.arcTop!=null) c.push("Largo"); if(h.posture) c.push("Postura");
  if(h.posture&&h.posture.dtl&&h.posture.loop!=null) c.push("Plano"); if(h.aoaOk) c.push("Contacto"); if(h.pathOk) c.push("Dirección"); if(h.posture&&!h.posture.dtl || h.handDrop!=null) c.push("Potencia"); return c; };
C.faultsOf=function(h, ctx){ ctx=ctx||{}; const out=[];
  for(const f of FAULTS){ let ok=false; try{ ok=!!f.test(h,ctx); }catch(e){ ok=false; } if(!ok) continue;
    let s=0.4, v="", g=""; try{ s=Math.max(0.15,Math.min(1,f.sev(h))); v=f.val(h); g=typeof f.goal==="function"?f.goal(h):f.goal; }catch(e){}
    out.push({id:f.id, name:f.name, cat:f.cat, sev:+s.toFixed(2), val:v, goal:g, drill:f.drill}); }
  return out.sort((a,b)=>b.sev-a.sev); };
// Informe de una sesión: qué falla se repite más (frecuencia × gravedad) y sus ejercicios; también lo que salió bien
C.report=function(swings){ const n=swings.length; if(!n) return null; const agg={};
  for(const s of swings) for(const f of s.faults||[]){ const a=agg[f.id]||(agg[f.id]={id:f.id, name:f.name, cat:f.cat, drill:f.drill, goal:f.goal, n:0, sev:0, vals:[]}); a.n++; a.sev+=f.sev; a.vals.push(f.val); }
  const list=Object.values(agg).map(a=>Object.assign(a,{freq:a.n/n, score:a.n/n*(a.sev/a.n)})).sort((a,b)=>b.score-a.score);
  const top=list.filter(a=>a.freq>=0.3 || a.score>=0.25).slice(0,3);
  const drills=[]; for(const a of top){ if(!drills.some(d=>d.id===a.drill)) drills.push(Object.assign({id:a.drill, for:a.name}, DRILLS[a.drill])); }
  const cats=["Ritmo","Largo","Postura","Plano","Contacto","Dirección","Potencia"], seen=c=>swings.filter(s=>(s.cats||[]).includes(c)).length>=Math.max(1,n*0.5);
  const good=cats.filter(c=>seen(c) && !list.some(a=>a.cat===c && a.freq>=0.3));
  return {n, faults:list, top, drills, good}; };
})();
