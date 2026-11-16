import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ArenaRoomPool } from '../service/arena-rooms.js';
import { ArenaCumulativeStats } from '../service/arena-stats.js';
import { CompoundGame } from '../service/compound-game.js';
import { DurableStateDatabase } from '../service/durable-state.js';
import { ExperimentStore } from '../service/experiment-store.js';
import { ReplayArchive } from '../service/replay-archive.js';
import { SessionStore } from '../service/session-store.js';
import { TreasuryLedger } from '../service/treasury.js';
import { WorldChallengeService } from '../service/world-challenges.js';
import { BAZAAR, WorldFarm } from '../service/world-farm.js';
import { WorldPresenceService } from '../service/world-presence.js';
import { WorldStore } from '../service/world-store.js';

const mode = process.argv[2];
const root = process.env.MATCHES_DIR;
if (!['write', 'read', 'legacy-seed', 'legacy-import'].includes(mode || '')) throw new Error('Expected a persistence worker mode');
if (!root) throw new Error('MATCHES_DIR is required for the Postgres persistence worker');
const databaseUrl = mode === 'legacy-seed' ? null : process.env.DATABASE_URL;
if (mode !== 'legacy-seed' && !databaseUrl) throw new Error('DATABASE_URL is required for Postgres restart/import verification');

const identity = { key: 'clerk:postgres_restart_user', provider: 'clerk', subject: 'postgres_restart_user', name: 'Restart User' };
const experimentId = '11111111-1111-4111-8111-111111111111';
const experimentOwner = 'clerk:postgres_restart_user';
const replayIds = ['1', '2', '3'].map(value => `seat-${value.repeat(64)}`);
const now = () => 2_000_000;

function replay(matchId, ended = true) {
  return {
    config: { max_turns: 10, agents: [{ id: 'agent-1', name: 'One' }] },
    final_state: { ended, turn: 3, agents: [] },
    statistics: [], events: [], seed: 7, match_id: matchId, winner: ended ? 'agent-1' : null,
  };
}

async function openServices() {
  await mkdir(root, { recursive: true });
  const worldDirectory = path.join(root, 'world');
  const durable = new DurableStateDatabase({ directory: path.join(root, 'durable'), databaseUrl });
  await durable.open();

  const farmStore = new WorldStore({ directory: worldDirectory, databaseUrl });
  await farmStore.open();
  const farm = new WorldFarm(farmStore, { now, random: () => 0.5 });
  await farm.restore();

  const arenaStatsStore = new WorldStore({ directory: worldDirectory, databaseUrl, rowId: 'arena-stats', fileName: 'arena-stats.json', continueAfterWriteFailure: true });
  await arenaStatsStore.open();
  const arenaStats = new ArenaCumulativeStats(arenaStatsStore, { now: () => '2026-11-16T12:00:00.000Z' });
  await arenaStats.restore();

  const arenaDirectory = path.join(root, 'arena');
  const arenaRooms = new ArenaRoomPool(arenaDirectory, {
    stageMs: 0,
    collection: durable.collection('arena-rooms', { directory: arenaDirectory, maxRecords: 4, maxBytes: 32_000_000 }),
  });
  await arenaRooms.restore();

  const compoundDirectory = path.join(root, 'compound');
  const compound = new CompoundGame(compoundDirectory, {
    now, roundSeconds: 60,
    historyCollection: durable.collection('compound-history', { directory: compoundDirectory, maxRecords: 1, maxBytes: 32_000_000 }),
  });
  await compound.restore();
  await compound.restoreHistory();

  const sessionsDirectory = path.join(root, 'sessions');
  const sessions = new SessionStore(sessionsDirectory, {
    collection: durable.collection('experiment-sessions', { directory: sessionsDirectory, maxRecords: 100, maxBytes: 32_000_000 }),
  });
  const experimentsDirectory = path.join(root, 'experiments');
  const experiments = new ExperimentStore(experimentsDirectory, sessions, undefined, {
    collection: durable.collection('experiments', { directory: experimentsDirectory, maxRecords: 100, maxBytes: 64 * 1024 }),
  });
  await experiments.restore(now());

  const treasuryStore = new WorldStore({ directory: worldDirectory, databaseUrl, rowId: 'treasury-ledger', fileName: 'treasury-ledger.json' });
  await treasuryStore.open();
  const treasury = new TreasuryLedger(treasuryStore, { now });
  await treasury.restore();

  const replayDirectory = path.join(root, 'replays');
  const archive = new ReplayArchive(replayDirectory, {
    collection: durable.collection('replays', { directory: replayDirectory, maxRecords: 3, maxBytes: 64_000 }),
    maxRecords: 2, maxBytes: 64_000, maxReplayBytes: 16_000,
  });

  return { durable, farm, arenaStatsStore, arenaStats, arenaRooms, compound, sessions, experiments, treasury, archive };
}

