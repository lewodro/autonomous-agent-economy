import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { verifyTicTacToeProof } from '../src/tictactoe.js';
import { parseSurvivalSnapshot } from '../web/dist/world/survival.js';
import { RESOURCE_NODES } from '../service/world-economy.js';
test('world HTTP gateway serves deployable assets, shared rooms and capability-scoped free tables',{timeout:20000},async()=>{
 const child=spawn(process.execPath,['server.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',MATCHES_DIR:await mkdtemp(path.join(os.tmpdir(),'world-http-'))},stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',b=>errors+=b);
 try{
  const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server startup failed: '+errors)),6000);child.once('exit',()=>{clearTimeout(timer);reject(new Error(errors));});child.stdout.on('data',b=>{const port=b.toString().match(/localhost:(\d+)/)?.[1];if(port){clearTimeout(timer);resolve('http://127.0.0.1:'+port);}});});
  for(const route of ['/','/home','/rps','/world','/entry.js','/entry.css','/motion.js','/motion.css','/compound','/arena','/arena/rps/rps-1','/arena/tictactoe/ttt-1','/world/styles.css','/web/dist/world/app.js','/web/dist/world/table.js','/web/dist/world/compound.js','/assets/avatars/index.json','/assets/avatars/clean/ember.png','/assets/avatars/clean/ember_preview.png','/assets/agents/01-founder.png','/assets/sprites-agent/01-founder.png','/assets/sprites-agent/20-wild-card.png'])assert.equal((await fetch(base+route)).status,200,route);
  for(const route of ['/','/arena']){const html=await(await fetch(base+route)).text();assert.doesNotMatch(html,/moltbook|openclaw/i,`${route} should not render external ecosystem cards`);}
  const rootHtml=await(await fetch(base+'/')).text();assert.match(rootHtml,/THE PLAZA/,'the root route should serve the world page');
  assert.doesNotMatch(rootHtml,/id="entry-loader"/,'the world-first root should not block the plaza with an intro splash');
  assert.match(rootHtml,/href="\/post\/">Build log</,'the devlog should remain reachable');
  assert.doesNotMatch(rootHtml,/href="\/compound"|href="\/arena"/,'Arena and Compound are discovered in the world, not the global header');
  assert.match(rootHtml,/COMPOUND ↙/,'the world directions should point to the Compound');
  assert.match(rootHtml,/ARENA ↘/,'the world directions should point to the Arena');
  const arenaHtml=await(await fetch(base+'/arena')).text();assert.match(arenaHtml,/data-mode="transition"/,'the other pages should use the short matrix transition');
  const worldApp=await(await fetch(base+'/web/dist/world/app.js')).text();assert.match(worldApp,/assets\/avatars\/index\.json/);assert.doesNotMatch(worldApp,/assets\/aae_avatar_kit\/examples/);assert.match(worldApp,/compound-entrance/,'the Compound must remain reachable through its physical world entrance');
  for(const route of ['/labs/world','/arena/rps/ttt-1','/api/arena/rooms/missing','/assets/aae_avatar_kit/avatar-manifest.json','/assets/sprites-agent/missing.png','/assets/avatars/clean/mentor.png'])assert.equal((await fetch(base+route)).status,404,route);
  const list=await(await fetch(base+'/api/arena/rooms')).json();assert.equal(list.rooms.length,4);assert.ok(list.rooms.every(r=>r.mode==='simulation'));
  const compound=await(await fetch(base+'/api/compound')).json();assert.equal(compound.phase,'lobby');assert.equal(compound.participants.length,0);
  const economyResponse=await fetch(base+'/api/world/economy'),economyCookie=economyResponse.headers.get('set-cookie')?.split(';')[0],economy=await economyResponse.json();assert.equal(economy.mode,'test_credits');assert.equal(economy.nodes.length,RESOURCE_NODES.length);assert.equal(economy.treasury.payouts_enabled,false);
  const node=RESOURCE_NODES[0],presenceResponse=await fetch(base+'/api/worlds/main/presence/join',{method:'POST',headers:{'Content-Type':'application/json',Cookie:economyCookie},body:JSON.stringify({position:node.position})}),presence=await presenceResponse.json();assert.match(presence.presence_id,/^visitor_/);
  const compoundJoinResponse=await fetch(base+'/api/compound/join',{method:'POST',headers:{'Content-Type':'application/json',Cookie:economyCookie},body:JSON.stringify({name:'World Visitor',avatar:'visitor_ember'})}),compoundJoin=await compoundJoinResponse.json();assert.equal(compoundJoinResponse.status,200);assert.equal(compoundJoin.world_handoff.presence_id,presence.presence_id);assert.equal(compoundJoin.participants.find(value=>value.id===compoundJoin.you).world_presence_id,presence.presence_id);
  const compoundStartResponse=await fetch(base+'/api/compound/start',{method:'POST',headers:{'Content-Type':'application/json',Cookie:economyCookie},body:'{}'});assert.equal(compoundStartResponse.status,200);
  const queuedResponse=await fetch(base+'/api/compound/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Next World Visitor',avatar:'visitor_nova'})}),queuedCookie=queuedResponse.headers.get('set-cookie')?.split(';')[0],queued=await queuedResponse.json();assert.equal(queuedResponse.status,200);assert.equal(queued.phase,'active');assert.equal(queued.you,null);assert.equal(queued.queue.count,1);assert.equal(queued.queue.you.name,'Next World Visitor');assert.ok(queuedCookie);assert.match(queued.world_handoff.presence_id,/^visitor_/);assert.equal(queued.queue.you.world_presence_id,queued.world_handoff.presence_id);
  const ownerView=await(await fetch(base+'/api/compound',{headers:{Cookie:economyCookie}})).json();assert.equal(ownerView.queue.count,1);assert.equal(ownerView.queue.you,null,'another visitor must not receive the queued owner handoff');
  const gatheredResponse=await fetch(base+'/api/world/economy/gather',{method:'POST',headers:{'Content-Type':'application/json',Cookie:economyCookie},body:JSON.stringify({node_id:node.id})}),gathered=await gatheredResponse.json();assert.equal(gatheredResponse.status,200);assert.equal(gathered.receipt.status,'test_credited');assert.equal(gathered.profile.credits,node.reward);
  assert.equal((await fetch(base+'/api/world/economy/gather',{method:'POST',headers:{'Content-Type':'application/json',Cookie:economyCookie},body:JSON.stringify({node_id:node.id})})).status,409);
  await fetch(base+'/api/worlds/main/presence/leave',{method:'POST',headers:{'Content-Type':'application/json',Cookie:economyCookie},body:'{}'});
  const health=await(await fetch(base+'/api/health')).json();assert.deepEqual(health.arena,{status:'ok',roomCount:4,failedRooms:[]});assert.equal(health.survival.status,'ok');assert.match(health.survival.match_id,/^survival-\d+-1$/);assert.equal(health.survival.alive,20);assert.equal(health.survival.pending_research,false);assert.deepEqual(health.presence,{status:'ok',mode:'single_process_authoritative',configured_worlds:1,active_players:0,active_agents:6,event_streams:0,limits:{players_per_world:40,event_streams_per_world:100}});
  assert.equal((await fetch(base+'/api/arena/rooms/rps-1',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,405);
  const survival=parseSurvivalSnapshot(await(await fetch(base+'/api/survival/current')).json());assert.equal(survival.agents.length,20);assert.ok(survival.sequence>=21);assert.equal(survival.status,'live');assert.ok(survival.events.length>0);assert.ok(survival.events.every(event=>typeof event.type==='string'));
  assert.equal((await fetch(base+'/api/survival/current',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,405);
  const profiles=await(await fetch(base+'/api/arena/agents')).json();assert.equal(profiles.agents.length,20);assert.equal('balance' in profiles.agents[0],false);assert.ok(profiles.agents.every(agent=>agent.survival?.matches===0));
  const statistics=await(await fetch(base+'/api/arena/statistics')).json();assert.equal(statistics.scope,'retained RPS, Tic-Tac-Toe, and Survival results');assert.equal(statistics.games.survival.matches,0);assert.deepEqual(statistics.games,{rps:{matches:0,draws:0,decisions:0},tictactoe:{matches:0,draws:0,decisions:0},survival:{matches:0,draws:0,decisions:0}});
  const post=async(action,data={},cookie='')=>{const response=await fetch(base+'/api/world/table/'+action,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(data)});return {status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0],data:await response.json()};};
  const a=await post('join',{mode:'human'}),b=await post('join',{mode:'human'});assert.equal(a.data.yourSeat,'human-x');assert.equal(b.data.yourSeat,'human-o');
  assert.ok(!JSON.stringify(a.data).includes('credential'));assert.notEqual(a.cookie,b.cookie);
  assert.equal((await post('move',{cell:0,revision:b.data.revision})).status,403);
  let state=(await post('start',{},a.cookie)).data;
  for(const [cookie,cell] of [[a.cookie,0],[b.cookie,3],[a.cookie,1],[b.cookie,4],[a.cookie,2]]){const result=await post('move',{cell,revision:state.revision},cookie);assert.equal(result.status,200);state=result.data;}
  assert.equal(state.status,'finished');assert.ok(verifyTicTacToeProof(state.match));
  const history=await(await fetch(base+'/api/arena/history')).json();assert.ok(Array.isArray(history.matches));
 }finally{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}
});

