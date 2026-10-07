import { randomUUID, timingSafeEqual } from 'node:crypto';

const IDENTIFIER = /^[a-zA-Z0-9_-]{1,64}$/;
const DIRECTIONS = new Set(['up', 'down', 'left', 'right']);
const ANIMATIONS = new Set(['idle', 'walk']);

function fail(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function equalSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left || ''), b = Buffer.from(right || '');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/**
 * Ephemeral, server-authoritative enough presence for the public plaza.
 * It intentionally stores no movement history and owns no game state.
 */
export class WorldPresenceService {
  constructor({ worldIds = ['main'], bounds = { width: 1040, height: 864 }, maxPlayers = 40, maxViewers = 100, staleMs = 45_000, minUpdateMs = 66, minHeartbeatMs = 1_000, now = () => Date.now() } = {}) {
    if (!Array.isArray(worldIds) || !worldIds.length || worldIds.some(id => typeof id !== 'string' || !IDENTIFIER.test(id)) || new Set(worldIds).size !== worldIds.length) {
      throw new Error('World presence requires unique, valid configured world IDs');
    }
    this.allowedWorlds = new Set(worldIds);
    this.bounds = bounds; this.maxPlayers = maxPlayers; this.maxViewers = maxViewers; this.staleMs = staleMs;
    this.minUpdateMs = minUpdateMs; this.minHeartbeatMs = minHeartbeatMs; this.now = now;
    this.worlds = new Map(); this.listeners = new Map();
  }
  world(worldId) {
    if (typeof worldId !== 'string' || !this.allowedWorlds.has(worldId)) throw fail('WORLD_NOT_FOUND', 'Unknown world', 404);
    let world = this.worlds.get(worldId);
    if (!world) { world = new Map(); this.worlds.set(worldId, world); }
    return world;
  }
  snapshot(worldId) { this.prune(worldId); return { world_id: worldId, players: [...this.world(worldId).values()].map(({ token, lastUpdateAt, lastMoveAt, lastHeartbeatAt, ...player }) => player) }; }
  sanitizePosition(position) {
    const x = position?.x, y = position?.y;
    if (typeof x !== 'number' || typeof y !== 'number') throw fail('INVALID_POSITION', 'Position coordinates must be numbers');
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > this.bounds.width || y > this.bounds.height) {
      throw fail('INVALID_POSITION', 'Position is outside the world bounds');
    }
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  }
  sanitizeAvatar(avatar) {
    if (avatar == null) return 'explorer';
    if (typeof avatar !== 'string' || !IDENTIFIER.test(avatar)) throw fail('INVALID_AVATAR', 'Avatar is invalid');
    return avatar;
  }
  publicPlayer(player) { const { token, lastUpdateAt, lastMoveAt, lastHeartbeatAt, ...value } = player; return value; }
  emit(worldId, type, payload) {
    const event = { type, world_id: worldId, ...payload };
    for (const res of this.listeners.get(worldId) || []) {
      if (res.destroyed || res.writableLength > 1_000_000) { res.destroy(); continue; }
      try { res.write(`event: ${type}\ndata: ${JSON.stringify(event)}\n\n`); } catch { res.destroy(); }
    }
  }
  join(worldId, input = {}) {
    const world = this.world(worldId); this.prune(worldId);
    if(input.player_id!==undefined&&(typeof input.player_id!=='string'||!IDENTIFIER.test(input.player_id)))throw fail('INVALID_PLAYER','Player identity is invalid');
    const id = input.player_id || `player_${randomUUID()}`;
    const existing = world.get(id);
    if (existing && !equalSecret(existing.token, input.session_token)) {
      throw fail('PRESENCE_NOT_AUTHORIZED', 'Player identity is already active', 403);
    }
    if (!existing && world.size >= this.maxPlayers) throw fail('WORLD_FULL', 'This world is full', 429);
    // A reconnect may refresh public metadata, but only movement commands can change position.
    const position = existing ? existing.position : this.sanitizePosition(input.position || { x: 160, y: 180 });
    const now = this.now();
    const player = {
      player_id: id, avatar: input.avatar===undefined&&existing?existing.avatar:this.sanitizeAvatar(input.avatar), position,
      direction: DIRECTIONS.has(input.direction) ? input.direction : existing?.direction||'down',
      animation_state: 'idle', activity: typeof input.activity === 'string' ? input.activity.slice(0, 80) : existing?.activity||'Exploring',
      updated_at: new Date(now).toISOString(), token: existing?.token || randomUUID(), lastUpdateAt: now,
      lastMoveAt: existing?.lastMoveAt ?? existing?.lastUpdateAt ?? now,
      lastHeartbeatAt: existing?.lastHeartbeatAt ?? now - this.minHeartbeatMs
    };
    world.set(id, player);
    this.emit(worldId, existing ? 'PlayerUpdated' : 'PlayerJoined', { player: this.publicPlayer(player) });
    return { ...this.snapshot(worldId), player: this.publicPlayer(player), session_token: player.token };
  }
  requirePlayer(worldId, playerId, token) {
    if (!IDENTIFIER.test(playerId || '')) throw fail('INVALID_PLAYER', 'Player identity is invalid');
    const player = this.world(worldId).get(playerId);
    if (!player) throw fail('PLAYER_NOT_FOUND', 'Player session has expired', 404);
    if (!equalSecret(player.token, token)) throw fail('PRESENCE_NOT_AUTHORIZED', 'Player session is not authorized', 403);
    return player;
  }
  move(worldId, { player_id, session_token, position, direction, animation_state }) {
    const player = this.requirePlayer(worldId, player_id, session_token), now = this.now();
    if (now - player.lastMoveAt < this.minUpdateMs) throw fail('PRESENCE_RATE_LIMITED', 'Move updates are limited', 429);
    const next = this.sanitizePosition(position);
    const elapsed = Math.max(1, now - player.lastMoveAt);
    const distance = Math.hypot(next.x - player.position.x, next.y - player.position.y);
    if (distance > Math.max(24, elapsed * 0.32)) throw fail('INVALID_POSITION', 'Movement exceeded the world speed limit');
    player.position = next; player.direction = DIRECTIONS.has(direction) ? direction : player.direction;
    player.animation_state = ANIMATIONS.has(animation_state) ? animation_state : 'idle'; player.lastUpdateAt = now;player.lastMoveAt=now;player.updated_at = new Date(now).toISOString();
    this.emit(worldId, 'PlayerMoved', { player: this.publicPlayer(player) });
    return { player: this.publicPlayer(player) };
  }
  heartbeat(worldId, { player_id, session_token, activity }) {
    const player = this.requirePlayer(worldId, player_id, session_token), now = this.now();
    if (now - player.lastHeartbeatAt < this.minHeartbeatMs) throw fail('PRESENCE_RATE_LIMITED', 'Heartbeat updates are limited', 429);
    if (activity !== undefined) {
      if (typeof activity !== 'string' || activity.length > 80) throw fail('INVALID_ACTIVITY', 'Activity is invalid');
    }
    const activityChanged = activity !== undefined && activity !== player.activity;
    if (activityChanged) player.activity = activity;
    player.lastHeartbeatAt = now;
    player.lastUpdateAt = now; player.updated_at = new Date(now).toISOString();
    if (activityChanged) this.emit(worldId, 'PlayerUpdated', { player: this.publicPlayer(player) });
    return { player: this.publicPlayer(player) };
  }
  leave(worldId, { player_id, session_token }) {
    const player = this.requirePlayer(worldId, player_id, session_token); this.world(worldId).delete(player.player_id);
    this.emit(worldId, 'PlayerLeft', { player_id: player.player_id }); return { left: true };
  }
  prune(worldId) {
    const world = this.world(worldId), cutoff = this.now() - this.staleMs;
    for (const player of world.values()) if (player.lastUpdateAt <= cutoff) { world.delete(player.player_id); this.emit(worldId, 'PlayerLeft', { player_id: player.player_id, reason: 'stale' }); }
  }
  connect(worldId, res) {
    this.prune(worldId); const group = this.listeners.get(worldId) || new Set();
    if (group.size >= this.maxViewers) return false;
    this.listeners.set(worldId, group); group.add(res);
    let closed = false; const cleanup = () => { if (closed) return; closed = true; clearInterval(heartbeat); group.delete(res); if (!group.size) this.listeners.delete(worldId); };
    const heartbeat = setInterval(() => { this.prune(worldId); if (res.destroyed || res.writableLength > 1_000_000) return res.destroy(); try { res.write(': keepalive\n\n'); } catch { res.destroy(); } }, 15_000); heartbeat.unref();
    res.on('close', cleanup); res.on('error', cleanup);
    try {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`event: WorldJoined\ndata: ${JSON.stringify(this.snapshot(worldId))}\n\n`);
    } catch {
      cleanup();
      try { res.destroy(); } catch { /* response is already gone */ }
    }
    return true;
  }
  health() {
    for (const worldId of this.allowedWorlds) this.prune(worldId);
    let activePlayers = 0, eventStreams = 0;
    for (const worldId of this.allowedWorlds) {
      activePlayers += this.worlds.get(worldId)?.size || 0;
      eventStreams += this.listeners.get(worldId)?.size || 0;
    }
    return {
      status: 'ok', mode: 'single_process_ephemeral', configured_worlds: this.allowedWorlds.size,
      active_players: activePlayers, event_streams: eventStreams,
      limits: { players_per_world: this.maxPlayers, event_streams_per_world: this.maxViewers }
    };
  }
  close() { for (const listeners of this.listeners.values()) for (const res of listeners) res.destroy(); this.listeners.clear(); this.worlds.clear(); }
}
