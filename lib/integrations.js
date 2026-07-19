import { createHmac } from "node:crypto";

export const MATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    matched: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string" },
    evidence: { type: "array", items: { type: "string" }, maxItems: 4 },
  },
  required: ["matched", "confidence", "reason", "evidence"],
};

export function maskSecret(value = "") {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 8) return "••••••••";
  return `${text.slice(0, 4)}••••••••${text.slice(-4)}`;
}

export function extractResponseText(payload = {}) {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

export function extractChatCompletionText(payload = {}) {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => typeof item === "string" ? item : item?.text || item?.content || "")
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function normalizeMatchResult(value = {}) {
  return {
    matched: Boolean(value.matched),
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)),
    reason: String(value.reason || "AI 未提供判断说明").slice(0, 500),
    evidence: Array.isArray(value.evidence) ? value.evidence.map((item) => String(item).slice(0, 160)).slice(0, 4) : [],
  };
}

export function feishuSignature(secret, timestamp) {
  const stringToSign = `${timestamp}\n${secret}`;
  return createHmac("sha256", stringToSign).update("").digest("base64");
}

export function validateFeishuWebhook(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === "https:" && ["open.feishu.cn", "open.larksuite.com"].includes(url.hostname) && /\/open-apis\/bot\/v2\/hook\//.test(url.pathname);
}

export function clampThreshold(value, fallback = 0.72) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0.1, Math.min(1, number)) : fallback;
}
