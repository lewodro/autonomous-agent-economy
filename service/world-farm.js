import { createHash, createPublicKey, randomBytes, randomUUID, verify as verifySignature } from 'node:crypto';
import { validSolanaAddress } from './world-economy.js';

const VERSION = 3;
const NICKNAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{1,23}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,95}$/;
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const WALLET_CHALLENGE_TTL_MS = 5 * 60_000;
/** Kept in sync with the curated browser avatar catalog. */
export const SAVED_AVATARS = Object.freeze(['visitor_ember', 'visitor_atlas', 'visitor_nova', 'visitor_echo']);
/** Same walkable bounds the browser uses, so a saved instance cannot be restored inside the void. */
const WORLD_BOUNDS = Object.freeze({ minX: -896, minY: -576, maxX: 2688, maxY: 1728 });
// Production crop durations are exact server timestamps. Tests may apply the
// explicit constructor time scale; browsers never influence these values.
export const CROPS = Object.freeze({
  wheat: { label: 'Wheat', unlockLevel: 1, growMs: 3 * 60_000, seedCost: 0, sell: 4, plantXp: 4, xp: 18 },
  carrot: { label: 'Carrot', unlockLevel: 2, growMs: 6 * 60_000, seedCost: 2, sell: 10, plantXp: 8, xp: 32 },
  pumpkin: { label: 'Pumpkin', unlockLevel: 3, growMs: 9 * 60_000, seedCost: 4, sell: 18, plantXp: 12, xp: 54 },
});
export const CROP_KINDS = Object.freeze(Object.keys(CROPS));
export const BAZAAR = Object.freeze({ position: { x: 681, y: 1292 }, radius: 160 });
export const PLANT_RADIUS = 96;
/** Scarcity is deliberate: a fresh world starts with one plot and reaches four. */
export const FARM_SCARCITY = Object.freeze({
  maxTiles: 4,
  startingTiles: 1,
  spawnIntervalMs: 150_000,
  wildTtlMs: 10 * 60_000,
});

/**
 * Fixed natural-ground anchors. They are far enough apart that a plot always
 * requires a real search, and every anchor has been checked with the browser's
 * terrain helpers so jitter cannot land in a road, plaza or building.
 */
export const FARM_ANCHORS = Object.freeze([
  { id: 'west-road', zone: 'west_outskirts', tier: 3, x: -720, y: 600 },
  { id: 'north-west', zone: 'outer_north', tier: 3, x: -350, y: -450 },
  { id: 'north-east', zone: 'north_ridge', tier: 3, x: 1000, y: -420 },
  { id: 'east-north', zone: 'east_outskirts', tier: 3, x: 2400, y: -200 },
  { id: 'east-mid', zone: 'outer_forest', tier: 3, x: 2500, y: 680 },
  { id: 'garden-east', zone: 'botanical', tier: 2, x: 1600, y: 650 },
  { id: 'south-east', zone: 'east_meadow', tier: 3, x: 1950, y: 1450 },
  { id: 'south-west', zone: 'south_meadow', tier: 3, x: -500, y: 1500 },
  { id: 'south-mid', zone: 'south_fields', tier: 3, x: 1020, y: 1610 },
]);

function fail(code, message, status = 400) { return Object.assign(new Error(message), { code, status }); }
function publicId(key) { return `farmer_${createHash('sha256').update(key).digest('hex').slice(0, 16)}`; }
function internalUserId() { return `usr_${randomUUID().replaceAll('-', '')}`; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function decodeBase58(value) {
  if (typeof value !== 'string' || !value) throw fail('INVALID_SIGNATURE', 'Wallet signature is invalid');
  let number = 0n;
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) throw fail('INVALID_SIGNATURE', 'Wallet signature is invalid');
    number = number * 58n + BigInt(digit);
  }
  const bytes = [];
  while (number > 0n) { bytes.push(Number(number & 255n)); number >>= 8n; }
  for (const character of value) { if (character === '1') bytes.push(0); else break; }
  return Buffer.from(bytes.reverse());
}

export function verifySolanaMessage(address, message, signature) {
  try {
    const publicKey = decodeBase58(address);
    const signed = decodeBase58(signature);
    if (publicKey.length !== 32 || signed.length !== 64) return false;
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicKey]), format: 'der', type: 'spki' });
    return verifySignature(null, Buffer.from(message, 'utf8'), key, signed);
  } catch { return false; }
}

