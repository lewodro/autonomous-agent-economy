import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldPresenceService } from '../service/world-presence.js';

test('presence joins, validates bounded movement, and removes stale players', () => {
  let now = 1_000;
  const service = new WorldPresenceService({ now: () => now, staleMs: 100, minUpdateMs: 50 });
  const a = service.join('main', { player_id: 'alice', avatar: 'explorer', position: { x: 100, y: 100 } });
  const b = service.join('main', { player_id: 'bob', position: { x: 120, y: 100 } });
  assert.equal(a.players.length, 1); assert.equal(b.players.length, 2);
  assert.throws(() => service.join('main', { player_id: 'alice', position: { x: 900, y: 100 } }), { code: 'PRESENCE_NOT_AUTHORIZED' });
  assert.equal(service.join('main', { player_id: 'alice', session_token: a.session_token, position: { x: 100, y: 100 } }).player.player_id, 'alice');
  now += 60;
  assert.deepEqual(service.move('main', { player_id: 'alice', session_token: a.session_token, position: { x: 115, y: 100 }, direction: 'right', animation_state: 'walk' }).player.position, { x: 115, y: 100 });
  now += 60;
  assert.throws(() => service.move('main', { player_id: 'alice', session_token: a.session_token, position: { x: 900, y: 100 } }), { code: 'INVALID_POSITION' });
  assert.throws(() => service.move('main', { player_id: 'alice', session_token: 'wrong', position: { x: 116, y: 100 } }), { code: 'PRESENCE_NOT_AUTHORIZED' });
  now += 101;
  assert.equal(service.snapshot('main').players.length, 0);
});

test('presence limits update frequency and does not expose session tokens', () => {
  const service = new WorldPresenceService({ now: () => 1_000, minUpdateMs: 100 });
  const joined = service.join('main', { player_id: 'visitor', position: { x: 10, y: 10 } });
  assert.equal('token' in joined.player, false);
  assert.throws(() => service.move('main', { player_id: 'visitor', session_token: joined.session_token, position: { x: 11, y: 10 } }), { code: 'PRESENCE_RATE_LIMITED' });
  assert.throws(() => service.join('bad/world', {}), { code: 'WORLD_NOT_FOUND' });
});
