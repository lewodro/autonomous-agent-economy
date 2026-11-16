import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required; the Postgres persistence suite never falls back to JSON');

const runFile = promisify(execFile);
const worker = new URL('./postgres-persistence-worker.js', import.meta.url);
const Pool = pg.Pool || pg.default?.Pool;

function isolatedUrl(name) {
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

async function isolatedDatabase() {
  const name = `aae_ci_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`create database "${name}"`);
  return {
    name,
    url: isolatedUrl(name),
    async close() {
      await admin.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()', [name]);
      await admin.query(`drop database if exists "${name}"`);
      await admin.end();
    },
  };
}

async function runWorker(mode, { url, directory }) {
  try {
    const { stdout, stderr } = await runFile(process.execPath, [worker.pathname, mode], {
      cwd: new URL('../', import.meta.url),
      env: { ...process.env, DATABASE_URL: url, MATCHES_DIR: directory },
      maxBuffer: 10 * 1024 * 1024,
    });
    assert.equal(stderr, '');
    return JSON.parse(stdout);
  } catch (error) {
    const output = [error.stdout, error.stderr].filter(Boolean).join('\n');
    throw new Error(`Postgres persistence worker ${mode} failed${output ? `:\n${output}` : ''}`, { cause: error });
  }
}

function durableView(snapshot) {
  return {
    account: snapshot.account,
    farm: snapshot.farm,
    world_ledger: snapshot.world_ledger,
    arena: { totals: snapshot.arena.totals, games: snapshot.arena.games },
    arena_history: snapshot.arena_history,
    arena_research: snapshot.arena_research,
    compound_results: snapshot.compound.results,
    experiment: snapshot.experiment,
    treasury: snapshot.treasury,
    retained_replays: snapshot.retained_replays,
  };
}

test('real Postgres state survives independent process and scratch-directory recreation', { timeout: 120_000 }, async () => {
  const database = await isolatedDatabase();
  const root = await mkdtemp(path.join(os.tmpdir(), 'aae-postgres-restart-'));
  try {
    const first = await runWorker('write', { url: database.url, directory: path.join(root, 'process-a') });
    const second = await runWorker('read', { url: database.url, directory: path.join(root, 'process-b') });

    assert.deepEqual(durableView(second), durableView(first));
    assert.equal(first.arena.health.status, 'ok');
    assert.equal(first.arena.health.reconciliation_lag_matches, 0);
    assert.equal(first.arena.health.reconciliation_pending, false);
    assert.equal(first.arena.health.durable_matches, first.arena.totals.matches);
    assert.equal(second.arena.health.durable_matches, first.arena.totals.matches);
    assert.equal(second.arena.health.reconciliation_lag_matches, 0);
    assert.equal(second.arena.reconciled_records, 0, 'restart reconciliation does not recount settled matches');
    assert.equal(second.arena.totals.matches, second.arena.games.rps.matches + second.arena.games.tictactoe.matches + second.arena.games.survival.matches);

    assert.equal(first.ephemeral_before_restart.active_players, 2);
    assert.equal(first.ephemeral_before_restart.pending_challenges, 1);
    assert.match(first.ephemeral_before_restart.source_player, /^visitor_[a-f0-9]{24}$/);
    assert.deepEqual(second.ephemeral_after_recreation, { active_players: 0, pending_challenges: 0 });
    assert.equal(second.compound.phase, 'lobby');
    assert.equal(second.compound.participants, 0, 'active Compound round state remains scratch-local');
    assert.deepEqual(second.compound.results, ['compound-1']);
    assert.deepEqual(second.retained_replays, [`seat-${'2'.repeat(64)}`, `seat-${'3'.repeat(64)}`]);
  } finally {
    await database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy import resumes from partial Postgres state and repeated reconciliation is a no-op', { timeout: 120_000 }, async () => {
  const database = await isolatedDatabase();
  const root = await mkdtemp(path.join(os.tmpdir(), 'aae-postgres-legacy-'));
  const directory = path.join(root, 'legacy');
  let pool;
  try {
    const legacy = await runWorker('legacy-seed', { url: database.url, directory });
    const farmFile = path.join(directory, 'world', 'world-farm.json');
    const originalFarm = JSON.parse(await readFile(farmFile, 'utf8'));

    pool = new Pool({ connectionString: database.url, max: 2 });
    await pool.query(`create table world_state (
      id text primary key,
      state jsonb not null,
      updated_at timestamptz not null default now()
    )`);
    await pool.query('insert into world_state (id, state) values ($1, $2::jsonb)', ['main', JSON.stringify(originalFarm)]);

    const inflatedLegacy = structuredClone(originalFarm);
    inflatedLegacy.accounts['clerk:postgres_restart_user'].credits += 50_000;
    inflatedLegacy.accounts['clerk:postgres_restart_user'].inventory.wheat += 500;
    await writeFile(farmFile, JSON.stringify(inflatedLegacy));

    const firstImport = await runWorker('legacy-import', { url: database.url, directory });
    const countsAfterFirst = {
      world: (await pool.query('select id from world_state order by id')).rows.map(row => row.id),
      durable: (await pool.query('select namespace, count(*)::int as records from durable_state group by namespace order by namespace')).rows,
    };
    const secondImport = await runWorker('legacy-import', { url: database.url, directory });
    const countsAfterSecond = {
      world: (await pool.query('select id from world_state order by id')).rows.map(row => row.id),
      durable: (await pool.query('select namespace, count(*)::int as records from durable_state group by namespace order by namespace')).rows,
    };

    const expectedImport = durableView(legacy);
    expectedImport.retained_replays = [`seat-${'2'.repeat(64)}`, `seat-${'3'.repeat(64)}`];
    assert.deepEqual(durableView(firstImport), expectedImport, 'the existing farm row wins while missing legacy systems resume importing');
    assert.deepEqual(durableView(secondImport), durableView(firstImport), 'a second import changes no durable balance, inventory, ownership, result, or history');
    assert.deepEqual(countsAfterSecond, countsAfterFirst, 'reconciliation creates no duplicate Postgres rows');
    assert.deepEqual(countsAfterFirst.world, ['arena-stats', 'main', 'treasury-ledger']);
    assert.ok(countsAfterFirst.durable.some(row => row.namespace === 'arena-rooms'));
    assert.ok(countsAfterFirst.durable.some(row => row.namespace === 'compound-history' && row.records === 1));
    assert.ok(countsAfterFirst.durable.some(row => row.namespace === 'experiments' && row.records === 1));
    assert.ok(countsAfterFirst.durable.some(row => row.namespace === 'experiment-sessions' && row.records === 1));
    assert.ok(countsAfterFirst.durable.some(row => row.namespace === 'replays' && row.records === 2));
    assert.equal(firstImport.arena.health.reconciliation_lag_matches, 0);
    assert.equal(secondImport.arena.health.reconciliation_lag_matches, 0);
  } finally {
    await pool?.end();
    await database.close();
    await rm(root, { recursive: true, force: true });
  }
});
