import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorldFarm, FARM_ANCHORS, FARM_SCARCITY, BAZAAR, CROPS } from '../service/world-farm.js';
import { WorldStore } from '../service/world-store.js';
import { collides, isNaturalGround, MAP } from '../web/dist/world/map.js';

const guest = { key: 'guest:visitor-a', provider: 'guest' };
const wallet = '11111111111111111111111111111111';

async function setup(options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'world-farm-'));
  let now = 1_000_000;
  const store = new WorldStore({ directory });
  await store.open();
  const farm = new WorldFarm(store, { now: () => now, random: () => 0.5, ...options });
  await farm.restore();
  return {
    farm,
    store,
    directory,
    clock: () => now,
    advance: ms => { now += ms; },
    close: async () => { await farm.close(); await rm(directory, { recursive: true, force: true }); },
  };
}

test('farm anchors are natural ground and widely spaced', () => {
  assert.ok(FARM_ANCHORS.length >= 8, 'the world keeps enough remote anchors to search');
  for (const anchor of FARM_ANCHORS) {
    assert.equal(isNaturalGround(anchor, 18), true, `${anchor.id} natural`);
    assert.equal(collides(anchor), false, `${anchor.id} reachable`);
    for (let dx = -16; dx <= 16; dx += 4) {
      for (let dy = -16; dy <= 16; dy += 4) {
        const position = { x: anchor.x + dx, y: anchor.y + dy };
        assert.equal(isNaturalGround(position, 18), true, `${anchor.id} jitter natural`);
        assert.equal(collides(position), false, `${anchor.id} jitter reachable`);
      }
    }
  }
  for (let left = 0; left < FARM_ANCHORS.length; left += 1) {
    for (let right = left + 1; right < FARM_ANCHORS.length; right += 1) {
      assert.ok(Math.hypot(FARM_ANCHORS[left].x - FARM_ANCHORS[right].x, FARM_ANCHORS[left].y - FARM_ANCHORS[right].y) >= 800, `${FARM_ANCHORS[left].id} is far from ${FARM_ANCHORS[right].id}`);
    }
  }
});

test('spawned tiles start scarce, stay on reachable ground and respect the cap', async () => {
  const { farm, advance, close } = await setup();
  try {
    let snapshot = farm.snapshot(guest);
    assert.equal(snapshot.tiles.length, FARM_SCARCITY.startingTiles);
    for (let count = FARM_SCARCITY.startingTiles + 1; count <= FARM_SCARCITY.maxTiles; count += 1) {
      advance(FARM_SCARCITY.spawnIntervalMs);
      snapshot = farm.snapshot(guest);
      assert.equal(snapshot.tiles.length, count, 'one plot appears per cadence window');
    }
    advance(FARM_SCARCITY.spawnIntervalMs);
    snapshot = farm.snapshot(guest);
    assert.equal(snapshot.tiles.length, FARM_SCARCITY.maxTiles, 'the concurrent cap holds');
    assert.equal(new Set(snapshot.tiles.map(tile => tile.anchor)).size, snapshot.tiles.length, 'wild plots use distinct zone anchors');
    for (const tile of snapshot.tiles) {
      assert.equal(tile.stage, 'wild');
      assert.equal(collides(tile.position), false, tile.id);
      assert.equal(isNaturalGround(tile.position, 18), true, tile.id);
      assert.ok(Math.hypot(tile.position.x - MAP.spawn.x, tile.position.y - MAP.spawn.y) >= 900, tile.id);
      assert.ok(FARM_ANCHORS.some(anchor => Math.hypot(anchor.x - tile.position.x, anchor.y - tile.position.y) <= 30));
    }
    for (let left = 0; left < snapshot.tiles.length; left += 1) {
      for (let right = left + 1; right < snapshot.tiles.length; right += 1) {
        assert.ok(Math.hypot(snapshot.tiles[left].position.x - snapshot.tiles[right].position.x, snapshot.tiles[left].position.y - snapshot.tiles[right].position.y) >= 800, 'plots are not clustered');
      }
    }
    assert.equal(snapshot.account.credits, 0);
    assert.equal(snapshot.account.level, 1);
  } finally { await close(); }
});

test('wild soil relocates to a different far anchor after its ttl', async () => {
  const { farm, advance, close } = await setup({ maxTiles: 2 });
  try {
    const before = farm.snapshot(guest).tiles[0];
    advance(FARM_SCARCITY.wildTtlMs);
    const after = farm.snapshot(guest).tiles.find(tile => tile.id === before.id);
    assert.ok(after);
    assert.notEqual(after.anchor, before.anchor);
    assert.ok(Math.hypot(after.position.x - before.position.x, after.position.y - before.position.y) >= 800);
    assert.equal(isNaturalGround(after.position, 18), true);
    assert.equal(collides(after.position), false);
  } finally { await close(); }
});

