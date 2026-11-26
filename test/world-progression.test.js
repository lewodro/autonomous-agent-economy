import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorldFarm } from '../service/world-farm.js';
import { WorldStore } from '../service/world-store.js';
import { CaveService } from '../service/world-cave.js';
import { DISCOVERY_GROUPS, DISCOVERY_SITE_IDS } from '../src/world-discovery.js';
import { EQUIPMENT, EQUIPMENT_IDS } from '../src/world-equipment.js';
import { DISCOVERY_SITES } from '../web/dist/world/explore.js';

const guest = { key: 'guest:progression', provider: 'guest' };
const other = { key: 'guest:other', provider: 'guest' };

async function setup(options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'world-progression-'));
  let now = 1_000_000;
  const store = new WorldStore({ directory });
  await store.open();
  const farm = new WorldFarm(store, { now: () => now, random: () => 0.5, ...options });
  await farm.restore();
  return {
    farm, directory, now: () => now,
    advance: ms => { now += ms; },
    close: async () => { await farm.close(); await rm(directory, { recursive: true, force: true }); },
  };
}

async function fund(farm, credits) {
  farm.account(guest).credits = credits;
  await farm.persist();
}

test('reward catalog keeps two extensible groups whose landmarks exist in the journal', () => {
  assert.equal(DISCOVERY_GROUPS.length, 2);
  assert.deepEqual(DISCOVERY_GROUPS.map(group => group.sites.length), [5, 6]);
  assert.deepEqual(DISCOVERY_GROUPS.map(group => group.reward), [5, 5]);
  assert.equal(DISCOVERY_GROUPS.reduce((sum, group) => sum + group.reward, 0), 10);
  const clientIds = new Set(DISCOVERY_SITES.map(site => site.id));
  for (const id of DISCOVERY_SITE_IDS) assert.ok(clientIds.has(id), `${id} must exist in the browser catalog`);
  for (const group of DISCOVERY_GROUPS) for (const id of group.sites) assert.ok(clientIds.has(id), `${id} is a journal landmark`);
});

test('a discovery group pays exactly five credits once, even on retries and refresh', async () => {
  const ctx = await setup();
  try {
    const [trails, ascent] = DISCOVERY_GROUPS;
    let result = await ctx.farm.reportDiscoveries(guest, { found: trails.sites.slice(0, 4), request_id: 'disc-partial-0001' });
    assert.equal(result.rewards.length, 0, 'partial completion pays nothing');
    assert.equal(result.account.credits, 0);

    result = await ctx.farm.reportDiscoveries(guest, { found: trails.sites, request_id: 'disc-trails-0001' });
    assert.equal(result.rewards.length, 1);
    assert.equal(result.rewards[0].group_id, trails.id);
    assert.equal(result.rewards[0].credits, 5);
    assert.equal(result.account.credits, 5);

    const replay = await ctx.farm.reportDiscoveries(guest, { found: trails.sites, request_id: 'disc-trails-0001' });
    assert.deepEqual(replay.rewards, [], 'a replay must not repeat the +5 celebration');
    assert.equal(replay.account.credits, 5);
    const repeat = await ctx.farm.reportDiscoveries(guest, { found: [...trails.sites, ...ascent.sites], request_id: 'disc-ascent-0001' });
    assert.equal(repeat.rewards.length, 1);
    assert.equal(repeat.account.credits, 10, 'both groups pay ten credits total');
    assert.equal(ctx.farm.state.ledger.filter(event => event.type === 'discovery_reward').length, 2);

    await ctx.farm.close();
    const restored = new WorldFarm(new WorldStore({ directory: ctx.directory }), { now: ctx.now });
    await restored.restore();
    const view = restored.view(guest);
    assert.equal(view.credits, 10, 'credits survive a restart');
    assert.deepEqual(view.discovery.rewarded_groups.slice().sort(), [trails.id, ascent.id].sort());
    const afterRefresh = await restored.reportDiscoveries(guest, { found: [...trails.sites, ...ascent.sites], request_id: 'disc-after-refresh' });
    assert.deepEqual(afterRefresh.rewards, []);
    assert.equal(afterRefresh.account.credits, 10);
    await restored.close();
  } finally { await ctx.close(); }
});

test('guest discovery rewards and equipment migrate into a signed-in account once', async () => {
  const ctx = await setup();
  try {
    const group = DISCOVERY_GROUPS[0];
    await ctx.farm.reportDiscoveries(guest, { found: group.sites, request_id: 'disc-migrate-0001' });
    await fund(ctx.farm, 40);
    await ctx.farm.equipmentCommand(guest, { action: 'buy', item_id: 'iron_sword', request_id: 'buy-migrate-0001' });
    const merged = await ctx.farm.adopt(guest.key, { key: 'acct:adventure', provider: 'clerk' });
    assert.equal(merged.account.credits, 30, 'guest credits carry over, including the reward already spent on gear');
    assert.deepEqual(merged.account.discovery.rewarded_groups, [group.id]);
    assert.equal(merged.account.equipment.owned.iron_sword, 1);
    assert.equal(merged.account.equipment.equipped.weapon, 'wooden_sword', 'the carried sword is owned but must be equipped explicitly');
    const replay = await ctx.farm.reportDiscoveries({ key: 'acct:adventure', provider: 'clerk' }, { found: group.sites, request_id: 'disc-after-signin' });
    assert.deepEqual(replay.rewards, [], 'signing in cannot claim the guest reward a second time');
    assert.equal(replay.account.credits, 30);
  } finally { await ctx.close(); }
});

