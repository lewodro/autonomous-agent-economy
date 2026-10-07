import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldPresenceClient } from '../web/dist/world/presence-client.js';

class Storage {
  values=new Map();getItem(key){return this.values.get(key)||null;}setItem(key,value){this.values.set(key,value);}removeItem(key){this.values.delete(key);}
}
class EventStream {
  listeners=new Map();closed=false;
  addEventListener(type,listener){const list=this.listeners.get(type)||[];list.push(listener);this.listeners.set(type,list);}
  close(){this.closed=true;}
  emit(type,value){for(const listener of this.listeners.get(type)||[])listener({data:JSON.stringify(value)});}
}
const player=(player_id,x)=>({player_id,avatar:'visitor_ember',position:{x,y:100},direction:'right',animation_state:'walk',activity:'Exploring',updated_at:'now'});
function setup({now=()=>1_000,storage=new Storage(),onPlayers=()=>{},fetcher}={}){
  const streams=[];const requests=[];
  const request=fetcher||(async(url,init)=>{
    const body=JSON.parse(init.body);requests.push({url,body});
    if(url.endsWith('/join'))return{ok:true,status:201,json:async()=>({world_id:'main',players:[player('player_local',100)],player:player('player_local',100),session_token:'capability-secret'})};
    return{ok:true,status:200,json:async()=>({ok:true})};
  });
  const client=new WorldPresenceClient({avatar:'visitor_ember',position:{x:100,y:100},fetcher:request,eventSource:()=>{const stream=new EventStream();streams.push(stream);return stream;},storage,onPlayers,now,newId:()=> 'stable-id'});
  return{client,streams,requests,storage};
}

test('presence client joins with a browser capability, applies typed SSE and replaces snapshots on reconnect',async()=>{
  const snapshots=[];const{client,streams,requests,storage}=setup({onPlayers:snapshot=>snapshots.push(snapshot)});
  const initial=await client.connect();
  assert.equal(initial.world_id,'main');assert.equal(client.player_id,'player_stable-id');
  assert.equal(storage.getItem('aae-world-presence-v1:main:token'),'capability-secret');
  assert.equal(JSON.stringify(snapshots).includes('capability-secret'),false);
  streams[0].emit('PlayerJoined',{player:player('other',200)});
  streams[0].emit('PlayerMoved',{player:player('other',220)});
  assert.deepEqual(client.snapshot().players.map(value=>[value.player_id,value.position.x]),[['player_local',100],['other',220]]);
  streams[0].emit('PlayerLeft',{player_id:'other'});
  assert.equal(client.snapshot().players.length,1);
  streams[0].emit('WorldJoined',{world_id:'main',players:[player('player_local',120),player('reconnected',300)]});
  assert.deepEqual(client.snapshot().players.map(value=>value.player_id),['player_local','reconnected']);
  assert.equal(requests[0].body.session_token,undefined);
  await client.leave();assert.equal(streams[0].closed,true);
  assert.equal(storage.getItem('aae-world-presence-v1:main:token'),null);
});

test('presence client throttles moves and heartbeats and sends only capability-scoped commands',async()=>{
  let now=1_000;const{client,requests}=setup({now:()=>now});await client.connect();
  assert.equal(await client.move({x:101,y:100},'right','walk'),false,'join timestamp must not allow an immediate rejected update');
  now+=66;assert.equal(await client.move({x:110,y:100},'right','walk'),true);
  assert.equal(await client.move({x:111,y:100},'right','walk'),false);
  assert.equal(await client.heartbeat('Watching rps-1'),false);
  now+=1_000;assert.equal(await client.heartbeat('Watching rps-1'),true);
  assert.deepEqual(requests.slice(1).map(({url,body})=>[url.split('/').at(-1),body.player_id,body.session_token]),[
    ['move','player_stable-id','capability-secret'],['heartbeat','player_stable-id','capability-secret'],
  ]);
  await client.leave();
});

test('presence client rejects an invalid join response and reports structured API errors',async()=>{
  const bad=setup({fetcher:async()=>({ok:true,status:200,json:async()=>({world_id:'main',players:[]})})}).client;
  await assert.rejects(()=>bad.connect(),/invalid join response/i);
  const denied=setup({fetcher:async()=>({ok:false,status:403,json:async()=>({code:'PRESENCE_NOT_AUTHORIZED',error:'Player session is not authorized'})})}).client;
  await assert.rejects(()=>denied.connect(),/Player session is not authorized/);
});

test('presence client coalesces in-flight movement and heartbeat requests',async()=>{
  let now=1_000,releaseMove,releaseHeartbeat;
  const fetcher=async(url,init)=>{
    const body=JSON.parse(init.body);
    if(url.endsWith('/join'))return{ok:true,status:201,json:async()=>({world_id:'main',players:[player('player_local',100)],session_token:'capability'})};
    if(url.endsWith('/move'))return new Promise(resolve=>{releaseMove=()=>resolve({ok:true,status:200,json:async()=>({ok:true})});});
    if(url.endsWith('/heartbeat'))return new Promise(resolve=>{releaseHeartbeat=()=>resolve({ok:true,status:200,json:async()=>({ok:true})});});
    if(url.endsWith('/leave'))return{ok:true,status:200,json:async()=>({ok:true})};
    throw new Error(`Unexpected presence command for ${body.player_id}`);
  };
  const{client}=setup({now:()=>now,fetcher});await client.connect();now+=66;
  const moving=client.move({x:110,y:100},'right','walk');
  assert.equal(await client.move({x:111,y:100},'right','walk'),false);
  releaseMove();assert.equal(await moving,true);
  now+=1_000;const heartbeat=client.heartbeat();
  assert.equal(await client.heartbeat('duplicate'),false);
  releaseHeartbeat();assert.equal(await heartbeat,true);
  await client.leave();
});
