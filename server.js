import { createServer } from "node:http";
import { createHash, randomInt } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { BATCH_MATCH_SCHEMA, MATCH_SCHEMA, buildFeishuFeedNotification, clampThreshold, feishuSignature, maskSecret, normalizeBatchMatchResults, normalizeMatchResult, validateFeishuWebhook } from "./lib/integrations.js";
import { canonicalSource, isSupportedSource, parseSourceKey } from "./lib/monitor-source.js";
import { AI_API_MODES, aiEndpoint, aiHeaders, dataUrlParts, extractAiText, inferAiProvider, isCompatibilityFailure, isUnsupportedImageInputError, normalizeAiApiMode, normalizeAiProvider, parseAiJson, preferredAiApiModes, requestBodyVariants, shouldTryAlternateAiApi } from "./lib/ai-compat.js";
import { appendArchiveEvent, archiveFeed, archiveFeedDetail, archiveSummary, archiveUser, archivedFeedDetail, archivedFeedsForUser, cleanupArchive, createArchive, evaluationSummary, latestEvaluations, normalizeRetention, pendingContinuationStart, queryArchiveFeeds, resolveEvaluation } from "./lib/store.js";
import { chunkItems, matchFeedKeywords, normalizeKeywords, requiresNotification } from "./lib/rules.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const STATE_FILE = join(ROOT, "data", "state.json");
const SETTINGS_FILE = join(ROOT, "data", "settings.json");
const ARCHIVE_FILE = join(ROOT, "data", "archive.json");
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5 * 60 * 1000);
const FEED_LIMIT = 20;
const MAX_FETCH_LIMIT = 100;
const MAX_FETCH_PAGES = 10;
const MAX_FRONT_SCAN_PAGES = 50;

const APP_ID = "wx7c6be4984041fa23";
const APP_SECRET = "a717e41f8e9254c52da78d70003f24a0";
const DEVICE_BRAND = "iPhone";
const DEVICE_MODEL = "unknown<iPhone18,3>";
const API_ROOT = "https://api.coolapk.com/v6";

const initialState = {
  version: 3,
  topics: [{ tag: "薅羊毛小分队", detail: null, feeds: [], fetch: { sort: "dateline_desc", limit: FEED_LIMIT }, lastFetchedAt: null, lastError: null }],
  lastPollAt: null,
  nextPollAt: null,
};

const defaultSettings = {
  ai: {
    enabled: false,
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    provider: "auto",
    model: "gpt-5.6-luna",
    apiMode: "auto",
    reasoningEffort: "low",
    includeImages: true,
    threshold: 0.72,
    batchSize: 8,
  },
  feishu: {
    enabled: false,
    webhookUrl: "",
    secret: "",
  },
  processedFeedIds: {},
  retention: normalizeRetention(),
};

let state = structuredClone(initialState);
let settings = structuredClone(defaultSettings);
let archive = createArchive();
let pollPromise = null;
let analysisPromise = null;
let persistenceQueue = Promise.resolve();
const runtime = { lastAiRunAt: null, lastAiError: null, lastNotificationAt: null, lastCleanupAt: null };
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

