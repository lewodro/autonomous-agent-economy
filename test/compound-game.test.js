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
  const joined = game.join('owner-a', {name:'Alice'});
  assert.equal(joined.phase, 'lobby');
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
  const game = new CompoundGame(await mkdtemp(path.join(os.tmpdir(), 'compound-')), { now: () => now, roundSeconds: 120 });
  const started = game.startAgentRound();
  assert.equal(started.participants.every(value => value.type === 'agent'), true);
  const before = game.snapshot().participants.filter(value => value.type === 'agent').map(value => `${value.position.x},${value.position.y}`);
  now += 1_100; await game.tick();
  const after = game.snapshot().participants.filter(value => value.type === 'agent').map(value => `${value.position.x},${value.position.y}`);
  assert.notDeepEqual(after, before);
  for(let second=2;second<=121;second++){now+=1_000;await game.tick();}
  const finished=game.snapshot();
  assert.equal(finished.phase,'finished');
  assert.ok(finished.events.some(event=>event.type==='job'),'an autonomous participant should complete a real room job');
  assert.ok(finished.results.at(-1).participants.every(value=>value.type==='agent'));
  await game.close();
});

test('compound walls, props, inventory, jobs and escape routes are authoritative', async () => {
  const game = new CompoundGame(await mkdtemp(path.join(os.tmpdir(), 'compound-rules-')), { now: () => 5_000, roundSeconds: 60 });
  game.join('owner-a', {name:'Alice'});game.startRound('owner-a');
  const human=game.state.participants.find(value=>value.owner==='owner-a');
  human.position={x:2,y:3};
  assert.throws(()=>game.move('owner-a',{x:2,y:2}),{code:'COMPOUND_BLOCKED'},'beds are server-side collision');
  human.role='worker';human.position={x:22,y:12};
  const worked=game.action('owner-a',{action:'work'});
  assert.equal(worked.participants.find(value=>value.id===worked.you).job_progress,1);
  human.position={x:20,y:19};human.inventory=['food','scrap','wire'];
  const escaped=game.action('owner-a',{action:'escape',route_id:'utility-route'});
  assert.equal(escaped.participants.find(value=>value.id===escaped.you).status,'escaped');
  assert.ok(escaped.events.some(event=>event.type==='escape'&&event.actor_id===human.id));
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
  worker.position={x:22,y:12};game.performJob(worker);
  now+=16_000;await game.tick();
  const result=game.snapshot().results.at(-1);
  assert.ok(result.evidence_event_ids.length>0);
  assert.ok(game.state.participants.some(value=>value.type==='agent'&&value.memories.some(memory=>memory.evidence_event_ids.length>0)));
  await game.close();
});
