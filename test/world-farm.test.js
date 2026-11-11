import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign as signMessage } from 'node:crypto';
import { WorldFarm, FARM_ANCHORS, FARM_SCARCITY, BAZAAR, CROPS, PLANT_RADIUS } from '../service/world-farm.js';
import { WorldStore } from '../service/world-store.js';
import { collides, isNaturalGround, MAP } from '../web/dist/world/map.js';

const guest = { key: 'guest:visitor-a', provider: 'guest' };
const wallet = '11111111111111111111111111111111';
const BASE58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes){let value=0n;for(const byte of bytes)value=value*256n+BigInt(byte);let output='';while(value>0n){output=BASE58[Number(value%58n)]+output;value/=58n;}for(const byte of bytes){if(byte===0)output=`1${output}`;else break;}return output||'1';}

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

test('crop progression uses exact 3, 6 and 9 minute authoritative durations', async () => {
  const { farm, close } = await setup();
  try {
    const snapshot=farm.snapshot(guest);
    assert.deepEqual(Object.fromEntries(Object.entries(snapshot.crops).map(([kind,crop])=>[kind,{unlock:crop.unlock_level,grow:crop.grow_ms[0],production:crop.production_grow_ms}])),{
      wheat:{unlock:1,grow:180_000,production:180_000},carrot:{unlock:2,grow:360_000,production:360_000},pumpkin:{unlock:3,grow:540_000,production:540_000},
    });
    const tile=snapshot.tiles[0];
    await assert.rejects(()=>farm.plant(guest,{tile_id:tile.id,crop:'carrot'},tile.position),{code:'LEVEL_REQUIRED'});
    farm.account(guest).xp=40;
    await assert.rejects(()=>farm.plant(guest,{tile_id:tile.id,crop:'carrot'},tile.position),{code:'NOT_ENOUGH_CREDITS'});
  } finally { await close(); }
});

test('explicit test time scale accelerates timestamps and invalid values fail closed', async () => {
  assert.throws(()=>new WorldFarm({}, {timeScale:0}),/TIME_SCALE/);
  assert.throws(()=>new WorldFarm({}, {timeScale:Number.NaN}),/TIME_SCALE/);
  assert.throws(()=>new WorldFarm({}, {timeScale:0.01,allowTimeScale:false}),/cannot accelerate production/);
  const {farm,close}=await setup({timeScale:0.01});
  try{
    const crops=farm.snapshot(guest).crops;
    assert.deepEqual([crops.wheat.grow_ms[0],crops.carrot.grow_ms[0],crops.pumpkin.grow_ms[0]],[1_800,3_600,5_400]);
    assert.deepEqual([crops.wheat.production_grow_ms,crops.carrot.production_grow_ms,crops.pumpkin.production_grow_ms],[180_000,360_000,540_000]);
  }finally{await close();}
});

