import { SPRITES } from './sprites.js';
import { drawActorSprite } from './renderer.js';
import { request } from './gateway.js';
import type { Position } from './model.js';

export type SurvivalEventType='SurvivalMatchStarted'|'SurvivalMatchCompleted'|'AgentSpawned'|'TargetSelected'|'TargetChanged'|'ChaseStarted'|'AttackStarted'|'AttackLanded'|'DamageTaken'|'RetreatStarted'|'AgentCornered'|'AgentEscaped'|'AgentEliminated'|'WinnerDeclared'|'ResearchUpdated';
export interface SurvivalMetrics {damage_dealt:number;damage_taken:number;attacks_landed:number;target_changes:number;retreat_count:number;time_alive:number;eliminations:number;times_cornered:number;escapes:number;final_placement:number|null}
export interface SurvivalAgent {id:string;name:string;sprite:string;x:number;y:number;hp:number;max_hp:number;status:'alive'|'eliminated'|'queued'|'spectating';target_id:string|null;strategy:string;recent_action:string;research:string|null;wins:number;losses:number;direction:'up'|'down'|'left'|'right';movement_intent:'chase'|'retreat'|'reposition'|'idle';metrics:SurvivalMetrics}
export interface SurvivalObstacle {id:string;x:number;y:number;width:number;height:number;kind:'wall'|'barrier'}
export interface SurvivalEngagement {id:string;attacker_id:string;target_id:string;status:'chasing'|'fighting'|'retreating';recent_damage:number|null;recent_actions:string[]}
export interface SurvivalEvent {seq:number;type:SurvivalEventType;agent_id:string;target_id?:string|null;round:number;summary:string}
export interface SurvivalSnapshot {schema_version:1;match_id:string;status:'preparing'|'live'|'finished';sequence:number;updated_at:string;round:number;map:{width:number;height:number;obstacles:SurvivalObstacle[]};agents:SurvivalAgent[];engagements:SurvivalEngagement[];leader_id:string|null;events:SurvivalEvent[]}

export function hitEffectAgent(event:SurvivalEvent):string|undefined {
 if(event.type==='DamageTaken')return event.agent_id;
 if(event.type==='AttackLanded')return event.target_id||event.agent_id;
 return undefined;
}

