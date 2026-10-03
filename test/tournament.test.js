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
