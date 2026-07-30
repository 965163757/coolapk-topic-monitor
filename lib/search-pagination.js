export const DEFAULT_SEARCH_PAGE_LIMIT = 50;
export const DEFAULT_FALLBACK_WINDOW_SIZE = 3;

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(maximum, Math.trunc(parsed)));
}

function nonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

export function normalizeSearchPage(value, { maxPage = DEFAULT_SEARCH_PAGE_LIMIT } = {}) {
  const maximum = positiveInteger(maxPage, DEFAULT_SEARCH_PAGE_LIMIT);
  return positiveInteger(value, 1, maximum);
}

export function searchPagePolicy(value, options = {}) {
  const page = normalizeSearchPage(value, options);
  const firstPage = page === 1;
  return {
    page,
    includeFirstPageSupplements: firstPage,
    includeTopics: firstPage,
  };
}

export function searchFallbackPageWindow(value, {
  windowSize = DEFAULT_FALLBACK_WINDOW_SIZE,
  startPage = 1,
  maxPage = DEFAULT_SEARCH_PAGE_LIMIT,
} = {}) {
  const page = normalizeSearchPage(value, { maxPage });
  const size = positiveInteger(windowSize, DEFAULT_FALLBACK_WINDOW_SIZE, 50);
  const first = positiveInteger(startPage, 1) + ((page - 1) * size);
  const pages = Array.from({ length: size }, (_, index) => first + index);
  return {
    page,
    windowSize: size,
    startPage: first,
    endPage: pages.at(-1),
    pages,
  };
}

export function buildSearchPageMeta(value, {
  results,
  resultCount,
  continuationCount,
  continuationPageSize = 20,
  hasMore,
  maxPage = DEFAULT_SEARCH_PAGE_LIMIT,
} = {}) {
  const page = normalizeSearchPage(value, { maxPage });
  const count = Array.isArray(results)
    ? results.length
    : nonNegativeInteger(resultCount);
  const continuation = continuationCount == null
    ? count
    : nonNegativeInteger(continuationCount);
  const expectedPageSize = positiveInteger(continuationPageSize, 20, 10_000);
  return {
    page,
    count,
    hasMore: typeof hasMore === "boolean" ? hasMore : continuation >= expectedPageSize,
  };
}
