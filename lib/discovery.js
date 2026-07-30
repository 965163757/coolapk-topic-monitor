const DISCOVERY_SOURCES = Object.freeze({
  recent: Object.freeze({
    path: "/topic/recentFeedList",
    params: Object.freeze({}),
    sort: "dateline_desc",
    ttlMs: 30_000,
    staleMs: 5 * 60_000,
  }),
  hot: Object.freeze({
    // /v6/topic/hotFeedList was retired: it now responds with an empty
    // text/plain body. The ranking page is the current source used by Coolapk.
    path: "/page/dataList",
    params: Object.freeze({ url: "V9_HOME_TAB_RANKING" }),
    sort: "popular",
    ttlMs: 2 * 60_000,
    staleMs: 10 * 60_000,
  }),
});

export function normalizeDiscoveryMode(value) {
  return value === "hot" ? "hot" : "recent";
}

export function discoveryRequest(value, page = 1) {
  const mode = normalizeDiscoveryMode(value);
  const source = DISCOVERY_SOURCES[mode];
  const normalizedPage = Math.max(1, Math.min(50, Math.trunc(Number(page)) || 1));
  return {
    mode,
    page: normalizedPage,
    path: source.path,
    params: { ...source.params, page: normalizedPage },
    sort: source.sort,
    cacheKey: `discovery:${mode}:${normalizedPage}`,
    ttlMs: source.ttlMs,
    staleMs: source.staleMs,
  };
}
