import test from "node:test";
import assert from "node:assert/strict";
import { clampThreshold, extractChatCompletionText, extractResponseText, feishuSignature, maskSecret, normalizeMatchResult, validateFeishuWebhook } from "../lib/integrations.js";
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

test("detects providers that reject image message parts", () => {
  assert.equal(isUnsupportedImageInputError(new Error("messages[1]: unknown variant `image_url`, expected `text`")), true);
  assert.equal(isUnsupportedImageInputError(new Error("The model does not support image input")), true);
  assert.equal(isUnsupportedImageInputError(new Error("Model not found")), false);
});
