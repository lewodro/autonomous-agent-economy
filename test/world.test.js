import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInput, nearestInteraction } from '../web/dist/world/model.js';
import { moveActor, followCamera } from '../web/dist/world/movement.js';
import { MAP, safePosition, collides, LANDMARKS } from '../web/dist/world/map.js';
import { parseSettings, SPRITES } from '../web/dist/world/sprites.js';
import { NpcController } from '../web/dist/world/npc.js';
import { HttpArenaGateway } from '../web/dist/world/gateway.js';
const actor = position => ({ id:'visitor',type:'human',name:'Visitor',position,facing:'down',movementState:'idle',spriteId:'founder',activity:'Exploring',recentWinner:false });
test('world input normalizes diagonal speed and rejects nonfinite movement', () => {
  assert.equal(Math.hypot(...Object.values(normalizeInput(1,1)).slice(0,2)),1);
  assert.deepEqual(normalizeInput(NaN,Infinity),{x:0,y:0,interact:false});
});
test('movement slides at walls, cannot tunnel, and clamps suspended frame time', () => {
  const a=actor({x:480,y:340});moveActor(a,{x:1,y:1,interact:false},100);
  assert.ok(!collides(a.position));assert.ok(a.position.x<=488);assert.ok(a.position.y>340);
  const b=actor({...MAP.spawn});moveActor(b,{x:1,y:0,interact:false},10);
  assert.equal(b.position.x,MAP.spawn.x+15);
});
test('invalid saved positions reset; interactions require spatial proximity', () => {
  for(const value of [null,{x:NaN,y:20},{x:200,y:200},{x:-1,y:100}])assert.deepEqual(safePosition(value),MAP.spawn);
  assert.equal(nearestInteraction(MAP.spawn,LANDMARKS),undefined);
  assert.equal(nearestInteraction({x:928,y:660},LANDMARKS)?.id,'arena-door');
});
test('camera remains inside the map',()=>{
  assert.deepEqual(followCamera({x:0,y:0},{x:-1,y:-1},600,400,1),{x:0,y:0});
  const c=followCamera({x:0,y:0},{x:9999,y:9999},600,400,100);
  assert.deepEqual(c,{x:552,y:464});
});
test('avatar settings allow registered presets only and survive a JSON roundtrip',()=>{
  const settings=parseSettings({avatar:'mentor',position:MAP.spawn,muted:false});
  assert.deepEqual(parseSettings(JSON.parse(JSON.stringify(settings))),settings);
  assert.equal(parseSettings({avatar:'../../secrets'}).avatar,'explorer');
  assert.equal(new Set(SPRITES.map(s=>s.id)).size,24);
  const animated=SPRITES.find(s=>s.id==='visitor_ember');assert.deepEqual(animated.animations.walk_up,[9,10,11]);
});
test('NPC controller moves presence without changing strategy or economic fields',()=>{
  const npc={...actor({x:430,y:470}),type:'npc',balance:123,strategy:'test'};
  const control=new NpcController(0);for(let i=0;i<600;i++)control.update(npc,1/60);
  assert.equal(npc.balance,123);assert.equal(npc.strategy,'test');assert.ok(!collides(npc.position));
  assert.notDeepEqual(npc.position,{x:430,y:470});
});
test('arena gateway derives relative room routes and rejects invalid game/slot combinations',()=>{
 const gateway=new HttpArenaGateway();
 assert.equal(gateway.watchMatch({game:'rps',id:'rps-1',url:'https://untrusted.example'}),'/arena/rps/rps-1');
 assert.equal(gateway.watchMatch({game:'tictactoe',id:'ttt-2'}),'/arena/tictactoe/ttt-2');
 for(const room of [{game:'rps',id:'ttt-1'},{game:'tictactoe',id:'../secret'},{game:'chess',id:'rps-1'}])assert.throws(()=>gateway.watchMatch(room),/Unsupported/);
});
