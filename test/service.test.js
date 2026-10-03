import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
test('service reserves session capacity atomically for starts and replay imports', {
  skip: !existsSync(new URL('../rust/target/debug/table-core', import.meta.url)) && 'Build the Rust worker to run service integration tests',
  timeout: 20000,
}, async () => {
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: '0', MATCHES_DIR: await mkdtemp(os.tmpdir()+'/last-seat-service-') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => stderr += chunk);
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Service startup timed out: ${stderr}`)), 5000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error(`Service stopped: ${stderr}`)); });
      child.stdout.on('data', chunk => {
        const port = chunk.toString().match(/http:\/\/localhost:(\d+)/)?.[1];
        if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); }
      });
    });
    const post = async (path, body) => {
      const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    };
    const config = await fetch(base + '/api/config?agents=2').then(r => r.json());
    const invalid = await post('/api/matches', { config: { ...config, max_turns: 0 } });
    assert.equal(invalid.status, 400);
    config.max_turns = 1;
    const started = await post('/api/matches', { config });
    assert.equal(started.status, 201);
    const path = `/api/matches/${started.data.session}/step`;
    assert.equal((await post(path, {})).status, 200);
    const ended = await post(path, {});
    assert.equal(ended.status, 400);
    assert.match(ended.data.error, /already ended/);
    const oversized = await fetch(base + '/api/matches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(1_000_001) });
    assert.equal(oversized.status, 413);
    await oversized.json();
    const largeImport = await fetch(base + '/api/replays/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(8_100_000) + JSON.stringify({ replay: started.data.replay }) });
    assert.equal(largeImport.status, 200);
    await largeImport.json();
    const responses = await Promise.all(Array.from({ length: 105 }, (_, i) => i % 2
      ? post('/api/matches', { config })
      : post('/api/replays/import', { replay: started.data.replay })));
    assert.equal(responses.filter(r => r.status < 300).length, 98);
    const denied = responses.filter(r => r.status >= 300);
    assert.equal(denied.length, 7);
    for (const result of denied) assert.match(result.data.error, /session limit/);
  } finally {
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  }
});
