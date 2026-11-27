import { randomUUID } from 'node:crypto';
import {
  CAVE_INTERACT_RADIUS, CAVE_MAX_HP, CAVE_PLAYER_RADIUS, CAVE_PLAYER_SPEED, CAVE_RESET_MS,
  CAVE_START_WEAPON, CAVE_WEAPONS, caveLevel, isCaveWalkable,
} from './cave-layout.js';

const fail = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const RUN_ID = /^cave-[a-f0-9-]{36}$/;
const REQUEST_ID = /^[a-zA-Z0-9_-]{8,96}$/;
const REAL_ID = /^[a-zA-Z0-9_-]{1,96}$/;
const point = value => value && typeof value === 'object' && Number.isFinite(value.x) && Number.isFinite(value.y);

/**
 * Per-visitor, per-run cave state. Monsters, health and positions are owned
 * here and never persisted to Postgres; only the durable callbacks (credit
 * loss and rewards) touch long-lived state. The browser sends intents and
 * renders the returned view, so it cannot forge health or reward a dead mob.
 */
export class CaveService {
  constructor({ now = () => Date.now(), resetMs = CAVE_RESET_MS, onDefeat = null, onReward = null, onPotion = null } = {}) {
    if (!Number.isInteger(resetMs) || resetMs < 60_000) throw new Error('Invalid cave reset interval');
    this.now = now; this.resetMs = resetMs; this.onDefeat = onDefeat; this.onReward = onReward; this.onPotion = onPotion;
    this.runs = new Map();
  }

  prune() {
    const now = this.now();
    for (const [visitorId, run] of this.runs) {
      if (now - run.lastActiveAt > this.resetMs) this.runs.delete(visitorId);
    }
  }

  checkVisitor(visitorId) {
    if (typeof visitorId !== 'string' || !REAL_ID.test(visitorId)) throw fail('INVALID_VISITOR', 'Invalid cave visitor', 400);
  }

  require(visitorId, runId) {
    this.checkVisitor(visitorId);
    const run = this.runs.get(visitorId);
    if (!run || run.id !== runId) throw fail('CAVE_RUN_NOT_FOUND', 'That cave run is no longer available', 404);
    if (run.status !== 'playing') throw fail('CAVE_RUN_ENDED', 'The cave run has ended', 409);
    return run;
  }

  spawn(level) {
    return caveLevel(level).monsters.map(monster => ({
      ...monster, home: { x: monster.x, y: monster.y }, hp: monster.hp, maxHp: monster.hp, alive: true,
      state: 'idle', lastAttack: 0, hitUntil: 0,
    }));
  }

  spawnChests(level) {
    return caveLevel(level).chests.map(chest => ({ id: chest.id, x: chest.x, y: chest.y, weapon: chest.weapon, opened: false }));
  }

  weapon(run) {
    if (run.equippedWeapon) return { ...run.equippedWeapon };
    return CAVE_WEAPONS[run.weaponId] ?? CAVE_WEAPONS[CAVE_START_WEAPON];
  }

  view(run) {
    const config = caveLevel(run.level), weapon = this.weapon(run), now = this.now();
    const cleared = run.kills >= config.required;
    return {
      run_id: run.id, level: run.level, level_name: config.name,
      // Generated depths are described by the server, so the browser never
      // needs a second copy of the scaling rules or the geometry.
      level_layout: {
        level: config.level, name: config.name, ambient: config.ambient,
        bounds: config.bounds, entry: config.entry, exit: config.exit, descent: config.descent,
        rooms: config.rooms, torches: config.torches, props: config.props,
      },
      status: run.status, player: { ...run.player, hit: Boolean(run.lastHitAt && now - run.lastHitAt < 220) },
      monsters: run.monsters.map(monster => ({
        id: monster.id, kind: monster.kind, boss: Boolean(monster.boss),
        x: Math.round(monster.x), y: Math.round(monster.y), hp: monster.hp,
        max_hp: monster.maxHp ?? config.monsters.find(m => m.id === monster.id)?.hp ?? monster.hp,
        alive: monster.alive, state: monster.state, hit: monster.hitUntil > now, hit_until: monster.hitUntil,
      })),
      chests: run.chests.map(chest => ({ id: chest.id, x: chest.x, y: chest.y, opened: chest.opened })),
      kills: run.kills, required: config.required, cleared,
      can_descend: cleared && Boolean(config.descent),
      weapon: { id: weapon.id, name: weapon.name, damage: weapon.damage, range: weapon.range },
      armor: run.loadout?.armor ? { id: run.loadout.armor.id, name: run.loadout.armor.name, mitigation: run.loadout.armor.mitigation } : null,
      potion: { available: run.loadout?.potion?.available || 0, heal: run.loadout?.potion?.heal || 0 },
      reset_at: new Date(run.lastActiveAt + this.resetMs).toISOString(),
    };
  }

