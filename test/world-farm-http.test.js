import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { FARM_SCARCITY } from '../service/world-farm.js';

function start(environment) {
  const child = spawn(process.execPath, ['server.js'], { cwd: new URL('../', import.meta.url), env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  return { child, errors: () => errors };
}

test('farm HTTP routes drive the same server-authoritative loop the world renders', { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'world-farm-http-'));
  const { child, errors } = start({ ...process.env, PORT: '0', MATCHES_DIR: directory });
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server startup failed: ${errors()}`)), 8_000);
      child.once('exit', () => { clearTimeout(timer); reject(new Error(errors())); });
      child.stdout.on('data', chunk => {
        const port = chunk.toString().match(/localhost:(\d+)/)?.[1];
        if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); }
      });
    });

    const html = await (await fetch(base + '/')).text();
    for (const id of ['world-hud', 'hud-account', 'hud-xp-bar', 'hud-bag', 'farm-notices']) assert.match(html, new RegExp(`id="${id}"`));
    assert.equal((await fetch(base + '/web/dist/world/farm.js')).status, 200);
    const auth = await (await fetch(base + '/api/world/auth')).json();
    assert.deepEqual(auth, { provider: 'clerk', configured: false, publishable_key: null });

    const snapshotResponse = await fetch(base + '/api/world/farm');
    const cookie = snapshotResponse.headers.get('set-cookie')?.split(';')[0];
    const snapshot = await snapshotResponse.json();
    assert.ok(cookie);
    assert.equal(snapshot.mode, 'farm_v1');
    assert.equal(snapshot.tiles.length, FARM_SCARCITY.startingTiles);
    assert.equal(snapshot.auth.signed_in, false);
    assert.equal(snapshot.account.credits, 0);
    assert.equal(snapshot.account.signed_in, false);
    assert.equal(snapshot.bazaar.prices.wheat, 6);

    const tile = snapshot.tiles[0];
    await fetch(base + '/api/worlds/main/presence/join', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ position: tile.position }) });

    const post = async (action, body) => {
      const response = await fetch(`${base}/api/world/farm/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };

    const planted = await post('plant', { tile_id: tile.id, crop: 'wheat' });
    assert.equal(planted.status, 200);
    assert.equal(planted.body.tile.stage, 'growing');
    assert.ok(planted.body.grow_ms >= 60_000 && planted.body.grow_ms <= 120_000);

    assert.equal((await post('harvest', { tile_id: tile.id })).status, 409);
    assert.equal((await post('sell', { crop: 'wheat', quantity: 1 })).status, 409);

    const heartbeat = await post('heartbeat', { seconds: 30 });
    assert.equal(heartbeat.status, 200);
    assert.equal(heartbeat.body.accepted_seconds, 30);
    assert.equal(heartbeat.body.account.seconds_played, 30);

    const savedProfile = await post('profile', { avatar: 'visitor_atlas', position: { x: 560, y: 480 } });
    assert.equal(savedProfile.status, 200);
    assert.equal(savedProfile.body.account.profile.avatar, 'visitor_atlas');
    assert.deepEqual(savedProfile.body.account.profile.position, { x: 560, y: 480 });
    assert.equal((await post('profile', { avatar: 'visitor_debug' })).status, 400);

    const wallet = await post('wallet', { wallet_address: '11111111111111111111111111111111' });
    assert.equal(wallet.status, 200);
    assert.equal(wallet.body.account.wallet.status, 'self_declared');
    assert.equal((await post('wallet', { wallet_address: 'not a wallet' })).status, 400);
    assert.equal((await post('payout', { amount_credits: 500 })).status, 403, 'guests cannot request payouts');

    assert.equal((await post('plant', { tile_id: 'plot_missing', crop: 'wheat' })).status, 404);
    assert.equal((await post('plant', { tile_id: tile.id, crop: 'banana' })).status, 400);

    const health = await (await fetch(base + '/api/health')).json();
    assert.equal(health.world_farm.status, 'ok');
    assert.equal(health.world_farm.storage, 'json');
    assert.equal(health.world_farm.tiles, FARM_SCARCITY.startingTiles);
    assert.equal(health.world_farm.payouts_enabled, false);
  } finally {
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await rm(directory, { recursive: true, force: true });
  }
});
