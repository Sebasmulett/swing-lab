// Swing Lab · procesador de audio para oír el impacto (corre en el hilo de audio)
class SLOnset extends AudioWorkletProcessor{
  constructor(){ super(); this.prev=0; this.floor=3e-4; }
  process(inputs){ const ch=inputs[0]&&inputs[0][0]; if(!ch) return true;
    let pk=0, pi=0; for(let i=0;i<ch.length;i++){ const x=ch[i], d=Math.abs(x-this.prev); this.prev=x; if(d>pk){ pk=d; pi=i; } }
    const fl=this.floor; if(pk>fl*6 && pk>0.006) this.port.postMessage({f:currentFrame+pi, pk:pk, r:pk/fl});
    this.floor = pk>fl ? fl+(pk-fl)*0.004 : fl+(pk-fl)*0.03; if(this.floor<2e-5) this.floor=2e-5;
    return true; } }
registerProcessor("sl-onset", SLOnset);
