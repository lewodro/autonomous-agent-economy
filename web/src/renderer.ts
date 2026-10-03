import type { Config, State, GameEvent } from './types.js';
const colors = ['#e39069','#99ad78','#ddb565','#9da6cf','#bb9b86','#84b2aa','#b592b9','#c5ae72'];
interface Point { x:number; y:number }
export class Renderer {
  private ctx: CanvasRenderingContext2D; private images = new Map<string,HTMLImageElement>();
  private state: State | null = null; private config: Config | null = null; private event: GameEvent | null = null; private at = 0;
  private positions: Point[] = []; selected = ''; favorite = new Set<string>(); paused = true;
  constructor(private canvas: HTMLCanvasElement, private inspect: (id:string)=>void) {
    this.ctx = canvas.getContext('2d')!; this.ctx.imageSmoothingEnabled = false;
    canvas.addEventListener('click', e => { const r = canvas.getBoundingClientRect(), x=(e.clientX-r.left)*960/r.width,y=(e.clientY-r.top)*540/r.height;
      const index=this.positions.findIndex(p => Math.abs(p.x-x)<65 && Math.abs(p.y-y)<65); const a=this.state?.agents[index];if(a)this.inspect(a.id); });
    const draw=(time:number)=>{this.draw(time);requestAnimationFrame(draw);};requestAnimationFrame(draw);
  }
  update(state:State,config:Config,event?:GameEvent) {
    this.state=structuredClone(state);this.config=config;
    if(event){this.event=event;this.at=performance.now();}else{this.event=null;}
    for(const profile of config.agents) if(!this.images.has(profile.sprite)){const img=new Image();img.src='/'+profile.sprite;this.images.set(profile.sprite,img);}
  }
  private rect(x:number,y:number,w:number,h:number,color:string){this.ctx.fillStyle=color;this.ctx.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));}
  private text(text:string,x:number,y:number,size=14,color='#eee0bd',align:CanvasTextAlign='center'){const c=this.ctx;const scale=(this.state?.agents.length||4)<=4?Math.min(1.75,Math.max(1,600/this.canvas.getBoundingClientRect().width)):1;c.fillStyle=color;c.font=`bold ${Math.round(size*scale)}px ui-monospace, monospace`;c.textAlign=align;c.fillText(text,Math.round(x),Math.round(y));}
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
    for(const x of [88,872]){this.rect(x-11,263,22,6,'#252a2a');this.rect(x-4,242,8,21,'#d2c19b');this.rect(x-3,230+(Math.floor(time/800)%2),6,10,'#e9bf71');this.rect(x-1,230,2,6,'#ffdea0');}
    if(!this.state||!this.config){this.text('PULLING UP THE CHAIRS…',480,280,18);return;}
    const state=this.state,config=this.config,n=state.agents.length;
    this.positions=n===2?[{x:208,y:270},{x:752,y:270}]:n===4?[{x:224,y:144},{x:736,y:144},{x:736,y:420},{x:224,y:420}]:state.agents.map((_,i)=>({x:480+350*Math.cos(-Math.PI/2+i*2*Math.PI/n),y:278+180*Math.sin(-Math.PI/2+i*2*Math.PI/n)}));
    for(const pair of state.alliances){const a=this.positions[state.agents.findIndex(a=>a.id===pair[0])],b=this.positions[state.agents.findIndex(a=>a.id===pair[1])];if(a&&b){c.strokeStyle='#b6bb7e';c.lineWidth=2;c.setLineDash([5,8]);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();c.setLineDash([]);}}
    this.text(state.ended?'THE LAST SEAT':'LAST SEAT',480,237,16,'#4c3e31');
    if(state.ended){const winner=config.agents.find(a=>a.id===state.winner);this.text(winner?winner.name.toUpperCase():'NO SOLE SURVIVOR',480,274,22,'#3b3a2d');this.text(winner?'SURVIVES':'DRAW',480,303,14,'#514738');}
    else {this.text(`WORK +${state.income}   UPKEEP −${state.upkeep}`,480,274,13,'#4b4938');this.text(state.turn===0?'WHO WILL KEEP THEIR SEAT?':`TURN ${String(state.turn).padStart(2,'0')}`,480,301,12,'#695239');}
    const progress=Math.min(1,(time-this.at)/650),kind=this.event?.type;
    const max=Math.max(...state.agents.map(a=>a.credits),1);
    state.agents.forEach((a,i)=>{
      const p=this.positions[i]!,profile=config.agents[i]!,color=colors[i%colors.length]!;
      let x=p.x,y=p.y;
      const actor=this.event?.actor===a.id,target=this.event?.target===a.id;
      const acting=actor && kind==='ChallengeStarted';
      if(acting){const to=this.positions[state.agents.findIndex(a=>a.id===this.event?.target)];if(to){x+=(to.x-x)*Math.sin(progress*Math.PI)*.14;y+=(to.y-y)*Math.sin(progress*Math.PI)*.14;}}
      if((target&&kind==='ChallengeResolved'&&this.event?.amount)||(actor&&kind==='ResourceChanged'&&(this.event?.amount||0)<0))x+=Math.sin(progress*35)*(1-progress)*5;
      const size=n>8?36:64;const idle=a.alive&&!this.paused?Math.floor(Math.sin(time/650+i)*1.5):0;
      this.rect(p.x-22,p.y+22,44,21,'#393336');this.rect(p.x-28,p.y-10,56,34,'#604e40');this.rect(p.x-24,p.y-6,48,26,'#796249');
      if(a.id===this.selected){this.rect(p.x-36,p.y+54,72,3,color);}
      if(a.alive){const image=this.images.get(profile.sprite);if(image?.complete&&image.naturalWidth)c.drawImage(image,Math.round(x-size/2),Math.round(y-size/2-8+idle),size,size);else{this.rect(x-15,y-30,30,32,color);this.rect(x-10,y-23,5,5,'#363135');this.rect(x+5,y-23,5,5,'#363135');}}
      else {c.globalAlpha=.28;const image=this.images.get(profile.sprite);if(image?.complete)c.drawImage(image,p.x-size/2,p.y-size/2-8,size,size);c.globalAlpha=1;this.text('OUT',p.x,p.y+7,14,'#d5a597');}
      this.text(`${this.favorite.has(a.id)?'★ ':''}${profile.name.slice(0,n>8?9:16)}`,p.x,p.y-size/2-19,n>8?10:20,a.alive?color:'#9d9690');
      this.rect(p.x-31,p.y+32,62,7,'#302e30');this.rect(p.x-30,p.y+33,60*Math.min(1,a.credits/profile.starting_credits),5,a.alive?color:'#736562');
      this.text(`${a.credits} cr${a.alive&&a.credits===max?' ◇':''}`,p.x,p.y+54,n>8?10:18,a.alive?'#f2e2bc':'#908782');
      if(a.guarded&&a.alive){this.text('◆',p.x+35,p.y-4,24,'#9caecd');}
      if(actor&&progress<1){
        const icon=kind==='WorkCompleted'?'⚒':kind==='GuardRaised'?'◆':kind==='CooperationOffered'||kind==='AllianceCreated'?'♥':kind==='ChallengeStarted'?'!':'';
        if(icon)this.text(icon,x,y-65-Math.sin(progress*Math.PI)*10,22,kind==='GuardRaised'?'#b9c7e0':'#eed18b');
        if(kind==='ResourceChanged'){const amount=this.event?.amount||0;if(amount)this.text(`${amount>0?'+':''}${amount}`,x+42,y-20-progress*25,20,amount>0?'#c5dd91':'#f0a27d');}
        if(kind==='AgentEliminated'){c.globalAlpha=1-progress;for(let q=0;q<8;q++)this.rect(p.x+Math.cos(q)*progress*45,p.y+Math.sin(q)*progress*35,5,5,color);c.globalAlpha=1;}
      }
      if(state.winner===a.id){this.text('♛',p.x,p.y-size/2-43,28,'#f3d27d');}
    });
    if(this.event?.actor&&this.event.target&&['ChallengeStarted','CooperationOffered','AllianceCreated'].includes(this.event.type)&&progress<1){const a=this.positions[state.agents.findIndex(a=>a.id===this.event?.actor)],b=this.positions[state.agents.findIndex(a=>a.id===this.event?.target)];if(a&&b){for(let i=0;i<4;i++){const t=(progress+i*.1)%1;this.rect(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,5,5,kind==='ChallengeStarted'?'#dda078':'#d2d39b');}}}
  }
}
