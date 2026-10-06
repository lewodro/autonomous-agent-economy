import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { verifyTicTacToeProof } from '../src/tictactoe.js';
test('world HTTP gateway serves deployable assets, shared rooms and capability-scoped free tables',{timeout:20000},async()=>{
 const child=spawn(process.execPath,['server.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',MATCHES_DIR:await mkdtemp(path.join(os.tmpdir(),'world-http-'))},stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',b=>errors+=b);
 try{
  const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server startup failed: '+errors)),6000);child.once('exit',()=>{clearTimeout(timer);reject(new Error(errors));});child.stdout.on('data',b=>{const port=b.toString().match(/localhost:(\d+)/)?.[1];if(port){clearTimeout(timer);resolve('http://127.0.0.1:'+port);}});});
  for(const route of ['/','/rps','/world','/arena','/arena/rps/rps-1','/arena/tictactoe/ttt-1','/world/styles.css','/web/dist/world/app.js','/web/dist/world/table.js','/assets/aae_avatar_kit/examples/ember.png','/assets/agent-world-preview.png'])assert.equal((await fetch(base+route)).status,200,route);
  for(const route of ['/labs/world','/arena/rps/ttt-1','/api/arena/rooms/missing','/assets/aae_avatar_kit/avatar-manifest.json'])assert.equal((await fetch(base+route)).status,404,route);
  const list=await(await fetch(base+'/api/arena/rooms')).json();assert.equal(list.rooms.length,4);assert.ok(list.rooms.every(r=>r.mode==='simulation'));
  assert.equal((await fetch(base+'/api/arena/rooms/rps-1',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,405);
  const profiles=await(await fetch(base+'/api/arena/agents')).json();assert.equal(profiles.agents.length,20);assert.equal('balance' in profiles.agents[0],false);
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
