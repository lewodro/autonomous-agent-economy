/**
 * Frostgate mountain mobs. Pure data and simulation so the snow renderer only
 * paints the result and the browser never needs server authority.
 *
 * Two kinds share one walking/animation system:
 * - mountain goats graze in peace and only fight back once struck;
 * - frost barbarians defend their stretch of the pass and attack on sight.
 *
 * Spawn anchors are authored across all five terraces, and every anchor is a
 * respawn slot, so the mountain keeps breathing without endless new actors.
 */
import type { Facing, Position } from './model.js';
import {
  FROSTGATE_BUILDINGS, FROSTGATE_LANDMARKS, SNOW_OBSTACLES, SNOW_RETURN, SNOW_SPAWN,
  SNOW_WORLD, TERRACES, cliffBlocks, type Terrace,
} from './frostgate.js';

export type MobKind = 'goat' | 'barbarian';
export type MobMode = 'wander' | 'graze' | 'chase' | 'attack' | 'hurt' | 'return' | 'dead';

export interface MobDefinition {
  kind: MobKind;
  label: string;
  /** Walking pace in world pixels per second. The visitor walks at 150. */
  speed: number;
  maxHp: number;
  damage: number;
  aggroRadius: number;
  attackRange: number;
  attackCooldownMs: number;
  respawnMs: number;
  /** Neutral until the visitor lands the first strike. */
  provokeOnly: boolean;
  /** How far a mob will chase before giving up and returning home. */
  leash: number;
  /** Body scale used by the pixel renderer. */
  scale: number;
}

export const MOB_DEFINITIONS: Readonly<Record<MobKind, MobDefinition>> = {
  goat: {
    kind: 'goat', label: 'MOUNTAIN GOAT', speed: 52, maxHp: 34, damage: 4,
    aggroRadius: 0, attackRange: 30, attackCooldownMs: 1100, respawnMs: 24000,
    provokeOnly: true, leash: 330, scale: 1,
  },
  barbarian: {
    kind: 'barbarian', label: 'FROST BARBARIAN', speed: 74, maxHp: 52, damage: 9,
    aggroRadius: 235, attackRange: 34, attackCooldownMs: 900, respawnMs: 32000,
    provokeOnly: false, leash: 540, scale: 1,
  },
};

/** Eight gait frames keep hooves and boots readable at 480x360. */
export const MOB_WALK_FRAMES = 8;
export const PLAYER_MAX_HP = 100;
export const PLAYER_STRIKE_RANGE = 54;
export const PLAYER_STRIKE_DAMAGE = 18;
export const PLAYER_STRIKE_COOLDOWN_MS = 420;
export const PLAYER_HURT_INVULNERABLE_MS = 650;
export const PLAYER_REGEN_DELAY_MS = 4500;
export const PLAYER_REGEN_PER_SECOND = 5;

export interface MobSpawn {
  id: string;
  kind: MobKind;
  position: Position;
  terrace: string;
}

export interface Mob {
  id: string;
  kind: MobKind;
  spawn: Position;
  position: Position;
  facing: Facing;
  hp: number;
  maxHp: number;
  mode: MobMode;
  target: Position;
  moving: boolean;
  phase: number;
  aggro: boolean;
  provokedUntil: number;
  lastHurtAt: number;
  hurtUntil: number;
  attackUntil: number;
  nextAttackAt: number;
  wanderUntil: number;
  respawnAt: number;
  spawnFadeUntil: number;
  deadAt: number;
}

function hashUnit(x: number, y: number, seed = 0): number {
  let value = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed, 1597334677)) >>> 0;
  value = (value ^ (value >>> 13)) >>> 0;
  value = Math.imul(value, 1274126177) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function spawnSafe(x: number, y: number): boolean {
  if (x < 160 || y < 120 || x > SNOW_WORLD.width - 160 || y > SNOW_WORLD.height - 160) return false;
  if (cliffBlocks(x, y, 30)) return false;
  if (Math.hypot(x - SNOW_SPAWN.x, y - SNOW_SPAWN.y) < 340) return false;
  if (Math.hypot(x - SNOW_RETURN.x, y - SNOW_RETURN.y) < 340) return false;
  if (SNOW_OBSTACLES.some(rect => x + 34 > rect.x && x - 34 < rect.x + rect.width
    && y + 34 > rect.y && y - 34 < rect.y + rect.height)) return false;
  if (FROSTGATE_LANDMARKS.some(site => Math.hypot(x - site.position.x, y - site.position.y) < site.radius + 46)) return false;
  return true;
}

function terraceAnchor(terrace: Terrace, index: number, attempt: number): Position {
  const minY = terrace.minY + 220, maxY = terrace.maxY - 220;
  const x = 220 + hashUnit(terrace.elevation * 37 + index, attempt, 11) * (SNOW_WORLD.width - 440);
  const y = minY + hashUnit(terrace.elevation * 53 + index, attempt, 29) * Math.max(1, maxY - minY);
  return { x: Math.round(x), y: Math.round(y) };
}

