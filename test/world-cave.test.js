import test from 'node:test';
import assert from 'node:assert/strict';
import { CaveService } from '../service/world-cave.js';
import { CAVE_LEVELS, CAVE_RESET_MS, CAVE_MAX_HP, CAVE_WEAPONS, caveLevel, isCaveWalkable, publicCaveLayout } from '../service/cave-layout.js';

const exterior = { x: -700, y: -736 };
const credential = { farmIdentity: { key: 'guest:visitor-a', provider: 'guest' }, economyOwner: 'visitor-a' };
function serviceAt(overrides = {}) {
  let now = 1_000;
  const calls = { defeats: [], rewards: [] };
  const service = new CaveService({
    now: () => now,
    onDefeat: async event => { calls.defeats.push(event); },
    onReward: async event => { calls.rewards.push(event); },
    ...overrides,
  });
  return { service, calls, tick: ms => { now += ms; }, now: () => now };
}
async function start(service, visitor = 'visitor-a') {
  return service.start(visitor, { exterior, credential });
}
function near(service, visitor, monsterId) {
  const run = service.runs.get(visitor);
  const monster = run.monsters.find(value => value.id === monsterId);
  run.player.x = monster.x + 30; run.player.y = monster.y;
  return monster;
}

test('cave layout is a bounded three-level dungeon with deterministic public content', () => {
  assert.equal(CAVE_LEVELS.length, 3);
  assert.deepEqual(CAVE_LEVELS.map(level => level.level), [1, 2, 3]);
  assert.equal(CAVE_RESET_MS, 7 * 60 * 1000);
  assert.deepEqual(CAVE_LEVELS.map(level => level.required), [4, 6, 6]);
  assert.deepEqual(CAVE_LEVELS.map(level => level.monsters.length), [4, 6, 6]);
  assert.deepEqual(CAVE_LEVELS.map(level => level.rooms.length), [5, 6, 7], 'each deeper floor adds one chamber');
  assert.equal(CAVE_LEVELS.every(level => level.monsters.length >= 4), true);
  assert.equal(CAVE_LEVELS[0].chests.length, 0, 'the entrance holds no weapon chest');
  assert.equal(CAVE_LEVELS[1].chests[0].weapon, 'iron');
  assert.equal(CAVE_LEVELS[2].chests[0].weapon, 'caveforged');
  assert.ok(CAVE_LEVELS[2].ambient < CAVE_LEVELS[0].ambient, 'deeper levels are darker');
  const grizzly = CAVE_LEVELS[2].monsters.find(monster => monster.id === 'grizzly');
  assert.equal(grizzly.kind, 'grizzly');
  assert.equal(grizzly.hp, CAVE_WEAPONS.rusted.damage * 10, 'the starter blade needs ten successful Grizzly hits');
  assert.ok(Math.ceil(grizzly.hp / CAVE_WEAPONS.iron.damage) < 10);
  assert.ok(Math.ceil(grizzly.hp / CAVE_WEAPONS.caveforged.damage) < Math.ceil(grizzly.hp / CAVE_WEAPONS.iron.damage));
  assert.equal(isCaveWalkable(1, { x: 140, y: 340 }), true);
  assert.equal(isCaveWalkable(1, { x: 500, y: 500 }), false, 'rock blocks movement');
  const config = publicCaveLayout();
  assert.equal(config.levels.length, 3);
  assert.equal(JSON.stringify(config).includes('"alive"'), false, 'the public layout carries no encounter state');
});

test('a run starts per visitor, owns its position and health, and exits to the saved exterior', async () => {
  const { service } = serviceAt();
  const { run } = await start(service);
  assert.equal(run.level, 1);
  assert.equal(run.player.hp, CAVE_MAX_HP);
  assert.equal(run.monsters.every(monster => monster.alive), true);
  assert.equal(run.status, 'playing');
  const exit = await service.exit('visitor-a', { run_id: run.run_id });
  assert.deepEqual(exit.exterior, exterior);
  assert.equal(exit.view.status, 'exited');
  await assert.rejects(() => service.move('visitor-a', { run_id: run.run_id, x: 140, y: 340 }), { code: 'CAVE_RUN_ENDED' });
});

