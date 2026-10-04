/** Small single-process admission guard. Multi-replica deployments need a shared limiter. */
export class SlidingWindowLimiter {
  constructor({ limit, windowMs }) {
    if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1000) throw new Error('Invalid rate-limit policy');
    this.limit = limit; this.windowMs = windowMs; this.hits = [];
  }
  allow(now = Date.now()) {
    const cutoff = now - this.windowMs;
    while (this.hits[0] !== undefined && this.hits[0] <= cutoff) this.hits.shift();
    if (this.hits.length >= this.limit) return false;
    this.hits.push(now); return true;
  }
}
