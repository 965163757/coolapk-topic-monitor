import { createHmac } from "node:crypto";

export const MATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    matchScore: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string" },
    evidence: { type: "array", items: { type: "string" }, maxItems: 4 },
  },
  required: ["matchScore", "reason", "evidence"],
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

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 1) return value === 1;
  if (typeof value === "string" && ["true", "false"].includes(value.trim().toLowerCase())) return value.trim().toLowerCase() === "true";
  return null;
}

function parseProbability(value, fieldName) {
  const text = typeof value === "string" ? value.trim() : value;
  if (text == null || text === "") throw new Error(`AI 返回的 ${fieldName} 不是有效数字`);
  const percent = typeof text === "string" && text.endsWith("%");
  const number = Number(percent ? text.slice(0, -1) : text);
  if (!Number.isFinite(number)) throw new Error(`AI 返回的 ${fieldName} 不是有效数字`);
  const normalized = percent || number > 1 ? number / 100 : number;
  if (normalized < 0 || normalized > 1) throw new Error(`AI 返回的 ${fieldName} 必须在 0 到 1 之间`);
  return normalized;
}

export function normalizeMatchResult(value = {}) {
  const hasMatchScore = value.matchScore != null || value.match_score != null || value.score != null;
  let matchScore;
  let legacyDecisionConfidence = null;
  if (hasMatchScore) {
    matchScore = parseProbability(value.matchScore ?? value.match_score ?? value.score, "matchScore");
  } else if (value.confidence != null) {
    const confidence = parseProbability(value.confidence, "confidence");
    const modelMatched = parseBoolean(value.matched);
    if (modelMatched == null) throw new Error("AI 返回结果缺少 matchScore");
    matchScore = modelMatched ? confidence : 1 - confidence;
    legacyDecisionConfidence = confidence;
  } else {
    throw new Error("AI 返回结果缺少 matchScore");
  }
  return {
    matchScore,
    legacyDecisionConfidence,
    reason: String(value.reason || "AI 未提供判断说明").slice(0, 500),
    evidence: Array.isArray(value.evidence) ? value.evidence.map((item) => String(item).slice(0, 160)).slice(0, 4) : [],
  };
}

function compactPostText(value, fallback = "") {
  const text = String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || fallback;
}

export function buildFeishuFeedNotification(feed = {}, evaluation = {}) {
  const title = compactPostText(feed.title, "酷安动态").slice(0, 200);
  const body = compactPostText(feed.message, title).slice(0, 6_000);
  const reason = compactPostText(evaluation.reason, "符合监控条件").slice(0, 1_000);
  const feedId = String(feed.id || "").trim();
  const webUrl = /^https:\/\//i.test(String(feed.url || ""))
    ? String(feed.url)
    : feedId ? `https://www.coolapk.com/feed/${encodeURIComponent(feedId)}` : "https://www.coolapk.com/";
  const appUrl = feedId ? `coolmarket://feed/${encodeURIComponent(feedId)}` : "coolmarket://main";
  const pictures = [...new Set((Array.isArray(feed.pictures) ? feed.pictures : [])
    .map((value) => String(value || "").trim())
    .filter((value) => /^https:\/\//i.test(value)))]
    .slice(0, 3);
  const elements = [
    { tag: "div", text: { tag: "lark_md", content: body } },
    {
      tag: "action",
      actions: [
        {
          tag: "button",
          type: "primary",
          text: { tag: "plain_text", content: "在酷安 App 中打开" },
          multi_url: { url: webUrl, android_url: appUrl, ios_url: webUrl, pc_url: webUrl },
        },
        {
          tag: "button",
          type: "default",
          text: { tag: "plain_text", content: "网页打开" },
          url: webUrl,
        },
      ],
    },
    ...(pictures.length ? [{
      tag: "div",
      text: {
        tag: "lark_md",
        content: pictures.map((href, index) => `[查看图片 ${index + 1}](${href})`).join("　｜　"),
      },
    }] : []),
    { tag: "hr" },
    { tag: "div", text: { tag: "lark_md", content: `**判断原因**\n${reason}` } },
  ];
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: "green",
        title: { tag: "plain_text", content: title },
      },
      elements,
    },
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
  if (value == null || value === "") {
    const fallbackNumber = Number(fallback);
    return Number.isFinite(fallbackNumber) ? Math.max(0.1, Math.min(1, fallbackNumber)) : 0.72;
  }
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0.1, Math.min(1, number)) : clampThreshold(null, fallback);
}
