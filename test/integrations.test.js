import test from "node:test";
import assert from "node:assert/strict";
import { buildFeishuFeedNotification, clampThreshold, extractChatCompletionText, extractResponseText, feishuSignature, maskSecret, normalizeBatchMatchResults, normalizeMatchResult, validateFeishuWebhook } from "../lib/integrations.js";
import { isUnsupportedImageInputError } from "../lib/ai-compat.js";

test("extractResponseText supports raw Responses API output", () => {
  assert.equal(extractResponseText({ output: [{ content: [{ type: "output_text", text: "{\"matched\":true}" }] }] }), '{"matched":true}');
  assert.equal(extractChatCompletionText({ choices: [{ message: { content: '{"matched":true}' } }] }), '{"matched":true}');
});

test("normalizes match values and thresholds", () => {
  assert.deepEqual(normalizeMatchResult({ matchScore: 0.84, reason: "ok", evidence: ["a"] }), { matchScore: 0.84, legacyDecisionConfidence: null, reason: "ok", evidence: ["a"] });
  assert.deepEqual(normalizeMatchResult({ matched: "false", confidence: "95%", reason: "no", evidence: [] }), { matchScore: 0.050000000000000044, legacyDecisionConfidence: 0.95, reason: "no", evidence: [] });
  assert.deepEqual(normalizeMatchResult({ matched: 1, confidence: 80, reason: "yes", evidence: [] }), { matchScore: 0.8, legacyDecisionConfidence: 0.8, reason: "yes", evidence: [] });
  assert.throws(() => normalizeMatchResult({ matched: "not-a-boolean", confidence: 0.8 }), /缺少 matchScore/);
  assert.throws(() => normalizeMatchResult({ matchScore: "" }), /不是有效数字/);
  assert.equal(clampThreshold(-1), 0.1);
  assert.equal(clampThreshold("bad"), 0.72);
  assert.equal(clampThreshold(null, 0.72), 0.72);
  assert.equal(clampThreshold("", 0.8), 0.8);
});

test("normalizes provider-tolerant AI batch results by feed id", () => {
  const results = normalizeBatchMatchResults({ results: [
    { feedId: "101", matchScore: 0.91, reason: "命中", evidence: ["价格异常"] },
    { feed_id: 102, score: "35%", reason: "普通优惠", evidence: [] },
    { feedId: "not-requested", matchScore: 1, reason: "忽略", evidence: [] },
  ] }, ["101", "102"]);
  assert.equal(results.get("101").matchScore, 0.91);
  assert.equal(results.get("102").matchScore, 0.35);
  assert.equal(results.has("not-requested"), false);
});

test("masks credentials and validates Feishu V2 hooks", () => {
  assert.equal(maskSecret("sk-123456789"), "sk-1••••••••6789");
  assert.equal(validateFeishuWebhook("https://open.feishu.cn/open-apis/bot/v2/hook/TOKEN"), true);
  assert.equal(validateFeishuWebhook("https://example.com/open-apis/bot/v2/hook/TOKEN"), false);
  assert.match(feishuSignature("secret", "1700000000"), /^[A-Za-z0-9+/]+=*$/);
});

test("builds Feishu notifications with content, pictures and reason only", () => {
  const payload = buildFeishuFeedNotification({
    id: "12345",
    title: "Bug 价格商品",
    message: "<p>商品正文<br>到手价 1 元</p>",
    pictures: ["https://image.example/1.jpg", "https://image.example/2.jpg"],
    url: "https://www.coolapk.com/feed/12345",
    username: "author",
  }, {
    reason: "价格明显低于正常水平",
    matchScore: 0.99,
    threshold: 0.72,
    model: "MODEL",
  });
  assert.equal(payload.msg_type, "interactive");
  assert.equal(payload.card.header.title.content, "Bug 价格商品");
  assert.equal(payload.card.elements[0].text.content, "商品正文\n到手价 1 元");
  assert.deepEqual(payload.card.elements[1].actions[0].multi_url, {
    url: "https://www.coolapk.com/feed/12345",
    android_url: "coolmarket://feed/12345",
    ios_url: "https://www.coolapk.com/feed/12345",
    pc_url: "https://www.coolapk.com/feed/12345",
  });
  assert.equal(payload.card.elements[2].text.content, "[查看图片 1](https://image.example/1.jpg)　｜　[查看图片 2](https://image.example/2.jpg)");
  assert.equal(payload.card.elements[4].text.content, "**判断原因**\n价格明显低于正常水平");
  const serialized = JSON.stringify(payload);
  for (const hidden of ["author", "MODEL", "0.99", "0.72", "关注意图", "匹配度", "阈值"]) assert.equal(serialized.includes(hidden), false);
});

test("builds a fallback Coolapk app link from the feed id", () => {
  const payload = buildFeishuFeedNotification({ id: 67890, title: "标题", message: "正文" }, { reason: "原因" });
  const links = payload.card.elements[1].actions;
  assert.equal(links[0].multi_url.android_url, "coolmarket://feed/67890");
  assert.equal(links[0].multi_url.url, "https://www.coolapk.com/feed/67890");
  assert.equal(links[1].url, "https://www.coolapk.com/feed/67890");
});

test("detects providers that reject image message parts", () => {
  assert.equal(isUnsupportedImageInputError(new Error("messages[1]: unknown variant `image_url`, expected `text`")), true);
  assert.equal(isUnsupportedImageInputError(new Error("The model does not support image input")), true);
  assert.equal(isUnsupportedImageInputError(new Error("Model not found")), false);
});
