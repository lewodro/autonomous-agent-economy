import { moveActor, presenceObstacles } from './movement.js';
import { WALLS } from './map.js';
import type { WorldActor, Position } from './model.js';
export const MAX_PLAZA_AGENTS=6;
const PLAZA_WAYPOINTS: Position[] = [
  {x:430,y:310},{x:640,y:320},{x:740,y:350},{x:660,y:430},{x:780,y:420},
  {x:430,y:510},{x:660,y:570},{x:360,y:680},{x:720,y:680},{x:450,y:650},
  {x:735,y:740},{x:390,y:390},{x:650,y:300},{x:400,y:570},{x:755,y:520},
  {x:440,y:730},{x:680,y:760},{x:340,y:430},{x:755,y:310},{x:700,y:620},
];
interface Waypoint {position:Position;travel:string;arrival:string}
const WAYPOINTS:Waypoint[]=PLAZA_WAYPOINTS.map(position=>({position,travel:'Walking through the plaza',arrival:'Taking a plaza break'}));
const SPAWN_POINTS:Position[]=[
  {x:408,y:320},{x:476,y:320},{x:644,y:320},{x:712,y:320},{x:776,y:320},
  {x:408,y:425},{x:476,y:425},{x:644,y:425},{x:712,y:425},{x:776,y:425},
  {x:408,y:545},{x:476,y:545},{x:644,y:545},{x:712,y:545},{x:776,y:545},
  {x:408,y:660},{x:476,y:660},{x:644,y:660},{x:712,y:660},{x:776,y:660},
];
export function npcSpawnPosition(index:number):Position {
  return {...SPAWN_POINTS[((index%SPAWN_POINTS.length)+SPAWN_POINTS.length)%SPAWN_POINTS.length]!};
}
export function arenaExitPosition(index:number):Position {
  return {x:880+(index%3)*32,y:724+Math.floor(index/3)*24};
}
export interface PlazaAgent {id:string;arenaStatus:'fighting'|'finished'|'queued'}
/** Keep the plaza readable while reserving two visitor slots for recent finishers. */
export function selectPlazaAgents<T extends PlazaAgent>(profiles:T[],currentIds:string[]=[]):T[] {
  const eligible=profiles.filter(profile=>profile.arenaStatus!=='fighting');
  const returning=eligible.filter(profile=>profile.arenaStatus==='finished').slice(0,2);
  const returningIds=new Set(returning.map(profile=>profile.id));
  const current=eligible.filter(profile=>currentIds.includes(profile.id)&&!returningIds.has(profile.id));
  const waiting=eligible.filter(profile=>!returningIds.has(profile.id)&&!currentIds.includes(profile.id));
  const selected=[...returning,...current,...waiting];
  return selected.slice(0,MAX_PLAZA_AGENTS);
}
export interface AgentController { update(actor:WorldActor, seconds:number):void }
/** Presence only: neither selects minigame moves nor claims research results. */
export class NpcController implements AgentController {
  private waypoint=0;private pause=0;private stuck=0;
  private returningFromArena:boolean;
  constructor(index:number,returningFromArena=false) {
    this.waypoint=returningFromArena?10:index%WAYPOINTS.length;this.pause=returningFromArena?0:index*.3;this.returningFromArena=returningFromArena;
  }
  update(actor:WorldActor,seconds:number,actors:WorldActor[]=[]):void {
    if(this.pause>0){this.pause-=seconds;actor.movementState='idle';return;}
    const waypoint=WAYPOINTS[this.waypoint]!;
    const target=waypoint.position;
    const dx=target.x-actor.position.x,dy=target.y-actor.position.y;
    const before={...actor.position};
    actor.activity=this.returningFromArena?'Leaving the Arena · match complete':waypoint.travel;
    const nearby=actors.filter(other=>other!==actor&&Math.hypot(other.position.x-actor.position.x,other.position.y-actor.position.y)<64);
    const obstacles=[...WALLS,...presenceObstacles(nearby,actor)];
    moveActor(actor,{x:dx,y:dy,interact:false},seconds,48,obstacles);
    const moved=Math.hypot(actor.position.x-before.x,actor.position.y-before.y);
    this.stuck=moved<.1?this.stuck+seconds:0;
    if(Math.hypot(dx,dy)<10){this.waypoint=(this.waypoint+1)%WAYPOINTS.length;this.pause=1.8;this.stuck=0;actor.activity=this.returningFromArena?'Back in the plaza · match complete':waypoint.arrival;this.returningFromArena=false;}
    else if(this.stuck>.5){this.waypoint=(this.waypoint+1)%WAYPOINTS.length;this.pause=1.8;this.stuck=0;actor.activity='Taking a plaza break';this.returningFromArena=false;}
  }
}