test('planting, growth and harvest move one crop into the inventory', async () => {
  const { farm, advance, close } = await setup();
  try {
    const tile = farm.snapshot(guest).tiles[0];
    const planted = await farm.plant(guest, { tile_id: tile.id, crop: 'wheat' }, tile.position);
    assert.equal(planted.tile.stage, 'growing');
    assert.equal(planted.grow_ms, 180_000);
    await assert.rejects(() => farm.harvest(guest, { tile_id: tile.id }, tile.position), { code: 'CROP_NOT_READY' });
    assert.equal(farm.snapshot(guest).account.inventory.wheat, 0);
    advance(180_001);
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

test('planting and harvesting succeed when visibly adjacent and fail outside the server radius', async () => {
  const { farm, advance, close } = await setup();
  try {
    const tile = farm.snapshot(guest).tiles[0];
    const adjacent = { x: tile.position.x + PLANT_RADIUS - 8, y: tile.position.y };
    const remote = { x: tile.position.x + PLANT_RADIUS + 8, y: tile.position.y };
    await assert.rejects(() => farm.plant(guest, { tile_id: tile.id, crop: 'wheat' }, remote), { code: 'TOO_FAR', message: 'Walk closer to the farm plot' });
    const planted = await farm.plant(guest, { tile_id: tile.id, crop: 'wheat' }, adjacent);
    assert.equal(planted.tile.stage, 'growing', 'adjacency, not the plot centre, is enough to plant');
    advance(180_001);
    await assert.rejects(() => farm.harvest(guest, { tile_id: tile.id }, remote), { code: 'TOO_FAR' });
    const harvested = await farm.harvest(guest, { tile_id: tile.id }, adjacent);
    assert.equal(harvested.quantity, 1);
  } finally { await close(); }
});

test('a remote visitor cannot plant the plot a nearby visitor can', async () => {
  const { farm, close } = await setup();
  try {
    const other = { key: 'guest:visitor-b', provider: 'guest' };
    const tile = farm.snapshot(guest).tiles[0];
    await assert.rejects(() => farm.plant(other, { tile_id: tile.id, crop: 'wheat', request_id: 'plant-far-00001' }, { x: 0, y: 0 }), { code: 'TOO_FAR' });
    const planted = await farm.plant(guest, { tile_id: tile.id, crop: 'wheat', request_id: 'plant-near-0001' }, tile.position);
    assert.equal(planted.tile.stage, 'growing');
    assert.equal(farm.state.ledger.filter(event => event.type === 'crop_planted').length, 1);
  } finally { await close(); }
});

test('two visitors contending for one plot produce exactly one planted crop', async () => {
  const { farm, close } = await setup();
  try {
    const other = { key: 'guest:visitor-b', provider: 'guest' };
    const tile = farm.snapshot(guest).tiles[0];
    const results = await Promise.allSettled([
      farm.plant(guest, { tile_id: tile.id, crop: 'wheat', request_id: 'plant-alice-001' }, tile.position),
      farm.plant(other, { tile_id: tile.id, crop: 'wheat', request_id: 'plant-bob-0001' }, tile.position),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'PLOT_OCCUPIED').length, 1);
    assert.equal(farm.state.ledger.filter(event => event.type === 'crop_planted').length, 1);
  } finally { await close(); }
});

test('plant and harvest request IDs replay without duplicating crop value', async () => {
  const { farm, advance, close } = await setup();
  try {
    const tile = farm.snapshot(guest).tiles[0];
    const plant = { tile_id: tile.id, crop: 'wheat', request_id: 'plant-retry-001' };
    const [firstPlant, replayedPlant] = await Promise.all([farm.plant(guest, plant, tile.position), farm.plant(guest, plant, tile.position)]);
    assert.equal(replayedPlant.event_id, firstPlant.event_id);
    assert.equal(farm.account(guest).stats.planted, 1);
    advance(180_001);
    const harvest = { tile_id: tile.id, request_id: 'harvest-retry-001' };
    const [firstHarvest, replayedHarvest] = await Promise.all([farm.harvest(guest, harvest, tile.position), farm.harvest(guest, harvest, tile.position)]);
    assert.equal(replayedHarvest.event_id, firstHarvest.event_id);
    assert.equal(farm.account(guest).inventory.wheat, 1);
    assert.equal(farm.account(guest).stats.harvested, 1);
    assert.equal(farm.state.ledger.filter(event => event.type === 'crop_harvested').length, 1);
  } finally { await close(); }
});

test('only the owner can harvest a growing plot', async () => {
  const { farm, advance, close } = await setup();
  try {
    const other = { key: 'guest:visitor-b', provider: 'guest' };
    const tile = farm.snapshot(guest).tiles[0];
    await farm.plant(guest, { tile_id: tile.id, crop: 'wheat' }, tile.position);
    advance(180_001);
    await assert.rejects(() => farm.harvest(other, { tile_id: tile.id }, tile.position), { code: 'NOT_OWNER' });
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
    for (const tile of tiles.slice(0, 3)) await farm.plant(guest, { tile_id: tile.id, crop: 'wheat' }, tile.position);
    await assert.rejects(() => farm.plant(guest, { tile_id: tiles[3].id, crop: 'wheat' }, tiles[3].position), { code: 'PLOT_LIMIT' });
  } finally { await close(); }
});

test('produce only sells at the bazaar and credits the account', async () => {
  const { farm, advance, close } = await setup();
  try {
    const account=farm.account(guest);account.xp=160;account.credits=CROPS.pumpkin.seedCost;
    const tile = farm.snapshot(guest).tiles[0];
    await farm.plant(guest, { tile_id: tile.id, crop: 'pumpkin' }, tile.position);
    advance(540_001);
    await farm.harvest(guest, { tile_id: tile.id }, tile.position);
    await assert.rejects(() => farm.sell(guest, { crop: 'pumpkin', quantity: 1 }, { x: 0, y: 0 }), { code: 'MARKET_REQUIRED' });
    const sold = await farm.sell(guest, { crop: 'pumpkin', quantity: 1 }, BAZAAR.position);
    assert.equal(sold.credits, CROPS.pumpkin.sell);
    assert.equal(sold.account.inventory.pumpkin, 0);
    assert.equal(sold.account.credits, CROPS.pumpkin.sell);
    await assert.rejects(() => farm.sell(guest, { crop: 'pumpkin', quantity: 1 }, BAZAAR.position), { code: 'INVENTORY_TOO_LOW' });
  } finally { await close(); }
});

test('market sale is atomic, idempotent and records one internal-credit ledger event', async () => {
  const { farm, close } = await setup();
  try {
    const account = farm.account(guest);
    account.inventory.wheat = 2;
    const command = { crop: 'wheat', quantity: 2, request_id: 'sale-retry-0001' };
    const [sold, replayed] = await Promise.all([farm.sell(guest, command, BAZAAR.position), farm.sell(guest, command, BAZAAR.position)]);
    assert.equal(replayed.event_id, sold.event_id);
    assert.equal(account.inventory.wheat, 0);
    assert.equal(account.credits, CROPS.wheat.sell * 2);
    const sales = farm.state.ledger.filter(event => event.type === 'market_sale');
    assert.equal(sales.length, 1);
    assert.deepEqual(sales[0].details, { crop: 'wheat', quantity: 2, unit_price: CROPS.wheat.sell, credits: CROPS.wheat.sell * 2, credits_before: 0, credits_after: CROPS.wheat.sell * 2 });
    await assert.rejects(() => farm.sell(guest, { crop: 'wheat', quantity: 1, request_id: 'sale-new-000001' }, BAZAAR.position), { code: 'INVENTORY_TOO_LOW' });
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

test('payout requests fail closed while real payouts are disabled', async () => {
  const { farm, close } = await setup({ lamportsPerCredit: 1_000, minWithdrawalCredits: 5 });
  const member = { key: 'clerk:user_pay', provider: 'clerk', subject: 'user_pay', name: 'Miro' };
  try {
    await assert.rejects(() => farm.requestPayout(guest, { amount_credits: 10 }), { code: 'SIGN_IN_REQUIRED' });
    await assert.rejects(() => farm.requestPayout(member, { amount_credits: 10 }), { code: 'PAYOUTS_DISABLED' });
  } finally { await close(); }
});

test('wallet ownership challenges are account-bound, expiring and single use', async () => {
  const {farm,advance,close}=await setup();
  const member={key:'clerk:user_wallet',provider:'clerk',subject:'user_wallet',name:'Miro'};
  const other={key:'clerk:user_other',provider:'clerk',subject:'user_other',name:'Other'};
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const address=base58(Buffer.from(publicKey.export({format:'jwk'}).x,'base64url'));
  try{
    await assert.rejects(()=>farm.createWalletChallenge(guest,{wallet_address:address,domain:'lastseat.ing'}),{code:'SIGN_IN_REQUIRED'});
    const {challenge}=await farm.createWalletChallenge(member,{wallet_address:address,domain:'lastseat.ing'});
    const signature=base58(signMessage(null,Buffer.from(challenge.message),privateKey));
    await assert.rejects(()=>farm.verifyWalletChallenge(other,{challenge_id:challenge.id,wallet_address:address,signature},'lastseat.ing'),{code:'CHALLENGE_NOT_FOUND'});
    await assert.rejects(()=>farm.verifyWalletChallenge(member,{challenge_id:challenge.id,wallet_address:address,signature},'evil.example'),{code:'CHALLENGE_DOMAIN_MISMATCH'});
    await assert.rejects(()=>farm.verifyWalletChallenge(member,{challenge_id:challenge.id,wallet_address:address,signature:base58(Buffer.alloc(64,7))},'lastseat.ing'),{code:'INVALID_SIGNATURE'});
    const verified=await farm.verifyWalletChallenge(member,{challenge_id:challenge.id,wallet_address:address,signature},'lastseat.ing');
    assert.equal(verified.account.wallet.status,'verified');
    assert.equal(verified.account.wallet.links.length,1);
    assert.equal(verified.account.wallet.links[0].primary,true);
    await assert.rejects(()=>farm.verifyWalletChallenge(member,{challenge_id:challenge.id,wallet_address:address,signature},'lastseat.ing'),{code:'CHALLENGE_USED'});
    const expiring=await farm.createWalletChallenge(member,{wallet_address:address,domain:'lastseat.ing'});advance(5*60_000+1);
    await assert.rejects(()=>farm.verifyWalletChallenge(member,{challenge_id:expiring.challenge.id,wallet_address:address,signature:base58(signMessage(null,Buffer.from(expiring.challenge.message),privateKey))},'lastseat.ing'),{code:'CHALLENGE_EXPIRED'});
    const duplicate=await farm.createWalletChallenge(other,{wallet_address:address,domain:'lastseat.ing'});const duplicateSignature=base58(signMessage(null,Buffer.from(duplicate.challenge.message),privateKey));
    await assert.rejects(()=>farm.verifyWalletChallenge(other,{challenge_id:duplicate.challenge.id,wallet_address:address,signature:duplicateSignature},'lastseat.ing'),{code:'WALLET_ALREADY_LINKED'});
  }finally{await close();}
});

test('guest adoption is idempotent and preserves one stable internal user', async()=>{
  const {farm,close}=await setup();const member={key:'clerk:user_merge',provider:'clerk',subject:'user_merge',name:'Miro'};
  try{farm.account(guest).credits=7;const first=await farm.adopt(guest.key,member);const userId=first.account.user_id;const retry=await farm.adopt(guest.key,member);assert.equal(retry.already_merged,true);assert.equal(retry.account.credits,7);assert.equal(retry.account.user_id,userId);assert.equal(farm.state.merge_receipts.length,1);}finally{await close();}
});

test('signing in merges guest progress, plots and inventory', async () => {
  const { farm, advance, close } = await setup();
  try {
    const tile = farm.snapshot(guest).tiles[0];
    await farm.plant(guest, { tile_id: tile.id, crop: 'wheat' }, tile.position);
    advance(180_001);
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
    assert.deepEqual(farm.snapshot(member).account.profile, { avatar: null, appearance: null, position: null, saved_at: null });
    const appearance = { version: 1, body: 'body_tan', hair: 'hair_curly_red', outfit: 'outfit_hoodie_forest', accessory: 'accessory_headphones' };
    const saved = await farm.saveProfile(member, { avatar: 'visitor_nova', appearance, position: { x: 640.4, y: 1000.6 } });
    assert.deepEqual(saved.saved.position, { x: 640, y: 1001 });
    assert.equal(saved.account.profile.avatar, 'visitor_nova');
    assert.deepEqual(saved.account.profile.appearance, appearance);
    assert.ok(saved.account.profile.saved_at);
    advance(10_000);
    const updated = await farm.saveProfile(member, { position: { x: -220, y: 930 } });
    assert.equal(updated.account.profile.avatar, 'visitor_nova', 'saving a position keeps the saved character');
    assert.deepEqual(updated.account.profile.appearance, appearance, 'saving a position keeps the saved appearance');
    assert.deepEqual(farm.snapshot(member).account.profile.position, { x: -220, y: 930 });
    const bare = await farm.saveProfile(member, { appearance: { version: 1, body: 'body_deep', hair: 'hair_buzz_blue', outfit: 'outfit_tee_cream', accessory: null } });
    assert.deepEqual(bare.account.profile.appearance, { version: 1, body: 'body_deep', hair: 'hair_buzz_blue', outfit: 'outfit_tee_cream', accessory: null });
    await farm.saveProfile(member, { appearance: null });
    assert.equal(farm.snapshot(member).account.profile.appearance, null, 'null restores the preset sheet');
    await assert.rejects(() => farm.saveProfile(member, { avatar: 'visitor_debug' }), { code: 'INVALID_AVATAR' });
    await assert.rejects(() => farm.saveProfile(member, { appearance: { version: 1, body: 'body_alien', hair: 'hair_bob_red', outfit: 'outfit_hoodie_forest', accessory: null } }), { code: 'INVALID_APPEARANCE' });
    await assert.rejects(() => farm.saveProfile(member, { appearance: 'body_tan' }), { code: 'INVALID_APPEARANCE' });
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
    const account=first.account(guest);account.xp=40;account.credits=CROPS.carrot.seedCost;
    const tile = first.snapshot(guest).tiles[0];
    await first.plant(guest, { tile_id: tile.id, crop: 'carrot', request_id: 'persist-plant-001' }, tile.position);
    await first.heartbeat(guest, { seconds: 30 });
    const tileId = tile.id;
    await first.close();
    now += 360_001;
    const secondStore = new WorldStore({ directory });
    await secondStore.open();
    const second = new WorldFarm(secondStore, { now: clock, random: () => 0.5 });
    await second.restore();
    const snapshot = second.snapshot(guest);
    assert.equal(snapshot.account.seconds_played, 30);
    assert.equal(snapshot.tiles.find(value => value.id === tileId).stage, 'ready');
    const replayed = await second.plant(guest, { tile_id: tile.id, crop: 'carrot', request_id: 'persist-plant-001' }, tile.position);
    assert.equal(replayed.tile.id, tileId);
    assert.equal(second.account(guest).stats.planted, 1, 'persisted request receipt prevents duplicate planting after reconnect');
    await second.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a temporary account keeps farm credits and produce across sessions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'world-farm-temp-'));
  let now = 1_000_000;
  const clock = () => now;
  try {
    const firstStore = new WorldStore({ directory });
    await firstStore.open();
    const first = new WorldFarm(firstStore, { now: clock, random: () => 0.5 });
    await first.restore();
    const before = first.snapshot(guest).account;
    assert.equal(before.temporary, true, 'a browser without a sign-in gets a temporary account automatically');
    assert.equal(before.signed_in, false);
    assert.match(before.id, /^farmer_[a-f0-9]{16}$/, 'the temporary account has a stable public id');
    first.account(guest).inventory.wheat = 2;
    const sold = await first.sell(guest, { crop: 'wheat', quantity: 2 }, BAZAAR.position);
    assert.equal(sold.account.credits, CROPS.wheat.sell * 2);
    await first.close();
    const secondStore = new WorldStore({ directory });
    await secondStore.open();
    const second = new WorldFarm(secondStore, { now: clock, random: () => 0.5 });
    await second.restore();
    const after = second.snapshot(guest).account;
    assert.equal(after.id, before.id, 'the same browser resumes the same temporary account');
    assert.equal(after.credits, CROPS.wheat.sell * 2, 'sold farm produce stays as credits');
    assert.equal(after.stats.sold, 2);
    assert.equal(after.temporary, true);
    await second.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a signed-in account is not marked temporary', async () => {
  const { farm, close } = await setup();
  try {
    const member = { key: 'clerk:user_temp_flag', provider: 'clerk', subject: 'user_temp_flag', name: 'Miro' };
    const account = farm.snapshot(member).account;
    assert.equal(account.temporary, false);
    assert.equal(account.signed_in, true);
  } finally { await close(); }
});
