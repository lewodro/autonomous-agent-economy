import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {TableSession,visitorHash} from '../service/world-table.js';
import {verifyTicTacToeProof} from '../src/tictactoe.js';
const x=visitorHash('x'),o=visitorHash('o'),stranger=visitorHash('stranger');
test('free human table enforces seating, turns, revisions, terminal result and restart proof',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'world-table-')),t=new TableSession(dir);await t.restore();
 assert.equal((await t.act(x,'join',{mode:'human'})).status,'waiting');
 const ready=await t.act(o,'join',{mode:'human'});assert.equal(ready.status,'ready');assert.equal(JSON.stringify(ready).includes('credential'),false);
 await assert.rejects(()=>t.act(stranger,'move',{cell:0}),/Sit/);await t.act(x,'start');
 await assert.rejects(()=>t.act(o,'move',{cell:0,revision:t.state.revision}),/turn/);
 await assert.rejects(()=>t.act(x,'move',{cell:0,revision:-1}),/changed/);
 for(const [person,cell] of [[x,0],[o,3],[x,1],[o,4],[x,2]])await t.act(person,'move',{cell,revision:t.state.revision});
 assert.equal(t.snapshot(x).status,'finished');assert.ok(verifyTicTacToeProof(t.snapshot(x).match));
 await assert.rejects(()=>t.act(o,'move',{cell:5,revision:t.state.revision}),/No active/);
 const restored=new TableSession(dir);await restored.restore();assert.deepEqual(restored.snapshot(x),t.snapshot(x));
 const file=path.join(dir,'table.json'),data=JSON.parse(await readFile(file));data.match.result='b';await writeFile(file,JSON.stringify(data));
 await assert.rejects(()=>new TableSession(dir).restore(),/Invalid table result/);
});
test('NPC practice uses existing strategy and rules; concurrent joins cannot create a third seat',async()=>{
 const t=new TableSession(await mkdtemp(path.join(os.tmpdir(),'world-npc-')));await t.restore();await t.act(x,'join',{mode:'npc'});await t.act(x,'start');
 await assert.rejects(()=>t.act(o,'join',{mode:'human'}),/occupied/);
 while(t.state.status==='playing'){const cell=t.state.match.board.findIndex(v=>v===null);await t.act(x,'move',{cell,revision:t.state.revision});}
 assert.ok(verifyTicTacToeProof(t.snapshot(x).match));await t.act(x,'leave');
 const joins=await Promise.allSettled([t.act(x,'join',{mode:'human'}),t.act(o,'join',{mode:'human'}),t.act(stranger,'join',{mode:'human'})]);
 assert.equal(joins.filter(r=>r.status==='fulfilled').length,2);assert.equal(t.state.players.length,2);
});
