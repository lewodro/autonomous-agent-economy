import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ArenaCumulativeStats } from '../service/arena-stats.js';
import { WorldStore } from '../service/world-store.js';
import { createState } from '../src/economy.js';

const baseState = () => createState();

function run({ runId = 'run-1', game = 'rps', matches = [], time = '2026-01-01T00:00:00.000Z' }) {
  const state = baseState();
  state.matches.push(...matches);
  for (const match of matches) state.events.push({ type: 'GAME_FINISHED', time, data: { matchId: match.id } });
  return { runId, roomId: game === 'tictactoe' ? 'ttt-1' : 'rps-1', game, state };
}

const rpsMatch = (id, result) => ({
  id, status: 'settled', type: 'rps', players: ['agent-1', 'agent-2'], result,
  reveals: { 'agent-1': { move: 'rock' }, 'agent-2': { move: result === 'draw' ? 'rock' : 'scissors' } },
});
const tttMatch = (id, result, decisions = 5) => ({
  id, status: 'settled', type: 'tictactoe', players: ['agent-1', 'agent-3'], result,
  moves: Array.from({ length: decisions }, (_, index) => ({ agentId: index % 2 ? 'agent-3' : 'agent-1', cell: index % 9 })),
});

async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'arena-stats-'));
  const store = new WorldStore({ directory, rowId: 'arena-stats', fileName: 'arena-stats.json' });
  await store.open();
  const stats = new ArenaCumulativeStats(store);
  await stats.restore();
  return { directory, store, stats, close: async () => { await store.close(); await rm(directory, { recursive: true, force: true }); } };
}

