import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {TableSession,visitorHash} from '../service/world-table.js';
import {verifyTicTacToeProof} from '../src/tictactoe.js';
import {mountTable} from '../web/dist/world/table.js';
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
test('an expired waiting seat releases the table and cannot act in the next session',async()=>{
 const t=new TableSession(await mkdtemp(path.join(os.tmpdir(),'world-expiry-')));await t.restore();
 await t.act(x,'join',{mode:'human'});const originalNow=Date.now,expiredAt=t.state.updatedAt+120_000;
 try{
  Date.now=()=>expiredAt;
  assert.equal(t.snapshot(x).status,'empty');assert.equal(t.snapshot(x).expired,true);
  const next=await t.act(o,'join',{mode:'human'});assert.equal(next.status,'waiting');assert.equal(next.yourSeat,'human-x');
  await assert.rejects(()=>t.act(x,'move',{cell:0,revision:t.state.revision}),/Sit at the table/);
 }finally{Date.now=originalNow;}
});
test('table checkpoints flush file and directory and keep memory aligned after directory sync failure',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'world-table-sync-'));t.after(()=>rm(dir,{recursive:true,force:true}));let failSync=false;
 const table=new TableSession(dir,{syncFolder:async()=>{if(failSync){failSync=false;throw Object.assign(new Error('simulated directory sync failure'),{code:'EIO'});}}});await table.restore();failSync=true;
 await assert.rejects(table.act(x,'join',{mode:'human'}),{status:503,code:'EIO'});
 assert.equal(table.snapshot(x).status,'waiting');
 const saved=JSON.parse(await readFile(path.join(dir,'table.json'),'utf8'));assert.equal(saved.status,'waiting');
 const reopened=new TableSession(dir);await reopened.restore();assert.deepEqual(reopened.snapshot(x),table.snapshot(x));
 assert.deepEqual(await readdir(dir),['table.json']);
});
test('table polling clears a transient connection warning after recovery without a state change',async()=>{
 class Element {
  children=[];textContent='';
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  setAttribute(){}
 }
 const oldDocument=globalThis.document,oldFetch=globalThis.fetch,parent=new Element(),state={status:'empty',revision:0,mode:'free',yourSeat:null,players:[],match:null};
 let calls=0,active=true;globalThis.document={createElement:()=>new Element()};
 globalThis.fetch=async()=>{
  calls++;
  if(calls===2)throw new Error('temporary network failure');
  return {ok:true,json:async()=>state};
 };
 try{
  mountTable(parent,()=>active,2);const alert=parent.children[4];
  for(let attempt=0;attempt<100&&(!alert.textContent||calls<3);attempt++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(calls>=3,true,'polling should retry after a failed request');
  assert.equal(alert.textContent,'','a successful unchanged snapshot should clear the reconnect warning');
 }finally{
  active=false;await new Promise(resolve=>setTimeout(resolve,5));
  globalThis.document=oldDocument;globalThis.fetch=oldFetch;
 }
});
