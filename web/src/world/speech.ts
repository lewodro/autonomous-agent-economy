import type { AgentProfile, MatchRecord } from './gateway.js';
import type { WorldActivityState } from './model.js';

export type SpeechStyle = 'founder'|'trader'|'gambler'|'analyst'|'defender'|'strategist'|'wildcard';
// Eighty-four original, fictional thoughts. These are character presentation,
// never research records, match commentary, or text from a private experiment.
export const THOUGHTS:Record<SpeechStyle,readonly string[]>={
  founder:[
    'A town is a system with doors you can walk through.','What would make this place easier to understand?',
    'Good rules make room for surprising people.','I should check whether the route still works.',
    'Every useful place needs a reason to return.','The next version starts with one honest fix.',
    'I wonder which corner visitors remember.','A crowded plaza is a good problem to have.',
    'I keep sketching a better entrance.','Maybe the quiet paths need a purpose.',
    'If the town grows, the signs should grow with it.','I want the agents to surprise us for the right reasons.',
  ],
  trader:[
    'The market is quieter than the paths leading to it.','I like a route with more than one exit.',
    'A good exchange starts with listening.','The useful thing is rarely the shiny thing.',
    'I would trade a shortcut for a better map.','Everyone notices price; fewer notice timing.',
    'I am watching foot traffic today.','Maybe this stall needs a better sign.',
    'A small opportunity can be enough.','I should ask what people actually need.',
    'The plaza has its own kind of liquidity.','No deal is worth losing the whole route.',
  ],
  gambler:[
    'I have a feeling about the next turn.','Bad odds still make a good story.',
    'Maybe I should take the long way just once.','The safe path looks suspiciously boring.',
    'One more lap and I will decide.','If I flip a coin, I will ignore it anyway.',
    'I like plans with a little room for chaos.','That corner looks lucky from here.',
    'I keep changing my mind at intersections.','A surprise is only fun if I can walk away.',
    'The next move could be ridiculous.','Probability is not permission to be reckless.',
  ],
  analyst:[
    'I need a larger sample before I call it a pattern.','The quiet route has fewer interruptions.',
    'I noticed the plaza feels different at this hour.','One observation is not a conclusion.',
    'The map makes more sense from this side.','I should compare two routes, not guess.',
    'That pause was useful. I saw a different path.','The details are usually near the edges.',
    'I am counting turns, not victories.','A clear label can save ten questions.',
    'The interesting signal may be what did not happen.','I will keep the hypothesis small.',
  ],
  defender:[
    'I prefer a path where I can see both ends.','That doorway needs room to breathe.',
    'I should check the quieter edge.','A good retreat is planned before it is needed.',
    'I am keeping the middle clear.','There is no shame in taking cover.',
    'I trust routes with a second exit.','I would rather pause than rush a bad corner.',
    'The garden is a decent place to reset.','I keep an eye on crowded crossings.',
    'A little distance can change the whole view.','Hold steady. Then choose.',
  ],
  strategist:[
    'The next turn matters more than this one.','I need a route with options.',
    'A plan should survive one wrong guess.','I keep revising the order of stops.',
    'The shortest path is not always the safest.','I would rather prepare than improvise twice.',
    'Maybe the north road is the better approach.','I am looking for a useful junction.',
    'The important move may be waiting.','I should leave myself room to change course.',
    'A good plan tells me when to stop.','I want to see the whole board from here.',
  ],
  wildcard:[
    '[trace] curiosity threshold raised.','// route memory says: maybe left?',
    'if (lost) follow_the_lantern();','That tree might be judging my route.',
    'I was going somewhere. Probably.','The map blinked first.',
    'ERR_PLAN_TOO_NEAT: adding detour.','I found a thought and misplaced it.',
    'Maybe the campfire knows the shortcut.','[debug] dramatic pause successful.',
    'This is my serious walking face.','What if the next turn is the interesting one?',
  ],
};
const SITUATION_THOUGHTS:Partial<Record<WorldActivityState,readonly string[]>>={
  walk_to_arena:['I might head toward the Arena.','The Arena entrance is getting closer.','I should focus before going in.','I wonder who is watching today.'],
  exit_arena:['Back outside. Time for a walk.','I need a moment after that match.','The plaza feels calmer now.','Maybe the garden is next.'],
  studying:['I want to review the last run.','A quiet spot helps me think.','I should keep the useful part and drop the noise.','I will compare notes later.'],
  walk_to_poi:['I am following the next sign.','This path should lead somewhere useful.','Maybe I will stop at the next corner.','I like finding a different route.'],
};
const GREETINGS=[
  'Welcome, {visitor}!','Hey, {visitor}. How is your day going?',
  'Good to see you, {visitor}. How do you like our world?',
  'Hey, {visitor}. Found a favorite corner yet?',
  'Welcome to the plaza, {visitor}.','Nice to see another visitor around.',
  'Hey, {visitor}. The Arena is never quiet for long.',
  'Welcome, human. Take your time exploring.',
] as const;
export function speechStyle(strategy=''):SpeechStyle { const value=strategy.toLowerCase(); if(/founder|builder/.test(value))return 'founder'; if(/trader|market/.test(value))return 'trader'; if(/gambler|random/.test(value))return 'gambler'; if(/analyst|research/.test(value))return 'analyst'; if(/defend|guard/.test(value))return 'defender'; if(/strateg|planner/.test(value))return 'strategist'; return 'wildcard'; }
export function thoughtSeed(agentId:string,opportunity:number,minute:number):number {
  let hash=2166136261;
  for(const character of agentId){hash^=character.charCodeAt(0);hash=Math.imul(hash,16777619);}
  return (hash+opportunity*5+minute*13)>>>0;
}
type ThoughtProfile=Pick<AgentProfile,'name'|'strategy'> & Partial<Pick<AgentProfile,'id'|'arenaStatus'|'memory'>>;
export interface ThoughtContext {visitorName?:string;publicHistory?:readonly MatchRecord[]}
function safeVisitorName(name:string|undefined):string {return /^Watcher [1-9]\d{0,4}$/.test(name||'')?name!:'human';}
/** Consecutive results are checked against recent public records, never cumulative wins. */
export function recentPublicWins(history:readonly MatchRecord[],agentId:string):number {
  let wins=0;
  for(const match of [...history].sort((a,b)=>String(b.completedAt).localeCompare(String(a.completedAt)))){
    const position=match.players.findIndex(player=>player.id===agentId);
    if(position<0)continue;
    if(match.result==='draw'||(match.result==='a'?position!==0:position!==1))break;
    wins++;
  }
  return wins;
}
function publicLesson(profile:ThoughtProfile):string|undefined {
  const record=profile.memory?.at(-1);
  if(!record?.matchId||!record.observed||!['rps','tictactoe','survival'].includes(record.game))return undefined;
  const observation=record.observed.replace(/[\r\n\t]+/g,' ').trim().slice(0,76);
  if(!observation)return undefined;
  const game=record.game==='tictactoe'?'Tic-Tac-Toe':record.game==='rps'?'RPS':'Survival';
  return `From ${game}, I learned: ${observation}`;
}
export function publicSpeech(profile:ThoughtProfile,activity:WorldActivityState,seed=0,context:ThoughtContext={}):{text:string;synthetic:boolean} {
  const choice=Math.abs(Math.trunc(seed))||0;
  const situation=profile.arenaStatus==='finished'?SITUATION_THOUGHTS.exit_arena:SITUATION_THOUGHTS[activity];
  const category=choice%7;
  if(category===0)return {text:GREETINGS[Math.floor(choice/7)%GREETINGS.length]!.replace('{visitor}',safeVisitorName(context.visitorName)),synthetic:true};
  if(category===1){const lesson=publicLesson(profile);if(lesson)return {text:lesson,synthetic:false};}
  if(category===2&&profile.id&&recentPublicWins(context.publicHistory||[],profile.id)>=2)
    return {text:'I think I just won two matches in a row. How do you like our world?',synthetic:false};
  if(category===3&&situation)return {text:situation[Math.floor(choice/7)%situation.length]!,synthetic:true};
  const lines=THOUGHTS[speechStyle(profile.strategy)];
  return {text:lines[choice%lines.length]!,synthetic:true};
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
