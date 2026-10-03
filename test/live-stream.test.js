import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import os from 'node:os';
import {MatchEventStream} from '../service/event-stream.js';
class Response extends EventEmitter {
 constructor(){super();this.frames=[];this.writableLength=0;this.destroyed=false;}
 writeHead(status,headers){this.status=status;this.headers=headers;return this;}
 write(frame){this.frames.push(frame);return this.writableLength===0;}
 destroy(){this.destroyed=true;this.emit('close');}
}
test('live streams cap viewers, disconnect slow consumers and clean up without blocking turns',()=>{
 const hub=new MatchEventStream(),responses=[];
 const replay={events:[{seq:0}],final_state:{turn:0},match_id:'test',winner:null,statistics:[]};
 try {
  for(let i=0;i<4;i++){const res=new Response();hub.connect('match',replay,res);responses.push(res);}
  assert.throws(()=>hub.connect('match',replay,new Response()),/viewer limit/);
  responses[0].writableLength=2_000_001;
  hub.publish('match',{replay,events:[]});
  assert.equal(responses[0].destroyed,true);assert.equal(hub.count,3);
  assert.match(responses[1].frames[1],/event: transition/);
 }finally{hub.close();}
 assert.equal(hub.count,0);assert.equal(hub.viewers.size,0);
});
async function launch(directory){
 const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'0',MATCHES_DIR:directory},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',b=>stderr+=b);
 const base=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Startup timed out: '+stderr)),10000);
  child.once('exit',()=>{clearTimeout(timer);reject(new Error('Server exited: '+stderr));});
  child.stdout.on('data',b=>{const port=b.toString().match(/localhost:(\d+)/)?.[1];if(port){clearTimeout(timer);resolve(`http://127.0.0.1:${port}`);}});
 });
 return {base,stop:async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}}};
}
async function frame(reader){
 const decoder=new TextDecoder();let buffer='';
 for(;;){const part=await reader.read();if(part.done)throw new Error('Stream ended');buffer+=decoder.decode(part.value,{stream:true});
  const data=buffer.match(/^data: (.+)\n/m);if(data)return JSON.parse(data[1]);
 }
}
test('read-only viewer follows host turns and reconnects to the same durable session after restart',{timeout:20000},async t=>{
 const directory=await mkdtemp(os.tmpdir()+'/last-seat-live-');t.after(()=>rm(directory,{recursive:true,force:true}));
 let service=await launch(directory);t.after(()=>service.stop());
 const post=async(route,body)=>{const response=await fetch(service.base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(response.ok,await response.clone().text());return response.json();};
 const config=await fetch(service.base+'/api/config?agents=2').then(r=>r.json());
 const start=await post('/api/matches',{config});
 const route=`/api/matches/${start.session}`;
 const stream=await fetch(service.base+route+'/events'),reader=stream.body.getReader();
 const snapshot=await frame(reader);assert.deepEqual(snapshot.replay,start.replay);
 assert.equal((await fetch(service.base+route).then(r=>r.json())).replay.final_state.turn,0);
 const turn=await post(route+'/step',{expected_turn:0});
 const transition=await frame(reader);assert.deepEqual(transition.events,turn.events);assert.equal(transition.final_state.turn,1);
 await reader.cancel();await service.stop();service=await launch(directory);
 const reconnect=await fetch(service.base+route+'/events'),again=reconnect.body.getReader();
 assert.deepEqual((await frame(again)).replay,turn.replay);await again.cancel();
 const next=await post(route+'/step',{expected_turn:1});assert.equal(next.replay.final_state.turn,2);
});
