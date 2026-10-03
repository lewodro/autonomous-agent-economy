import type {GameEvent} from './types.js';
export type AgentAnimation='thinking'|'working'|'guarding'|'acting'|'hit'|'eliminating'|'celebrating';
export type Effect='coins'|'hearts'|'impact'|'betrayal'|'confetti';
export type AnimationCommand=
 | {type:'agent';id:string;animation:AgentAnimation;duration:number}
 | {type:'move';id:string;target:string;duration:number}
 | {type:'particles';id:string;target?:string;effect:Effect;count:number;duration:number}
 | {type:'camera';strength:number;duration:number}
 | {type:'resource';id:string;amount:number;after:number;duration:number};
export interface Pose {dx:number;dy:number;scale:number;alpha:number;flash:number;animation?:AgentAnimation;moveTarget?:string;moveProgress?:number}
export interface Particle {id:string;target?:string;effect:Effect;progress:number;index:number;count:number}
export interface Popup {id:string;amount:number;progress:number}
export interface AnimationFrame {poses:Map<string,Pose>;particles:Particle[];popups:Popup[];camera:{x:number;y:number};active:number}
export interface AnimationDriver {
 playAgentAnimation(id:string,animation:AgentAnimation,duration?:number):void;
 playEffect(id:string,effect:Effect,target?:string):void;
 playTransition(id:string,animation:'eliminating'|'celebrating'):void;
 moveSprite(id:string,target:string):void;
 spawnParticles(id:string,effect:Effect,count:number,target?:string):void;
 shakeCamera(strength:number):void;
 animateResourceChange(id:string,amount:number,after:number):void;
 playElimination(id:string):void;
 playCelebration(id:string):void;
 tick(now:number,paused:boolean,speed:number):AnimationFrame;
 reset():void;
 setReducedMotion(value:boolean):void;
}
export function mapEvent(event:GameEvent):AnimationCommand[]{
 const id=event.actor,target=event.target||undefined;if(!id)return [];
 switch(event.type){
 case 'AgentThinking':return [{type:'agent',id,animation:'thinking',duration:900}];
 case 'ActionStarted':return [{type:'agent',id,animation:'acting',duration:300}];
 case 'WorkCompleted':return [{type:'agent',id,animation:'working',duration:550},{type:'particles',id,effect:'coins',count:8,duration:600}];
 case 'GuardRaised':return [{type:'agent',id,animation:'guarding',duration:550}];
 case 'ChallengeStarted':return target?[{type:'move',id,target,duration:450}]:[];
 case 'ChallengeResolved':return target&&(event.amount||0)>0?[{type:'agent',id:target,animation:'hit',duration:480},{type:'particles',id:target,effect:'impact',count:10,duration:500},{type:'camera',strength:3,duration:220}]:[];
 case 'CooperationOffered':case 'AllianceCreated':return [{type:'particles',id,target,effect:'hearts',count:6,duration:650}];
 case 'AllianceBroken':return [{type:'particles',id,target,effect:'betrayal',count:10,duration:700}];
 case 'ResourceChanged':return event.amount!=null&&event.after!=null?[{type:'resource',id,amount:event.amount,after:event.after,duration:750}]:[];
 case 'AgentEliminated':return [{type:'agent',id,animation:'eliminating',duration:850},{type:'particles',id,effect:'impact',count:12,duration:800}];
 case 'WinnerDeclared':return [{type:'agent',id,animation:'celebrating',duration:1400},{type:'particles',id,effect:'confetti',count:32,duration:1400}];
 default:return [];
 }
}
export function dispatchAnimation(driver:AnimationDriver,event:GameEvent){
 for(const c of mapEvent(event)){
  if(c.type==='agent')driver.playAgentAnimation(c.id,c.animation,c.duration);
  else if(c.type==='move')driver.moveSprite(c.id,c.target);
  else if(c.type==='particles')driver.spawnParticles(c.id,c.effect,c.count,c.target);
  else if(c.type==='camera')driver.shakeCamera(c.strength);
  else driver.animateResourceChange(c.id,c.amount,c.after);
 }
}
interface Track {command:AnimationCommand;elapsed:number}
/** Canvas-independent effect scheduler. A Pixi/Phaser driver can implement this same port. */
export class CanvasAnimationDriver implements AnimationDriver {
 private tracks:Track[]=[];private previous:number|null=null;private reduced=false;
 private add(command:AnimationCommand){this.tracks.push({command,elapsed:0});if(this.tracks.length>96)this.tracks.shift();}
 playAgentAnimation(id:string,animation:AgentAnimation,duration=600){this.add({type:'agent',id,animation,duration});}
 playEffect(id:string,effect:Effect,target?:string){this.spawnParticles(id,effect,8,target);}
 playTransition(id:string,animation:'eliminating'|'celebrating'){this.playAgentAnimation(id,animation,900);}
 moveSprite(id:string,target:string){this.add({type:'move',id,target,duration:450});}
 spawnParticles(id:string,effect:Effect,count:number,target?:string){this.add({type:'particles',id,target,effect,count:Math.min(32,count),duration:effect==='confetti'?1400:700});}
 shakeCamera(strength:number){this.add({type:'camera',strength:Math.min(4,strength),duration:220});}
 animateResourceChange(id:string,amount:number,after:number){this.add({type:'resource',id,amount,after,duration:750});}
 playElimination(id:string){this.playTransition(id,'eliminating');this.playEffect(id,'impact');}
 playCelebration(id:string){this.playTransition(id,'celebrating');this.spawnParticles(id,'confetti',32);}
 reset(){this.tracks=[];this.previous=null;}
 setReducedMotion(value:boolean){this.reduced=value;}
 tick(now:number,paused:boolean,speed:number):AnimationFrame{
  const delta=this.previous===null?0:Math.min(50,Math.max(0,now-this.previous));this.previous=now;
  const frame:AnimationFrame={poses:new Map(),particles:[],popups:[],camera:{x:0,y:0},active:0};
  for(const track of this.tracks){if(!paused)track.elapsed+=delta*speed;const c=track.command,t=Math.min(1,track.elapsed/c.duration);
   if(c.type==='camera'){if(!this.reduced){frame.camera.x=Math.sin(t*45)*c.strength*(1-t);frame.camera.y=Math.cos(t*37)*c.strength*(1-t);}continue;}
   const pose=frame.poses.get(c.id)||{dx:0,dy:0,scale:1,alpha:1,flash:0};
   if(c.type==='agent'){pose.animation=c.animation;
    if(!this.reduced){if(c.animation==='hit'){pose.dx=Math.sin(t*38)*5*(1-t);pose.flash=1-t;}if(c.animation==='working'||c.animation==='celebrating')pose.dy=-Math.abs(Math.sin(t*Math.PI*3))*7;if(c.animation==='eliminating'){pose.alpha=1-t*.8;pose.dy=t*16;pose.scale=1-t*.3;}}
   }else if(c.type==='move'&&!this.reduced){pose.moveTarget=c.target;pose.moveProgress=Math.sin(t*Math.PI)*.22;}
   else if(c.type==='particles'&&!this.reduced){for(let i=0;i<c.count&&frame.particles.length<160;i++)frame.particles.push({id:c.id,target:c.target,effect:c.effect,index:i,count:c.count,progress:t});}
   else if(c.type==='resource'&&c.amount){frame.popups.push({id:c.id,amount:c.amount,progress:this.reduced?0:t});}
   frame.poses.set(c.id,pose);
  }
  this.tracks=this.tracks.filter(t=>t.elapsed<t.command.duration);frame.active=this.tracks.length;return frame;
 }
}
