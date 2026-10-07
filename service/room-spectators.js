import { randomUUID, timingSafeEqual } from 'node:crypto';

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const failure = (code, message, status = 400) => Object.assign(new Error(message), { code, status });

function sameToken(left, right) {
  const a = Buffer.from(typeof left === 'string' ? left : '');
  const b = Buffer.from(typeof right === 'string' ? right : '');
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

/** Ephemeral room viewer leases. Joining never creates or advances an arena match. */
export class RoomSpectators {
  constructor({ maxPerRoom = 100, maxTotal = 500, ttlMs = 45_000, minHeartbeatMs = 1_000, now = () => Date.now() } = {}) {
    this.maxPerRoom = maxPerRoom; this.maxTotal = maxTotal; this.ttlMs = ttlMs;
    this.minHeartbeatMs = minHeartbeatMs; this.now = now; this.rooms = new Map();
  }

  prune(roomId) {
    const now = this.now();
    const pruneRoom = (id, viewers) => {
      for (const [viewerId, viewer] of viewers) if (viewer.lastSeenAt <= now - this.ttlMs) viewers.delete(viewerId);
      if (!viewers.size) this.rooms.delete(id);
    };
    if (roomId) pruneRoom(roomId, this.rooms.get(roomId) || new Map());
    else for (const [id, viewers] of this.rooms) pruneRoom(id, viewers);
  }

  count(roomId) {
    this.prune(roomId);
    return this.rooms.get(roomId)?.size || 0;
  }

  join(roomId, { spectator_id, spectator_token } = {}) {
    if (!ID.test(roomId)) throw failure('ROOM_NOT_FOUND', 'Arena room was not found', 404);
    if (spectator_id !== undefined && (typeof spectator_id !== 'string' || !ID.test(spectator_id))) {
      throw failure('INVALID_SPECTATOR', 'Spectator identity is invalid');
    }
    if (spectator_id === undefined && spectator_token !== undefined) {
      throw failure('INVALID_SPECTATOR', 'A spectator token requires its server-assigned identity');
    }
    this.prune();
    const viewerId = spectator_id || `viewer_${randomUUID()}`;
    let viewers = this.rooms.get(roomId);
    const existing = viewers?.get(viewerId);
    if (spectator_id !== undefined && !existing) {
      throw failure('SPECTATOR_NOT_FOUND', 'Spectator session has expired', 404);
    }
    if (spectator_id !== undefined && spectator_token === undefined) {
      throw failure('SPECTATOR_NOT_AUTHORIZED', 'Reconnecting requires the spectator token', 403);
    }
    if (existing && !sameToken(existing.token, spectator_token)) {
      throw failure('SPECTATOR_NOT_AUTHORIZED', 'Spectator identity is already active', 403);
    }
    if (!existing && this.total() >= this.maxTotal) throw failure('SPECTATOR_CAPACITY', 'Arena spectator capacity is full', 429);
    if (!existing && (viewers?.size || 0) >= this.maxPerRoom) throw failure('SPECTATOR_CAPACITY', 'This room has reached its spectator limit', 429);
    if (!viewers) { viewers = new Map(); this.rooms.set(roomId, viewers); }
    const now = this.now();
    const viewer = { id: viewerId, token: existing?.token || randomUUID(), lastSeenAt: now, lastHeartbeatAt: existing?.lastHeartbeatAt ?? now - this.minHeartbeatMs };
    viewers.set(viewerId, viewer);
    return { room_id: roomId, spectator_id: viewerId, spectator_token: viewer.token, spectators: viewers.size };
  }

  heartbeat(roomId, { spectator_id, spectator_token }) {
    const viewer = this.require(roomId, spectator_id, spectator_token);
    const now = this.now();
    if (now - viewer.lastHeartbeatAt < this.minHeartbeatMs) throw failure('PRESENCE_RATE_LIMITED', 'Spectator heartbeat is limited', 429);
    viewer.lastSeenAt = now; viewer.lastHeartbeatAt = now;
    return { room_id: roomId, spectators: this.count(roomId) };
  }

  leave(roomId, { spectator_id, spectator_token }) {
    const viewer = this.require(roomId, spectator_id, spectator_token);
    this.rooms.get(roomId).delete(viewer.id);
    if (!this.rooms.get(roomId).size) this.rooms.delete(roomId);
    return { room_id: roomId, left: true, spectators: this.count(roomId) };
  }

  require(roomId, spectatorId, token) {
    if (!ID.test(roomId) || !ID.test(spectatorId || '')) throw failure('INVALID_SPECTATOR', 'Spectator identity is invalid');
    this.prune(roomId);
    const viewer = this.rooms.get(roomId)?.get(spectatorId);
    if (!viewer) throw failure('SPECTATOR_NOT_FOUND', 'Spectator session has expired', 404);
    if (!sameToken(viewer.token, token)) throw failure('SPECTATOR_NOT_AUTHORIZED', 'Spectator session is not authorized', 403);
    return viewer;
  }

  total() {
    let total = 0;
    for (const viewers of this.rooms.values()) total += viewers.size;
    return total;
  }

  close() { this.rooms.clear(); }
}