test('room rollups are idempotent and survive checkpoint retention', async () => {
  const { directory, store, stats, close } = await setup();
  try {
    const rps = run({ runId: 'rps-run', matches: [rpsMatch('rps-1', 'a'), rpsMatch('rps-2', 'draw')] });
    assert.equal(stats.recordRooms([rps]), 2);
    const first = stats.snapshot();
    assert.equal(first.games.rps.matches, 2);
    assert.equal(first.games.rps.draws, 1);
    assert.equal(first.games.rps.decisions, 4);
    assert.equal(first.updated_at, '2026-01-01T00:00:00.000Z');
    assert.deepEqual(first.agents['agent-1'].arena, { matches: 2, wins: 1, losses: 0, draws: 1 });
    assert.deepEqual(first.agents['agent-2'].arena, { matches: 2, wins: 0, losses: 1, draws: 1 });

    assert.equal(stats.recordRooms([rps]), 0, 'rescanning the same retained run must not double count');
    await stats.persist();
    await store.close();

    const restoredStore = new WorldStore({ directory, rowId: 'arena-stats', fileName: 'arena-stats.json' });
    await restoredStore.open();
    const restored = new ArenaCumulativeStats(restoredStore);
    await restored.restore();
    assert.deepEqual(restored.snapshot(), first, 'the cumulative document survives a restart');
    assert.equal(restored.recordRooms([rps]), 0, 'the persisted cursor prevents reseeding the same match');

    // Retained checkpoints rotate away, but the cumulative totals do not.
    const ttt = run({ runId: 'ttt-run', game: 'tictactoe', matches: [tttMatch('ttt-1', 'b')] });
    assert.equal(restored.recordRooms([ttt]), 1);
    const after = restored.snapshot();
    assert.equal(after.games.rps.matches, 2);
    assert.equal(after.games.tictactoe.matches, 1);
    assert.equal(after.games.tictactoe.decisions, 5);
    assert.deepEqual(after.agents['agent-3'].arena, { matches: 1, wins: 1, losses: 0, draws: 0 });
    await restoredStore.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Survival results roll up metrics exactly once across restarts', async () => {
  const { directory, store, stats, close } = await setup();
  try {
    const history = [{
      match_id: 'survival-7', completed_at: '2026-02-02T10:00:00.000Z', winner_id: 'agent-2',
      agents: [
        { id: 'agent-1', name: 'Founder', sprite: 'assets/a.png', strategy: 'analyst', won: false, research: 'Hold the centre.', metrics: { attacks_landed: 3, target_changes: 2, damage_dealt: 40, damage_taken: 60, retreat_count: 1, time_alive: 80, eliminations: 0, times_cornered: 2, escapes: 1, final_placement: 2 } },
        { id: 'agent-2', name: 'Scout', sprite: 'assets/b.png', strategy: 'aggressive', won: true, research: 'Keep distance.', metrics: { attacks_landed: 5, target_changes: 4, damage_dealt: 70, damage_taken: 30, retreat_count: 0, time_alive: 90, eliminations: 1, times_cornered: 0, escapes: 2, final_placement: 1 } },
      ],
    }];
    assert.equal(stats.recordSurvival(history), 1);
    const first = stats.snapshot();
    assert.equal(first.games.survival.matches, 1);
    assert.equal(first.games.survival.decisions, 14, 'attacks landed plus target changes');
    assert.equal(first.agents['agent-2'].survival.matches, 1);
    assert.equal(first.agents['agent-2'].survival.wins, 1);
    assert.equal(first.agents['agent-2'].survival.placement_total, 1);
    assert.equal(first.agents['agent-2'].survival.latest_research, 'Keep distance.');
    assert.equal(stats.recordSurvival(history), 0, 'the same Survival match is counted once');
    await stats.persist();
    await store.close();

    const restoredStore = new WorldStore({ directory, rowId: 'arena-stats', fileName: 'arena-stats.json' });
    await restoredStore.open();
    const restored = new ArenaCumulativeStats(restoredStore);
    await restored.restore();
    assert.equal(restored.recordSurvival(history), 0);
    assert.deepEqual(restored.snapshot(), first);
    const view = restored.survivalView(restored.state.agents['agent-2']);
    assert.equal(view.average_placement, 1);
    assert.equal(view.damage_dealt, 70);
    await restoredStore.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('profiles and statistics use durable all-time totals without losing live identity', async () => {
  const { stats, close } = await setup();
  try {
    const base = {
      id: 'agent-1', name: 'Founder', sprite: 'assets/founder.png', strategy: 'analyst', matches: 2, wins: 1, losses: 0, draws: 1,
      recentWinner: false, roomId: 'rps-1', arenaStatus: 'queued', memory: [{ matchId: 'live-1' }], latestMatch: { runId: 'live', matchId: 'live-1', game: 'rps' },
    };
    const before = stats.statistics({ scope: 'retained', updated_at: 'old', totals: { matches: 1, decisions: 1, draws: 0 }, games: { rps: { matches: 1, draws: 0, decisions: 1 }, tictactoe: { matches: 0, draws: 0, decisions: 0 }, survival: { matches: 0, draws: 0, decisions: 0 } }, agents: [base] });
    assert.equal(before.cumulative, false);
    assert.equal(before.scope, 'retained', 'an empty cumulative document falls back to retained statistics');

    stats.recordRooms([run({ runId: 'rps-run', matches: [rpsMatch('rps-1', 'a'), rpsMatch('rps-2', 'a'), rpsMatch('rps-3', 'b')] })]);
    const profiles = stats.applyProfiles([base]);
    assert.equal(profiles[0].name, 'Founder');
    assert.equal(profiles[0].roomId, 'rps-1');
    assert.deepEqual(profiles[0].memory, [{ matchId: 'live-1' }]);
    assert.equal(profiles[0].matches, 3);
    assert.equal(profiles[0].wins, 2);
    assert.equal(profiles[0].losses, 1);
    assert.equal(profiles[0].scope, 'cumulative all-time arena results');

    const statistics = stats.statistics({ scope: 'retained', updated_at: 'old', totals: { matches: 0, decisions: 0, draws: 0 }, games: { rps: { matches: 0, draws: 0, decisions: 0 }, tictactoe: { matches: 0, draws: 0, decisions: 0 }, survival: { matches: 0, draws: 0, decisions: 0 } }, agents: [base] }, profiles);
    assert.equal(statistics.cumulative, true);
    assert.equal(statistics.scope, 'cumulative all-time arena results');
    assert.equal(statistics.totals.matches, 3);
    assert.equal(statistics.games.rps.matches, 3);
    assert.equal(statistics.agents[0].win_rate, 66.7);
  } finally { await close(); }
});

test('existing matches survive a boot, new settlements add, and a second restart keeps the total', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'arena-stats-restart-'));
  const open = async () => {
    const store = new WorldStore({ directory, rowId: 'arena-stats', fileName: 'arena-stats.json' });
    await store.open();
    const stats = new ArenaCumulativeStats(store);
    await stats.restore();
    return { store, stats };
  };
  try {
    const first = await open();
    first.stats.recordRooms([run({ runId: 'seed-run', matches: [rpsMatch('seed-1', 'a'), rpsMatch('seed-2', 'b')] })]);
    await first.stats.persist(); await first.store.close();

    const second = await open();
    assert.equal(second.stats.snapshot().games.rps.matches, 2, 'boot restores the existing total');
    assert.equal(second.stats.recordRooms([run({ runId: 'seed-run', matches: [rpsMatch('seed-1', 'a'), rpsMatch('seed-2', 'b')] })]), 0);
    second.stats.recordRooms([run({ runId: 'new-run', matches: [rpsMatch('new-1', 'a')] })]);
    assert.equal(second.stats.snapshot().games.rps.matches, 3, 'new settlements add exactly once');
    await second.stats.persist(); await second.store.close();

    const third = await open();
    assert.equal(third.stats.snapshot().games.rps.matches, 3, 'the second restart keeps the accumulated total');
    assert.equal(third.stats.recordRooms([run({ runId: 'seed-run', matches: [rpsMatch('seed-1', 'a'), rpsMatch('seed-2', 'b')] }), run({ runId: 'new-run', matches: [rpsMatch('new-1', 'a')] })]), 0);
    await third.store.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('only settled public matches contribute to the cumulative record', async () => {
  const { stats, close } = await setup();
  try {
    const live = { ...rpsMatch('live-1', 'a'), status: 'live' };
    const failed = { ...rpsMatch('failed-1', 'b'), status: 'failed' };
    const settled = rpsMatch('settled-1', 'a');
    assert.equal(stats.recordRooms([run({ runId: 'public-run', matches: [live, failed, settled] })]), 1);
    assert.equal(stats.snapshot().games.rps.matches, 1);
    assert.equal(stats.snapshot().agents['agent-1'].arena.matches, 1);
  } finally { await close(); }
});

test('the cumulative document uses its own durable row and file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'arena-stats-row-'));
  try {
    const farmStore = new WorldStore({ directory });
    const arenaStore = new WorldStore({ directory, rowId: 'arena-stats', fileName: 'arena-stats.json' });
    await farmStore.open(); await arenaStore.open();
    await farmStore.save({ kind: 'farm' });
    await arenaStore.save({ kind: 'arena' });
    await farmStore.close(); await arenaStore.close();
    const reopenedFarm = new WorldStore({ directory });
    const reopenedArena = new WorldStore({ directory, rowId: 'arena-stats', fileName: 'arena-stats.json' });
    await reopenedFarm.open(); await reopenedArena.open();
    assert.deepEqual(await reopenedFarm.load(), { kind: 'farm' });
    assert.deepEqual(await reopenedArena.load(), { kind: 'arena' });
    await reopenedFarm.close(); await reopenedArena.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
