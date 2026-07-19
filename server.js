import { createServer } from "node:http";
import { createHash, randomInt } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { MATCH_SCHEMA, clampThreshold, extractChatCompletionText, extractResponseText, feishuSignature, maskSecret, normalizeMatchResult, validateFeishuWebhook } from "./lib/integrations.js";
import { canonicalSource, isSupportedSource, parseSourceKey } from "./lib/monitor-source.js";
import { isUnsupportedImageInputError } from "./lib/ai-compat.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const STATE_FILE = join(ROOT, "data", "state.json");
const SETTINGS_FILE = join(ROOT, "data", "settings.json");
const PORT = Number(process.env.PORT || 4173);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5 * 60 * 1000);
const FEED_LIMIT = 10;

const APP_ID = "wx7c6be4984041fa23";
const APP_SECRET = "a717e41f8e9254c52da78d70003f24a0";
const DEVICE_BRAND = "iPhone";
const DEVICE_MODEL = "unknown<iPhone18,3>";
const API_ROOT = "https://api.coolapk.com/v6";

const initialState = {
  topics: [{ tag: "薅羊毛小分队", detail: null, feeds: [], lastFetchedAt: null, lastError: null }],
  evaluations: [],
  lastPollAt: null,
  nextPollAt: null,
};

const defaultSettings = {
  ai: {
    enabled: false,
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-5.6-luna",
    apiMode: "auto",
    reasoningEffort: "low",
    includeImages: true,
    threshold: 0.72,
  },
  feishu: {
    enabled: false,
    webhookUrl: "",
    secret: "",
  },
  processedFeedIds: {},
};

let state = structuredClone(initialState);
let settings = structuredClone(defaultSettings);
let pollPromise = null;
let analysisPromise = null;
const runtime = { lastAiRunAt: null, lastAiError: null, lastNotificationAt: null };
const topicSearchCache = new Map();
const aiImageCapabilityCache = new Map();

function md5(value) {
  return createHash("md5").update(value).digest("hex");
}

function coolapkHeaders() {
  const rawDevice = `${DEVICE_BRAND};${DEVICE_MODEL};;;${Date.now()}${randomInt(1, 10001)};`;
  const deviceId = md5(rawDevice);
  const device = Buffer.from(`${deviceId}; ; ; ; ; ${DEVICE_BRAND}; ${DEVICE_MODEL}; `).toString("base64");
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = md5(`${APP_ID}/${md5(APP_SECRET)}${deviceId}${timestamp}`);
  const token = `${signature}${deviceId}0x${timestamp.toString(16)}`;

  return {
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.65 NetType/5G Language/zh_CN",
    "X-Requested-With": "XMLHttpRequest",
    "X-Sdk-Int": "260",
    "X-Sdk-Locale": "zh-CN",
    "X-App-Id": APP_ID,
    "X-App-Version": "1.0",
    "X-App-Code": "1902250",
    "X-Api-Version": "9",
    "X-App-Device": device,
    "X-App-Token": token,
  };
}

async function coolapkGet(path, params = {}) {
  const url = new URL(`${API_ROOT}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url, { headers: coolapkHeaders(), signal: AbortSignal.timeout(20_000) });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`酷安返回了非 JSON 响应（HTTP ${response.status}）`);
  }
  if (!response.ok) throw new Error(`酷安请求失败（HTTP ${response.status}）`);
  if (payload.status && !payload.data) throw new Error(payload.message || `酷安错误 ${payload.status}`);
  return payload;
}

function topicSummary(detail) {
  const source = canonicalSource(detail);
  return {
    id: detail.id,
    title: detail.title,
    tag: source.tag,
    sourceType: source.type,
    sourceId: source.id,
    sourceKey: source.key,
    description: detail.description || "",
    intro: detail.intro || "",
    logo: secureUrl(detail.logo || detail.tag_pics?.[0] || ""),
    followers: Number(detail.follownum || detail.follow_num || 0),
    posts: Number(detail.commentnum || detail.feed_comment_num || 0),
    hot: Number(detail.hot_num || 0),
    url: detail.url || (source.type === "product" ? `/product/${detail.id}` : `/t/${encodeURIComponent(detail.title)}`),
  };
}

function secureUrl(url) {
  return typeof url === "string" ? url : "";
}

function feedSummary(feed) {
  return {
    id: feed.id,
    title: feed.message_title || feed.title || `${feed.username || "酷友"}的动态`,
    message: feed.message || "",
    username: feed.username || feed.userInfo?.username || "酷友",
    avatar: secureUrl(feed.userAvatar || feed.userInfo?.userAvatar || ""),
    pictures: (feed.picArr?.length ? feed.picArr : feed.pic ? [feed.pic] : []).map(secureUrl).slice(0, 3),
    likes: Number(feed.likenum || 0),
    comments: Number(feed.commentnum || 0),
    shares: Number(feed.forwardnum || feed.share_num || 0),
    createdAt: Number(feed.dateline || feed.create_time || 0) * 1000,
    device: feed.device_title || "",
    url: `https://www.coolapk.com/feed/${feed.id}`,
  };
}

