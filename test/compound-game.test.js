import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { COMPOUND_MAP, CompoundGame } from '../service/compound-game.js';

test('compound lobby fills with agents and hides secret roles from other viewers', async () => {
  let now = 1_000;
  const game = new CompoundGame(await mkdtemp(path.join(os.tmpdir(), 'compound-')), { now: () => now, roundSeconds: 30, profiles: () => [{id:'founder',name:'Founder',strategy:'systems'}] });
  await game.restore();
  assert.throws(() => game.join('owner-a', {name:'Alice', avatar:'../../private.png'}), {code:'INVALID_COMPOUND_AVATAR'});
  const joined = game.join('owner-a', {name:'Alice', avatar:'visitor_nova', world_presence_id:'visitor_public_alice'});
  assert.equal(joined.phase, 'lobby');
  assert.equal(joined.participants.find(value => value.id === joined.you)?.avatar, 'visitor_nova');
  assert.equal(joined.participants.find(value => value.id === joined.you)?.world_presence_id, 'visitor_public_alice');
  const active = game.startRound('owner-a');
  assert.equal(active.participants.length, 8);
  assert.equal(active.you, active.participants.find(value => value.name === 'Alice')?.id);
  const own = active.participants.find(value => value.id === active.you);
  assert.ok(own?.role, 'owner sees its assigned role');
  assert.ok(own?.personal_objective, 'owner sees its private personal objective');
  assert.ok(active.participants.every(value => ['inmate','guard'].includes(value.base_role)));
  assert.ok(active.participants.some(value => value.public_role === 'guard'));
  assert.ok(active.participants.every(value => !('role' in value) || value.id === active.you));
  assert.ok(active.participants.every(value => !('personal_objective' in value) || value.id === active.you));
  await game.close();
});

test('compound validates movement, inventory actions, and records a durable result', async () => {
  let now = 1_000;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'compound-'));
  const game = new CompoundGame(directory, { now: () => now, roundSeconds: 15 });
  game.join('owner-a', {name:'Alice'}); game.startRound('owner-a');
  assert.throws(() => game.move('owner-a', {x:99,y:1}), {code:'INVALID_COMPOUND_STEP'});
  game.state.worldItems[0].position={x:3,y:3};
  game.move('owner-a', {x:3,y:3});
  const picked = game.action('owner-a', {action:'pickup'});
  assert.ok(picked.participants.find(value => value.id === picked.you)?.inventory_count>1);
  now += 16_000; await game.tick();
  assert.equal(game.snapshot().phase, 'finished');
  const next = game.startRound('owner-a');
  assert.equal(next.phase, 'active');
  assert.equal(next.round, 2);
  assert.equal(next.participants.filter(value => value.type === 'agent').length, 7);
  await game.close();
  const saved = JSON.parse(await readFile(path.join(directory, 'compound.json'), 'utf8'));
  assert.equal(saved.results.length, 1);
});

test('agent-only compound round advances without a human action', async () => {
  let now = 1_000;
  const game = new CompoundGame(await mkdtemp(path.join(os.tmpdir(), 'compound-')), { now: () => now, roundSeconds: 300 });
  const started = game.startAgentRound();
  assert.equal(started.participants.every(value => value.type === 'agent'), true);
  const before = game.snapshot().participants.filter(value => value.type === 'agent').map(value => `${value.position.x},${value.position.y}`);
  now += 1_100; await game.tick();
  const after = game.snapshot().participants.filter(value => value.type === 'agent').map(value => `${value.position.x},${value.position.y}`);
  assert.notDeepEqual(after, before);
  for(let second=2;second<=301;second++){now+=1_000;await game.tick();}
  const finished=game.snapshot();
  assert.equal(finished.phase,'finished');
  const evidence=finished.results.at(-1).events;
  assert.ok(evidence.some(event=>event.type==='job_completed'),'an autonomous participant should complete a real room job');
  assert.ok(evidence.some(event=>event.type==='item_found')&&evidence.some(event=>event.type==='item_crafted'),'agents should search and craft');
  assert.ok(evidence.some(event=>event.type==='escape_stage'),'agents should advance a real escape stage');
  assert.ok(finished.results.at(-1).participants.every(value=>value.type==='agent'));
  await game.close();
});

