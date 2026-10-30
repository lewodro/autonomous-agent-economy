import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const TABLE = 'world_state';
const ROW = 'main';

/**
 * One durable document holds the human world: accounts, farm tiles, inventory
 * and the payout ledger. Postgres is used whenever DATABASE_URL is present so
 * Render redeploys keep state; the JSON file keeps local development and tests
 * dependency-free. Writes are serialized and only ever replace the whole row,
 * which matches the existing single-process authoritative world.
 */
export class WorldStore {
  constructor({ directory, databaseUrl = null, logger = console } = {}) {
    this.directory = directory;
    this.databaseUrl = databaseUrl;
    this.logger = logger;
    this.mode = databaseUrl ? 'postgres' : 'json';
    this.file = path.join(directory, 'world-farm.json');
    this.pool = null;
    this.queue = Promise.resolve();
  }

  async open() {
    if (this.mode === 'postgres') {
      let pg;
      try { pg = await import('pg'); } catch { throw new Error('DATABASE_URL is set but the pg package is not installed. Run npm install.'); }
      const Pool = pg.Pool || pg.default?.Pool;
      if (!Pool) throw new Error('The pg package does not export a Pool.');
      this.pool = new Pool({
        connectionString: this.databaseUrl,
        max: 4,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
        ssl: /sslmode=require|render\.com/.test(this.databaseUrl) ? { rejectUnauthorized: false } : undefined,
      });
      await this.pool.query(`create table if not exists ${TABLE} (
        id text primary key,
        state jsonb not null,
        updated_at timestamptz not null default now()
      )`);
      return this;
    }
    await mkdir(this.directory, { recursive: true });
    return this;
  }

  async load() {
    if (this.mode === 'postgres') {
      const result = await this.pool.query(`select state from ${TABLE} where id = $1`, [ROW]);
      return result.rows[0]?.state ?? null;
    }
    try {
      return JSON.parse(await readFile(this.file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  save(state) {
    const snapshot = structuredClone(state);
    this.queue = this.queue.then(async () => {
      if (this.mode === 'postgres') {
        await this.pool.query(
          `insert into ${TABLE} (id, state, updated_at) values ($1, $2::jsonb, now())
           on conflict (id) do update set state = excluded.state, updated_at = now()`,
          [ROW, JSON.stringify(snapshot)],
        );
        return;
      }
      const temp = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(snapshot), { mode: 0o600 });
      await rename(temp, this.file);
    });
    return this.queue;
  }

  async close() {
    try { await this.queue; } catch { /* reported by the caller that triggered the write */ }
    if (this.pool) await this.pool.end();
  }
}
