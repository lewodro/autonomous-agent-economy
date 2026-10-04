import test from 'node:test';
import assert from 'node:assert/strict';
import { SlidingWindowLimiter } from '../service/rate-limit.js';

test('creation limiter admits a bounded window and recovers after expiry', () => {
  const limiter = new SlidingWindowLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(limiter.allow(1000), true);
  assert.equal(limiter.allow(1100), true);
  assert.equal(limiter.allow(1200), false);
  assert.equal(limiter.allow(2000), true);
  assert.equal(limiter.allow(2001), false);
});

test('creation limiter rejects nonsensical policies', () => {
  assert.throws(() => new SlidingWindowLimiter({ limit: 0, windowMs: 1000 }));
  assert.throws(() => new SlidingWindowLimiter({ limit: 1, windowMs: 1 }));
});
