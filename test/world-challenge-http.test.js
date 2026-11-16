import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
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
async function nextEventOf(stream, expected) {
  while (true) {
    const event = await nextEvent(stream);
    if (event.type === expected) return event;
  }
}

test('proximity challenges create one shared authoritative duel and reject abuse', { timeout: 40_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'world-challenge-http-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('../', import.meta.url),
    env: {
      ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', MATCHES_DIR: directory,
      WORLD_CHALLENGE_TTL_MS: '1500', WORLD_CHALLENGE_COOLDOWN_MS: '100',
    },
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
    const request = async (route, payload, cookie = '') => {
      const response = await fetch(base + route, payload === undefined ? { headers: cookie ? { Cookie: cookie } : {} } : {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(payload)
      });
      const text = await response.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
    };
    const watch = async () => {
      const controller = new AbortController(); controllers.push(controller);
      const stream = await openEvents(base, controller);
      await nextEvent(stream);
      return stream;
    };

    const events = await watch();
    const alice = await request('/api/worlds/main/presence/join', { position: { x: 100, y: 100 } });
    assert.equal(alice.status, 201);
    const bob = await request('/api/worlds/main/presence/join', { position: { x: 120, y: 100 } });
    assert.equal(bob.status, 201);
    const carol = await request('/api/worlds/main/presence/join', { position: { x: 900, y: 100 } });
    assert.equal(carol.status, 201);

    // Unknown phrases and free text fail before any invite exists.
    const arbitrary = await request('/api/worlds/main/presence/quick-chat', { phrase_id: 'trade-sol' }, alice.cookie);
    assert.equal(arbitrary.status, 400);
    assert.equal(arbitrary.data.code, 'INVALID_QUICK_CHAT');

    // The nearest human receives the invite; the client never names a target.
    const ttt = await request('/api/worlds/main/presence/quick-chat', { phrase_id: 'ttt' }, alice.cookie);
    assert.equal(ttt.status, 200);
    assert.equal(ttt.data.quick_chat.text, 'tic-tac-toe?');
    assert.equal(ttt.data.challenge.game, 'tictactoe');
    assert.equal(ttt.data.challenge.to_player_id, bob.data.presence_id);
    assert.equal(JSON.stringify(ttt.data).includes('visitorId'), false);
    const challenged = await nextEventOf(events, 'PlayerChallenged');
    assert.equal(challenged.data.challenge.challenge_id, ttt.data.challenge.challenge_id);

    // A visitor with no nearby human cannot invite anyone.
    const lonely = await request('/api/worlds/main/presence/quick-chat', { phrase_id: 'rps' }, carol.cookie);
    assert.equal(lonely.status, 409);
    assert.equal(lonely.data.code, 'NO_NEARBY_HUMAN');

    // Only the addressed visitor accepts; a duplicate accept replays the same duel.
    const wrong = await request(`/api/worlds/main/presence/challenges/${ttt.data.challenge.challenge_id}/accept`, {}, carol.cookie);
    assert.equal(wrong.status, 403);
    assert.equal(wrong.data.code, 'CHALLENGE_NOT_YOURS');
    const accepted = await request(`/api/worlds/main/presence/challenges/${ttt.data.challenge.challenge_id}/accept`, {}, bob.cookie);
    assert.equal(accepted.status, 200);
    assert.match(accepted.data.duel_id, /^duel-[a-f0-9-]{36}$/);
    const acceptedEvent = await nextEventOf(events, 'ChallengeAccepted');
    assert.equal(acceptedEvent.data.duel_id, accepted.data.duel_id);
    const replay = await request(`/api/worlds/main/presence/challenges/${ttt.data.challenge.challenge_id}/accept`, {}, bob.cookie);
    assert.equal(replay.status, 200);
    assert.equal(replay.data.duel_id, accepted.data.duel_id);

    // The same authoritative board is visible to both participants only.
    const aliceView = await request(`/api/world/duels/${accepted.data.duel_id}`, undefined, alice.cookie);
    const bobView = await request(`/api/world/duels/${accepted.data.duel_id}`, undefined, bob.cookie);
    assert.equal(aliceView.status, 200);
    assert.equal(aliceView.data.you.marker, 'a');
    assert.equal(bobView.data.you.marker, 'b');
    assert.deepEqual(aliceView.data.board, bobView.data.board);
    const intruder = await request(`/api/world/duels/${accepted.data.duel_id}`, undefined, carol.cookie);
    assert.equal(intruder.status, 403);
    assert.equal(intruder.data.code, 'DUEL_NOT_YOURS');

    // Turn order is enforced by the rule module; a stale revision is rejected.
    const outOfTurn = await request(`/api/world/duels/${accepted.data.duel_id}/move`, { cell: 0, revision: 0 }, bob.cookie);
    assert.equal(outOfTurn.status, 400);
    assert.equal(outOfTurn.data.code, 'INVALID_MOVE');
    const stale = await request(`/api/world/duels/${accepted.data.duel_id}/move`, { cell: 0, revision: 5 }, alice.cookie);
    assert.equal(stale.status, 409);
    assert.equal(stale.data.code, 'DUEL_REVISION');
    let view = (await request(`/api/world/duels/${accepted.data.duel_id}/move`, { cell: 0, revision: 0 }, alice.cookie)).data;
    view = (await request(`/api/world/duels/${accepted.data.duel_id}/move`, { cell: 3, revision: view.revision }, bob.cookie)).data;
    view = (await request(`/api/world/duels/${accepted.data.duel_id}/move`, { cell: 1, revision: view.revision }, alice.cookie)).data;
    view = (await request(`/api/world/duels/${accepted.data.duel_id}/move`, { cell: 4, revision: view.revision }, bob.cookie)).data;
    view = (await request(`/api/world/duels/${accepted.data.duel_id}/move`, { cell: 2, revision: view.revision }, alice.cookie)).data;
    assert.equal(view.status, 'finished');
    assert.equal(view.result, 'a');
    const finished = await request(`/api/world/duels/${accepted.data.duel_id}/move`, { cell: 5, revision: view.revision }, bob.cookie);
    assert.equal(finished.status, 409);
    assert.equal(finished.data.code, 'DUEL_FINISHED');

    // The shared duel page is a real route, not a second game implementation.
    const page = await fetch(`${base}/duel/${accepted.data.duel_id}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /SHARED MATCH/);
    assert.match(html, /\/web\/dist\/world\/duel\.js/);

    // RPS uses the same session and rule modules.
    await sleep(1_600);
    const rps = await request('/api/worlds/main/presence/quick-chat', { phrase_id: 'rps' }, alice.cookie);
    assert.equal(rps.status, 200);
    assert.equal(rps.data.challenge.game, 'rps');
    const rpsAccepted = await request(`/api/worlds/main/presence/challenges/${rps.data.challenge.challenge_id}/accept`, {}, bob.cookie);
    assert.equal(rpsAccepted.status, 200);
    await request(`/api/world/duels/${rpsAccepted.data.duel_id}/pick`, { move: 'rock' }, alice.cookie);
    const revealed = await request(`/api/world/duels/${rpsAccepted.data.duel_id}/pick`, { move: 'scissors' }, bob.cookie);
    assert.equal(revealed.data.status, 'finished');
    assert.equal(revealed.data.result, 'a');
    const wrongGame = await request(`/api/world/duels/${rpsAccepted.data.duel_id}/move`, { cell: 0, revision: 0 }, alice.cookie);
    assert.equal(wrongGame.status, 409);

    // Decline removes the invite and notifies the challenger without a duel.
    await sleep(1_600);
    const declinedChallenge = await request('/api/worlds/main/presence/quick-chat', { phrase_id: 'ttt' }, alice.cookie);
    const declined = await request(`/api/worlds/main/presence/challenges/${declinedChallenge.data.challenge.challenge_id}/decline`, {}, bob.cookie);
    assert.equal(declined.status, 200);
    assert.deepEqual(declined.data, { declined: true });
    await nextEventOf(events, 'ChallengeDeclined');

    // A challenger leaving clears the invite; no match is created.
    await sleep(1_600);
    const abandoned = await request('/api/worlds/main/presence/quick-chat', { phrase_id: 'ttt' }, alice.cookie);
    assert.equal(abandoned.status, 200);
    const left = await request('/api/worlds/main/presence/leave', {}, alice.cookie);
    assert.equal(left.status, 200);
    await nextEventOf(events, 'ChallengeCancelled');
    const afterLeave = await request(`/api/worlds/main/presence/challenges/${abandoned.data.challenge.challenge_id}/accept`, {}, bob.cookie);
    assert.equal(afterLeave.status, 404);

    // Expired invites create no match.
    await request('/api/worlds/main/presence/join', { position: { x: 100, y: 100 } }, alice.cookie);
    await request('/api/worlds/main/presence/join', { position: { x: 120, y: 100 } }, bob.cookie);
    await sleep(1_600);
    const expiring = await request('/api/worlds/main/presence/quick-chat', { phrase_id: 'ttt' }, alice.cookie);
    assert.equal(expiring.status, 200);
    await sleep(1_700);
    const expired = await request(`/api/worlds/main/presence/challenges/${expiring.data.challenge.challenge_id}/accept`, {}, bob.cookie);
    assert.equal(expired.status, 404);
    assert.equal(expired.data.code, 'CHALLENGE_NOT_FOUND');
    assert.equal((await request(`/api/world/duels/${accepted.data.duel_id}`, undefined, carol.cookie)).status, 403);
  } finally {
    for (const controller of controllers) controller.abort();
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await rm(directory, { recursive: true, force: true });
  }
});
