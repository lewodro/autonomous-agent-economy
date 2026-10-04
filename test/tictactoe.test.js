import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, enterMatch, playTicTacToeMove, settleMatch, assertAccounting } from '../src/economy.js';
import { outcome, playCell, verifyTicTacToeProof } from '../src/tictactoe.js';
import { configureRun } from '../src/config.js';
import { Orchestrator } from '../src/orchestrator.js';
import { saveState, loadState } from '../src/storage.js';

test('tic-tac-toe enforces turns, occupied cells, terminal boards and draws', () => {
  const empty = Array(9).fill(null);
  assert.equal(outcome(empty), null);
  assert.deepEqual(playCell(empty, 'a', 0).board, ['a', null, null, null, null, null, null, null, null]);
  assert.throws(() => playCell(empty, 'b', 0), /turn/);
  assert.throws(() => playCell(['a', ...empty.slice(1)], 'b', 0), /empty/);
  assert.equal(outcome(['a', 'b', 'a', 'a', 'b', 'b', 'b', 'a', 'a']), 'draw');
  assert.throws(() => outcome(['a', 'a', 'a', 'b', 'b', 'b', null, null, null]), /winner/);
});

test('tic-tac-toe resolves a real board before a single simulated settlement', () => {
  const state = createState(2);
  const match = enterMatch(state, ['agent-1', 'agent-2'], state.config.stake, 'tictactoe');
  assert.equal(match.status, 'playing');
  assert.equal(state.agents[0].balance, 970_000_000);
  for (const [agentId, cell] of [['agent-1', 0], ['agent-2', 3], ['agent-1', 1], ['agent-2', 4], ['agent-1', 2]]) {
    playTicTacToeMove(state, match, agentId, cell);
  }
  assert.equal(match.status, 'ready_to_settle');
  assert.equal(match.result, 'a');
  assert.equal(verifyTicTacToeProof(match), true);
  assert.throws(() => playTicTacToeMove(state, match, 'agent-2', 5), /No active/);
  settleMatch(state, match);
  assert.equal(state.agents[0].balance, 1_030_000_000);
  assert.equal(state.agents[1].balance, 970_000_000);
  const settled = structuredClone(state);
  settleMatch(state, match);
  assert.deepEqual(state, settled);
  assertAccounting(state);
});

test('forged tic-tac-toe outcome cannot authorize payout', () => {
  const state = createState(2);
  const match = enterMatch(state, ['agent-1', 'agent-2'], state.config.stake, 'tictactoe');
  for (const [agentId, cell] of [['agent-1', 0], ['agent-2', 3], ['agent-1', 1], ['agent-2', 4], ['agent-1', 2]]) {
    playTicTacToeMove(state, match, agentId, cell);
  }
  match.result = 'b';
  assert.equal(verifyTicTacToeProof(match), false);
  assert.throws(() => settleMatch(state, match), /Verified terminal/);
  assertAccounting(state);
});

test('an orchestrated tic-tac-toe match has visible turns and a verified saved ledger', async () => {
  const state = configureRun({ agents: 2, seed: 91 });
  const frames = [];
  const orchestrator = new Orchestrator(state, { onStage(stage, match) {
    if (stage === 'play') frames.push([...match.board]);
  } });
  const match = await orchestrator.step(null, 'tictactoe');
  assert.ok(frames.length >= 5 && frames.length <= 9);
  assert.equal(frames.at(-1).filter(Boolean).length, match.moves.length);
  assert.equal(verifyTicTacToeProof(match), true);
  assertAccounting(state);
  const storage = new Map();
  const browserStore = { setItem: (key, value) => storage.set(key, value), getItem: key => storage.get(key) };
  saveState(state, browserStore);
  const restored = await loadState(browserStore);
  assert.deepEqual(restored.matches, state.matches);
  assert.deepEqual(restored.agents, state.agents);
});
