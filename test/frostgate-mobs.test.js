import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOB_DEFINITIONS, MOB_SPAWNS, MOB_WALK_FRAMES, PLAYER_STRIKE_RANGE, PLAYER_STRIKE_DAMAGE,
  createMob, createMobs, stepMobs, strikeMob, nearestMob, mobAt, aliveMobs,
  mobSpawnCounts, mobSpawnBlocked, buildingClearance,
} from '../web/dist/world/frostgate-mobs.js';
import { TERRACES, elevationAt, SNOW_SPAWN, SNOW_WORLD } from '../web/dist/world/frostgate.js';

const walk = () => true;
const still = () => false;

test('mob slots cover every terrace and both kinds', () => {
  assert.equal(MOB_SPAWNS.length, 27);
  assert.deepEqual(mobSpawnCounts(), { gate: 4, village: 6, trail: 6, snowfield: 6, summit: 5 });
  for (const terrace of TERRACES) {
    const slots = MOB_SPAWNS.filter(spawn => spawn.terrace === terrace.id);
    assert.ok(slots.length >= 4, `${terrace.id} has a real population`);
    assert.ok(slots.some(spawn => spawn.kind === 'goat'), `${terrace.id} has goats`);
    assert.ok(slots.some(spawn => spawn.kind === 'barbarian'), `${terrace.id} has barbarians`);
    assert.ok(slots.every(spawn => elevationAt(spawn.position.y) === terrace.elevation));
  }
  const kinds = MOB_SPAWNS.reduce((counts, spawn) => {
    counts[spawn.kind] = (counts[spawn.kind] ?? 0) + 1; return counts;
  }, {});
  assert.deepEqual(kinds, { goat: 14, barbarian: 13 });
});

test('spawn anchors stay out of walls, buildings and the arrival gate', () => {
  assert.deepEqual(MOB_SPAWNS.filter(mobSpawnBlocked), []);
  assert.ok(MOB_SPAWNS.every(spawn => spawn.position.x > 160 && spawn.position.x < SNOW_WORLD.width - 160));
  assert.ok(MOB_SPAWNS.every(spawn => spawn.position.y > 120 && spawn.position.y < SNOW_WORLD.height - 160));
  assert.ok(MOB_SPAWNS.every(spawn => Math.hypot(spawn.position.x - SNOW_SPAWN.x, spawn.position.y - SNOW_SPAWN.y) > 300));
  assert.ok(Math.min(...MOB_SPAWNS.map(buildingClearance)) > 200, 'mobs never spawn inside the village walls');
  assert.ok(Math.min(...MOB_SPAWNS.map(spawn => spawn.position.y)) < 1500, 'the summit has residents');
  assert.ok(Math.max(...MOB_SPAWNS.map(spawn => spawn.position.y)) > 18000, 'the gate approach has residents');
});

test('goats are peaceful until the visitor strikes first', () => {
  assert.equal(MOB_DEFINITIONS.goat.provokeOnly, true);
  assert.ok(MOB_DEFINITIONS.goat.damage > 0, 'a provoked goat can still butt back');
  assert.ok(MOB_DEFINITIONS.goat.respawnMs >= 20000);
  assert.equal(MOB_WALK_FRAMES, 8);
  const spawn = { id: 'goat-test', kind: 'goat', position: { x: 100, y: 100 }, terrace: 'trail' };
  const mob = createMob(spawn, 0);
  let now = 0;
  for (let frame = 0; frame < 120; frame++) {
    now += 16;
    const result = stepMobs([mob], { x: 118, y: 100 }, .016, now, walk);
    assert.equal(result.damage, 0, 'an unprovoked goat never attacks');
  }
  assert.equal(mob.aggro, false);
  assert.equal(nearestMob([mob], { x: 118, y: 100 }), mob, 'the visitor can still choose to strike');
  const strike = strikeMob([mob], { x: mob.position.x + 10, y: mob.position.y }, now, walk);
  assert.equal(strike?.damage, PLAYER_STRIKE_DAMAGE);
  assert.equal(strike?.killed, false);
  assert.equal(mob.aggro, true, 'the goat fights back after being hit');
  assert.ok(mob.hp < mob.maxHp);
  now += 300;
  const hit = stepMobs([mob], { x: mob.position.x + 12, y: mob.position.y }, .016, now, walk);
  assert.equal(hit.damage, MOB_DEFINITIONS.goat.damage, 'the provoked goat lands a butt');
  assert.equal(hit.attacks[0].kind, 'goat');
});

