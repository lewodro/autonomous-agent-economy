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

/** Bounded per-key limiter for a single-process public service. */
export class KeyedSlidingWindowLimiter {
  constructor({limit,windowMs,maxKeys=10_000}){
    if(!Number.isSafeInteger(maxKeys)||maxKeys<1)throw new Error('Invalid keyed rate-limit capacity');
    this.limit=limit;this.windowMs=windowMs;this.maxKeys=maxKeys;this.buckets=new Map();this.calls=0;
    // Reuse the same validation as the non-keyed limiter.
    new SlidingWindowLimiter({limit,windowMs});
  }
  allow(key,now=Date.now()){
    const normalized=typeof key==='string'&&key.length>0?key.slice(0,256):'unknown';
    let bucket=this.buckets.get(normalized);
    if(!bucket){
      if(this.buckets.size>=this.maxKeys){
        const oldest=this.buckets.keys().next().value;this.buckets.delete(oldest);
      }
      bucket={limiter:new SlidingWindowLimiter({limit:this.limit,windowMs:this.windowMs}),lastSeen:now};
    }else this.buckets.delete(normalized);
    bucket.lastSeen=now;this.buckets.set(normalized,bucket);
    if(++this.calls%256===0){
      const cutoff=now-this.windowMs;
      for(const [id,value] of this.buckets)if(value.lastSeen<=cutoff)this.buckets.delete(id);
    }
    return bucket.limiter.allow(now);
  }
}