/** 27 authored slots: at least four per terrace, alternating goats and raiders. */
export const MOB_SPAWNS: readonly MobSpawn[] = (() => {
  const spawns: MobSpawn[] = [];
  for (const terrace of TERRACES) {
    const count = terrace.elevation === 0 ? 4 : terrace.elevation === 4 ? 5 : 6;
    for (let index = 0; index < count; index++) {
      let point = terraceAnchor(terrace, index, 0);
      for (let attempt = 1; attempt < 48 && !spawnSafe(point.x, point.y); attempt++) {
        point = terraceAnchor(terrace, index, attempt);
      }
      const kind: MobKind = (index + terrace.elevation) % 2 === 0 ? 'goat' : 'barbarian';
      spawns.push({
        id: `frost-${terrace.id}-${index + 1}`,
        kind,
        position: point,
        terrace: terrace.id,
      });
    }
  }
  return spawns;
})();

export function createMob(spawn: MobSpawn, now = 0): Mob {
  const definition = MOB_DEFINITIONS[spawn.kind];
  return {
    id: spawn.id,
    kind: spawn.kind,
    spawn: { ...spawn.position },
    position: { ...spawn.position },
    facing: hashUnit(spawn.position.x, spawn.position.y, 7) > .5 ? 'right' : 'left',
    hp: definition.maxHp,
    maxHp: definition.maxHp,
    mode: 'wander',
    target: { ...spawn.position },
    moving: false,
    phase: Math.floor(hashUnit(spawn.position.x, spawn.position.y, 13) * MOB_WALK_FRAMES),
    aggro: false,
    provokedUntil: 0,
    lastHurtAt: 0,
    hurtUntil: 0,
    attackUntil: 0,
    nextAttackAt: 0,
    wanderUntil: now + 600 + Math.floor(hashUnit(spawn.position.x, spawn.position.y, 19) * 2200),
    respawnAt: 0,
    spawnFadeUntil: now + 900,
    deadAt: 0,
  };
}

export function createMobs(now = 0): Mob[] {
  return MOB_SPAWNS.map(spawn => createMob(spawn, now));
}

function distance(a: Position, b: Position): number { return Math.hypot(a.x - b.x, a.y - b.y); }

function facingToward(from: Position, to: Position): Facing {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}

function revive(mob: Mob, now: number): void {
  mob.position = { ...mob.spawn };
  mob.hp = mob.maxHp;
  mob.mode = 'wander';
  mob.target = { ...mob.spawn };
  mob.moving = false;
  mob.aggro = false;
  mob.provokedUntil = 0;
  mob.hurtUntil = 0;
  mob.attackUntil = 0;
  mob.nextAttackAt = 0;
  mob.wanderUntil = now + 700 + (mob.phase % 4) * 500;
  mob.respawnAt = 0;
  mob.spawnFadeUntil = now + 900;
  mob.deadAt = 0;
}

function moveToward(mob: Mob, target: Position, step: number, canWalk: (x: number, y: number) => boolean): boolean {
  const dx = target.x - mob.position.x, dy = target.y - mob.position.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return false;
  mob.facing = facingToward(mob.position, target);
  const travel = Math.min(step, length);
  const nx = mob.position.x + dx / length * travel;
  const ny = mob.position.y + dy / length * travel;
  let moved = false;
  if (canWalk(nx, mob.position.y)) { mob.position.x = nx; moved = true; }
  if (canWalk(mob.position.x, ny)) { mob.position.y = ny; moved = true; }
  // If a rock or cliff face blocks the direct line, slide sideways once so a
  // mob never vibrates against a wall while chasing.
  if (!moved) {
    const side = { x: mob.position.x - dy / length * travel, y: mob.position.y + dx / length * travel };
    if (canWalk(side.x, mob.position.y)) { mob.position.x = side.x; moved = true; }
    else if (canWalk(mob.position.x, side.y)) { mob.position.y = side.y; moved = true; }
  }
  return moved;
}

function pickWanderTarget(mob: Mob, now: number): void {
  const angle = hashUnit(mob.phase + 1, Math.floor(now / 900), 31) * Math.PI * 2;
  const radius = 34 + hashUnit(mob.phase + 2, Math.floor(now / 900), 43) * 72;
  mob.target = {
    x: mob.spawn.x + Math.cos(angle) * radius,
    y: mob.spawn.y + Math.sin(angle) * radius * .7,
  };
  mob.mode = 'wander';
  mob.wanderUntil = now + 2200 + Math.floor(hashUnit(mob.phase, Math.floor(now / 900), 59) * 2600);
}

export interface MobAttack { mobId: string; kind: MobKind; damage: number }
export interface MobStepResult {
  damage: number;
  attacks: MobAttack[];
  respawned: string[];
}

