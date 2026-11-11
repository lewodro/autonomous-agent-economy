import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {WorldPresenceService,WORLD_PLAYABLE_BOUNDS} from '../service/world-presence.js';
import {MAP} from '../web/dist/world/map.js';

const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
const serviceAt=(options={})=>new WorldPresenceService({identitySecret:'test-world-presence-secret-value-32',...options});

test('server presence bounds match the walkable avatar-center map bounds',()=>{
  assert.deepEqual(WORLD_PLAYABLE_BOUNDS,{minX:MAP.minX+52,minY:MAP.minY+76,maxX:MAP.minX+MAP.width-52,maxY:MAP.minY+MAP.height-52});
  const service=serviceAt();
  for(const [index,position] of [{x:-844,y:-500},{x:2636,y:-500},{x:-844,y:1676},{x:2636,y:1676}].entries())assert.deepEqual(service.join('main',`${index}`.repeat(8)+'-1111-4111-8111-111111111111',{position}).player.position,position);
  assert.throws(()=>service.join('main','99999999-9999-4999-8999-999999999999',{position:{x:2637,y:1676}}),{code:'INVALID_POSITION'});
});

test('signed visitors receive stable server-derived public identities and distinct browser sessions',()=>{
  const service=serviceAt(),a=service.join('main',alice,{avatar:'visitor_atlas',position:{x:100,y:100}}),b=service.join('main',bob,{position:{x:120,y:100}});
  assert.match(a.player.player_id,/^visitor_[a-f0-9]{24}$/);assert.notEqual(a.player.player_id,b.player.player_id);assert.notEqual(a.player.display_name,b.player.display_name);
  assert.equal('visitorId' in a.player,false);assert.equal('session_token' in a,false);
  const reconnect=service.join('main',alice,{position:{x:900,y:100}});
  assert.equal(reconnect.player.player_id,a.player.player_id);assert.deepEqual(reconnect.player.position,{x:100,y:100},'refresh keeps the authoritative server position');
  assert.equal(reconnect.players.length,2);
  assert.deepEqual(service.identityContext('main',alice),{world_id:'main',presence_id:a.player.player_id,display_name:a.player.display_name,avatar:'visitor_atlas',appearance:null,active:true,return_position:{x:-220,y:930}});
});

test('modular appearance joins presence and broadcasts without moving the player',()=>{
  const service=serviceAt(),appearance={version:1,body:'body_tan',hair:'hair_curly_red',outfit:'outfit_hoodie_forest',accessory:'accessory_headphones'};
  const events=[],emit=service.emit.bind(service);service.emit=(worldId,type,payload)=>{events.push({type,...payload});emit(worldId,type,payload);};
  const joined=service.join('main',alice,{avatar:'visitor_nova',appearance,position:{x:100,y:100}});
  assert.deepEqual(joined.player.appearance,appearance);
  assert.deepEqual(service.snapshot('main').players[0].appearance,appearance);
  const updated=service.updateAppearance('main',alice,{version:1,body:'body_tan',hair:'hair_bob_black',outfit:'outfit_hoodie_forest',accessory:null});
  assert.deepEqual(updated.player.appearance,{version:1,body:'body_tan',hair:'hair_bob_black',outfit:'outfit_hoodie_forest',accessory:null});
  assert.deepEqual(updated.player.position,{x:100,y:100},'appearance never changes position');
  assert.ok(events.some(event=>event.type==='PlayerUpdated'&&event.player.appearance?.hair==='hair_bob_black'));
  assert.throws(()=>service.updateAppearance('main',alice,{version:1,body:'body_alien',hair:'hair_bob_black',outfit:'outfit_hoodie_forest',accessory:null}),{code:'INVALID_APPEARANCE'});
  const plain=service.join('main',bob,{position:{x:120,y:100}});
  assert.equal(plain.player.appearance,null,'preset join defaults to the preset sheet');
  assert.equal(service.join('main',bob,{position:{x:120,y:100}}).player.appearance,null,'join keeps an existing appearance when omitted');
});

test('movement, heartbeat, leave, and resource authorization resolve from visitor ownership',()=>{
  let now=1_000;const service=serviceAt({now:()=>now,minUpdateMs:50,minHeartbeatMs:100});service.join('main',alice,{position:{x:100,y:100}});service.join('main',bob,{position:{x:120,y:100}});
  now+=60;assert.deepEqual(service.move('main',alice,{position:{x:115,y:100},direction:'right',animation_state:'walk'}).player.position,{x:115,y:100});
  assert.deepEqual(service.move('main',bob,{position:{x:135,y:100},direction:'right',animation_state:'walk'}).player.position,{x:135,y:100});
  assert.throws(()=>service.move('main',alice,{position:{x:116,y:100}}),{code:'PRESENCE_RATE_LIMITED'});
  now+=100;service.heartbeat('main',alice,{activity:'Exploring'});assert.equal(service.requireVisitor('main',alice).player_id,service.presenceId('main',alice));
  service.leave('main',alice);assert.throws(()=>service.requireVisitor('main',alice),{code:'PLAYER_NOT_FOUND'});assert.equal(service.snapshot('main').players.length,1);
});

