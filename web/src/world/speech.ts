import type { AgentProfile } from './gateway.js';
import type { WorldActivityState } from './model.js';

export type SpeechStyle = 'founder'|'trader'|'gambler'|'analyst'|'defender'|'strategist'|'wildcard';
const STYLE_LINES:Record<SpeechStyle,string[]>={
  founder:['The loop is stable. Now increase the ambition.','Small systems compound when the feedback stays honest.','The town needs another useful route.','One more run, then improve the system.'],
  trader:['Watching the flow. Timing beats noise.','A good route leaves room for the next move.','The market is quiet; the signal is not.','Value moves before the crowd notices.'],
  gambler:['Probability says one more try.','High variance, clean exit.','Bad odds can still teach a good lesson.','Might head back to the Arena.'],
  analyst:['The sample is small. The signal is still useful.','Tracking the change, not the headline.','The same opening keeps appearing.','Need another run before I trust the pattern.'],
  defender:['Threats first. Then the shortest safe route.','Hold position until the pattern breaks.','I think I am retreating too late.','Open ground is useful until it is not.'],
  strategist:['The next move starts before the last one ends.','Routes are plans with better evidence.','Need another run to test the adjustment.','The Arena entrance changes every plan.'],
  wildcard:['[trace] aggression threshold revised.','// route memory corrupted?','if (cornered_again) reconsider();','TARGET_CONFIDENCE: 0.61'],
};
export function speechStyle(strategy=''):SpeechStyle { const value=strategy.toLowerCase(); if(/founder|builder/.test(value))return 'founder'; if(/trader|market/.test(value))return 'trader'; if(/gambler|random/.test(value))return 'gambler'; if(/analyst|research/.test(value))return 'analyst'; if(/defend|guard/.test(value))return 'defender'; if(/strateg|planner/.test(value))return 'strategist'; return 'wildcard'; }
type PublicSpeechProfile=Pick<AgentProfile,'name'|'strategy'|'memory'|'survival'>;
function compact(value:string):string { return value.replace(/\s+/g,' ').trim().slice(0,110); }
export function publicSpeech(profile:PublicSpeechProfile,activity:WorldActivityState,seed=0):{text:string;synthetic:boolean} {
  const survival=profile.survival?.latest_research;if(survival)return {text:compact(survival),synthetic:false};
  const recent=profile.memory?.at(-1); if(recent?.observed){ return {text:`${recent.game.toUpperCase()}: ${compact(recent.observed)}`,synthetic:false}; }
  const style=speechStyle(profile.strategy); const lines=STYLE_LINES[style]; const line=lines[Math.abs(seed)%lines.length]!;
  if(activity==='studying')return {text:style==='analyst'?'Reviewing the last sample.':'Studying the last match.',synthetic:false};
  if(activity==='walk_to_arena')return {text:style==='defender'?'Checking the safest Arena route.':'Might head back to the Arena.',synthetic:false};
  return {text:line,synthetic:style==='wildcard'};
}
export class SpeechLimiter {
  private readonly last=new Map<string,number>(); private global:number[]=[];
  constructor(private readonly perAgentMs=60_000,private readonly globalPerMinute=3) {}
  allow(agentId:string,now:number):boolean {
    this.global=this.global.filter(timestamp=>now-timestamp<60_000);
    const previous=this.last.get(agentId)||0; if(now-previous<this.perAgentMs||this.global.length>=this.globalPerMinute)return false;
    this.last.set(agentId,now);this.global.push(now);return true;
  }
}
