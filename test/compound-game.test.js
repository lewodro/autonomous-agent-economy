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
  assert.throws(() => game.move('owner-a', {x:99,y:1}), {code:'INVALID_COMPOUND_POSITION'});
  const worked = game.action('owner-a', {action:'work'});
  assert.ok(worked.participants.find(value => value.id === worked.you)?.inventory_count);
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
  const game = new CompoundGame(await mkdtemp(path.join(os.tmpdir(), 'compound-')), { now: () => now, roundSeconds: 15 });
  game.join('owner-a', {name:'Alice'}); game.startRound('owner-a');
  const before = game.snapshot().participants.filter(value => value.type === 'agent').map(value => `${value.position.x},${value.position.y}`);
  now += 1_100; await game.tick();
  const after = game.snapshot().participants.filter(value => value.type === 'agent').map(value => `${value.position.x},${value.position.y}`);
  assert.notDeepEqual(after, before);
});