test('compound walls, props, inventory, jobs and escape routes are authoritative', async () => {
  const game = new CompoundGame(await mkdtemp(path.join(os.tmpdir(), 'compound-rules-')), { now: () => 5_000, roundSeconds: 60 });
  game.join('owner-a', {name:'Alice'});game.startRound('owner-a');
  const human=game.state.participants.find(value=>value.owner==='owner-a');
  human.position={x:2,y:3};
  assert.throws(()=>game.move('owner-a',{x:2,y:2}),{code:'COMPOUND_BLOCKED'},'beds are server-side collision');
  human.role='worker';human.job='workshop';human.position={x:22,y:10};
  const worked=game.action('owner-a',{action:'work'});
  assert.equal(worked.participants.find(value=>value.id===worked.you).job_progress,1);
  human.position={x:20,y:19};human.inventory=['utility_key','improvised_tool','panel_bypass'];human.knowledge.routes=['maintenance-route'];
  game.action('owner-a',{action:'escape',route_id:'maintenance-route'});
  game.action('owner-a',{action:'escape',route_id:'maintenance-route'});
  const escaped=game.action('owner-a',{action:'escape',route_id:'maintenance-route'});
  assert.equal(escaped.participants.find(value=>value.id===escaped.you).status,'escaped');
  assert.ok(escaped.events.some(event=>event.type==='escape_success'&&event.actor_id===human.id));
  await game.close();
});

test('balanced roles, secret state and evidence-backed agent lessons survive round end', async () => {
  let now=10_000;
  const game=new CompoundGame(await mkdtemp(path.join(os.tmpdir(),'compound-learning-')),{now:()=>now,roundSeconds:15});
  game.startAgentRound();
  const roles=game.state.participants.map(value=>value.role);
  assert.ok(roles.filter(role=>role==='guard').length>=1);
  assert.ok(roles.some(role=>role!=='guard'));
  const worker=game.state.participants.find(value=>value.role==='worker');
  worker.job='workshop';worker.position={x:22,y:10};game.performJob(worker);
  now+=16_000;await game.tick();
  const result=game.snapshot().results.at(-1);
  assert.ok(result.events.some(event=>event.type==='job_completed'));
  assert.ok(game.state.participants.some(value=>value.type==='agent'&&value.memories.some(memory=>memory.evidence_event_ids.length>0)));
  await game.close();
});

test('public compound starts agent rounds on an empty server and restarts after results',async()=>{
  let now=1_000;
  const game=new CompoundGame(await mkdtemp(path.join(os.tmpdir(),'compound-auto-')),{now:()=>now,roundSeconds:15});
  await game.restore();
  assert.equal(game.snapshot().phase,'lobby');
  now+=31_000;await game.tick();
  assert.equal(game.snapshot().phase,'active');
  assert.equal(game.snapshot().participants.filter(value=>value.type==='agent').length,8);
  now+=16_000;await game.tick();assert.equal(game.snapshot().phase,'finished');
  now+=13_000;await game.tick();assert.equal(game.snapshot().round,2);
  await game.close();
});

test('two human owners share positions and items without seeing each others secret roles',async()=>{
  let now=20_000;
  const game=new CompoundGame(await mkdtemp(path.join(os.tmpdir(),'compound-two-')),{now:()=>now,roundSeconds:60});
  game.join('browser-a',{name:'Alice'});game.join('browser-b',{name:'Bob'});
  const alice=game.startRound('browser-a'),bob=game.snapshot('browser-b');
  assert.equal(alice.round,bob.round);
  assert.equal(alice.participants.length,8);
  assert.equal(bob.participants.find(value=>value.id===alice.you).role,undefined);
  const first=game.participant('browser-a');
  first.position={x:12,y:5};
  const picked=game.action('browser-a',{action:'pickup'});
  assert.ok(picked.participants.find(value=>value.id===picked.you).inventory.includes('food'));
  assert.equal(game.snapshot('browser-b').world_items.some(value=>value.id==='item-food-a'),false);
  now+=200;game.move('browser-a',{x:13,y:5});
  assert.deepEqual(game.snapshot('browser-b').participants.find(value=>value.id===alice.you).position,{x:13,y:5});
  assert.equal(game.snapshot('browser-b').participants.find(value=>value.id===alice.you).inventory,undefined);
  await game.close();
});