test('planting, growth and harvest move one crop into the inventory', async () => {
  const { farm, advance, close } = await setup();
  try {
    const tile = farm.snapshot(guest).tiles[0];
    const planted = await farm.plant(guest, { tile_id: tile.id, crop: 'wheat' }, tile.position);
    assert.equal(planted.tile.stage, 'growing');
    assert.ok(planted.grow_ms >= 60_000 && planted.grow_ms <= 120_000);
    await assert.rejects(() => farm.harvest(guest, { tile_id: tile.id }, tile.position), { code: 'CROP_GROWING' });
    assert.equal(farm.snapshot(guest).account.inventory.wheat, 0);
    advance(120_001);
    const harvested = await farm.harvest(guest, { tile_id: tile.id }, tile.position);
    assert.equal(harvested.crop, 'wheat');
    assert.equal(harvested.account.inventory.wheat, 1);
    assert.equal(harvested.account.stats.harvested, 1);
    assert.ok(harvested.account.xp > 0);
    const after = farm.snapshot(guest).tiles.find(value => value.id === tile.id);
    assert.equal(after.stage, 'wild');
    assert.equal(after.mine, false);
  } finally { await close(); }
});

test('only the owner can harvest a growing plot', async () => {
  const { farm, advance, close } = await setup();
  try {
    const other = { key: 'guest:visitor-b', provider: 'guest' };
    const tile = farm.snapshot(guest).tiles[0];
    await farm.plant(guest, { tile_id: tile.id, crop: 'carrot' }, tile.position);
    advance(121_000);
    await assert.rejects(() => farm.harvest(other, { tile_id: tile.id }, tile.position), { code: 'NOT_YOUR_PLOT' });
  } finally { await close(); }
});

test('a player cannot tend more than three plots at once', async () => {
  const { farm, advance, close } = await setup();
  try {
    for (let count = FARM_SCARCITY.startingTiles; count < FARM_SCARCITY.maxTiles; count += 1) {
      advance(FARM_SCARCITY.spawnIntervalMs);
      farm.snapshot(guest);
    }
    const tiles = farm.snapshot(guest).tiles;
    assert.equal(tiles.length, FARM_SCARCITY.maxTiles);
    for (const tile of tiles.slice(0, 3)) await farm.plant(guest, { tile_id: tile.id, crop: 'pumpkin' }, tile.position);
    await assert.rejects(() => farm.plant(guest, { tile_id: tiles[3].id, crop: 'pumpkin' }, tiles[3].position), { code: 'PLOT_LIMIT' });
  } finally { await close(); }
});

test('produce only sells at the bazaar and credits the account', async () => {
  const { farm, advance, close } = await setup();
  try {
    const tile = farm.snapshot(guest).tiles[0];
    await farm.plant(guest, { tile_id: tile.id, crop: 'pumpkin' }, tile.position);
    advance(121_000);
    await farm.harvest(guest, { tile_id: tile.id }, tile.position);
    await assert.rejects(() => farm.sell(guest, { crop: 'pumpkin', quantity: 1 }, { x: 0, y: 0 }), { code: 'BAZAAR_OUT_OF_RANGE' });
    const sold = await farm.sell(guest, { crop: 'pumpkin', quantity: 1 }, BAZAAR.position);
    assert.equal(sold.credits, CROPS.pumpkin.sell);
    assert.equal(sold.account.inventory.pumpkin, 0);
    assert.equal(sold.account.credits, CROPS.pumpkin.sell);
    await assert.rejects(() => farm.sell(guest, { crop: 'pumpkin', quantity: 1 }, BAZAAR.position), { code: 'NOT_ENOUGH_PRODUCE' });
  } finally { await close(); }
});

test('play time accrues credits at a capped server rate', async () => {
  const { farm, close } = await setup({ creditsPerMinute: 2 });
  try {
    await farm.heartbeat(guest, { seconds: 30 });
    assert.equal(farm.snapshot(guest).account.seconds_played, 30);
    const tenMinutes = await farm.heartbeat(guest, { seconds: 600 });
    assert.equal(tenMinutes.accepted_seconds, 30, 'the server refuses implausible heartbeat gaps');
    for (let index = 0; index < 18; index += 1) await farm.heartbeat(guest, { seconds: 30 });
    const account = farm.snapshot(guest).account;
    assert.equal(account.seconds_played, 600);
    assert.equal(account.credits, 20);
    assert.equal(account.time_credits, 20);
  } finally { await close(); }
});