function epochMs(value) {
  const timestamp = Number(value || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
  return timestamp > 9_999_999_999 ? timestamp : timestamp * 1000;
}

function normalizeFetchSort(value) {
  return ["dateline_desc", "lastupdate_desc", "popular"].includes(value) ? value : "dateline_desc";
}

function normalizeTopicFetch(value = {}) {
  return {
    sort: normalizeFetchSort(value?.sort),
    limit: Math.max(10, Math.min(MAX_FETCH_LIMIT, Number(value?.limit) || FEED_LIMIT)),
  };
}

function feedSortValue(feed, sort) {
  if (sort === "lastupdate_desc") return Number(feed.updatedAt || feed.createdAt || 0);
  if (sort === "popular") return Number(feed.likes || 0) * 1_000 + Number(feed.comments || 0) * 20 + Number(feed.shares || 0) * 50;
  return Number(feed.createdAt || 0);
}

function sortFeeds(feeds, sort = "dateline_desc") {
  const normalizedSort = normalizeFetchSort(sort);
  return [...feeds].sort((left, right) => feedSortValue(right, normalizedSort) - feedSortValue(left, normalizedSort));
}

function feedSummary(feed) {
  return {
    id: feed.id,
    title: feed.message_title || feed.title || `${feed.username || "酷友"}的动态`,
    message: feed.message || "",
    username: feed.username || feed.userInfo?.username || "酷友",
    userId: String(feed.uid || feed.userInfo?.uid || feed.userInfo?.id || feed.user_id || ""),
    avatar: secureUrl(feed.userAvatar || feed.userInfo?.userAvatar || ""),
    pictures: (feed.picArr?.length ? feed.picArr : feed.pic ? [feed.pic] : []).map(secureUrl).slice(0, 3),
    likes: Number(feed.likenum || 0),
    comments: Number(feed.commentnum || 0),
    shares: Number(feed.forwardnum || feed.share_num || 0),
    createdAt: epochMs(feed.dateline || feed.create_time),
    updatedAt: epochMs(feed.lastupdate || feed.last_update || feed.dateline || feed.create_time),
    device: feed.device_title || "",
    topic: feed.ttitle || feed.topic || feed.tname || "",
    url: `https://www.coolapk.com/feed/${feed.id}`,
  };
}

function feedItems(data) {
  const result = [];
  const visit = (value, depth = 0) => {
    if (depth > 3 || value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    if (value.entityType === "feed" || (value.id && value.message !== undefined && (value.username || value.userInfo))) result.push(value);
    if (Array.isArray(value.entities)) visit(value.entities, depth + 1);
  };
  visit(data);
  return [...new Map(result.map((item) => [String(item.id), item])).values()];
}

function publicUserSummary(user = {}) {
  return {
    uid: String(user.uid || user.id || user.entityId || ""),
    username: String(user.username || user.displayUsername || user.title || "酷友"),
    avatar: secureUrl(user.userAvatar || user.userBigAvatar || user.logo || ""),
    cover: secureUrl(user.cover || ""),
    bio: String(user.bio || user.intro || user.description || ""),
    verifyLabel: String(user.verify_label || user.verify_title || ""),
    level: Number(user.level || 0),
    followers: Number(user.fans || user.fans_num || 0),
    following: Number(user.follow || user.follow_num || 0),
    feeds: Number(user.feed || user.feed_num || 0),
    likes: Number(user.be_like_num || 0),
    location: [user.province, user.city].filter(Boolean).join(" · "),
    url: user.url || (user.uid ? `/u/${user.uid}` : ""),
  };
}

function replySummary(reply) {
  return {
    id: reply.id,
    username: reply.username || reply.userInfo?.username || "酷友",
    userId: String(reply.uid || reply.userInfo?.uid || reply.userInfo?.id || ""),
    avatar: secureUrl(reply.userAvatar || reply.userInfo?.userAvatar || ""),
    message: reply.message || "",
    picture: secureUrl(reply.pic || ""),
    likes: Number(reply.likenum || 0),
    replyCount: Number(reply.replynum || 0),
    createdAt: epochMs(reply.dateline),
    isAuthor: Boolean(reply.isFeedAuthor),
    replyTo: reply.rusername || "",
    replies: (reply.replyRows || []).map(replySummary),
  };
}

async function fetchFeedDetail(id, page = 1) {
  try {
    const [detailPayload, replyPayload] = await Promise.all([
      coolapkGet("/feed/detail", { id }),
      fetchReplies(id, page),
    ]);
    const raw = detailPayload.data;
    const result = {
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
    archiveFeedDetail(archive, result, { page });
    await saveArchive();
    return result;
  } catch (error) {
    const cached = archivedFeedDetail(archive, id);
    if (cached?.feed && page === 1) return { ...cached, cached: true };
    throw error;
  }
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

async function fetchTopicFeedPage(detail, page) {
  return detail.sourceType === "product"
    ? coolapkGet("/page/dataList", { url: "/product/feedList", id: detail.sourceId, type: "feed", page, listType: "dateline_desc" })
    : coolapkGet("/topic/tagFeedList", { tag: detail.tag, page, listType: "dateline_desc" });
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
  const fetchConfig = normalizeTopicFetch(stored?.fetch);

  let detailPayload;
  if (requested.type === "product" && requested.id != null && String(requested.id)) {
    detailPayload = await coolapkGet("/product/detail", { id: requested.id });
  } else {
    detailPayload = await coolapkGet("/topic/newTagDetail", { tag: requested.tag });
  }
  if (!isSupportedSource(detailPayload.data)) throw new Error("该结果不是可监控的话题或数码产品");

  const detail = topicSummary(detailPayload.data);
  const pendingScan = stored?.scanCursor && Array.isArray(stored.scanCursor.cursorFeedIds)
    ? stored.scanCursor
    : null;
  const cursorFeedIds = pendingScan?.cursorFeedIds?.length
    ? pendingScan.cursorFeedIds
    : (stored?.feeds || []).map((feed) => String(feed.id));
  const knownFeedIds = new Set(cursorFeedIds.map(String));
  const discovered = new Map();
  const freshFeeds = new Map();
  const pageCache = new Map();
  let pagesFetched = 0;
  let scanComplete = false;
  let scanError = "";
  let failedPage = null;
  let lastContinuationPage = 0;
  let frontScanIncomplete = false;
  let currentFrontFeedIds = [];

  const fetchPage = async (page) => {
    if (pageCache.has(page)) return pageCache.get(page);
    let feedPayload;
    try {
      feedPayload = await fetchTopicFeedPage(detail, page);
    } catch (error) {
      if (page === 1) throw error;
      failedPage = page;
      scanError = `第 ${page} 页抓取失败：${error.message}`;
      return null;
    }
    pagesFetched += 1;
    const pageFeeds = feedItems(feedPayload.data).map(feedSummary);
    pageCache.set(page, pageFeeds);
    return pageFeeds;
  };

  const consumePage = (pageFeeds, { fresh = false } = {}) => {
    pageFeeds.forEach((feed) => {
      discovered.set(String(feed.id), feed);
      if (fresh) freshFeeds.set(String(feed.id), feed);
    });
    return pageFeeds.some((feed) => knownFeedIds.has(String(feed.id)));
  };

  if (pendingScan) {
    const frontAnchorFeedIds = new Set((pendingScan.frontAnchorFeedIds?.length
      ? pendingScan.frontAnchorFeedIds
      : pendingScan.cursorFeedIds || []).map(String));
    let frontAnchorPage = 0;
    for (let page = 1; page <= MAX_FRONT_SCAN_PAGES; page += 1) {
      const pageFeeds = await fetchPage(page);
      if (pageFeeds == null) { frontScanIncomplete = true; break; }
      if (!pageFeeds.length) { scanComplete = true; break; }
      if (page === 1) currentFrontFeedIds = pageFeeds.map((feed) => String(feed.id));
      if (consumePage(pageFeeds, { fresh: true })) { scanComplete = true; break; }
      if (pageFeeds.some((feed) => frontAnchorFeedIds.has(String(feed.id)))) {
        frontAnchorPage = page;
        break;
      }
    }
    if (!scanComplete && !frontAnchorPage && !frontScanIncomplete) {
      frontScanIncomplete = true;
      scanError = `前沿增量超过单轮 ${MAX_FRONT_SCAN_PAGES} 页扫描上限`;
    }
    if (!scanComplete && frontAnchorPage && !frontScanIncomplete) {
      const continuationStart = pendingContinuationStart(pendingScan.nextPage, frontAnchorPage);
      for (let offset = 0; offset < MAX_FETCH_PAGES; offset += 1) {
        const page = continuationStart + offset;
        lastContinuationPage = page;
        const pageFeeds = await fetchPage(page);
        if (pageFeeds == null) break;
        if (!pageFeeds.length) { scanComplete = true; break; }
        if (consumePage(pageFeeds)) { scanComplete = true; break; }
      }
    }
  } else {
    for (let page = 1; page <= MAX_FETCH_PAGES; page += 1) {
      lastContinuationPage = page;
      const pageFeeds = await fetchPage(page);
      if (pageFeeds == null) break;
      if (!pageFeeds.length) { scanComplete = true; break; }
      if (page === 1) currentFrontFeedIds = pageFeeds.map((feed) => String(feed.id));
      const reachedPreviousCursor = consumePage(pageFeeds, { fresh: true });
      if (reachedPreviousCursor || (!knownFeedIds.size && freshFeeds.size >= fetchConfig.limit)) {
        scanComplete = true;
        break;
      }
    }
  }
  const discoveredFeeds = [...discovered.values()];
  if (stored?.feeds?.length && !discoveredFeeds.length) throw new Error("动态列表返回空数据，已保留上次成功结果");
  if (!scanComplete && !scanError) scanError = `增量扫描达到单轮 ${MAX_FETCH_PAGES} 页上限`;
  const continuationPage = frontScanIncomplete
    ? Number(pendingScan?.nextPage || 2)
    : failedPage || Math.max(2, lastContinuationPage + 1);
  const scanCursor = scanComplete ? null : {
    cursorFeedIds: [...knownFeedIds],
    nextPage: continuationPage,
    frontAnchorFeedIds: frontScanIncomplete
      ? (pendingScan?.frontAnchorFeedIds || pendingScan?.cursorFeedIds || [])
      : currentFrontFeedIds,
    startedAt: pendingScan?.startedAt || new Date().toISOString(),
    lastAttemptAt: new Date().toISOString(),
  };
  const feeds = sortFeeds(freshFeeds.size ? [...freshFeeds.values()] : discoveredFeeds, "dateline_desc").slice(0, fetchConfig.limit);
  return {
    detail,
    feeds,
    discoveredFeeds,
    pagesFetched,
    scanComplete,
    scanError,
    scanCursor,
    sourceType: detail.sourceType,
    sourceId: detail.sourceId,
    sourceKey: detail.sourceKey,
    fetch: fetchConfig,
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

async function searchFeeds(keyword, page = 1, sort = "dateline_desc") {
  const q = String(keyword || "").trim();
  if (!q) return [];
  const payload = await coolapkGet("/search", {
    type: "feed",
    searchValue: q,
    page,
    showAnonymous: -1,
  }).catch(() => ({ data: [] }));
  const includesKeyword = (feed) => [feed.title, feed.message, feed.username, feed.topic]
    .some((value) => String(value || "").replace(/<[^>]+>/g, " ").toLowerCase().includes(q.toLowerCase()));
  const direct = feedItems(payload.data).map(feedSummary);
  const archived = Object.values(archive.feeds).filter(includesKeyword);
  const candidates = await searchTopics(q).catch(() => []);
  const topicFeeds = (await Promise.all(candidates.slice(0, 3).map((candidate) => fetchTopic({
    tag: candidate.tag || candidate.title,
    detail: candidate,
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    sourceKey: candidate.sourceKey,
    fetch: { sort: "dateline_desc", limit: FEED_LIMIT },
  }).then((result) => result.feeds).catch(() => [])))).flat();
  let fallback = [];
  if (![...direct, ...archived, ...topicFeeds].some(includesKeyword)) {
    const [recent, hot] = await Promise.all([
      coolapkGet("/topic/recentFeedList", { page: 1 }).catch(() => ({ data: [] })),
      coolapkGet("/topic/hotFeedList", { page: 1 }).catch(() => ({ data: [] })),
    ]);
    fallback = [...feedItems(recent.data), ...feedItems(hot.data)].map(feedSummary);
  }
  const feeds = sortFeeds(
    [...new Map([...direct, ...archived, ...topicFeeds, ...fallback].filter(includesKeyword).map((feed) => [String(feed.id), feed])).values()],
    sort,
  );
  const now = new Date().toISOString();
  feeds.forEach((feed) => archiveFeed(archive, feed, { sourceKey: `search:${q}`, topic: "帖子搜索", now }));
  if (feeds.length) await saveArchive();
  return feeds;
}

async function searchUsers(keyword, page = 1) {
  const q = String(keyword || "").trim();
  if (!q) return [];
  const payload = await coolapkGet("/search", {
    type: "user",
    searchValue: q,
    page,
    showAnonymous: -1,
  }).catch(() => ({ data: [] }));
  const remoteUsers = (payload.data || [])
    .filter((item) => item?.entityType === "user" || item?.uid || item?.userInfo?.uid)
    .map((item) => publicUserSummary(item.userInfo || item))
    .filter((item) => item.uid);
  const lowerQuery = q.toLowerCase();
  const localUsers = [
    ...Object.values(archive.users),
    ...Object.values(archive.feeds)
      .filter((feed) => String(feed.username || "").toLowerCase().includes(lowerQuery))
      .map((feed) => ({ uid: feed.userId, username: feed.username, avatar: feed.avatar, bio: "来自本地归档动态", followers: 0, following: 0, feeds: 0, likes: 0, location: "", verifyLabel: "", level: 0, url: feed.userId ? `/u/${feed.userId}` : "" })),
  ].filter((user) => user?.uid && String(user.username || "").toLowerCase().includes(lowerQuery));
  const users = [...new Map([...remoteUsers, ...localUsers].map((user) => [String(user.uid), user])).values()];
  const now = new Date().toISOString();
  users.forEach((user) => archiveUser(archive, user, now));
  if (users.length) await saveArchive();
  return [...new Map(users.map((user) => [user.uid, user])).values()];
}

async function fetchDiscoveryFeeds(mode = "recent", page = 1) {
  const normalizedMode = mode === "hot" ? "hot" : "recent";
  const path = normalizedMode === "hot" ? "/topic/hotFeedList" : "/topic/recentFeedList";
  const payload = await coolapkGet(path, { page });
  const sort = normalizedMode === "hot" ? "popular" : "dateline_desc";
  const feeds = sortFeeds(feedItems(payload.data).map(feedSummary), sort).slice(0, MAX_FETCH_LIMIT);
  const now = new Date().toISOString();
  feeds.forEach((feed) => archiveFeed(archive, feed, { sourceKey: `discovery:${normalizedMode}`, topic: "全站发现", now }));
  if (feeds.length) await saveArchive();
  return feeds;
}

async function fetchUserProfile(uid, { refresh = false } = {}) {
  const cleanUid = String(uid || "").trim();
  if (!/^\d{1,20}$/.test(cleanUid)) throw new Error("请输入有效的酷安用户 UID");
  const cached = archive.users[cleanUid];
  const cachedAt = new Date(cached?.lastFetchedAt || 0).getTime();
  if (!refresh && cached && Date.now() - cachedAt < 30 * 60 * 1000) {
    return { profile: cached, localFeeds: archivedFeedsForUser(archive, cleanUid), cached: true };
  }
  const payload = await coolapkGet("/user/profile", { uid: cleanUid });
  const profile = publicUserSummary(payload.data || {});
  if (!profile.uid) throw new Error("未找到该用户主页");
  archiveUser(archive, profile);
  await saveArchive();
  return { profile, localFeeds: archivedFeedsForUser(archive, profile.uid), cached: false };
}

function resolvedAiSettings() {
  return {
    ...settings.ai,
    baseUrl: process.env.OPENAI_BASE_URL || settings.ai.baseUrl,
    apiKey: process.env.OPENAI_API_KEY || settings.ai.apiKey,
    model: process.env.OPENAI_MODEL || settings.ai.model,
    provider: process.env.AI_PROVIDER || settings.ai.provider || "auto",
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

function effectiveTopicThreshold(topic) {
  return clampThreshold(topic?.ai?.threshold, clampThreshold(settings.ai.threshold));
}

function topicHasRules(topic) {
  return normalizeKeywords(topic?.ai?.keywords).length > 0 || Boolean(settings.ai.enabled && topic?.ai?.enabled && topic.ai.intent?.trim());
}

function topicsWithEffectiveThresholds() {
  return state.topics.map((topic) => ({ ...topic, effectiveThreshold: effectiveTopicThreshold(topic) }));
}

function currentEvaluation(evaluation) {
  const topic = state.topics.find((item) => item.tag === evaluation?.topic);
  return resolveEvaluation(evaluation, topic ? { ...topic, effectiveThreshold: effectiveTopicThreshold(topic) } : null);
}

function publicSettings() {
  const ai = resolvedAiSettings();
  const feishu = resolvedFeishuSettings();
  return {
    ai: {
      enabled: Boolean(settings.ai.enabled),
      baseUrl: ai.baseUrl,
      provider: normalizeAiProvider(ai.provider),
      detectedProvider: inferAiProvider(ai),
      model: ai.model,
      apiMode: normalizeAiApiMode(ai.apiMode),
      supportedApiModes: AI_API_MODES,
      reasoningEffort: settings.ai.reasoningEffort,
      includeImages: Boolean(settings.ai.includeImages),
      threshold: clampThreshold(settings.ai.threshold),
      batchSize: Math.max(1, Math.min(20, Number(process.env.AI_BATCH_SIZE || settings.ai.batchSize) || 8)),
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
    retention: normalizeRetention(settings.retention),
    archive: archiveSummary(archive),
  };
}

function publicTopicSnapshot(topic) {
  const archiveCount = Object.values(archive.feeds).filter((feed) => (
    (feed.topicTags || []).includes(topic.tag) || (feed.sourceKeys || []).includes(topic.sourceKey)
  )).length;
  const matchCount = latestEvaluations(archive.evaluations)
    .filter((item) => item.topic === topic.tag)
    .map((item) => resolveEvaluation(item, { ...topic, effectiveThreshold: effectiveTopicThreshold(topic) }))
    .filter((item) => item.matched).length;
  return {
    ...topic,
    archiveCount,
    matchCount,
    currentFeedCount: topic.feeds?.length || 0,
    ai: {
      ...topic.ai,
      effectiveThreshold: effectiveTopicThreshold(topic),
      thresholdSource: topic.ai?.threshold == null ? "global" : "topic",
    },
  };
}

function aiErrorMessage(failure) {
  const message = String(failure?.payload?.error?.message || failure?.payload?.message || failure?.payload?.detail?.message || "").trim();
  if (message) return message;
  if (failure?.response?.status === 404) {
    const endpoint = failure.mode === "responses" ? "/responses"
      : failure.mode === "anthropic_messages" ? "/messages"
        : failure.mode === "gemini_generate_content" ? "/models/{model}:generateContent"
          : "/chat/completions";
    return `AI 服务未提供 ${endpoint} 接口`;
  }
  return `AI 请求失败（HTTP ${failure?.response?.status || "未知"}）`;
}

async function requestAi(ai, bodies, timeoutMs) {
  if (!ai.apiKey) throw new Error("请先在系统设置中配置 AI API Key");
  const apiMode = normalizeAiApiMode(ai.apiMode);
  const modes = preferredAiApiModes(ai);
  let lastFailure;

  for (let index = 0; index < modes.length; index += 1) {
    const mode = modes[index];
    const body = bodies[mode];
    if (!body) continue;
    const variants = requestBodyVariants(mode, body);
    for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
      const response = await fetch(aiEndpoint(ai, mode), {
        method: "POST",
        headers: aiHeaders(ai, mode),
        body: JSON.stringify(variants[variantIndex]),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const raw = await response.text();
      let payload = {};
      try { payload = raw ? JSON.parse(raw) : {}; } catch { /* Some providers return an empty error response. */ }
      if (response.ok) return { mode, payload, compatibilityFallback: variantIndex > 0 };
      lastFailure = { mode, response, payload, raw };
      if (variantIndex < variants.length - 1 && isCompatibilityFailure(lastFailure)) continue;
      break;
    }
    if (apiMode === "auto" && index < modes.length - 1 && shouldTryAlternateAiApi(lastFailure)) continue;
    break;
  }
  throw new Error(aiErrorMessage(lastFailure));
}

function aiModeLabel(mode) {
  return {
    responses: "Responses API",
    chat_completions: "Chat Completions",
    anthropic_messages: "Anthropic Messages",
    gemini_generate_content: "Gemini GenerateContent",
  }[mode] || mode;
}

function aiImageCapabilityKey(ai) {
  return `${String(ai.baseUrl || "").replace(/\/+$/, "").toLowerCase()}|${String(ai.model || "").toLowerCase()}|${normalizeAiProvider(ai.provider)}|${normalizeAiApiMode(ai.apiMode)}`;
}

function classificationBodies(ai, prompt, imageUrls, { schema = MATCH_SCHEMA, schemaName = "topic_match", maxOutputTokens = 500 } = {}) {
  const systemInstruction = schemaName === "topic_match_batch"
    ? "你是高精度信息监控分类器。一次判断多条帖子，严格按关注意图分别判断。只输出 JSON 对象，顶层字段为 results；results 每项必须包含输入中的 feedId、matchScore、reason、evidence，顺序与输入一致且不得遗漏。matchScore 是帖子符合关注意图的程度：0 表示完全不符合，1 表示完全符合。"
    : "你是高精度信息监控分类器。严格按关注意图判断帖子是否值得提醒。只输出 JSON 对象，字段为 matchScore、reason、evidence。matchScore 是帖子符合关注意图的程度：0 表示完全不符合，1 表示完全符合；它不是对真假结论的把握度。";
  const responseContent = [
    { type: "input_text", text: prompt },
    ...imageUrls.map((imageUrl) => ({ type: "input_image", image_url: imageUrl, detail: "low" })),
  ];
  const chatContent = imageUrls.length
    ? [{ type: "text", text: prompt }, ...imageUrls.map((imageUrl) => ({ type: "image_url", image_url: { url: imageUrl, detail: "low" } }))]
    : prompt;
  const anthropicImages = imageUrls.map(dataUrlParts).filter(Boolean).map((image) => ({
    type: "image",
    source: { type: "base64", media_type: image.mediaType, data: image.data },
  }));
  const geminiImages = imageUrls.map(dataUrlParts).filter(Boolean).map((image) => ({
    inline_data: { mime_type: image.mediaType, data: image.data },
  }));
  return {
    responses: {
      model: ai.model,
      reasoning: { effort: settings.ai.reasoningEffort || "low" },
      max_output_tokens: maxOutputTokens,
      input: [
        { role: "system", content: [{ type: "input_text", text: systemInstruction }] },
        { role: "user", content: responseContent },
      ],
      text: { format: { type: "json_schema", name: schemaName, strict: true, schema } },
    },
    chat_completions: {
      model: ai.model,
      max_tokens: maxOutputTokens,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: chatContent },
      ],
      response_format: { type: "json_object" },
    },
    anthropic_messages: {
      model: ai.model,
      max_tokens: maxOutputTokens,
      system: systemInstruction,
      messages: [{ role: "user", content: [...anthropicImages, { type: "text", text: prompt }] }],
    },
    gemini_generate_content: {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: prompt }, ...geminiImages] }],
      generationConfig: { maxOutputTokens, responseMimeType: "application/json", responseSchema: schema },
    },
  };
}

async function writeJsonAtomic(file, payload) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, payload, "utf8");
  await rename(temporary, file);
}

function queueJsonWrite(file, value) {
  const payload = JSON.stringify(value, null, 2);
  persistenceQueue = persistenceQueue.catch(() => {}).then(() => writeJsonAtomic(file, payload));
  return persistenceQueue;
}

function saveSettings() {
  return queueJsonWrite(SETTINGS_FILE, settings);
}

function saveState() {
  return queueJsonWrite(STATE_FILE, state);
}

function saveArchive() {
  return queueJsonWrite(ARCHIVE_FILE, archive);
}

async function flushPersistence() {
  await persistenceQueue;
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
    "请用 matchScore 表示匹配程度；是否达到通知条件由系统阈值统一决定。",
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
  const output = extractAiText(result.payload, result.mode);
  if (!output) throw new Error("AI 未返回可解析的判断结果");
  const parsed = parseAiJson(output);
  return {
    ...normalizeMatchResult(parsed),
    model: ai.model,
    provider: inferAiProvider(ai),
    mode: result.mode,
    imageFallback,
    compatibilityFallback: Boolean(result.compatibilityFallback),
  };
}

async function classifyFeedBatch(topic, feeds) {
  if (feeds.length === 1) return new Map([[String(feeds[0].id), await classifyFeed(topic, feeds[0])]]);
  const ai = resolvedAiSettings();
  if (!settings.ai.enabled) throw new Error("AI 筛选总开关尚未开启");
  if (!ai.apiKey) throw new Error("请先在系统设置中配置 AI API Key");
  const intent = String(topic.ai?.intent || "").trim();
  if (!topic.ai?.enabled || !intent) throw new Error("该话题尚未配置 AI 关注意图");
  const items = feeds.map((feed) => ({
    feedId: String(feed.id),
    author: String(feed.username || "").slice(0, 100),
    title: String(feed.title || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 500),
    content: String(feed.message || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 4000),
  }));
  const prompt = [
    `监控话题：${topic.tag}`,
    `关注意图：${intent}`,
    "请分别判断以下帖子。不要因为不同帖子出现相同词语而混淆；每个 feedId 必须返回一项。宁可减少误报，不要只因个别关键词就判定命中。",
    JSON.stringify(items),
  ].join("\n");
  const result = await requestAi(ai, classificationBodies(ai, prompt, [], {
    schema: BATCH_MATCH_SCHEMA,
    schemaName: "topic_match_batch",
    maxOutputTokens: Math.min(4_000, Math.max(800, feeds.length * 350)),
  }), 60_000);
  const output = extractAiText(result.payload, result.mode);
  if (!output) throw new Error("AI 未返回可解析的批量判断结果");
  const normalized = normalizeBatchMatchResults(parseAiJson(output), feeds.map((feed) => String(feed.id)));
  const meta = {
    model: ai.model,
    provider: inferAiProvider(ai),
    mode: result.mode,
    imageFallback: Boolean(settings.ai.includeImages && feeds.some((feed) => feed.pictures?.length)),
    compatibilityFallback: Boolean(result.compatibilityFallback),
    batchSize: feeds.length,
  };
  for (const [feedId, value] of normalized) normalized.set(feedId, { ...value, ...meta });
  return normalized;
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

async function sendFeishuNotification(feed, evaluation) {
  if (!settings.feishu.enabled) return { sent: false, skipped: true };
  return postFeishu(buildFeishuFeedNotification(feed, evaluation));
}

async function testAiConnection() {
  const ai = resolvedAiSettings();
  const result = await requestAi(ai, {
    responses: { model: ai.model, input: "只回复：连接成功", max_output_tokens: 32 },
    chat_completions: { model: ai.model, messages: [{ role: "user", content: "只回复：连接成功" }], max_tokens: 32 },
    anthropic_messages: { model: ai.model, max_tokens: 32, messages: [{ role: "user", content: "只回复：连接成功" }] },
    gemini_generate_content: { contents: [{ role: "user", parts: [{ text: "只回复：连接成功" }] }], generationConfig: { maxOutputTokens: 32 } },
  }, 30_000);
  const response = extractAiText(result.payload, result.mode);
  return { ok: true, model: ai.model, provider: inferAiProvider(ai), mode: result.mode, modeLabel: aiModeLabel(result.mode), compatibilityFallback: Boolean(result.compatibilityFallback), response: response.slice(0, 100) };
}

async function analyzeTopicFeeds(tag, { force = false, notify = true, feeds: inputFeeds = null } = {}) {
  if (analysisPromise) throw new Error("已有 AI 分析任务正在运行");
  const task = (async () => {
    const topic = state.topics.find((item) => item.tag === tag);
    if (!topic) throw new Error("未找到该监控话题");
    const keywords = normalizeKeywords(topic.ai?.keywords);
    const aiEnabled = Boolean(settings.ai.enabled && topic.ai?.enabled && topic.ai.intent?.trim());
    if (!keywords.length && !aiEnabled) throw new Error("请先配置关键词或启用该话题的 AI 关注意图");
    const processed = new Set(settings.processedFeedIds[tag] || []);
    const latestByFeed = new Map(latestEvaluations(archive.evaluations)
      .filter((item) => item.topic === tag)
      .map((item) => [String(item.feedId), item]));
    const feeds = (Array.isArray(inputFeeds) ? inputFeeds : topic.feeds || []).filter((feed) => {
      if (force) return true;
      if (processed.has(String(feed.id))) return false;
      const previous = latestByFeed.get(String(feed.id));
      return !previous?.nextRetryAt || new Date(previous.nextRetryAt).getTime() <= Date.now();
    });
    const results = [];
    runtime.lastAiError = null;
    const classified = new Map();
    const failures = new Map();
    const aiCandidates = [];

    for (const feed of feeds) {
      const previous = latestByFeed.get(String(feed.id));
      if (!force && requiresNotification(previous, topic, settings.feishu.enabled)) {
        classified.set(String(feed.id), {
          matchScore: Number(previous.matchScore ?? previous.confidence ?? 1),
          reason: previous.reason,
          evidence: previous.evidence || [],
          model: previous.model,
          provider: previous.provider,
          mode: previous.apiMode,
          matchSource: previous.matchSource || "ai",
          batchSize: Number(previous.batchSize || 1),
          notificationRetry: true,
        });
        continue;
      }
      const keywordResult = matchFeedKeywords(feed, keywords);
      if (keywordResult.matched) {
        classified.set(String(feed.id), {
          matchScore: 1,
          reason: `关键词命中：${keywordResult.matchedKeywords.join("、")}`,
          evidence: keywordResult.matchedKeywords.map((keyword) => `命中关键词“${keyword}”`).slice(0, 4),
          model: "keyword-rule",
          provider: "local",
          mode: "keyword",
          matchSource: "keyword",
          batchSize: 1,
        });
      } else if (aiEnabled) {
        aiCandidates.push(feed);
      } else {
        processed.add(String(feed.id));
      }
    }

    const batchSize = Math.max(1, Math.min(20, Number(process.env.AI_BATCH_SIZE || settings.ai.batchSize) || 8));
    for (const batch of chunkItems(aiCandidates, batchSize)) {
      try {
        const batchResults = await classifyFeedBatch(topic, batch);
        for (const feed of batch) {
          const feedId = String(feed.id);
          if (batchResults.has(feedId)) classified.set(feedId, { ...batchResults.get(feedId), matchSource: "ai" });
          else {
            try {
              classified.set(feedId, { ...await classifyFeed(topic, feed), matchSource: "ai", batchFallback: true, batchSize: 1 });
            } catch (error) {
              failures.set(feedId, error);
            }
          }
        }
      } catch (batchError) {
        for (const feed of batch) {
          try {
            classified.set(String(feed.id), { ...await classifyFeed(topic, feed), matchSource: "ai", batchFallback: true, batchSize: 1 });
          } catch (error) {
            failures.set(String(feed.id), error?.message ? error : batchError);
          }
        }
      }
    }

    for (const [feedIndex, feed] of feeds.entries()) {
      const feedId = String(feed.id);
      const raw = classified.get(feedId);
      if (raw) {
        const threshold = effectiveTopicThreshold(topic);
        const keywordMatched = raw.matchSource === "keyword";
        const evaluation = {
          id: `${feed.id}-${Date.now()}-${feedIndex}`,
          topic: tag,
          feedId,
          title: feed.title,
          username: feed.username,
          feedUrl: feed.url,
          matched: keywordMatched || raw.matchScore >= threshold,
          matchedAtEvaluation: keywordMatched || raw.matchScore >= threshold,
          matchScore: raw.matchScore,
          scoreVersion: 2,
          threshold,
          thresholdAtEvaluation: threshold,
          reason: raw.reason,
          evidence: raw.evidence,
          model: raw.model,
          provider: raw.provider,
          apiMode: raw.mode,
          matchSource: raw.matchSource || "ai",
          matchedKeywords: keywordMatched ? raw.evidence.map((item) => item.replace(/^命中关键词“|”$/g, "")) : [],
          batchSize: Number(raw.batchSize || 1),
          batchFallback: Boolean(raw.batchFallback),
          notificationRetry: Boolean(raw.notificationRetry),
          imageFallback: Boolean(raw.imageFallback),
          compatibilityFallback: Boolean(raw.compatibilityFallback),
          sourceKey: topic.sourceKey || "",
          status: "completed",
          notified: false,
          deliveryPending: Boolean((keywordMatched || raw.matchScore >= threshold) && topic.ai.notify !== false && settings.feishu.enabled),
          notificationError: null,
          evaluatedAt: new Date().toISOString(),
        };
        if (evaluation.matched && notify && topic.ai.notify !== false) {
          try {
            const sent = await sendFeishuNotification(feed, evaluation);
            evaluation.notified = Boolean(sent.sent);
            if (evaluation.notified) evaluation.deliveryPending = false;
          } catch (error) {
            evaluation.notificationError = error.message;
            evaluation.deliveryPending = true;
            evaluation.nextRetryAt = new Date(Date.now() + 5 * 60_000).toISOString();
          }
        }
        archive.evaluations = archive.evaluations.filter((item) => !(
          item.topic === tag
          && String(item.feedId) === String(feed.id)
          && item.status === "error"
        ));
        archive.evaluations.unshift(evaluation);
        appendArchiveEvent(archive, {
          type: evaluation.matched ? "ai_matched" : "ai_evaluated",
          level: evaluation.matched ? "success" : "info",
          message: evaluation.matched ? `AI 命中「${evaluation.title}」` : `AI 已判断「${evaluation.title}」`,
          topic: tag,
          sourceKey: topic.sourceKey,
          feedId: feed.id,
        });
        results.push(evaluation);
        if (!evaluation.notificationError && !requiresNotification(evaluation, topic, settings.feishu.enabled)) processed.add(feedId);
        else processed.delete(feedId);
      } else if (failures.has(feedId)) {
        const error = failures.get(feedId);
        const previousError = latestByFeed.get(String(feed.id));
        const retryCount = previousError?.status === "error" ? Number(previousError.retryCount || 1) + 1 : 1;
        const retryMinutes = Math.min(60, 5 * (2 ** Math.min(4, retryCount - 1)));
        const evaluation = {
          id: `${feed.id}-${Date.now()}`,
          topic: tag,
          feedId: String(feed.id),
          title: feed.title,
          username: feed.username,
          feedUrl: feed.url,
          matched: false,
          matchScore: null,
          scoreVersion: 2,
          reason: error.message,
          evidence: [],
          model: resolvedAiSettings().model,
          provider: inferAiProvider(resolvedAiSettings()),
          apiMode: normalizeAiApiMode(resolvedAiSettings().apiMode),
          sourceKey: topic.sourceKey || "",
          status: "error",
          retryCount,
          nextRetryAt: new Date(Date.now() + retryMinutes * 60_000).toISOString(),
          notified: false,
          notificationError: null,
          evaluatedAt: new Date().toISOString(),
        };
        runtime.lastAiError = error.message;
        archive.evaluations = archive.evaluations.filter((item) => !(
          item.topic === tag
          && String(item.feedId) === String(feed.id)
          && item.status === "error"
        ));
        archive.evaluations.unshift(evaluation);
        appendArchiveEvent(archive, {
          type: "ai_error",
          level: "error",
          message: `AI 判断失败：${error.message}`,
          topic: tag,
          sourceKey: topic.sourceKey,
          feedId: feed.id,
        });
        results.push(evaluation);
        processed.delete(feedId);
      }
    }
    settings.processedFeedIds[tag] = [...processed].slice(-500);
    archive.evaluations = archive.evaluations.slice(0, normalizeRetention(settings.retention).maxEvaluations);
    topic.ai.lastAnalyzedAt = new Date().toISOString();
    runtime.lastAiRunAt = topic.ai.lastAnalyzedAt;
    await Promise.all([saveState(), saveArchive(), saveSettings()]);
    return results;
  })();
  analysisPromise = task;
  try { return await task; } finally { analysisPromise = null; }
}

async function loadState() {
  try {
    const stored = JSON.parse(await readFile(STATE_FILE, "utf8"));
    if (Array.isArray(stored.topics)) state = { ...structuredClone(initialState), ...stored, version: initialState.version };
  } catch (error) {
    if (error.code !== "ENOENT") console.error("读取监控状态失败：", error.message);
  }
  state.evaluations = Array.isArray(state.evaluations) ? state.evaluations.filter((item) => !(item.status === "error" && isUnsupportedImageInputError(item.reason))) : [];
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
      fetch: normalizeTopicFetch(topic.fetch),
      ai: {
        enabled: Boolean(topic.ai?.enabled),
        intent: String(topic.ai?.intent || ""),
        keywords: normalizeKeywords(topic.ai?.keywords),
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
      retention: normalizeRetention(stored.retention),
    };
  } catch (error) {
    if (error.code !== "ENOENT") console.error("读取系统设置失败：", error.message);
  }
}

async function loadArchive() {
  try {
    archive = createArchive(JSON.parse(await readFile(ARCHIVE_FILE, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") console.error("读取归档数据失败：", error.message);
  }
  const legacyEvaluations = Array.isArray(state.evaluations) ? state.evaluations : [];
  if (legacyEvaluations.length) {
    const existingIds = new Set(archive.evaluations.map((item) => String(item.id)));
    archive.evaluations = [...legacyEvaluations.filter((item) => !existingIds.has(String(item.id))), ...archive.evaluations]
      .sort((left, right) => new Date(right.evaluatedAt || 0) - new Date(left.evaluatedAt || 0));
  }
  archive.evaluations = archive.evaluations.filter((item) => !(item.status === "error" && isUnsupportedImageInputError(item.reason)));
  const topicsByTag = new Map(state.topics.map((topic) => [topic.tag, topic]));
  archive.evaluations = archive.evaluations.map((item) => {
    if (item.scoreVersion || item.status === "error") return item;
    const topic = topicsByTag.get(item.topic);
    const effectiveThreshold = topic ? effectiveTopicThreshold(topic) : clampThreshold(item.threshold);
    const inheritedThresholdBug = topic?.ai?.threshold == null && Number(item.threshold) === 0.1 && effectiveThreshold > 0.1;
    return {
      ...item,
      ...(inheritedThresholdBug ? { threshold: effectiveThreshold, matched: Boolean(item.matched && Number(item.confidence || 0) >= effectiveThreshold) } : {}),
      matchedAtEvaluation: inheritedThresholdBug ? Boolean(item.matched && Number(item.confidence || 0) >= effectiveThreshold) : Boolean(item.matched),
      thresholdAtEvaluation: inheritedThresholdBug ? effectiveThreshold : clampThreshold(item.threshold),
      scoreVersion: 1,
      scoreSemantics: "legacy_decision_confidence",
    };
  });
  const topicsByNotificationTag = new Map(state.topics.map((topic) => [topic.tag, topic]));
  for (const item of latestEvaluations(archive.evaluations).filter((evaluation) => (
    evaluation.status === "error"
    || evaluation.notificationError
    || requiresNotification(evaluation, topicsByNotificationTag.get(evaluation.topic), settings.feishu.enabled)
  ))) {
    const processed = new Set(settings.processedFeedIds[item.topic] || []);
    if (processed.delete(String(item.feedId))) settings.processedFeedIds[item.topic] = [...processed];
  }
  delete state.evaluations;
  const summary = cleanupArchive(archive, settings.retention);
  runtime.lastCleanupAt = summary.ranAt;
  await Promise.all([saveState(), saveSettings(), saveArchive()]);
}

async function refreshTopic(tag) {
  const index = state.topics.findIndex((topic) => topic.tag === tag);
  if (index < 0) throw new Error("该话题未被监控");
  const now = new Date().toISOString();
  let refreshedFeeds = [];
  try {
    const data = await fetchTopic(state.topics[index]);
    const { discoveredFeeds, pagesFetched, scanComplete, scanError, scanCursor, ...topicData } = data;
    refreshedFeeds = discoveredFeeds || data.feeds;
    (discoveredFeeds || data.feeds).forEach((feed) => archiveFeed(archive, feed, { topic: state.topics[index].tag, sourceKey: state.topics[index].sourceKey, now }));
    if (scanComplete) {
      state.topics[index] = {
        ...state.topics[index],
        ...topicData,
        scanCursor: null,
        lastAttemptAt: now,
        lastFetchedAt: now,
        lastError: null,
      };
    } else {
      const { feeds: _freshFeeds, ...stableTopicData } = topicData;
      state.topics[index] = {
        ...state.topics[index],
        ...stableTopicData,
        scanCursor,
        lastAttemptAt: now,
        lastError: `${scanError || "增量扫描尚未完成"}；已保存本轮数据并保留原游标，将从第 ${scanCursor?.nextPage || 2} 页续抓`,
      };
    }
    appendArchiveEvent(archive, {
      type: scanComplete ? "fetch_completed" : "fetch_partial",
      level: scanComplete ? "success" : "warning",
      message: scanComplete
        ? `已抓取 ${discoveredFeeds?.length || data.feeds.length} 条动态（${pagesFetched || 1} 页）`
        : `已暂存 ${discoveredFeeds?.length || data.feeds.length} 条动态（${pagesFetched || 1} 页），下轮从第 ${scanCursor?.nextPage || 2} 页续抓`,
      topic: state.topics[index].tag,
      sourceKey: state.topics[index].sourceKey,
      createdAt: now,
    });
  } catch (error) {
    state.topics[index].lastError = error.message;
    state.topics[index].lastAttemptAt = now;
    appendArchiveEvent(archive, {
      type: "fetch_error",
      level: "error",
      message: `抓取失败：${error.message}`,
      topic: state.topics[index].tag,
      sourceKey: state.topics[index].sourceKey,
      createdAt: now,
    });
    throw error;
  } finally {
    await Promise.all([saveState(), saveArchive()]);
  }
  return { topic: state.topics[index], discoveredFeeds: refreshedFeeds };
}

async function runMaintenance({ force = false } = {}) {
  const retention = normalizeRetention(settings.retention);
  const previous = new Date(archive.maintenance?.lastCleanupAt || 0).getTime();
  if (!force && previous && Date.now() - previous < retention.cleanupIntervalHours * 3_600_000) {
    return { skipped: true, ...archiveSummary(archive) };
  }
  const summary = cleanupArchive(archive, retention);
  runtime.lastCleanupAt = summary.ranAt;
  appendArchiveEvent(archive, {
    type: "maintenance_cleanup",
    level: "info",
    message: `定时清理完成：移除 ${summary.removed.feeds + summary.removed.evaluations + summary.removed.users + summary.removed.events} 条过期数据`,
    createdAt: summary.ranAt,
  });
  await saveArchive();
  return { skipped: false, ...summary };
}

async function pollAll() {
  if (pollPromise) return pollPromise;
  pollPromise = (async () => {
    state.lastPollAt = new Date().toISOString();
    state.nextPollAt = new Date(Date.now() + POLL_INTERVAL_MS).toISOString();
    const tags = state.topics.map((topic) => topic.tag);
    const analysisBatches = [];
    for (const tag of tags) {
      let discoveredFeeds = [];
      try {
        const refresh = await refreshTopic(tag);
        discoveredFeeds = refresh.discoveredFeeds;
      } catch (error) {
        console.error(`刷新“${tag}”失败：`, error.message);
      }
      const topic = state.topics.find((item) => item.tag === tag);
      if (topicHasRules(topic)) {
        const retryFeeds = latestEvaluations(archive.evaluations)
          .filter((item) => item.topic === tag && (
            item.status === "error"
            || item.notificationError
            || requiresNotification(item, topic, settings.feishu.enabled)
          ))
          .filter((item) => !item.nextRetryAt || new Date(item.nextRetryAt).getTime() <= Date.now())
          .map((item) => archive.feeds[String(item.feedId)])
          .filter(Boolean);
        const feeds = [...new Map([...discoveredFeeds, ...retryFeeds].map((feed) => [String(feed.id), feed])).values()];
        if (feeds.length) analysisBatches.push({ tag, feeds });
      }
    }
    for (const batch of analysisBatches) {
      try { await analyzeTopicFeeds(batch.tag, { force: false, notify: true, feeds: batch.feeds }); }
      catch (error) { runtime.lastAiError = error.message; console.error(`AI 分析“${batch.tag}”失败：`, error.message); }
    }
    await Promise.all([saveState(), runMaintenance()]);
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
  const stream = Readable.fromWeb(upstream.body);
  stream.on("error", (error) => {
    console.warn(`图片代理流中断：${error.message}`);
    if (!response.destroyed) response.destroy();
  });
  response.on("close", () => {
    if (!stream.destroyed) stream.destroy();
  });
  stream.pipe(response);
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/image") {
    return proxyImage(url.searchParams.get("url") || "", response);
  }
  if (request.method === "GET" && url.pathname === "/api/health") {
    return sendJson(response, 200, { ok: true, uptimeSeconds: Math.round(process.uptime()), topics: state.topics.length, archive: archiveSummary(archive), now: new Date().toISOString() });
  }
  if (request.method === "GET" && url.pathname === "/api/status") {
    return sendJson(response, 200, {
      intervalMs: POLL_INTERVAL_MS,
      lastPollAt: state.lastPollAt,
      nextPollAt: state.nextPollAt,
      refreshing: Boolean(pollPromise),
      ai: publicSettings().runtime,
      archive: archiveSummary(archive),
      retention: normalizeRetention(settings.retention),
    });
  }
  if (request.method === "GET" && url.pathname === "/api/settings") {
    return sendJson(response, 200, publicSettings());
  }
  if (request.method === "PUT" && url.pathname === "/api/settings") {
    const body = await readJson(request);
    const wasFeishuEnabled = Boolean(settings.feishu.enabled);
    if (body.ai && typeof body.ai === "object") {
      const next = body.ai;
      if (typeof next.enabled === "boolean") settings.ai.enabled = next.enabled;
      if (typeof next.baseUrl === "string" && next.baseUrl.trim()) {
        const parsed = new URL(next.baseUrl.trim());
        const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
        if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) return sendJson(response, 400, { error: "AI API 地址必须使用 HTTPS（本机地址除外）" });
        settings.ai.baseUrl = parsed.toString().replace(/\/$/, "");
      }
      if (AI_API_MODES.includes(next.apiMode)) settings.ai.apiMode = next.apiMode;
      if (["auto", "openai", "anthropic", "gemini"].includes(next.provider)) settings.ai.provider = next.provider;
      if (typeof next.model === "string" && next.model.trim()) settings.ai.model = next.model.trim().slice(0, 100);
      if (["none", "low", "medium", "high"].includes(next.reasoningEffort)) settings.ai.reasoningEffort = next.reasoningEffort;
      if (typeof next.includeImages === "boolean") settings.ai.includeImages = next.includeImages;
      if (next.threshold != null) settings.ai.threshold = clampThreshold(next.threshold);
      if (next.batchSize != null) settings.ai.batchSize = Math.max(1, Math.min(20, Number(next.batchSize) || 8));
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
    if (!wasFeishuEnabled && settings.feishu.enabled) {
      const topicMap = new Map(state.topics.map((topic) => [topic.tag, topic]));
      for (const item of latestEvaluations(archive.evaluations)) {
        if (!requiresNotification(item, topicMap.get(item.topic), true)) continue;
        const processed = new Set(settings.processedFeedIds[item.topic] || []);
        processed.delete(String(item.feedId));
        settings.processedFeedIds[item.topic] = [...processed];
      }
    }
    if (body.retention && typeof body.retention === "object") settings.retention = normalizeRetention({ ...settings.retention, ...body.retention });
    appendArchiveEvent(archive, { type: "settings_updated", level: "info", message: "系统集成与数据留存设置已更新" });
    await Promise.all([saveSettings(), saveArchive()]);
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
    const statusFilter = url.searchParams.get("status") || "all";
    const pageSize = Math.max(10, Math.min(500, Number(url.searchParams.get("pageSize") || url.searchParams.get("limit") || 200)));
    const requestedPage = Math.max(1, Number(url.searchParams.get("page") || 1));
    const topicEvaluations = latestEvaluations(archive.evaluations)
      .map(currentEvaluation)
      .filter((item) => !tag || item.topic === tag);
    const records = topicEvaluations.filter((item) => statusFilter !== "matched" || item.matched);
    const total = records.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const evaluations = records.slice((page - 1) * pageSize, page * pageSize);
    return sendJson(response, 200, {
      evaluations,
      stats: evaluationSummary(topicEvaluations, topicsWithEffectiveThresholds().filter((topic) => !tag || topic.tag === tag)),
      total,
      page,
      pageSize,
      totalPages,
    });
  }
  if (request.method === "GET" && url.pathname === "/api/archive/summary") {
    return sendJson(response, 200, { archive: archiveSummary(archive), retention: normalizeRetention(settings.retention) });
  }
  if (request.method === "GET" && url.pathname === "/api/archive/feeds") {
    const topic = String(url.searchParams.get("topic") || "").trim();
    const uid = String(url.searchParams.get("uid") || "").trim();
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 50)));
    const feeds = Object.values(archive.feeds)
      .filter((feed) => !topic || (feed.topicTags || []).includes(topic))
      .filter((feed) => !uid || String(feed.userId || "") === uid)
      .sort((left, right) => new Date(right.lastSeenAt || right.createdAt || 0) - new Date(left.lastSeenAt || left.createdAt || 0))
      .slice(0, limit);
    return sendJson(response, 200, { feeds });
  }
  if (request.method === "GET" && url.pathname === "/api/dashboard/feeds") {
    const topic = String(url.searchParams.get("topic") || "").trim();
    if (topic && !state.topics.some((item) => item.tag === topic)) return sendJson(response, 404, { error: "未找到该监控话题" });
    const result = queryArchiveFeeds(archive, {
      topics: topicsWithEffectiveThresholds(),
      topic,
      monitoredOnly: true,
      q: url.searchParams.get("q") || "",
      aiStatus: url.searchParams.get("ai") || "all",
      sort: url.searchParams.get("sort") || "created_desc",
      page: url.searchParams.get("page") || 1,
      pageSize: url.searchParams.get("pageSize") || 20,
    });
    return sendJson(response, 200, result);
  }
  if (request.method === "GET" && url.pathname === "/api/activity") {
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 100)));
    return sendJson(response, 200, { events: archive.events.slice(0, limit) });
  }
  if (request.method === "POST" && url.pathname === "/api/maintenance/cleanup") {
    return sendJson(response, 200, await runMaintenance({ force: true }));
  }
  if (request.method === "GET" && url.pathname === "/api/search/feeds") {
    const q = String(url.searchParams.get("q") || "").trim();
    if (!q) return sendJson(response, 400, { error: "请输入帖子搜索关键词" });
    const page = Math.max(1, Math.min(50, Number(url.searchParams.get("page") || 1)));
    const sort = normalizeFetchSort(url.searchParams.get("sort") || "dateline_desc");
    return sendJson(response, 200, { feeds: await searchFeeds(q, page, sort), q, page, sort });
  }
  if (request.method === "GET" && url.pathname === "/api/search/users") {
    const q = String(url.searchParams.get("q") || "").trim();
    if (!q) return sendJson(response, 400, { error: "请输入用户昵称或 UID" });
    const page = Math.max(1, Math.min(50, Number(url.searchParams.get("page") || 1)));
    return sendJson(response, 200, { users: await searchUsers(q, page), q, page });
  }
  if (request.method === "GET" && url.pathname === "/api/discovery/feeds") {
    const mode = url.searchParams.get("mode") === "hot" ? "hot" : "recent";
    const page = Math.max(1, Math.min(50, Number(url.searchParams.get("page") || 1)));
    return sendJson(response, 200, { feeds: await fetchDiscoveryFeeds(mode, page), mode, page });
  }
  const userMatch = url.pathname.match(/^\/api\/users\/(\d+)$/);
  if (userMatch && request.method === "GET") {
    const refresh = url.searchParams.get("refresh") === "1";
    return sendJson(response, 200, await fetchUserProfile(userMatch[1], { refresh }));
  }
  if (request.method === "GET" && url.pathname === "/api/topics") {
    return sendJson(response, 200, { topics: state.topics.map(publicTopicSnapshot) });
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
          fetch: normalizeTopicFetch(),
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
    const now = new Date().toISOString();
    const { discoveredFeeds, pagesFetched: _pagesFetched, scanComplete, scanError, scanCursor, ...topicData } = data;
    const initialScanComplete = scanComplete !== false;
    const topic = {
      tag: topicData.detail.tag || topicData.detail.title || cleanTag,
      ...topicData,
      fetch: normalizeTopicFetch(topicData.fetch),
      ai: { enabled: false, intent: "", keywords: [], threshold: null, notify: true, lastAnalyzedAt: null },
      scanCursor: scanCursor || null,
      lastAttemptAt: now,
      lastFetchedAt: initialScanComplete ? now : null,
      lastError: initialScanComplete ? null : `${scanError || "首次扫描尚未完成"}；已保存本轮数据，将从第 ${scanCursor?.nextPage || 2} 页续抓`,
    };
    state.topics.unshift(topic);
    (discoveredFeeds || topic.feeds || []).forEach((feed) => archiveFeed(archive, feed, { topic: topic.tag, sourceKey: topic.sourceKey, now }));
    appendArchiveEvent(archive, { type: "monitor_added", level: "success", message: `已添加监控：${topic.detail?.title || topic.tag}`, topic: topic.tag, sourceKey: topic.sourceKey, createdAt: now });
    await Promise.all([saveState(), saveArchive()]);
    return sendJson(response, 201, { topic: publicTopicSnapshot(topic) });
  }
  if (request.method === "POST" && url.pathname === "/api/refresh") {
    await pollAll();
    return sendJson(response, 200, { topics: state.topics, refreshedAt: state.lastPollAt });
  }
  const repliesMatch = url.pathname.match(/^\/api\/feeds\/(\d+)\/replies$/);
  if (repliesMatch && request.method === "GET") {
    const page = Math.max(1, Math.min(50, Number(url.searchParams.get("page") || 1)));
    const replies = await fetchReplies(repliesMatch[1], page);
    const record = archive.feeds[repliesMatch[1]];
    if (record && page === 1) {
      record.detail = { ...(record.detail || {}), replies, page, savedAt: new Date().toISOString() };
      await saveArchive();
    }
    return sendJson(response, 200, { replies, page });
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
    const fetchConfig = body.fetch && typeof body.fetch === "object" ? body.fetch : {};
    const previousRuleSignature = JSON.stringify({
      enabled: Boolean(topic.ai?.enabled),
      intent: String(topic.ai?.intent || ""),
      keywords: normalizeKeywords(topic.ai?.keywords),
      notify: topic.ai?.notify !== false,
    });
    topic.ai = {
      enabled: typeof ai.enabled === "boolean" ? ai.enabled : Boolean(topic.ai?.enabled),
      intent: typeof ai.intent === "string" ? ai.intent.trim().slice(0, 1200) : String(topic.ai?.intent || ""),
      keywords: ai.keywords == null ? normalizeKeywords(topic.ai?.keywords) : normalizeKeywords(ai.keywords),
      threshold: ai.threshold == null || ai.threshold === "" ? null : clampThreshold(ai.threshold),
      notify: typeof ai.notify === "boolean" ? ai.notify : topic.ai?.notify !== false,
      lastAnalyzedAt: topic.ai?.lastAnalyzedAt || null,
    };
    topic.fetch = normalizeTopicFetch({ ...topic.fetch, ...fetchConfig });
    if (topic.ai.enabled && !topic.ai.intent) return sendJson(response, 400, { error: "启用 AI 筛选前请填写关注意图" });
    const nextRuleSignature = JSON.stringify({ enabled: topic.ai.enabled, intent: topic.ai.intent, keywords: topic.ai.keywords, notify: topic.ai.notify });
    if (previousRuleSignature !== nextRuleSignature) settings.processedFeedIds[tag] = [];
    appendArchiveEvent(archive, {
      type: "monitor_updated",
      level: "info",
      message: `已更新监控规则，抓取排序：${topic.fetch.sort}`,
      topic: topic.tag,
      sourceKey: topic.sourceKey,
    });
    await Promise.all([saveState(), saveArchive()]);
    return sendJson(response, 200, { topic: publicTopicSnapshot(topic) });
  }
  if (topicMatch && request.method === "DELETE") {
    const tag = decodeURIComponent(topicMatch[1]);
    const before = state.topics.length;
    state.topics = state.topics.filter((topic) => topic.tag !== tag);
    if (state.topics.length === before) return sendJson(response, 404, { error: "未找到该话题" });
    delete settings.processedFeedIds[tag];
    appendArchiveEvent(archive, { type: "monitor_removed", level: "info", message: `已停止监控：${tag}`, topic: tag });
    await Promise.all([saveState(), saveSettings(), saveArchive()]);
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

await loadState();
await loadSettings();
await loadArchive();
state.nextPollAt = new Date(Date.now() + POLL_INTERVAL_MS).toISOString();
server.listen(PORT, HOST, () => {
  console.log(`酷安话题监控已启动：http://${HOST}:${PORT}`);
  void pollAll();
});

const timer = setInterval(() => void pollAll(), POLL_INTERVAL_MS);
timer.unref();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => {
      void (async () => {
        await Promise.all([saveState(), saveSettings(), saveArchive()]);
        await flushPersistence();
        process.exit(0);
      })();
    });
  });
}

export { coolapkHeaders, feedSummary, topicSummary };
