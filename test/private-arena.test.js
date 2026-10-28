import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Core } from '../service/core.js';
import { PrivateArenaManager } from '../service/private-arena.js';

const ownerA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownerB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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
