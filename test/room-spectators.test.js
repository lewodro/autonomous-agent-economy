import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSpectators } from '../service/room-spectators.js';

test('room spectators are explicit, capability-scoped, reconnectable, and expiring', () => {
  let now=1_000;const service=new RoomSpectators({now:()=>now,ttlMs:5_000,minHeartbeatMs:1_000});
  const first=service.join('rps-1',{});
  assert.equal(first.spectators,1);
  assert.match(first.spectator_id,/^viewer_[a-f0-9-]{36}$/);
  assert.throws(()=>service.join('rps-1',{spectator_id:first.spectator_id}),{code:'SPECTATOR_NOT_AUTHORIZED'});
  assert.throws(()=>service.join('rps-1',{spectator_id:'viewer-a',spectator_token:'guessed'}),{code:'SPECTATOR_NOT_FOUND'});
  assert.equal(service.join('rps-1',{spectator_id:first.spectator_id,spectator_token:first.spectator_token}).spectators,1);
  assert.throws(()=>service.heartbeat('rps-1',{spectator_id:first.spectator_id,spectator_token:'wrong'}),{code:'SPECTATOR_NOT_AUTHORIZED'});
  service.heartbeat('rps-1',{spectator_id:first.spectator_id,spectator_token:first.spectator_token});
  assert.throws(()=>service.heartbeat('rps-1',{spectator_id:first.spectator_id,spectator_token:first.spectator_token}),{code:'PRESENCE_RATE_LIMITED'});
  now+=1_000;assert.equal(service.heartbeat('rps-1',{spectator_id:first.spectator_id,spectator_token:first.spectator_token}).spectators,1);
  assert.equal(service.leave('rps-1',{spectator_id:first.spectator_id,spectator_token:first.spectator_token}).spectators,0);
  const second=service.join('ttt-1',{});assert.equal(second.spectators,1);
  now+=5_000;assert.equal(service.count('ttt-1'),0);
  assert.throws(()=>service.heartbeat('ttt-1',{spectator_id:second.spectator_id,spectator_token:second.spectator_token}),{code:'SPECTATOR_NOT_FOUND'});
});

test('room and global viewer limits are enforced after stale leases are pruned', () => {
  const service=new RoomSpectators({maxPerRoom:1,maxTotal:2,ttlMs:2_000});
  const first=service.join('rps-1',{});
  assert.throws(()=>service.join('rps-1',{}),{code:'SPECTATOR_CAPACITY'});
  service.join('ttt-1',{});
  assert.throws(()=>service.join('ttt-2',{}),{code:'SPECTATOR_CAPACITY'});
  service.rooms.get('rps-1').get(first.spectator_id).lastSeenAt=Date.now()-3_000;
  assert.equal(service.join('ttt-2',{}).spectators,1);
});
