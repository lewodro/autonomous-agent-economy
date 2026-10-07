import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WorldPresenceService } from '../service/world-presence.js';

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
  const joined = service.join('main', { player_id: 'visitor', position: { x: 10, y: 10 } });
  assert.equal('token' in joined.player, false);
  assert.throws(() => service.move('main', { player_id: 'visitor', session_token: joined.session_token, position: { x: 11, y: 10 } }), { code: 'PRESENCE_RATE_LIMITED' });
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
  assert.equal(service.move('main',{player_id:'visitor',session_token:joined.session_token,position:{x:145,y:100}}).player.position.x,145);
  now+=60;service.join('main',{player_id:'visitor',session_token:joined.session_token,position:{x:900,y:100}});
  now+=60;
  assert.throws(()=>service.move('main',{player_id:'visitor',session_token:joined.session_token,position:{x:900,y:100}}),{code:'INVALID_POSITION'});
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
