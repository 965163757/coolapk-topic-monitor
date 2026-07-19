import { extractChatCompletionText, extractResponseText } from "./integrations.js";

export const AI_API_MODES = Object.freeze(["auto", "responses", "chat_completions", "anthropic_messages", "gemini_generate_content"]);
export const AI_PROVIDERS = Object.freeze(["auto", "openai", "anthropic", "gemini"]);

export function normalizeAiApiMode(value) {
  return AI_API_MODES.includes(value) ? value : "auto";
}

export function normalizeAiProvider(value) {
  return AI_PROVIDERS.includes(value) ? value : "auto";
}

export function inferAiProvider(ai = {}) {
  const configured = normalizeAiProvider(ai.provider);
  if (configured !== "auto") return configured;
  let host = "";
  try { host = new URL(ai.baseUrl || "").hostname.toLowerCase(); } catch { /* The settings endpoint validates URL values. */ }
  const model = String(ai.model || "").toLowerCase();
  if (host.includes("anthropic") || model.startsWith("claude")) return "anthropic";
  if (host.includes("generativelanguage") || host.includes("googleapis.com") || model.startsWith("gemini")) return "gemini";
  return "openai";
}

export function preferredAiApiModes(ai = {}) {
  const configured = normalizeAiApiMode(ai.apiMode);
  if (configured !== "auto") return [configured];
  const provider = inferAiProvider(ai);
  if (provider === "anthropic") return ["anthropic_messages"];
  if (provider === "gemini") return ["gemini_generate_content"];
  let host = "";
  try { host = new URL(ai.baseUrl || "").hostname.toLowerCase(); } catch { /* Use the compatibility-first order below. */ }
  return host === "api.openai.com" || host.endsWith(".openai.com")
    ? ["responses", "chat_completions"]
    : ["chat_completions", "responses"];
}

export function aiEndpoint(ai = {}, mode) {
  const baseUrl = String(ai.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  if (mode === "responses") return `${baseUrl}/responses`;
  if (mode === "chat_completions") return `${baseUrl}/chat/completions`;
  if (mode === "anthropic_messages") return `${baseUrl}/messages`;
  if (mode === "gemini_generate_content") {
    const model = encodeURIComponent(String(ai.model || "gemini-2.5-flash").replace(/^models\//, ""));
    return `${baseUrl}/models/${model}:generateContent`;
  }
  throw new Error("未识别的 AI 接口协议");
}

export function aiHeaders(ai = {}, mode) {
  const apiKey = String(ai.apiKey || "");
  if (mode === "anthropic_messages") {
    return { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  }
  if (mode === "gemini_generate_content") {
    return { "Content-Type": "application/json", "x-goog-api-key": apiKey };
  }
  return { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
}

export function dataUrlParts(value = "") {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(String(value || ""));
  if (!match) return null;
  return { mediaType: match[1].toLowerCase(), data: match[2] };
}

export function extractAiText(payload = {}, mode) {
  if (mode === "responses") return extractResponseText(payload);
  if (mode === "chat_completions") return extractChatCompletionText(payload);
  if (mode === "anthropic_messages") {
    return (payload.content || []).filter((part) => part?.type === "text").map((part) => part.text || "").join("\n");
  }
  if (mode === "gemini_generate_content") {
    return (payload.candidates?.[0]?.content?.parts || []).map((part) => part?.text || "").filter(Boolean).join("\n");
  }
  return "";
}

export function parseAiJson(value = "") {
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(text); } catch { /* Extract a JSON object from providers that add a short preface. */ }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error("AI 返回的判断结果不是有效 JSON");
}

export function requestBodyVariants(mode, body) {
  const variants = [body];
  const compat = structuredClone(body);
  if (mode === "responses") {
    delete compat.text;
    delete compat.reasoning;
  } else if (mode === "chat_completions") {
    delete compat.response_format;
  } else if (mode === "gemini_generate_content") {
    if (compat.generationConfig) {
      delete compat.generationConfig.responseMimeType;
      delete compat.generationConfig.responseSchema;
      if (!Object.keys(compat.generationConfig).length) delete compat.generationConfig;
    }
  }
  const primary = JSON.stringify(body);
  if (JSON.stringify(compat) !== primary) variants.push(compat);
  return variants;
}

export function isCompatibilityFailure(failure) {
  const status = Number(failure?.response?.status || failure?.status || 0);
  if (![400, 404, 405, 422, 501].includes(status)) return false;
  const message = String(failure?.payload?.error?.message || failure?.payload?.message || failure?.raw || failure?.message || "").toLowerCase();
  return /unknown|unsupported|not support|unrecognized|invalid.*(parameter|field|request)|response_format|json_schema|reasoning|endpoint|route|path|not found|未找到|不支持/.test(message);
}

export function shouldTryAlternateAiApi(failure) {
  const status = Number(failure?.response?.status || failure?.status || 0);
  if (![404, 405, 501].includes(status)) return false;
  const message = String(failure?.payload?.error?.message || failure?.payload?.message || failure?.raw || "").toLowerCase();
  return !message || (!/model|模型/.test(message) && /not found|endpoint|route|path|接口|未找到|unsupported/.test(message));
}

export function isUnsupportedImageInputError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return /image_url|input_image|inline_data|image input|图片输入/.test(message)
    && /unknown|unsupported|expected|not support|不支持/.test(message);
}
