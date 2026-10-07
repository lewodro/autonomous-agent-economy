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
  streams[0].emit('PlayerJoined',{world_id:'main',player:player('other',200)});
  streams[0].emit('PlayerMoved',{world_id:'main',player:player('other',220)});
  assert.deepEqual(client.snapshot().players.map(value=>[value.player_id,value.position.x]),[['player_local',100],['other',220]]);
  streams[0].emit('PlayerJoined',{world_id:'different-world',player:player('stray',500)});
  assert.equal(client.snapshot().players.some(value=>value.player_id==='stray'),false,'events from another world cannot contaminate this snapshot');
  streams[0].emit('PlayerLeft',{world_id:'main',player_id:'other'});
  assert.equal(client.snapshot().players.length,1);
  streams[0].emit('WorldJoined',{world_id:'main',players:[player('player_local',120),player('reconnected',300)]});
  assert.deepEqual(client.snapshot().players.map(value=>value.player_id),['player_local','reconnected']);
  assert.equal(requests[0].body.session_token,undefined);
  await client.leave();assert.equal(streams[0].closed,true);
  assert.equal(storage.getItem('aae-world-presence-v1:main:token'),null);
});

test('presence avatar changes update the live server session without changing identity',async()=>{
  const storage=new Storage(),requests=[],streams=[];
  const client=new WorldPresenceClient({avatar:'visitor_ember',position:{x:100,y:100},storage,newId:()=> 'avatar-test',
    fetcher:async(url,init)=>{
      const body=JSON.parse(init.body);requests.push(body);
      return{ok:true,status:201,json:async()=>({world_id:'main',players:[{...player(body.player_id,100),avatar:body.avatar}],player:{...player(body.player_id,100),avatar:body.avatar},session_token:'same-capability'})};
    },
    eventSource:()=>{const stream=new EventStream();streams.push(stream);return stream;}});
  await client.connect();await client.updateAvatar('visitor_atlas');
  assert.deepEqual(requests.map(request=>[request.player_id,request.avatar]),[
    ['player_avatar-test','visitor_ember'],['player_avatar-test','visitor_atlas'],
  ]);
  assert.equal(streams.length,2);assert.equal(streams[0].closed,true);
  assert.equal(client.snapshot().players[0].avatar,'visitor_atlas');
  await client.leave();
});

test('overlapping connect calls share one join capability and one event stream',async()=>{
  let finishJoin;
  const fetcher=async(url,init)=>{
    requests.push({url,body:JSON.parse(init.body)});
    if(url.endsWith('/leave'))return{ok:true,status:200,json:async()=>({left:true})};
    if(!url.endsWith('/join'))throw new Error('Unexpected duplicate command');
    return new Promise(resolve=>{finishJoin=()=>resolve({ok:true,status:201,json:async()=>({world_id:'main',players:[player('player_local',100)],session_token:'single-capability'})});});
  };
  const{client,streams,requests}=setup({fetcher});
  const first=client.connect(),second=client.connect();
  assert.equal(requests.length,1,'concurrent callers must not race two anonymous joins');
  finishJoin();
  const [a,b]=await Promise.all([first,second]);
  assert.deepEqual(a,b);assert.equal(streams.length,1);
  await client.leave();
});

test('a replaced stream cannot apply late events to the new connection',async()=>{
  const{client,streams}=setup();await client.connect();await client.connect();
  assert.equal(streams.length,2);assert.equal(streams[0].closed,true);
  streams[0].emit('PlayerJoined',{world_id:'main',player:player('stale-stream-player',200)});
  assert.equal(client.snapshot().players.some(value=>value.player_id==='stale-stream-player'),false);
  streams[1].emit('PlayerJoined',{world_id:'main',player:player('current-stream-player',220)});
  assert.equal(client.snapshot().players.some(value=>value.player_id==='current-stream-player'),true);
  await client.leave();
});

test('closing while join is pending does not create a late spectator stream',async()=>{
  let finishJoin;
  const fetcher=(url,init)=>{
    if(!url.endsWith('/join'))return Promise.resolve({ok:true,status:200,json:async()=>({left:true})});
    return new Promise(resolve=>{finishJoin=()=>resolve({ok:true,status:201,json:async()=>({world_id:'main',players:[player('player_local',100)],session_token:'late-capability'})});});
  };
  const{client,streams}=setup({fetcher});
  const connecting=client.connect();client.close();finishJoin();
  await connecting;
  assert.equal(streams.length,0,'unmounted clients must not open an SSE stream after their join resolves');
});

test('reconnecting after close waits for an in-flight join before opening a fresh stream',async()=>{
  const completions=[];
  const fetcher=(url)=>{
    if(!url.endsWith('/join'))return Promise.resolve({ok:true,status:200,json:async()=>({left:true})});
    return new Promise(resolve=>completions.push(()=>resolve({ok:true,status:201,json:async()=>({
      world_id:'main',players:[player('player_local',100)],session_token:'reconnect-capability',
    })})));
  };
  const{client,streams}=setup({fetcher});
  const first=client.connect();client.close();const reconnected=client.connect();
  assert.equal(completions.length,1,'the second join waits until the first has established its capability');
  completions[0]();await first;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(completions.length,2,'connect after close starts a fresh join once the first request settles');
  completions[1]();await reconnected;
  assert.equal(streams.length,1,'only the reconnected client opens an event stream');
  await client.leave();
});

