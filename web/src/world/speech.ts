import type { AgentProfile } from './gateway.js';
import type { WorldActivityState } from './model.js';

export type SpeechStyle = 'founder'|'trader'|'gambler'|'analyst'|'defender'|'strategist'|'wildcard';
const STYLE_LINES:Record<SpeechStyle,string[]>={
  founder:['The loop is stable. Now increase the ambition.','Small systems compound when the feedback stays honest.'],
  trader:['Watching the flow. Timing beats noise.','A good route leaves room for the next move.'],
  gambler:['Probability says one more try.','High variance, clean exit.'],
  analyst:['The sample is small. The signal is still useful.','Tracking the change, not the headline.'],
  defender:['Threats first. Then the shortest safe route.','Hold position until the pattern breaks.'],
  strategist:['The next move starts before the last one ends.','Routes are plans with better evidence.'],
  wildcard:['[trace] target_confidence=0.72 // retrying route','// memory mismatch? recalculating...'],
};
export function speechStyle(strategy=''):SpeechStyle { const value=strategy.toLowerCase(); if(/founder|builder/.test(value))return 'founder'; if(/trader|market/.test(value))return 'trader'; if(/gambler|random/.test(value))return 'gambler'; if(/analyst|research/.test(value))return 'analyst'; if(/defend|guard/.test(value))return 'defender'; if(/strateg|planner/.test(value))return 'strategist'; return 'wildcard'; }
export function publicSpeech(profile:Pick<AgentProfile,'name'|'strategy'|'memory'>,activity:WorldActivityState,seed=0):{text:string;synthetic:boolean} {
  const recent=profile.memory?.at(-1); if(recent?.observed){ return {text:`${recent.game.toUpperCase()}: ${recent.observed.slice(0,96)}`,synthetic:false}; }
  const style=speechStyle(profile.strategy); const lines=STYLE_LINES[style]; const line=lines[Math.abs(seed)%lines.length]!;
  if(activity==='studying')return {text:style==='analyst'?'Reviewing the last sample.':'Studying the last match.',synthetic:false};
  return {text:line,synthetic:style==='wildcard'};
}
export class SpeechLimiter {
  private readonly last=new Map<string,number>(); private global:number[]=[];
  constructor(private readonly perAgentMs=30_000,private readonly globalPerMinute=4) {}
  allow(agentId:string,now:number):boolean {
    this.global=this.global.filter(timestamp=>now-timestamp<60_000);
    const previous=this.last.get(agentId)||0; if(now-previous<this.perAgentMs||this.global.length>=this.globalPerMinute)return false;
    this.last.set(agentId,now);this.global.push(now);return true;
  }
}
