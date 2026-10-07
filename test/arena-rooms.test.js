import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ArenaRoomPool } from '../service/arena-rooms.js';
import { verifyProof } from '../src/rps.js';
import { verifyTicTacToeProof } from '../src/tictactoe.js';
import { validateState } from '../src/storage.js';
import { createState } from '../src/economy.js';
test('bounded rooms execute existing RPS/TTT rules and restore verified ledgers',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'arena-pool-'));
  const pool=new ArenaRoomPool(dir,{stageMs:0});await pool.restore();
  assert.equal(pool.listRooms().length,4);
  assert.deepEqual(pool.health(),{status:'ok',roomCount:4,failedRooms:[]});
  for(const id of ['rps-1','ttt-1'])await pool.step(id);
  const snapshot=pool.getRoom('rps-1'),rps=snapshot.current,ttt=pool.getRoom('ttt-1').current;
  assert.equal('events' in snapshot.state,false);
  assert.ok(pool.log(snapshot.room.runId).state.events.length>0,'verified event ledger remains available through the log route');
  assert.ok(await verifyProof(rps));assert.ok(verifyTicTacToeProof(ttt));
  const profiles=pool.profiles();assert.equal(profiles.reduce((sum,a)=>sum+a.matches,0),4);
  assert.ok(profiles.some(profile=>profile.arenaStatus==='finished'),'completed participants remain associated with their room briefly');
  const statistics=pool.statistics();assert.equal(statistics.totals.matches,2);
  assert.equal(statistics.games.rps.matches,1);assert.equal(statistics.games.rps.decisions,2);
  assert.equal(statistics.games.tictactoe.matches,1);assert.equal(statistics.games.tictactoe.decisions,ttt.moves.length);
  assert.equal(statistics.agents.reduce((sum,agent)=>sum+agent.matches,0),4);
  const history=pool.history();assert.equal(history.length,2);
  for(const profile of profiles){
    if(!profile.latestMatch){assert.equal(profile.recentWinner,false);continue;}
    const latest=history.find(match=>match.runId===profile.latestMatch.runId&&match.id===profile.latestMatch.matchId);
    assert.ok(latest,`latest profile match should be retained for ${profile.id}`);
    assert.equal(profile.recentWinner,latest.result!=='draw'&&latest.players[latest.result==='a'?0:1].id===profile.id);
  }
  for(const entry of history)await validateState(pool.log(entry.runId).state);
  const restored=new ArenaRoomPool(dir,{stageMs:0});await restored.restore();
  assert.deepEqual(restored.history(),history);assert.deepEqual(restored.profiles(),profiles);
  assert.throws(()=>pool.getRoom('missing'),/not found/);
  pool.close();restored.close();
});
test('room epoch rollover is checkpointed before the next match begins',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'arena-epoch-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const pool=new ArenaRoomPool(dir,{stageMs:0});await pool.restore();
  for(let i=0;i<64;i++)await pool.step('rps-1');
  const room=pool.rooms.get('rps-1'),oldRunId=room.saved.runId,checkpoint=pool.checkpoint.bind(pool),observed=[];
  pool.checkpoint=async()=>{throw Object.assign(new Error('simulated checkpoint failure'),{code:'EIO'});};
  await assert.rejects(pool.step('rps-1'),{code:'EIO'});
  assert.equal(room.saved.runId,oldRunId,'failed persistence must not publish the staged run ID');
  assert.equal(room.state.matches.length,64,'failed persistence must retain the prior in-memory run');
  assert.equal(pool.listRooms().find(value=>value.id==='rps-1').runId,oldRunId);
  pool.checkpoint=async(value,epoch)=>{observed.push({runId:epoch?.runId||value.saved.runId,matches:epoch?.state.matches.length??value.state.matches.length,previous:epoch?.previous.length??value.saved.previous.length});return checkpoint(value,epoch);};
  await pool.step('rps-1');
  assert.equal(observed[0].runId,room.saved.runId);
  assert.equal(observed[0].matches,0,'the rollover checkpoint precedes simulation work');
  assert.equal(observed[0].previous,1);
  assert.notEqual(room.saved.runId,oldRunId);
  const disk=JSON.parse(await readFile(path.join(dir,'rps-1.json'),'utf8'));
  assert.equal(disk.runId,room.saved.runId);
  assert.equal(disk.previous[0].runId,oldRunId);
  assert.equal(disk.state.matches.length,1);
  for(let i=1;i<64;i++)await pool.step('rps-1');
  const stableRunId=room.saved.runId;let failAfterRename=true;
  pool.checkpoint=async(value,epoch)=>{
    await checkpoint(value,epoch);
    if(epoch&&failAfterRename){failAfterRename=false;throw Object.assign(new Error('simulated directory sync failure'),{code:'EIO'});}
  };
  await assert.rejects(pool.step('rps-1'),{code:'EIO'});
  const committedRunId=room.saved.runId;assert.notEqual(committedRunId,stableRunId);
  assert.equal(room.state.matches.length,0,'the in-memory state follows the renamed checkpoint');
  const retriedEpochs=[];
  pool.checkpoint=async(value,epoch)=>{if(epoch)retriedEpochs.push({runId:epoch.runId,matches:epoch.state.matches.length});return checkpoint(value,epoch);};
  await pool.step('rps-1');
  assert.deepEqual(retriedEpochs[0],{runId:committedRunId,matches:0},'retry must reconfirm the same epoch before simulating');
  assert.equal(room.saved.state.matches.length,1);
  await pool.close();
});
test('arena checkpoint flushes file and directory and preserves state after sync failure',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'arena-checkpoint-sync-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let failSync=false;const pool=new ArenaRoomPool(dir,{syncFolder:async()=>{if(failSync){failSync=false;throw Object.assign(new Error('simulated directory sync failure'),{code:'EIO'});}}});await pool.restore();
  const room=pool.rooms.get('rps-1'),nextRng=room.state.rng===4294967295?1:room.state.rng+1;room.state.rng=nextRng;failSync=true;
  await assert.rejects(pool.checkpoint(room),{status:503,code:'EIO'});
  assert.equal(room.saved.state.rng,nextRng);
  const disk=JSON.parse(await readFile(path.join(dir,'rps-1.json'),'utf8'));assert.equal(disk.state.rng,nextRng);
  assert.deepEqual(await readdir(dir),['rps-1.json']);
  const reopened=new ArenaRoomPool(dir);await reopened.restore();assert.equal(reopened.rooms.get('rps-1').state.rng,nextRng);
  await pool.close();await reopened.close();
});
test('recently finished agents remain visible in the plaza when their room starts another fight',async()=>{
  const pool=new ArenaRoomPool(await mkdtemp(path.join(os.tmpdir(),'arena-finish-flow-')),{stageMs:0});await pool.restore();
  await pool.step('rps-1');const room=pool.rooms.get('rps-1'),finished=room.current.players.slice();
  const nextPair=Array.from({length:20},(_,index)=>`agent-${index+1}`).filter(id=>!finished.includes(id)).slice(0,2);
  room.current={players:nextPair};room.status='live';room.phase='action';
  const active=new Set(room.current.players),profiles=pool.profiles();
  for(const id of finished.filter(agentId=>!active.has(agentId))){
    const profile=profiles.find(agent=>agent.id===id);assert.equal(profile.arenaStatus,'finished');assert.equal(profile.roomId,'rps-1');
  }
  for(const id of active)assert.equal(profiles.find(agent=>agent.id===id).arenaStatus,'fighting');
  pool.close();
});
test('a corrupt persisted result cannot become profile research or a payout',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'arena-corrupt-'));
  const pool=new ArenaRoomPool(dir,{stageMs:0});await pool.restore();await pool.step('ttt-1');
  const file=path.join(dir,'ttt-1.json'),saved=JSON.parse(await readFile(file));saved.state.agents[0].wins+=100;
  await writeFile(file,JSON.stringify(saved));
  await assert.rejects(()=>new ArenaRoomPool(dir).restore(),/verified ledger/);pool.close();
});
test('in-flight rooms reject concurrent steps and only expose completed research',async()=>{
  const pool=new ArenaRoomPool(await mkdtemp(path.join(os.tmpdir(),'arena-flight-')),{stageMs:2});await pool.restore();
  const step=pool.step('rps-1');await assert.rejects(()=>pool.step('rps-1'),/already running/);
  assert.equal(pool.history().length,0);await step;assert.equal(pool.history().length,1);pool.close();
});
test('settling rooms stay live until the final result checkpoint completes',async()=>{
  const pool=new ArenaRoomPool(await mkdtemp(path.join(os.tmpdir(),'arena-settle-')),{stageMs:1});await pool.restore();
  let reachedSettle,releaseSettle;
  const atSettle=new Promise(resolve=>{reachedSettle=resolve;});
  pool.delay=()=>new Promise(resolve=>{if(pool.rooms.get('rps-1').phase==='settle'){releaseSettle=resolve;reachedSettle();}else resolve();});
  const step=pool.step('rps-1');await atSettle;
  assert.equal(pool.rooms.get('rps-1').status,'live');
  assert.equal(pool.listRooms().find(room=>room.id==='rps-1').status,'live');
  assert.equal(pool.history().length,0,'uncheckpointed completion is excluded from retained research');
  releaseSettle();await step;
  assert.equal(pool.rooms.get('rps-1').status,'finished');
  assert.equal(pool.history().length,1);
  pool.close();
});
test('room scheduler retries one transient checkpoint failure without duplicating the match',async()=>{
  const pool=new ArenaRoomPool(await mkdtemp(path.join(os.tmpdir(),'arena-retry-')),{stageMs:0,restMs:60_000,retryMs:1});await pool.restore();
  const checkpoint=pool.checkpoint.bind(pool);let injected=false;
  pool.checkpoint=async room=>{if(!injected){injected=true;throw new Error('temporary checkpoint failure');}return checkpoint(room);};
  const running=pool.run('rps-1');
  try{
    for(let attempt=0;attempt<200&&!injected;attempt++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(injected,true,'the first checkpoint should fail');
    for(let attempt=0;attempt<200&&pool.history().length===0;attempt++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(pool.rooms.get('rps-1').state.matches.length,1,'the retried room should settle exactly one match');
    assert.equal(pool.history().length,1);
  }finally{pool.close();await running;}
});
test('room scheduler stops after its bounded retry budget',async()=>{
  const pool=new ArenaRoomPool(await mkdtemp(path.join(os.tmpdir(),'arena-retry-limit-')),{retryMs:1});await pool.restore();
  let attempts=0;pool.step=async()=>{attempts++;throw new Error('persistent room failure');};
  const running=pool.run('rps-1');await running;
  assert.equal(attempts,4,'one initial attempt plus three retries');
  pool.rooms.get('rps-1').status='failed';
  assert.deepEqual(pool.health(),{status:'degraded',roomCount:4,failedRooms:['rps-1']});
  pool.close();
});
test('room failure logs expose safe error codes without raw messages',async()=>{
  const pool=new ArenaRoomPool(await mkdtemp(path.join(os.tmpdir(),'arena-error-log-')),{retryMs:1});await pool.restore();
  pool.step=async()=>{throw Object.assign(new Error('private path /data/matches/secret'),{code:'EIO'});};
  const logs=[],write=console.error;console.error=value=>logs.push(value);
  try{await pool.run('rps-1');}finally{console.error=write;pool.close();}
  const events=logs.map(line=>JSON.parse(line));
  assert.equal(events.length,4);assert.ok(events.every(event=>event.errorType==='Error'&&event.code==='EIO'));
  assert.ok(logs.every(line=>!line.includes('/data/matches/secret')));
});
test('retained profile and archive chronology stays correct when completion times tie',async()=>{
  const pool=new ArenaRoomPool(await mkdtemp(path.join(os.tmpdir(),'arena-ties-')));await pool.restore();
  const run=(runId,id,result)=>{
    const state=createState(2),match={id,status:'settled',players:['agent-1','agent-2'],result,type:'tictactoe',moves:[]};
    state.matches.push(match);state.events.push({type:'GAME_FINISHED',time:'2026-10-06T00:00:00.000Z',data:{matchId:id}});
    for(const agent of state.agents)agent.memory.push({matchId:id,opponent:'agent-1',move:'center',observed:'same millisecond'});
    return {runId,roomId:'ttt-1',game:'tictactoe',state};
  };
  pool.runs=()=>[run('current','game-2','b'),run('retained','game-1','a')];pool.listRooms=()=>[];
  const founder=pool.profiles().find(profile=>profile.id==='agent-1');
  assert.equal(founder.latestMatch.runId,'current');assert.equal(founder.recentWinner,false);
  assert.deepEqual(founder.memory.map(entry=>entry.runId),['retained','current']);
  assert.deepEqual(pool.history().map(entry=>entry.id),['game-2','game-1']);
  pool.close();
});