function replySummary(reply) {
  return {
    id: reply.id,
    username: reply.username || reply.userInfo?.username || "酷友",
    avatar: secureUrl(reply.userAvatar || reply.userInfo?.userAvatar || ""),
    message: reply.message || "",
    picture: secureUrl(reply.pic || ""),
    likes: Number(reply.likenum || 0),
    replyCount: Number(reply.replynum || 0),
    createdAt: Number(reply.dateline || 0) * 1000,
    isAuthor: Boolean(reply.isFeedAuthor),
    replyTo: reply.rusername || "",
    replies: (reply.replyRows || []).map(replySummary),
  };
}

async function fetchFeedDetail(id, page = 1) {
  const [detailPayload, replyPayload] = await Promise.all([
    coolapkGet("/feed/detail", { id }),
    fetchReplies(id, page),
  ]);
  const raw = detailPayload.data;
  return {
    feed: {
      ...feedSummary(raw),
      pictures: (raw.picArr?.length ? raw.picArr : raw.pic ? [raw.pic] : []).map(secureUrl),
      topic: raw.ttitle || "",
      location: raw.ip_location || raw.location || "",
      favorites: Number(raw.favnum || 0),
      replyCount: Number(raw.replynum || raw.commentnum || 0),
    },
    replies: replyPayload,
    page,
  };
}

async function fetchReplies(id, page = 1) {
  const payload = await coolapkGet("/feed/replyList", {
    id,
    listType: "lastupdate_desc",
    page,
    discussMode: 1,
    feedType: "feed",
    fromFeedAuthor: 0,
  });
  return (payload.data || []).map(replySummary);
}

async function fetchTopic(input) {
  const stored = input && typeof input === "object" ? input : null;
  const storedDetail = stored?.detail || {};
  const storedSource = canonicalSource({
    ...storedDetail,
    sourceType: stored?.sourceType || storedDetail.sourceType,
    sourceId: stored?.sourceId ?? storedDetail.sourceId,
  }, stored?.tag || "");
  const requested = stored ? storedSource : parseSourceKey(input);

  let detailPayload;
  if (requested.type === "product" && requested.id != null && String(requested.id)) {
    detailPayload = await coolapkGet("/product/detail", { id: requested.id });
  } else {
    detailPayload = await coolapkGet("/topic/newTagDetail", { tag: requested.tag });
  }
  if (!isSupportedSource(detailPayload.data)) throw new Error("该结果不是可监控的话题或数码产品");

  const detail = topicSummary(detailPayload.data);
  const feedRequest = detail.sourceType === "product"
    ? coolapkGet("/page/dataList", { url: "/product/feedList", id: detail.sourceId, type: "feed", page: 1, listType: "dateline_desc" })
    : coolapkGet("/topic/tagFeedList", { tag: detail.tag, page: 1, listType: "dateline_desc" });
  const feedPayload = await feedRequest.catch(() => ({ data: [] }));
  const feeds = (Array.isArray(feedPayload.data) ? feedPayload.data : [])
    .filter((item) => item?.entityType === "feed" || (item?.id && item?.message !== undefined))
    .map(feedSummary)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, FEED_LIMIT);
  return {
    detail,
    feeds,
    sourceType: detail.sourceType,
    sourceId: detail.sourceId,
    sourceKey: detail.sourceKey,
  };
}

async function searchTopics(keyword) {
  const q = keyword.trim();
  if (!q) return [];
  const payload = await coolapkGet("/search", {
    type: "feedTopic",
    searchValue: q,
    page: 1,
    showAnonymous: -1,
  }).catch(() => ({ data: [] }));

  const results = (payload.data || [])
    .filter(isSupportedSource)
    .map(topicSummary);

  if (!results.some((item) => item.title === q)) {
    try {
      const exact = await coolapkGet("/topic/newTagDetail", { tag: q });
      if (isSupportedSource(exact.data)) results.unshift(topicSummary(exact.data));
    } catch {
      // 模糊搜索结果仍可正常返回。
    }
  }
  const uniqueResults = [...new Map(results.map((item) => [item.sourceKey || item.id || item.tag || item.title, item])).values()].slice(0, 12);
  const expiresAt = Date.now() + 10 * 60 * 1000;
  for (const item of uniqueResults) {
    const keys = [item.sourceKey, item.tag, item.title].map((value) => String(value || "").trim()).filter(Boolean);
    for (const key of keys) topicSearchCache.set(key, { detail: item, expiresAt });
  }
  return uniqueResults;
}