async function seed(services) {
  const { farm, arenaStats, arenaRooms, compound, sessions, experiments, treasury, archive } = services;
  const account = farm.account(identity);
  account.inventory.wheat = 2;
  account.xp = 50;
  account.credits = 20;
  await farm.sell(identity, { crop: 'wheat', quantity: 1, request_id: 'postgres-sale-0001' }, BAZAAR.position);
  const tile = farm.snapshot(identity).tiles[0];
  await farm.plant(identity, { tile_id: tile.id, crop: 'carrot', request_id: 'postgres-plant-001' }, tile.position);
  await farm.heartbeat(identity, { seconds: 30 });
  await farm.saveProfile(identity, { avatar: 'visitor_nova', position: { x: -220, y: 930 } });

  await arenaRooms.step('rps-1');
  await arenaRooms.step('ttt-1');
  arenaStats.recordRooms(arenaRooms.runs());
  await arenaStats.persist();

  compound.startAgentRound();
  compound.finish('timer');
  await compound.historyTail;

  const checkpoint = replay(replayIds[0], false);
  await sessions.save(experimentId, checkpoint, { global: { reserved: 0, used: 0 }, agents: {} });
  await experiments.create(experimentId, experimentOwner, checkpoint, now());

  await treasury.append({ type: 'funding', amount: 1_000, status: 'confirmed', reference_id: 'postgres-funding-1' });

  for (const matchId of replayIds) await archive.save(replay(matchId));
}

function ephemeralSnapshot() {
  const first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const presence = new WorldPresenceService({ identitySecret: 'postgres-restart-test-identity-secret', now });
  const firstJoin = presence.join('main', first, { position: { x: 160, y: 180 } });
  presence.join('main', second, { position: { x: 170, y: 180 } });
  const challenges = new WorldChallengeService({ presence, now });
  const chat = presence.quickChat('main', first, { phrase_id: 'rps' });
  challenges.create('main', first, 'rps', chat.target_player_id);
  const snapshot = { active_players: presence.snapshot('main').players.length, pending_challenges: challenges.challenges.size, source_player: firstJoin.presence_id };
  presence.close();
  return snapshot;
}

async function summary(services, includeEphemeral = false) {
  const { farm, arenaStats, arenaRooms, compound, sessions, experiments, treasury, archive } = services;
  const farmView = farm.snapshot(identity);
  const account = farmView.account;
  const accountState = farm.account(identity);
  const reconciledRecords = arenaStats.recordRooms(arenaRooms.runs());
  if (reconciledRecords) await arenaStats.persist();
  const arena = arenaStats.statistics(arenaRooms.statistics());
  const experiment = experiments.get(experimentId, experimentOwner);
  const session = (await sessions.load()).find(value => value.session === experimentId);
  await archive.reconcile();
  const retainedReplays = [];
  for (const id of replayIds) if (await archive.load(id)) retainedReplays.push(id);
  const freshPresence = new WorldPresenceService({ identitySecret: 'postgres-restart-test-identity-secret', now });
  const freshChallenges = new WorldChallengeService({ presence: freshPresence, now });
  const result = {
    account: {
      id: account.id, key: accountState.key, user_id: accountState.user_id, clerk_user_id: accountState.clerk_user_id,
      provider: account.provider, credits: account.credits, xp: account.xp,
      seconds_played: account.seconds_played, inventory: account.inventory, stats: account.stats, profile: account.profile,
    },
    farm: farmView.tiles.map(tile => ({ id: tile.id, owner: tile.owner, crop: tile.crop, stage: tile.stage })),
    world_ledger: structuredClone(farm.state.ledger),
    arena: { totals: arena.totals, games: arena.games, health: arenaStats.health(), reconciled_records: reconciledRecords },
    arena_history: arenaRooms.history().map(item => ({ roomId: item.roomId, matchId: item.id, result: item.result })),
    arena_research: arenaRooms.profiles().filter(profile => profile.memory.length).map(profile => ({ id: profile.id, memory: profile.memory })),
    compound: { phase: compound.state.phase, participants: compound.state.participants.length, results: compound.state.results.map(item => item.session_id) },
    experiment: { id: experiment.experiment_id, owner: experiment.owner_session_id, status: experiment.status, session: session?.session || null },
    treasury: { events: treasury.state.events.map(event => ({ type: event.type, amount: event.amount, status: event.status, reference_id: event.reference_id })), accounting: treasury.accounting() },
    retained_replays: retainedReplays,
    ephemeral_after_recreation: { active_players: freshPresence.snapshot('main').players.length, pending_challenges: freshChallenges.challenges.size },
  };
  if (includeEphemeral) result.ephemeral_before_restart = ephemeralSnapshot();
  freshPresence.close();
  return result;
}

async function closeServices(services) {
  await services.arenaRooms.close();
  await services.compound.close();
  await services.farm.close();
  await services.arenaStatsStore.close();
  await services.treasury.close();
  await services.durable.close();
}

const services = await openServices();
try {
  if (mode === 'write' || mode === 'legacy-seed') await seed(services);
  const result = await summary(services, mode === 'write' || mode === 'legacy-seed');
  process.stdout.write(JSON.stringify(result));
} finally {
  await closeServices(services);
}
