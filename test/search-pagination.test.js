import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchPageMeta,
  normalizeSearchPage,
  searchFallbackPageWindow,
  searchPagePolicy,
} from "../lib/search-pagination.js";

test("normalizes search pages before applying first-page-only supplements", () => {
  assert.equal(normalizeSearchPage("not-a-page"), 1);
  assert.equal(normalizeSearchPage(-8), 1);
  assert.equal(normalizeSearchPage(999), 50);
  assert.deepEqual(searchPagePolicy("not-a-page"), {
    page: 1,
    includeFirstPageSupplements: true,
    includeTopics: true,
  });
  assert.deepEqual(searchPagePolicy(2), {
    page: 2,
    includeFirstPageSupplements: false,
    includeTopics: false,
  });
});

test("assigns non-overlapping fallback upstream windows to consecutive search pages", () => {
  const first = searchFallbackPageWindow(1);
  const second = searchFallbackPageWindow(2);
  assert.deepEqual(first.pages, [1, 2, 3]);
  assert.deepEqual(second.pages, [4, 5, 6]);
  assert.equal(first.endPage < second.startPage, true);
  assert.equal(new Set([...first.pages, ...second.pages]).size, 6);
});

test("supports custom fallback window sizes without reusing upstream pages", () => {
  assert.deepEqual(searchFallbackPageWindow(1, { startPage: 4, windowSize: 2 }).pages, [4, 5]);
  assert.deepEqual(searchFallbackPageWindow(2, { startPage: 4, windowSize: 2 }).pages, [6, 7]);
});

test("builds normalized page metadata and infers whether another page may exist", () => {
  assert.deepEqual(buildSearchPageMeta("bad", {
    results: Array.from({ length: 7 }),
    continuationPageSize: 20,
  }), {
    page: 1,
    count: 7,
    hasMore: false,
  });
  assert.deepEqual(buildSearchPageMeta(2, {
    resultCount: 35,
    continuationCount: 20,
    continuationPageSize: 20,
  }), {
    page: 2,
    count: 35,
    hasMore: true,
  });
  assert.equal(buildSearchPageMeta(3, {
    resultCount: 40,
    continuationCount: 40,
    hasMore: false,
  }).hasMore, false);
});