test('authoritative realtime input moves two humans concurrently and expires safely',async()=>{
  let now=20_000;
  const game=new CompoundGame(await mkdtemp(path.join(os.tmpdir(),'compound-realtime-')),{now:()=>now,roundSeconds:60});
  game.join('a',{name:'Alice'});game.join('b',{name:'Bob'});game.startRound('a');
  const alice=game.participant('a'),bob=game.participant('b');alice.position={x:10,y:7};bob.position={x:14,y:7};
  game.input('a',{right:true,sequence:1,stream_id:'browser-a'});game.input('b',{left:true,sequence:1,stream_id:'browser-b'});
  now+=100;await game.tick();
  assert.ok(alice.position.x>10,'Alice moves continuously from held input');
  assert.ok(bob.position.x<14,'Bob moves during the same authoritative tick');
  assert.throws(()=>game.input('a',{right:true,sequence:1,stream_id:'browser-a'}),{code:'COMPOUND_INPUT_SEQUENCE'});
  assert.doesNotThrow(()=>game.input('a',{right:true,sequence:1,stream_id:'browser-a-reloaded'}),'a new browser input stream may restart its sequence');
  const stopped=alice.position.x;now+=500;await game.tick();assert.equal(alice.position.x,stopped,'stale input cannot leave a disconnected player walking');
  await game.close();
});

test('round keys and clues are deterministic, exclusive, and privately discovered',async()=>{
  const game=new CompoundGame(await mkdtemp(path.join(os.tmpdir(),'compound-discovery-')),{now:()=>20_000,roundSeconds:60});
  game.join('alice',{name:'Alice'});game.join('bob',{name:'Bob'});game.startRound('alice');
  const alice=game.participant('alice'),bob=game.participant('bob');alice.role='prisoner';alice.knowledge={searched:[],clues:[],routes:[],knownItems:{}};
  assert.deepEqual(game.snapshot().map.escape_routes,[],'spectators cannot see undiscovered escape routes');
  assert.deepEqual(game.snapshot('alice').map.escape_routes,[],'an owner only sees routes they discovered');
  const clueContainer=game.state.roundSecrets.placements.utility_note,prop=COMPOUND_MAP.props.find(value=>value.id===clueContainer),container=game.state.containers.find(value=>value.id===clueContainer);
  alice.position=game.adjacentTarget(alice,prop);alice.inventory=[];
  while(container.items.length&&!alice.inventory.includes('utility_note'))game.searchContainer(alice,clueContainer);
  assert.ok(alice.knowledge.routes.includes('maintenance-route'));
  assert.equal(alice.knowledge.clues.at(-1).includes(clueContainer),false,'clues reveal an area rather than the exact hidden container');
  assert.deepEqual(game.snapshot('alice').map.escape_routes.map(value=>value.id),['maintenance-route']);
  assert.deepEqual(game.snapshot('bob').map.escape_routes,[],'another player does not inherit Alice knowledge');
  assert.equal(game.snapshot('bob').participants.find(value=>value.id===alice.id).inventory,undefined);
  assert.equal(game.state.containers.flatMap(value=>value.items).filter(item=>item==='utility_key').length+game.state.participants.flatMap(value=>value.inventory).filter(item=>item==='utility_key').length,1,'access items exist once in shared state');
  const firstPlacements={...game.state.roundSecrets.placements};game.finish('test');game.startRound('alice');
  assert.notDeepEqual(game.state.roundSecrets.placements,firstPlacements,'the next deterministic round seed changes key and clue locations');
  await game.close();
});

