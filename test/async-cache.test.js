import test from "node:test";
import assert from "node:assert/strict";
import { AsyncTtlCache } from "../lib/async-cache.js";

test("deduplicates concurrent cache loads and serves fresh values", async () => {
  let now = 1_000;
  let calls = 0;
  const cache = new AsyncTtlCache({ now: () => now });
  const loader = async () => {
    calls += 1;
    await Promise.resolve();
    return { calls };
  };
  const [first, second] = await Promise.all([
    cache.get("home:1", loader),
    cache.get("home:1", loader),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.equal(cache.status("home:1"), "fresh");
  assert.equal(cache.status("missing"), "miss");
  now += 500;
  assert.deepEqual(await cache.get("home:1", loader), first);
  assert.equal(calls, 1);
  assert.deepEqual(cache.stats(), {
    hits: 1,
    staleHits: 0,
    misses: 1,
    refreshes: 0,
    coalesced: 1,
    entries: 1,
    fresh: 1,
    stale: 0,
    pending: 0,
  });
});

test("returns stale data immediately while refreshing in the background", async () => {
  let now = 1_000;
  let calls = 0;
  let release;
  const cache = new AsyncTtlCache({ now: () => now });
  const first = await cache.get("topics:1", async () => ++calls, { ttlMs: 1_000, staleMs: 5_000 });
  assert.equal(first, 1);
  now = 2_500;
  const stale = await cache.get("topics:1", () => new Promise((resolve) => {
    calls += 1;
    release = () => resolve(calls);
  }), { ttlMs: 1_000, staleMs: 5_000 });
  assert.equal(stale, 1);
  assert.equal(calls, 2);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await cache.get("topics:1", async () => ++calls, { ttlMs: 1_000, staleMs: 5_000 }), 2);
});

test("supports explicit refresh and prefix invalidation", async () => {
  let calls = 0;
  const cache = new AsyncTtlCache();
  const loader = async () => ++calls;
  assert.equal(await cache.get("page:a:1", loader), 1);
  assert.equal(await cache.get("page:a:1", loader, { refresh: true }), 2);
  await cache.get("page:b:1", loader);
  cache.clear("page:a:");
  assert.equal(await cache.get("page:a:1", loader), 4);
});
