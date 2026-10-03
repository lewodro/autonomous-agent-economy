import {api,ApiError} from './api.js';
import type {Replay,GameEvent,State,Statistics} from './types.js';
export interface Transition {events:GameEvent[];match_id:string;final_state:State;winner:string|null;statistics:Statistics[]}
export function mergeTransition(current:Replay,next:Transition):Replay {
 if(next.events.length>500||next.events.some((e,i)=>e.seq!==current.events.length+i))throw new Error('Out-of-order or oversized transition');
 return {...current,match_id:next.match_id,final_state:next.final_state,winner:next.winner,statistics:next.statistics,events:[...current.events,...next.events]};
}
export interface MatchTransport {advance(session:string,current:Replay):Promise<Replay>}
export class HttpMatchTransport implements MatchTransport {
 async advance(session:string,current:Replay):Promise<Replay>{
  let next:Transition;
  try{next=await api<Transition>(`/api/matches/${session}/step`,{compact:true,expected_turn:current.final_state.turn});}
  catch(error){if(!(error instanceof ApiError)||error.status!==409||!error.message.includes('Stale'))throw error;return (await api<{replay:Replay}>(`/api/matches/${session}`)).replay;}
  return mergeTransition(current,next);
 }
}
