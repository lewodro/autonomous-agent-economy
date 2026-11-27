import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldPresenceService } from '../service/world-presence.js';
import { WorldChallengeService } from '../service/world-challenges.js';
import { SWORD_ATTACK_MS, SWORD_DUEL } from '../src/sword-duel.js';

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
  ctx.advance(SWORD_DUEL.countdownMs);
  return { ...ctx, duelId: accepted.duel_id };
}
function state(ctx) { return ctx.challenges.view('main', alice, ctx.duelId); }
function fighters(ctx) { return ctx.challenges.duels.get(ctx.duelId).arena.fighters; }
function faceEachOther(ctx, distance = 50) {
  const [a, b] = Object.values(fighters(ctx));
  a.x = 300; a.y = 270; a.facing = 'right';
  b.x = 300 + distance; b.y = 270; b.facing = 'left';
}
/** Starts a swing and advances past its windup so the server resolves it. */
function resolveSwing(ctx, player, requestId) {
  ctx.challenges.command('main', player, ctx.duelId, 'attack', { request_id: requestId });
  ctx.advance(SWORD_DUEL.windupMs);
  return state(ctx);
}

test('a proximity Sword Duel gives both players identical standardised combat state', () => {
  const ctx = startDuel();
  const view = state(ctx);
  assert.equal(view.game, 'swordduel');
  assert.equal(view.combat.standardized, true);
  assert.equal(view.combat.damage, SWORD_DUEL.damage);
  assert.equal(view.combat.max_hp, SWORD_DUEL.maxHp);
  assert.equal(view.combat.windup_ms, SWORD_DUEL.windupMs);
  assert.equal(view.combat.block_charges, SWORD_DUEL.blockCharges);
  assert.deepEqual(view.fighters.map(fighter => fighter.hp), [100, 100]);
  assert.equal(view.fighters[0].exterior.x, 100, 'each fighter carries its own pre-duel world position');
  assert.equal(view.fighters[1].exterior.x, 150);
  assert.equal('inventory' in view, false);
  assert.equal('credits' in view, false);
  const opponentView = ctx.challenges.view('main', bob, ctx.duelId);
  assert.deepEqual(opponentView.fighters, view.fighters, 'both browsers see the same authoritative arena');
  assert.equal(opponentView.you.player_id, view.opponent.player_id);
});

test('both fighters wait out a server countdown before any combat command', () => {
  const ctx = build();
  const challenge = ctx.challenges.create('main', alice, 'sword');
  const accepted = ctx.challenges.accept('main', bob, challenge.challenge_id);
  const duelId = accepted.duel_id;
  const waiting = ctx.challenges.view('main', alice, duelId);
  assert.equal(waiting.status, 'playing', 'polling keeps working during the countdown');
  assert.equal(waiting.countdown_ms, SWORD_DUEL.countdownMs);
  assert.equal(waiting.fighters[0].can_attack, false);
  assert.throws(() => ctx.challenges.command('main', alice, duelId, 'attack', { request_id: 'early-swing-0001' }), { code: 'DUEL_COUNTDOWN' });
  assert.throws(() => ctx.challenges.command('main', bob, duelId, 'block', { request_id: 'early-block-0001' }), { code: 'DUEL_COUNTDOWN' });
  assert.throws(() => ctx.challenges.command('main', bob, duelId, 'dodge', { request_id: 'early-dodge-0001' }), { code: 'DUEL_COUNTDOWN' });
  ctx.advance(SWORD_DUEL.countdownMs);
  assert.equal(ctx.challenges.view('main', alice, duelId).countdown_ms, 0);
  assert.equal(ctx.challenges.view('main', alice, duelId).fighters[0].can_attack, true);
});

test('movement is bounded to the arena and slowed during recovery and shielding', () => {
  const ctx = startDuel();
  assert.throws(() => ctx.challenges.command('main', alice, ctx.duelId, 'move', { x: 900, y: 270 }), { code: 'DUEL_MOVE_TOO_FAR' });
  ctx.advance(500);
  const moved = ctx.challenges.command('main', alice, ctx.duelId, 'move', { x: 260, y: 280, facing: 'right' });
  assert.equal(moved.fighters[0].x, 260);
  assert.equal(moved.fighters[0].y, 280);
  assert.equal(moved.fighters[0].facing, 'right');
  assert.throws(() => ctx.challenges.command('main', carol, ctx.duelId, 'move', { x: 300, y: 280 }), { code: 'DUEL_NOT_YOURS' });

  ctx.challenges.command('main', alice, ctx.duelId, 'attack', { request_id: 'move-recovery-0001' });
  assert.throws(() => ctx.challenges.command('main', alice, ctx.duelId, 'move', { x: 400, y: 280 }), { code: 'DUEL_MOVE_TOO_FAR' },
    'a committed swing restricts movement');
  ctx.advance(SWORD_ATTACK_MS);
  ctx.challenges.command('main', bob, ctx.duelId, 'block', { request_id: 'move-shield-0001' });
  assert.throws(() => ctx.challenges.command('main', bob, ctx.duelId, 'move', { x: 600, y: 270 }), { code: 'DUEL_MOVE_TOO_FAR' },
    'the shield stance restricts movement');
});

