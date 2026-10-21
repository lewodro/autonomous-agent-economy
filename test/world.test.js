import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInput, nearestInteraction } from '../web/dist/world/model.js';
import { moveActor, followCamera, presenceObstacles } from '../web/dist/world/movement.js';
import { MAP, WORLD_BOUNDS, BUILDINGS, BUSHES, CAMPFIRES, EXPLORATION_PROBES, FLOWER_BEDS, GROUND_DETAILS, MARKET_PROPS, NPC_WAYPOINTS, PATHS, ROCKS, VEGETATION_GROUPS, canPlaceBush, canPlaceFlower, canPlaceRock, canPlaceTree, isNaturalGround, safePosition, collides, LANDMARKS, TREES, ZONES } from '../web/dist/world/map.js';
import { AVATARS, parseSettings, SPRITES } from '../web/dist/world/sprites.js';
import { NpcController, npcSpawnPosition, selectPlazaAgents, MAX_PLAZA_AGENTS } from '../web/dist/world/npc.js';
import { HttpArenaGateway } from '../web/dist/world/gateway.js';
import { isActorNearVisitor } from '../web/dist/world/renderer.js';
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
  for(const value of [null,{x:NaN,y:20},{x:200,y:200},{x:MAP.minX-1,y:100}])assert.deepEqual(safePosition(value),MAP.spawn);
  assert.deepEqual(safePosition({x:-1,y:100}),{x:-1,y:100});
  assert.equal(nearestInteraction(MAP.spawn,LANDMARKS),undefined);
  assert.equal(nearestInteraction({x:928,y:660},LANDMARKS)?.id,'arena-door');
});
test('tree trunks are shared map obstacles rather than walk-through decoration',()=>{
 for(const tree of TREES)assert.equal(collides({x:tree.x+6,y:tree.y+38}),true,`tree at ${tree.x},${tree.y} should block its trunk`);
 const visitor=actor({x:90,y:158});moveActor(visitor,{x:-1,y:0,interact:false},.1);
 assert.ok(visitor.position.x>=84,'movement must stop before crossing the first trunk');assert.ok(!collides(visitor.position));
});
test('garden planting and campfire collision leave flower beds walkable',()=>{
  assert.ok(BUSHES.some(bush=>bush.solid));assert.ok(FLOWER_BEDS.length>=3);assert.ok(CAMPFIRES.length>=3);
  for(const bush of BUSHES.filter(item=>item.solid))assert.equal(collides({x:bush.x,y:bush.y}),true);
  for(const fire of CAMPFIRES)assert.equal(collides(fire),true);
  for(const bed of FLOWER_BEDS)assert.equal(collides({x:bed.x+bed.width/2,y:bed.y+bed.height/2}),false,'flowers should never seal a garden path');
});
test('terrain-aware decoration keeps trees and planting off every road surface',()=>{
  for(const tree of TREES)assert.equal(canPlaceTree({x:tree.x+6*(tree.scale||1),y:tree.y+38*(tree.scale||1)}),true);
  for(const bush of BUSHES)assert.equal(canPlaceBush(bush),true);
  for(const bed of FLOWER_BEDS)assert.equal(canPlaceFlower({x:bed.x+bed.width/2,y:bed.y+bed.height/2}),true);
  for(const rock of ROCKS)assert.equal(canPlaceRock(rock),true);
  assert.equal(VEGETATION_GROUPS.length,17);assert.deepEqual(new Set(VEGETATION_GROUPS.map(group=>group.district)),new Set(['north','south','west','east']));
  assert.ok(VEGETATION_GROUPS.filter(group=>group.district==='north').flatMap(group=>group.trees).filter(tree=>TREES.some(placed=>placed.x===tree.x&&placed.y===tree.y)).length>=8);
  for(const tree of TREES)assert.equal(isNaturalGround({x:tree.x+6*(tree.scale||1),y:tree.y+38*(tree.scale||1)},28),true,'tree trunk needs green terrain clear of road and buildings');
});
test('east road connects the plaza, Agency door, and botanical trail at walkable centers',()=>{
  const paved=point=>PATHS.some(path=>point.x>=path.x&&point.x<path.x+path.width&&point.y>=path.y&&point.y<path.y+path.height);
  const route=[{x:1100,y:460},{x:1300,y:460},{x:1568,y:460},{x:1568,y:365},{x:1568,y:320},
    {x:1568,y:365},{x:1702,y:460},{x:1702,y:640},{x:1870,y:668},{x:1870,y:830}];
  for(const point of route){assert.ok(paved(point),`paved route at ${JSON.stringify(point)}`);assert.equal(collides(point),false,`open route at ${JSON.stringify(point)}`);}
  assert.ok(PATHS.some(path=>path.x===1152&&path.y===420&&path.width===592&&path.height===84));
  assert.ok(PATHS.some(path=>path.x===1526&&path.y===288&&path.width===84&&path.height===132));
  for(const [name,point] of Object.entries(EXPLORATION_PROBES))assert.equal(collides(point),false,`${name} browser probe must be walkable`);
});
test('town art data is deterministic, varied, and keeps decorative texture non-authoritative',()=>{
  assert.equal(GROUND_DETAILS.length,170);assert.deepEqual(GROUND_DETAILS.slice(0,2),[
    {x:544,y:725,kind:'stone',tone:0},{x:-425,y:454,kind:'crack',tone:1},
  ]);
  assert.ok(PATHS.length>=20,'the west and south districts need connected streets');
  assert.equal(BUILDINGS.filter(building=>building.kind==='house').length,11);
  assert.equal(BUILDINGS.filter(building=>building.kind==='stall').length,5);
  assert.ok(new Set(BUILDINGS.filter(building=>building.kind==='stall').map(building=>building.roof)).size>=4);
  assert.ok(MARKET_PROPS.some(prop=>prop.kind==='well'));assert.ok(ZONES.market.height>=500);
  for(const detail of GROUND_DETAILS)assert.equal(Number.isFinite(detail.x)&&Number.isFinite(detail.y),true);
});
test('Agency and market landmarks are real reachable map locations',()=>{
  assert.deepEqual(LANDMARKS.filter(item=>['agent-agency','south-market'].includes(item.id)).map(item=>item.id),['agent-agency','south-market']);
  for(const building of BUILDINGS)assert.equal(collides({x:building.x+building.width/2,y:building.y+building.height/2}),true,`${building.name} should block movement`);
  for(const well of MARKET_PROPS.filter(prop=>prop.kind==='well'))assert.equal(collides(well),true);
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
  assert.deepEqual(followCamera({x:0,y:0},{x:-9999,y:-9999},600,400,100),{x:MAP.minX,y:MAP.minY});
  assert.deepEqual(followCamera({x:0,y:0},{x:9999,y:9999},600,400,100),{x:MAP.minX+MAP.width-600,y:MAP.minY+MAP.height-400});
});
test('the old edge is now walkable in all four directions while the new edge blocks',()=>{
  assert.equal(MAP.width*MAP.height,4*1792*1152);
  for(const point of [{x:-200,y:600},{x:2020,y:600},{x:600,y:-200},{x:600,y:1400}])assert.equal(collides(point),false,`extension ${JSON.stringify(point)} should be walkable`);
  for(const point of [{x:WORLD_BOUNDS.minX-1,y:600},{x:WORLD_BOUNDS.maxX+1,y:600},{x:600,y:WORLD_BOUNDS.minY-1},{x:600,y:WORLD_BOUNDS.maxY+1}])assert.equal(collides(point),true,'the new edge should block movement');
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
test('NPC attention pauses movement, talks once, cools down and resumes wandering',()=>{
  const npc={...actor(npcSpawnPosition(0)),type:'npc'},control=new NpcController(0);
  assert.equal(control.offerThought(1),true);control.update(npc,.1);assert.equal(npc.activityState,'attention');assert.equal(npc.movementState,'idle');
  control.beginTalking();control.update(npc,.1);assert.equal(npc.activityState,'talking');
  for(let step=0;step<100;step++)control.update(npc,.1);
  assert.ok(['idle','wander'].includes(npc.activityState));
  for(let step=0;step<300&&npc.position.x===npcSpawnPosition(0).x&&npc.position.y===npcSpawnPosition(0).y;step++)control.update(npc,.1);
  assert.notDeepEqual(npc.position,npcSpawnPosition(0),'the NPC should resume a randomized route after its bounded cooldown');
});

test('canonical NPC identities choose independent seeded routes and pauses',()=>{
 const first={...actor(npcSpawnPosition(0)),id:'npc-founder',type:'npc'};
 const second={...actor(npcSpawnPosition(1)),id:'npc-analyst',type:'npc'};
 const founder=new NpcController(0,false,{id:'founder',strategy:'aggressive'});
 const analyst=new NpcController(1,false,{id:'analyst',strategy:'analyst'});
 const samples=[];
 for(let step=0;step<1200;step++){
  founder.update(first,1/30,[first,second]);analyst.update(second,1/30,[first,second]);
  if(step%120===0)samples.push(`${Math.round(first.position.x)},${Math.round(first.position.y)}:${Math.round(second.position.x)},${Math.round(second.position.y)}`);
 }
 assert.ok(new Set(samples).size>3,'agents should continue choosing new destinations');
 assert.notDeepEqual(first.position,second.position,'different identities should not converge on one patrol line');
 assert.ok(Math.hypot(first.position.x-second.position.x,first.position.y-second.position.y)>32,'independent routes should remain visibly separated');
});
test('canonical NPC route reaches all new districts without crossing collision',()=>{
  assert.ok(NPC_WAYPOINTS.every(point=>!collides(point)),'every route destination must be walkable');
  const npc={...actor(npcSpawnPosition(0)),type:'npc'},control=new NpcController(0,false,{id:'agent-0'});
  const visited={west:false,east:false,north:false,south:false,garden:false};
  for(let frame=0;frame<10000;frame++){
    control.update(npc,.1);assert.equal(collides(npc.position),false);
    visited.west ||=npc.position.x<-300;visited.east ||=npc.position.x>2200;
    visited.north ||=npc.position.y<-200;visited.south ||=npc.position.y>1300;
    visited.garden ||=npc.position.x>1700&&npc.position.x<2100&&npc.position.y>700&&npc.position.y<900;
  }
  assert.deepEqual(visited,{west:true,east:true,north:true,south:true,garden:true});
});
test('plaza keeps six visitors, excludes fighters and reserves space for finishers',()=>{
 const profiles=Array.from({length:20},(_,index)=>({id:`agent-${index}`,arenaStatus:index<2?'finished':index<6?'fighting':'queued'}));
 const selected=selectPlazaAgents(profiles,['agent-10','agent-11']);
 assert.equal(selected.length,MAX_PLAZA_AGENTS);
 assert.deepEqual(selected.slice(0,2).map(profile=>profile.id),['agent-0','agent-1']);
 assert.ok(selected.every(profile=>profile.arenaStatus!=='fighting'));
 assert.ok(selected.some(profile=>profile.id==='agent-10'),'existing plaza visitors should keep their place');
});
test('all twenty current agent profiles have safe, separated world spawn positions',()=>{
 const positions=Array.from({length:20},(_,index)=>npcSpawnPosition(index));
 assert.ok(positions.every(position=>!collides(position)));
 for(let i=0;i<positions.length;i++){
  assert.ok(Math.hypot(positions[i].x-MAP.spawn.x,positions[i].y-MAP.spawn.y)>=80);
  for(let j=i+1;j<positions.length;j++)assert.ok(Math.hypot(positions[i].x-positions[j].x,positions[i].y-positions[j].y)>=60);
 }
});
test('finished agent exits the Arena, studies the result, then returns to the plaza',()=>{
 const start=npcSpawnPosition(0),npc={...actor(start),type:'npc',activity:'Leaving the Arena'},control=new NpcController(0,true);
 assert.equal(collides(start),false);let studied=false;
 for(let frame=0;frame<400;frame++){
  const before={...npc.position};control.update(npc,.1);
  assert.equal(collides(npc.position),false);
  if(npc.activity==='Studying the last match')studied=true;
  if(Math.hypot(npc.position.x-before.x, npc.position.y-before.y)>0)assert.notEqual(npc.activity,'Fighting');
 }
 assert.equal(studied,true,'the returned agent should have a short study state');
 assert.ok(npc.activityState==='idle'||npc.activityState==='wander','the agent should resume plaza behavior');
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
