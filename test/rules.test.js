import test from "node:test";
import assert from "node:assert/strict";
import { chunkItems, matchFeedKeywords, normalizeKeywords, requiresNotification } from "../lib/rules.js";

test("normalizes and deduplicates rule keywords", () => {
  assert.deepEqual(normalizeKeywords(" Bug价，免费\nBUG价;  0元 "), ["Bug价", "免费", "0元"]);
});

test("matches topic rules against feed title, body and topic", () => {
  const result = matchFeedKeywords({ title: "限时免费", message: "出现 Bug价 商品", topic: "优惠情报" }, ["bug价", "0元", "免费"]);
  assert.equal(result.matched, true);
  assert.deepEqual(result.matchedKeywords, ["bug价", "免费"]);
  assert.equal(matchFeedKeywords({ title: "普通优惠" }, ["免费"]).matched, false);
});

test("chunks AI work into bounded request batches", () => {
  assert.deepEqual(chunkItems([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.equal(chunkItems(Array.from({ length: 25 }), 99).length, 2);
});

test("keeps matched but unsent records pending for topic notifications", () => {
  const topic = { ai: { notify: true } };
  assert.equal(requiresNotification({ status: "completed", matched: true, notified: false, deliveryPending: true }, topic, true), true);
  assert.equal(requiresNotification({ status: "completed", matched: true, notified: false }, topic, true), false);
  assert.equal(requiresNotification({ status: "completed", matched: true, notified: true }, topic, true), false);
  assert.equal(requiresNotification({ status: "completed", matched: false, notified: false }, topic, true), false);
  assert.equal(requiresNotification({ status: "completed", matched: true, notified: false, deliveryPending: true }, topic, false), false);
});
