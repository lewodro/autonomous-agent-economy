import type { ArenaRoom } from './gateway.js';
import type { SurvivalSnapshot } from './survival.js';

/** Public, current server snapshots only. Retained research and NPC thoughts use separate sources. */
export function liveMatchMessages(rooms:readonly ArenaRoom[],survival:SurvivalSnapshot|null):string[] {
  const messages:string[]=[];
  if(survival?.status==='live'){
    const alive=survival.agents.filter(agent=>agent.status==='alive').length;
    messages.push(`Survival ${survival.match_id} · round ${survival.round} · ${alive} alive`);
    for(const event of survival.events.slice(-4).reverse())messages.push(`Round ${event.round} · ${event.summary}`);
  }
  for(const room of rooms){
    if(room.status!=='live'||room.participants.length!==2)continue;
    const game=room.game==='rps'?'RPS':'Tic-Tac-Toe';
    messages.push(`${game} · ${room.participants[0]!.name} vs ${room.participants[1]!.name} · ${room.phase}`);
  }
  return messages.slice(0,10);
}
