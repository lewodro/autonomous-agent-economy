import {CanvasAnimationDriver,dispatchAnimation} from './animation.js';
import type {AnimationDriver} from './animation.js';
import type {GameRenderer} from './rendering.js';
import type { Config, State, GameEvent } from './types.js';
const colors = ['#e39069','#99ad78','#ddb565','#9da6cf','#bb9b86','#84b2aa','#b592b9','#c5ae72'];
interface Point { x:number; y:number }
export class Renderer implements GameRenderer {
  private ctx: CanvasRenderingContext2D; private images = new Map<string,HTMLImageElement>();
  private state: State | null = null; private config: Config | null = null; private driver:AnimationDriver;private raf=0;private observer:ResizeObserver;private textScale=1;private hovered='';private resourceDisplay=new Map<string,number>();
  private positions: Point[] = []; selected = ''; favorite = new Set<string>(); paused = true;speed=1;reducedMotion=false;thinking=false;
  constructor(private canvas: HTMLCanvasElement, private inspect: (id:string)=>void,driver:AnimationDriver=new CanvasAnimationDriver()) {
    this.driver=driver;this.observer=new ResizeObserver(entries=>{this.textScale=Math.min(1.75,Math.max(1,600/(entries[0]?.contentRect.width||960)));});this.observer.observe(canvas);
    canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)*960/r.width,y=(e.clientY-r.top)*540/r.height;const i=this.positions.findIndex(p=>Math.abs(p.x-x)<45&&Math.abs(p.y-y)<55);this.hovered=this.state?.agents[i]?.id||'';canvas.title=this.config?.agents.find(a=>a.id===this.hovered)?.name||'Select a rival';});
    canvas.addEventListener('pointerleave',()=>this.hovered='');
    this.ctx = canvas.getContext('2d')!; this.ctx.imageSmoothingEnabled = false;
    canvas.addEventListener('click', e => { const r = canvas.getBoundingClientRect(), x=(e.clientX-r.left)*960/r.width,y=(e.clientY-r.top)*540/r.height;
      const index=this.positions.findIndex(p => Math.abs(p.x-x)<65 && Math.abs(p.y-y)<65); const a=this.state?.agents[index];if(a)this.inspect(a.id); });
    const draw=(time:number)=>{this.draw(time);this.raf=requestAnimationFrame(draw);};this.raf=requestAnimationFrame(draw);
  }
  update(state:State,config:Config,event?:GameEvent) {
    this.state=structuredClone(state);this.config=config;
    this.driver.setReducedMotion(this.reducedMotion);
    if(event)dispatchAnimation(this.driver,event);
    for(const profile of config.agents) if(!this.images.has(profile.sprite)){const img=new Image();img.src='/'+profile.sprite;this.images.set(profile.sprite,img);}
  }
  reset(){this.driver.reset();this.resourceDisplay.clear();}
  destroy(){cancelAnimationFrame(this.raf);this.observer.disconnect();}
  private rect(x:number,y:number,w:number,h:number,color:string){this.ctx.fillStyle=color;this.ctx.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));}
  private text(text:string,x:number,y:number,size=14,color='#eee0bd',align:CanvasTextAlign='center'){const c=this.ctx;const scale=(this.state?.agents.length||4)<=4?this.textScale:1;c.fillStyle=color;c.font=`bold ${Math.round(size*scale)}px ui-monospace, monospace`;c.textAlign=align;c.fillText(text,Math.round(x),Math.round(y));}
  private draw(time:number) {
    const c=this.ctx;c.imageSmoothingEnabled=false;
    this.rect(0,0,960,540,'#302d30');
    for(let y=0;y<540;y+=36){this.rect(0,y,960,2,'#28272b');for(let x=(y%72?0:70);x<960;x+=140)this.rect(x,y,2,36,'#393237');}
    this.rect(34,26,892,488,'#383638');this.rect(42,34,876,472,'#44413e');
    for(let x=44;x<920;x+=44)this.rect(x,36,2,466,'#4a4640');
    // Muted rug and a low-detail chamfered wooden table.
    this.rect(152,132,656,316,'#4f605a');this.rect(160,140,640,300,'#62716a');
    this.rect(170,150,620,280,'#546760');this.rect(178,158,604,264,'#5a6d66');
    this.rect(282,204,396,178,'#252c29');this.rect(298,184,364,184,'#705342');
    this.rect(286,198,388,154,'#876447');this.rect(298,188,364,170,'#a07d52');
    this.rect(302,192,356,158,'#b08a5a');
    for(let y=215;y<346;y+=32){this.rect(303,y,354,2,'#98764c');this.rect(380+(y%3)*16,y,2,30,'#a37d50');}
    this.rect(294,352,24,42,'#5d4739');this.rect(642,352,24,42,'#5d4739');
    // Small candles; no decorative dashboard chrome.
    for(const x of [88,872]){this.rect(x-11,263,22,6,'#252a2a');this.rect(x-4,242,8,21,'#d2c19b');this.rect(x-3,230+(this.reducedMotion?0:Math.floor(time/800)%2),6,10,'#e9bf71');this.rect(x-1,230,2,6,'#ffdea0');}
    if(!this.state||!this.config){this.text('PULLING UP THE CHAIRS…',480,280,18);return;}
    const state=this.state,config=this.config,n=state.agents.length;
    this.positions=n===2?[{x:208,y:270},{x:752,y:270}]:n===4?[{x:224,y:144},{x:736,y:144},{x:736,y:420},{x:224,y:420}]:n>8?state.agents.map((_,i)=>{const columns=Math.ceil(n/2);return {x:88+(i%columns)*784/(columns-1),y:i<columns?126:420};}):state.agents.map((_,i)=>({x:480+350*Math.cos(-Math.PI/2+i*2*Math.PI/n),y:278+180*Math.sin(-Math.PI/2+i*2*Math.PI/n)}));
    for(const pair of state.alliances){const a=this.positions[state.agents.findIndex(a=>a.id===pair[0])],b=this.positions[state.agents.findIndex(a=>a.id===pair[1])];if(a&&b){c.strokeStyle='#b6bb7e';c.lineWidth=2;c.setLineDash([5,8]);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();c.setLineDash([]);}}
    this.text(state.ended?'THE LAST SEAT':'LAST SEAT',480,237,16,'#4c3e31');
    if(state.ended){const winner=config.agents.find(a=>a.id===state.winner);this.text(winner?winner.name.toUpperCase():'NO SOLE SURVIVOR',480,274,22,'#3b3a2d');this.text(winner?'SURVIVES':'DRAW',480,303,14,'#514738');}
    else {this.text(`WORK +${state.income}   UPKEEP −${state.upkeep}`,480,274,13,'#4b4938');this.text(state.turn===0?'WHO WILL KEEP THEIR SEAT?':`TURN ${String(state.turn).padStart(2,'0')}`,480,301,12,'#695239');}
    const frame=this.driver.tick(time,this.paused,this.speed);c.save();c.translate(frame.camera.x,frame.camera.y);
    const max=Math.max(...state.agents.map(a=>a.credits),1);
    state.agents.forEach((a,i)=>{
      const p=this.positions[i]!,profile=config.agents[i]!,color=colors[i%colors.length]!;
      let x=p.x,y=p.y;
      const pose=frame.poses.get(a.id);
      x+=pose?.dx||0;y+=pose?.dy||0;
      if(pose?.moveTarget){const to=this.positions[state.agents.findIndex(a=>a.id===pose.moveTarget)];if(to){x+=(to.x-x)*(pose.moveProgress||0);y+=(to.y-y)*(pose.moveProgress||0);}}
      const size=n>8?36:64;const idle=a.alive&&!this.paused&&!this.reducedMotion?Math.floor(Math.sin(time/650+i)*1.5):0;
      this.rect(p.x-22,p.y+22,44,21,'#393336');this.rect(p.x-28,p.y-10,56,34,'#604e40');this.rect(p.x-24,p.y-6,48,26,'#796249');
      if(a.id===this.selected||a.id===this.hovered){this.rect(p.x-36,p.y+54,72,3,color);}
      if(pose?.flash){this.rect(x-36,y-44,72,72,'#eac5a3');}
      if(a.alive||pose?.animation==='eliminating'){c.globalAlpha=pose?.alpha??1;const image=this.images.get(profile.sprite);if(image?.complete&&image.naturalWidth)c.drawImage(image,Math.round(x-size/2),Math.round(y-size/2-8+idle),size,size);else{this.rect(x-15,y-30,30,32,color);this.rect(x-10,y-23,5,5,'#363135');this.rect(x+5,y-23,5,5,'#363135');}}
      else {c.globalAlpha=.28;const image=this.images.get(profile.sprite);if(image?.complete&&image.naturalWidth>0&&image.naturalHeight>0)c.drawImage(image,p.x-size/2,p.y-size/2-8,size,size);c.globalAlpha=1;this.text('OUT',p.x,p.y+7,14,'#d5a597');}
      c.globalAlpha=1;
      this.text(`${this.favorite.has(a.id)?'★ ':''}${profile.name.slice(0,n>8?9:16)}`,p.x,p.y-size/2-19,n>8?10:20,a.alive?color:'#9d9690');
      this.rect(p.x-31,p.y+32,62,7,'#302e30');this.rect(p.x-30,p.y+33,60*Math.min(1,this.displayCredits(a.id,a.credits)/profile.starting_credits),5,a.alive?color:'#736562');
      this.text(`${a.credits} cr${a.alive&&a.credits===max?' ◇':''}`,p.x,p.y+54,n>8?10:18,a.alive?'#f2e2bc':'#908782');
      if(a.guarded&&a.alive){this.text('◆',p.x+35,p.y-4,24,'#9caecd');}
      if((this.thinking&&a.alive)||pose?.animation==='thinking')this.text('···',x,y-66,22,'#e5d2a1');
      if(pose?.animation==='working')this.text('⚒',x+42,y-32,22,'#eed18b');
      if(pose?.animation==='guarding')this.text('◆',x+42,y-32,24,'#bbc9e2');
      if(state.winner===a.id){this.text('♛',p.x,p.y-size/2-43,28,'#f3d27d');}
    });
    for(const particle of frame.particles){const p=this.positions[state.agents.findIndex(a=>a.id===particle.id)];if(!p)continue;const q=this.positions[state.agents.findIndex(a=>a.id===particle.target)];const t=particle.progress;const angle=particle.index*2.399;let x=p.x+Math.cos(angle)*t*60,y=p.y+Math.sin(angle)*t*50-t*20;
      if(q){x=p.x+(q.x-p.x)*t;y=p.y+(q.y-p.y)*t-Math.sin(t*Math.PI)*30+Math.sin(angle)*8;}
      const color=particle.effect==='betrayal'?'#f18e7c':particle.effect==='hearts'?'#c6cf96':particle.effect==='confetti'?colors[particle.index%colors.length]!:'#ecc779';c.globalAlpha=1-t;this.rect(x,y,particle.effect==='confetti'?5:4,5,color);c.globalAlpha=1;
    }
    for(const popup of frame.popups){const p=this.positions[state.agents.findIndex(a=>a.id===popup.id)];if(p){c.globalAlpha=1-popup.progress;this.text(`${popup.amount>0?'+':''}${popup.amount}`,p.x+45,p.y-16-popup.progress*35,19,popup.amount>0?'#d0e5a0':'#edaa8e');c.globalAlpha=1;}}
    c.restore();
  }
  private displayCredits(id:string,value:number){const before=this.resourceDisplay.get(id)??value;const next=this.reducedMotion?value:this.paused?before:before+(value-before)*.2;this.resourceDisplay.set(id,next);return next;}
}
