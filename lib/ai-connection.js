import { AI_API_MODES, AI_PROVIDERS } from "./ai-compat.js";

const REASONING_EFFORTS = new Set(["none", "low", "medium", "high"]);

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function inputConfig(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  if (body.ai && typeof body.ai === "object" && !Array.isArray(body.ai)) return body.ai;
  return body;
}

export function normalizeAiTestBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw badRequest("AI API 地址格式不正确");
  }
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    throw badRequest("AI API 地址必须使用 HTTPS（本机地址除外）");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function mergeAiTestConfig(current = {}, body = {}) {
  const input = inputConfig(body);
  const next = { ...current };

  if (typeof input.baseUrl === "string" && input.baseUrl.trim()) {
    next.baseUrl = normalizeAiTestBaseUrl(input.baseUrl);
  }
  if (typeof input.apiKey === "string" && input.apiKey.trim()) {
    next.apiKey = input.apiKey.trim();
  }
  if (typeof input.model === "string" && input.model.trim()) {
    next.model = input.model.trim().slice(0, 100);
  }
  if (input.provider != null) {
    if (!AI_PROVIDERS.includes(input.provider)) throw badRequest("AI 服务商配置无效");
    next.provider = input.provider;
  }
  if (input.apiMode != null) {
    if (!AI_API_MODES.includes(input.apiMode)) throw badRequest("AI 接口协议配置无效");
    next.apiMode = input.apiMode;
  }
  if (input.reasoningEffort != null) {
    if (!REASONING_EFFORTS.has(input.reasoningEffort)) throw badRequest("AI 推理强度配置无效");
    next.reasoningEffort = input.reasoningEffort;
  }
  return next;
}

export function aiConnectionTestBodies(ai = {}) {
  const prompt = "只回复：连接成功";
  return {
    responses: {
      model: ai.model,
      input: prompt,
      max_output_tokens: 32,
    },
    chat_completions: {
      model: ai.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 32,
    },
    anthropic_messages: {
      model: ai.model,
      max_tokens: 32,
      messages: [{ role: "user", content: prompt }],
    },
    gemini_generate_content: {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 32 },
    },
  };
}

export function redactAiTestText(value, apiKey) {
  let text = String(value || "");
  const secret = String(apiKey || "");
  if (secret) text = text.split(secret).join("[REDACTED]");
  return text;
}

export function redactAiTestError(error, apiKey) {
  const message = redactAiTestText(error?.message || error || "AI 连接测试失败", apiKey);
  const sanitized = new Error(message);
  if (Number(error?.statusCode)) sanitized.statusCode = Number(error.statusCode);
  return sanitized;
}
