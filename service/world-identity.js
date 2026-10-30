import { createHmac, createPublicKey, timingSafeEqual, verify as verifySignature } from 'node:crypto';

const cookieName = 'aae_account';
const lifetimeSeconds = 30 * 24 * 60 * 60;
const accountKeyPattern = /^clerk:[A-Za-z0-9_-]{1,128}$/;

function signingSecret(env = process.env) {
  const value = env.HOST_SESSION_SECRET;
  if (value && value.length >= 32) return value;
  if (env.NODE_ENV === 'production') throw new Error('HOST_SESSION_SECRET must contain at least 32 characters in production.');
  return 'local-world-account-session-key-only';
}

function signature(payload, env) {
  return createHmac('sha256', signingSecret(env)).update(`aae-account-v1:${payload}`).digest('base64url');
}

export function accountCookie(accountKey, env = process.env, now = Date.now()) {
  if (!accountKeyPattern.test(accountKey)) throw new Error('Invalid account key');
  const expiry = Math.floor(now / 1000) + lifetimeSeconds;
  const payload = `${Buffer.from(accountKey).toString('base64url')}.${expiry}`;
  const secure = env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${cookieName}=${payload}.${signature(payload, env)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${lifetimeSeconds}${secure}`;
}

export function clearAccountCookie(env = process.env) {
  const secure = env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

/** Reads only the server-signed account cookie. A cookie is never trusted for identity on its own. */
export function accountSession(req, env = process.env, now = Date.now()) {
  const raw = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`));
  if (!raw || raw.length > 256) return null;
  const value = raw.slice(cookieName.length + 1);
  const [encoded, expiry, mac, extra] = value.split('.');
  if (extra || !encoded || !/^\d{10}$/.test(expiry || '') || !mac) return null;
  const seconds = Number(expiry), current = Math.floor(now / 1000);
  if (seconds < current || seconds > current + lifetimeSeconds) return null;
  const payload = `${encoded}.${expiry}`;
  const expected = Buffer.from(signature(payload, env));
  const actual = Buffer.from(mac);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  let key;
  try { key = Buffer.from(encoded, 'base64url').toString('utf8'); } catch { return null; }
  return accountKeyPattern.test(key) ? key : null;
}

/** Clerk publishable keys embed the frontend API host as base64 after the pk_ prefix. */
export function clerkFrontendApi(publishableKey) {
  if (typeof publishableKey !== 'string') return null;
  const match = publishableKey.match(/^pk_(?:test|live)_(.+)$/);
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8').replace(/\$$/, '');
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(decoded) ? decoded : null;
  } catch { return null; }
}

function decodePart(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

/**
 * Verifies a Clerk session token with Clerk's public JWKS. No secret key and no
 * npm dependency are required; the token signature is checked with node:crypto.
 * Results are cached briefly so a page load does not fetch keys per request.
 */
export function createClerkVerifier({ publishableKey, fetcher = fetch, now = Date.now, keyTtlMs = 60 * 60_000 } = {}) {
  const frontendApi = clerkFrontendApi(publishableKey);
  const expectedIssuer = frontendApi ? `https://${frontendApi}` : null;
  let keys = null, fetchedAt = 0, pending = null;

  async function loadKeys() {
    if (keys && now() - fetchedAt < keyTtlMs) return keys;
    if (pending) return pending;
    pending = (async () => {
      const response = await fetcher(`${expectedIssuer}/.well-known/jwks.json`, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error('Clerk key endpoint rejected the request');
      const body = await response.json();
      if (!Array.isArray(body.keys)) throw new Error('Clerk key endpoint returned no keys');
      keys = body.keys;
      fetchedAt = now();
      return keys;
    })().finally(() => { pending = null; });
    return pending;
  }

  async function verify(token) {
    if (!frontendApi) throw new Error('Clerk is not configured');
    if (typeof token !== 'string' || token.length > 8_192) throw new Error('Invalid session token');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid session token');
    const [headerPart, payloadPart, signaturePart] = parts;
    const header = decodePart(headerPart);
    const payload = decodePart(payloadPart);
    if (header.alg !== 'RS256') throw new Error('Unsupported token algorithm');
    if (payload.iss !== expectedIssuer) throw new Error('Token issuer mismatch');
    const seconds = Math.floor(now() / 1000);
    if (!Number.isFinite(payload.exp) || payload.exp < seconds - 30) throw new Error('Session token expired');
    if (Number.isFinite(payload.nbf) && payload.nbf > seconds + 30) throw new Error('Session token not yet valid');
    if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('Session token has no subject');
    const candidates = (await loadKeys()).filter(key => !header.kid || key.kid === header.kid);
    if (!candidates.length) throw new Error('No matching Clerk signing key');
    const signed = Buffer.from(`${headerPart}.${payloadPart}`);
    const rawSignature = Buffer.from(signaturePart, 'base64url');
    const valid = candidates.some(jwk => {
      try { return verifySignature('RSA-SHA256', signed, createPublicKey({ key: jwk, format: 'jwk' }), rawSignature); } catch { return false; }
    });
    if (!valid) throw new Error('Invalid session token signature');
    return {
      key: `clerk:${payload.sub}`,
      subject: payload.sub,
      name: typeof payload.name === 'string' ? payload.name : '',
      email: typeof payload.email === 'string' ? payload.email : '',
    };
  }

  return { configured: Boolean(frontendApi), frontendApi, publishableKey: publishableKey || null, verify };
}