test('visitors cannot share cave combat state and movement is range and wall checked', async () => {
  const { service } = serviceAt();
  const { run } = await start(service);
  await start(service, 'visitor-b');
  await assert.rejects(() => service.move('visitor-b', { run_id: run.run_id, x: 140, y: 340 }), { code: 'CAVE_RUN_NOT_FOUND' });
  near(service, 'visitor-a', 'crawler-1');
  await service.attack('visitor-a', { run_id: run.run_id, request_id: 'visitor-a-strike-01' });
  assert.equal(service.runs.get('visitor-b').monsters.find(monster => monster.id === 'crawler-1').hp, 36, 'another visitor keeps an isolated monster roster');
  await assert.rejects(() => service.move('visitor-a', { run_id: run.run_id, x: 900, y: 600 }), { code: 'CAVE_MOVE_TOO_FAR' });
  service.runs.get('visitor-a').player.x = 480; service.runs.get('visitor-a').player.y = 340;
  await assert.rejects(() => service.move('visitor-a', { run_id: run.run_id, x: 500, y: 340 }), { code: 'CAVE_WALL' });
  service.runs.get('visitor-a').player.x = 140;
  const moved = await service.move('visitor-a', { run_id: run.run_id, x: 160, y: 340, facing: 'right' });
  assert.equal(moved.player.x, 160);
  assert.equal(moved.player.facing, 'right');
  assert.equal(JSON.stringify(moved).includes('credential'), false);
});

test('descent requires a cleared floor and advances through all three levels', async () => {
  const { service } = serviceAt();
  const { run } = await start(service);
  const state = service.runs.get('visitor-a');
  await assert.rejects(() => service.descend('visitor-a', { run_id: run.run_id }), { code: 'CAVE_FLOOR_SEALED' });
  const first = caveLevel(1);
  state.player.x = first.descent.x;
  state.player.y = first.descent.y;
  await assert.rejects(() => service.descend('visitor-a', { run_id: run.run_id }), { code: 'CAVE_FLOOR_SEALED' });
  state.kills = first.required;
  const second = await service.descend('visitor-a', { run_id: run.run_id });
  assert.equal(second.level, 2);
  assert.equal(second.monsters.length, caveLevel(2).monsters.length);
  assert.equal(second.kills, 0, 'a new floor starts with a fresh kill count');
  assert.equal(second.cleared, false);
  const entry = caveLevel(2).entry;
  assert.deepEqual({ x: second.player.x, y: second.player.y }, entry);
});

test('floor chests grant cave-only blades once and the deepest chest is the best', async () => {
  const { service } = serviceAt();
  const { run } = await start(service);
  const state = service.runs.get('visitor-a');
  const first = caveLevel(1);
  assert.equal(run.weapon.id, 'rusted');
  assert.equal(run.chests.length, 0);
  state.kills = first.required;
  state.player.x = first.descent.x; state.player.y = first.descent.y;
  const second = await service.descend('visitor-a', { run_id: run.run_id });
  assert.equal(second.chests.length, 1);
  await assert.rejects(() => service.chest('visitor-a', { run_id: run.run_id, chest_id: 'chest-iron' }), { code: 'CAVE_NOT_AT_CHEST' });
  const ironChest = state.chests.find(chest => chest.id === 'chest-iron');
  state.player.x = ironChest.x + 20; state.player.y = ironChest.y;
  const opened = await service.chest('visitor-a', { run_id: run.run_id, chest_id: 'chest-iron' });
  assert.equal(opened.opened, true);
  assert.equal(opened.weapon.id, 'iron');
  assert.equal(opened.found_weapon.id, 'iron');
  const again = await service.chest('visitor-a', { run_id: run.run_id, chest_id: 'chest-iron' });
  assert.equal(again.duplicate, true, 'a chest never opens twice');
  assert.equal(again.weapon.id, 'iron');

  const config = caveLevel(2);
  state.kills = config.required;
  state.player.x = config.descent.x; state.player.y = config.descent.y;
  const third = await service.descend('visitor-a', { run_id: run.run_id });
  assert.equal(third.level, 3);
  assert.equal(third.can_descend, false, 'the deepest floor has no passage');
  const deepChest = state.chests.find(chest => chest.id === 'chest-caveforged');
  state.player.x = deepChest.x - 20; state.player.y = deepChest.y;
  const deepest = await service.chest('visitor-a', { run_id: run.run_id, chest_id: 'chest-caveforged' });
  assert.equal(deepest.weapon.id, 'caveforged');
  assert.ok(deepest.weapon.damage > second.weapon.damage);
});

