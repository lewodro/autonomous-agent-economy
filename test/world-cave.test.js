import test from 'node:test';
import assert from 'node:assert/strict';
import { CaveService } from '../service/world-cave.js';
import { CAVE_LEVELS, CAVE_RESET_MS, CAVE_MAX_HP, caveLevel, isCaveWalkable, publicCaveLayout } from '../service/cave-layout.js';

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
  assert.deepEqual(CAVE_LEVELS.map(level => level.required), [3, 5, 4]);
  assert.deepEqual(CAVE_LEVELS.map(level => level.monsters.length), [3, 5, 4]);
  assert.equal(CAVE_LEVELS[0].chests.length, 0, 'the entrance holds no weapon chest');
  assert.equal(CAVE_LEVELS[1].chests[0].weapon, 'iron');
  assert.equal(CAVE_LEVELS[2].chests[0].weapon, 'caveforged');
  assert.ok(CAVE_LEVELS[2].ambient < CAVE_LEVELS[0].ambient, 'deeper levels are darker');
  assert.ok(CAVE_LEVELS[2].monsters.length > CAVE_LEVELS[0].monsters.length, 'deeper levels are harder');
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

test('a visitor cannot act in another visitor run and movement is range and wall checked', async () => {
  const { service } = serviceAt();
  const { run } = await start(service);
  await start(service, 'visitor-b');
  await assert.rejects(() => service.move('visitor-b', { run_id: run.run_id, x: 140, y: 340 }), { code: 'CAVE_RUN_NOT_FOUND' });
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
  assert.equal(first.monsters.find(monster => monster.id === 'crawler-1').hp, 12);
  const duplicate = await service.attack('visitor-a', { run_id: run.run_id, request_id: 'strike-00000001' });
  assert.equal(duplicate.duplicate, true);
  assert.equal(calls.rewards.length, 0, 'a duplicate attack must not duplicate damage or rewards');
  await service.attack('visitor-a', { run_id: run.run_id, request_id: 'strike-00000002' });
  assert.equal(calls.rewards.length, 1, 'the defeated monster grants one bounded reward');
  assert.equal(calls.rewards[0].amount, 2);
  await assert.rejects(() => service.attack('visitor-a', { run_id: run.run_id, request_id: 'strike-00000003' }), { code: 'CAVE_NO_TARGET' });
});

test('client-supplied health and monster state are ignored', async () => {
  const { service } = serviceAt();
  const { run } = await start(service);
  const forged = await service.move('visitor-a', { run_id: run.run_id, x: 160, y: 340, hp: 999, monsters: [{ id: 'crawler-1', hp: 0, alive: false }] });
  assert.equal(forged.player.hp, CAVE_MAX_HP, 'the visitor cannot forge its health');
  assert.equal(forged.monsters.every(monster => monster.alive), true, 'the visitor cannot kill monsters from the client');
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
