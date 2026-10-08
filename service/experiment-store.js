import {mkdir,open,rename,readdir,readFile,lstat,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {withStorageFailure} from './http-error.js';

const identifier=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const maximumRecords=100;
const maximumMetadataBytes=64*1024;

function boundedInteger(value,fallback,min,max,label){
  if(value===undefined)return fallback;
  const parsed=Number(value);
  if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)throw new Error(`${label} must be an integer from ${min} to ${max}`);
  return parsed;
}
export function experimentLimits(env=process.env){return {
  maxMatches:boundedInteger(env.EXPERIMENT_MAX_MATCHES,8,1,20,'EXPERIMENT_MAX_MATCHES'),
  retentionDays:boundedInteger(env.EXPERIMENT_RETENTION_DAYS,30,1,365,'EXPERIMENT_RETENTION_DAYS'),
  exportMaxBytes:boundedInteger(env.EVENT_LOG_MAX_SIZE,32_000_000,1_000_000,32_000_000,'EVENT_LOG_MAX_SIZE')
};}

/** Bounded owner metadata around the existing Rust-verifiable session checkpoints. */
export class ExperimentStore {
  constructor(directory,sessionStore,limits=experimentLimits()){
    this.directory=directory;this.sessionStore=sessionStore;this.limits=limits;this.records=new Map();this.pending=new Map();
  }
  file(id){if(!identifier.test(id))throw Object.assign(new Error('Invalid experiment ID'),{status:404});return path.join(this.directory,`${id}.json`);}
  async restore(now=Date.now()){
    await mkdir(this.directory,{recursive:true});
    const names=(await readdir(this.directory)).filter(name=>name.endsWith('.json')).sort();
    if(names.length>maximumRecords)throw new Error('Stored experiment metadata limit exceeded');
    for(const name of names){
      const id=name.slice(0,-5),file=this.file(id),info=await lstat(file);
      if(!info.isFile()||info.size>maximumMetadataBytes)throw new Error(`Invalid experiment metadata: ${name}`);
      const record=JSON.parse(await readFile(file,'utf8'));
      if(record.format!==1||record.experiment_id!==id||!identifier.test(record.owner_session_id||'')||!['active','completed'].includes(record.status)||record.game_mode!=='last-seat'||!Number.isSafeInteger(record.seed)||!record.configuration||!Number.isFinite(Date.parse(record.created_at))||!Number.isFinite(Date.parse(record.updated_at)))throw new Error(`Invalid experiment metadata: ${name}`);
      this.records.set(id,record);
    }
    await this.prune(now);
  }
  async prune(now=Date.now()){
    const cutoff=now-this.limits.retentionDays*86_400_000;
    const removed=[];
    for(const [id,record] of this.records){
      if(record.status!=='completed'||Date.parse(record.updated_at)>=cutoff)continue;
      await this.sessionStore.delete(id);
      await unlink(this.file(id));this.records.delete(id);removed.push(id);
    }
    return removed;
  }
  async delete(id,owner){
    this.get(id,owner);
    await this.sessionStore.delete(id);
    await unlink(this.file(id));
    this.records.delete(id);
  }
  count(owner){return [...this.records.values()].filter(record=>record.owner_session_id===owner).length;}
  list(owner){return [...this.records.values()].filter(record=>record.owner_session_id===owner).sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(record=>this.summary(record));}
  summary(record){const {experiment_id,created_at,updated_at,game_mode,status,seed,configuration,match_id}=record;return {experiment_id,created_at,updated_at,game_mode,status,seed,configuration,match_id};}
  get(id,owner){const record=identifier.test(id)?this.records.get(id):undefined;if(!record||record.owner_session_id!==owner)throw Object.assign(new Error('Experiment not found'),{status:404});return record;}
  checkCapacity(owner){
    if(this.count(owner)>=this.limits.maxMatches)throw Object.assign(new Error('This browser has reached its retained experiment limit'),{status:429});
    if(this.records.size>=maximumRecords)throw Object.assign(new Error('The experiment service is at capacity'),{status:429});
  }
  async save(record){
    const target=this.file(record.experiment_id),bytes=JSON.stringify(record);
    if(Buffer.byteLength(bytes)>maximumMetadataBytes)throw new Error('Experiment metadata exceeds its storage limit');
    const prior=this.pending.get(record.experiment_id)||Promise.resolve();
    const writing=prior.catch(()=>{}).then(()=>withStorageFailure('experiment metadata',async()=>{
      await mkdir(this.directory,{recursive:true});
      const temp=`${target}.${randomUUID()}.tmp`;
      try{const file=await open(temp,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}await rename(temp,target);}
      finally{await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    }));
    this.pending.set(record.experiment_id,writing);
    try{await writing;this.records.set(record.experiment_id,record);}finally{if(this.pending.get(record.experiment_id)===writing)this.pending.delete(record.experiment_id);}
    return record;
  }
  async create(id,owner,replay,now=Date.now()){
    this.checkCapacity(owner);
    const configuration={max_turns:replay.config.max_turns,agents:replay.config.agents.map(agent=>({id:agent.id,name:agent.name}))};
    const record={format:1,experiment_id:id,owner_session_id:owner,created_at:new Date(now).toISOString(),updated_at:new Date(now).toISOString(),game_mode:'last-seat',status:replay.final_state.ended?'completed':'active',seed:replay.seed,configuration,match_id:replay.match_id};
    return this.save(record);
  }
  async update(record,replay,now=Date.now()){
    return this.save({...record,updated_at:new Date(now).toISOString(),status:replay.final_state.ended?'completed':'active',match_id:replay.match_id});
  }
  health(){const records=[...this.records.values()];return {status:'ok',active:records.filter(record=>record.status==='active').length,completed:records.filter(record=>record.status==='completed').length,limit:maximumRecords};}
}

/** Publicly renderable facts only. The full private checkpoint stays on the volume. */
export function experimentExport(record,replay){
  const agents=replay.config.agents.map(agent=>({id:agent.id,name:agent.name,sprite:agent.sprite,strategy:agent.strategy,model:agent.model,provider:agent.provider}));
  const result={match_id:replay.match_id,ended:replay.final_state.ended,turn:replay.final_state.turn,winner_id:replay.winner,end_reason:replay.final_state.end_reason,agents:replay.final_state.agents.map(agent=>({id:agent.id,credits:agent.credits,alive:agent.alive,stats:agent.stats}))};
  const structured_events=replay.events.map(event=>({seq:event.seq,turn:event.turn,type:event.type,actor:event.actor,target:event.target,amount:event.amount,after:event.after,reason:event.reason}));
  const research_summaries=agents.map((agent,index)=>({agent_id:agent.id,statistics:replay.statistics[index]}));
  return {experiment_id:record.experiment_id,created_at:record.created_at,updated_at:record.updated_at,seed:record.seed,mode:record.game_mode,status:record.status,configuration:record.configuration,agents,matches:[{match_id:replay.match_id,result}],results:[result],structured_events,research_summaries};
}
