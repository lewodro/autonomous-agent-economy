import {randomUUID} from 'node:crypto';
/** Admission is Rust-owned. This host schedules turns and publishes verified public projections. */
export class FundedRuntime {
 constructor(core,runtime,events,sessions){this.core=core;this.runtime=runtime;this.events=events;this.sessions=sessions;this.matches=new Map();this.busy=new Set();this.running=false;this.cursor=0;}
 remember(result){const session=result.session||result.economy?.session;if(session&&result.economy)this.matches.set(session,{...result,nextAttempt:0});return result;}
 publish(result){this.remember(result);this.events.publishEconomy?.(result.session||result.economy?.session,result.economy);return result;}
 async restore(){const {sessions}=await this.core.request({command:'funded-host',action:'list'});for(const session of sessions){this.sessions.set(session,true);this.remember(await this.command(session,'get'));}}
 async command(session,action,extra={}){return this.core.request({command:'funded-host',session,action,...extra});}
 async register(session){try{const result=await this.command(session,'get');this.sessions.set(session,true);this.remember(result);return true;}catch{return false;}}
 async create(config,data){
  if(this.sessions.size>=100)throw Object.assign(Error('Local session limit reached'),{status:429});
  const session=randomUUID();this.sessions.set(session,true);
  try{
   const result=await this.core.request({command:'funded-host',action:'create',session,config:{simulation:config,economy:{enabled:true,mode:data.mode||'mock',entry_amount_sol:data.entry_amount_sol||'0.02',starting_balance_sol:'1',maximum_entry_sol:'0.05',minimum_reserve_sol:'0.005'},fees:data.fees||{winner_share_bps:10000,house_fee_bps:0},funding_timeout_seconds:data.funding_timeout_seconds??600}});
   await this.runtime.checkpoint(session,result.replay);return this.publish(result);
  }catch(error){this.sessions.delete(session);throw error;}
 }
 async act(session,action,data={}){
  if(!this.matches.has(session))throw Object.assign(Error('Funded session not found'),{status:404});
  if(this.busy.has(session)||this.runtime.busy.has(session))throw Object.assign(Error('Match operation already resolving'),{status:409});
  this.busy.add(session);
  try{
   const fund=async id=>{
    const current=await this.command(session,'get');
    if(current.economy.economy.funded_agents.includes(id))return current;
    this.publish(await this.command(session,'prepare',{agent_id:id}));
    return this.publish(await this.command(session,'fund',{agent_id:id}));
   };
   let result;
   if(action==='fund')result=await fund(data.agent_id);
   else if(action==='fund-all'){const current=await this.command(session,'get');for(const id of current.economy.economy.required_agents)result=await fund(id);}
   else result=await this.command(session,action);
   await this.runtime.checkpoint(session,result.replay);return this.publish(result);
  }finally{this.busy.delete(session);}
 }
 start(){if(this.timer||process.env.FUNDED_AUTO_RUN==='0')return;this.timer=setInterval(()=>{void this.tick();},250);this.timer.unref();}
 async tick(){
  if(this.running||!this.matches.size)return;this.running=true;
  try{
   const entries=[...this.matches.entries()];const [session,known]=entries[this.cursor++%entries.length];
   if(this.busy.has(session)||this.runtime.busy.has(session)||Date.now()<(known.nextAttempt||0))return;
   const state=known.economy.economy.state;let result;
   if(state==='funding'&&Date.now()/1000>=known.economy.funding_deadline)result=await this.command(session,'expire');
   else if(state==='running'&&!known.replay.final_state.ended){result=await this.runtime.step(this.core,session,{expected_turn:known.replay.final_state.turn});this.events.publish(session,result);}
   else if(state==='settlement_pending'||(state==='running'&&known.replay.final_state.ended))result=await this.command(session,'settle');
   else if(state==='refund_pending')result=await this.command(session,'expire');
   if(result)this.publish({...result,session});
  }catch(error){
   const entries=[...this.matches.entries()];const row=entries[(this.cursor-1)%entries.length];
   if(row){const [session,known]=row;known.nextAttempt=Date.now()+5000;known.lastError=error.message;try{const current=await this.command(session,'get');this.publish(current);this.matches.get(session).nextAttempt=Date.now()+5000;}catch{}}
  }finally{this.running=false;}
 }
 health(){return {matches:this.matches.size,pending_settlements:[...this.matches.values()].filter(r=>r.economy.economy.state==='settlement_pending').length,pending_refunds:[...this.matches.values()].filter(r=>r.economy.economy.state==='refund_pending').length,modes:[...new Set([...this.matches.values()].map(r=>r.economy.economy.payment_mode))]};}
 close(){clearInterval(this.timer);}
}