function resolvedAiSettings() {
  return {
    ...settings.ai,
    baseUrl: process.env.OPENAI_BASE_URL || settings.ai.baseUrl,
    apiKey: process.env.OPENAI_API_KEY || settings.ai.apiKey,
    model: process.env.OPENAI_MODEL || settings.ai.model,
    apiMode: process.env.OPENAI_API_MODE || settings.ai.apiMode || "auto",
  };
}

function resolvedFeishuSettings() {
  return {
    ...settings.feishu,
    webhookUrl: process.env.FEISHU_WEBHOOK_URL || settings.feishu.webhookUrl,
    secret: process.env.FEISHU_WEBHOOK_SECRET || settings.feishu.secret,
  };
}

function publicSettings() {
  const ai = resolvedAiSettings();
  const feishu = resolvedFeishuSettings();
  return {
    ai: {
      enabled: Boolean(settings.ai.enabled),
      baseUrl: ai.baseUrl,
      model: ai.model,
      apiMode: normalizeAiApiMode(ai.apiMode),
      reasoningEffort: settings.ai.reasoningEffort,
      includeImages: Boolean(settings.ai.includeImages),
      threshold: clampThreshold(settings.ai.threshold),
      configured: Boolean(ai.apiKey),
      apiKeyMasked: maskSecret(ai.apiKey),
      keySource: process.env.OPENAI_API_KEY ? "environment" : ai.apiKey ? "settings" : "none",
    },
    feishu: {
      enabled: Boolean(settings.feishu.enabled),
      configured: Boolean(feishu.webhookUrl),
      webhookMasked: maskSecret(feishu.webhookUrl),
      secretConfigured: Boolean(feishu.secret),
      webhookSource: process.env.FEISHU_WEBHOOK_URL ? "environment" : feishu.webhookUrl ? "settings" : "none",
    },
    runtime: {
      analyzing: Boolean(analysisPromise),
      ...runtime,
    },
  };
}

function normalizeAiApiMode(value) {
  return ["auto", "responses", "chat_completions"].includes(value) ? value : "auto";
}

function preferredAiApiModes(ai) {
  const configured = normalizeAiApiMode(ai.apiMode);
  if (configured !== "auto") return [configured];
  let host = "";
  try { host = new URL(ai.baseUrl).hostname.toLowerCase(); } catch { /* URL validation happens on save. */ }
  return host === "api.openai.com" || host.endsWith(".openai.com")
    ? ["responses", "chat_completions"]
    : ["chat_completions", "responses"];
}