test('movement credit absorbs a queued round trip but cannot be spent as sustained speed',()=>{
  let now=1_000;const service=serviceAt({now:()=>now,minUpdateMs:50});service.join('main',alice,{position:{x:100,y:100}});
  // A 500 ms round trip: the client walked 75 px before its update landed.
  now+=500;assert.equal(service.move('main',alice,{position:{x:175,y:100},direction:'right',animation_state:'walk'}).player.position.x,175);
  // Walking at the real 150 px/s rate keeps the credit intact.
  now+=500;assert.equal(service.move('main',alice,{position:{x:250,y:100},direction:'right',animation_state:'walk'}).player.position.x,250);
  // Extra distance in the same window is rejected and does not reset the budget.
  now+=50;assert.throws(()=>service.move('main',alice,{position:{x:500,y:100}}),{code:'INVALID_POSITION'});
  now+=50;assert.throws(()=>service.move('main',alice,{position:{x:450,y:100}}),{code:'INVALID_POSITION'});
  // Idle time refills only the bounded credit; a long teleport is still refused.
  now+=5_000;assert.equal(service.move('main',alice,{position:{x:399.9,y:100}}).player.position.x,399.9);
  now+=5_000;assert.throws(()=>service.move('main',alice,{position:{x:700,y:100}}),{code:'INVALID_POSITION'});
});

test('a delayed legitimate movement update catches up without breaking interaction range',()=>{
  let now=1_000;const service=serviceAt({now:()=>now,minUpdateMs:50});service.join('main',alice,{position:{x:100,y:100}});
  now+=700;
  assert.deepEqual(service.move('main',alice,{position:{x:205,y:100},direction:'right',animation_state:'walk'}).player.position,{x:205,y:100});
  now+=5_000;
  assert.equal(service.move('main',alice,{position:{x:362,y:100},direction:'right',animation_state:'walk'}).player.position.x,362,'a lagging walker can catch up');
  now+=5_000;
  assert.throws(()=>service.move('main',alice,{position:{x:700,y:100}}),{code:'INVALID_POSITION'},'idle time still cannot bank an unbounded jump');
});

test('stale visitors are removed without resetting the continuous world',()=>{
  let now=1_000;const service=serviceAt({now:()=>now,staleMs:100});service.join('main',alice);service.join('main',bob);now+=101;
  assert.equal(service.snapshot('main').players.length,0);assert.equal(service.health().status,'ok');assert.equal(service.health().mode,'single_process_authoritative');
});

test('approved avatars and configured worlds are enforced',()=>{
  const service=serviceAt();assert.throws(()=>service.join('other',alice,{}),{code:'WORLD_NOT_FOUND'});assert.throws(()=>service.join('main','not-a-visitor',{}),{code:'VISITOR_SESSION_INVALID'});assert.throws(()=>service.join('main',alice,{avatar:'unapproved'}),{code:'INVALID_AVATAR'});
});

class Response extends EventEmitter {constructor(){super();this.destroyed=false;this.writableLength=0;this.events=[];}writeHead(){return this;}write(value){this.events.push(value);return true;}destroy(){this.destroyed=true;this.emit('close');}}

test('SSE sends one shared snapshot and ordered movement deltas to every viewer',()=>{
  let now=1_000;const service=serviceAt({now:()=>now,minUpdateMs:50,maxViewers:2}),first=new Response(),second=new Response();service.join('main',alice,{position:{x:100,y:100}});
  assert.equal(service.connect('main',first),true);assert.equal(service.connect('main',second),true);assert.match(first.events[0],/WorldJoined/);now+=60;service.move('main',alice,{position:{x:115,y:100},direction:'right',animation_state:'walk'});
  for(const viewer of [first,second])assert.match(viewer.events.at(-1),/PlayerMoved/);first.emit('close');second.emit('close');assert.equal(service.health().event_streams,0);
});

test('presence capacity is bounded and health exposes counts without identities',()=>{
  const service=serviceAt({maxPlayers:2,maxViewers:1});service.join('main',alice);service.join('main',bob);assert.throws(()=>service.join('main','33333333-3333-4333-8333-333333333333'),{code:'WORLD_FULL'});
  assert.deepEqual(service.health(),{status:'ok',mode:'single_process_authoritative',configured_worlds:1,active_players:2,active_agents:0,event_streams:0,limits:{players_per_world:2,event_streams_per_world:1}});
});