test('seeded round generation validates many solvable critical-item layouts',async()=>{
  const game=new CompoundGame(await mkdtemp(path.join(os.tmpdir(),'compound-generation-')),{now:()=>20_000,roundSeconds:60});game.join('owner',{name:'Generator'});
  for(let round=0;round<32;round++){
    game.startRound('owner');assert.equal(game.state.roundSecrets.validated,true);
    const allItems=game.state.containers.flatMap(value=>value.items);
    for(const item of['utility_key','staff_key','maintenance_pass','utility_note','service_note','perimeter_map'])assert.equal(allItems.filter(value=>value===item).length,1,`${item} must exist exactly once in round ${round+1}`);
    game.finish('generation_test');
  }
  await game.close();
});

test('authorized door access creates a temporary shared physical opening',async()=>{
  let now=20_000;const game=new CompoundGame(await mkdtemp(path.join(os.tmpdir(),'compound-door-')),{now:()=>now,roundSeconds:60});
  game.join('alice',{name:'Alice'});game.join('bob',{name:'Bob'});game.startRound('alice');
  const alice=game.participant('alice'),bob=game.participant('bob'),securityDoor=COMPOUND_MAP.doors.find(value=>value.room_id==='security');
  alice.position={x:26,y:4};alice.inventory=['staff_key'];bob.position={x:26,y:4};bob.inventory=[];bob.role='prisoner';bob.job='janitor';
  game.action('alice',{action:'open'});
  assert.equal(game.snapshot('bob').map.doors.find(value=>value.id===securityDoor.id).unlocked,true);
  assert.equal(game.blocked(securityDoor.position,bob),false,'a nearby player can use the same temporary opening');
  assert.ok(game.state.evidenceEvents.some(event=>event.type==='door_unlocked'&&event.door_id===securityDoor.id));
  now+=5_100;assert.equal(game.blocked(securityDoor.position,bob),true,'the shared opening closes on the authoritative clock');
  await game.close();
});

test('agent planning explores local knowledge instead of reading secret placement truth',async()=>{
  const game=new CompoundGame(await mkdtemp(path.join(os.tmpdir(),'compound-knowledge-')),{now:()=>20_000,roundSeconds:60});game.startAgentRound();
  const agent=game.state.participants.find(value=>value.role==='escape_planner'),actual=game.state.roundSecrets.placements.utility_key;
  const decoy=COMPOUND_MAP.props.find(value=>['locker','cabinet','crate','guard_desk','counter','workbench','key_board','terminal'].includes(value.kind)&&value.id!==actual);
  agent.knowledge={searched:game.state.containers.map(value=>value.id).filter(id=>id!==decoy.id),clues:[],routes:[],knownItems:{}};
  const target=game.sourceFor('utility_key',agent);
  assert.ok(Math.abs(target.x-decoy.x)+Math.abs(target.y-decoy.y)<=1,'unknown items lead to an unsearched location, not the server secret');
  await game.close();
});

test('all three original staged escape routes are reachable by a prepared prisoner',async()=>{
  const game=new CompoundGame(await mkdtemp(path.join(os.tmpdir(),'compound-route-')),{now:()=>10_000});
  game.join('owner',{name:'Pathfinder'});game.startRound('owner');
  const human=game.participant('owner');human.role='prisoner';
  const accessByRoute={'service-gate':'staff_key','maintenance-route':'utility_key','perimeter-plan':'maintenance_pass'};
  for(const route of COMPOUND_MAP.escape_routes){
    human.status='active';human.position={x:2,y:3};human.knowledge.routes=[route.id];human.inventory=[accessByRoute[route.id],...route.stages.flatMap(stage=>stage.requires)];
    let steps=0;
    for(const stage of route.stages){
      const target=game.adjacentTarget(human,stage.position);
      while(Math.abs(human.position.x-stage.position.x)+Math.abs(human.position.y-stage.position.y)>1&&steps++<180){
        const next=game.pathStep(human,target);assert.ok(next,`${route.id}/${stage.id} must have a route`);game.stepParticipant(human,next);
      }
      game.attemptEscape(human,route.id);
    }
    assert.ok(steps<180,`${route.id} must be reachable`);
    assert.equal(human.status,'escaped');
  }
  await game.close();
});

