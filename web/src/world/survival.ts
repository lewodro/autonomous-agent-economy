import { SPRITES } from './sprites.js';
import { request } from './gateway.js';

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

export interface Selection {kind:'agent'|'fight';id:string}
export function hitTest(snapshot:SurvivalSnapshot,x:number,y:number):Selection|undefined {
 const agent=[...snapshot.agents].reverse().find(a=>Math.hypot(a.x-x,a.y-y)<24);if(agent)return {kind:'agent',id:agent.id};
 for(const e of snapshot.engagements){const a=snapshot.agents.find(v=>v.id===e.attacker_id)!,b=snapshot.agents.find(v=>v.id===e.target_id)!;const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1)));if(Math.hypot(x-a.x-t*dx,y-a.y-t*dy)<16)return {kind:'fight',id:e.id};}
 return undefined;
}

export class SurvivalRenderer {
 private ctx:CanvasRenderingContext2D;private images=new Map<string,HTMLImageElement>();private previous?:SurvivalSnapshot;private flashUntil=new Map<string,number>();private raf=0;
 constructor(private canvas:HTMLCanvasElement){const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas rendering is unavailable');this.ctx=ctx;for(const sprite of SPRITES){const image=new Image();image.src=sprite.sheet;this.images.set(sprite.sheet,image);}}
  render(s:SurvivalSnapshot,selection?:Selection):void {
  const previous=this.previous;this.previous=s;const now=performance.now();for(const event of s.events){const affected=hitEffectAgent(event);if(affected&&(!previous||event.seq>previous.sequence))this.flashUntil.set(affected,now+420);}
  if(this.raf)cancelAnimationFrame(this.raf);const frame=(time:number)=>{this.drawFrame(s,selection,Math.min(1,(time-now)/1200),time,previous);if(time-now<1200||[...this.flashUntil.values()].some(until=>until>time))this.raf=requestAnimationFrame(frame);else this.raf=0;};this.raf=requestAnimationFrame(frame);
 }
 private drawFrame(s:SurvivalSnapshot,selection:Selection|undefined,alpha:number,time:number,previous?:SurvivalSnapshot):void {
  const prior=new Map((previous?.match_id===s.match_id?previous.agents:[]).map(a=>[a.id,a]));
  const positions=new Map(s.agents.map(a=>{const old=prior.get(a.id);return [a.id,{x:old?old.x+(a.x-old.x)*alpha:a.x,y:old?old.y+(a.y-old.y)*alpha:a.y}] as const;}));
  const ratio=Math.min(2,window.devicePixelRatio||1),w=Math.max(1,this.canvas.clientWidth),h=Math.max(1,this.canvas.clientHeight);if(this.canvas.width!==Math.round(w*ratio)||this.canvas.height!==Math.round(h*ratio)){this.canvas.width=Math.round(w*ratio);this.canvas.height=Math.round(h*ratio);}const c=this.ctx,scale=Math.min(w/s.map.width,h/s.map.height);c.setTransform(ratio*scale,0,0,ratio*scale,(w-s.map.width*scale)*ratio/2,(h-s.map.height*scale)*ratio/2);c.imageSmoothingEnabled=false;c.fillStyle='#172922';c.fillRect(0,0,s.map.width,s.map.height);
  for(let y=0;y<s.map.height;y+=32)for(let x=0;x<s.map.width;x+=32){c.fillStyle=((x/32+y/32)%2)?'#294338':'#263f35';c.fillRect(x,y,32,32);c.strokeStyle='#385447';c.lineWidth=1;c.strokeRect(x+.5,y+.5,32,32);}
  for(const o of s.map.obstacles){c.fillStyle=o.kind==='wall'?'#596151':'#736b51';c.fillRect(o.x,o.y,o.width,o.height);c.strokeStyle=o.kind==='wall'?'#858875':'#a09069';c.lineWidth=2;c.strokeRect(o.x+1,o.y+1,o.width-2,o.height-2);}
  for(const e of s.engagements){const a={...s.agents.find(v=>v.id===e.attacker_id)!,...positions.get(e.attacker_id)},b={...s.agents.find(v=>v.id===e.target_id)!,...positions.get(e.target_id)};c.save();c.strokeStyle=e.status==='fighting'?'#ef8374':'#e9c875';c.lineWidth=e.status==='fighting'?3:2;c.setLineDash(e.status==='chasing'?[7,5]:[]);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();c.fillStyle='#101b18';c.beginPath();c.arc((a.x+b.x)/2,(a.y+b.y)/2,10,0,Math.PI*2);c.fill();c.fillStyle='#f2e7d1';c.font='bold 10px monospace';c.textAlign='center';c.textBaseline='middle';c.fillText('VS',(a.x+b.x)/2,(a.y+b.y)/2);c.restore();}
  for(const source of s.agents){const a={...source,...positions.get(source.id)},dead=a.status==='eliminated',focused=selection?.kind==='agent'&&selection.id===a.id||selection?.kind==='fight'&&s.engagements.find(e=>e.id===selection.id&&[e.attacker_id,e.target_id].includes(a.id));if(focused){c.strokeStyle='#c5ec78';c.lineWidth=3;c.beginPath();c.arc(a.x,a.y,25,0,Math.PI*2);c.stroke();}if((this.flashUntil.get(a.id)||0)>time){c.fillStyle='#ed625d88';c.beginPath();c.arc(a.x,a.y,25,0,Math.PI*2);c.fill();}const def=SPRITES.find(v=>v.sheet==='/'+a.sprite),image=def&&this.images.get(def.sheet);if(def&&image?.complete&&image.naturalWidth){c.globalAlpha=dead ? .35 : 1;c.drawImage(image,0,0,def.frameWidth,def.frameHeight,a.x-18,a.y-20,36,36);c.globalAlpha=1;}else{c.fillStyle=dead?'#777':'#e9d8b7';c.fillRect(a.x-10,a.y-10,20,20);}c.fillStyle='#101b18';c.fillRect(a.x-18,a.y-31,36,7);c.fillStyle=dead?'#777':a.hp/a.max_hp<.3?'#ed8075':'#b9eb69';c.fillRect(a.x-18,a.y-31,36*a.hp/a.max_hp,7);c.fillStyle=dead?'#9b9b8b':'#f0eadb';c.font='10px monospace';c.textAlign='center';c.fillText(a.name.slice(0,12).toUpperCase(),a.x,a.y-37);if(dead){c.fillStyle='#f08d80';c.fillText('OUT',a.x,a.y+24);}}
 }
 point(event:PointerEvent,s:SurvivalSnapshot):{x:number;y:number}|undefined{const rect=this.canvas.getBoundingClientRect(),scale=Math.min(rect.width/s.map.width,rect.height/s.map.height);return {x:(event.clientX-rect.left-(rect.width-s.map.width*scale)/2)/scale,y:(event.clientY-rect.top-(rect.height-s.map.height*scale)/2)/scale};}
 destroy():void{if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;this.images.clear();}
}
