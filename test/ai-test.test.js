import test from "node:test";
import assert from "node:assert/strict";
import {
  aiConnectionTestBodies,
  mergeAiTestConfig,
  normalizeAiTestBaseUrl,
  redactAiTestError,
  redactAiTestText,
} from "../lib/ai-connection.js";

const saved = Object.freeze({
  baseUrl: "https://saved.example/v1",
  apiKey: "SAVED_KEY",
  model: "saved-model",
  provider: "auto",
  apiMode: "auto",
  reasoningEffort: "low",
});

test("temporarily merges a direct AI form payload without mutating saved settings", () => {
  const result = mergeAiTestConfig(saved, {
    baseUrl: "https://current.example/v1/",
    apiKey: "CURRENT_KEY",
    model: "current-model",
    provider: "openai",
    apiMode: "chat_completions",
    reasoningEffort: "medium",
  });
  assert.deepEqual(result, {
    baseUrl: "https://current.example/v1",
    apiKey: "CURRENT_KEY",
    model: "current-model",
    provider: "openai",
    apiMode: "chat_completions",
    reasoningEffort: "medium",
  });
  assert.equal(saved.apiKey, "SAVED_KEY");
  assert.equal(saved.model, "saved-model");
});

test("accepts { ai } payloads and preserves the current secret when the form key is blank", () => {
  const result = mergeAiTestConfig(saved, {
    ai: {
      baseUrl: "http://127.0.0.1:8080/v1",
      apiKey: "   ",
      model: "draft-model",
      apiMode: "responses",
    },
  });
  assert.equal(result.baseUrl, "http://127.0.0.1:8080/v1");
  assert.equal(result.apiKey, "SAVED_KEY");
  assert.equal(result.model, "draft-model");
  assert.equal(result.apiMode, "responses");
});

test("rejects unsafe temporary AI endpoints and invalid protocol selectors", () => {
  assert.throws(() => normalizeAiTestBaseUrl("http://public.example/v1"), /必须使用 HTTPS/);
  assert.throws(() => mergeAiTestConfig(saved, { apiMode: "legacy" }), /接口协议配置无效/);
  assert.throws(() => mergeAiTestConfig(saved, { provider: "other" }), /服务商配置无效/);
});

test("builds text-only connection probes for every supported AI family", () => {
  const bodies = aiConnectionTestBodies({ model: "MODEL" });
  assert.equal(bodies.responses.input, "只回复：连接成功");
  assert.equal(bodies.chat_completions.messages[0].content, "只回复：连接成功");
  assert.equal(bodies.anthropic_messages.messages[0].content, "只回复：连接成功");
  assert.equal(bodies.gemini_generate_content.contents[0].parts[0].text, "只回复：连接成功");
  const serialized = JSON.stringify(bodies);
  for (const unsupportedPart of ["image_url", "input_image", "inline_data"]) {
    assert.equal(serialized.includes(unsupportedPart), false);
  }
});

test("redacts a temporary API key from provider errors", () => {
  const error = Object.assign(new Error("upstream echoed sk-temporary-secret"), { statusCode: 502 });
  const sanitized = redactAiTestError(error, "sk-temporary-secret");
  assert.equal(sanitized.message, "upstream echoed [REDACTED]");
  assert.equal(sanitized.statusCode, 502);
  assert.equal(redactAiTestText("connected with sk-temporary-secret", "sk-temporary-secret"), "connected with [REDACTED]");
});
