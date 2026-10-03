import test from 'node:test';
import assert from 'node:assert/strict';
import { configureRun } from '../src/config.js';
import { Orchestrator, eligibility } from '../src/orchestrator.js';
import { assertAccounting } from '../src/economy.js';
test('seeded experiments reproduce pairing, moves, balances, and learned memories', async () => {
  const runs = [configureRun(), configureRun()];
  for (const state of runs) { const runner = new Orchestrator(state); for (let i = 0; i < 30; i++) await runner.step(); }
  const summary = state => ({ agents: state.agents, rng: state.rng, games: state.matches.map(m => [m.players, m.result, m.players.map(id => m.reveals[id].move)]) });
  assert.deepEqual(summary(runs[0]), summary(runs[1]));
  runs.forEach(assertAccounting);
});
test('failed asynchronous transitions restore all debits, events, and RNG', async () => {
  const state = configureRun();
  const before = JSON.stringify(state);
  const runner = new Orchestrator(state, { onStage: () => { throw new Error('Injected fault'); } });
  await assert.rejects(runner.step(), /Injected fault/);
  assert.equal(JSON.stringify(state), before);
});
test('in-flight duplicate steps cannot open a second game', async () => {
  const state = configureRun();
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const runner = new Orchestrator(state, { onStage: async stage => { if (stage === 'evaluate') await barrier; } });
  const first = runner.step();
  await assert.rejects(runner.step(), /already running/);
  release(); await first;
  assert.equal(state.matches.length, 1);
});
test('survival runs stop with a funded survivor and no overdrafts', async () => {
  const state = configureRun({ agents: 2, bankroll: '0.09', stake: '0.03', mode: 'survival', seed: 9 });
  const runner = new Orchestrator(state);
  let rounds = 0;
  while (state.agents.filter(a => eligibility(state, a).eligible).length > 1 && rounds++ < 300) await runner.step();
  assert.ok(rounds < 300);
  assert.equal(state.agents.filter(a => eligibility(state, a).eligible).length, 1);
  assert.ok(state.agents.every(a => a.balance >= 0));
  assertAccounting(state);
});
