import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldPresenceService } from '../service/world-presence.js';
import { WorldChallengeService } from '../service/world-challenges.js';
import { SWORD_DUEL } from '../src/sword-duel.js';

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const carol = '33333333-3333-4333-8333-333333333333';

function build() {
  let now = 100_000;
  const presence = new WorldPresenceService({ identitySecret: 'test-world-presence-secret-value-32', now: () => now });
  const challenges = new WorldChallengeService({ presence, now: () => now, challengeTtlMs: 15_000, challengeCooldownMs: 4_000, duelTtlMs: 60_000, finishedTtlMs: 30_000, acceptedTtlMs: 10_000 });
  presence.join('main', alice, { position: { x: 100, y: 100 } });
  presence.join('main', bob, { position: { x: 150, y: 100 } });
  return { presence, challenges, clock: () => now, advance: ms => { now += ms; } };
}
function startDuel() {
  const ctx = build();
  const challenge = ctx.challenges.create('main', alice, 'sword');
  assert.equal(challenge.game, 'swordduel');
  const accepted = ctx.challenges.accept('main', bob, challenge.challenge_id);
  return { ...ctx, duelId: accepted.duel_id };
}
function state(ctx) { return ctx.challenges.view('main', alice, ctx.duelId); }
function fighters(ctx) { return ctx.challenges.duels.get(ctx.duelId).arena.fighters; }

test('a proximity Sword Duel gives both players identical standardised combat state', () => {
  const ctx = startDuel();
  const view = state(ctx);
  assert.equal(view.game, 'swordduel');
  assert.equal(view.combat.standardized, true);
  assert.equal(view.combat.damage, SWORD_DUEL.damage);
  assert.equal(view.combat.max_hp, SWORD_DUEL.maxHp);
  assert.deepEqual(view.fighters.map(fighter => fighter.hp), [100, 100]);
  assert.equal(view.fighters[0].exterior.x, 100, 'each fighter carries its own pre-duel world position');
  assert.equal(view.fighters[1].exterior.x, 150);
  assert.equal('inventory' in view, false);
  assert.equal('credits' in view, false);
  const opponentView = ctx.challenges.view('main', bob, ctx.duelId);
  assert.deepEqual(opponentView.fighters, view.fighters, 'both browsers see the same authoritative arena');
  assert.equal(opponentView.you.player_id, view.opponent.player_id);
});

test('movement is bounded to the arena and server clock', () => {
  const ctx = startDuel();
  assert.throws(() => ctx.challenges.command('main', alice, ctx.duelId, 'move', { x: 900, y: 270 }), { code: 'DUEL_MOVE_TOO_FAR' });
  ctx.advance(500);
  const moved = ctx.challenges.command('main', alice, ctx.duelId, 'move', { x: 260, y: 280, facing: 'right' });
  assert.equal(moved.fighters[0].x, 260);
  assert.equal(moved.fighters[0].y, 280);
  assert.equal(moved.fighters[0].facing, 'right');
  assert.throws(() => ctx.challenges.command('main', carol, ctx.duelId, 'move', { x: 300, y: 280 }), { code: 'DUEL_NOT_YOURS' });
});

test('attacks are cooldown-bound, range-checked, idempotent and server-authoritative', () => {
  const ctx = startDuel();
  const arena = ctx.challenges.duels.get(ctx.duelId).arena;
  const [a, b] = Object.values(arena.fighters);
  a.x = 300; a.y = 270; a.facing = 'right';
  b.x = 740; b.y = 270;

  const miss = ctx.challenges.command('main', alice, ctx.duelId, 'attack', { request_id: 'swing-miss-0001' });
  assert.equal(miss.fighters[1].hp, 100);
  assert.equal(miss.events.at(-1).type, 'miss');
  assert.equal(miss.events.at(-1).reason, 'range');

  // A duplicate request id must never resolve a second hit.
  ctx.advance(SWORD_DUEL.attackCooldownMs);
  const replayedMiss = ctx.challenges.command('main', alice, ctx.duelId, 'attack', { request_id: 'swing-miss-0001' });
  assert.equal(replayedMiss.fighters[1].hp, 100, 'replayed attack id has no effect');

  b.x = 350; b.y = 270;
  ctx.advance(SWORD_DUEL.attackCooldownMs);
  const hit = ctx.challenges.command('main', alice, ctx.duelId, 'attack', { request_id: 'swing-hit-0001' });
  assert.equal(hit.fighters[1].hp, 100 - SWORD_DUEL.damage, 'only the server assigns damage');
  assert.equal(hit.events.at(-1).damage, SWORD_DUEL.damage);
  assert.ok(hit.fighters[1].x > 350, 'a hit knocks the target back');
  assert.throws(() => ctx.challenges.command('main', alice, ctx.duelId, 'attack', { request_id: 'swing-fast-0001' }), { code: 'DUEL_COOLDOWN' });

  ctx.advance(SWORD_DUEL.attackCooldownMs);
  const duplicate = ctx.challenges.command('main', alice, ctx.duelId, 'attack', { request_id: 'swing-hit-0001' });
  assert.equal(duplicate.fighters[1].hp, 100 - SWORD_DUEL.damage, 'a retried hit cannot double damage');
});

test('dodge avoids a hit, and the server alone declares the winner', () => {
  const ctx = startDuel();
  const arena = ctx.challenges.duels.get(ctx.duelId).arena;
  const [a, b] = Object.values(arena.fighters);
  a.x = 300; a.y = 270; a.facing = 'right';
  b.x = 350; b.y = 270;

  const dodged = ctx.challenges.command('main', bob, ctx.duelId, 'dodge', { request_id: 'dodge-bob-0001' });
  assert.equal(dodged.fighters[1].dodging, true);
  const avoided = ctx.challenges.command('main', alice, ctx.duelId, 'attack', { request_id: 'swing-dodged-0001' });
  assert.equal(avoided.fighters[1].hp, 100);
  assert.equal(avoided.events.at(-1).type, 'dodge');

  ctx.advance(SWORD_DUEL.dodgeCooldownMs);
  b.dodgeUntil = 0;
  b.hp = SWORD_DUEL.damage;
  ctx.advance(SWORD_DUEL.attackCooldownMs);
  const finished = ctx.challenges.command('main', alice, ctx.duelId, 'attack', { request_id: 'swing-win-0001' });
  assert.equal(finished.status, 'finished');
  assert.equal(finished.fighters[1].hp, 0);
  assert.equal(finished.result, 'a');
  assert.equal(finished.winner_player_id, ctx.presence.presenceId('main', alice), 'the server names the winner');
  assert.throws(() => ctx.challenges.command('main', bob, ctx.duelId, 'attack', { request_id: 'late-swing-0001' }), { code: 'DUEL_FINISHED' });
});

test('spectators read the same arena and never hold a command seat', () => {
  const ctx = startDuel();
  const spectate = ctx.challenges.spectate('main', ctx.duelId);
  assert.equal(spectate.spectating, true);
  assert.equal(spectate.fighters.length, 2);
  assert.deepEqual(spectate.fighters.map(fighter => fighter.hp), [100, 100]);
  assert.equal('you' in spectate, false);
  assert.throws(() => ctx.challenges.command('main', carol, ctx.duelId, 'attack', { request_id: 'spectator-swing' }), { code: 'DUEL_NOT_YOURS' });
  const board = ctx.challenges.publicList('main');
  assert.equal(board.live[0].game, 'swordduel');
  assert.deepEqual(board.live[0].health, [100, 100]);
  assert.equal(board.live[0].standardized, true);
});
