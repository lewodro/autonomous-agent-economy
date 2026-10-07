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
test('world HTTP gateway serves deployable assets, shared rooms and capability-scoped free tables',{timeout:20000},async()=>{
 const child=spawn(process.execPath,['server.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',MATCHES_DIR:await mkdtemp(path.join(os.tmpdir(),'world-http-'))},stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',b=>errors+=b);
 try{
  const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server startup failed: '+errors)),6000);child.once('exit',()=>{clearTimeout(timer);reject(new Error(errors));});child.stdout.on('data',b=>{const port=b.toString().match(/localhost:(\d+)/)?.[1];if(port){clearTimeout(timer);resolve('http://127.0.0.1:'+port);}});});
  for(const route of ['/','/rps','/world','/arena','/arena/rps/rps-1','/arena/tictactoe/ttt-1','/world/styles.css','/web/dist/world/app.js','/web/dist/world/table.js','/assets/avatars/index.json','/assets/avatars/clean/ember.png','/assets/avatars/clean/ember_preview.png','/assets/agents/01-founder.png','/assets/sprites-agent/01-founder.png','/assets/sprites-agent/20-wild-card.png'])assert.equal((await fetch(base+route)).status,200,route);
  const worldApp=await(await fetch(base+'/web/dist/world/app.js')).text();assert.match(worldApp,/assets\/avatars\/index\.json/);assert.doesNotMatch(worldApp,/assets\/aae_avatar_kit\/examples/);
  for(const route of ['/labs/world','/arena/rps/ttt-1','/api/arena/rooms/missing','/assets/aae_avatar_kit/avatar-manifest.json','/assets/sprites-agent/missing.png','/assets/avatars/clean/mentor.png'])assert.equal((await fetch(base+route)).status,404,route);
  const list=await(await fetch(base+'/api/arena/rooms')).json();assert.equal(list.rooms.length,4);assert.ok(list.rooms.every(r=>r.mode==='simulation'));
  const health=await(await fetch(base+'/api/health')).json();assert.deepEqual(health.arena,{status:'ok',roomCount:4,failedRooms:[]});assert.equal(health.survival.status,'ok');assert.match(health.survival.match_id,/^survival-\d+-1$/);assert.equal(health.survival.alive,20);assert.equal(health.survival.pending_research,false);assert.deepEqual(health.presence,{status:'ok',mode:'single_process_ephemeral',configured_worlds:1,active_players:0,event_streams:0,limits:{players_per_world:40,event_streams_per_world:100}});
  assert.equal((await fetch(base+'/api/arena/rooms/rps-1',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,405);
  const survival=parseSurvivalSnapshot(await(await fetch(base+'/api/survival/current')).json());assert.equal(survival.agents.length,20);assert.ok(survival.sequence>=21);assert.equal(survival.status,'live');assert.ok(survival.events.some(event=>event.type==='SurvivalMatchStarted'));
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