test('attacks resolve after a windup, carry recovery, and are idempotent', () => {
  const ctx = startDuel();
  const [a, b] = Object.values(fighters(ctx));
  a.x = 300; a.y = 270; a.facing = 'right';
  b.x = 740; b.y = 270;

  const started = ctx.challenges.command('main', alice, ctx.duelId, 'attack', { request_id: 'swing-miss-0001' });
  assert.equal(started.fighters[0].phase, 'windup');
  assert.equal(started.fighters[1].hp, 100, 'no damage is dealt before the active strike');
  ctx.advance(SWORD_DUEL.windupMs);
  const missed = state(ctx);
  assert.equal(missed.events.at(-1).type, 'miss');
  assert.equal(missed.events.at(-1).reason, 'range');
  assert.equal(missed.fighters[0].phase, 'active');

  ctx.advance(SWORD_DUEL.activeMs);
  assert.equal(state(ctx).fighters[0].phase, 'recovery');
  assert.throws(() => ctx.challenges.command('main', alice, ctx.duelId, 'attack', { request_id: 'swing-fast-0001' }), { code: 'DUEL_RECOVERY' });
  assert.throws(() => ctx.challenges.command('main', alice, ctx.duelId, 'block', { request_id: 'shield-fast-0001' }), { code: 'DUEL_RECOVERY' });
  assert.throws(() => ctx.challenges.command('main', alice, ctx.duelId, 'dodge', { request_id: 'dodge-fast-0001' }), { code: 'DUEL_RECOVERY' },
    'a dodge cannot cancel the committed swing');

  // Replayed request IDs never resolve a second hit.
  ctx.advance(SWORD_DUEL.recoveryMs);
  const replayedMiss = ctx.challenges.command('main', alice, ctx.duelId, 'attack', { request_id: 'swing-miss-0001' });
  assert.equal(replayedMiss.fighters[1].hp, 100);

  b.x = 350; b.y = 270;
  const hit = resolveSwing(ctx, alice, 'swing-hit-0001');
  assert.equal(hit.fighters[1].hp, 100 - SWORD_DUEL.damage, 'only the server assigns damage');
  assert.equal(hit.events.at(-1).damage, SWORD_DUEL.damage);
  assert.ok(hit.fighters[1].x > 350, 'a hit knocks the target back');
  assert.throws(() => ctx.challenges.command('main', alice, ctx.duelId, 'attack', { request_id: 'swing-cooldown-0001' }), { code: 'DUEL_RECOVERY' });

  ctx.advance(SWORD_ATTACK_MS);
  const duplicate = resolveSwing(ctx, alice, 'swing-hit-0001');
  assert.equal(duplicate.fighters[1].hp, 100 - SWORD_DUEL.damage, 'a retried hit cannot double damage');
});