function levelFor(xp) {
  const level = 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 40));
  const current = (level - 1) ** 2 * 40;
  const next = level ** 2 * 40;
  return { level, progress: next === current ? 1 : clamp((xp - current) / (next - current), 0, 1), next };
}

function defaultAccount(identity, now) {
  const suffix = createHash('sha256').update(identity.key).digest('hex').slice(0, 4).toUpperCase();
  return {
    key: identity.key,
    user_id: internalUserId(),
    clerk_user_id: identity.provider === 'clerk' ? identity.subject || identity.key.slice(6) : null,
    provider: identity.provider || 'guest',
    subject: identity.subject || null,
    display_name: identity.name || `Farmer ${suffix}`,
    wallet_address: null,
    wallet_status: 'unlinked',
    wallet_links: [],
    credits: 0,
    xp: 0,
    seconds_played: 0,
    time_credits: 0,
    inventory: { wheat: 0, carrot: 0, pumpkin: 0 },
    stats: { planted: 0, harvested: 0, sold: 0, credits_from_sales: 0 },
    profile: { avatar: null, position: null, saved_at: null },
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
    last_seen: new Date(now).toISOString(),
  };
}

/**
 * Server-authoritative human farm loop. Growth, inventory, sale prices, play
 * time and payout requests are all decided here; the browser only renders the
 * snapshot and sends intents. Payouts are queued ledger entries, never signed
 * transactions, matching the repository's disabled-mainnet posture.
 */
export class WorldFarm {
  constructor(store, {
    now = () => Date.now(),
    random = Math.random,
    creditsPerMinute = 1,
    lamportsPerCredit = 0,
    maxTiles = FARM_SCARCITY.maxTiles,
    maxPlotsPerPlayer = 3,
    minWithdrawalCredits = 50,
    spawnIntervalMs = FARM_SCARCITY.spawnIntervalMs,
    wildTtlMs = FARM_SCARCITY.wildTtlMs,
    timeScale = 1,
    allowTimeScale = true,
    payoutsEnabled = false,
  } = {}) {
    if (!Number.isInteger(creditsPerMinute) || creditsPerMinute < 0 || creditsPerMinute > 60) throw new Error('Invalid creditsPerMinute');
    if (!Number.isSafeInteger(lamportsPerCredit) || lamportsPerCredit < 0) throw new Error('Invalid lamportsPerCredit');
    if (!Number.isFinite(timeScale) || timeScale <= 0 || timeScale > 1) throw new Error('WORLD_FARM_TIME_SCALE must be greater than 0 and at most 1');
    if (!allowTimeScale && timeScale !== 1) throw new Error('WORLD_FARM_TIME_SCALE cannot accelerate production farming');
    this.store = store;
    this.now = now;
    this.random = random;
    this.creditsPerMinute = creditsPerMinute;
    this.lamportsPerCredit = lamportsPerCredit;
    this.maxTiles = clamp(maxTiles, 1, 24);
    this.maxPlotsPerPlayer = clamp(maxPlotsPerPlayer, 1, 12);
    this.minWithdrawalCredits = clamp(minWithdrawalCredits, 1, 1_000_000);
    this.spawnIntervalMs = Math.max(10_000, Number(spawnIntervalMs) || FARM_SCARCITY.spawnIntervalMs);
    this.wildTtlMs = Math.max(this.spawnIntervalMs, Number(wildTtlMs) || FARM_SCARCITY.wildTtlMs);
    this.timeScale = timeScale;
    this.payoutsEnabled = payoutsEnabled === true;
    this.state = { version: VERSION, accounts: {}, tiles: {}, payouts: [], ledger: [], idempotency: [], merge_receipts: [], wallet_challenges: [], migrated_at: null, next_spawn_at: null };
    this.inflightCommands = new Map();
    this.timer = null;
  }