const eventTypes=new Set<SurvivalEventType>(['SurvivalMatchStarted','SurvivalMatchCompleted','AgentSpawned','TargetSelected','TargetChanged','ChaseStarted','AttackStarted','AttackLanded','DamageTaken','RetreatStarted','AgentCornered','AgentEscaped','AgentEliminated','WinnerDeclared','ResearchUpdated']);
const idOk=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(value);
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
function validMetrics(value:unknown):value is SurvivalMetrics {
 if(!value||typeof value!=='object')return false;const metrics=value as SurvivalMetrics;
 const counts=[metrics.damage_dealt,metrics.damage_taken,metrics.attacks_landed,metrics.target_changes,metrics.retreat_count,metrics.time_alive,metrics.eliminations,metrics.times_cornered,metrics.escapes];
 return counts.every(count=>Number.isSafeInteger(count)&&count>=0)&&(metrics.final_placement===null||Number.isInteger(metrics.final_placement)&&metrics.final_placement>=1&&metrics.final_placement<=20);
}
function validAgent(value:unknown,width:number,height:number):value is SurvivalAgent {
 if(!value||typeof value!=='object')return false;const a=value as SurvivalAgent;
 return idOk(a.id)&&typeof a.name==='string'&&a.name.length>0&&a.name.length<=48&&typeof a.sprite==='string'&&SPRITES.some(s=>s.sheet==='/'+a.sprite)&&finite(a.x)&&finite(a.y)&&a.x>=0&&a.x<=width&&a.y>=0&&a.y<=height&&finite(a.hp)&&finite(a.max_hp)&&a.max_hp>0&&a.hp>=0&&a.hp<=a.max_hp&&['alive','eliminated','queued','spectating'].includes(a.status)&&(a.target_id===null||idOk(a.target_id))&&typeof a.strategy==='string'&&a.strategy.length<=120&&typeof a.recent_action==='string'&&a.recent_action.length<=180&&(a.research===null||typeof a.research==='string'&&a.research.length<=240)&&Number.isInteger(a.wins)&&a.wins>=0&&Number.isInteger(a.losses)&&a.losses>=0&&['up','down','left','right'].includes(a.direction)&&['chase','retreat','reposition','idle'].includes(a.movement_intent)&&validMetrics(a.metrics);
}
/** Strictly accept renderable server snapshots. The browser never fills gaps with simulated combat. */
export function parseSurvivalSnapshot(value:unknown):SurvivalSnapshot {
 if(!value||typeof value!=='object')throw new Error('Malformed Survival response');const s=value as SurvivalSnapshot;
 if(s.schema_version!==1||!idOk(s.match_id)||!['preparing','live','finished'].includes(s.status)||!Number.isSafeInteger(s.sequence)||s.sequence<0||typeof s.updated_at!=='string'||!Number.isFinite(Date.parse(s.updated_at))||!Number.isInteger(s.round)||s.round<0)throw new Error('Survival response is missing valid match metadata');
 if(!s.map||!finite(s.map.width)||!finite(s.map.height)||s.map.width<160||s.map.width>4096||s.map.height<160||s.map.height>4096||!Array.isArray(s.map.obstacles)||s.map.obstacles.length>256)throw new Error('Survival response contains an invalid arena map');
 if(!Array.isArray(s.agents)||s.agents.length>20||new Set(s.agents.map(a=>a?.id)).size!==s.agents.length||!s.agents.every(a=>validAgent(a,s.map.width,s.map.height)))throw new Error('Survival response contains invalid agent state');
 if(!Array.isArray(s.engagements)||s.engagements.length>20||!Array.isArray(s.events)||s.events.length>50)throw new Error('Survival response exceeds bounded event or engagement limits');
 const agentIds=new Set(s.agents.map(a=>a.id));
 if(!s.map.obstacles.every(o=>idOk(o.id)&&finite(o.x)&&finite(o.y)&&finite(o.width)&&finite(o.height)&&o.width>0&&o.height>0&&o.x>=0&&o.y>=0&&o.x+o.width<=s.map.width&&o.y+o.height<=s.map.height&&['wall','barrier'].includes(o.kind)))throw new Error('Survival response contains invalid obstacle geometry');
 if(!s.agents.every(a=>(a.target_id===null||agentIds.has(a.target_id))&&(a.status!=='eliminated'||a.hp===0)&&(a.status==='eliminated'||a.hp>0)))throw new Error('Survival response contains inconsistent health or target state');
 if(!s.engagements.every(e=>idOk(e.id)&&agentIds.has(e.attacker_id)&&agentIds.has(e.target_id)&&e.attacker_id!==e.target_id&&s.agents.find(a=>a.id===e.attacker_id)?.status==='alive'&&s.agents.find(a=>a.id===e.target_id)?.status==='alive'&&['chasing','fighting','retreating'].includes(e.status)&&(e.recent_damage===null||finite(e.recent_damage)&&e.recent_damage>=0)&&Array.isArray(e.recent_actions)&&e.recent_actions.length<=6&&e.recent_actions.every(a=>typeof a==='string'&&a.length<=180)))throw new Error('Survival response contains an invalid engagement');
 if(s.leader_id!==null&&!agentIds.has(s.leader_id))throw new Error('Survival leader must be a participant');
 if(!s.events.every(e=>Number.isSafeInteger(e.seq)&&eventTypes.has(e.type)&&agentIds.has(e.agent_id)&&(e.target_id===undefined||e.target_id===null||agentIds.has(e.target_id))&&Number.isInteger(e.round)&&e.round<=s.round&&typeof e.summary==='string'&&e.summary.length<=240))throw new Error('Survival response contains an invalid event');
 return s;
}
export async function loadSurvivalSnapshot():Promise<SurvivalSnapshot>{return parseSurvivalSnapshot(await request<unknown>('/api/survival/current'));}
export function acceptsSurvivalUpdate(current:SurvivalSnapshot|undefined,next:SurvivalSnapshot):boolean {
 return !current||current.match_id!==next.match_id||next.sequence>=current.sequence;
}

export interface Selection {kind:'agent'|'fight';id:string}
export function hitTest(snapshot:SurvivalSnapshot,x:number,y:number,positions?:ReadonlyMap<string,Position>):Selection|undefined {
 const at=(a:SurvivalAgent)=>positions?.get(a.id)||a;
 const agent=[...snapshot.agents].reverse().find(a=>Math.hypot(at(a).x-x,at(a).y-y)<20);if(agent)return {kind:'agent',id:agent.id};
 for(const e of snapshot.engagements){const a=at(snapshot.agents.find(v=>v.id===e.attacker_id)!),b=at(snapshot.agents.find(v=>v.id===e.target_id)!);const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1)));if(Math.hypot(x-a.x-t*dx,y-a.y-t*dy)<12)return {kind:'fight',id:e.id};}
 return undefined;
}

