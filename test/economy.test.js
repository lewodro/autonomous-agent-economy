import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, enterMatch, commitMove, revealMove, settleMatch, assertAccounting } from '../src/economy.js';
import { resolve, commitment, verifyProof, MOVES } from '../src/rps.js';
import { authorize, toLamports } from '../src/policy.js';

export async function played(state, moves = ['rock', 'scissors']) {
  const match = enterMatch(state, state.agents.slice(0, 2).map(a => a.id));
  for (const [i, id] of match.players.entries()) commitMove(state, match, id, await commitment(match.id, id, moves[i], String(i + 1).repeat(64)));
  for (const [i, id] of match.players.entries()) await revealMove(state, match, id, moves[i], String(i + 1).repeat(64));
  return settleMatch(state, match);
}
test('all nine RPS outcomes are deterministic', () => {
  const expected = [['draw', 'b', 'a'], ['a', 'draw', 'b'], ['b', 'a', 'draw']];
  for (const [i, a] of MOVES.entries()) for (const [j, b] of MOVES.entries()) assert.equal(resolve(a, b), expected[i][j]);
  assert.throws(() => resolve('lizard', 'rock'));
});
test('SOL parsing preserves integer lamports and rejects ambiguous inputs', () => {
  assert.equal(toLamports('0.03'), 30_000_000);
  assert.equal(toLamports('0.000000001'), 1);
  for (const input of ['NaN', '-1', '1e-9', '1.0000000001', '999999999999999999']) assert.throws(() => toLamports(input));
});
test('settlement conserves capital, records memory, and cannot pay twice', async () => {
  const state = createState(2);
  const match = await played(state);
  assert.equal(state.agents[0].balance, 1_030_000_000);
  assert.equal(state.agents[1].balance, 970_000_000);
  assert.equal(state.agents[0].opponents['agent-2'].scissors, 1);
  assert.equal(await verifyProof(match), true);
  const snapshot = JSON.stringify(state);
  settleMatch(state, match);
  assert.equal(JSON.stringify(state), snapshot);
  assertAccounting(state);
});
test('draw returns both stakes', async () => {
  const state = createState(2);
  await played(state, ['paper', 'paper']);
  assert.equal(state.agents[0].balance, 1_000_000_000);
  assert.equal(state.agents[1].balance, 1_000_000_000);
  assertAccounting(state);
});
test('two commitments and valid reveals are required', async () => {
  const state = createState(2);
  const match = enterMatch(state, ['agent-1', 'agent-2']);
  const salt = '1'.repeat(64);
  commitMove(state, match, 'agent-1', await commitment(match.id, 'agent-1', 'rock', salt));
  await assert.rejects(revealMove(state, match, 'agent-1', 'rock', salt));
  assert.throws(() => settleMatch(state, match));
  commitMove(state, match, 'agent-2', await commitment(match.id, 'agent-2', 'paper', salt));
  await assert.rejects(revealMove(state, match, 'agent-1', 'paper', salt));
  assert.throws(() => settleMatch(state, match));
  assertAccounting(state);
});
test('policy rejects untrusted intents, pause, stake, exposure, reserve and loss breaches', () => {
  const intent = { type: 'ENTER_GAME', agentId: 'agent-1', destination: 'simulation:rps', stake: 30_000_000 };
  const cases = [s => s.paused = true, s => s.agents[0].policy.maxStake = 1,
    s => s.agents[0].policy.maxExposureBps = 1, s => s.agents[0].policy.reserve = 999_999_999,
    s => s.agents[0].policy.maxLoss = 1];
  for (const change of cases) { const s = createState(2); change(s); assert.throws(() => authorize(s, intent)); }
  assert.throws(() => authorize(createState(2), { ...intent, destination: 'arbitrary-wallet' }));
  assert.throws(() => authorize(createState(2), { ...intent, stake: -1 }));
  assert.throws(() => authorize(createState(2), { ...intent, stake: 0.03 }));
});
test('entry validates both participants before debiting anyone', () => {
  const state = createState(2);
  state.agents[1].policy.maxStake = 1;
  const before = JSON.stringify(state);
  assert.throws(() => enterMatch(state, ['agent-1', 'agent-2']));
  assert.equal(JSON.stringify(state), before);
  assert.throws(() => enterMatch(state, ['agent-1', 'agent-1']));
});
test('commitments are bound to the game and participant', async () => {
  const salt = 'a'.repeat(64);
  const hash = await commitment('game-1', 'agent-1', 'rock', salt);
  assert.notEqual(hash, await commitment('game-2', 'agent-1', 'rock', salt));
  assert.notEqual(hash, await commitment('game-1', 'agent-2', 'rock', salt));
});