  async settleDeath(run) {
    if (run.status === 'dead') return;
    run.status = 'dead';
    run.lastActiveAt = this.now();
    if (run.defeatSettled) return;
    run.defeatSettled = true;
    await this.onDefeat?.({
      visitorId: run.visitorId, runId: run.id, exterior: { ...run.exterior },
      credential: run.credential,
    });
  }

  /** Advances passive monster AI without a background timer. */
  async advance(run) {
    const now = this.now(), dt = Math.min(0.4, Math.max(0, (now - run.lastTick) / 1000));
    run.lastTick = now; run.lastActiveAt = now;
    const config = caveLevel(run.level);
    for (const monster of run.monsters) {
      if (!monster.alive) continue;
      const dx = run.player.x - monster.x, dy = run.player.y - monster.y;
      const distance = Math.hypot(dx, dy);
      if (distance > monster.aggro * 2.2) {
        monster.x = monster.home.x; monster.y = monster.home.y; monster.state = 'idle';
        continue;
      }
      if (distance > monster.aggro) { monster.state = 'idle'; continue; }
      monster.state = distance <= monster.range ? 'attack' : 'chase';
      if (distance <= monster.range) {
        if (now - monster.lastAttack >= monster.cooldownMs) {
          monster.lastAttack = now;
          const mitigation = Math.min(0.6, Math.max(0, run.loadout?.armor?.mitigation || 0));
          const damage = Math.max(1, Math.round(monster.damage * (1 - mitigation)));
          run.player.hp = Math.max(0, run.player.hp - damage);
          run.lastHitAt = now;
          run.lastHitBy = monster.id;
        }
        continue;
      }
      const step = Math.min(monster.speed * dt, distance - monster.range * 0.8);
      const nx = monster.x + (dx / distance) * step, ny = monster.y + (dy / distance) * step;
      if (isCaveWalkable(run.level, { x: nx, y: monster.y })) monster.x = nx;
      if (isCaveWalkable(run.level, { x: monster.x, y: ny })) monster.y = ny;
    }
    if (run.player.hp <= 0) await this.settleDeath(run);
  }

  /** Only bounded, known numbers from a server-issued loadout are accepted. */
  sanitizeLoadout(value) {
    if (!value || typeof value !== 'object') return null;
    const limit = (number, min, max) => Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
    const weapon = value.weapon && typeof value.weapon === 'object' ? {
      id: String(value.weapon.id || 'rusted').slice(0, 48),
      name: String(value.weapon.name || 'Blade').slice(0, 48),
      damage: Math.round(limit(Number(value.weapon.damage), 1, 40)),
      range: Math.round(limit(Number(value.weapon.range), 40, 110)),
    } : null;
    const armor = value.armor && typeof value.armor === 'object' ? {
      id: String(value.armor.id || 'armor').slice(0, 48),
      name: String(value.armor.name || 'Armor').slice(0, 48),
      mitigation: limit(Number(value.armor.mitigation), 0, 0.6),
      bonus_hp: Math.round(limit(Number(value.armor.bonus_hp), 0, 20)),
    } : null;
    const potion = {
      available: Math.round(limit(Number(value.potion?.available), 0, 9)),
      heal: Math.round(limit(Number(value.potion?.heal), 0, 80)),
    };
    return { weapon, armor, potion };
  }

