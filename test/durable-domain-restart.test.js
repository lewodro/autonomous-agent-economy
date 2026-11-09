import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DurableStateDatabase } from '../service/durable-state.js';
import { ArenaRoomPool } from '../service/arena-rooms.js';
import { CompoundGame } from '../service/compound-game.js';
import { SessionStore } from '../service/session-store.js';
import { ExperimentStore } from '../service/experiment-store.js';

class MemoryPool {
  constructor(){this.rows=new Map();}
  async query(sql,params=[]){
    if(sql.startsWith('create table'))return{rows:[]};
    const key=params.length>=2?`${params[0]}:${params[1]}`:null;
    if(sql.startsWith('select state'))return{rows:this.rows.has(key)?[{state:structuredClone(this.rows.get(key))}]:[]};
    if(sql.startsWith('insert into')){if(sql.includes('do nothing')&&this.rows.has(key))return{rows:[]};this.rows.set(key,JSON.parse(params[2]));return{rows:[]};}
    if(sql.startsWith('delete from')){this.rows.delete(key);return{rows:[]};}
    if(sql.startsWith('select record_id')){const prefix=`${params[0]}:`;return{rows:[...this.rows.entries()].filter(([id])=>id.startsWith(prefix)).sort().slice(0,params[1]).map(([id,state])=>({record_id:id.slice(prefix.length),state:structuredClone(state)}))};}
    throw new Error(`Unexpected query: ${sql}`);
  }
}

test('Arena settled history and research checkpoints survive replaceable scratch storage',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'durable-arena-')),pool=new MemoryPool();
  try{
    const firstDb=new DurableStateDatabase({directory:path.join(root,'db-a'),pool});await firstDb.open();
    const first=new ArenaRoomPool(path.join(root,'scratch-a'),{stageMs:0,collection:firstDb.collection('arena-rooms',{directory:path.join(root,'scratch-a'),maxRecords:4})});
    await first.restore();await first.step('rps-1');
    const before=first.history().filter(value=>value.roomId==='rps-1');
    assert.equal(before.length,1);await first.close();await firstDb.close();

    const secondDb=new DurableStateDatabase({directory:path.join(root,'db-b'),pool});await secondDb.open();
    const second=new ArenaRoomPool(path.join(root,'scratch-b'),{stageMs:0,collection:secondDb.collection('arena-rooms',{directory:path.join(root,'scratch-b'),maxRecords:4})});
    await second.restore();
    assert.deepEqual(second.history().filter(value=>value.roomId==='rps-1'),before);
    assert.ok(second.profiles().some(profile=>profile.memory.length>0),'verified match research remains resolvable');
    await second.close();await secondDb.close();
  }finally{await rm(root,{recursive:true,force:true});}
});

test('Compound persists completed history but not high-frequency active state',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'durable-compound-')),pool=new MemoryPool();let now=20_000;
  try{
    const firstDb=new DurableStateDatabase({directory:path.join(root,'db-a'),pool});await firstDb.open();
    const first=new CompoundGame(path.join(root,'scratch-a'),{now:()=>now,roundSeconds:60,historyCollection:firstDb.collection('compound-history',{directory:path.join(root,'scratch-a'),maxRecords:1})});
    await first.restore();await first.restoreHistory();first.startAgentRound();first.finish('timer');await first.historyTail;
    const completed=structuredClone(first.state.results);assert.equal(completed.length,1);await first.close();await firstDb.close();

    const secondDb=new DurableStateDatabase({directory:path.join(root,'db-b'),pool});await secondDb.open();
    const second=new CompoundGame(path.join(root,'scratch-b'),{now:()=>now,roundSeconds:60,historyCollection:secondDb.collection('compound-history',{directory:path.join(root,'scratch-b'),maxRecords:1})});
    await second.restore();await second.restoreHistory();
    assert.deepEqual(second.state.results,completed);
    assert.equal(second.state.phase,'lobby');
    assert.equal(second.state.participants.length,0,'movement and active participants are intentionally not restored');
    await second.close();await secondDb.close();
  }finally{await rm(root,{recursive:true,force:true});}
});

test('private experiment owner metadata and checkpoint survive restart with IDOR isolation',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'durable-private-')),pool=new MemoryPool(),id=randomUUID();
  const owner='clerk:user_a',other='clerk:user_b';
  const replay={config:{max_turns:10,agents:[{id:'agent-1',name:'One'}]},final_state:{ended:false},seed:7,match_id:'seat-'+'a'.repeat(64)};
  const budget={global:{reserved:0,used:0},agents:{}};
  try{
    const firstDb=new DurableStateDatabase({directory:path.join(root,'db-a'),pool});await firstDb.open();
    const sessions=new SessionStore(path.join(root,'scratch-a','sessions'),{collection:firstDb.collection('experiment-sessions',{directory:path.join(root,'scratch-a','sessions'),maxRecords:100})});
    const experiments=new ExperimentStore(path.join(root,'scratch-a','experiments'),sessions,undefined,{collection:firstDb.collection('experiments',{directory:path.join(root,'scratch-a','experiments'),maxRecords:100})});
    await experiments.restore();await sessions.save(id,replay,budget);await experiments.create(id,owner,replay,1_000);await firstDb.close();

    const secondDb=new DurableStateDatabase({directory:path.join(root,'db-b'),pool});await secondDb.open();
    const restoredSessions=new SessionStore(path.join(root,'scratch-b','sessions'),{collection:secondDb.collection('experiment-sessions',{directory:path.join(root,'scratch-b','sessions'),maxRecords:100})});
    const restored=new ExperimentStore(path.join(root,'scratch-b','experiments'),restoredSessions,undefined,{collection:secondDb.collection('experiments',{directory:path.join(root,'scratch-b','experiments'),maxRecords:100})});
    await restored.restore(2_000);
    assert.equal(restored.get(id,owner).experiment_id,id);
    assert.throws(()=>restored.get(id,other),{status:404});
    assert.equal((await restoredSessions.load())[0].session,id);
    await secondDb.close();
  }finally{await rm(root,{recursive:true,force:true});}
});
