/**
 * Fair-play constants for proximity Sword Duel.
 *
 * These are deliberately independent of marketplace equipment. Every visitor
 * enters the arena with identical health, speed, damage and reach, so a bought
 * Frostblade can open caves but cannot buy a duel win. The server is the only
 * writer of positions, health, hit results and the winner.
 */
export const SWORD_DUEL = Object.freeze({
  maxHp: 100,
  damage: 14,
  range: 74,
  speed: 190,
  attackCooldownMs: 560,
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

export function publicSwordDuelConfig() {
  return {
    max_hp: SWORD_DUEL.maxHp, damage: SWORD_DUEL.damage, range: SWORD_DUEL.range,
    speed: SWORD_DUEL.speed, attack_cooldown_ms: SWORD_DUEL.attackCooldownMs,
    dodge_duration_ms: SWORD_DUEL.dodgeDurationMs, dodge_cooldown_ms: SWORD_DUEL.dodgeCooldownMs,
    knockback: SWORD_DUEL.knockback, arena: { ...SWORD_DUEL_ARENA },
    standardized: true,
  };
}