test('barbarians chase a nearby visitor and attack on sight', () => {
  assert.equal(MOB_DEFINITIONS.barbarian.provokeOnly, false);
  assert.ok(MOB_DEFINITIONS.barbarian.aggroRadius > 200);
  assert.ok(MOB_DEFINITIONS.barbarian.damage > MOB_DEFINITIONS.goat.damage);
  const spawn = { id: 'barbarian-test', kind: 'barbarian', position: { x: 500, y: 500 }, terrace: 'snowfield' };
  const mob = createMob(spawn, 0);
  let now = 0;
  const player = { x: 700, y: 500 };
  for (let frame = 0; frame < 90; frame++) {
    now += 16;
    stepMobs([mob], player, .016, now, walk);
  }
  assert.equal(mob.aggro, true);
  assert.ok(mob.position.x > 500, 'the barbarian closes the distance');
  // Put the player in reach and let one attack resolve.
  const close = { x: mob.position.x + 20, y: mob.position.y };
  const attack = stepMobs([mob], close, .016, now, walk);
  assert.equal(attack.damage, MOB_DEFINITIONS.barbarian.damage);
  assert.equal(mob.mode, 'attack');
  const cooldown = stepMobs([mob], close, .016, now + 100, walk);
  assert.equal(cooldown.damage, 0, 'attacks respect their cooldown');
  const later = stepMobs([mob], close, .016, now + MOB_DEFINITIONS.barbarian.attackCooldownMs, walk);
  assert.equal(later.damage, MOB_DEFINITIONS.barbarian.damage);
});

test('a barbarian gives up a chase and walks home', () => {
  const spawn = { id: 'barbarian-leash', kind: 'barbarian', position: { x: 800, y: 800 }, terrace: 'trail' };
  const mob = createMob(spawn, 0);
  let now = 0;
  for (let frame = 0; frame < 200; frame++) { now += 16; stepMobs([mob], { x: 980, y: 800 }, .016, now, walk); }
  assert.equal(mob.aggro, true);
  for (let frame = 0; frame < 120; frame++) { now += 16; stepMobs([mob], { x: 3000, y: 800 }, .016, now, walk); }
  assert.equal(mob.aggro, false);
  for (let frame = 0; frame < 500; frame++) { now += 16; stepMobs([mob], { x: 3000, y: 800 }, .016, now, walk); }
  assert.ok(Math.hypot(mob.position.x - spawn.position.x, mob.position.y - spawn.position.y) < 50,
    'the barbarian returns to its own stretch of the pass');
});

test('strikes hit only in range and dead mobs respawn at their anchor', () => {
  const spawn = { id: 'goat-respawn', kind: 'goat', position: { x: 300, y: 300 }, terrace: 'gate' };
  const mob = createMob(spawn, 0);
  assert.equal(nearestMob([mob], { x: 300 + PLAYER_STRIKE_RANGE + 20, y: 300 }), null, 'out-of-range strikes miss');
  assert.equal(strikeMob([mob], { x: 900, y: 900 }, 0, walk), null);
  assert.equal(mobAt([mob], { x: 308, y: 300 })?.id, mob.id, 'clicking the body targets the mob');
  let now = 0;
  let killed = false;
  for (let hit = 0; hit < 4 && !killed; hit++) {
    const strike = strikeMob([mob], { x: 300, y: 300 }, now, walk);
    killed = strike?.killed ?? false;
    now += 500;
  }
  assert.equal(killed, true);
  assert.equal(mob.mode, 'dead');
  assert.equal(aliveMobs([mob]).length, 0);
  assert.equal(nearestMob([mob], { x: 300, y: 300 }), null, 'dead mobs cannot be struck');
  stepMobs([mob], { x: 300, y: 300 }, .016, mob.respawnAt - 100, walk);
  assert.equal(mob.mode, 'dead', 'respawn waits for its timer');
  const result = stepMobs([mob], { x: 300, y: 300 }, .016, mob.respawnAt + 1, walk);
  assert.deepEqual(result.respawned, [mob.id]);
  assert.equal(mob.mode, 'wander');
  assert.equal(mob.hp, mob.maxHp);
  assert.deepEqual(mob.position, spawn.position);
  assert.equal(aliveMobs([mob]).length, 1);
});

test('a mob cannot be knocked through a solid wall', () => {
  const spawn = { id: 'goat-wall', kind: 'goat', position: { x: 300, y: 300 }, terrace: 'gate' };
  const mob = createMob(spawn, 0);
  const strike = strikeMob([mob], { x: 280, y: 300 }, 0, still);
  assert.ok(strike);
  assert.deepEqual(mob.position, spawn.position, 'blocked knockback leaves the mob in place');
});

test('the initial population is alive and spread across the mountain', () => {
  const mobs = createMobs(0);
  assert.equal(mobs.length, MOB_SPAWNS.length);
  assert.equal(aliveMobs(mobs).length, mobs.length);
  assert.equal(new Set(mobs.map(mob => mob.id)).size, mobs.length);
  assert.ok(mobs.every(mob => mob.hp === mob.maxHp));
  assert.ok(new Set(mobs.map(mob => mob.kind)).size === 2);
});
