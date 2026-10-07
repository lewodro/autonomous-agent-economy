import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyedSlidingWindowLimiter, SlidingWindowLimiter } from '../service/rate-limit.js';

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

test('keyed limits are independent and expire for each visitor',()=>{
 const limiter=new KeyedSlidingWindowLimiter({limit:2,windowMs:1000});
 assert.equal(limiter.allow('visitor-a',1000),true);assert.equal(limiter.allow('visitor-a',1100),true);assert.equal(limiter.allow('visitor-a',1200),false);
 assert.equal(limiter.allow('visitor-b',1200),true);
 assert.equal(limiter.allow('visitor-a',2000),true);
});

test('keyed limiter remains bounded and evicts the least recently active key',()=>{
 const limiter=new KeyedSlidingWindowLimiter({limit:1,windowMs:1000,maxKeys:2});
 limiter.allow('a',1000);limiter.allow('b',1000);limiter.allow('a',1001);limiter.allow('c',1002);
 assert.equal(limiter.buckets.size,2);assert.equal(limiter.buckets.has('b'),false);assert.equal(limiter.allow('c',1003),false);
});
