import { moveActor } from './movement.js';
import { ARENA_LOUNGE_WAYPOINT, NPC_WAYPOINTS, WALLS } from './map.js';
import type { WorldActor, Position, WorldActivityState } from './model.js';

export const MAX_PLAZA_AGENTS = 6;
const SPAWN_POINTS: Position[] = [
  {x:408,y:320},{x:476,y:320},{x:644,y:320},{x:712,y:320},{x:776,y:320},
  {x:408,y:425},{x:476,y:425},{x:644,y:425},{x:712,y:425},{x:776,y:425},
  {x:408,y:545},{x:476,y:545},{x:644,y:545},{x:712,y:545},{x:776,y:545},
  {x:408,y:660},{x:476,y:660},{x:644,y:660},{x:712,y:660},{x:776,y:660},
];
const LABELS: Record<WorldActivityState,string> = {
  idle:'Taking a plaza break', wander:'Wandering the plaza', walk_to_arena:'Heading to the Arena',
  inside_arena:'In the Arena', exit_arena:'Leaving the Arena · match complete', walk_to_poi:'Walking to a point of interest',
  studying:'Studying the last match', attention:'Has something to say', talking:'Talking with a visitor', cooldown:'Taking a short break',
};
export function activityLabel(state:WorldActivityState):string { return LABELS[state]; }
export interface PlazaAgent { id:string; arenaStatus:'fighting'|'finished'|'queued' }
export interface NpcProfileLike { id?:string; name?:string; strategy?:string }
export interface AgentBehaviorProfile { speed:number; idleSeconds:number; routeBias:number; arenaInterest:number; social:boolean }
function hash(value:string):number { let result=2166136261; for(const char of value){result^=char.charCodeAt(0);result=Math.imul(result,16777619);} return result>>>0; }
export function behaviorProfile(profile:NpcProfileLike|undefined,index=0):AgentBehaviorProfile {
  const key=profile?.id||profile?.name||`npc-${index}`; const seed=hash(key); const strategy=(profile?.strategy||'').toLowerCase();
  if(/aggress|gambler|wild/.test(strategy))return {speed:58,idleSeconds:1.1,routeBias:seed%NPC_WAYPOINTS.length,arenaInterest:0.8,social:false};
  if(/analyst|research/.test(strategy))return {speed:40,idleSeconds:3.5,routeBias:10,arenaInterest:0.28,social:false};
  if(/defend|guard/.test(strategy))return {speed:43,idleSeconds:3,routeBias:14,arenaInterest:0.35,social:false};
  if(/trader|social/.test(strategy))return {speed:48,idleSeconds:2,routeBias:7,arenaInterest:0.5,social:true};
  return {speed:46,idleSeconds:1.8+(seed%10)/10,routeBias:seed%NPC_WAYPOINTS.length,arenaInterest:0.5,social:seed%3===0};
}
export function npcSpawnPosition(index:number):Position { return {...SPAWN_POINTS[((index%SPAWN_POINTS.length)+SPAWN_POINTS.length)%SPAWN_POINTS.length]!}; }
export function arenaExitPosition(index:number):Position { return {x:880+(index%3)*32,y:724+Math.floor(index/3)*24}; }
/** Keep the plaza readable while reserving two visitor slots for recent finishers. */
export function selectPlazaAgents<T extends PlazaAgent>(profiles:T[],currentIds:string[]=[]):T[] {
  const eligible=profiles.filter(profile=>profile.arenaStatus!=='fighting');
  const returning=eligible.filter(profile=>profile.arenaStatus==='finished').slice(0,2);
  const returningIds=new Set(returning.map(profile=>profile.id));
  const current=eligible.filter(profile=>currentIds.includes(profile.id)&&!returningIds.has(profile.id));
  const waiting=eligible.filter(profile=>!returningIds.has(profile.id)&&!currentIds.includes(profile.id));
  return [...returning,...current,...waiting].slice(0,MAX_PLAZA_AGENTS);
}
export interface AgentController { update(actor:WorldActor,seconds:number,actors?:WorldActor[]):void }
function nearestWaypoint(position:Position):number {
  let nearest=0,distance=Infinity;
  for(const [index,point] of NPC_WAYPOINTS.entries()){
    const candidate=Math.hypot(point.x-position.x,point.y-position.y);
    if(candidate<distance){nearest=index;distance=candidate;}
  }
  return nearest;
}
/** Presentation only: the server remains authoritative for every match decision. */
export class NpcController implements AgentController {
  private waypoint=0; private pause=0; private stuck=0; private lounge=0; private studying=0;
  private attention=0;private talking=0;private conversationCooldown=0;
  private returningFromArena:boolean; private readonly behavior:AgentBehaviorProfile; private randomState:number; private visits=0;
  constructor(index:number,returningFromArena=false,profile?:NpcProfileLike) {
    this.behavior=behaviorProfile(profile,index); this.randomState=hash(`${profile?.id||profile?.name||index}:plaza-route`)||1;
    this.waypoint=returningFromArena?ARENA_LOUNGE_WAYPOINT:this.chooseWaypoint(nearestWaypoint(npcSpawnPosition(index)));
    this.pause=returningFromArena?0:.25+this.random()*Math.max(1,this.behavior.idleSeconds*1.8); this.returningFromArena=returningFromArena;
  }
  returnToArenaLounge():void { this.returningFromArena=true; this.lounge=0; this.studying=0; this.waypoint=ARENA_LOUNGE_WAYPOINT; this.pause=0; this.stuck=0; }
  offerThought(seconds=24):boolean { if(this.attention>0||this.talking>0||this.conversationCooldown>0)return false;this.attention=seconds;return true; }
  beginTalking():void { this.attention=0;this.talking=4;this.pause=0; }
  dismissThought():void { if(this.attention>0){this.attention=0;this.conversationCooldown=3;} }
  relocate(position:Position):void { this.waypoint=nearestWaypoint(position);this.stuck=0;this.pause=0; }
  private random():number {
    // Per-agent deterministic PRNG: identities stay stable while routes diverge.
    let value=this.randomState;value^=value<<13;value^=value>>>17;value^=value<<5;this.randomState=value>>>0;return this.randomState/4294967296;
  }
  private chooseWaypoint(previous:number):number {
    const count=NPC_WAYPOINTS.length;let candidate=previous;
    for(let attempt=0;attempt<8&&candidate===previous;attempt++){
      const roll=this.random();
      if(this.behavior.arenaInterest>.65&&roll<.2)candidate=ARENA_LOUNGE_WAYPOINT;
      else candidate=Math.floor(this.random()*count);
    }
    this.visits++;return candidate;
  }
  private setState(actor:WorldActor,state:WorldActivityState):void { actor.activityState=state; actor.activity=activityLabel(state); }
  update(actor:WorldActor,seconds:number,actors:WorldActor[]=[]):void {
    if(this.talking>0){this.talking-=seconds;actor.movementState='idle';this.setState(actor,'talking');if(this.talking<=0)this.conversationCooldown=2.5;return;}
    if(this.attention>0){this.attention-=seconds;actor.movementState='idle';this.setState(actor,'attention');if(this.attention<=0)this.conversationCooldown=3;return;}
    if(this.conversationCooldown>0){this.conversationCooldown-=seconds;actor.movementState='idle';this.setState(actor,'cooldown');return;}
    if(this.returningFromArena&&this.lounge>0){
      this.lounge-=seconds; actor.movementState='idle'; this.setState(actor,'cooldown');
      if(this.lounge<=0)this.studying=1.5; return;
    }
    if(this.returningFromArena&&this.studying>0){
      this.studying-=seconds; actor.movementState='idle'; this.setState(actor,'studying');
      if(this.studying<=0){this.returningFromArena=false;this.pause=.2;} return;
    }
    if(this.pause>0){this.pause-=seconds;actor.movementState='idle';this.setState(actor,'idle');return;}
    const target=NPC_WAYPOINTS[this.waypoint]!; const dx=target.x-actor.position.x,dy=target.y-actor.position.y;
    const before={...actor.position};
    this.setState(actor,this.returningFromArena?'exit_arena':'wander');
    // NPCs use the shared wall/building collision, but do not block one
    // another. Finished agents can return from the Arena as a group; treating
    // their presentation sprites as solid would deadlock the whole cluster.
    // Human visitors still use presence obstacles through the normal player
    // movement path, and nearby NPCs continue to inform social activity.
    actor.movementState='walking'; moveActor(actor,{x:dx,y:dy,interact:false},seconds,this.behavior.speed,WALLS);
    const moved=Math.hypot(actor.position.x-before.x,actor.position.y-before.y); this.stuck=moved<.1?this.stuck+seconds:0;
    if(Math.hypot(dx,dy)<10||this.stuck>.5){
      this.stuck=0; const previous=this.waypoint;this.waypoint=this.chooseWaypoint(previous);
      this.pause=Math.max(.35,this.behavior.idleSeconds*(.55+this.random()*1.35));
      if(this.returningFromArena){this.lounge=1.25;actor.movementState='idle';this.setState(actor,'cooldown');}
      else{actor.movementState='idle';this.setState(actor,'idle');}
    }
  }
}
