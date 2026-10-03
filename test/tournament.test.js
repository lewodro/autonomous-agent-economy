import test from 'node:test';
import assert from 'node:assert/strict';
import { configureRun } from '../src/config.js';
import { Orchestrator } from '../src/orchestrator.js';
import { startTournament, nextTournamentPair, scoreTournament } from '../src/tournament.js';

test('tournament rejects a fabricated settlement without changing points or history', () => {
  const state = configureRun();
  startTournament(state);
  const players = nextTournamentPair(state);
  const before = structuredClone(state);
  assert.throws(() => scoreTournament(state, { id: 'fake', players, status: 'settled', result: 'a' }), /Unknown tournament match/);
  assert.deepEqual(state, before);
});

test('recorded settlements still score idempotently', async () => {
  const state = configureRun();
  startTournament(state);
  const match = await new Orchestrator(state).step(nextTournamentPair(state));
  scoreTournament(state, match);
  const before = structuredClone(state);
  scoreTournament(state, match);
  assert.deepEqual(state, before);
});

test('a scheduled pair cannot award points for multiple different matches', async () => {
  const state = configureRun();
  startTournament(state);
  const pair = nextTournamentPair(state);
  const runner = new Orchestrator(state);
  scoreTournament(state, await runner.step(pair));
  const extra = await runner.step(pair);
  const before = structuredClone(state);
  assert.throws(() => scoreTournament(state, extra), /pair already scored/);
  assert.deepEqual(state, before);
});

test('an exhibition played before selection cannot become a tournament result', async () => {
  const state = configureRun();
  const earlier = await new Orchestrator(state).step(['agent-1', 'agent-2']);
  startTournament(state);
  nextTournamentPair(state);
  const before = structuredClone(state);
  assert.throws(() => scoreTournament(state, earlier), /after tournament pair selection/);
  assert.deepEqual(state, before);
});

test('retrying pair selection cannot skip an unscored game or finish early', async () => {
  const state = configureRun({ agents: 2 });
  startTournament(state);
  const pair = nextTournamentPair(state);
  const selected = structuredClone(state);
  assert.deepEqual(nextTournamentPair(state), pair);
  assert.deepEqual(state, selected);
  const match = await new Orchestrator(state).step(pair);
  const settled = structuredClone(state);
  assert.deepEqual(nextTournamentPair(state), pair);
  assert.deepEqual(state, settled);
  scoreTournament(state, match);
  assert.equal(nextTournamentPair(state), null);
  assert.equal(state.tournament.status, 'finished');
});

test('failed transitions retain the selected tournament pair for a safe retry', async () => {
  const state = configureRun();
  startTournament(state);
  const pair = nextTournamentPair(state);
  const before = structuredClone(state);
  await assert.rejects(new Orchestrator(state, { onStage: () => { throw new Error('Fault before settlement'); } }).step(pair), /Fault/);
  assert.deepEqual(state, before);
  assert.deepEqual(nextTournamentPair(state), pair);
  assert.deepEqual(state, before);
});
