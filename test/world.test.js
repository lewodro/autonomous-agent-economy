import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInput, nearestInteraction } from '../web/dist/world/model.js';
import { moveActor, followCamera, presenceObstacles } from '../web/dist/world/movement.js';
import { MAP, safePosition, collides, LANDMARKS, TREES } from '../web/dist/world/map.js';
import { AVATARS, parseSettings, SPRITES } from '../web/dist/world/sprites.js';
import { NpcController, npcSpawnPosition, arenaExitPosition, selectPlazaAgents, MAX_PLAZA_AGENTS } from '../web/dist/world/npc.js';
import { HttpArenaGateway } from '../web/dist/world/gateway.js';
import { isActorNearVisitor } from '../web/dist/world/renderer.js';
import { approvedAvatarSpritesFromManifest, toWorldAgentProfiles } from '../service/world-agent-profiles.js';
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
test('visitor can pass ambient NPCs while keeping them in interaction range',()=>{
 const visitor=actor({x:100,y:100}),npc={...actor({x:140,y:100}),id:'npc-ember',type:'npc'};
 moveActor(visitor,{x:1,y:0,interact:false},.1,150);
 assert.ok(visitor.position.x>114,'ambient NPC presence cannot block visitor movement');
 assert.ok(Math.hypot(visitor.position.x-npc.position.x,visitor.position.y-npc.position.y)<=72,'NPC remains reachable for profile interaction');
 assert.equal(presenceObstacles([visitor,npc],npc).length,1,'NPC controllers use the same presence collision geometry');
});
test('invalid saved positions reset; interactions require spatial proximity', () => {
  for(const value of [null,{x:NaN,y:20},{x:200,y:200},{x:-1,y:100}])assert.deepEqual(safePosition(value),MAP.spawn);
  assert.equal(nearestInteraction(MAP.spawn,LANDMARKS),undefined);
  assert.equal(nearestInteraction({x:928,y:660},LANDMARKS)?.id,'arena-door');
});
test('tree trunks are shared map obstacles rather than walk-through decoration',()=>{
 for(const tree of TREES)assert.equal(collides({x:tree.x+6,y:tree.y+38}),true,`tree at ${tree.x},${tree.y} should block its trunk`);
 const visitor=actor({x:90,y:158});moveActor(visitor,{x:-1,y:0,interact:false},.1);
 assert.ok(visitor.position.x>=84,'movement must stop before crossing the first trunk');assert.ok(!collides(visitor.position));
});
test('all plaza interactions remain reachable from the visitor spawn',()=>{
 const step=8,start={x:Math.round(MAP.spawn.x/step),y:Math.round(MAP.spawn.y/step)};
 const seen=new Set([`${start.x},${start.y}`]),queue=[start];
 for(let index=0;index<queue.length;index++){
  const point=queue[index];
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
   const next={x:point.x+dx,y:point.y+dy},key=`${next.x},${next.y}`;
   if(!seen.has(key)&&!collides({x:next.x*step,y:next.y*step})){seen.add(key);queue.push(next);}
  }
 }
 for(const target of LANDMARKS){
  const reachable=[...seen].some(key=>{const [x,y]=key.split(',').map(Number);return Math.hypot(x*step-target.position.x,y*step-target.position.y)<=target.radius;});
  assert.equal(reachable,true,`${target.label} should be reachable from the visitor spawn`);
 }
});
test('camera remains inside the map',()=>{
  assert.deepEqual(followCamera({x:0,y:0},{x:-1,y:-1},600,400,1),{x:0,y:0});
  const c=followCamera({x:0,y:0},{x:9999,y:9999},600,400,100);
  assert.deepEqual(c,{x:552,y:464});
});
test('avatar settings allow registered presets only and survive a JSON roundtrip',()=>{
  const settings=parseSettings({avatar:'mentor',position:MAP.spawn,muted:false});
  assert.deepEqual(parseSettings(JSON.parse(JSON.stringify(settings))),settings);
  assert.equal(parseSettings({avatar:'../../secrets'}).avatar,'visitor_ember');
  assert.equal(new Set(SPRITES.map(s=>s.id)).size,24);
  assert.deepEqual(SPRITES.filter(s=>s.id.startsWith('visitor_')).map(s=>s.id),['visitor_ember','visitor_atlas','visitor_nova','visitor_echo']);
  assert.deepEqual(AVATARS,['visitor_ember','visitor_atlas','visitor_nova','visitor_echo']);
  assert.ok(AVATARS.every(id=>SPRITES.find(sprite=>sprite.id===id)?.selectable===true));
  assert.ok(!AVATARS.some(id=>['founder','trader','explorer','mentor'].includes(id)));
  const animated=SPRITES.find(s=>s.id==='visitor_ember');assert.deepEqual(animated.animations.walk_up,[9,10,11]);
});
test('NPC controller moves presence without changing strategy or economic fields',()=>{
  const npc={...actor({x:430,y:470}),type:'npc',balance:123,strategy:'test'};
  const control=new NpcController(0);for(let i=0;i<600;i++)control.update(npc,1/60);
  assert.equal(npc.balance,123);assert.equal(npc.strategy,'test');assert.ok(!collides(npc.position));
  assert.notDeepEqual(npc.position,{x:430,y:470});
});
test('plaza keeps six visitors, excludes fighters and reserves space for finishers',()=>{
 const profiles=Array.from({length:20},(_,index)=>({id:`agent-${index}`,arenaStatus:index<2?'finished':index<6?'fighting':'queued'}));
 const selected=selectPlazaAgents(profiles,['agent-10','agent-11']);
 assert.equal(selected.length,MAX_PLAZA_AGENTS);
 assert.deepEqual(selected.slice(0,2).map(profile=>profile.id),['agent-0','agent-1']);
 assert.ok(selected.every(profile=>profile.arenaStatus!=='fighting'));
 assert.ok(selected.some(profile=>profile.id==='agent-10'),'existing plaza visitors should keep their place');
});
test('plaza reserves one readable actor slot for a user-owned agent',()=>{
 const profiles=[...Array.from({length:20},(_,index)=>({id:`system-${index}`,arenaStatus:'queued'})),{id:'user-agent',arenaStatus:'owned',ownership_status:'user'}];
 const selected=selectPlazaAgents(profiles);assert.equal(selected.length,MAX_PLAZA_AGENTS);assert.ok(selected.some(profile=>profile.id==='user-agent'));
});
test('owned agent world profiles use approved transparent avatar paths and public fields only',()=>{
 const avatarSprites=new Map([['visitor_ember','assets/avatars/clean/ember.png'],['visitor_atlas','assets/avatars/clean/atlas.png']]);
 const [profile]=toWorldAgentProfiles([{id:'u-1',name:'Builder',avatar:'visitor_ember',strategy:'conservative',owner_wallet:'Abcd…Wxyz'}],avatarSprites);
 assert.equal(profile.sprite,'assets/avatars/clean/ember.png');assert.equal(profile.arenaStatus,'owned');assert.equal(profile.ownership_status,'user');assert.equal(profile.owner_wallet,'Abcd…Wxyz');
 assert.equal('treasury' in profile,false);assert.equal('personality' in profile,false);
 assert.deepEqual(toWorldAgentProfiles([{id:'u-2',name:'Debug',avatar:'debug_placeholder',strategy:'aggressive'}],avatarSprites),[]);
 assert.throws(()=>toWorldAgentProfiles([],undefined),/approved avatar sprite map/);
});
test('world agent sprites follow the approved avatar manifest without admitting unsafe paths',()=>{
 const sprites=approvedAvatarSpritesFromManifest({avatars:[
  {id:'visitor_new',sheet:'/assets/avatars/clean/new.png',approved:true},
  {id:'debug',sheet:'/assets/avatars/clean/debug.png',approved:false},
  {id:'unsafe',sheet:'https://assets.example/unsafe.png',approved:true},
  {id:'../escape',sheet:'/assets/avatars/clean/escape.png',approved:true},
 ]});
 assert.deepEqual([...sprites],[['visitor_new','assets/avatars/clean/new.png']]);
 assert.equal(toWorldAgentProfiles([{id:'u-3',name:'New',avatar:'visitor_new',strategy:'opportunist'}],sprites)[0].sprite,'assets/avatars/clean/new.png');
});
test('all twenty current agent profiles have safe, separated world spawn positions',()=>{
 const positions=Array.from({length:20},(_,index)=>npcSpawnPosition(index));
 assert.ok(positions.every(position=>!collides(position)));
 for(let i=0;i<positions.length;i++){
  assert.ok(Math.hypot(positions[i].x-MAP.spawn.x,positions[i].y-MAP.spawn.y)>=80);
  for(let j=i+1;j<positions.length;j++)assert.ok(Math.hypot(positions[i].x-positions[j].x,positions[i].y-positions[j].y)>=60);
 }
});
test('finished agent exits from the Arena and returns to a plaza route',()=>{
 const start=arenaExitPosition(0),npc={...actor(start),type:'npc',activity:'Leaving the Arena'},control=new NpcController(0,true);
 assert.equal(collides(start),false);let returned=false;
 for(let frame=0;frame<200;frame++){
  const before={...npc.position};control.update(npc,.1);
  assert.equal(collides(npc.position),false);
  if(npc.activity==='Back in the plaza · match complete')returned=true;
  if(Math.hypot(npc.position.x-before.x,npc.position.y-before.y)>0)assert.notEqual(npc.activity,'Fighting');
  if(returned)break;
 }
 assert.equal(returned,true,'the post-match visitor should visibly reach the plaza');
});
test('renderer name visibility tolerates NPC-only presence snapshots',()=>{
 const visitor=actor({x:10,y:20}),nearby={...actor({x:100,y:20}),type:'npc'},distant={...actor({x:500,y:20}),type:'npc'};
 assert.equal(isActorNearVisitor(nearby,visitor),true);
 assert.equal(isActorNearVisitor(distant,visitor),false);
 assert.equal(isActorNearVisitor(nearby,undefined),false);
 assert.equal(isActorNearVisitor(visitor,undefined),true);
});
test('arena gateway derives relative room routes and rejects invalid game/slot combinations',()=>{
 const gateway=new HttpArenaGateway();
 assert.equal(gateway.watchMatch({game:'rps',id:'rps-1',url:'https://untrusted.example'}),'/arena/rps/rps-1');
 assert.equal(gateway.watchMatch({game:'tictactoe',id:'ttt-2'}),'/arena/tictactoe/ttt-2');
 for(const room of [{game:'rps',id:'ttt-1'},{game:'tictactoe',id:'../secret'},{game:'chess',id:'rps-1'}])assert.throws(()=>gateway.watchMatch(room),/Unsupported/);
});
