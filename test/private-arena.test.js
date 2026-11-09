import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Core } from '../service/core.js';
import { PrivateArenaManager } from '../service/private-arena.js';
import { DurableStateDatabase } from '../service/durable-state.js';

const ownerA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownerB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

test('private arena instances are owner-isolated and start fresh autonomous modes', { timeout: 15000 }, async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'private-arena-'));
  const core=new Core(),manager=new PrivateArenaManager(core,directory,{maxInstances:4,maxActive:2});
  try {
    const first=await manager.view(ownerA),second=await manager.view(ownerB);
    assert.equal(first.started,false);assert.equal(second.started,false);
    assert.equal(first.rooms.length,4);assert.equal(first.survival.agents.length,20);assert.equal(first.history.length,0);
    assert.equal(second.history.length,0);
    const started=await manager.start(ownerA);
    assert.equal(started.started,true);assert.equal((await manager.view(ownerB)).started,false);
    const exported=await manager.export(ownerA);
    assert.equal(exported.mode,'private-arena-simulation');assert.equal(exported.history.length,0);
  } finally { await manager.close();core.stop();await rm(directory,{recursive:true,force:true}); }
});

test('private Survival loops across rounds with isolated sessions and a persistent custom agent', {timeout:20000}, async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'private-arena-loop-')),core=new Core(),manager=new PrivateArenaManager(core,directory,{maxInstances:4,maxActive:2,survivalOptions:{tickMs:50,resultMs:500,maxRounds:20,seedFactory:()=>17}});
  try{
    await manager.setAgent(ownerA,{name:'Kizaru',sprite:'assets/agents/06-strategist.png',strategy:'opportunist',mcp:{controller_type:'builtin',endpoint:null,capabilities:[]}});
    await manager.start(ownerA);await manager.start(ownerB);
    const deadline=Date.now()+15_000;while(Date.now()<deadline){const first=await manager.view(ownerA),second=await manager.view(ownerB);if(first.history.filter(value=>value.game==='survival').length>=2&&second.history.some(value=>value.game==='survival'))break;await new Promise(resolve=>setTimeout(resolve,100));}
    const first=await manager.view(ownerA),second=await manager.view(ownerB);assert.ok(first.history.filter(value=>value.game==='survival').length>=2,'private Survival should start the next match after a result');assert.ok(second.history.some(value=>value.game==='survival'),'another owner should advance on an isolated Rust session');assert.equal(first.custom_agent.name,'Kizaru');assert.ok(first.history.filter(value=>value.game==='survival').some(value=>value.players.some(player=>player.name==='Kizaru')));
    await manager.stop(ownerA);const restored=await manager.start(ownerA);assert.equal(restored.custom_agent.name,'Kizaru');assert.equal(restored.started,true);
  }finally{await manager.close();core.stop();await rm(directory,{recursive:true,force:true});}
});

test('private arena ownership survives a clean scratch replacement through durable storage',{timeout:15000},async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'private-arena-durable-')),pool=new MemoryPool(),core=new Core();
  try{
    const firstDb=new DurableStateDatabase({directory:path.join(root,'db-a'),pool});await firstDb.open();
    const first=new PrivateArenaManager(core,path.join(root,'scratch-a'),{durableDatabase:firstDb,maxInstances:4,maxActive:2});
    await first.setAgent(ownerA,{name:'Durable Scout',sprite:'assets/agents/04-analyst.png',strategy:'balanced',mcp:{controller_type:'builtin',endpoint:null,capabilities:[]}});
    await first.close();await firstDb.close();
    const secondDb=new DurableStateDatabase({directory:path.join(root,'db-b'),pool});await secondDb.open();
    const second=new PrivateArenaManager(core,path.join(root,'scratch-b'),{durableDatabase:secondDb,maxInstances:4,maxActive:2});
    assert.equal((await second.view(ownerA)).custom_agent.name,'Durable Scout');
    assert.equal((await second.view(ownerB)).custom_agent,null,'another owner cannot read the durable private agent');
    await second.close();await secondDb.close();
  }finally{core.stop();await rm(root,{recursive:true,force:true});}
});
