import { createHmac, timingSafeEqual } from 'node:crypto';

const lifetimeSeconds = 30 * 24 * 60 * 60;
const cookieName = 'last_seat_host';

function signingSecret(env = process.env) {
  const value = env.HOST_SESSION_SECRET;
  if (value && value.length >= 32) return value;
  if (env.NODE_ENV === 'production') throw new Error('HOST_SESSION_SECRET must contain at least 32 characters in production.');
  return 'last-seat-local-development-host-token-only';
}

function signature(payload, env) {
  return createHmac('sha256', signingSecret(env)).update(`last-seat-host-v1:${payload}`).digest('base64url');
}

export function hostCookie(session, env = process.env, now = Date.now(), surface = 'matches') {
  if (!['matches', 'funded-matches'].includes(surface)) throw new Error('Unknown host session route');
  const expiry = Math.floor(now / 1000) + lifetimeSeconds;
  const payload = `${session}.${expiry}`;
  const secure = env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${cookieName}=${payload}.${signature(payload, env)}; Path=/api/${surface}/${session}/; HttpOnly; SameSite=Strict; Max-Age=${lifetimeSeconds}${secure}`;
}

export function hasHostCookie(req, session, env = process.env, now = Date.now()) {
  const raw = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`));
  if (!raw || raw.length > 256) return false;
  const value = raw.slice(cookieName.length + 1);
  const [id, expiry, mac, extra] = value.split('.');
  if (extra || id !== session || !/^\d{10}$/.test(expiry || '') || !mac) return false;
  const seconds = Number(expiry), current = Math.floor(now / 1000);
  if (seconds <= current || seconds > current + lifetimeSeconds) return false;
  const expected = Buffer.from(signature(`${id}.${expiry}`, env));
  const actual = Buffer.from(mac);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
