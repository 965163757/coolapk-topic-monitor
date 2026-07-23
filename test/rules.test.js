import test from "node:test";
import assert from "node:assert/strict";
import { aiRuleInstructions, chunkItems, matchFeedKeywords, normalizeKeywords, normalizeRuleMode, requiresNotification } from "../lib/rules.js";

test("normalizes and deduplicates rule keywords", () => {
  assert.deepEqual(normalizeKeywords(" Bug价，免费\nBUG价;  0元 "), ["Bug价", "免费", "0元"]);
});

test("keeps keyword and AI rule modes mutually exclusive", () => {
  assert.equal(normalizeRuleMode("keyword", { enabled: true, intent: "AI 条件" }), "keyword");
  assert.equal(normalizeRuleMode("ai", { keywords: ["免费"] }), "ai");
  assert.equal(normalizeRuleMode(undefined, { keywords: ["免费"] }), "keyword");
  assert.equal(normalizeRuleMode(undefined, { enabled: true, intent: "AI 条件", keywords: ["免费"] }), "ai");
});

test("builds an exclusion-first AI instruction", () => {
  const prompt = aiRuleInstructions({ intent: "Bug 价或高价值免费物品", exclude: "暗广、询问、小额优惠券" });
  assert.match(prompt, /需要关注：Bug 价/);
  assert.match(prompt, /明确排除：暗广/);
  assert.match(prompt, /排除项优先级最高/);
  assert.match(prompt, /不高于 0\.1/);
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
