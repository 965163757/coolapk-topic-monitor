export class AsyncTtlCache {
  constructor({ maxEntries = 256, now = () => Date.now() } = {}) {
    this.maxEntries = Math.max(8, Number(maxEntries) || 256);
    this.now = now;
    this.entries = new Map();
    this.metrics = { hits: 0, staleHits: 0, misses: 0, refreshes: 0, coalesced: 0 };
  }

  clear(prefix = "") {
    if (!prefix) {
      this.entries.clear();
      return;
    }
    for (const key of this.entries.keys()) {
      if (String(key).startsWith(prefix)) this.entries.delete(key);
    }
  }

  async get(key, loader, { ttlMs = 60_000, staleMs = 300_000, refresh = false } = {}) {
    const cacheKey = String(key);
    const now = this.now();
    let entry = this.entries.get(cacheKey);
    if (entry) entry.lastAccess = now;

    if (!refresh && entry?.value !== undefined && now < entry.expiresAt) {
      this.metrics.hits += 1;
      return entry.value;
    }
    if (!refresh && entry?.value !== undefined && now < entry.staleAt) {
      this.metrics.staleHits += 1;
      if (!entry.pending) {
        this.metrics.refreshes += 1;
        this.#load(cacheKey, loader, ttlMs, staleMs, entry).catch(() => {});
      }
      return entry.value;
    }
    if (entry?.pending) {
      this.metrics.coalesced += 1;
      return entry.pending;
    }
    if (refresh) this.metrics.refreshes += 1;
    else this.metrics.misses += 1;
    return this.#load(cacheKey, loader, ttlMs, staleMs, entry);
  }

  stats() {
    const now = this.now();
    let fresh = 0;
    let stale = 0;
    let pending = 0;
    for (const entry of this.entries.values()) {
      if (entry.pending) pending += 1;
      if (entry.value === undefined) continue;
      if (now < entry.expiresAt) fresh += 1;
      else if (now < entry.staleAt) stale += 1;
    }
    return { ...this.metrics, entries: this.entries.size, fresh, stale, pending };
  }

  status(key) {
    const entry = this.entries.get(String(key));
    if (!entry) return "miss";
    if (entry.pending && entry.value === undefined) return "pending";
    const now = this.now();
    if (entry.value !== undefined && now < entry.expiresAt) return "fresh";
    if (entry.value !== undefined && now < entry.staleAt) return "stale";
    return entry.pending ? "pending" : "expired";
  }

  #load(key, loader, ttlMs, staleMs, previous) {
    const entry = previous || { value: undefined, expiresAt: 0, staleAt: 0, lastAccess: this.now(), pending: null };
    const pending = Promise.resolve()
      .then(loader)
      .then((value) => {
        const loadedAt = this.now();
        entry.value = value;
        entry.expiresAt = loadedAt + Math.max(1_000, Number(ttlMs) || 60_000);
        entry.staleAt = entry.expiresAt + Math.max(0, Number(staleMs) || 0);
        entry.lastAccess = loadedAt;
        return value;
      })
      .finally(() => {
        entry.pending = null;
        this.#prune();
      });
    entry.pending = pending;
    this.entries.set(key, entry);
    return pending;
  }

  #prune() {
    if (this.entries.size <= this.maxEntries) return;
    const removable = [...this.entries.entries()]
      .filter(([, entry]) => !entry.pending)
      .sort((left, right) => left[1].lastAccess - right[1].lastAccess);
    while (this.entries.size > this.maxEntries && removable.length) {
      this.entries.delete(removable.shift()[0]);
    }
  }
}