test('two shield charges, a rolling window and free invalid attempts', () => {
  const ctx = startDuel();
  const [a, b] = Object.values(fighters(ctx));
  a.x = 300; a.y = 270; a.facing = 'right';
  b.x = 350; b.y = 270;

  const first = ctx.challenges.command('main', bob, ctx.duelId, 'block', { request_id: 'block-bob-0001' });
  assert.equal(first.fighters[1].phase, 'blocking');
  assert.equal(first.fighters[1].block_charges, 1);
  assert.equal(first.fighters[1].block_recharge_ms, 0, 'one spent charge still leaves one ready');
  assert.throws(() => ctx.challenges.command('main', bob, ctx.duelId, 'block', { request_id: 'block-bob-0002' }), { code: 'DUEL_BLOCKING' },
    'holding the button cannot stack shields');
  const blocked = resolveSwing(ctx, alice, 'swing-blocked-0001');
  assert.equal(blocked.fighters[1].hp, 100, 'a raised shield stops the strike');
  assert.equal(blocked.events.at(-1).type, 'block');

  ctx.advance(SWORD_DUEL.blockDurationMs);
  assert.equal(state(ctx).fighters[1].block_charges, 1, 'the spent charge stays spent during the window');
  ctx.challenges.command('main', bob, ctx.duelId, 'block', { request_id: 'block-bob-0003' });
  ctx.advance(SWORD_DUEL.blockDurationMs);
  assert.throws(() => ctx.challenges.command('main', bob, ctx.duelId, 'block', { request_id: 'block-bob-0004' }), { code: 'DUEL_NO_CHARGE' });
  const drained = ctx.challenges.view('main', alice, ctx.duelId).fighters[1];
  assert.equal(drained.block_charges, 0);
  assert.ok(drained.block_recharge_ms > 0, 'the HUD receives time until the first charge returns');

  ctx.advance(SWORD_DUEL.blockWindowMs);
  const refreshed = state(ctx);
  assert.equal(refreshed.fighters[1].block_charges, 2, 'charges roll back in one by one');
  ctx.challenges.command('main', bob, ctx.duelId, 'block', { request_id: 'block-bob-0005' });
  assert.equal(ctx.challenges.view('main', alice, ctx.duelId).fighters[1].block_charges, 1);
  const replay = ctx.challenges.command('main', bob, ctx.duelId, 'block', { request_id: 'block-bob-0003' });
  assert.equal(replay.fighters[1].block_charges, 1, 'a replayed block id consumes nothing');
});

test('simultaneous attacks trade and the server alone declares the winner', () => {
  const ctx = startDuel();
  faceEachOther(ctx);
  ctx.challenges.command('main', alice, ctx.duelId, 'attack', { request_id: 'trade-a-0001' });
  ctx.challenges.command('main', bob, ctx.duelId, 'attack', { request_id: 'trade-b-0001' });
  ctx.advance(SWORD_DUEL.windupMs);
  const traded = state(ctx);
  assert.deepEqual(traded.fighters.map(fighter => fighter.hp), [100 - SWORD_DUEL.damage, 100 - SWORD_DUEL.damage],
    'both committed strikes resolve deterministically');

  const [a, b] = Object.values(fighters(ctx));
  ctx.advance(SWORD_ATTACK_MS);
  b.hp = SWORD_DUEL.damage;
  b.stunUntil = 0;
  faceEachOther(ctx);
  const finished = resolveSwing(ctx, alice, 'swing-win-0001');
  assert.equal(finished.status, 'finished');
  assert.equal(finished.fighters[1].hp, 0);
  assert.equal(finished.result, 'a');
  assert.equal(finished.winner_player_id, ctx.presence.presenceId('main', alice), 'the server names the winner');
  assert.throws(() => ctx.challenges.command('main', bob, ctx.duelId, 'attack', { request_id: 'late-swing-0001' }), { code: 'DUEL_FINISHED' });
});

test('a dodge still avoids a hit when timed before the active strike', () => {
  const ctx = startDuel();
  faceEachOther(ctx);
  const dodged = ctx.challenges.command('main', bob, ctx.duelId, 'dodge', { request_id: 'dodge-bob-0001' });
  assert.equal(dodged.fighters[1].dodging, true);
  ctx.advance(SWORD_DUEL.dodgeDurationMs + SWORD_DUEL.dodgeCooldownMs);
  Object.values(fighters(ctx))[1].dodgeUntil = 0;
  faceEachOther(ctx);
  const avoided = ctx.challenges.command('main', bob, ctx.duelId, 'dodge', { request_id: 'dodge-bob-0002' });
  assert.equal(avoided.fighters[1].dodging, true);
  const hit = resolveSwing(ctx, alice, 'swing-dodged-0001');
  assert.equal(hit.fighters[1].hp, 100);
  assert.equal(hit.events.at(-1).type, 'dodge');
});

test('spectators read the same arena and never hold a command seat', () => {
  const ctx = startDuel();
  const spectate = ctx.challenges.spectate('main', ctx.duelId);
  assert.equal(spectate.spectating, true);
  assert.equal(spectate.fighters.length, 2);
  assert.equal(spectate.countdown_ms, 0);
  assert.deepEqual(spectate.fighters.map(fighter => fighter.hp), [100, 100]);
  assert.equal('you' in spectate, false);
  assert.throws(() => ctx.challenges.command('main', carol, ctx.duelId, 'attack', { request_id: 'spectator-swing' }), { code: 'DUEL_NOT_YOURS' });
  const board = ctx.challenges.publicList('main');
  assert.equal(board.live[0].game, 'swordduel');
  assert.deepEqual(board.live[0].health, [100, 100]);
  assert.equal(board.live[0].standardized, true);
});
