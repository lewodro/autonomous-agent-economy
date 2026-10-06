import { moveActor } from './movement.js';
import type { WorldActor, Position } from './model.js';
const WAYPOINTS: Position[] = [{x:430,y:470},{x:680,y:370},{x:730,y:700},{x:900,y:690},{x:350,y:620},{x:400,y:340}];
export interface AgentController { update(actor:WorldActor, seconds:number):void }
/** Presence only: neither selects minigame moves nor claims research results. */
export class NpcController implements AgentController {
  private waypoint=0;private pause=0;private stuck=0;
  constructor(index:number) {this.waypoint=index%WAYPOINTS.length;this.pause=index*.3;}
  update(actor:WorldActor,seconds:number):void {
    if(this.pause>0){this.pause-=seconds;actor.movementState='idle';return;}
    const target=WAYPOINTS[this.waypoint]!;
    const dx=target.x-actor.position.x,dy=target.y-actor.position.y;
    const before={...actor.position};
    moveActor(actor,{x:dx,y:dy,interact:false},seconds,48);
    const moved=Math.hypot(actor.position.x-before.x,actor.position.y-before.y);
    this.stuck=moved<.1?this.stuck+seconds:0;
    if(Math.hypot(dx,dy)<10||this.stuck>1.2){this.waypoint=(this.waypoint+1)%WAYPOINTS.length;this.pause=1.8;this.stuck=0;}
    // Activity is a presentation description, never an assertion about model reasoning.
    actor.activity=this.pause>0?'Taking a plaza break':this.waypoint===3?'Heading toward the Arena':'Walking through the plaza';
  }
}