function aiEndpoint(ai, mode) {
  const baseUrl = String(ai.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  return `${baseUrl}/${mode === "responses" ? "responses" : "chat/completions"}`;
}

function aiErrorMessage(failure) {
  const message = String(failure.payload?.error?.message || failure.payload?.message || failure.payload?.detail?.message || "").trim();
  if (message) return message;
  if (failure.response.status === 404) {
    const endpoint = failure.mode === "responses" ? "/responses" : "/chat/completions";
    return `AI 服务未提供 ${endpoint} 接口`;
  }
  return `AI 请求失败（HTTP ${failure.response.status}）`;
}

function shouldTryAlternateAiApi(failure) {
  if (failure.response.status !== 404) return false;
  const message = String(failure.payload?.error?.message || failure.payload?.message || failure.raw || "").toLowerCase();
  return !message || (!/model|模型/.test(message) && /not found|endpoint|route|path|接口|未找到/.test(message));
}

async function requestAi(ai, bodies, timeoutMs) {
  if (!ai.apiKey) throw new Error("请先在系统设置中配置 AI API Key");
  const apiMode = normalizeAiApiMode(ai.apiMode);
  const modes = preferredAiApiModes(ai);
  let lastFailure;

  for (let index = 0; index < modes.length; index += 1) {
    const mode = modes[index];
    const response = await fetch(aiEndpoint(ai, mode), {
      method: "POST",
      headers: { Authorization: `Bearer ${ai.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(bodies[mode]),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = await response.text();
    let payload = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { /* Some providers return an empty 404 body. */ }
    if (response.ok) return { mode, payload };

    lastFailure = { mode, response, payload, raw };
    if (apiMode === "auto" && index < modes.length - 1 && shouldTryAlternateAiApi(lastFailure)) continue;
    break;
  }
  throw new Error(aiErrorMessage(lastFailure));
}

function aiModeLabel(mode) {
  return mode === "responses" ? "Responses API" : "Chat Completions";
}

function aiImageCapabilityKey(ai) {
  return `${String(ai.baseUrl || "").replace(/\/+$/, "").toLowerCase()}|${String(ai.model || "").toLowerCase()}|${normalizeAiApiMode(ai.apiMode)}`;
}

function classificationBodies(ai, prompt, imageUrls) {
  const responseContent = [
    { type: "input_text", text: prompt },
    ...imageUrls.map((imageUrl) => ({ type: "input_image", image_url: imageUrl, detail: "low" })),
  ];
  const chatContent = imageUrls.length
    ? [{ type: "text", text: prompt }, ...imageUrls.map((imageUrl) => ({ type: "image_url", image_url: { url: imageUrl, detail: "low" } }))]
    : prompt;
  return {
    responses: {
      model: ai.model,
      reasoning: { effort: settings.ai.reasoningEffort || "low" },
      max_output_tokens: 500,
      input: [
        { role: "system", content: [{ type: "input_text", text: "你是高精度信息监控分类器。严格按关注意图判断帖子是否值得提醒，并输出结构化 JSON。" }] },
        { role: "user", content: responseContent },
      ],
      text: { format: { type: "json_schema", name: "topic_match", strict: true, schema: MATCH_SCHEMA } },
    },
    chat_completions: {
      model: ai.model,
      max_tokens: 500,
      messages: [
        { role: "system", content: "你是高精度信息监控分类器。严格按关注意图判断帖子是否值得提醒，并只输出 JSON 对象，字段为 matched、confidence、reason、evidence。" },
        { role: "user", content: chatContent },
      ],
      response_format: { type: "json_object" },
    },
  };
}

async function saveSettings() {
  await mkdir(dirname(SETTINGS_FILE), { recursive: true });
  const temporary = `${SETTINGS_FILE}.tmp`;
  await writeFile(temporary, JSON.stringify(settings, null, 2), "utf8");
  await rename(temporary, SETTINGS_FILE);
}

async function fetchImageInput(url) {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36", Referer: "https://www.coolapk.com/" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    const type = (response.headers.get("content-type") || "image/jpeg").split(";")[0];
    if (!type.startsWith("image/")) return null;
    const data = Buffer.from(await response.arrayBuffer());
    if (!data.length || data.length > 3_000_000) return null;
    return `data:${type};base64,${data.toString("base64")}`;
  } catch {
    return null;
  }
}

async function classifyFeed(topic, feed) {
  const ai = resolvedAiSettings();
  if (!settings.ai.enabled) throw new Error("AI 筛选总开关尚未开启");
  if (!ai.apiKey) throw new Error("请先在系统设置中配置 AI API Key");
  const intent = String(topic.ai?.intent || "").trim();
  if (!topic.ai?.enabled || !intent) throw new Error("该话题尚未配置 AI 关注意图");

  const prompt = [
    `监控话题：${topic.tag}`,
    `关注意图：${intent}`,
    `帖子作者：${feed.username}`,
    `帖子标题：${feed.title}`,
    `帖子正文：${String(feed.message || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 8000)}`,
    "请判断这条帖子是否真正符合关注意图。宁可减少误报，不要只因为出现个别关键词就判定命中。价格、商品、活动条件等关键信息若只在图片中，也要结合图片判断。",
  ].join("\n");

  const imageUrls = [];
  if (settings.ai.includeImages && feed.pictures?.length) {
    const images = await Promise.all(feed.pictures.slice(0, 2).map(fetchImageInput));
    imageUrls.push(...images.filter(Boolean));
  }

  const imageCapabilityKey = aiImageCapabilityKey(ai);
  const requestedImages = aiImageCapabilityCache.get(imageCapabilityKey) === false ? [] : imageUrls;
  let result;
  let imageFallback = false;
  try {
    result = await requestAi(ai, classificationBodies(ai, prompt, requestedImages), 45_000);
  } catch (error) {
    if (!requestedImages.length || !isUnsupportedImageInputError(error)) throw error;
    aiImageCapabilityCache.set(imageCapabilityKey, false);
    imageFallback = true;
    result = await requestAi(ai, classificationBodies(ai, prompt, []), 45_000);
  }
  const output = result.mode === "responses" ? extractResponseText(result.payload) : extractChatCompletionText(result.payload);
  if (!output) throw new Error("AI 未返回可解析的判断结果");
  let parsed;
  try { parsed = JSON.parse(output); } catch { throw new Error("AI 返回的判断结果不是有效 JSON"); }
  return { ...normalizeMatchResult(parsed), model: ai.model, imageFallback };
}

async function postFeishu(body) {
  const feishu = resolvedFeishuSettings();
  if (!feishu.webhookUrl) throw new Error("请先配置飞书自定义机器人 Webhook");
  if (!validateFeishuWebhook(feishu.webhookUrl)) throw new Error("飞书 Webhook 必须是 V2 自定义机器人地址");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payloadBody = { ...body };
  if (feishu.secret) {
    payloadBody.timestamp = timestamp;
    payloadBody.sign = feishuSignature(feishu.secret, timestamp);
  }
  const response = await fetch(feishu.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payloadBody),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || ![0, undefined].includes(payload.code) || ![0, undefined].includes(payload.StatusCode)) {
    throw new Error(payload.msg || payload.StatusMessage || `飞书通知失败（HTTP ${response.status}）`);
  }
  runtime.lastNotificationAt = new Date().toISOString();
  return { sent: true };
}

async function sendFeishuNotification(topic, feed, evaluation) {
  if (!settings.feishu.enabled) return { sent: false, skipped: true };
  return postFeishu({
    msg_type: "post",
    content: {
      post: {
        zh_cn: {
          title: `🎯 AI 命中：#${topic.tag}`,
          content: [
            [{ tag: "text", text: `${feed.title}\n` }],
            [{ tag: "text", text: `作者：${feed.username}｜置信度：${Math.round(evaluation.confidence * 100)}%\n` }],
            [{ tag: "text", text: `判断：${evaluation.reason}\n` }],
            [{ tag: "text", text: `关注意图：${topic.ai.intent}\n` }],
            [{ tag: "a", text: "查看酷安动态", href: feed.url }],
          ],
        },
      },
    },
  });
}

