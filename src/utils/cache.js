class SimpleCache {
  constructor(defaultTtlMs = 300000) {
    this.cache = new Map();
    this.defaultTtl = defaultTtlMs;
    this._cleanupInterval = setInterval(() => this._cleanup(), 60000);
    this._cleanupInterval.unref();
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expireAt) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  set(key, value, ttlMs) {
    this.cache.set(key, {
      value,
      expireAt: Date.now() + (ttlMs || this.defaultTtl)
    });
  }

  // Get from cache, or compute, set, and return
  async getOrSet(key, fn, ttlMs) {
    const cached = this.get(key);
    if (cached !== null) return cached;

    const value = await fn();
    this.set(key, value, ttlMs);
    return value;
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }

  _cleanup() {
    const now = Date.now();
    for (const [key, item] of this.cache) {
      if (now > item.expireAt) this.cache.delete(key);
    }
  }

  destroy() {
    clearInterval(this._cleanupInterval);
    this.cache.clear();
  }
}

module.exports = new SimpleCache(300000);
