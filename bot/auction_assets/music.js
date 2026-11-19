/* Original 92 BPM auction-lounge instrumental, synthesized locally. */
window.GFAAuctionMusic = class {
  constructor() { this.playing=false; this.volume=.22; this.ctx=null; this.timer=null; this.generation=0; }
  async start() {
    if(this.playing)return;
    const Context=window.AudioContext||window.webkitAudioContext;
    if(!Context)throw new Error('Music is not supported in this browser.');
    const generation=++this.generation,ctx=new Context();this.ctx=ctx;
    await ctx.resume();if(generation!==this.generation){await ctx.close();return;}
    this.master=ctx.createGain();this.master.gain.value=this.volume;
    const compressor=ctx.createDynamicsCompressor();compressor.threshold.value=-16;compressor.ratio.value=3;
    this.master.connect(compressor).connect(ctx.destination);
    this.echo=ctx.createDelay();this.echo.delayTime.value=60/92*.75;
    const feedback=ctx.createGain(),wet=ctx.createGain();feedback.gain.value=.16;wet.gain.value=.13;
    this.echo.connect(feedback).connect(this.echo);this.echo.connect(wet).connect(this.master);
    this.noise=ctx.createBuffer(1,ctx.sampleRate*.6,ctx.sampleRate);
    const noise=this.noise.getChannelData(0);let seed=1427;
    for(let i=0;i<noise.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;noise[i]=(seed>>>0)/2147483648-1;}
    this.step=0;this.next=ctx.currentTime+.07;this.playing=true;
    this.schedule();this.timer=setInterval(()=>this.schedule(),25);
  }
  stop() {
    this.generation++;this.playing=false;clearInterval(this.timer);this.timer=null;
    const ctx=this.ctx;this.ctx=null;
    if(ctx&&ctx.state!=='closed'){this.master.gain.cancelScheduledValues(ctx.currentTime);this.master.gain.setTargetAtTime(0,ctx.currentTime,.045);setTimeout(()=>ctx.close().catch(()=>{}),250);}
  }
  setVolume(value) {
    this.volume=Math.max(0,Math.min(.65,Number(value)));
    if(this.ctx&&this.master)this.master.gain.setTargetAtTime(this.volume,this.ctx.currentTime,.05);
  }
  note(midi, at, length, volume, bass=false) {
    const ctx=this.ctx,f=440*2**((midi-69)/12),gain=ctx.createGain(),filter=ctx.createBiquadFilter();
    filter.type='lowpass';filter.frequency.value=bass?500:2400;filter.Q.value=.3;
    gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(volume,at+.015);
    gain.gain.exponentialRampToValueAtTime(.0001,at+length);gain.connect(filter).connect(this.master);
    if(!bass)gain.connect(this.echo);
    const harmonics=bass?[[1,1,'triangle']]:[[1,.75,'sine'],[2,.2,'sine'],[3,.05,'sine']];
    let remaining=harmonics.length;
    harmonics.forEach(([multiple,level,type])=>{const o=ctx.createOscillator(),v=ctx.createGain();o.type=type;o.frequency.value=f*multiple;v.gain.value=level;o.connect(v).connect(gain);o.start(at);o.stop(at+length+.02);o.onended=()=>{o.disconnect();v.disconnect();if(!--remaining){gain.disconnect();filter.disconnect();}};});
  }
  kick(at,soft=false) {
    const ctx=this.ctx,o=ctx.createOscillator(),g=ctx.createGain();
    o.frequency.setValueAtTime(116,at);o.frequency.exponentialRampToValueAtTime(40,at+.12);
    g.gain.setValueAtTime(soft?.22:.48,at);g.gain.exponentialRampToValueAtTime(.0001,at+.24);
    o.connect(g).connect(this.master);o.start(at);o.stop(at+.25);o.onended=()=>{o.disconnect();g.disconnect();};
  }
  percussion(at,snare=false,accent=false) {
    const ctx=this.ctx,n=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),g=ctx.createGain();n.buffer=this.noise;
    filter.type=snare?'bandpass':'highpass';filter.frequency.value=snare?1700:7400;filter.Q.value=.7;
    const length=snare?.14:.035;g.gain.setValueAtTime(snare?.16:accent?.055:.032,at);g.gain.exponentialRampToValueAtTime(.0001,at+length);
    n.connect(filter).connect(g).connect(this.master);n.start(at);n.stop(at+length+.01);n.onended=()=>{n.disconnect();filter.disconnect();g.disconnect();};
    if(snare)this.note(62,at,.06,.035,true);
  }
  schedule() {
    if(!this.ctx||!this.playing)return;
    const stepLength=60/92/4;
    if(this.next<this.ctx.currentTime-.2){this.next=this.ctx.currentTime+.04;}
    while(this.next<this.ctx.currentTime+.14){
      const step=this.step%16,bar=Math.floor(this.step/16)%8;
      const chords=[[50,57,60,64,69],[46,53,57,60,65],[53,60,64,67,72],[48,55,60,62,67]];
      const chord=chords[bar%4],root=[38,34,41,36][bar%4];
      const at=this.next+(step%2?.014:0);
      if([0,6,8,14].includes(step))this.kick(at,step===6||step===14);
      if(step===4||step===12)this.percussion(at,true);
      if(step%2===0)this.percussion(at,false,step%4===2);
      if([0,3,6,10,14].includes(step))this.note(root+(step===6?7:step===10?12:0),at,step===0?.36:.23,.14,true);
      if(step===0||step===9)chord.forEach((n,i)=>this.note(n,at+i*.009,step===0?1.5:1.0,.045));
      if(bar%2===1&&(step===2||step===11))this.note(chord[step===2?4:3]+12,at,.6,.018);
      this.step++;this.next+=stepLength;
    }
  }
};