async function testAiConnection() {
  const ai = resolvedAiSettings();
  const result = await requestAi(ai, {
    responses: { model: ai.model, input: "只回复：连接成功", max_output_tokens: 32 },
    chat_completions: { model: ai.model, messages: [{ role: "user", content: "只回复：连接成功" }], max_tokens: 32 },
  }, 30_000);
  const response = result.mode === "responses" ? extractResponseText(result.payload) : extractChatCompletionText(result.payload);
  return { ok: true, model: ai.model, mode: result.mode, modeLabel: aiModeLabel(result.mode), response: response.slice(0, 100) };
}

async function analyzeTopicFeeds(tag, { force = false, notify = true } = {}) {
  if (analysisPromise) throw new Error("已有 AI 分析任务正在运行");
  const task = (async () => {
    const topic = state.topics.find((item) => item.tag === tag);
    if (!topic) throw new Error("未找到该监控话题");
    if (!topic.ai?.enabled || !topic.ai?.intent?.trim()) throw new Error("请先配置并启用该话题的 AI 关注意图");
    const processed = new Set(settings.processedFeedIds[tag] || []);
    const feeds = (topic.feeds || []).filter((feed) => force || !processed.has(String(feed.id)));
    const results = [];
    runtime.lastAiError = null;
    for (const feed of feeds) {
      try {
        const raw = await classifyFeed(topic, feed);
        const threshold = clampThreshold(topic.ai.threshold, clampThreshold(settings.ai.threshold));
        const evaluation = {
          id: `${feed.id}-${Date.now()}`,
          topic: tag,
          feedId: String(feed.id),
          title: feed.title,
          username: feed.username,
          feedUrl: feed.url,
          matched: Boolean(raw.matched && raw.confidence >= threshold),
          confidence: raw.confidence,
          threshold,
          reason: raw.reason,
          evidence: raw.evidence,
          model: raw.model,
          imageFallback: Boolean(raw.imageFallback),
          status: "completed",
          notified: false,
          notificationError: null,
          evaluatedAt: new Date().toISOString(),
        };
        if (evaluation.matched && notify && topic.ai.notify !== false) {
          try {
            const sent = await sendFeishuNotification(topic, feed, evaluation);
            evaluation.notified = Boolean(sent.sent);
          } catch (error) {
            evaluation.notificationError = error.message;
          }
        }
        state.evaluations = state.evaluations.filter((item) => !(
          item.topic === tag
          && String(item.feedId) === String(feed.id)
          && item.status === "error"
          && isUnsupportedImageInputError(item.reason)
        ));
        state.evaluations.unshift(evaluation);
        results.push(evaluation);
      } catch (error) {
        const evaluation = {
          id: `${feed.id}-${Date.now()}`,
          topic: tag,
          feedId: String(feed.id),
          title: feed.title,
          username: feed.username,
          feedUrl: feed.url,
          matched: false,
          confidence: 0,
          reason: error.message,
          evidence: [],
          model: resolvedAiSettings().model,
          status: "error",
          notified: false,
          notificationError: null,
          evaluatedAt: new Date().toISOString(),
        };
        runtime.lastAiError = error.message;
        state.evaluations.unshift(evaluation);
        results.push(evaluation);
      }
      processed.add(String(feed.id));
      settings.processedFeedIds[tag] = [...processed].slice(-500);
      state.evaluations = state.evaluations.slice(0, 500);
      await Promise.all([saveState(), saveSettings()]);
    }
    topic.ai.lastAnalyzedAt = new Date().toISOString();
    runtime.lastAiRunAt = topic.ai.lastAnalyzedAt;
    await saveState();
    return results;
  })();
  analysisPromise = task;
  try { return await task; } finally { analysisPromise = null; }
}

