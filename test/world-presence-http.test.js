import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function openEvents(base, controller) {
  const response = await fetch(`${base}/api/worlds/main/presence/events`, { signal: controller.signal });
  assert.equal(response.status, 200);
  return { reader: response.body.getReader(), decoder: new TextDecoder(), buffered: '' };
}

async function nextEvent(stream) {
  while (true) {
    const boundary = stream.buffered.indexOf('\n\n');
    if (boundary >= 0) {
      const block = stream.buffered.slice(0, boundary);
      stream.buffered = stream.buffered.slice(boundary + 2);
      const type = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      if (type && data) return { type, data: JSON.parse(data) };
      continue;
    }
    const { done, value } = await stream.reader.read();
    if (done) throw new Error('Presence event stream ended unexpectedly');
    stream.buffered += stream.decoder.decode(value, { stream: true });
  }
}

test('presence HTTP snapshots and SSE stay consistent across two visitors and reconnects', { timeout: 20_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'world-presence-http-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', MATCHES_DIR: directory },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const controllers = [];
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
    const request = async (route, payload) => {
      const response = await fetch(base + route, payload === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      return { status: response.status, data: await response.json() };
    };
    const watch = async () => {
      const controller = new AbortController(); controllers.push(controller);
      return openEvents(base, controller);
    };

    const aliceEvents = await watch();
    const aliceInitial = await nextEvent(aliceEvents);
    assert.equal(aliceInitial.type, 'WorldJoined');
    assert.equal(aliceInitial.data.players.length, 0);
    const alice = await request('/api/worlds/main/presence/join', { player_id: 'alice', position: { x: 100, y: 100 } });
    assert.equal(alice.status, 201);
    assert.equal((await nextEvent(aliceEvents)).data.player.player_id, 'alice');

    const bobEvents = await watch();
    const bobInitial = await nextEvent(bobEvents);
    assert.equal(bobInitial.type, 'WorldJoined');
    assert.deepEqual(bobInitial.data.players.map(player => player.player_id), ['alice']);
    const bob = await request('/api/worlds/main/presence/join', { player_id: 'bob', position: { x: 120, y: 100 } });
    assert.equal(bob.status, 201);
    const aliceSawBob = await nextEvent(aliceEvents);
    assert.equal(aliceSawBob.type, 'PlayerJoined');
    assert.equal(aliceSawBob.data.player.player_id, 'bob');
    assert.equal(JSON.stringify(aliceSawBob).includes('session_token'), false);

    await new Promise(resolve => setTimeout(resolve, 70));
    const moved = await request('/api/worlds/main/presence/move', {
      player_id: 'bob', session_token: bob.data.session_token,
      position: { x: 135, y: 100 }, direction: 'right', animation_state: 'walk'
    });
    assert.equal(moved.status, 200);
    const movementEvent = await nextEvent(aliceEvents);
    assert.equal(movementEvent.type, 'PlayerMoved');
    assert.deepEqual(movementEvent.data.player.position, { x: 135, y: 100 });

    const reconnected = await request('/api/worlds/main/presence/join', {
      player_id: 'bob', session_token: bob.data.session_token, position: { x: 900, y: 100 }
    });
    assert.deepEqual(reconnected.data.player.position, { x: 135, y: 100 });
    const updateEvent = await nextEvent(aliceEvents);
    assert.equal(updateEvent.type, 'PlayerUpdated');
    assert.deepEqual(updateEvent.data.player.position, { x: 135, y: 100 });
    assert.deepEqual((await request('/api/worlds/main/presence')).data.players.map(player => player.position), [{ x: 100, y: 100 }, { x: 135, y: 100 }]);

    const left = await request('/api/worlds/main/presence/leave', { player_id: 'bob', session_token: bob.data.session_token });
    assert.equal(left.status, 200);
    const leaveEvent = await nextEvent(aliceEvents);
    assert.equal(leaveEvent.type, 'PlayerLeft');
    assert.equal(leaveEvent.data.player_id, 'bob');
    assert.deepEqual((await request('/api/worlds/main/presence')).data.players.map(player => player.player_id), ['alice']);
  } finally {
    for (const controller of controllers) controller.abort();
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await rm(directory, { recursive: true, force: true });
  }
});