test('attacks are server-owned: range, malformed IDs, duplicates and dead-mob rewards', async () => {
  const { service, calls } = serviceAt();
  const { run } = await start(service);
  await assert.rejects(() => service.attack('visitor-a', { run_id: run.run_id, request_id: 'bad' }), { code: 'INVALID_REQUEST_ID' });
  await assert.rejects(() => service.attack('visitor-a', { run_id: run.run_id, request_id: 'no-target-1234' }), { code: 'CAVE_NO_TARGET' });
  near(service, 'visitor-a', 'crawler-1');
  const first = await service.attack('visitor-a', { run_id: run.run_id, request_id: 'strike-00000001' });
  assert.equal(first.hit, true);
  assert.equal(first.monsters.find(monster => monster.id === 'crawler-1').hit, true, 'a successful hit starts the authoritative flash window');
  assert.equal(first.monsters.find(monster => monster.id === 'crawler-1').hp, 24, 'the starter blade removes 12 of 36 HP');
  assert.equal(first.monsters.find(monster => monster.id === 'crawler-1').max_hp, 36);
  const duplicate = await service.attack('visitor-a', { run_id: run.run_id, request_id: 'strike-00000001' });
  assert.equal(duplicate.duplicate, true);
  assert.equal(calls.rewards.length, 0, 'a duplicate attack must not duplicate damage or rewards');
  await service.attack('visitor-a', { run_id: run.run_id, request_id: 'strike-00000002' });
  assert.equal(calls.rewards.length, 0, 'a normal monster survives two starter hits');
  const third = await service.attack('visitor-a', { run_id: run.run_id, request_id: 'strike-00000003' });
  assert.equal(third.monsters.find(monster => monster.id === 'crawler-1').alive, false, 'three starter hits kill a normal monster');
  assert.equal(calls.rewards.length, 1, 'the defeated monster grants one bounded reward');
  assert.equal(service.runs.get('visitor-a').kills, 1, 'a dead monster increments the kill count once');
  assert.equal(calls.rewards[0].amount, 2);
  await assert.rejects(() => service.attack('visitor-a', { run_id: run.run_id, request_id: 'strike-00000004' }), { code: 'CAVE_NO_TARGET' });
});

test('client-supplied health, kills, weapon and monster state are ignored', async () => {
  const { service } = serviceAt();
  const { run } = await start(service);
  const forged = await service.move('visitor-a', { run_id: run.run_id, x: 160, y: 340, hp: 999, kills: 4, weapon: { id: 'caveforged' }, monsters: [{ id: 'crawler-1', hp: 0, alive: false }] });
  assert.equal(forged.player.hp, CAVE_MAX_HP, 'the visitor cannot forge its health');
  assert.equal(forged.monsters.every(monster => monster.alive), true, 'the visitor cannot kill monsters from the client');
  assert.equal(forged.kills, 0);
  assert.equal(forged.weapon.id, 'rusted');
});

test('all three floors spawn active monsters and the hit flash expires', async () => {
  const { service, tick } = serviceAt();
  const { run } = await start(service);
  const state = service.runs.get('visitor-a');
  for (const config of CAVE_LEVELS) {
    state.level = config.level;
    state.monsters = service.spawn(config.level);
    state.chests = service.spawnChests(config.level);
    state.kills = 0; state.killed = new Set(); state.attacks.clear();
    const monster = state.monsters[0];
    state.player.x = monster.x + Math.min(100, monster.aggro - 10); state.player.y = monster.y;
    tick(500);
    const active = (await service.snapshot('visitor-a')).run;
    assert.ok(['chase', 'attack'].includes(active.monsters[0].state), `floor ${config.level} monster becomes active`);
  }
  state.level = 1; state.monsters = service.spawn(1); state.chests = []; state.kills = 0; state.killed = new Set(); state.attacks.clear();
  near(service, 'visitor-a', 'crawler-1');
  const hit = await service.attack('visitor-a', { run_id: run.run_id, request_id: 'flash-window-0001' });
  assert.equal(hit.monsters.find(monster => monster.id === 'crawler-1').hit, true);
  tick(181);
  assert.equal((await service.snapshot('visitor-a')).run.monsters.find(monster => monster.id === 'crawler-1').hit, false);
});

