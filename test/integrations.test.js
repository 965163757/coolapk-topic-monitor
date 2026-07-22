import test from "node:test";
import assert from "node:assert/strict";
import { buildFeishuFeedPost, clampThreshold, extractChatCompletionText, extractResponseText, feishuSignature, maskSecret, normalizeMatchResult, validateFeishuWebhook } from "../lib/integrations.js";
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

test("masks credentials and validates Feishu V2 hooks", () => {
  assert.equal(maskSecret("sk-123456789"), "sk-1••••••••6789");
  assert.equal(validateFeishuWebhook("https://open.feishu.cn/open-apis/bot/v2/hook/TOKEN"), true);
  assert.equal(validateFeishuWebhook("https://example.com/open-apis/bot/v2/hook/TOKEN"), false);
  assert.match(feishuSignature("secret", "1700000000"), /^[A-Za-z0-9+/]+=*$/);
});

test("builds Feishu notifications with content, pictures and reason only", () => {
  const payload = buildFeishuFeedPost({
    title: "Bug 价格商品",
    message: "<p>商品正文<br>到手价 1 元</p>",
    pictures: ["https://image.example/1.jpg", "https://image.example/2.jpg"],
    username: "author",
  }, {
    reason: "价格明显低于正常水平",
    matchScore: 0.99,
    threshold: 0.72,
    model: "MODEL",
  });
  assert.equal(payload.msg_type, "post");
  assert.equal(payload.content.post.zh_cn.title, "Bug 价格商品");
  assert.deepEqual(payload.content.post.zh_cn.content, [
    [{ tag: "text", text: "商品正文\n到手价 1 元\n" }],
    [{ tag: "a", text: "查看图片 1", href: "https://image.example/1.jpg" }],
    [{ tag: "a", text: "查看图片 2", href: "https://image.example/2.jpg" }],
    [{ tag: "text", text: "\n判断原因：价格明显低于正常水平" }],
  ]);
  const serialized = JSON.stringify(payload);
  for (const hidden of ["author", "MODEL", "0.99", "0.72", "关注意图", "匹配度", "阈值"]) assert.equal(serialized.includes(hidden), false);
});

test("detects providers that reject image message parts", () => {
  assert.equal(isUnsupportedImageInputError(new Error("messages[1]: unknown variant `image_url`, expected `text`")), true);
  assert.equal(isUnsupportedImageInputError(new Error("The model does not support image input")), true);
  assert.equal(isUnsupportedImageInputError(new Error("Model not found")), false);
});
