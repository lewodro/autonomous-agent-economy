import test from 'node:test';
import assert from 'node:assert/strict';
import { hostCookie, hasHostCookie } from '../service/host-auth.js';

const env = { NODE_ENV: 'production', HOST_SESSION_SECRET: 'test-secret-that-is-long-enough-for-hmac' };
const id = 'cafefeed-0000-4000-8000-111111111111';

test('host cookie is bound to one match, secret, and expiry', () => {
  const now = 1_791_000_000_000;
  const cookie = hostCookie(id, env, now);
  assert.ok(cookie.includes(`; Path=/api/matches/${id}/`),'free match access remains scoped to its route');
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  assert.match(cookie, /; Secure$/);
  const request = { headers: { cookie: cookie.split(';')[0] } };
  assert.equal(hasHostCookie(request, id, env, now), true);
  assert.equal(hasHostCookie(request, id, env, now + 30 * 24 * 60 * 60 * 1000), false,'host cookie is invalid at its exact expiry second');
  assert.equal(hasHostCookie(request, '00000000-0000-4000-8000-000000000000', env, now), false);
  assert.equal(hasHostCookie(request, id, { ...env, HOST_SESSION_SECRET: 'another-secret-that-is-long-enough' }, now), false);
  assert.equal(hasHostCookie(request, id, env, now + 31 * 24 * 60 * 60 * 1000), false);
  const forged = { headers: { cookie: request.headers.cookie.slice(0, -1) + 'X' } };
  assert.equal(hasHostCookie(forged, id, env, now), false);
});

test('funded match host cookies reach funded routes without replacing other match capabilities',()=>{
  const now=1_791_000_000_000;
  const freeId=id,fundedId='cafefeed-0000-4000-8000-222222222222';
  const free=hostCookie(freeId,env,now),funded=hostCookie(fundedId,env,now,'funded-matches');
  assert.ok(funded.includes(`; Path=/api/funded-matches/${fundedId}/`));
  assert.notEqual(free.split(';')[0],funded.split(';')[0],'distinct matches retain distinct capabilities');
  assert.equal(hasHostCookie({headers:{cookie:funded.split(';')[0]}},fundedId,env,now),true);
  assert.throws(()=>hostCookie(fundedId,env,now,'untrusted-path'),/Unknown host session route/);
});