export class SurvivalRenderer {
 private ctx:CanvasRenderingContext2D;
 private map=document.createElement('canvas');
 private mapKey='';
 private images=new Map<string,HTMLImageElement>();
 private current?:SurvivalSnapshot;
 private selection?:Selection;
 private from=new Map<string,Position>();
 private transitionAt=0;
 private seenEventSeq=-1;
 private flashUntil=new Map<string,number>();
 private attackUntil=new Map<string,number>();
 private eliminatedAt=new Map<string,number>();
 private winnerAt=0;
 private raf=0;
 private active=true;
 constructor(private canvas:HTMLCanvasElement){
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas rendering is unavailable');this.ctx=ctx;
  for(const sprite of SPRITES){const image=new Image();image.src=sprite.sheet;this.images.set(sprite.sheet,image);}
 }
 render(s:SurvivalSnapshot,selection?:Selection):void {
  const now=performance.now(),old=this.current,sameMatch=old?.match_id===s.match_id;
  this.selection=selection;
  if(old===s)return;
  this.from=sameMatch?this.positions(now):new Map(s.agents.map(a=>[a.id,{x:a.x,y:a.y}]));
  this.current=s;this.transitionAt=now;
  if(!sameMatch){this.seenEventSeq=-1;this.flashUntil.clear();this.attackUntil.clear();this.eliminatedAt.clear();this.winnerAt=0;}
  for(const a of s.agents)if(sameMatch&&old?.agents.find(p=>p.id===a.id)?.status!=='eliminated'&&a.status==='eliminated')this.eliminatedAt.set(a.id,now);
  for(const event of s.events){
   if(event.seq<=this.seenEventSeq)continue;
   if(event.round>=s.round-1){
    const victim=hitEffectAgent(event);if(victim)this.flashUntil.set(victim,now+460);
    if(event.type==='AttackStarted'||event.type==='AttackLanded')this.attackUntil.set(event.agent_id,now+380);
    if(event.type==='AgentEliminated')this.eliminatedAt.set(event.agent_id,now);
   }
  }
  this.seenEventSeq=Math.max(this.seenEventSeq,...s.events.map(event=>event.seq));
  if(s.status==='finished'&&s.leader_id&&!this.winnerAt)this.winnerAt=now;
  const key=JSON.stringify(s.map);if(key!==this.mapKey){this.mapKey=key;this.paintMap(s);}
  if(this.active&&!this.raf)this.raf=requestAnimationFrame(this.frame);
 }
 setActive(active:boolean):void{
  this.active=active;
  if(!active&&this.raf){cancelAnimationFrame(this.raf);this.raf=0;}
  if(active&&this.current&&!this.raf)this.raf=requestAnimationFrame(this.frame);
 }
 positions(time=performance.now()):Map<string,Position>{
  const s=this.current,blend=Math.min(1,Math.max(0,(time-this.transitionAt)/1450));
  return new Map((s?.agents||[]).map(a=>{const start=this.from.get(a.id)||a;return [a.id,{x:start.x+(a.x-start.x)*blend,y:start.y+(a.y-start.y)*blend}] as const;}));
 }
 private paintMap(s:SurvivalSnapshot):void {
  const {width,height,obstacles}=s.map;this.map.width=width;this.map.height=height;
  const c=this.map.getContext('2d')!;c.imageSmoothingEnabled=false;
  c.fillStyle='#182a26';c.fillRect(0,0,width,height);
  for(let y=0;y<height;y+=32)for(let x=0;x<width;x+=32){
   c.fillStyle=(x/32+y/32)%2?'#263a30':'#293e33';c.fillRect(x,y,32,32);
   c.fillStyle='#355143';c.fillRect(x+3,y+3,2,2);
   if((x*3+y)%128===0){c.fillStyle='#526445';c.fillRect(x+22,y+23,5,2);}
  }
  // Only the obstacle rectangles from the authoritative map are rendered as solid cover.
  c.fillStyle='#31483b';c.fillRect(width*.28,0,width*.44,height);
  c.fillStyle='#365044';c.fillRect(0,height*.38,width,height*.24);
  c.strokeStyle='#62775b';c.lineWidth=3;c.strokeRect(width*.37,height*.25,width*.26,height*.5);
  c.strokeStyle='#738464';c.lineWidth=2;c.beginPath();c.arc(width/2,height/2,76,0,Math.PI*2);c.stroke();
  c.fillStyle='#72846c';c.font='bold 12px monospace';c.textAlign='center';
  c.fillText('NORTH PASS',width/2,42);c.fillText('SOUTH PASS',width/2,height-28);
  for(const o of obstacles){
   c.fillStyle='#10231f';c.fillRect(o.x+5,o.y+7,o.width,o.height);
   c.fillStyle=o.kind==='wall'?'#657568':'#877961';c.fillRect(o.x,o.y,o.width,o.height);
   c.fillStyle=o.kind==='wall'?'#9ca695':'#b5a177';c.fillRect(o.x,o.y,o.width,5);
   c.fillStyle=o.kind==='wall'?'#3d574c':'#635b48';c.fillRect(o.x,o.y+o.height-5,o.width,5);
   c.strokeStyle=o.kind==='wall'?'#425348':'#665b47';c.lineWidth=2;
   if(o.kind==='wall')for(let y=o.y+13;y<o.y+o.height;y+=16){c.beginPath();c.moveTo(o.x,y);c.lineTo(o.x+o.width,y);c.stroke();}
   else for(let x=o.x+14;x<o.x+o.width;x+=16){c.beginPath();c.moveTo(x,o.y+5);c.lineTo(x,o.y+o.height-5);c.stroke();}
  }
  c.strokeStyle='#a0a783';c.lineWidth=8;c.strokeRect(4,4,width-8,height-8);
  c.strokeStyle='#41584a';c.lineWidth=3;c.strokeRect(14,14,width-28,height-28);
 }
 private frame=(time:number):void=>{
  this.raf=0;if(!this.current||!this.active)return;
  this.drawFrame(this.current,time,this.positions(time));
  this.raf=requestAnimationFrame(this.frame);
 };
 private drawFrame(s:SurvivalSnapshot,time:number,positions:ReadonlyMap<string,Position>):void {
  const ratio=Math.min(2,window.devicePixelRatio||1),w=Math.max(1,this.canvas.clientWidth),h=Math.max(1,this.canvas.clientHeight);
  if(this.canvas.width!==Math.round(w*ratio)||this.canvas.height!==Math.round(h*ratio)){this.canvas.width=Math.round(w*ratio);this.canvas.height=Math.round(h*ratio);}
  const c=this.ctx,scale=Math.min(w/s.map.width,h/s.map.height),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  c.setTransform(ratio,0,0,ratio,0,0);c.fillStyle='#111d1a';c.fillRect(0,0,w,h);
  c.setTransform(ratio*scale,0,0,ratio*scale,(w-s.map.width*scale)*ratio/2,(h-s.map.height*scale)*ratio/2);
  c.imageSmoothingEnabled=false;c.drawImage(this.map,0,0);
  for(const e of s.engagements){
   const a=positions.get(e.attacker_id)!,b=positions.get(e.target_id)!;
   const fighting=e.status==='fighting',focused=this.selection?.kind==='fight'&&this.selection.id===e.id;
   c.save();c.strokeStyle=fighting?'#ff7b63':e.status==='retreating'?'#8ccef0':'#edc66d';c.globalAlpha=focused?1:.74;
   c.lineWidth=focused?5:fighting?3:2;c.setLineDash(fighting?[]:[8,6]);c.lineDashOffset=reduced?0:-time/55;
   c.beginPath();c.moveTo(a.x,a.y-5);c.lineTo(b.x,b.y-5);c.stroke();c.setLineDash([]);
   const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1,mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
   c.fillStyle=c.strokeStyle;c.beginPath();c.moveTo(mx+dx/length*7,my+dy/length*7);c.lineTo(mx-dy/length*4,my+dx/length*4);c.lineTo(mx+dy/length*4,my-dx/length*4);c.fill();
   if(fighting){c.strokeStyle='#ffb07b';c.lineWidth=1.5;c.beginPath();c.arc(mx,my,14+(reduced?0:Math.sin(time/150)*2),0,Math.PI*2);c.stroke();}
   c.restore();
  }
  const labels:{x:number;y:number;width:number}[]=[];
  for(const a of [...s.agents].sort((one,two)=>positions.get(one.id)!.y-positions.get(two.id)!.y)){
   const base=positions.get(a.id)!,dead=a.status==='eliminated',target=a.target_id&&positions.get(a.target_id);
   const attacking=(this.attackUntil.get(a.id)||0)>time&&!!target;
   const attackProgress=attacking?Math.max(0,Math.min(1,(this.attackUntil.get(a.id)!-time)/380)):0;
   const lunge=attacking&&!reduced?Math.sin((1-attackProgress)*Math.PI)*9:0;
   const distance=target?Math.hypot(target.x-base.x,target.y-base.y)||1:1;
   const x=base.x+(target?(target.x-base.x)/distance*lunge:0),y=base.y+(target?(target.y-base.y)/distance*lunge:0);
   const focused=this.selection?.kind==='agent'&&this.selection.id===a.id||this.selection?.kind==='fight'&&s.engagements.some(e=>e.id===this.selection!.id&&(e.attacker_id===a.id||e.target_id===a.id));
   const winner=s.status==='finished'&&s.leader_id===a.id;
   if(focused||winner){c.strokeStyle=winner?'#f2ce78':'#c5ec78';c.lineWidth=3;c.beginPath();c.ellipse(x,y+5,23+(winner&&!reduced?Math.sin(time/200)*3:0),10,0,0,Math.PI*2);c.stroke();}
   c.fillStyle='#101d19a8';c.beginPath();c.ellipse(x,y+8,16,6,0,0,Math.PI*2);c.fill();
   const def=SPRITES.find(sprite=>sprite.sheet==='/'+a.sprite),image=def&&this.images.get(def.sheet);
   const fade=dead?Math.max(.2,1-Math.max(0,time-(this.eliminatedAt.get(a.id)||0))/700):1;
   c.save();c.globalAlpha=fade;
   drawActorSprite(c,def,image,{position:{x,y},facing:a.direction,movementState:a.movement_intent==='idle'?'idle':'walking'},time,reduced,38);
   c.restore();
   if((this.flashUntil.get(a.id)||0)>time){c.save();c.globalAlpha=.35+.25*Math.sin(time/40)**2;c.fillStyle='#ff333b';c.fillRect(x-17,y-31,34,32);c.strokeStyle='#ff6868';c.lineWidth=3;c.beginPath();c.arc(x,y-8,23,0,Math.PI*2);c.stroke();c.restore();}
   if(attacking&&target){c.strokeStyle='#ffe4a0';c.lineWidth=3;c.beginPath();c.arc(target.x,target.y-10,15,-.9,.7);c.stroke();}
   if(winner){
    const pulse=reduced?0:Math.sin((time-this.winnerAt)/180)*3;
    c.fillStyle='#eec767';c.fillRect(x-10,y-43+pulse,20,5);c.fillRect(x-10,y-49+pulse,4,6);c.fillRect(x-2,y-53+pulse,4,10);c.fillRect(x+6,y-49+pulse,4,6);
    if(!reduced)for(let n=0;n<6;n++){const angle=n*Math.PI/3+time/850;c.fillRect(x+Math.cos(angle)*32,y-12+Math.sin(angle)*21,3,3);}
   }
   c.fillStyle='#10211b';c.fillRect(x-16,y-35,32,5);
   c.fillStyle=dead?'#738078':a.hp/a.max_hp<.3?'#ed6d65':'#b9eb69';c.fillRect(x-15,y-34,30*a.hp/a.max_hp,3);
   const label=a.name.slice(0,13).toUpperCase(),labelWidth=label.length*5.5+8,labelX=x-labelWidth/2;
   if(focused||winner||!labels.some(other=>labelX<other.x+other.width&&labelX+labelWidth>other.x&&Math.abs(y-45-other.y)<13)){
    labels.push({x:labelX,y:y-45,width:labelWidth});
    c.fillStyle='#10211be0';c.fillRect(labelX,y-49,labelWidth,11);c.fillStyle=dead?'#a7aea5':winner?'#f3d582':'#e8e8d8';c.font='bold 9px monospace';c.textAlign='center';c.fillText(label,x,y-40);
   }
   if(dead){c.fillStyle='#ef8e80';c.font='bold 9px monospace';c.textAlign='center';c.fillText('OUT',x,y+20);}
  }
 }
 point(event:PointerEvent,s:SurvivalSnapshot):Position{const rect=this.canvas.getBoundingClientRect(),scale=Math.min(rect.width/s.map.width,rect.height/s.map.height);return {x:(event.clientX-rect.left-(rect.width-s.map.width*scale)/2)/scale,y:(event.clientY-rect.top-(rect.height-s.map.height*scale)/2)/scale};}
 destroy():void{if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;this.images.clear();this.current=undefined;}
}
