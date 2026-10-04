import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

async function start(directory, extraEnv = {}) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0',
      PUBLIC_ORIGIN: 'https://seat.example', RAILWAY_PUBLIC_DOMAIN: '', MATCHES_DIR: directory,
      HOST_SESSION_SECRET: 'local-integration-secret-value-long-enough', ECONOMY_LAB: '0',
      MACHINE_PAYMENTS_DEMO: '0', ENTRY_FEE_ENABLED: 'false', ECONOMY_MODE: 'SIMULATED', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Production service startup timed out: ${output}`)), 10_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Production service stopped (${code}): ${output}`)); });
    child.stderr.on('data', chunk => output += chunk);
    child.stdout.on('data', chunk => {
      output += chunk;
      const line = output.split('\n').find(part => part.includes('"event":"server_started"'));
      if (line) { clearTimeout(timer); resolve(`http://127.0.0.1:${JSON.parse(line).port}`); }
    });
  });
  return { child, base };
}

async function stop(child) {
  if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
}

test('public games are visible after restart while only the host can advance them', {
  skip: !existsSync(new URL('../rust/target/debug/table-core', import.meta.url)) && 'Build the Rust worker to run service integration tests',
  timeout: 30_000,
}, async () => {
  const directory = await mkdtemp(`${os.tmpdir()}/last-seat-public-`);
  let running;
  const request = async (base, path, payload, cookie) => {
    const response = await fetch(base + path, { method: payload === undefined ? 'GET' : 'POST',
      headers: { Host: 'seat.example', Origin: 'https://seat.example', ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') };
  };
  try {
    running = await start(directory);
    const health = await request(running.base, '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.storage, 'ok');
    const capabilities = await request(running.base, '/api/capabilities');
    assert.deepEqual(capabilities.body.funded_modes, []);
    assert.deepEqual(capabilities.body.game_modes, ['last-seat', 'rps', 'tictactoe']);
    const config = (await request(running.base, '/api/config?agents=2')).body;
    const created = await request(running.base, '/api/matches', { config });
    assert.equal(created.status, 201);
    assert.match(created.cookie, /HttpOnly; SameSite=Strict/);
    const session = created.body.session;
    const ongoing = await request(running.base, '/api/games/ongoing');
    assert.equal(ongoing.body.games[0].session, session);
    const route = `/api/matches/${session}/step`;
    assert.equal((await request(running.base, route, {})).status, 403);
    const cookie = created.cookie.split(';')[0];
    assert.equal((await request(running.base, route, {}, cookie)).status, 200);
    await stop(running.child);
    running = await start(directory);
    assert.equal((await request(running.base, '/api/games/ongoing')).body.games[0].session, session);
    assert.equal((await request(running.base, route, {}, cookie)).status, 200);
    assert.equal((await request(running.base, '/api/funded-matches')).status, 404);
    assert.equal((await request(running.base, '/premium-tool')).status, 404);
  } finally {
    if (running) await stop(running.child);
    await rm(directory, { recursive: true, force: true });
  }
});

test('public Devnet mode is explicit and cannot be downgraded to a mock funded match', {
  skip: !existsSync(new URL('../rust/target/debug/table-core', import.meta.url)) && 'Build the Rust worker to run service integration tests',
  timeout: 30_000,
}, async () => {
  const directory = await mkdtemp(`${os.tmpdir()}/last-seat-devnet-public-`);
  let running;
  try {
    running = await start(directory, { ENTRY_FEE_ENABLED: 'true', ECONOMY_MODE: 'DEVNET',
      PUBLIC_DEVNET_ACK: 'I_UNDERSTAND_TEST_SOL_ONLY', SOLANA_DEVNET_RPC_URL: 'https://devnet.example/rpc' });
    const headers = { Host: 'seat.example', Origin: 'https://seat.example' };
    const capabilities = await fetch(`${running.base}/api/capabilities`, { headers }).then(response => response.json());
    assert.deepEqual(capabilities.funded_modes, ['devnet']);
    const health = await fetch(`${running.base}/api/health`, { headers }).then(response => response.json());
    assert.equal(health.payments, 'devnet_test_sol');
    const response = await fetch(`${running.base}/api/funded-matches`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'mock', config: {} }) });
    assert.equal(response.status, 400);
  } finally {
    if (running) await stop(running.child);
    await rm(directory, { recursive: true, force: true });
  }
});
