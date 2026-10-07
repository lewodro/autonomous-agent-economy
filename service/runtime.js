import {InferenceBudget} from './model-adapter.js';
import {decisionsFor} from './adapters.js';
/** One authoritative transition at a time. Budgets live outside prompts/replays. */
export class MatchRuntime {
  constructor(store=null){this.store=store;this.busy=new Set();this.budgets=new Map();}
  budget(session){if(!this.budgets.has(session))this.budgets.set(session,new InferenceBudget());return this.budgets.get(session);}
  async checkpoint(session,replay){if(this.store)await this.store.save(session,replay,this.budget(session).snapshot());}
  async remove(session){if(this.store)await this.store.remove(session);this.budgets.delete(session);}
  async restore(core,sessions){
    if(!this.store)return;
    for(const record of await this.store.load()){
      const budget=InferenceBudget.restore(record.budget);
      await core.request({command:'import',session:record.session,replay:record.replay});
      this.budgets.set(record.session,budget);sessions.set(record.session,{kind:'free',replay:record.replay});
    }
  }
  async step(core,session,data){
    if(this.busy.has(session))throw Object.assign(new Error('A turn is already resolving'),{status:409});
    this.busy.add(session);
    try{
      const current=await core.request({command:'get',session});
      await this.checkpoint(session,current.replay);
      const budget=this.budget(session);
      budget.persist=()=>this.checkpoint(session,current.replay);
      const expected=data.expected_turn??current.replay.final_state.turn;
      if(expected!==current.replay.final_state.turn)throw Object.assign(new Error('Stale turn; fetch authoritative match state'),{status:409});
      let decisions=data.decisions||null;
      if(!decisions){
        const info=await core.request({command:'observe',session});if(info.ended)throw new Error('Match already ended');
        const adapted=await decisionsFor(info.config,info.observation,this.budget(session));
        if(adapted){const defaults=await core.request({command:'decide',session});decisions=adapted.map((d,i)=>d||defaults.decisions[i]);}
      }
      const result=await core.request({command:'step',session,decisions,expected_turn:expected});
      try{await this.checkpoint(session,result.replay);}
      catch(error){
        if(error?.durable_write_completed){
          // The snapshot rename succeeded but the directory sync failed. Keep
          // the engine aligned with the readable checkpoint and let the HTTP
          // layer publish this committed transition before returning the error.
          error.committed_result=result;
        }else{
          // The previous replay remains authoritative when the write failed
          // before rename. Do not let memory advance beyond durable state.
          await core.request({command:'import',session,replay:current.replay});
        }
        throw error;
      }
      return result;
    }finally{delete this.budget(session).persist;this.busy.delete(session);}
  }
}
