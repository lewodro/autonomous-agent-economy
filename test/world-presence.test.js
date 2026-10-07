import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WorldPresenceService, WORLD_PLAYABLE_BOUNDS } from '../service/world-presence.js';
import { MAP } from '../web/dist/world/map.js';

test('server presence bounds match the walkable avatar-center bounds in the world map',()=>{
  assert.deepEqual(WORLD_PLAYABLE_BOUNDS,{
    minX:40+12,minY:64+12,maxX:MAP.width-40-12,maxY:MAP.height-40-12,
  });
  const service=new WorldPresenceService();
  for(const [index,position] of [
    {x:52,y:76},{x:1100,y:76},{x:52,y:812},{x:1100,y:812},
  ].entries()){
    assert.deepEqual(service.join('main',{player_id:`edge${index}`,position}).player.position,position);
  }
  assert.throws(()=>service.join('main',{player_id:'outside',position:{x:1101,y:812}}),{code:'INVALID_POSITION'});
});

test('presence joins, validates bounded movement, and removes stale players', () => {
  let now = 1_000;
  const service = new WorldPresenceService({ now: () => now, staleMs: 100, minUpdateMs: 50 });
  const a = service.join('main', { player_id: 'alice', avatar: 'visitor_atlas', position: { x: 100, y: 100 } });
  const b = service.join('main', { player_id: 'bob', position: { x: 120, y: 100 } });
  assert.equal(a.players.length, 1); assert.equal(b.players.length, 2);
  assert.throws(() => service.join('main', { player_id: 'alice', position: { x: 900, y: 100 } }), { code: 'PRESENCE_NOT_AUTHORIZED' });
  assert.equal(service.join('main', { player_id: 'alice', session_token: a.session_token, position: { x: 900, y: 100 } }).player.position.x, 100,'reconnect cannot move a player');
  now += 60;
  assert.deepEqual(service.move('main', { player_id: 'alice', session_token: a.session_token, position: { x: 115, y: 100 }, direction: 'right', animation_state: 'walk' }).player.position, { x: 115, y: 100 });
  now += 60;
  assert.throws(() => service.move('main', { player_id: 'alice', session_token: a.session_token, position: { x: 900, y: 100 } }), { code: 'INVALID_POSITION' });
  assert.throws(() => service.move('main', { player_id: 'alice', session_token: 'wrong', position: { x: 116, y: 100 } }), { code: 'PRESENCE_NOT_AUTHORIZED' });
  assert.throws(() => service.join('main', { player_id: '../other', position: { x: 1, y: 1 } }), { code: 'INVALID_PLAYER' });
  now += 101;
  assert.equal(service.snapshot('main').players.length, 0);
});

test('presence limits update frequency and does not expose session tokens', () => {
  const service = new WorldPresenceService({ now: () => 1_000, minUpdateMs: 100 });
  const joined = service.join('main', { player_id: 'visitor', position: { x: 100, y: 100 } });
  assert.equal('token' in joined.player, false);
  assert.throws(() => service.move('main', { player_id: 'visitor', session_token: joined.session_token, position: { x: 101, y: 100 } }), { code: 'PRESENCE_RATE_LIMITED' });
  assert.throws(() => service.join('bad/world', {}), { code: 'WORLD_NOT_FOUND' });
  assert.throws(() => service.join('unconfigured-world-1', {}), { code: 'WORLD_NOT_FOUND' });
  assert.throws(() => service.join('main', { player_id: 'unapproved', avatar: 'broken_preview' }), { code: 'INVALID_AVATAR' });
  for(const position of [{x:'10',y:10},{x:true,y:10},{x:10,y:null},{x:NaN,y:10}]){
    assert.throws(()=>service.join('main',{player_id:'invalid',position}),{code:'INVALID_POSITION'});
  }
  assert.equal(service.worlds.has('unconfigured-world-1'),false,'unknown world requests cannot allocate process-local state');
});

test('malformed session token values fail authorization without throwing',()=>{
  const service=new WorldPresenceService();
  const joined=service.join('main',{player_id:'visitor'});
  const invalidTokens=[{},[],42,null];
  for(const session_token of invalidTokens){
    assert.throws(()=>service.join('main',{player_id:'visitor',session_token}),{code:'PRESENCE_NOT_AUTHORIZED',status:403});
    assert.throws(()=>service.move('main',{player_id:'visitor',session_token,position:{x:161,y:180}}),{code:'PRESENCE_NOT_AUTHORIZED',status:403});
    assert.throws(()=>service.heartbeat('main',{player_id:'visitor',session_token}),{code:'PRESENCE_NOT_AUTHORIZED',status:403});
    assert.throws(()=>service.leave('main',{player_id:'visitor',session_token}),{code:'PRESENCE_NOT_AUTHORIZED',status:403});
  }
  assert.equal(service.join('main',{player_id:'visitor',session_token:joined.session_token}).player.player_id,'visitor');
});