test('payout requests need a signed-in account, linked wallet, minimum balance and stay queued', async () => {
  const { farm, close } = await setup({ lamportsPerCredit: 1_000, minWithdrawalCredits: 5 });
  const member = { key: 'clerk:user_pay', provider: 'clerk', subject: 'user_pay', name: 'Miro' };
  try {
    await assert.rejects(() => farm.requestPayout(guest, { amount_credits: 10 }), { code: 'SIGN_IN_REQUIRED' });
    await farm.linkWallet(member, { wallet_address: wallet });
    await assert.rejects(() => farm.requestPayout(member, { amount_credits: 10 }), { code: 'INSUFFICIENT_CREDITS' });
    for (let index = 0; index < 40; index += 1) await farm.heartbeat(member, { seconds: 30 });
    const result = await farm.requestPayout(member, { amount_credits: 5 });
    assert.equal(result.payout.status, 'queued');
    assert.equal(result.payout.amount_lamports, 5_000);
    assert.equal(result.account.credits, 15);
    assert.equal(result.account.wallet.status, 'self_declared');
    assert.equal('private_key' in result.account.wallet, false);
  } finally { await close(); }
});

test('signing in merges guest progress, plots and inventory', async () => {
  const { farm, advance, close } = await setup();
  try {
    const tile = farm.snapshot(guest).tiles[0];
    await farm.plant(guest, { tile_id: tile.id, crop: 'wheat' }, tile.position);
    advance(121_000);
    await farm.harvest(guest, { tile_id: tile.id }, tile.position);
    await farm.heartbeat(guest, { seconds: 30 });
    const account = { key: 'clerk:user_123', provider: 'clerk', subject: 'user_123', name: 'Miro' };
    const merged = await farm.adopt(guest.key, account);
    assert.equal(merged.merged, true);
    assert.equal(merged.account.display_name, 'Miro');
    assert.equal(merged.account.inventory.wheat, 1);
    assert.equal(merged.account.signed_in, true);
    assert.equal(merged.account.credits, 0);
    assert.equal(farm.snapshot(guest).account.credits, 0, 'a fresh guest does not inherit the account');
  } finally { await close(); }
});

test('a signed-in account saves the character and plaza position as its instance', async () => {
  const { farm, advance, close } = await setup();
  const member = { key: 'clerk:user_saved', provider: 'clerk', subject: 'user_saved', name: 'Miro' };
  try {
    assert.deepEqual(farm.snapshot(member).account.profile, { avatar: null, position: null, saved_at: null });
    const saved = await farm.saveProfile(member, { avatar: 'visitor_nova', position: { x: 640.4, y: 1000.6 } });
    assert.deepEqual(saved.saved.position, { x: 640, y: 1001 });
    assert.equal(saved.account.profile.avatar, 'visitor_nova');
    assert.ok(saved.account.profile.saved_at);
    advance(10_000);
    const updated = await farm.saveProfile(member, { position: { x: -220, y: 930 } });
    assert.equal(updated.account.profile.avatar, 'visitor_nova', 'saving a position keeps the saved character');
    assert.deepEqual(farm.snapshot(member).account.profile.position, { x: -220, y: 930 });
    await assert.rejects(() => farm.saveProfile(member, { avatar: 'visitor_debug' }), { code: 'INVALID_AVATAR' });
    await assert.rejects(() => farm.saveProfile(member, { position: { x: 999_999, y: 0 } }), { code: 'INVALID_POSITION' });
    await assert.rejects(() => farm.saveProfile(member, {}), { code: 'EMPTY_PROFILE' });
  } finally { await close(); }
});

test('farm state survives a restart through the shared store', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'world-farm-persist-'));
  let now = 1_000_000;
  const clock = () => now;
  try {
    const firstStore = new WorldStore({ directory });
    await firstStore.open();
    const first = new WorldFarm(firstStore, { now: clock, random: () => 0.5 });
    await first.restore();
    const tile = first.snapshot(guest).tiles[0];
    await first.plant(guest, { tile_id: tile.id, crop: 'carrot' }, tile.position);
    await first.heartbeat(guest, { seconds: 30 });
    const tileId = tile.id;
    await first.close();
    now += 121_000;
    const secondStore = new WorldStore({ directory });
    await secondStore.open();
    const second = new WorldFarm(secondStore, { now: clock, random: () => 0.5 });
    await second.restore();
    const snapshot = second.snapshot(guest);
    assert.equal(snapshot.account.seconds_played, 30);
    assert.equal(snapshot.tiles.find(value => value.id === tileId).stage, 'ready');
    await second.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