  async start(visitorId, input = {}) {
    this.prune(); this.checkVisitor(visitorId);
    if (!point(input.exterior)) throw fail('INVALID_EXTERIOR', 'A saved exterior position is required', 400);
    if (!input.credential || typeof input.credential.economyOwner !== 'string'
      || !input.credential.farmIdentity || typeof input.credential.farmIdentity.key !== 'string') {
      throw fail('INVALID_CREDENTIAL', 'Cave runs require a server-issued credit identity', 400);
    }
    const loadout = this.sanitizeLoadout(input.loadout);
    const bonusHp = Math.round(loadout?.armor?.bonus_hp || 0);
    const maxHp = CAVE_MAX_HP + bonusHp;
    const existing = this.runs.get(visitorId);
    if (existing && existing.status === 'exited' && this.now() - existing.lastActiveAt <= this.resetMs) {
      existing.status = 'playing'; existing.exterior = { x: input.exterior.x, y: input.exterior.y };
      existing.lastActiveAt = existing.lastTick = this.now();
      if (loadout) {
        existing.loadout = loadout;
        existing.equippedWeapon = loadout.weapon ? { ...loadout.weapon } : null;
      }
      if (existing.player.hp <= 0) existing.player.hp = maxHp;
      await this.advance(existing);
      return { run: this.view(existing), resumed: true };
    }
    if (existing && existing.status === 'playing') throw fail('CAVE_ALREADY_ACTIVE', 'Leave the current cave run first', 409);
    const level = caveLevel(1), now = this.now();
    const run = {
      id: `cave-${randomUUID()}`, visitorId, status: 'playing', level: 1,
      exterior: { x: input.exterior.x, y: input.exterior.y },
      credential: {
        farmIdentity: { ...input.credential.farmIdentity },
        economyOwner: input.credential.economyOwner,
      },
      player: { x: level.entry.x, y: level.entry.y, facing: 'down', hp: maxHp, max_hp: maxHp },
      monsters: this.spawn(1), chests: this.spawnChests(1), weaponId: CAVE_START_WEAPON,
      loadout, equippedWeapon: loadout?.weapon ? { ...loadout.weapon } : null,
      kills: 0, killed: new Set(),
      startedAt: now, lastActiveAt: now, lastTick: now, lastHitAt: 0, lastHitBy: null,
      defeatSettled: false, rewarded: new Set(), attacks: new Map(), potions: new Map(),
    };
    this.runs.set(visitorId, run);
    return { run: this.view(run), resumed: false };
  }

  async snapshot(visitorId) {
    this.prune(); this.checkVisitor(visitorId);
    const run = this.runs.get(visitorId);
    if (!run) return { run: null };
    if (run.status === 'playing') await this.advance(run);
    return { run: this.view(run) };
  }

  async move(visitorId, input = {}) {
    this.prune();
    const run = this.require(visitorId, input.run_id);
    if (!point(input) || !Number.isFinite(input.x) || !Number.isFinite(input.y)) throw fail('INVALID_MOVE', 'A cave move needs finite coordinates', 400);
    const now = this.now(), elapsed = Math.max(0, now - run.lastTick) / 1000;
    const step = Math.hypot(input.x - run.player.x, input.y - run.player.y);
    if (step > CAVE_PLAYER_SPEED * elapsed + 28) throw fail('CAVE_MOVE_TOO_FAR', 'That cave move is not possible', 409);
    if (!isCaveWalkable(run.level, input, CAVE_PLAYER_RADIUS)) throw fail('CAVE_WALL', 'Cave walls block that move', 409);
    run.player.x = input.x; run.player.y = input.y;
    if (['up', 'down', 'left', 'right'].includes(input.facing)) run.player.facing = input.facing;
    await this.advance(run);
    return this.view(run);
  }

  async attack(visitorId, input = {}) {
    this.prune();
    const run = this.require(visitorId, input.run_id);
    if (typeof input.request_id !== 'string' || !REQUEST_ID.test(input.request_id)) throw fail('INVALID_REQUEST_ID', 'Attack request ID must be 8-96 safe characters', 400);
    const cached = run.attacks.get(input.request_id);
    if (cached) return { ...cached, duplicate: true };
    await this.advance(run);
    if (run.status !== 'playing') return { ...this.view(run), hit: false, player_defeated: true };
    const weapon = this.weapon(run);
    const target = run.monsters
      .filter(monster => monster.alive && Math.hypot(monster.x - run.player.x, monster.y - run.player.y) <= weapon.range)
      .sort((a, b) => Math.hypot(a.x - run.player.x, a.y - run.player.y) - Math.hypot(b.x - run.player.x, b.y - run.player.y))[0];
    if (!target) throw fail('CAVE_NO_TARGET', 'No monster is within reach', 409);
    target.hp = Math.max(0, target.hp - weapon.damage);
    target.hitUntil = this.now() + 180;
    let reward = null;
    if (target.hp === 0) {
      target.alive = false; target.state = 'dead';
      if (!run.killed.has(target.id)) {
        run.killed.add(target.id);
        run.kills = run.killed.size;
      }
      if (!run.rewarded.has(target.id)) {
        run.rewarded.add(target.id);
        reward = { monster_id: target.id, amount: target.reward, reward_key: `${run.id}:${target.id}` };
        await this.onReward?.({ visitorId, runId: run.id, credential: run.credential, ...reward });
      }
    }
    const result = { ...this.view(run), hit: true, target_id: target.id, defeated: target.hp === 0, reward };
    run.attacks.set(input.request_id, result);
    if (run.attacks.size > 64) run.attacks.delete(run.attacks.keys().next().value);
    return result;
  }