test('equipment purchases are atomic, idempotent and bound to the owning account', async () => {
  const ctx = await setup();
  try {
    await fund(ctx.farm, 200);
    const bought = await ctx.farm.equipmentCommand(guest, { action: 'buy', item_id: 'iron_sword', request_id: 'buy-iron-0001' });
    assert.equal(bought.account.credits, 190);
    assert.equal(bought.account.equipment.owned.iron_sword, 1);
    assert.equal(ctx.farm.state.ledger.filter(event => event.type === 'equipment_purchase').length, 1);

    const replay = await ctx.farm.equipmentCommand(guest, { action: 'buy', item_id: 'iron_sword', request_id: 'buy-iron-0001' });
    assert.equal(replay.account.equipment.owned.iron_sword, 1, 'retry does not buy twice');
    assert.equal(ctx.farm.view(guest).credits, 190);

    await fund(ctx.farm, 0);
    await assert.rejects(() => ctx.farm.equipmentCommand(guest, { action: 'buy', item_id: 'frostblade', request_id: 'buy-frost-0001' }), { code: 'INSUFFICIENT_CREDITS' });
    assert.equal(ctx.farm.view(guest).credits, 0, 'a rejected purchase never drives credits negative');
    assert.equal(ctx.farm.view(guest).equipment.owned.frostblade, 0);

    await assert.rejects(() => ctx.farm.equipmentCommand(other, { action: 'equip', item_id: 'iron_sword', request_id: 'steal-iron-0001' }), { code: 'NOT_OWNED' });
    assert.equal(ctx.farm.view(other).equipment.equipped.weapon, 'wooden_sword', 'player A cannot equip player B’s sword');

    const equipped = await ctx.farm.equipmentCommand(guest, { action: 'equip', item_id: 'iron_sword', request_id: 'equip-iron-0001' });
    assert.equal(equipped.account.equipment.equipped.weapon, 'iron_sword');
    const unequipped = await ctx.farm.equipmentCommand(guest, { action: 'unequip', slot: 'weapon', request_id: 'unequip-iron-0001' });
    assert.equal(unequipped.account.equipment.equipped.weapon, null);
    assert.equal(unequipped.account.equipment.owned.iron_sword, 1, 'unequipping keeps ownership');
  } finally { await ctx.close(); }
});

test('loadout from the account changes cave damage, mitigation and potion healing', async () => {
  const ctx = await setup();
  try {
    await fund(ctx.farm, 200);
    for (const id of ['steel_sword', 'light_armor', 'health_potion']) {
      await ctx.farm.equipmentCommand(guest, { action: 'buy', item_id: id, request_id: `buy-${id}-0001` });
    }
    await ctx.farm.equipmentCommand(guest, { action: 'equip', item_id: 'steel_sword', request_id: 'equip-steel-0001' });
    await ctx.farm.equipmentCommand(guest, { action: 'equip', item_id: 'light_armor', request_id: 'equip-armor-0001' });
    const loadout = ctx.farm.loadout(guest);
    assert.equal(loadout.weapon.id, 'steel_sword');
    assert.equal(loadout.weapon.damage, EQUIPMENT.steel_sword.damage);
    assert.equal(loadout.armor.mitigation, 0.25);
    assert.equal(loadout.potion.available, 1);

    const cave = new CaveService({
      now: ctx.now,
      onPotion: async ({ requestId }) => ctx.farm.usePotion(guest, { action: 'use_potion', request_id: requestId }),
    });
    const start = await cave.start('cave-visitor', {
      exterior: { x: -700, y: -736 },
      credential: { farmIdentity: guest, economyOwner: guest.key },
      loadout,
    });
    assert.equal(start.run.weapon.id, 'steel_sword');
    assert.equal(start.run.player.max_hp, 110, 'light armor raises cave max HP');
    assert.equal(start.run.potion.available, 1);
    // Even a forged browser-supplied loadout cannot exceed server caps.
    const capped = cave.sanitizeLoadout({ weapon: { id: 'forged', damage: 9999, range: 9999 }, armor: { mitigation: 9, bonus_hp: 999 }, potion: { available: 999, heal: 999 } });
    assert.equal(capped.weapon.damage, 40);
    assert.equal(capped.weapon.range, 110);
    assert.equal(capped.armor.mitigation, 0.6);
    assert.equal(capped.potion.available, 9);

    const run = cave.runs.get('cave-visitor');
    const monster = run.monsters[0];
    run.player.x = monster.x; run.player.y = monster.y + 20; run.player.facing = 'up';
    monster.lastAttack = ctx.now();
    const before = monster.hp;
    const attack = await cave.attack('cave-visitor', { run_id: run.id, request_id: 'cave-attack-0001' });
    assert.equal(monster.hp, before - EQUIPMENT.steel_sword.damage, 'the equipped sword decides cave damage');
    assert.equal(attack.weapon.damage, 24);

    monster.lastAttack = ctx.now();
    ctx.advance(2_000);
    const hpBefore = run.player.hp;
    await cave.advance(run);
    assert.equal(run.player.hp, hpBefore - Math.max(1, Math.round(monster.damage * 0.75)), 'armor mitigates monster hits');

    run.player.hp = 40;
    const healed = await cave.potion('cave-visitor', { run_id: run.id, request_id: 'cave-potion-0001' });
    assert.equal(healed.healed, 45);
    assert.equal(run.player.hp, 85);
    assert.equal(ctx.farm.view(guest).equipment.owned.health_potion, 0, 'the potion was consumed from the shared inventory');
    const replay = await cave.potion('cave-visitor', { run_id: run.id, request_id: 'cave-potion-0001' });
    assert.equal(replay.duplicate, true);
    assert.equal(run.player.hp, 85, 'a replayed potion does not heal twice');
    assert.ok(EQUIPMENT_IDS.every(id => id in ctx.farm.view(guest).equipment.owned));
  } finally { await ctx.close(); }
});