test('a guard cannot turn an escape route into a guard victory',async()=>{
  const game=new CompoundGame(await mkdtemp(path.join(os.tmpdir(),'compound-guard-')),{now:()=>10_000});
  game.join('owner',{name:'Gate Guard'});game.startRound('owner');
  const human=game.participant('owner');human.role='guard';human.position={x:20,y:19};human.inventory=['improvised_tool','panel_bypass'];
  assert.throws(()=>game.action('owner',{action:'escape',route_id:'maintenance-route'}),{code:'COMPOUND_ROLE_FORBIDDEN'});
  assert.equal(human.status,'active');
  assert.equal(game.snapshot().events.some(event=>event.type==='escape_success'),false);
  await game.close();
});

test('containers, crafting, training, stamina and assigned jobs are authoritative',async()=>{
  let now=10_000;const game=new CompoundGame(await mkdtemp(path.join(os.tmpdir(),'compound-systems-')),{now:()=>now});
  game.join('owner',{name:'Builder'});game.startRound('owner');
  const human=game.participant('owner');human.position={x:3,y:4};human.inventory=[];
  game.action('owner',{action:'search',container_id:'locker-2'});
  assert.equal(human.inventory.length,1);
  human.inventory=['scrap','cloth'];assert.throws(()=>game.action('owner',{action:'craft',recipe_id:'improvised-tool'}),{code:'COMPOUND_CRAFT_LOCATION'});
  human.position={x:22,y:10};game.action('owner',{action:'craft',recipe_id:'improvised-tool'});
  assert.deepEqual(human.inventory,[]);assert.equal(human.pendingAction.type,'craft');
  now+=1_300;await game.tick();
  assert.deepEqual(human.inventory,['improvised_tool']);
  human.position={x:16,y:10};const stamina=human.stamina,strength=human.stats.strength;game.action('owner',{action:'train',stat:'strength'});
  assert.equal(human.stats.strength,strength+1);assert.ok(human.stamina<stamina);
  human.job='workshop';human.position={x:22,y:10};game.action('owner',{action:'work'});
  assert.equal(human.jobProgress,1);assert.equal(human.credits,4);
  await game.close();
});

test('missing a required routine raises heat and records evidence',async()=>{
  let now=10_000;const game=new CompoundGame(await mkdtemp(path.join(os.tmpdir(),'compound-routine-')),{now:()=>now,roundSeconds:80});
  game.join('owner',{name:'Late Visitor'});game.startRound('owner');const human=game.participant('owner');human.role='prisoner';human.position={x:16,y:12};
  now+=11_000;await game.tick();
  assert.ok(human.heat>=9);assert.ok(game.snapshot().events.some(event=>event.type==='routine_missed'&&event.actor_id===human.id));
  await game.close();
});

test('nearby trades swap items atomically and security escalates from witnessed violations',async()=>{
  const game=new CompoundGame(await mkdtemp(path.join(os.tmpdir(),'compound-social-')),{now:()=>10_000});
  game.join('a',{name:'Alice'});game.join('b',{name:'Bob'});game.startRound('a');
  const alice=game.participant('a'),bob=game.participant('b');alice.position={x:12,y:5};bob.position={x:13,y:5};alice.inventory=['food'];bob.inventory=['cloth'];
  game.action('a',{action:'trade',target_id:bob.id,item:'food',swap:true});
  assert.deepEqual(alice.inventory,['cloth']);assert.deepEqual(bob.inventory,['food']);
  alice.heat=70;game.action('a',{action:'talk',target_id:bob.id,message:'keep moving'});
  assert.equal(game.snapshot().security,'alert');assert.ok(game.snapshot().events.some(event=>event.type==='security_changed'));
  await game.close();
});