async function loadState() {
  try {
    const stored = JSON.parse(await readFile(STATE_FILE, "utf8"));
    if (Array.isArray(stored.topics)) state = { ...structuredClone(initialState), ...stored };
  } catch (error) {
    if (error.code !== "ENOENT") console.error("读取监控状态失败：", error.message);
  }
  state.evaluations = Array.isArray(state.evaluations) ? state.evaluations.slice(0, 500) : [];
  state.evaluations = state.evaluations.filter((item) => !(item.status === "error" && isUnsupportedImageInputError(item.reason)));
  state.topics = state.topics.map((topic) => {
    const source = canonicalSource({
      ...(topic.detail || {}),
      sourceType: topic.sourceType || topic.detail?.sourceType,
      sourceId: topic.sourceId ?? topic.detail?.sourceId,
    }, topic.tag);
    return {
      ...topic,
      sourceType: source.type,
      sourceId: source.id,
      sourceKey: topic.sourceKey || source.key,
      ai: {
        enabled: Boolean(topic.ai?.enabled),
        intent: String(topic.ai?.intent || ""),
        threshold: topic.ai?.threshold == null ? null : clampThreshold(topic.ai.threshold),
        notify: topic.ai?.notify !== false,
        lastAnalyzedAt: topic.ai?.lastAnalyzedAt || null,
      },
    };
  });
}

async function loadSettings() {
  try {
    const stored = JSON.parse(await readFile(SETTINGS_FILE, "utf8"));
    settings = {
      ...structuredClone(defaultSettings),
      ...stored,
      ai: { ...defaultSettings.ai, ...(stored.ai || {}) },
      feishu: { ...defaultSettings.feishu, ...(stored.feishu || {}) },
      processedFeedIds: stored.processedFeedIds && typeof stored.processedFeedIds === "object" ? stored.processedFeedIds : {},
    };
  } catch (error) {
    if (error.code !== "ENOENT") console.error("读取系统设置失败：", error.message);
  }
}

