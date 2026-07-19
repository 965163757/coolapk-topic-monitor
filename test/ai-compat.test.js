import test from "node:test";
import assert from "node:assert/strict";
import { aiEndpoint, dataUrlParts, extractAiText, inferAiProvider, parseAiJson, preferredAiApiModes, requestBodyVariants } from "../lib/ai-compat.js";

test("detects OpenAI, Anthropic and Gemini API families", () => {
  assert.equal(inferAiProvider({ baseUrl: "https://api.openai.com/v1", model: "gpt-5.6" }), "openai");
  assert.equal(inferAiProvider({ baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet" }), "anthropic");
  assert.equal(inferAiProvider({ baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-flash" }), "gemini");
  assert.deepEqual(preferredAiApiModes({ baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet", apiMode: "auto" }), ["anthropic_messages"]);
  assert.deepEqual(preferredAiApiModes({ baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-flash", apiMode: "auto" }), ["gemini_generate_content"]);
});

test("builds provider-specific endpoints and extracts results", () => {
  assert.equal(aiEndpoint({ baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet" }, "anthropic_messages"), "https://api.anthropic.com/v1/messages");
  assert.equal(aiEndpoint({ baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "models/gemini-2.5-flash" }, "gemini_generate_content"), "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
  assert.equal(extractAiText({ content: [{ type: "text", text: "{\"matched\":true}" }] }, "anthropic_messages"), "{\"matched\":true}");
  assert.equal(extractAiText({ candidates: [{ content: { parts: [{ text: "{\"matched\":false}" }] } }] }, "gemini_generate_content"), "{\"matched\":false}");
});

test("normalizes data URLs and tolerant JSON responses", () => {
  assert.deepEqual(dataUrlParts("data:image/png;base64,aGVsbG8="), { mediaType: "image/png", data: "aGVsbG8=" });
  assert.deepEqual(parseAiJson("结果如下：\n```json\n{\"matched\":true,\"confidence\":0.9}\n```"), { matched: true, confidence: 0.9 });
});

test("provides a fallback body when structured-output fields are rejected", () => {
  const variants = requestBodyVariants("chat_completions", { model: "demo", response_format: { type: "json_object" }, messages: [] });
  assert.equal(variants.length, 2);
  assert.equal("response_format" in variants[1], false);
});