test('heartbeat and reconnect timestamps do not distort the movement speed budget',()=>{
  let now=1_000;const service=new WorldPresenceService({now:()=>now,minUpdateMs:50});
  const joined=service.join('main',{player_id:'visitor',position:{x:100,y:100}});
  now+=60;service.move('main',{player_id:'visitor',session_token:joined.session_token,position:{x:115,y:100}});
  now+=60;service.heartbeat('main',{player_id:'visitor',session_token:joined.session_token});
  now+=60;
  assert.equal(service.move('main',{player_id:'visitor',session_token:joined.session_token,position:{x:130,y:100}}).player.position.x,130);
  now+=60;service.join('main',{player_id:'visitor',session_token:joined.session_token,position:{x:900,y:100}});
  now+=60;
  assert.throws(()=>service.move('main',{player_id:'visitor',session_token:joined.session_token,position:{x:900,y:100}}),{code:'INVALID_POSITION'});
});

test('movement allowance matches world speed and idle time cannot bank teleport distance',()=>{
  let now=1_000;const service=new WorldPresenceService({now:()=>now,minUpdateMs:50});
  const joined=service.join('main',{player_id:'visitor',position:{x:100,y:100}});
  now+=250;
  assert.throws(()=>service.move('main',{player_id:'visitor',session_token:joined.session_token,position:{x:150,y:100}}),{code:'INVALID_POSITION'});
  assert.equal(service.move('main',{player_id:'visitor',session_token:joined.session_token,position:{x:143.5,y:100}}).player.position.x,143.5);
  now+=5_000;
  assert.throws(()=>service.move('main',{player_id:'visitor',session_token:joined.session_token,position:{x:190,y:100}}),{code:'INVALID_POSITION'});
});

test('heartbeats are rate limited and only broadcast changed activity',()=>{
  let now=1_000;const service=new WorldPresenceService({now:()=>now,minHeartbeatMs:1_000});
  const joined=service.join('main',{player_id:'visitor'}),events=[];
  service.listeners.set('main',new Set([{destroyed:false,writableLength:0,write:value=>events.push(value)}]));
  service.heartbeat('main',{player_id:'visitor',session_token:joined.session_token});
  assert.equal(events.length,0);
  assert.throws(()=>service.heartbeat('main',{player_id:'visitor',session_token:joined.session_token}),{code:'PRESENCE_RATE_LIMITED'});
  now+=1_000;service.heartbeat('main',{player_id:'visitor',session_token:joined.session_token,activity:'Watching rps-1'});
  assert.equal(events.length,1);
  assert.equal(service.snapshot('main').players[0].lastHeartbeatAt,undefined);
});

test('unchanged movement refreshes presence without broadcasting duplicate snapshots',()=>{
  let now=1_000;const service=new WorldPresenceService({now:()=>now,minUpdateMs:50});
  const joined=service.join('main',{player_id:'visitor',position:{x:100,y:100}}),events=[];
  service.listeners.set('main',new Set([{destroyed:false,writableLength:0,write:value=>events.push(value)}]));
  now+=60;
  service.move('main',{player_id:'visitor',session_token:joined.session_token,position:{x:100,y:100},direction:'down',animation_state:'idle'});
  assert.equal(events.length,0,'idle network ticks should not fan out redundant PlayerMoved events');
  assert.equal(service.snapshot('main').players[0].updated_at,new Date(now).toISOString());
  now+=60;
  service.move('main',{player_id:'visitor',session_token:joined.session_token,position:{x:100,y:100},direction:'right',animation_state:'walk'});
  assert.equal(events.length,1,'a real animation/direction change is still broadcast');
});

test('presence SSE viewers are capped and released on disconnect',()=>{
  class Response extends EventEmitter {
    constructor(){super();this.destroyed=false;this.writableLength=0;}
    writeHead(){return this;}
    write(){return true;}
    destroy(){this.destroyed=true;this.emit('close');}
  }
  const service=new WorldPresenceService({maxViewers:1}),first=new Response(),second=new Response();
  assert.equal(service.connect('main',first),true);
  assert.equal(service.connect('main',second),false);
  first.emit('close');
  assert.equal(service.connect('main',second),true);
  second.emit('close');
});

test('presence health reports live counts and safe deployment limits',()=>{
  let now=100;const service=new WorldPresenceService({now:()=>now,staleMs:50,maxPlayers:4,maxViewers:7});
  service.join('main',{player_id:'active'});
  assert.deepEqual(service.health(),{status:'ok',mode:'single_process_ephemeral',configured_worlds:1,active_players:1,event_streams:0,limits:{players_per_world:4,event_streams_per_world:7}});
  now+=51;
  assert.equal(service.health().active_players,0,'health prunes expired sessions before reporting');
});

test('failed SSE snapshot writes release the viewer slot',()=>{
  class BrokenResponse extends EventEmitter {
    constructor(){super();this.destroyed=false;this.writableLength=0;}
    writeHead(){throw new Error('socket closed');}
    write(){return false;}
    destroy(){this.destroyed=true;this.emit('close');}
  }
  const service=new WorldPresenceService({maxViewers:1}),failed=new BrokenResponse(),next=new BrokenResponse();
  assert.equal(service.connect('main',failed),true);
  assert.equal(failed.destroyed,true);
  assert.equal(service.listeners.has('main'),false);
  next.writeHead=()=>{};
  assert.equal(service.connect('main',next),true,'a failed response must not consume the viewer slot');
  next.emit('close');
});
