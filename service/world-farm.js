import { createHash, randomUUID } from 'node:crypto';
import { validSolanaAddress } from './world-economy.js';

const VERSION = 1;
const NICKNAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{1,23}$/;
/** Kept in sync with the curated browser avatar catalog. */
export const SAVED_AVATARS = Object.freeze(['visitor_ember', 'visitor_atlas', 'visitor_nova', 'visitor_echo']);
/** Same walkable bounds the browser uses, so a saved instance cannot be restored inside the void. */
const WORLD_BOUNDS = Object.freeze({ minX: -896, minY: -576, maxX: 2688, maxY: 1728 });
const GROW_MS = { wheat: [60_000, 110_000], carrot: [60_000, 95_000], pumpkin: [75_000, 120_000] };
export const CROPS = Object.freeze({
  wheat: { label: 'Wheat', sell: 6, xp: 12, grow: GROW_MS.wheat },
  carrot: { label: 'Carrot', sell: 5, xp: 10, grow: GROW_MS.carrot },
  pumpkin: { label: 'Pumpkin', sell: 9, xp: 18, grow: GROW_MS.pumpkin },
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
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

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
    provider: identity.provider || 'guest',
    subject: identity.subject || null,
    display_name: identity.name || `Farmer ${suffix}`,
    wallet_address: null,
    wallet_status: 'unlinked',
    credits: 0,
    xp: 0,
    seconds_played: 0,
    time_credits: 0,
    inventory: { wheat: 0, carrot: 0, pumpkin: 0 },
    stats: { planted: 0, harvested: 0, sold: 0, credits_from_sales: 0 },
    profile: { avatar: null, position: null, saved_at: null },
    created_at: new Date(now).toISOString(),
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
  } = {}) {
    if (!Number.isInteger(creditsPerMinute) || creditsPerMinute < 0 || creditsPerMinute > 60) throw new Error('Invalid creditsPerMinute');
    if (!Number.isSafeInteger(lamportsPerCredit) || lamportsPerCredit < 0) throw new Error('Invalid lamportsPerCredit');
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
    this.state = { version: VERSION, accounts: {}, tiles: {}, payouts: [], migrated_at: null, next_spawn_at: null };
    this.timer = null;
  }

  async restore() {
    const saved = await this.store.load();
    if (saved) {
      if (saved.version !== VERSION || typeof saved.accounts !== 'object' || typeof saved.tiles !== 'object' || !Array.isArray(saved.payouts)) {
        throw new Error('Invalid world farm checkpoint');
      }
      this.state = saved;
    }
    for (const key of Object.keys(this.state.accounts)) {
      const account = this.state.accounts[key];
      account.inventory ||= { wheat: 0, carrot: 0, pumpkin: 0 };
      account.stats ||= { planted: 0, harvested: 0, sold: 0, credits_from_sales: 0 };
      account.seconds_played ||= 0;
      account.time_credits ||= 0;
      account.xp ||= 0;
      account.credits ||= 0;
      account.profile ||= { avatar: null, position: null, saved_at: null };
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
      wallet: { address: account.wallet_address, status: account.wallet_status },
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
      crops: Object.fromEntries(CROP_KINDS.map(kind => [kind, { label: CROPS[kind].label, sell: CROPS[kind].sell, xp: CROPS[kind].xp, grow_ms: CROPS[kind].grow }])),
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
    if (!position || distance(position, target) > radius) throw fail('OUT_OF_RANGE', 'Walk closer to the farm plot', 409);
  }

  activePlots(account) {
    return Object.values(this.state.tiles).filter(tile => tile.owner === account.key && tile.stage !== 'wild').length;
  }

  async plant(identity, { tile_id, crop } = {}, position) {
    const account = this.account(identity);
    if (!CROP_KINDS.includes(crop)) throw fail('INVALID_CROP', 'Choose wheat, carrot or pumpkin');
    const tile = this.requireTile(tile_id);
    if (tile.stage !== 'wild') throw fail('PLOT_TAKEN', 'Someone is already farming this plot', 409);
    this.requireRange(position, tile.position);
    if (this.activePlots(account) >= this.maxPlotsPerPlayer) throw fail('PLOT_LIMIT', `You can tend ${this.maxPlotsPerPlayer} plots at once`, 409);
    const [min, max] = CROPS[crop].grow;
    const growMs = Math.round(min + this.random() * (max - min));
    const now = this.now();
    tile.stage = 'growing';
    tile.crop = crop;
    tile.owner = account.key;
    tile.planted_at = now;
    tile.ready_at = now + growMs;
    tile.spawned_at = now;
    account.stats.planted += 1;
    account.xp += 6;
    await this.persist();
    return { tile: this.publicTile(tile, account.key), account: this.view(identity), grow_ms: growMs };
  }

  async harvest(identity, { tile_id } = {}, position) {
    const account = this.account(identity);
    const tile = this.requireTile(tile_id);
    if (tile.stage === 'wild') throw fail('PLOT_EMPTY', 'This plot has not been planted');
    if (tile.owner !== account.key) throw fail('NOT_YOUR_PLOT', 'This crop belongs to another farmer', 403);
    if (tile.stage !== 'ready' && tile.ready_at > this.now()) throw fail('CROP_GROWING', 'This crop is still growing', 409);
    this.requireRange(position, tile.position);
    const crop = tile.crop;
    const now = this.now();
    account.inventory[crop] = (account.inventory[crop] || 0) + 1;
    account.stats.harvested += 1;
    account.xp += CROPS[crop].xp;
    tile.stage = 'wild';
    tile.crop = null;
    tile.owner = null;
    tile.planted_at = null;
    tile.ready_at = null;
    tile.spawned_at = now;
    const anchor = this.chooseAnchor(tile.id, tile.anchor);
    tile.anchor = anchor.id;
    tile.position = this.positionFor(anchor);
    await this.persist();
    return { tile: this.publicTile(tile, account.key), account: this.view(identity), crop, harvest_xp: CROPS[crop].xp };
  }

  async sell(identity, { crop, quantity = 1 } = {}, position) {
    const account = this.account(identity);
    if (!CROP_KINDS.includes(crop)) throw fail('INVALID_CROP', 'Unknown produce');
    if (!position || distance(position, BAZAAR.position) > BAZAAR.radius) throw fail('BAZAAR_OUT_OF_RANGE', 'Carry produce to the bazaar stalls in the lower market', 409);
    const amount = Math.floor(Number(quantity));
    if (!Number.isInteger(amount) || amount < 1 || amount > 20) throw fail('INVALID_QUANTITY', 'Sell between 1 and 20 produce at a time');
    const held = account.inventory[crop] || 0;
    if (held < amount) throw fail('NOT_ENOUGH_PRODUCE', `You only carry ${held} ${CROPS[crop].label.toLowerCase()}`, 409);
    const total = CROPS[crop].sell * amount;
    account.inventory[crop] = held - amount;
    account.credits += total;
    account.stats.sold += amount;
    account.stats.credits_from_sales += total;
    account.xp += 15 * amount;
    await this.persist();
    return { account: this.view(identity), sold: amount, crop, credits: total };
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

  async linkWallet(identity, { wallet_address, display_name } = {}) {
    const account = this.account(identity);
    const wallet = wallet_address == null || wallet_address === '' ? null : String(wallet_address).trim();
    if (wallet && !validSolanaAddress(wallet)) throw fail('INVALID_WALLET', 'Enter a valid public Solana wallet address');
    if (display_name !== undefined) {
      const name = String(display_name).trim();
      if (!NICKNAME.test(name)) throw fail('INVALID_NAME', 'Name must be 2-24 letters, numbers, spaces, _ or -');
      account.display_name = name;
    }
    account.wallet_address = wallet;
    account.wallet_status = wallet ? 'self_declared' : 'unlinked';
    await this.persist();
    return { account: this.view(identity) };
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
    if (!account.wallet_address) throw fail('WALLET_REQUIRED', 'Link a public Solana wallet before requesting a payout', 409);
    const amount = Math.floor(Number(amount_credits || account.credits));
    if (!Number.isInteger(amount) || amount < this.minWithdrawalCredits) throw fail('PAYOUT_TOO_SMALL', `Withdraw at least ${this.minWithdrawalCredits} credits`, 409);
    if (amount > account.credits) throw fail('INSUFFICIENT_CREDITS', 'You do not have that many credits', 409);
    account.credits -= amount;
    const payout = {
      id: `payout_${randomUUID().slice(0, 8)}`,
      key: account.key,
      user_id: publicId(account.key),
      wallet_address: account.wallet_address,
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
    const guest = visitorKey && visitorKey !== identity.key ? this.state.accounts[visitorKey] : null;
    if (!guest) return { account: this.view(identity), merged: false };
    target.credits += guest.credits;
    target.xp += guest.xp;
    target.seconds_played += guest.seconds_played;
    target.time_credits += guest.time_credits;
    for (const kind of CROP_KINDS) target.inventory[kind] = (target.inventory[kind] || 0) + (guest.inventory[kind] || 0);
    for (const stat of Object.keys(target.stats)) target.stats[stat] += guest.stats[stat] || 0;
    for (const tile of Object.values(this.state.tiles)) if (tile.owner === visitorKey) tile.owner = identity.key;
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
      payouts_enabled: false,
    };
  }
}
