import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BOOTSTRAP_FILE, ensureProductionStorage } from '../service/production-storage.js';

test('production storage bootstraps an empty volume idempotently without runtime data', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aae-production-storage-'));
  try {
    const first = await ensureProductionStorage(directory, { production: true });
    assert.equal(first.initialized, true);
    assert.deepEqual(await readdir(directory), [BOOTSTRAP_FILE]);
    const marker = JSON.parse(await readFile(path.join(directory, BOOTSTRAP_FILE), 'utf8'));
    assert.equal(marker.public_world_id, 'main');
    assert.equal(marker.canonical_agent_ids.length, 20);
    assert.equal(marker.runtime_history_starts_empty, true);
    assert.equal((await ensureProductionStorage(directory, { production: true })).initialized, false);
    assert.deepEqual(await readdir(directory), [BOOTSTRAP_FILE]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('production refuses an unmarked nonempty directory and preserves local data', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aae-production-dirty-'));
  try {
    await writeFile(path.join(directory, 'local-session.json'), '{"private":true}\n');
    await assert.rejects(
      () => ensureProductionStorage(directory, { production: true }),
      /not a clean initialized volume/
    );
    assert.deepEqual(await readdir(directory), ['local-session.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('development storage is never marked or rejected by the production guard', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aae-development-storage-'));
  try {
    await writeFile(path.join(directory, 'local-session.json'), '{}');
    const result = await ensureProductionStorage(directory, { production: false });
    assert.equal(result.initialized, false);
    assert.deepEqual(await readdir(directory), ['local-session.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
