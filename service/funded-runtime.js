import {economyLog} from './economy-log.js';
import {randomUUID} from 'node:crypto';
const State=Object.freeze({Funding:'funding',Funded:'funded',Running:'running',SettlementPending:'settlement_pending',RefundPending:'refund_pending'});
/** Admission is Rust-owned. This host schedules turns and publishes verified public projections. */
export class FundedRuntime {
 constructor(core,runtime,events,sessions,{ensureCapacity=null}={}){this.core=core;this.runtime=runtime;this.events=events;this.sessions=sessions;this.ensureCapacity=ensureCapacity;this.matches=new Map();this.busy=new Set();this.running=false;this.cursor=0;this.logged=new Map();}
 remember(result){const session=result.session||result.economy?.session;if(session&&result.economy)this.matches.set(session,{...result,nextAttempt:0});return result;}
 publish(result){
  this.remember(result);const session=result.session||result.economy?.session;
  let last=this.logged.get(session)??-1;
  for(const event of result.economy?.events??[])if(event.seq>last){
   economyLog(event.type,{session,match_id:event.match_id,operation_id:event.receipt_id,payment_mode:event.projection.payment_mode,seq:event.seq});last=event.seq;
  }
  this.logged.set(session,last);this.events.publishEconomy?.(session,result.economy);return result;
 }
 async restore(){const {sessions}=await this.core.request({command:'funded-host',action:'list'});for(const session of sessions){this.sessions.set(session,true);this.remember(await this.command(session,'get'));}}
 async command(session,action,extra={}){return this.core.request({command:'funded-host',session,action,...extra});}
 async register(session){try{const result=await this.command(session,'get');this.sessions.set(session,true);this.remember(result);return true;}catch{return false;}}
 async create(config,data){
  await this.ensureCapacity?.();
  if(this.sessions.size>=100)throw Object.assign(Error('Local session limit reached'),{status:429});
  const terminal=new Set(['settled','refunded','failed']);
  const active=[...this.matches.values()].filter(value=>!terminal.has(value.economy.economy.state)).length;
  if(active>=20)throw Object.assign(Error('Active funded match limit reached'),{status:429});
  const session=randomUUID();this.sessions.set(session,true);let createdResult=null;
  try{
   const mode=data.mode??'mock';
   const result=createdResult=await this.core.request({command:'funded-host',action:'create',session,config:{simulation:config,economy:{enabled:true,mode,entry_amount_sol:data.entry_amount_sol??'0.02',starting_balance_sol:'1',maximum_entry_sol:'0.05',minimum_reserve_sol:mode==='devnet'?'0':'0.005'},fees:data.fees||{winner_share_bps:10000,house_fee_bps:0},funding_timeout_seconds:data.funding_timeout_seconds??600}});
   await this.runtime.checkpoint(session,result.replay);return this.publish(result);
  }catch(error){
   try{
    const discarded=await this.core.request({command:'funded-host',action:'discard-unfunded',session});
    if(discarded.removed===true||discarded.removed===false){await this.runtime.remove(session);this.sessions.delete(session);}
    else throw Object.assign(new Error('Cleanup did not confirm host removal'),{code:'cleanup_unconfirmed'});
   }catch(cleanupError){
    let recoverable=createdResult;
    if(!recoverable){try{recoverable=await this.core.request({command:'funded-host',action:'get',session});}catch{}}
    if(recoverable)this.remember({...recoverable,session});
    economyLog('funded_match_create_cleanup_failed',{session,code:cleanupError.code||'cleanup_failed'});
   }
   throw error;
  }
 }
 async act(session,action,data={}){
  if(!this.matches.has(session))throw Object.assign(Error('Funded session not found'),{status:404});
  if(this.busy.has(session)||this.runtime.busy.has(session))throw Object.assign(Error('Match operation already resolving'),{status:409});
  this.busy.add(session);
  const known=this.matches.get(session);known.failures=0;known.nextAttempt=0;
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
 start(){if(this.timer||process.env.FUNDED_AUTO_RUN==='0')return;this.timer=setInterval(()=>{if(!this.activeTick)this.activeTick=this.tick().then(()=>{this.activeTick=null;},()=>{this.activeTick=null;});},250);this.timer.unref();}
 async tick(){
  if(this.running||!this.matches.size)return;this.running=true;let active=null;
  try{
   const entries=[...this.matches.entries()];const [session,known]=entries[this.cursor++%entries.length];
   if(this.busy.has(session)||this.runtime.busy.has(session)||(known.failures||0)>=8||Date.now()<(known.nextAttempt||0))return;
   active=[session,known];this.busy.add(session);
   const state=known.economy.economy.state;let result;
   if([State.Funding,State.Funded].includes(state)&&Date.now()/1000>=known.economy.funding_deadline)result=await this.command(session,'expire');
   else if(state===State.Funded)result=await this.command(session,'reconcile');
   else if(state===State.Running&&!known.replay.final_state.ended){result=await this.runtime.step(this.core,session,{expected_turn:known.replay.final_state.turn});this.events.publish(session,result);}
   else if(state===State.SettlementPending||(state===State.Running&&known.replay.final_state.ended))result=await this.command(session,'settle');
   else if(state===State.RefundPending)result=await this.command(session,'expire');
   if(result)this.publish({...result,session});
  }catch(error){
   if(active){const [session,known]=active;const failures=(known.failures||0)+1,nextAttempt=Date.now()+Math.min(60000,2000*2**(failures-1));Object.assign(known,{failures,nextAttempt,lastError:error.message});economyLog('reconciliation_retry',{session,payment_mode:known.economy.economy.payment_mode,code:error.code||'operation_failed'});try{const current=await this.command(session,'get');this.publish(current);Object.assign(this.matches.get(session),{failures,nextAttempt,lastError:error.message});}catch{}}
  }finally{if(active)this.busy.delete(active[0]);this.running=false;}
 }
 health(){
  const rows=[...this.matches.values()];
  const health={matches:rows.length,pending_intents:0,pending_receipts:0,pending_settlements:0,pending_refunds:0,modes:[...new Set(rows.map(r=>r.economy.economy.payment_mode))],mainnet_enabled:false,rpc_status:rows.length?'ready':'not_observed',storage_status:rows.length?'opened':'not_observed'};
  health.automatic_retry_limit=8;health.automatic_retries_exhausted=rows.filter(r=>(r.failures||0)>=8).length;
  for(const row of rows){const observed=row.economy.health;
   for(const key of ['pending_intents','pending_receipts','pending_settlements','pending_refunds'])health[key]+=observed?.[key]??0;
   if(observed?.rpc_ready===false)health.rpc_status='unavailable';
   if(observed?.storage_ready===false)health.storage_status='unavailable';
  }
  return health;
 }
 async close(){clearInterval(this.timer);this.timer=null;await this.activeTick;}
}
