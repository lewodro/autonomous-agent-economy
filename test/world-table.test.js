import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {TableSession,visitorHash} from '../service/world-table.js';
import {verifyTicTacToeProof} from '../src/tictactoe.js';
import {mountTable} from '../web/dist/world/table.js';
const x=visitorHash('x'),o=visitorHash('o'),stranger=visitorHash('stranger');
const move=(cell,revision,move_id=randomUUID())=>({cell,revision,move_id});
test('free human table enforces seating, turns, revisions, terminal result and restart proof',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'world-table-')),t=new TableSession(dir);await t.restore();
 assert.equal((await t.act(x,'join',{mode:'human'})).status,'waiting');
 const ready=await t.act(o,'join',{mode:'human'});assert.equal(ready.status,'ready');assert.equal(JSON.stringify(ready).includes('credential'),false);
 await assert.rejects(()=>t.act(stranger,'move',{cell:0}),/Sit/);await t.act(x,'start');
 await assert.rejects(()=>t.act(o,'move',move(0,t.state.revision)),/turn/);
 await assert.rejects(()=>t.act(x,'move',move(0,-1)),/board changed/);
 for(const [person,cell] of [[x,0],[o,3],[x,1],[o,4],[x,2]])await t.act(person,'move',move(cell,t.state.revision));
 assert.equal(t.snapshot(x).status,'finished');assert.ok(verifyTicTacToeProof(t.snapshot(x).match));
 await assert.rejects(()=>t.act(o,'move',move(5,t.state.revision)),/No active/);
 const restored=new TableSession(dir);await restored.restore();assert.deepEqual(restored.snapshot(x),t.snapshot(x));
 const file=path.join(dir,'table.json'),data=JSON.parse(await readFile(file));data.match.result='b';await writeFile(file,JSON.stringify(data));
 await assert.rejects(()=>new TableSession(dir).restore(),/Invalid table result/);
});
test('NPC practice uses existing strategy and rules; concurrent joins cannot create a third seat',async()=>{
 const t=new TableSession(await mkdtemp(path.join(os.tmpdir(),'world-npc-')));await t.restore();await t.act(x,'join',{mode:'npc'});await t.act(x,'start');
 await assert.rejects(()=>t.act(o,'join',{mode:'human'}),/occupied/);
 while(t.state.status==='playing'){const cell=t.state.match.board.findIndex(v=>v===null);await t.act(x,'move',move(cell,t.state.revision));}
 assert.ok(verifyTicTacToeProof(t.snapshot(x).match));await t.act(x,'leave');
 const joins=await Promise.allSettled([t.act(x,'join',{mode:'human'}),t.act(o,'join',{mode:'human'}),t.act(stranger,'join',{mode:'human'})]);
 assert.equal(joins.filter(r=>r.status==='fulfilled').length,2);assert.equal(t.state.players.length,2);
});
test('table expiry follows seated activity and expires abandoned waiting seats',async()=>{
 let now=1_000;const t=new TableSession(await mkdtemp(path.join(os.tmpdir(),'world-expiry-')),{now:()=>now});await t.restore();
 await t.act(x,'join',{mode:'human'});now+=119_000;
 assert.equal(t.snapshot(x).status,'waiting','an active seated visitor refreshes the inactivity lease');
 now+=119_000;assert.equal(t.snapshot(x).status,'waiting');
 now+=120_000;assert.equal(t.snapshot(x).expired,true);
 const next=await t.act(o,'join',{mode:'human'});assert.equal(next.status,'waiting');assert.equal(next.yourSeat,'human-x');
 await assert.rejects(()=>t.act(x,'move',move(0,t.state.revision)),/Sit at the table/);
});
test('reading an expired table durably releases the old seats instead of reviving them after restart',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'world-expired-checkpoint-'));t.after(()=>rm(dir,{recursive:true,force:true}));let now=5_000;
 const table=new TableSession(dir,{now:()=>now});await table.restore();await table.act(x,'join',{mode:'human'});now+=120_000;
 const expired=await table.observe(stranger);assert.equal(expired.status,'empty');assert.equal(expired.expired,true);
 const saved=JSON.parse(await readFile(path.join(dir,'table.json'),'utf8'));assert.equal(saved.status,'empty');assert.equal(saved.players.length,0);
 const restored=new TableSession(dir,{now:()=>now});await restored.restore();assert.equal((await restored.observe(stranger)).status,'empty');
});
test('active table survives a slow turn and a process restart, then expires when every seat is inactive',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'world-playing-expiry-'));t.after(()=>rm(dir,{recursive:true,force:true}));let now=20_000;
 let table=new TableSession(dir,{now:()=>now});await table.restore();await table.act(x,'join',{mode:'human'});await table.act(o,'join',{mode:'human'});await table.act(x,'start');
 now+=9*60_000;assert.equal(table.snapshot(x).status,'playing');
 now+=9*60_000;assert.equal(table.snapshot(o).status,'playing','either active seat keeps a shared game alive');
 table=new TableSession(dir,{now:()=>now});await table.restore();assert.equal(table.snapshot(x).status,'playing','restored participants get a fresh reconnect window');
 now+=10*60_000;assert.equal(table.snapshot(x).expired,true,'a game with no active seats eventually releases the table');
 const replacement=await table.act(stranger,'join',{mode:'human'});assert.equal(replacement.status,'waiting');
});
test('move IDs make retries idempotent and serialize simultaneous moves against one revision',async t=>{
 const table=new TableSession(await mkdtemp(path.join(os.tmpdir(),'world-move-id-')));await table.restore();await table.act(x,'join',{mode:'human'});await table.act(o,'join',{mode:'human'});await table.act(x,'start');
 const revision=table.state.revision,moveId=randomUUID(),request={cell:0,revision,move_id:moveId};
 const first=await table.act(x,'move',request),retry=await table.act(x,'move',request);
 assert.equal(first.revision,retry.revision);assert.equal(table.state.match.moves.length,1);assert.equal(table.state.match.moves[0].move_id,moveId);
 await assert.rejects(()=>table.act(x,'move',{...request,cell:1}),{code:'MOVE_ID_REUSED'});
 const raceId=randomUUID(),raced=await Promise.allSettled([table.act(o,'move',{cell:3,revision:table.state.revision,move_id:raceId}),table.act(o,'move',{cell:4,revision:table.state.revision,move_id:randomUUID()})]);
 assert.equal(raced.filter(result=>result.status==='fulfilled').length,1);assert.equal(table.state.match.moves.length,2);
 await assert.rejects(()=>table.act(x,'move',{cell:1,revision:table.state.revision}),{code:'MOVE_ID_REQUIRED'});
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
test('table UI retries the same pending move with its original idempotency key',async()=>{
 class Element {
  children=[];textContent='';disabled=false;onclick=null;
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  setAttribute(){}
 }
 const live={status:'playing',revision:3,mode:'free',yourSeat:'human-x',players:[{id:'human-x',name:'X',kind:'human'},{id:'human-o',name:'O',kind:'human'}],match:{id:'match-1',players:['human-x','human-o'],board:Array(9).fill(null),moves:[],result:null}};
 const oldDocument=globalThis.document,oldFetch=globalThis.fetch,parent=new Element(),payloads=[];let active=true,posts=0;
 globalThis.document={createElement:()=>new Element()};
 globalThis.fetch=async(_url,options={})=>{
  if(options.method==='POST'){
   payloads.push(JSON.parse(options.body));posts++;
   if(posts===1)throw new Error('response lost after submission');
   const next=structuredClone(live);next.revision=4;next.match.board[0]='a';next.match.moves.push({agentId:'human-x',cell:0,move_id:payloads[1].move_id});
   return {ok:true,json:async()=>next};
  }
  return {ok:true,json:async()=>live};
 };
 try{
  mountTable(parent,()=>active,10_000);
  for(let attempt=0;attempt<100&&!parent.children[3]?.children.length;attempt++)await new Promise(resolve=>setTimeout(resolve,2));
  await parent.children[3].children[0].onclick();
  for(let attempt=0;attempt<100&&posts<1;attempt++)await new Promise(resolve=>setTimeout(resolve,2));
  for(let attempt=0;attempt<100&&parent.children[4].textContent==='';attempt++)await new Promise(resolve=>setTimeout(resolve,2));
  await parent.children[3].children[0].onclick();
  for(let attempt=0;attempt<100&&posts<2;attempt++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(posts,2);assert.equal(payloads[0].move_id,payloads[1].move_id);assert.equal(parent.children[3].textContent,'');
 }finally{
  active=false;await new Promise(resolve=>setTimeout(resolve,5));globalThis.document=oldDocument;globalThis.fetch=oldFetch;
 }
});
