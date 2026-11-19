import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('cave HTTP routes are per-visitor, validate intents and keep runs read-only until started', { timeout: 40_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'world-cave-http-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', MATCHES_DIR: directory },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${errors}`)), 8_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server stopped (${code}): ${errors}`)); });
      child.stdout.on('data', chunk => {
        const match = chunk.toString().match(/http:\/\/localhost:(\d+)/);
        if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
      });
    });
    let cookie = '';
    const request = async (route, payload) => {
      const headers = { ...(cookie ? { Cookie: cookie } : {}) };
      const response = await fetch(base + route, payload === undefined ? { headers } : {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return { status: response.status, data };
    };

    const config = await request('/api/world/cave/config');
    assert.equal(config.status, 200);
    assert.deepEqual(config.data.levels.map(level => level.level), [1, 2, 3]);
    assert.equal(config.data.levels.some(level => 'monsters' in level), false, 'the layout leaks no encounter state');
    assert.equal((await request('/api/world/cave/config', {})).status, 405);

    const empty = await request('/api/world/cave');
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.data, { run: null });
    const started = await request('/api/world/cave/start', { exterior: { x: -700, y: -736 } });
    assert.equal(started.status, 200);
    const runId = started.data.run.run_id;
    assert.match(runId, /^cave-[a-f0-9-]{36}$/);
    assert.equal(started.data.run.player.hp, 100);
    assert.equal(started.data.run.monsters.every(monster => typeof monster.hp === 'number'), true);
    const live = await request('/api/world/cave');
    assert.equal(live.data.run.run_id, runId, 'a visitor resumes its own active run');
    assert.equal('credential' in live.data.run, false);

    const wall = await request('/api/world/cave/move', { run_id: runId, x: 900, y: 600 });
    assert.equal(wall.status, 409);
    assert.equal(wall.data.code, 'CAVE_MOVE_TOO_FAR');
    const malformed = await request('/api/world/cave/attack', { run_id: runId, request_id: 'bad' });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.data.code, 'INVALID_REQUEST_ID');
    const noTarget = await request('/api/world/cave/attack', { run_id: runId, request_id: 'strike-http-0001' });
    assert.equal(noTarget.status, 409);
    assert.equal(noTarget.data.code, 'CAVE_NO_TARGET');
    const wrongRun = await request('/api/world/cave/exit', { run_id: 'cave-22222222-2222-4222-8222-222222222222' });
    assert.equal(wrongRun.status, 404);
    assert.equal(wrongRun.data.code, 'CAVE_RUN_NOT_FOUND');

    const exited = await request('/api/world/cave/exit', { run_id: runId });
    assert.equal(exited.status, 200);
    assert.deepEqual(exited.data.exterior, { x: -700, y: -736 });
    assert.equal(exited.data.view.status, 'exited');
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGTERM');
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3_000))]);
    }
    await rm(directory, { recursive: true, force: true });
  }
});