test('agent favors transfer shared items and only earned knowledge reaches the helper',async()=>{
  const game=new CompoundGame(await mkdtemp(path.join(os.tmpdir(),'compound-favor-')),{now:()=>20_000,roundSeconds:60});
  game.join('helper',{name:'Helper'});game.join('observer',{name:'Observer'});game.startRound('helper');
  const helper=game.participant('helper'),observer=game.participant('observer'),agent=game.state.participants.find(value=>value.type==='agent');
  helper.position={x:10,y:9};observer.position={x:2,y:3};agent.position={x:11,y:9};agent.favor={wants:'wire',rewardCredits:5,status:'open'};agent.knowledge.routes=['maintenance-route'];agent.knowledge.clues=['maintenance note suggests utility access may be around security.'];agent.knowledge.knownItems.utility_key={room_id:'security',observed_at:20_000};helper.inventory=['wire'];
  game.action('helper',{action:'favor',target_id:agent.id});
  assert.equal(helper.inventory.includes('wire'),false);assert.equal(agent.inventory.includes('wire'),true);assert.equal(helper.credits,5);assert.equal(agent.favor.status,'complete');
  assert.ok(helper.knowledge.routes.includes('maintenance-route'));assert.equal(helper.knowledge.knownItems.utility_key.room_id,'security');assert.equal(observer.knowledge.routes.includes('maintenance-route'),false);
  assert.ok(game.state.evidenceEvents.some(event=>event.type==='favor_completed'&&event.actor_id===helper.id));assert.ok(game.state.evidenceEvents.some(event=>event.type==='information_shared'&&event.target_id===helper.id));
  await game.close();
});

test('guards pursue only locally visible heat and can confiscate contraband',async()=>{
  const game=new CompoundGame(await mkdtemp(path.join(os.tmpdir(),'compound-guard-ai-')),{now:()=>10_000});game.startAgentRound();
  const guard=game.state.participants.find(value=>value.role==='guard'),suspect=game.state.participants.find(value=>value.role!=='guard');
  guard.position={x:13,y:5};suspect.position={x:16,y:5};suspect.heat=50;suspect.inventory=['wire','food'];
  game.agentAct(guard);assert.ok(game.snapshot().events.some(event=>event.type==='pursuit_started'&&event.target_id===suspect.id));assert.deepEqual(suspect.inventory,['wire','food'],'detection begins pursuit rather than remote confiscation');
  guard.position={x:15,y:5};guard.nextAgentActAt=0;game.agentAct(guard);assert.ok(game.snapshot().events.some(event=>event.type==='contraband_found'&&event.target_id===suspect.id));assert.deepEqual(suspect.inventory,['food']);
  await game.close();
});

test('human-heavy lobbies keep humans in the shared round and reserve security seats for agents',async()=>{
  const game=new CompoundGame(await mkdtemp(path.join(os.tmpdir(),'compound-human-heavy-')),{now:()=>20_000,roundSeconds:120,guardSeats:2});
  for(let index=0;index<4;index++)game.join(`human-${index}`,{name:`Human ${index}`});
  game.startRound('human-0');
  const humans=game.state.participants.filter(value=>value.type==='human'),agents=game.state.participants.filter(value=>value.type==='agent'),guards=game.state.participants.filter(value=>value.role==='guard');
  assert.equal(game.state.participants.length,8);assert.equal(humans.length,4);assert.equal(agents.length,4);assert.equal(guards.length,2);assert.ok(guards.every(value=>value.type==='agent'));assert.equal(agents.filter(value=>value.role!=='guard').length,2);
  await game.close();
});

test('recovering inmates and early escapes do not end a sandbox round immediately',async()=>{
  let now=20_000;const game=new CompoundGame(await mkdtemp(path.join(os.tmpdir(),'compound-pacing-')),{now:()=>now,roundSeconds:180,minimumRoundSeconds:60});game.startAgentRound();
  const inmates=game.state.participants.filter(value=>value.role!=='guard');for(const inmate of inmates)inmate.status='recovering';game.evaluateRound();assert.equal(game.state.phase,'active');
  for(const inmate of inmates)inmate.status='escaped';game.evaluateRound();assert.equal(game.state.phase,'active','a fast generated escape cannot resolve the whole round');
  now+=61_000;game.evaluateRound();assert.equal(game.state.phase,'finished');assert.equal(game.state.results.at(-1).reason,'all_escaped');
  await game.close();
});
