/**
 * Fair-play constants for proximity Sword Duel.
 *
 * These are deliberately independent of marketplace equipment. Every visitor
 * enters the arena with identical health, speed, damage and reach, so a bought
 * Frostblade can open caves but cannot buy a duel win. The server is the only
 * writer of positions, health, hit results and the winner.
 *
 * Attacks are resolved in three server-owned phases: a readable windup, a
 * brief active strike, then a recovery that limits movement and forbids a
 * second strike, a shield or a dodge cancel. Blocks are a scarce resource: two
 * charges in a rolling ten-second window, each lasting under a second. Holding
 * a button can never produce more charges, and invalid attempts are free.
 */
export const SWORD_DUEL = Object.freeze({
  maxHp: 100,
  damage: 14,
  range: 74,
  speed: 190,
  windupMs: 150,
  activeMs: 120,
  recoveryMs: 400,
  attackCooldownMs: 150 + 120 + 400,
  blockCharges: 2,
  blockWindowMs: 10_000,
  blockDurationMs: 700,
  countdownMs: 3_000,
  dodgeDurationMs: 260,
  dodgeCooldownMs: 1_400,
  stunMs: 180,
  hitFeedbackMs: 220,
  knockback: 36,
  arena: Object.freeze({ width: 960, height: 540, margin: 46 }),
  matchTtlMs: 3 * 60_000,
});

export const SWORD_DUEL_ARENA = Object.freeze({
  width: SWORD_DUEL.arena.width,
  height: SWORD_DUEL.arena.height,
  minX: SWORD_DUEL.arena.margin,
  maxX: SWORD_DUEL.arena.width - SWORD_DUEL.arena.margin,
  minY: SWORD_DUEL.arena.margin,
  maxY: SWORD_DUEL.arena.height - SWORD_DUEL.arena.margin,
});

/** The complete attack window; the strike resolves at the end of the windup. */
export const SWORD_ATTACK_MS = SWORD_DUEL.windupMs + SWORD_DUEL.activeMs + SWORD_DUEL.recoveryMs;

/** Named phases used by both the server view and the browser poses. */
export const SWORD_PHASES = Object.freeze(['idle', 'windup', 'active', 'recovery', 'blocking']);

export function publicSwordDuelConfig() {
  return {
    max_hp: SWORD_DUEL.maxHp, damage: SWORD_DUEL.damage, range: SWORD_DUEL.range,
    speed: SWORD_DUEL.speed, attack_cooldown_ms: SWORD_DUEL.attackCooldownMs,
    windup_ms: SWORD_DUEL.windupMs, active_ms: SWORD_DUEL.activeMs,
    recovery_ms: SWORD_DUEL.recoveryMs,
    block_charges: SWORD_DUEL.blockCharges, block_window_ms: SWORD_DUEL.blockWindowMs,
    block_duration_ms: SWORD_DUEL.blockDurationMs, countdown_ms: SWORD_DUEL.countdownMs,
    dodge_duration_ms: SWORD_DUEL.dodgeDurationMs, dodge_cooldown_ms: SWORD_DUEL.dodgeCooldownMs,
    knockback: SWORD_DUEL.knockback, arena: { ...SWORD_DUEL_ARENA },
    standardized: true,
  };
}