test('SIGTERM drains an in-flight table write before stopping the service',{timeout:20000},async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'world-shutdown-'));
 const child=spawn(process.execPath,['server.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',MATCHES_DIR:directory},stdio:['ignore','pipe','pipe']});
 let errors='',logs='';child.stderr.on('data',b=>errors+=b);child.stdout.on('data',b=>logs+=b);
 try{
  const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server startup failed: '+errors)),6000);child.once('exit',()=>{clearTimeout(timer);reject(new Error(errors));});child.stdout.on('data',b=>{const value=b.toString().match(/localhost:(\d+)/)?.[1];if(value){clearTimeout(timer);resolve(Number(value));}});});
  const socket=net.createConnection({host:'127.0.0.1',port});
  await once(socket,'connect');
  const response=new Promise((resolve,reject)=>{let bytes='';socket.on('data',chunk=>bytes+=chunk);socket.on('end',()=>resolve(bytes));socket.on('error',reject);});
  socket.write(`POST /api/world/table/join HTTP/1.1\r\nHost: localhost:${port}\r\nContent-Type: application/json\r\nContent-Length: 16\r\nConnection: close\r\n\r\n{`);
  await new Promise(resolve=>setTimeout(resolve,40));
  child.kill('SIGTERM');
  await new Promise(resolve=>setTimeout(resolve,40));
  socket.write('"mode":"human"}');
  const result=await response;
  assert.match(result,/HTTP\/1\.1 200/);
  const checkpoint=JSON.parse(await readFile(path.join(directory,'world','table.json'),'utf8'));
  assert.equal(checkpoint.status,'waiting');assert.equal(checkpoint.players.length,1);
  await once(child,'exit');
  assert.match(logs,/"event":"server_shutdown_complete","drained":true/);
 }finally{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}
});
