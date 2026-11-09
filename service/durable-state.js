import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const TABLE = 'durable_state';
const namespacePattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const recordPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/;

function validateName(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`Invalid durable ${label}`);
  return value;
}

/**
 * Shared durable record database for state that has many independently keyed
 * documents. Postgres is authoritative when DATABASE_URL is configured. The
 * file implementation remains available for local/offline development.
 */
export class DurableStateDatabase {
  constructor({ directory, databaseUrl = null, pool = null } = {}) {
    this.directory = directory;
    this.databaseUrl = databaseUrl;
    this.mode = databaseUrl || pool ? 'postgres' : 'json';
    this.pool = pool;
    this.ownsPool = false;
    this.queue = Promise.resolve();
  }

  async open() {
    await mkdir(this.directory, { recursive: true });
    if (this.mode === 'postgres') {
      if (!this.pool) {
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
        this.ownsPool = true;
      }
      await this.pool.query(`create table if not exists ${TABLE} (
        namespace text not null,
        record_id text not null,
        state jsonb not null,
        updated_at timestamptz not null default now(),
        primary key (namespace, record_id)
      )`);
    }
    return this;
  }

  collection(namespace, { directory = path.join(this.directory, namespace), maxRecords = 1000, maxBytes = 32_000_000, legacyIdPattern = recordPattern } = {}) {
    return new DurableStateCollection(this, { namespace, directory, maxRecords, maxBytes, legacyIdPattern });
  }

  async close() {
    try { await this.queue; } catch { /* the initiating caller reports the error */ }
    if (this.pool && this.ownsPool) await this.pool.end();
  }
}

export class DurableStateCollection {
  constructor(database, { namespace, directory, maxRecords, maxBytes, legacyIdPattern }) {
    this.database = database;
    this.namespace = validateName(namespace, namespacePattern, 'namespace');
    this.directory = directory;
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 10_000) throw new Error('Invalid durable record limit');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 256 * 1024 * 1024) throw new Error('Invalid durable record size limit');
    this.maxRecords = maxRecords;
    this.maxBytes = maxBytes;
    this.legacyIdPattern = legacyIdPattern;
  }

  id(value) { return validateName(value, recordPattern, 'record ID'); }
  file(id) { return path.join(this.directory, `${this.id(id)}.json`); }
  encode(state) {
    const json = JSON.stringify(state);
    if (Buffer.byteLength(json) > this.maxBytes) throw Object.assign(new Error('Durable record exceeds configured size'), { status: 413 });
    return json;
  }

  async legacy(id) {
    try {
      const json = await readFile(this.file(id), 'utf8');
      if (Buffer.byteLength(json) > this.maxBytes) throw new Error('Durable legacy record exceeds configured size');
      return JSON.parse(json);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async get(id) {
    id = this.id(id);
    if (this.database.mode === 'json') return this.legacy(id);
    const result = await this.database.pool.query(`select state from ${TABLE} where namespace = $1 and record_id = $2`, [this.namespace, id]);
    if (result.rows[0]) return result.rows[0].state;
    const legacy = await this.legacy(id);
    if (legacy === null) return null;
    await this.insertLegacy(id, legacy);
    const imported = await this.database.pool.query(`select state from ${TABLE} where namespace = $1 and record_id = $2`, [this.namespace, id]);
    return imported.rows[0]?.state ?? null;
  }

  put(id, state) {
    id = this.id(id);
    const snapshot = structuredClone(state);
    const json = this.encode(snapshot);
    this.database.queue = this.database.queue.then(async () => {
      if (this.database.mode === 'postgres') {
        await this.database.pool.query(
          `insert into ${TABLE} (namespace, record_id, state, updated_at) values ($1, $2, $3::jsonb, now())
           on conflict (namespace, record_id) do update set state = excluded.state, updated_at = now()`,
          [this.namespace, id, json],
        );
        return;
      }
      await mkdir(this.directory, { recursive: true });
      const target = this.file(id), temp = `${target}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temp, 'wx', 0o600);
        try { await handle.writeFile(json); await handle.sync(); } finally { await handle.close(); }
        await rename(temp, target);
      } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    });
    return this.database.queue;
  }

  async delete(id) {
    id = this.id(id);
    await this.database.queue;
    if (this.database.mode === 'postgres') {
      await this.database.pool.query(`delete from ${TABLE} where namespace = $1 and record_id = $2`, [this.namespace, id]);
      return;
    }
    await unlink(this.file(id)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }

  async entries() {
    if (this.database.mode === 'postgres') {
      await this.importLegacyDirectory();
      const result = await this.database.pool.query(
        `select record_id, state from ${TABLE} where namespace = $1 order by record_id limit $2`,
        [this.namespace, this.maxRecords + 1],
      );
      if (result.rows.length > this.maxRecords) throw new Error('Durable record limit exceeded');
      return result.rows.map(row => [row.record_id, row.state]);
    }
    let names;
    try { names = await readdir(this.directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const ids = names.filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).filter(id => recordPattern.test(id)&&this.legacyIdPattern.test(id)).sort();
    if (ids.length > this.maxRecords) throw new Error('Durable record limit exceeded');
    return Promise.all(ids.map(async id => [id, await this.legacy(id)]));
  }

  async insertLegacy(id, state) {
    const json = this.encode(state);
    await this.database.pool.query(
      `insert into ${TABLE} (namespace, record_id, state, updated_at) values ($1, $2, $3::jsonb, now())
       on conflict (namespace, record_id) do nothing`,
      [this.namespace, id, json],
    );
  }

  async importLegacyDirectory() {
    let names;
    try { names = await readdir(this.directory); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const ids = names.filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).filter(id => recordPattern.test(id)&&this.legacyIdPattern.test(id)).sort();
    if (ids.length > this.maxRecords) throw new Error('Durable legacy record limit exceeded');
    for (const id of ids) {
      const state = await this.legacy(id);
      if (state !== null) await this.insertLegacy(id, state);
    }
  }
}