  async descend(visitorId, input = {}) {
    this.prune();
    const run = this.require(visitorId, input.run_id);
    const config = caveLevel(run.level);
    if (!config.descent) throw fail('CAVE_DEEPEST', 'This is the deepest known chamber', 409);
    if (run.kills < config.required) throw fail('CAVE_FLOOR_SEALED', `Defeat ${config.required - run.kills} more monster${config.required - run.kills === 1 ? '' : 's'} to open the passage`, 409);
    if (Math.hypot(run.player.x - config.descent.x, run.player.y - config.descent.y) > CAVE_INTERACT_RADIUS) throw fail('CAVE_NOT_AT_DESCENT', 'Find the descending passage first', 409);
    const next = caveLevel(run.level + 1), now = this.now();
    run.level = next.level;
    run.player.x = next.entry.x; run.player.y = next.entry.y;
    run.monsters = this.spawn(next.level);
    run.chests = this.spawnChests(next.level);
    run.kills = 0; run.killed = new Set(); run.attacks.clear();
    run.lastTick = now; run.lastActiveAt = now;
    return this.view(run);
  }

  async chest(visitorId, input = {}) {
    this.prune();
    const run = this.require(visitorId, input.run_id);
    if (typeof input.chest_id !== 'string' || !REAL_ID.test(input.chest_id)) throw fail('CAVE_INVALID_CHEST', 'A chest ID is required', 400);
    await this.advance(run);
    if (run.status !== 'playing') return { ...this.view(run), opened: false, player_defeated: true };
    const chest = run.chests.find(value => value.id === input.chest_id);
    if (!chest) throw fail('CAVE_CHEST_NOT_FOUND', 'That chest is not on this floor', 404);
    if (Math.hypot(run.player.x - chest.x, run.player.y - chest.y) > CAVE_INTERACT_RADIUS) throw fail('CAVE_NOT_AT_CHEST', 'Move closer to the chest', 409);
    if (chest.opened) return { ...this.view(run), opened: true, chest_id: chest.id, duplicate: true };
    chest.opened = true;
    const found = CAVE_WEAPONS[chest.weapon];
    const current = this.weapon(run);
    let foundWeapon = null;
    if (found && found.damage > current.damage) {
      if (run.equippedWeapon) run.equippedWeapon = { id: found.id, name: found.name, damage: found.damage, range: found.range };
      else run.weaponId = found.id;
      foundWeapon = { ...found };
    }
    return { ...this.view(run), opened: true, chest_id: chest.id, found_weapon: foundWeapon };
  }

  /** Consumables settle through the farm ledger before the cave heals the player. */
  async potion(visitorId, input = {}) {
    this.prune();
    const run = this.require(visitorId, input.run_id);
    if (typeof input.request_id !== 'string' || !REQUEST_ID.test(input.request_id)) throw fail('INVALID_REQUEST_ID', 'Potion request ID must be 8-96 safe characters', 400);
    const cached = run.potions.get(input.request_id);
    if (cached) return { ...cached, duplicate: true };
    await this.advance(run);
    if (run.status !== 'playing') return { ...this.view(run), healed: 0, player_defeated: true };
    if (!run.loadout?.potion?.available) throw fail('CAVE_NO_POTION', 'You have no health potions', 409);
    if (!this.onPotion) throw fail('CAVE_NO_POTION', 'Potions are unavailable on this server', 503);
    const settled = await this.onPotion({ visitorId, runId: run.id, credential: run.credential, requestId: input.request_id });
    const heal = Math.max(0, Math.round(settled?.heal || run.loadout.potion.heal));
    run.loadout.potion.available -= 1;
    const before = run.player.hp;
    run.player.hp = Math.min(run.player.max_hp || CAVE_MAX_HP, before + heal);
    const result = { ...this.view(run), healed: run.player.hp - before, potion_heal: heal };
    run.potions.set(input.request_id, result);
    if (run.potions.size > 32) run.potions.delete(run.potions.keys().next().value);
    return result;
  }

  async exit(visitorId, input = {}) {
    this.prune();
    const run = this.require(visitorId, input.run_id);
    run.status = 'exited'; run.lastActiveAt = this.now();
    return { view: this.view(run), exterior: { ...run.exterior } };
  }
}