  async restore() {
    const saved = await this.store.load();
    if (saved) {
      if (![1, 2, VERSION].includes(saved.version) || typeof saved.accounts !== 'object' || typeof saved.tiles !== 'object' || !Array.isArray(saved.payouts)) {
        throw new Error('Invalid world farm checkpoint');
      }
      this.state = saved;
      if (saved.version < VERSION) {
        this.state.version = VERSION;
        this.state.ledger ||= [];
        this.state.idempotency ||= [];
        this.state.migrated_at = new Date(this.now()).toISOString();
      }
    }
    this.state.ledger ||= [];
    this.state.idempotency ||= [];
    this.state.merge_receipts ||= [];
    this.state.wallet_challenges ||= [];
    if (!Array.isArray(this.state.ledger) || !Array.isArray(this.state.idempotency)) throw new Error('Invalid world farm ledger');
    for (const key of Object.keys(this.state.accounts)) {
      const account = this.state.accounts[key];
      account.inventory ||= { wheat: 0, carrot: 0, pumpkin: 0 };
      account.stats ||= { planted: 0, harvested: 0, sold: 0, credits_from_sales: 0 };
      account.seconds_played ||= 0;
      account.time_credits ||= 0;
      account.xp ||= 0;
      account.credits ||= 0;
      account.profile ||= { avatar: null, position: null, saved_at: null };
      account.user_id ||= internalUserId();
      account.clerk_user_id ??= account.provider === 'clerk' ? account.subject || key.slice(6) : null;
      account.wallet_links ||= [];
      account.updated_at ||= account.last_seen || account.created_at || new Date(this.now()).toISOString();
    }
    this.state.next_spawn_at ??= null;
    this.tick();
    await this.persist();
    return this.snapshot(null);
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { try { if (this.tick()) void this.persist(); } catch (error) { console.error(`World farm tick failed: ${error.message}`); } }, 5_000);
    this.timer.unref?.();
  }

  async close() { if (this.timer) clearInterval(this.timer); this.timer = null; await this.store.close(); }

  persist() { return this.store.save(this.state); }

  chooseAnchor(excludeTileId = null, avoidAnchor = null) {
    const occupied = new Set(Object.values(this.state.tiles)
      .filter(tile => tile.id !== excludeTileId)
      .map(tile => tile.anchor));
    const available = FARM_ANCHORS.filter(anchor => !occupied.has(anchor.id) && anchor.id !== avoidAnchor);
    if (!available.length) return FARM_ANCHORS.find(anchor => anchor.id !== avoidAnchor) || FARM_ANCHORS[0];
    return available[Math.floor(this.random() * available.length) % available.length];
  }

  /** Every 4 px jitter candidate is covered by the terrain-placement tests. */
  positionFor(anchor) {
    const jitter = () => Math.round((this.random() * 32 - 16) / 4) * 4;
    return { x: anchor.x + jitter(), y: anchor.y + jitter() };
  }

  spawnTile() {
    const anchor = this.chooseAnchor();
    const tile = {
      id: `plot_${randomUUID().slice(0, 8)}`,
      anchor: anchor.id,
      position: this.positionFor(anchor),
      stage: 'wild',
      crop: null,
      owner: null,
      planted_at: null,
      ready_at: null,
      spawned_at: this.now(),
    };
    this.state.tiles[tile.id] = tile;
    return tile;
  }

  /** Wild soil relocates after a while; new soil appears on a slower cadence. */
  tick() {
    const now = this.now();
    let changed = false;

    // Trim any pre-scarcity checkpoint down to the new cap without touching
    // planted plots, so an older world keeps its crops while new growth slows.
    let excess = Object.keys(this.state.tiles).length - this.maxTiles;
    if (excess > 0) {
      const wild = Object.values(this.state.tiles)
        .filter(tile => tile.stage === 'wild')
        .sort((a, b) => (a.spawned_at || 0) - (b.spawned_at || 0));
      for (const tile of wild) {
        if (excess <= 0) break;
        delete this.state.tiles[tile.id];
        excess -= 1;
        changed = true;
      }
    }

    for (const tile of Object.values(this.state.tiles)) {
      if (tile.stage !== 'wild') continue;
      if (now - (tile.spawned_at || 0) < this.wildTtlMs) continue;
      const anchor = this.chooseAnchor(tile.id, tile.anchor);
      tile.anchor = anchor.id;
      tile.position = this.positionFor(anchor);
      tile.spawned_at = now;
      changed = true;
    }

    const count = Object.keys(this.state.tiles).length;
    if (count < this.maxTiles) {
      if (count === 0 || this.state.next_spawn_at == null || now >= this.state.next_spawn_at) {
        this.spawnTile();
        this.state.next_spawn_at = now + this.spawnIntervalMs;
        changed = true;
      }
    }
    return changed;
  }

  account(identity, { touch = true } = {}) {
    if (!identity?.key) throw fail('UNAUTHENTICATED', 'No world identity', 401);
    let account = this.state.accounts[identity.key];
    if (!account) {
      account = defaultAccount(identity, this.now());
      this.state.accounts[identity.key] = account;
    }
    if (touch) account.last_seen = new Date(this.now()).toISOString();
    return account;
  }

  view(identity) {
    const account = this.account(identity);
    const { level, progress, next } = levelFor(account.xp);
    const active = Object.values(this.state.tiles).filter(tile => tile.owner === identity.key && tile.stage !== 'wild').length;
    return {
      id: publicId(account.key),
      user_id: account.user_id,
      temporary: account.provider === 'guest',
      signed_in: account.provider !== 'guest',
      provider: account.provider,
      display_name: account.display_name,
      credits: account.credits,
      xp: account.xp,
      level,
      level_progress: Number(progress.toFixed(3)),
      xp_next: next,
      seconds_played: account.seconds_played,
      time_credits: account.time_credits,
      inventory: { ...account.inventory },
      stats: { ...account.stats },
      plots_used: active,
      plots_limit: this.maxPlotsPerPlayer,
      profile: account.profile ? {
        avatar: account.profile.avatar || null,
        position: account.profile.position ? { ...account.profile.position } : null,
        saved_at: account.profile.saved_at || null,
      } : { avatar: null, position: null, saved_at: null },
      wallet: {
        address: account.wallet_links.find(link => link.primary)?.address || account.wallet_address,
        status: account.wallet_links.find(link => link.primary)?.verified_at ? 'verified' : account.wallet_status,
        links: account.wallet_links.map(link => ({ id: link.id, chain: link.chain, address: link.address, verified_at: link.verified_at, created_at: link.created_at, primary: link.primary })),
      },
      ledger: this.state.ledger.filter(event => event.owner === account.key).slice(-20).reverse().map(({ owner, ...event }) => event),
      payouts: this.state.payouts.filter(payout => payout.key === account.key).slice(-8).reverse().map(({ key, ...payout }) => payout),
    };
  }

  tiles(identityKey = null) {
    const now = this.now();
    return Object.values(this.state.tiles)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(tile => this.publicTile(tile, identityKey));
  }

  publicTile(tile, identityKey) {
    const now = this.now();
    const ready = tile.stage === 'growing' && tile.ready_at && tile.ready_at <= now;
    return {
      id: tile.id,
      position: { ...tile.position },
      stage: ready ? 'ready' : tile.stage,
      anchor: tile.anchor,
      crop: tile.crop,
      ready_at: tile.ready_at ? new Date(tile.ready_at).toISOString() : null,
      ready_in_ms: tile.ready_at ? Math.max(0, tile.ready_at - now) : 0,
      growth: tile.planted_at && tile.ready_at ? clamp((now - tile.planted_at) / Math.max(1, tile.ready_at - tile.planted_at), 0, 1) : 0,
      mine: Boolean(identityKey && tile.owner === identityKey),
    };
  }

  snapshot(identity) {
    const changed = this.tick();
    const account = identity ? this.view(identity) : null;
    return {
      mode: 'farm_v1',
      account,
      tiles: this.tiles(identity?.key || null),
      bazaar: { position: { ...BAZAAR.position }, radius: BAZAAR.radius, prices: Object.fromEntries(CROP_KINDS.map(kind => [kind, CROPS[kind].sell])) },
      crops: Object.fromEntries(CROP_KINDS.map(kind => [kind, {
        label: CROPS[kind].label,
        sell: CROPS[kind].sell,
        seed_cost: CROPS[kind].seedCost,
        xp: CROPS[kind].xp,
        unlock_level: CROPS[kind].unlockLevel,
        grow_ms: [this.growthDuration(kind), this.growthDuration(kind)],
        production_grow_ms: CROPS[kind].growMs,
      }])),
      rates: { credits_per_minute: this.creditsPerMinute, lamports_per_credit: this.lamportsPerCredit, min_withdrawal_credits: this.minWithdrawalCredits },
      server_time: new Date(this.now()).toISOString(),
      ...(changed ? { changed: true } : {}),
    };
  }

  requireTile(tileId) {
    const tile = this.state.tiles[String(tileId || '')];
    if (!tile) throw fail('PLOT_NOT_FOUND', 'That farm plot is gone', 404);
    return tile;
  }

  requireRange(position, target, radius = PLANT_RADIUS) {
    if (!position || distance(position, target) > radius) throw fail('TOO_FAR', 'Walk closer to the farm plot', 409);
  }

  activePlots(account) {
    return Object.values(this.state.tiles).filter(tile => tile.owner === account.key && tile.stage !== 'wild').length;
  }

  growthDuration(crop) { return Math.max(100, Math.round(CROPS[crop].growMs * this.timeScale)); }

  event(account, type, details) {
    const value = { id: `farm_${randomUUID()}`, owner: account.key, type, timestamp: new Date(this.now()).toISOString(), details };
    this.state.ledger.push(value);
    this.state.ledger = this.state.ledger.slice(-10_000);
    return value.id;
  }

  async command(identity, action, input, operation) {
    const supplied = input?.request_id;
    const requestId = supplied == null ? `server:${randomUUID()}` : String(supplied);
    if (!REQUEST_ID.test(requestId)) throw fail('INVALID_REQUEST_ID', 'Request ID must contain 8-96 safe characters');
    const key = `${identity.key}:${action}:${requestId}`;
    const stored = this.state.idempotency.find(value => value.key === key);
    if (stored) return structuredClone(stored.result);
    if (this.inflightCommands.has(key)) return structuredClone(await this.inflightCommands.get(key));
    const task = (async () => {
      const result = operation();
      this.state.idempotency.push({ key, owner: identity.key, action, request_id: requestId, timestamp: new Date(this.now()).toISOString(), result: structuredClone(result) });
      this.state.idempotency = this.state.idempotency.slice(-5_000);
      await this.persist();
      return result;
    })();
    this.inflightCommands.set(key, task);
    try { return structuredClone(await task); } finally { this.inflightCommands.delete(key); }
  }

  async plant(identity, input = {}, position) {
    const { tile_id, crop } = input;
    const account = this.account(identity);
    return this.command(identity, 'plant', input, () => {
      if (!CROP_KINDS.includes(crop)) throw fail('INVALID_CROP', 'Choose wheat, carrot or pumpkin');
      const tile = this.requireTile(tile_id);
      if (tile.stage !== 'wild') throw fail('PLOT_OCCUPIED', 'Someone is already farming this plot', 409);
      this.requireRange(position, tile.position);
      if (this.activePlots(account) >= this.maxPlotsPerPlayer) throw fail('PLOT_LIMIT', `You can tend ${this.maxPlotsPerPlayer} plots at once`, 409);
      const level = levelFor(account.xp).level;
      if (level < CROPS[crop].unlockLevel) throw fail('LEVEL_REQUIRED', `${CROPS[crop].label} unlocks at farming level ${CROPS[crop].unlockLevel}`, 409);
      if (account.credits < CROPS[crop].seedCost) throw fail('NOT_ENOUGH_CREDITS', `${CROPS[crop].label} seed costs ${CROPS[crop].seedCost} credits`, 409);
      const growMs = this.growthDuration(crop);
      const now = this.now();
      account.credits -= CROPS[crop].seedCost;
      Object.assign(tile, { stage: 'growing', crop, owner: account.key, planted_at: now, ready_at: now + growMs, spawned_at: now });
      account.stats.planted += 1;
      account.xp += CROPS[crop].plantXp;
      const event_id = this.event(account, 'crop_planted', {
        tile_id: tile.id, crop, planted_at: new Date(now).toISOString(),
        ready_at: new Date(tile.ready_at).toISOString(), seed_cost: CROPS[crop].seedCost,
      });
      return { tile: this.publicTile(tile, account.key), account: this.view(identity), grow_ms: growMs, event_id };
    });
  }

  async harvest(identity, input = {}, position) {
    const { tile_id } = input;
    const account = this.account(identity);
    return this.command(identity, 'harvest', input, () => {
      const tile = this.requireTile(tile_id);
      if (tile.stage === 'wild') throw fail('PLOT_EMPTY', 'This plot has not been planted');
      if (tile.owner !== account.key) throw fail('NOT_OWNER', 'This crop belongs to another farmer', 403);
      if (tile.stage !== 'ready' && tile.ready_at > this.now()) throw fail('CROP_NOT_READY', 'This crop is still growing', 409);
      this.requireRange(position, tile.position);
      const crop = tile.crop;
      const now = this.now();
      const harvestedAt = { ...tile.position };
      account.inventory[crop] = (account.inventory[crop] || 0) + 1;
      account.stats.harvested += 1;
      account.xp += CROPS[crop].xp;
      Object.assign(tile, { stage: 'wild', crop: null, owner: null, planted_at: null, ready_at: null, spawned_at: now });
      const anchor = this.chooseAnchor(tile.id, tile.anchor);
      tile.anchor = anchor.id;
      tile.position = this.positionFor(anchor);
      const event_id = this.event(account, 'crop_harvested', { tile_id: tile.id, crop, quantity: 1, position: harvestedAt });
      return { tile: this.publicTile(tile, account.key), account: this.view(identity), crop, quantity: 1, harvest_xp: CROPS[crop].xp, event_id };
    });
  }

  async sell(identity, input = {}, position) {
    const { crop, quantity = 1 } = input;
    const account = this.account(identity);
    return this.command(identity, 'sell', input, () => {
      if (!CROP_KINDS.includes(crop)) throw fail('INVALID_CROP', 'Unknown produce');
      if (!position || distance(position, BAZAAR.position) > BAZAAR.radius) throw fail('MARKET_REQUIRED', 'Carry produce to the bazaar stalls in the lower market', 409);
      const amount = Math.floor(Number(quantity));
      if (!Number.isInteger(amount) || amount < 1 || amount > 20) throw fail('INVALID_QUANTITY', 'Sell between 1 and 20 produce at a time');
      const held = account.inventory[crop] || 0;
      if (held < amount) throw fail('INVENTORY_TOO_LOW', `You only carry ${held} ${CROPS[crop].label.toLowerCase()}`, 409);
      const total = CROPS[crop].sell * amount;
      const creditsBefore = account.credits;
      account.inventory[crop] = held - amount;
      account.credits += total;
      account.stats.sold += amount;
      account.stats.credits_from_sales += total;
      account.xp += 15 * amount;
      const event_id = this.event(account, 'market_sale', {
        crop, quantity: amount, unit_price: CROPS[crop].sell, credits: total,
        credits_before: creditsBefore, credits_after: account.credits,
      });
      return { account: this.view(identity), sold: amount, crop, credits: total, event_id };
    });
  }

  /** Play time accrues credits; the client sends elapsed seconds, the server caps and audits them. */
  async heartbeat(identity, { seconds = 0 } = {}) {
    const account = this.account(identity);
    const elapsed = Math.floor(Number(seconds));
    if (!Number.isFinite(elapsed) || elapsed < 0) throw fail('INVALID_HEARTBEAT', 'Invalid play time');
    const accepted = clamp(elapsed, 0, 30);
    const before = Math.floor((account.seconds_played / 60) * this.creditsPerMinute);
    account.seconds_played += accepted;
    const after = Math.floor((account.seconds_played / 60) * this.creditsPerMinute);
    const earned = after - before;
    if (earned > 0) { account.credits += earned; account.time_credits += earned; }
    await this.persist();
    return { account: this.view(identity), accepted_seconds: accepted, credits_earned: earned };
  }

  async linkWallet(identity, { display_name } = {}) {
    const account = this.account(identity);
    if (display_name !== undefined) {
      const name = String(display_name).trim();
      if (!NICKNAME.test(name)) throw fail('INVALID_NAME', 'Name must be 2-24 letters, numbers, spaces, _ or -');
      account.display_name = name;
    }
    account.updated_at = new Date(this.now()).toISOString();
    await this.persist();
    return { account: this.view(identity) };
  }

  async createWalletChallenge(identity, { wallet_address, domain } = {}) {
    const account = this.account(identity);
    if (account.provider === 'guest') throw fail('SIGN_IN_REQUIRED', 'Sign in before linking a wallet', 403);
    const address = String(wallet_address || '').trim();
    if (!validSolanaAddress(address)) throw fail('INVALID_WALLET', 'Connect a valid public Solana wallet');
    const host = String(domain || '').toLowerCase();
    if (!/^[a-z0-9.-]+(?::\d{1,5})?$/.test(host)) throw fail('INVALID_DOMAIN', 'Wallet challenge domain is invalid');
    const now = this.now(), expires = now + WALLET_CHALLENGE_TTL_MS;
    const challenge = {
      id: `wch_${randomUUID()}`, user_id: account.user_id, account_key: account.key, address, domain: host,
      nonce: randomBytes(18).toString('base64url'), issued_at: new Date(now).toISOString(), expires_at: new Date(expires).toISOString(), consumed_at: null,
    };
    challenge.message = [
      'Last Seat wallet verification', `Domain: ${host}`, `Account: ${account.user_id}`, `Wallet: ${address}`,
      `Nonce: ${challenge.nonce}`, `Issued At: ${challenge.issued_at}`, `Expiration Time: ${challenge.expires_at}`,
      '', 'This request links a public wallet. It does not authorize a transaction.',
    ].join('\n');
    this.state.wallet_challenges.push(challenge);
    this.state.wallet_challenges = this.state.wallet_challenges.filter(value => !value.consumed_at && Date.parse(value.expires_at) > now - WALLET_CHALLENGE_TTL_MS).slice(-500);
    await this.persist();
    return { challenge: { id: challenge.id, address, message: challenge.message, issued_at: challenge.issued_at, expires_at: challenge.expires_at } };
  }

  async verifyWalletChallenge(identity, { challenge_id, wallet_address, signature } = {}, domain) {
    const account = this.account(identity);
    if (account.provider === 'guest') throw fail('SIGN_IN_REQUIRED', 'Sign in before linking a wallet', 403);
    const challenge = this.state.wallet_challenges.find(value => value.id === challenge_id);
    if (!challenge || challenge.account_key !== account.key || challenge.user_id !== account.user_id) throw fail('CHALLENGE_NOT_FOUND', 'Wallet challenge was not issued for this account', 404);
    if (challenge.consumed_at) throw fail('CHALLENGE_USED', 'Wallet challenge has already been used', 409);
    if (Date.parse(challenge.expires_at) <= this.now()) throw fail('CHALLENGE_EXPIRED', 'Wallet challenge expired', 409);
    if (challenge.domain !== String(domain || '').toLowerCase()) throw fail('CHALLENGE_DOMAIN_MISMATCH', 'Wallet challenge belongs to another domain', 403);
    if (challenge.address !== String(wallet_address || '')) throw fail('WALLET_MISMATCH', 'The signing wallet does not match the challenge', 403);
    if (!verifySolanaMessage(challenge.address, challenge.message, String(signature || ''))) throw fail('INVALID_SIGNATURE', 'Wallet signature could not be verified', 403);
    const linkedElsewhere = Object.values(this.state.accounts).some(value => value.key !== account.key && value.wallet_links?.some(link => link.chain === 'solana' && link.address === challenge.address && link.verified_at));
    if (linkedElsewhere) throw fail('WALLET_ALREADY_LINKED', 'That wallet is already verified by another account', 409);
    challenge.consumed_at = new Date(this.now()).toISOString();
    for (const link of account.wallet_links) link.primary = false;
    let link = account.wallet_links.find(value => value.chain === 'solana' && value.address === challenge.address);
    if (!link) {
      link = { id: `wal_${randomUUID()}`, user_id: account.user_id, chain: 'solana', address: challenge.address, verified_at: challenge.consumed_at, created_at: challenge.consumed_at, primary: true };
      account.wallet_links.push(link);
    } else Object.assign(link, { verified_at: challenge.consumed_at, primary: true });
    account.wallet_address = challenge.address;
    account.wallet_status = 'verified';
    account.updated_at = challenge.consumed_at;
    await this.persist();
    return { account: this.view(identity), wallet: { id: link.id, address: link.address, verified_at: link.verified_at, primary: true } };
  }

  /** A signed-in visitor keeps their character and plaza position across devices. */
  async saveProfile(identity, { avatar, position } = {}) {
    const account = this.account(identity);
    const profile = account.profile || { avatar: null, position: null, saved_at: null };
    if (avatar !== undefined) {
      if (!SAVED_AVATARS.includes(avatar)) throw fail('INVALID_AVATAR', 'That character is not available');
      profile.avatar = avatar;
    }
    if (position !== undefined) {
      const x = Number(position?.x), y = Number(position?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < WORLD_BOUNDS.minX || x > WORLD_BOUNDS.maxX || y < WORLD_BOUNDS.minY || y > WORLD_BOUNDS.maxY) {
        throw fail('INVALID_POSITION', 'That saved position is outside the world');
      }
      profile.position = { x: Math.round(x), y: Math.round(y) };
    }
    if (avatar === undefined && position === undefined) throw fail('EMPTY_PROFILE', 'Nothing to save');
    profile.saved_at = new Date(this.now()).toISOString();
    account.profile = profile;
    await this.persist();
    return { account: this.view(identity), saved: { ...profile, position: profile.position ? { ...profile.position } : null } };
  }

  async requestPayout(identity, { amount_credits } = {}) {
    const account = this.account(identity);
    if (account.provider === 'guest') throw fail('SIGN_IN_REQUIRED', 'Sign in before requesting a payout', 403);
    if (!this.payoutsEnabled) throw fail('PAYOUTS_DISABLED', 'Real payouts are disabled', 503);
    const wallet = account.wallet_links.find(link => link.primary && link.verified_at);
    if (!wallet) throw fail('VERIFIED_WALLET_REQUIRED', 'Verify a Solana wallet before requesting a payout', 409);
    const amount = Math.floor(Number(amount_credits || account.credits));
    if (!Number.isInteger(amount) || amount < this.minWithdrawalCredits) throw fail('PAYOUT_TOO_SMALL', `Withdraw at least ${this.minWithdrawalCredits} credits`, 409);
    if (amount > account.credits) throw fail('INSUFFICIENT_CREDITS', 'You do not have that many credits', 409);
    account.credits -= amount;
    const payout = {
      id: `payout_${randomUUID().slice(0, 8)}`,
      key: account.key,
      user_id: publicId(account.key),
      wallet_address: wallet.address,
      amount_credits: amount,
      amount_lamports: amount * this.lamportsPerCredit,
      status: 'queued',
      requested_at: new Date(this.now()).toISOString(),
      note: this.lamportsPerCredit > 0 ? 'Queued for the treasury signer' : 'Ledger only: no SOL rate configured',
    };
    this.state.payouts.push(payout);
    this.state.payouts = this.state.payouts.slice(-5_000);
    await this.persist();
    const { key, ...publicPayout } = payout;
    return { account: this.view(identity), payout: publicPayout };
  }

  /** A guest's progress follows them into the account they just signed into. */
  async adopt(visitorKey, identity) {
    const target = this.account(identity);
    const receiptKey = `${visitorKey}->${identity.key}`;
    if (this.state.merge_receipts.some(receipt => receipt.key === receiptKey)) return { account: this.view(identity), merged: false, already_merged: true };
    const guest = visitorKey && visitorKey !== identity.key ? this.state.accounts[visitorKey] : null;
    if (!guest) return { account: this.view(identity), merged: false };
    target.credits += guest.credits;
    target.xp += guest.xp;
    target.seconds_played += guest.seconds_played;
    target.time_credits += guest.time_credits;
    for (const kind of CROP_KINDS) target.inventory[kind] = (target.inventory[kind] || 0) + (guest.inventory[kind] || 0);
    for (const stat of Object.keys(target.stats)) target.stats[stat] += guest.stats[stat] || 0;
    for (const tile of Object.values(this.state.tiles)) if (tile.owner === visitorKey) tile.owner = identity.key;
    this.state.merge_receipts.push({ key: receiptKey, guest_key: visitorKey, account_key: identity.key, user_id: target.user_id, merged_at: new Date(this.now()).toISOString() });
    this.state.merge_receipts = this.state.merge_receipts.slice(-5_000);
    target.updated_at = new Date(this.now()).toISOString();
    delete this.state.accounts[visitorKey];
    await this.persist();
    return { account: this.view(identity), merged: true };
  }

  health() {
    return {
      status: 'ok',
      storage: this.store.mode,
      accounts: Object.keys(this.state.accounts).length,
      tiles: Object.keys(this.state.tiles).length,
      queued_payouts: this.state.payouts.filter(payout => payout.status === 'queued').length,
      payouts_enabled: this.payoutsEnabled,
    };
  }
}
