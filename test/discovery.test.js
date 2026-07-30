import test from "node:test";
import assert from "node:assert/strict";
import { discoveryRequest, normalizeDiscoveryMode } from "../lib/discovery.js";

test("uses the supported ranking page for hot discovery feeds", () => {
  const request = discoveryRequest("hot", 1);
  assert.deepEqual(
    { path: request.path, params: request.params, sort: request.sort },
    {
      path: "/page/dataList",
      params: { url: "V9_HOME_TAB_RANKING", page: 1 },
      sort: "popular",
    },
  );
  assert.equal(request.cacheKey, "discovery:hot:1");
  assert.equal(request.ttlMs, 120_000);
  assert.ok(request.staleMs > request.ttlMs);
});

test("keeps recent discovery on the live recent-feed endpoint", () => {
  const request = discoveryRequest("recent", 3);
  assert.equal(request.path, "/topic/recentFeedList");
  assert.deepEqual(request.params, { page: 3 });
  assert.equal(request.sort, "dateline_desc");
  assert.equal(request.cacheKey, "discovery:recent:3");
});

test("normalizes discovery mode and page before building upstream and cache keys", () => {
  assert.equal(normalizeDiscoveryMode("unexpected"), "recent");
  assert.equal(discoveryRequest("unexpected", "not-a-page").page, 1);
  assert.equal(discoveryRequest("hot", 999).page, 50);
  assert.equal(discoveryRequest("hot", -4).page, 1);
});
