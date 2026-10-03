import test from 'node:test';
import assert from 'node:assert/strict';
import { configureRun } from '../src/config.js';
import { Orchestrator } from '../src/orchestrator.js';
import { receiveRevenue, allocateTreasury } from '../src/treasury.js';
import { validateState, loadState, saveState } from '../src/storage.js';
import { startTournament, nextTournamentPair, scoreTournament } from '../src/tournament.js';
import { assertAccounting } from '../src/economy.js';
test('treasury accepts only recorded simulated receipts, caps grants, and deduplicates both', async () => {
  const s = configureRun({ agents: 2 });
  const runner = new Orchestrator(s);
  while (!s.agents.some(a => a.pnl < 0)) await runner.step();
  assert.throws(() => allocateTreasury(s, 'empty'));
  assert.equal(receiveRevenue(s, 'receipt-1', 1_000_000_000), 300_000_000);
  const snapshot = JSON.stringify(s);
  receiveRevenue(s, 'receipt-1', 1_000_000_000);
  assert.equal(JSON.stringify(s), snapshot);
  assert.throws(() => receiveRevenue(s, 'receipt-1', 2_000_000_000));
  const grants = allocateTreasury(s, 'allocation-1');
  assert.ok(grants.every(g => g.amount <= 100_000_000));
  const after = JSON.stringify(s);
  allocateTreasury(s, 'allocation-1');
  assert.equal(JSON.stringify(s), after);
  assertAccounting(s);
  assert.deepEqual(await validateState(s), s);
});
test('save and reload reconstruct a complete run from the ledger', async () => {
  const s = configureRun(); const runner = new Orchestrator(s);
  for (let i = 0; i < 10; i++) await runner.step();
  let raw; const storage = { setItem: (_, value) => { raw = value; }, getItem: () => raw };
  saveState(s, storage);
  assert.deepEqual(await loadState(storage), s);
  await new Orchestrator(await loadState(storage)).step();
});
test('corrupt balances, statistics, reveals, payouts, events and policy are rejected', async () => {
  const s = configureRun(); await new Orchestrator(s).step();
  const changes = [x => x.agents[0].balance++, x => x.agents[0].wins++, x => x.matches[0].result = 'fake',
    x => x.matches[0].payouts[x.matches[0].players[0]]++, x => x.events.splice(2, 1), x => x.agents[0].policy.maxStake++,
    x => x.matches[0].reveals[x.matches[0].players[0]].nonce = 'f'.repeat(64)];
  for (const change of changes) { const corrupt = structuredClone(s); change(corrupt); await assert.rejects(validateState(corrupt)); }
});
test('duplicate receipt events are rejected without a replay loop', async () => {
  const s = configureRun(); receiveRevenue(s, 'receipt', 1000);
  s.events.push(structuredClone(s.events.at(-1)));
  await assert.rejects(validateState(s), /Duplicate/);
});
test('tournament scores actual matches once, resumes, and finishes a round robin', async () => {
  const s = configureRun(); startTournament(s); const runner = new Orchestrator(s);
  let pair;
  while ((pair = nextTournamentPair(s))) {
    const match = await runner.step(pair); scoreTournament(s, match); scoreTournament(s, match);
    assert.deepEqual(await validateState(s), s);
  }
  assert.equal(s.tournament.status, 'finished');
  assert.equal(s.tournament.matchIds.length, 6);
  assert.deepEqual(await validateState(s), s);
});