async function saveState() {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  const temporary = `${STATE_FILE}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
  await rename(temporary, STATE_FILE);
}

async function refreshTopic(tag) {
  const index = state.topics.findIndex((topic) => topic.tag === tag);
  if (index < 0) throw new Error("该话题未被监控");
  try {
    const data = await fetchTopic(state.topics[index]);
    state.topics[index] = {
      ...state.topics[index],
      ...data,
      lastFetchedAt: new Date().toISOString(),
      lastError: null,
    };
  } catch (error) {
    state.topics[index].lastError = error.message;
    state.topics[index].lastFetchedAt = new Date().toISOString();
    throw error;
  } finally {
    await saveState();
  }
  return state.topics[index];
}

async function pollAll() {
  if (pollPromise) return pollPromise;
  pollPromise = (async () => {
    state.lastPollAt = new Date().toISOString();
    state.nextPollAt = new Date(Date.now() + POLL_INTERVAL_MS).toISOString();
    const tags = state.topics.map((topic) => topic.tag);
    for (const tag of tags) {
      try {
        await refreshTopic(tag);
        const topic = state.topics.find((item) => item.tag === tag);
        if (settings.ai.enabled && topic?.ai?.enabled && topic.ai.intent?.trim()) {
          try { await analyzeTopicFeeds(tag, { force: false, notify: true }); }
          catch (error) { runtime.lastAiError = error.message; console.error(`AI 分析“${tag}”失败：`, error.message); }
        }
      } catch (error) {
        console.error(`刷新“${tag}”失败：`, error.message);
      }
    }
    await saveState();
  })().finally(() => {
    pollPromise = null;
  });
  return pollPromise;
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32_000) throw new Error("请求内容过大");
  }
  return body ? JSON.parse(body) : {};
}

async function serveStatic(pathname, response) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  if (/^qa-.*\.png$/i.test(requested)) return false;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const path = join(PUBLIC_DIR, safePath);
  if (!path.startsWith(PUBLIC_DIR)) return false;
  try {
    const body = await readFile(path);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".png": "image/png",
      ".ico": "image/x-icon",
    };
    response.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" });
    response.end(body);
    return true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return false;
  }
}

async function proxyImage(url, response) {
  let source;
  try {
    source = new URL(url);
  } catch {
    return sendJson(response, 400, { error: "图片地址格式错误" });
  }
  const hostname = source.hostname.toLowerCase();
  if (!["image.coolapk.com", "avatar.coolapk.com"].includes(hostname)) {
    return sendJson(response, 403, { error: "图片来源未被允许" });
  }
  if (!/^https?:$/.test(source.protocol)) return sendJson(response, 400, { error: "图片协议错误" });

  // 部分旧图片只在 HTTP 源上可用，因此保留原始协议并由本站统一代理。
  const upstream = await fetch(source, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
      Referer: "https://www.coolapk.com/",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!upstream.ok || !upstream.body) return sendJson(response, 502, { error: `图片加载失败（${upstream.status}）` });
  response.writeHead(200, {
    "Content-Type": upstream.headers.get("content-type") || "image/jpeg",
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    "X-Content-Type-Options": "nosniff",
  });
  Readable.fromWeb(upstream.body).pipe(response);
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/image") {
    return proxyImage(url.searchParams.get("url") || "", response);
  }
  if (request.method === "GET" && url.pathname === "/api/health") {
    return sendJson(response, 200, { ok: true, uptimeSeconds: Math.round(process.uptime()), topics: state.topics.length, now: new Date().toISOString() });
  }
  if (request.method === "GET" && url.pathname === "/api/status") {
    return sendJson(response, 200, {
      intervalMs: POLL_INTERVAL_MS,
      lastPollAt: state.lastPollAt,
      nextPollAt: state.nextPollAt,
      refreshing: Boolean(pollPromise),
      ai: publicSettings().runtime,
    });
  }
  if (request.method === "GET" && url.pathname === "/api/settings") {
    return sendJson(response, 200, publicSettings());
  }
  if (request.method === "PUT" && url.pathname === "/api/settings") {
    const body = await readJson(request);
    if (body.ai && typeof body.ai === "object") {
      const next = body.ai;
      if (typeof next.enabled === "boolean") settings.ai.enabled = next.enabled;
      if (typeof next.baseUrl === "string" && next.baseUrl.trim()) {
        const parsed = new URL(next.baseUrl.trim());
        const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
        if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) return sendJson(response, 400, { error: "AI API 地址必须使用 HTTPS（本机地址除外）" });
        settings.ai.baseUrl = parsed.toString().replace(/\/$/, "");
      }
      if (typeof next.model === "string" && next.model.trim()) settings.ai.model = next.model.trim().slice(0, 100);
      if (["auto", "responses", "chat_completions"].includes(next.apiMode)) settings.ai.apiMode = next.apiMode;
      if (["none", "low", "medium", "high"].includes(next.reasoningEffort)) settings.ai.reasoningEffort = next.reasoningEffort;
      if (typeof next.includeImages === "boolean") settings.ai.includeImages = next.includeImages;
      if (next.threshold != null) settings.ai.threshold = clampThreshold(next.threshold);
      if (typeof next.apiKey === "string" && next.apiKey.trim()) settings.ai.apiKey = next.apiKey.trim();
      if (next.clearApiKey === true) settings.ai.apiKey = "";
    }
    if (body.feishu && typeof body.feishu === "object") {
      const next = body.feishu;
      if (typeof next.enabled === "boolean") settings.feishu.enabled = next.enabled;
      if (typeof next.webhookUrl === "string" && next.webhookUrl.trim()) {
        if (!validateFeishuWebhook(next.webhookUrl.trim())) return sendJson(response, 400, { error: "请输入飞书 V2 自定义机器人 Webhook" });
        settings.feishu.webhookUrl = next.webhookUrl.trim();
      }
      if (typeof next.secret === "string" && next.secret.trim()) settings.feishu.secret = next.secret.trim();
      if (next.clearWebhook === true) settings.feishu.webhookUrl = "";
      if (next.clearSecret === true) settings.feishu.secret = "";
    }
    await saveSettings();
    return sendJson(response, 200, publicSettings());
  }
  if (request.method === "POST" && url.pathname === "/api/integrations/test-ai") {
    return sendJson(response, 200, await testAiConnection());
  }
  if (request.method === "POST" && url.pathname === "/api/integrations/test-feishu") {
    const result = await postFeishu({ msg_type: "text", content: { text: `话题雷达连接测试成功\n时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}` } });
    return sendJson(response, 200, result);
  }
  if (request.method === "GET" && url.pathname === "/api/evaluations") {
    const tag = (url.searchParams.get("topic") || "").trim();
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 100)));
    const evaluations = state.evaluations.filter((item) => !tag || item.topic === tag).slice(0, limit);
    return sendJson(response, 200, { evaluations });
  }
  if (request.method === "GET" && url.pathname === "/api/topics") {
    return sendJson(response, 200, { topics: state.topics });
  }
  if (request.method === "GET" && url.pathname === "/api/topics/search") {
    const q = url.searchParams.get("q") || "";
    if (!q.trim()) return sendJson(response, 400, { error: "请输入搜索关键词" });
    return sendJson(response, 200, { results: await searchTopics(q) });
  }
  if (request.method === "POST" && url.pathname === "/api/topics") {
    const { tag } = await readJson(request);
    const cleanTag = String(tag || "").trim();
    if (!cleanTag) return sendJson(response, 400, { error: "缺少话题名称" });
    if (state.topics.some((topic) => topic.tag === cleanTag || topic.sourceKey === cleanTag)) {
      return sendJson(response, 409, { error: "该话题已在监控列表中" });
    }
    let data;
    try {
      data = await fetchTopic(cleanTag);
    } catch (error) {
      const cached = topicSearchCache.get(cleanTag);
      if (cached?.expiresAt > Date.now()) {
        data = await fetchTopic(cached.detail).catch(() => ({
          detail: cached.detail,
          feeds: [],
          sourceType: cached.detail.sourceType,
          sourceId: cached.detail.sourceId,
          sourceKey: cached.detail.sourceKey,
        }));
      } else {
        const suggestions = await searchTopics(cleanTag).catch(() => []);
        return sendJson(response, 404, {
          error: "未找到精确话题，请先搜索并从结果中选择",
          suggestions: suggestions.slice(0, 5),
        });
      }
    }
    if (!data.detail?.title || !data.sourceKey) {
      return sendJson(response, 404, { error: "未找到精确话题，请先搜索并从结果中选择" });
    }
    const existing = state.topics.find((item) => item.sourceKey === data.sourceKey || item.tag === data.detail.tag);
    if (existing) return sendJson(response, 409, { error: "该监控源已在列表中", topic: existing });
    const topic = { tag: data.detail.tag || data.detail.title || cleanTag, ...data, ai: { enabled: false, intent: "", threshold: null, notify: true, lastAnalyzedAt: null }, lastFetchedAt: new Date().toISOString(), lastError: null };
    state.topics.unshift(topic);
    await saveState();
    return sendJson(response, 201, { topic });
  }
  if (request.method === "POST" && url.pathname === "/api/refresh") {
    await pollAll();
    return sendJson(response, 200, { topics: state.topics, refreshedAt: state.lastPollAt });
  }
  const repliesMatch = url.pathname.match(/^\/api\/feeds\/(\d+)\/replies$/);
  if (repliesMatch && request.method === "GET") {
    const page = Math.max(1, Math.min(50, Number(url.searchParams.get("page") || 1)));
    return sendJson(response, 200, { replies: await fetchReplies(repliesMatch[1], page), page });
  }
  const feedMatch = url.pathname.match(/^\/api\/feeds\/(\d+)$/);
  if (feedMatch && request.method === "GET") {
    const page = Math.max(1, Math.min(50, Number(url.searchParams.get("page") || 1)));
    return sendJson(response, 200, await fetchFeedDetail(feedMatch[1], page));
  }
  const analyzeMatch = url.pathname.match(/^\/api\/topics\/([^/]+)\/analyze$/);
  if (analyzeMatch && request.method === "POST") {
    const tag = decodeURIComponent(analyzeMatch[1]);
    const body = await readJson(request);
    const evaluations = await analyzeTopicFeeds(tag, { force: body.force !== false, notify: Boolean(body.notify) });
    return sendJson(response, 200, { evaluations, count: evaluations.length });
  }
  const topicMatch = url.pathname.match(/^\/api\/topics\/([^/]+)$/);
  if (topicMatch && request.method === "PATCH") {
    const tag = decodeURIComponent(topicMatch[1]);
    const topic = state.topics.find((item) => item.tag === tag);
    if (!topic) return sendJson(response, 404, { error: "未找到该话题" });
    const body = await readJson(request);
    const ai = body.ai && typeof body.ai === "object" ? body.ai : {};
    const wasEnabled = Boolean(topic.ai?.enabled);
    topic.ai = {
      enabled: typeof ai.enabled === "boolean" ? ai.enabled : wasEnabled,
      intent: typeof ai.intent === "string" ? ai.intent.trim().slice(0, 1200) : String(topic.ai?.intent || ""),
      threshold: ai.threshold == null || ai.threshold === "" ? null : clampThreshold(ai.threshold),
      notify: typeof ai.notify === "boolean" ? ai.notify : topic.ai?.notify !== false,
      lastAnalyzedAt: topic.ai?.lastAnalyzedAt || null,
    };
    if (topic.ai.enabled && !topic.ai.intent) return sendJson(response, 400, { error: "启用 AI 筛选前请填写关注意图" });
    if (!wasEnabled && topic.ai.enabled && !settings.processedFeedIds[tag]) {
      settings.processedFeedIds[tag] = (topic.feeds || []).map((feed) => String(feed.id));
      await saveSettings();
    }
    await saveState();
    return sendJson(response, 200, { topic });
  }
  if (topicMatch && request.method === "DELETE") {
    const tag = decodeURIComponent(topicMatch[1]);
    const before = state.topics.length;
    state.topics = state.topics.filter((topic) => topic.tag !== tag);
    if (state.topics.length === before) return sendJson(response, 404, { error: "未找到该话题" });
    delete settings.processedFeedIds[tag];
    await Promise.all([saveState(), saveSettings()]);
    return sendJson(response, 200, { ok: true });
  }
  return sendJson(response, 404, { error: "接口不存在" });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url);
    if (!(await serveStatic(url.pathname, response))) sendJson(response, 404, { error: "页面不存在" });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: error.message || "服务器错误" });
  }
});

await Promise.all([loadState(), loadSettings()]);
state.nextPollAt = new Date(Date.now() + POLL_INTERVAL_MS).toISOString();
server.listen(PORT, () => {
  console.log(`酷安话题监控已启动：http://localhost:${PORT}`);
  void pollAll();
});

const timer = setInterval(() => void pollAll(), POLL_INTERVAL_MS);
timer.unref();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => process.exit(0));
  });
}

export { coolapkHeaders, feedSummary, topicSummary };
