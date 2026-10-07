import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Core} from '../service/core.js';
import {MatchRuntime} from '../service/runtime.js';
import {SessionStore} from '../service/session-store.js';
import {InferenceBudget,HttpModelAdapter} from '../service/model-adapter.js';

test('restart restores verified state and inference reservations before continuing the same session',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'last-seat-checkpoint-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 let core=new Core();t.after(()=>core.stop());
 const store=new SessionStore(directory),runtime=new MatchRuntime(store),session=randomUUID();
 const config=await core.request({command:'defaults',count:4});
 const {replay}=await core.request({command:'start',session,config});
 runtime.budget(session).reserve('agent-1',{max_requests:40},300);
 await runtime.checkpoint(session,replay);
 const first=await runtime.step(core,session,{});
 core.stop();core=new Core();
 const recovered=new MatchRuntime(store),sessions=new Map();
 await recovered.restore(core,sessions);
 assert.equal(sessions.has(session),true);
 assert.deepEqual((await core.request({command:'get',session})).replay,first.replay);
 assert.equal(recovered.budget(session).requests,1);assert.equal(recovered.budget(session).agents.get('agent-1'),1);
 const second=await recovered.step(core,session,{expected_turn:1});
 assert.equal(second.replay.final_state.turn,2);
 assert.deepEqual(second.replay.events.slice(0,first.replay.events.length),first.replay.events);
 assert.equal((await store.load())[0].replay.match_id,second.replay.match_id);
});

test('queued checkpoints retain submission order and reject corrupt metadata',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'last-seat-store-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const store=new SessionStore(directory),session=randomUUID(),budget=new InferenceBudget().snapshot();
 await Promise.all([store.save(session,{turn:1},budget),store.save(session,{turn:2},budget)]);
 assert.equal((await store.load())[0].replay.turn,2);
 assert.throws(()=>store.file('../../escape'),/identifier/);
 await writeFile(store.file(session),JSON.stringify({format:1,session:'wrong',replay:{},budget}));
 await assert.rejects(store.load(),/checkpoint/);
 assert.throws(()=>InferenceBudget.restore({...budget,requests:1}),/Inconsistent/);
});

test('finished session aliases survive checkpoint eviction without consuming active capacity',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'last-seat-archive-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const store=new SessionStore(directory),session=randomUUID(),matchId=`seat-${'a'.repeat(64)}`;
 await store.save(session,{final_state:{ended:true}},new InferenceBudget().snapshot());
 await store.archive(session,matchId);
 assert.equal(await store.archivedMatch(session),matchId);
 await store.remove(session);
 assert.deepEqual(await store.load(),[]);
 assert.equal(await store.archivedMatch(session),matchId);
 await assert.rejects(store.archive(session,'../unsafe'),/match identifier/);
});

test('a failed reservation checkpoint prevents any paid provider request',async()=>{
 const before=globalThis.fetch;let calls=0;
 const budget=new InferenceBudget();budget.persist=async()=>{throw new Error('Checkpoint unavailable');};
 globalThis.fetch=async()=>{calls++;throw new Error('Unexpected provider request');};
 try {
  const profile={id:'agent-1',provider:'openai-compatible',model:'test',prompt:'',personality:'',inference:{retries:0}};
  const choice=await new HttpModelAdapter(profile,budget).decide({agents:[]});
  assert.equal(calls,0);assert.equal(choice.action,'guard');assert.equal(budget.requests,1);
 }finally{globalThis.fetch=before;}
});
