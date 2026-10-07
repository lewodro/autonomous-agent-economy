import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
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

test('a pre-rename checkpoint failure rolls the Rust engine back to the last durable turn',async t=>{
 const core=new Core();t.after(()=>core.stop());
 const session=randomUUID();let saves=0;
 const store={save:async()=>{if(++saves===2)throw Object.assign(new Error('disk full'),{status:503});}};
 const runtime=new MatchRuntime(store),{replay}=await core.request({command:'start',session,config:await core.request({command:'defaults',count:2})});
 await assert.rejects(runtime.step(core,session,{expected_turn:0}),{status:503});
 const restored=await core.request({command:'get',session});
 assert.equal(restored.replay.final_state.turn,replay.final_state.turn);
 assert.deepEqual(restored.replay,replay);
 const retry=await runtime.step(core,session,{expected_turn:0});
 assert.equal(retry.replay.final_state.turn,1,'the unchanged turn can safely be retried');
});

test('a post-rename directory-sync failure retains and exposes the committed transition',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'last-seat-step-sync-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const session=randomUUID();let syncs=0;
 const store=new SessionStore(directory,{syncFolder:async()=>{if(++syncs===2)throw Object.assign(new Error('simulated directory sync failure'),{code:'EIO'});}});
 const core=new Core();t.after(()=>core.stop());
 const runtime=new MatchRuntime(store);
 await core.request({command:'start',session,config:await core.request({command:'defaults',count:2})});
 let failure;
 try{await runtime.step(core,session,{expected_turn:0});}catch(error){failure=error;}
 assert.equal(failure?.durable_write_completed,true);
 assert.equal(failure?.committed_result?.replay.final_state.turn,1);
 assert.equal((await core.request({command:'get',session})).replay.final_state.turn,1);
 assert.equal((await store.load())[0].replay.final_state.turn,1);
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

test('session and archive checkpoints sync their directories and recover after sync failure',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'last-seat-store-sync-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const session=randomUUID(),matchId=`seat-${'b'.repeat(64)}`,synced=[];let failSync=true;
 const store=new SessionStore(directory,{syncFolder:async target=>{synced.push(target);if(failSync){failSync=false;throw Object.assign(new Error('simulated directory sync failure'),{code:'EIO'});}}});
 await assert.rejects(store.save(session,{turn:7},new InferenceBudget().snapshot()),{status:503,code:'EIO'});
 assert.deepEqual(await readdir(directory),[`${session}.json`]);
 assert.equal((await new SessionStore(directory).load())[0].replay.turn,7,'renamed checkpoint remains readable after the reported sync failure');
 await store.archive(session,matchId);assert.equal(await store.archivedMatch(session),matchId);
 assert.deepEqual(synced,[directory,path.join(directory,'finished')]);
 assert.deepEqual(await readdir(path.join(directory,'finished')),[`${session}.json`]);
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

test('finished session lookup metadata remains bounded and is pruned on restart',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'last-seat-finished-retention-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const store=new SessionStore(directory,{maxFinishedSessions:2});
 const sessions=[1,2,3].map(index=>`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`);
 await Promise.all(sessions.map((session,index)=>store.archive(session,`seat-${String(index+1).repeat(64)}`)));
 const finished=path.join(directory,'finished');
 assert.equal((await readdir(finished)).filter(name=>name.endsWith('.json')).length,2);
 const visible=await Promise.all(sessions.map(session=>store.archivedMatch(session)));
 assert.equal(visible.filter(Boolean).length,2);

 const reopened=new SessionStore(directory,{maxFinishedSessions:1});
 await reopened.load();
 assert.equal((await readdir(finished)).filter(name=>name.endsWith('.json')).length,1);
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
