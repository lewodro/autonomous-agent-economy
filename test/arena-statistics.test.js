import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyArenaSummary,mergeArenaSummaries,summarizeArenaRun,validateArenaSummary} from '../service/arena-statistics.js';
import {ArenaRoomPool} from '../service/arena-rooms.js';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

test('verified room summaries merge exact RPS and Tic-Tac-Toe counts',()=>{
  const rps={game:'rps',state:{matches:[{id:'r1',status:'settled',type:'rps',players:['agent-1','agent-2'],result:'a',reveals:{'agent-1':{},'agent-2':{}}}],events:[{type:'GAME_FINISHED',time:'2026-10-07T00:00:00.000Z',data:{matchId:'r1'}}]}};
  const ttt={game:'tictactoe',state:{matches:[{id:'t1',status:'settled',type:'tictactoe',players:['agent-1','agent-3'],result:'draw',moves:[{}, {}, {}]}],events:[{type:'GAME_FINISHED',time:'2026-10-07T00:00:01.000Z',data:{matchId:'t1'}}]}};
  const summary=mergeArenaSummaries(summarizeArenaRun(rps),summarizeArenaRun(ttt));
  assert.equal(summary.matches,2);assert.equal(summary.draws,1);assert.equal(summary.decisions,5);
  assert.deepEqual(summary.games,{rps:{matches:1,draws:0,decisions:2},tictactoe:{matches:1,draws:1,decisions:3}});
  assert.deepEqual(summary.agents['agent-1'],{matches:2,wins:1,draws:1});
  assert.equal(summary.updated_at,'2026-10-07T00:00:01.000Z');
  assert.deepEqual(validateArenaSummary(summary),summary);
  const invalid=structuredClone(summary);invalid.games.rps.decisions++;
  assert.throws(()=>validateArenaSummary(invalid),/do not reconcile/);
});

test('cumulative room statistics survive bounded run rollover and restart',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'arena-cumulative-stats-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const pool=new ArenaRoomPool(directory,{stageMs:0});await pool.restore();
  for(let index=0;index<64;index++)await pool.step('rps-1');
  const room=pool.rooms.get('rps-1'),historical=structuredClone(room.saved.state);
  room.saved.previous=[randomUUID(),randomUUID(),randomUUID()].map(runId=>({runId,state:structuredClone(historical)}));
  assert.equal(pool.statistics().games.rps.matches,256);
  await pool.step('rps-1');
  const stats=pool.statistics();assert.equal(stats.games.rps.matches,257);assert.equal(stats.totals.matches,257);
  assert.equal(room.saved.previous.length,3);assert.equal(room.saved.cumulative.matches,64);
  const restored=new ArenaRoomPool(directory,{stageMs:0});await restored.restore();
  assert.equal(restored.statistics().games.rps.matches,257);
  assert.equal(restored.statistics().agents.reduce((sum,agent)=>sum+agent.matches,0),514);
  await pool.close();await restored.close();
});