test('Grizzly durability is ten starter hits and one death', async () => {
  const { service, calls } = serviceAt();
  const { run } = await start(service);
  const state = service.runs.get('visitor-a');
  state.level = 3; state.monsters = service.spawn(3); state.chests = service.spawnChests(3);
  state.kills = 0; state.killed = new Set(); state.attacks.clear(); state.weaponId = 'rusted';
  near(service, 'visitor-a', 'grizzly');
  for (let hit = 1; hit <= 10; hit++) {
    const result = await service.attack('visitor-a', { run_id: run.run_id, request_id: `grizzly-hit-${String(hit).padStart(2, '0')}` });
    assert.equal(result.monsters.find(monster => monster.id === 'grizzly').alive, hit < 10);
  }
  assert.equal(state.kills, 1);
  assert.equal(calls.rewards.filter(event => event.monster_id === 'grizzly').length, 1);
});

test('one authoritative run can clear all three floors through combat and cave-only chests', async () => {
  const { service } = serviceAt();
  const { run } = await start(service);
  const state = service.runs.get('visitor-a');
  let sequence = 0;
  const clearFloor = async () => {
    for (const target of [...state.monsters]) {
      near(service, 'visitor-a', target.id);
      while (target.alive) await service.attack('visitor-a', {
        run_id: run.run_id, request_id: `playthrough-${String(++sequence).padStart(4, '0')}`,
      });
    }
    assert.equal(state.kills, caveLevel(state.level).required);
  };
  const descend = async () => {
    const current = caveLevel(state.level);
    state.player.x = current.descent.x; state.player.y = current.descent.y;
    return service.descend('visitor-a', { run_id: run.run_id });
  };
  const openFloorChest = async () => {
    const chest = state.chests[0];
    state.player.x = chest.x; state.player.y = chest.y;
    return service.chest('visitor-a', { run_id: run.run_id, chest_id: chest.id });
  };

  await clearFloor();
  assert.equal((await descend()).level, 2);
  assert.equal((await openFloorChest()).weapon.id, 'iron');
  await clearFloor();
  assert.equal((await descend()).level, 3);
  assert.equal((await openFloorChest()).weapon.id, 'caveforged');
  await clearFloor();
  assert.equal(state.status, 'playing');
  assert.equal(service.view(state).cleared, true);
  assert.equal(service.view(state).can_descend, false);
});

test('monsters chase, attack using server-owned damage and reset when the visitor escapes', async () => {
  const { service, tick } = serviceAt();
  await start(service);
  const state = service.runs.get('visitor-a');
  const monster = state.monsters[0];
  state.player.x = monster.x + 30; state.player.y = monster.y;
  tick(1_300);
  const after = (await service.snapshot('visitor-a')).run;
  assert.ok(after.player.hp < CAVE_MAX_HP, 'the server applies monster damage');
  assert.equal(after.monsters[0].state, 'attack');
  state.player.x = 820; state.player.y = 200;
  tick(300);
  const escaped = (await service.snapshot('visitor-a')).run;
  assert.equal(escaped.monsters[0].x, caveLevel(1).monsters[0].x, 'the monster returns to its anchor');
});

test('death settles once, ends the run and does not happen on a normal exit', async () => {
  const { service, calls, tick } = serviceAt();
  const { run } = await start(service);
  await service.exit('visitor-a', { run_id: run.run_id });
  assert.equal(calls.defeats.length, 0, 'a voluntary exit never forfeits credits');
  const second = await start(service);
  const state = service.runs.get('visitor-a');
  state.player.hp = 3;
  near(service, 'visitor-a', 'crawler-1');
  tick(1_300);
  await service.attack('visitor-a', { run_id: second.run.run_id, request_id: 'strike-death-001' });
  assert.equal(state.status, 'dead');
  assert.equal(calls.defeats.length, 1);
  const view = (await service.snapshot('visitor-a')).run;
  assert.equal(view.status, 'dead');
  assert.equal(calls.defeats.length, 1, 'repeated snapshots never settle twice');
});

test('runs resume before the reset window and respawn base monsters after it', async () => {
  const { service, tick } = serviceAt();
  const { run } = await start(service);
  const state = service.runs.get('visitor-a');
  state.monsters[0].alive = false;
  await service.exit('visitor-a', { run_id: run.run_id });
  tick(60_000);
  const resumed = await start(service);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.run.monsters[0].alive, false, 'defeated monsters stay dead for the active run');
  await service.exit('visitor-a', { run_id: resumed.run.run_id });
  tick(CAVE_RESET_MS + 1);
  const fresh = await start(service);
  assert.equal(fresh.resumed, false);
  assert.equal(fresh.run.monsters.every(monster => monster.alive), true, 'base mobs respawn after the reset interval');
});