test('leaving while join is pending waits for the capability and releases the server session',async()=>{
  let finishJoin;const requests=[];
  const fetcher=(url,init)=>{
    requests.push(url);
    if(url.endsWith('/leave'))return Promise.resolve({ok:true,status:200,json:async()=>({left:true})});
    return new Promise(resolve=>{finishJoin=()=>resolve({ok:true,status:201,json:async()=>({world_id:'main',players:[player('player_local',100)],session_token:'pending-capability'})});});
  };
  const{client,streams}=setup({fetcher});
  const connecting=client.connect(),leaving=client.leave();finishJoin();
  await Promise.all([connecting,leaving]);
  assert.ok(requests.some(url=>url.endsWith('/leave')),'leave must use the capability returned by the pending join');
  assert.equal(streams[0].closed,true);
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

test('a duplicate tab retries a conflicting stored identity without taking over the active session',async()=>{
  const storage=new Storage(),requests=[],ids=['fresh-tab'];
  storage.setItem('aae-world-presence-v1:main:player','player-copied-tab');
  storage.setItem('aae-world-presence-v1:main:token','copied-capability');
  const fetcher=async(url,init)=>{
    const body=JSON.parse(init.body);requests.push(body);
    if(requests.length===1)return{ok:false,status:403,json:async()=>({code:'PRESENCE_NOT_AUTHORIZED',error:'Player identity is already active'})};
    return{ok:true,status:201,json:async()=>({world_id:'main',players:[player('player-fresh-tab',100)],session_token:'fresh-capability'})};
  };
  const client=new WorldPresenceClient({avatar:'visitor_ember',position:{x:100,y:100},fetcher,eventSource:()=>new EventStream(),storage,newId:()=>ids.shift()||'unexpected'});
  await client.connect();
  assert.deepEqual(requests.map(body=>body.player_id),['player-copied-tab','player_fresh-tab']);
  assert.equal(requests[0].session_token,'copied-capability');
  assert.equal(requests[1].session_token,undefined);
  assert.equal(client.player_id,'player_fresh-tab');
  assert.equal(storage.getItem('aae-world-presence-v1:main:player'),'player_fresh-tab');
  assert.equal(storage.getItem('aae-world-presence-v1:main:token'),'fresh-capability');
  await client.leave();
});

test('a closed client does not retry an identity conflict after unmount',async()=>{
  let rejectJoin;const requests=[],streams=[];
  const fetcher=(url,init)=>{
    requests.push(url);
    return new Promise(resolve=>{rejectJoin=()=>resolve({ok:false,status:403,json:async()=>({code:'PRESENCE_NOT_AUTHORIZED',error:'Player identity is already active'})});});
  };
  const client=new WorldPresenceClient({avatar:'visitor_ember',position:{x:100,y:100},fetcher,eventSource:()=>{streams.push(new EventStream());return streams.at(-1);},storage:new Storage(),newId:()=> 'collision'});
  const connecting=client.connect();client.close();rejectJoin();
  await assert.rejects(()=>connecting,/Player identity is already active/);
  assert.equal(requests.length,1,'closed clients do not issue a second join request');
  assert.equal(streams.length,0);
});

test('presence stays connected when browser storage throws',async()=>{
  const storage={getItem(){throw new Error('storage disabled');},setItem(){throw new Error('storage disabled');},removeItem(){throw new Error('storage disabled');}};
  const states=[],streams=[];
  const client=new WorldPresenceClient({avatar:'visitor_ember',position:{x:100,y:100},storage,newId:()=> 'memory-only',
    fetcher:async(url)=>({ok:true,status:200,json:async()=>url.endsWith('/join')?{world_id:'main',players:[player('local',100)],session_token:'memory-capability'}:{left:true}}),
    eventSource:()=>{const stream=new EventStream();streams.push(stream);return stream;},onConnection:state=>states.push(state)});
  await client.connect();assert.equal(streams.length,1);assert.equal(client.player_id,'player_memory-only');
  await client.leave();assert.equal(streams[0].closed,true);assert.deepEqual(states,['closed']);
});

test('malformed stored identity is discarded before requesting presence',async()=>{
  const storage=new Storage(),requests=[];storage.setItem('aae-world-presence-v1:main:player','../../other');storage.setItem('aae-world-presence-v1:main:token','stale');
  const client=new WorldPresenceClient({avatar:'visitor_ember',position:{x:100,y:100},storage,newId:()=> 'recovered',
    fetcher:async(url,init)=>{requests.push(JSON.parse(init.body));return{ok:true,status:201,json:async()=>({world_id:'main',players:[],session_token:'fresh'})};},
    eventSource:()=>new EventStream()});
  await client.connect();assert.equal(requests[0].player_id,'player_recovered');assert.equal(requests[0].session_token,undefined);
  await client.leave();
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
