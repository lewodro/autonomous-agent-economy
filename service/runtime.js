import {InferenceBudget} from './model-adapter.js';
import {decisionsFor} from './adapters.js';
/** One authoritative transition at a time. Budgets live outside prompts/replays. */
export class MatchRuntime {
  constructor(){this.busy=new Set();this.budgets=new Map();}
  budget(session){if(!this.budgets.has(session))this.budgets.set(session,new InferenceBudget());return this.budgets.get(session);}
  async step(core,session,data){
    if(this.busy.has(session))throw Object.assign(new Error('A turn is already resolving'),{status:409});
    this.busy.add(session);
    try{
      const current=await core.request({command:'get',session});
      const expected=data.expected_turn??current.replay.final_state.turn;
      if(expected!==current.replay.final_state.turn)throw Object.assign(new Error('Stale turn; fetch authoritative match state'),{status:409});
      let decisions=data.decisions||null;
      if(!decisions){
        const info=await core.request({command:'observe',session});if(info.ended)throw new Error('Match already ended');
        const adapted=await decisionsFor(info.config,info.observation,this.budget(session));
        if(adapted){const defaults=await core.request({command:'decide',session});decisions=adapted.map((d,i)=>d||defaults.decisions[i]);}
      }
      return await core.request({command:'step',session,decisions,expected_turn:expected});
    }finally{this.busy.delete(session);}
  }
}