/** Grid walk from a floor entry using the same collision rule as the server. */
function reachableCells(level, start) {
  const step = 2, seen = new Set([`${start.x},${start.y}`]), queue = [start];
  while (queue.length) {
    const current = queue.shift();
    for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const next = { x: current.x + dx, y: current.y + dy };
      const key = `${next.x},${next.y}`;
      if (seen.has(key) || !isCaveWalkable(level, next)) continue;
      seen.add(key); queue.push(next);
    }
  }
  return point => [...seen].some(key => {
    const [x, y] = key.split(',').map(Number);
    return Math.hypot(x - point.x, y - point.y) <= 14;
  });
}

test('every floor spawns unique, reachable monsters that take 3-4 starter hits', () => {
  for (const config of CAVE_LEVELS) {
    const ids = config.monsters.map(monster => monster.id);
    assert.equal(new Set(ids).size, ids.length, `${config.name} has no duplicate spawns`);
    assert.ok(config.monsters.length >= 4, `${config.name} has at least four enemies`);
    const reachable = reachableCells(config.level, config.entry);
    for (const monster of config.monsters) {
      assert.equal(isCaveWalkable(config.level, monster), true, `${monster.id} is not inside a wall`);
      assert.equal(reachable(monster), true, `${monster.id} is reachable from the floor entry`);
      assert.ok(Math.hypot(monster.x - config.entry.x, monster.y - config.entry.y) > 60,
        `${monster.id} does not spawn on top of the player`);
      assert.ok(monster.damage >= 7, `${monster.id} deals meaningful damage`);
      if (monster.kind === 'crawler' || monster.kind === 'bat') {
        const hits = Math.ceil(monster.hp / CAVE_WEAPONS.rusted.damage);
        assert.ok(hits >= 3 && hits <= 4, `${monster.id} needs ${hits} starter-sword hits`);
      }
    }
    if (config.descent) assert.equal(reachable(config.descent), true, `${config.name} descent is reachable`);
    // Deeper floors increase pressure rather than just adding more bodies.
    const averageDamage = config.monsters.reduce((sum, monster) => sum + monster.damage, 0) / config.monsters.length;
    if (config.level === 1) assert.ok(averageDamage < 8, 'the entrance is forgiving');
    if (config.level === 3) assert.ok(averageDamage > 10, 'the deep chamber hits harder');
    for (const chest of config.chests) assert.equal(reachable(chest), true, `${chest.id} is reachable`);
  }
});

test('monsters on every floor reduce player health when the player stands still in range', async () => {
  const { service, tick } = serviceAt();
  await start(service);
  const state = service.runs.get('visitor-a');
  for (const config of CAVE_LEVELS) {
    state.level = config.level;
    state.monsters = service.spawn(config.level);
    state.player.hp = CAVE_MAX_HP;
    state.player.x = state.monsters[0].x + 20; state.player.y = state.monsters[0].y;
    tick(1_200);
    const active = (await service.snapshot('visitor-a')).run;
    assert.equal(['attack', 'chase'].includes(active.monsters[0].state), true);
    assert.ok(active.player.hp < CAVE_MAX_HP, `${config.name} monsters actually damage the player`);
  }
});


test('standing still near cave monsters eventually kills the player', async () => {
  const { service, tick, calls } = serviceAt();
  await start(service);
  const state = service.runs.get('visitor-a');
  state.player.x = state.monsters[0].x + 20;
  state.player.y = state.monsters[0].y;
  let elapsed = 0;
  while (state.status === 'playing' && elapsed < 60_000) {
    tick(1_200); elapsed += 1_200;
    await service.snapshot('visitor-a');
  }
  assert.equal(state.status, 'dead', `standing still should end the run (after ${elapsed}ms)`);
  assert.equal(calls.defeats.length, 1, 'the defeat settles once');
});


test('descending uses the shared interaction reach and deeper floors are reachable', async () => {
  const { service } = serviceAt();
  const { run } = await start(service);
  const state = service.runs.get('visitor-a');
  const first = caveLevel(1);
  state.kills = first.required;
  state.player.x = first.descent.x + 90; state.player.y = first.descent.y;
  const second = await service.descend('visitor-a', { run_id: run.run_id });
  assert.equal(second.level, 2, 'a cleared floor can be descended from the wider reach');
  state.kills = caveLevel(2).required;
  const passage = caveLevel(2).descent;
  state.player.x = passage.x; state.player.y = passage.y;
  const third = await service.descend('visitor-a', { run_id: run.run_id });
  assert.equal(third.level, 3);
  assert.equal(third.monsters.length, 6, 'the deepest floor has its stronger roster');
});
