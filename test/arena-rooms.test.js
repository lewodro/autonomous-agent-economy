import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