/** Advance every mob. Returns damage dealt to the visitor this frame. */
export function stepMobs(
  mobs: Mob[],
  player: Position,
  dt: number,
  now: number,
  canWalk: (x: number, y: number) => boolean,
): MobStepResult {
  const result: MobStepResult = { damage: 0, attacks: [], respawned: [] };
  for (const mob of mobs) {
    if (mob.mode === 'dead') {
      if (mob.respawnAt && now >= mob.respawnAt) {
        revive(mob, now);
        result.respawned.push(mob.id);
      }
      continue;
    }
    const definition = MOB_DEFINITIONS[mob.kind];
    const toPlayer = distance(mob.position, player);
    const home = distance(mob.position, mob.spawn);

    if (now < mob.hurtUntil) { mob.moving = false; continue; }

    // Recover health only after a quiet spell at home.
    if (!mob.aggro && now > mob.lastHurtAt + 6000 && mob.hp < mob.maxHp) {
      mob.hp = Math.min(mob.maxHp, mob.hp + 6 * dt);
    }

    if (definition.provokeOnly) {
      mob.aggro = now < mob.provokedUntil && toPlayer < definition.leash;
    } else if (!mob.aggro && toPlayer <= definition.aggroRadius) {
      mob.aggro = true;
    }
    if (mob.aggro && (toPlayer > definition.leash || home > definition.leash * 1.15)) mob.aggro = false;

    if (mob.aggro) {
      if (toPlayer <= definition.attackRange) {
        mob.moving = false;
        mob.facing = facingToward(mob.position, player);
        if (now >= mob.nextAttackAt) {
          mob.mode = 'attack';
          mob.attackUntil = now + 280;
          mob.nextAttackAt = now + definition.attackCooldownMs;
          result.damage += definition.damage;
          result.attacks.push({ mobId: mob.id, kind: mob.kind, damage: definition.damage });
        } else if (now >= mob.attackUntil) {
          mob.mode = 'chase';
        }
        continue;
      }
      mob.mode = 'chase';
      mob.moving = moveToward(mob, player, definition.speed * dt, canWalk);
      continue;
    }

    if (home > 42) {
      mob.mode = 'return';
      mob.moving = moveToward(mob, mob.spawn, definition.speed * .72 * dt, canWalk);
      continue;
    }

    if (now >= mob.wanderUntil) pickWanderTarget(mob, now);
    if (mob.mode === 'wander' && distance(mob.position, mob.target) > 8) {
      mob.moving = moveToward(mob, mob.target, definition.speed * .46 * dt, canWalk);
    } else {
      mob.mode = 'graze';
      mob.moving = false;
    }
  }
  return result;
}

export function nearestMob(mobs: readonly Mob[], point: Position, range = PLAYER_STRIKE_RANGE): Mob | null {
  return mobs
    .filter(mob => mob.mode !== 'dead' && distance(mob.position, point) <= range)
    .sort((a, b) => distance(a.position, point) - distance(b.position, point))[0] ?? null;
}

export function mobAt(mobs: readonly Mob[], point: Position, radius = 28): Mob | null {
  return mobs
    .filter(mob => mob.mode !== 'dead' && distance(mob.position, point) <= radius)
    .sort((a, b) => distance(a.position, point) - distance(b.position, point))[0] ?? null;
}

export interface MobStrike {
  mob: Mob;
  damage: number;
  killed: boolean;
}

/** The visitor's single melee strike. Goats become hostile only after this. */
export function strikeMob(
  mobs: Mob[],
  player: Position,
  now: number,
  canWalk: (x: number, y: number) => boolean = () => true,
): MobStrike | null {
  const target = nearestMob(mobs, player);
  if (!target) return null;
  const definition = MOB_DEFINITIONS[target.kind];
  target.hp = Math.max(0, target.hp - PLAYER_STRIKE_DAMAGE);
  target.lastHurtAt = now;
  target.hurtUntil = now + 240;
  target.mode = 'hurt';
  target.moving = false;
  target.facing = facingToward(target.position, player);
  target.aggro = true;
  if (definition.provokeOnly) target.provokedUntil = now + 14000;
  const dx = target.position.x - player.x, dy = target.position.y - player.y;
  const length = Math.hypot(dx, dy) || 1;
  const knockX = target.position.x + dx / length * 11, knockY = target.position.y + dy / length * 11;
  if (canWalk(knockX, knockY)) target.position = { x: knockX, y: knockY };
  if (target.hp <= 0) {
    target.mode = 'dead';
    target.moving = false;
    target.aggro = false;
    target.deadAt = now;
    target.respawnAt = now + definition.respawnMs + (target.phase % 4) * 2500;
    return { mob: target, damage: PLAYER_STRIKE_DAMAGE, killed: true };
  }
  return { mob: target, damage: PLAYER_STRIKE_DAMAGE, killed: false };
}

export function aliveMobs(mobs: readonly Mob[]): Mob[] {
  return mobs.filter(mob => mob.mode !== 'dead');
}

/** Authored anchors are useful to tests and the debug HUD. */
export function mobSpawnCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const spawn of MOB_SPAWNS) counts[spawn.terrace] = (counts[spawn.terrace] ?? 0) + 1;
  return counts;
}

export function mobSpawnBlocked(spawn: MobSpawn): boolean {
  return !spawnSafe(spawn.position.x, spawn.position.y);
}

export function buildingClearance(spawn: MobSpawn): number {
  return Math.min(...FROSTGATE_BUILDINGS.map(building => Math.hypot(
    spawn.position.x - (building.x + building.width / 2),
    spawn.position.y - (building.y + building.height / 2),
  )));
}
