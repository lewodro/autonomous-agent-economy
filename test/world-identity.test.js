import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createPublicKey, sign } from 'node:crypto';
import { accountCookie, accountSession, clearAccountCookie, clerkFrontendApi, createClerkVerifier } from '../service/world-identity.js';

const env = { HOST_SESSION_SECRET: 'test-secret-that-is-long-enough-for-signing-1234' };
const host = 'clerk.example.com';
const publishableKey = `pk_test_${Buffer.from(host).toString('base64')}`;
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...createPublicKey(privateKey).export({ format: 'jwk' }), kid: 'key-1' };

function token(overrides = {}, kid = 'key-1') {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: `https://${host}`,
    sub: 'user_123',
    exp: Math.floor(Date.now() / 1000) + 600,
    name: 'Miro',
    ...overrides,
  })).toString('base64url');
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

function verifier(options = {}) {
  return createClerkVerifier({
    publishableKey,
    fetcher: async url => ({
      ok: url === `https://${host}/.well-known/jwks.json`,
      json: async () => ({ keys: [jwk] }),
    }),
    ...options,
  });
}

test('publishable keys resolve the Clerk frontend host', () => {
  assert.equal(clerkFrontendApi(publishableKey), host);
  assert.equal(clerkFrontendApi('pk_live_' + Buffer.from('lastseat.clerk.accounts.dev').toString('base64')), 'lastseat.clerk.accounts.dev');
  assert.equal(clerkFrontendApi('sk_test_nope'), null);
  assert.equal(clerkFrontendApi(null), null);
});

test('a Clerk session token is verified against the published JWKS', async () => {
  const result = await verifier().verify(token());
  assert.equal(result.key, 'clerk:user_123');
  assert.equal(result.subject, 'user_123');
  assert.equal(result.name, 'Miro');
});

test('tokens with the wrong issuer, expiry or signature are rejected', async () => {
  const check = verifier();
  await assert.rejects(() => check.verify(token({ iss: 'https://evil.example.com' })), /issuer/);
  await assert.rejects(() => check.verify(token({ exp: 1 })), /expired/);
  await assert.rejects(() => check.verify(`${token().slice(0, -4)}AAAA`), /signature/);
  await assert.rejects(() => check.verify('not-a-token'), /Invalid/);
  await assert.rejects(() => verifier({ publishableKey: null }).verify(token()), /not configured/);
});

test('signed account cookies round-trip and reject tampering', () => {
  const stamp = 1_700_000_000_000;
  const cookie = accountCookie('clerk:user_123', env, stamp);
  const request = { headers: { cookie: cookie.split(';')[0] } };
  assert.equal(accountSession(request, env, stamp), 'clerk:user_123');
  assert.equal(accountSession({ headers: { cookie: `${cookie.split(';')[0]}x` } }, env, stamp), null);
  assert.equal(accountSession(request, env, stamp + 31 * 24 * 60 * 60 * 1000), null);
  assert.match(clearAccountCookie(env), /Max-Age=0/);
});
