import test from 'node:test';
import assert from 'node:assert/strict';
import { hostCookie, hasHostCookie } from '../service/host-auth.js';

const env = { NODE_ENV: 'production', HOST_SESSION_SECRET: 'test-secret-that-is-long-enough-for-hmac' };
const id = 'cafefeed-0000-4000-8000-111111111111';

test('host cookie is bound to one match, secret, and expiry', () => {
  const now = 1_791_000_000_000;
  const cookie = hostCookie(id, env, now);
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  assert.match(cookie, /; Secure$/);
  const request = { headers: { cookie: cookie.split(';')[0] } };
  assert.equal(hasHostCookie(request, id, env, now), true);
  assert.equal(hasHostCookie(request, '00000000-0000-4000-8000-000000000000', env, now), false);
  assert.equal(hasHostCookie(request, id, { ...env, HOST_SESSION_SECRET: 'another-secret-that-is-long-enough' }, now), false);
  assert.equal(hasHostCookie(request, id, env, now + 31 * 24 * 60 * 60 * 1000), false);
  const forged = { headers: { cookie: request.headers.cookie.slice(0, -1) + 'X' } };
  assert.equal(hasHostCookie(forged, id, env, now), false);
});
