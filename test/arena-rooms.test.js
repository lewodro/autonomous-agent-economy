import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ArenaRoomPool } from '../service/arena-rooms.js';
import { verifyProof } from '../src/rps.js';
import { verifyTicTacToeProof } from '../src/tictactoe.js';
import { validateState } from '../src/storage.js';
test('bounded rooms execute existing RPS/TTT rules and restore verified ledgers',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'arena-pool-'));
  const pool=new ArenaRoomPool(dir,{stageMs:0});await pool.restore();
  assert.equal(pool.listRooms().length,4);
  for(const id of ['rps-1','ttt-1'])await pool.step(id);
  const rps=pool.getRoom('rps-1').current,ttt=pool.getRoom('ttt-1').current;
  assert.ok(await verifyProof(rps));assert.ok(verifyTicTacToeProof(ttt));
  const profiles=pool.profiles();assert.equal(profiles.reduce((sum,a)=>sum+a.matches,0),4);
  const history=pool.history();assert.equal(history.length,2);
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
