import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CompoundGame } from '../service/compound-game.js';

test('compound lobby fills with agents and hides secret roles from other viewers', async () => {
  let now = 1_000;
  const game = new CompoundGame(await mkdtemp(path.join(os.tmpdir(), 'compound-')), { now: () => now, roundSeconds: 30, profiles: () => [{id:'founder',name:'Founder',strategy:'systems'}] });
  await game.restore();
  assert.throws(() => game.join('owner-a', {name:'Alice', avatar:'../../private.png'}), {code:'INVALID_COMPOUND_AVATAR'});
  const joined = game.join('owner-a', {name:'Alice', avatar:'visitor_nova'});
  assert.equal(joined.phase, 'lobby');
  assert.equal(joined.participants.find(value => value.id === joined.you)?.avatar, 'visitor_nova');
  const active = game.startRound('owner-a');
  assert.equal(active.participants.length, 8);
  assert.equal(active.you, active.participants.find(value => value.name === 'Alice')?.id);
  const own = active.participants.find(value => value.id === active.you);
  assert.ok(own?.role, 'owner sees its assigned role');
  assert.ok(active.participants.some(value => value.public_role === 'guard'));
  assert.ok(active.participants.every(value => !('role' in value) || value.id === active.you));
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
  human.role='worker';human.job='workshop';human.position={x:22,y:12};
  const worked=game.action('owner-a',{action:'work'});
  assert.equal(worked.participants.find(value=>value.id===worked.you).job_progress,1);
  human.position={x:20,y:19};human.inventory=['improvised_tool','panel_bypass'];
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
  worker.job='workshop';worker.position={x:22,y:12};game.performJob(worker);
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

test('all three original staged escape routes are reachable by a prepared prisoner',async()=>{
  const game=new CompoundGame(await mkdtemp(path.join(os.tmpdir(),'compound-route-')),{now:()=>10_000});
  game.join('owner',{name:'Pathfinder'});game.startRound('owner');
  const human=game.participant('owner');human.role='prisoner';
  for(const route of game.snapshot().map.escape_routes){
    human.status='active';human.position={x:2,y:3};human.inventory=route.stages.flatMap(stage=>stage.requires);
    const target=route.position;
    let steps=0;
    while(Math.abs(human.position.x-target.x)+Math.abs(human.position.y-target.y)>1&&steps++<100){
      const next=game.pathStep(human,target);assert.ok(next,`${route.id} must have a route`);game.stepParticipant(human,next);
    }
    assert.ok(steps<100,`${route.id} must be reachable`);
    for(const _stage of route.stages)game.attemptEscape(human,route.id);
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
  const game=new CompoundGame(await mkdtemp(path.join(os.tmpdir(),'compound-systems-')),{now:()=>10_000});
  game.join('owner',{name:'Builder'});game.startRound('owner');
  const human=game.participant('owner');human.position={x:3,y:4};human.inventory=[];
  game.action('owner',{action:'search',container_id:'locker-2'});
  assert.equal(human.inventory.length,1);
  human.inventory=['scrap','cloth'];game.action('owner',{action:'craft',recipe_id:'improvised-tool'});
  assert.deepEqual(human.inventory,['improvised_tool']);
  human.position={x:16,y:10};const stamina=human.stamina,strength=human.stats.strength;game.action('owner',{action:'train',stat:'strength'});
  assert.equal(human.stats.strength,strength+1);assert.ok(human.stamina<stamina);
  human.job='workshop';human.position={x:22,y:12};game.action('owner',{action:'work'});
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

test('guards pursue only locally visible heat and can confiscate contraband',async()=>{
  const game=new CompoundGame(await mkdtemp(path.join(os.tmpdir(),'compound-guard-ai-')),{now:()=>10_000});game.startAgentRound();
  const guard=game.state.participants.find(value=>value.role==='guard'),suspect=game.state.participants.find(value=>value.role!=='guard');
  guard.position={x:15,y:5};suspect.position={x:16,y:5};suspect.heat=50;suspect.inventory=['wire','food'];
  game.agentAct(guard);assert.ok(game.snapshot().events.some(event=>event.type==='contraband_found'&&event.target_id===suspect.id));assert.deepEqual(suspect.inventory,['food']);
  await game.close();
});
