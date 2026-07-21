export const ARCHIVE_SCHEMA_VERSION = 1;

export const DEFAULT_RETENTION = Object.freeze({
  feedDays: 180,
  evaluationDays: 365,
  eventDays: 180,
  userDays: 45,
  maxFeeds: 30_000,
  maxEvaluations: 15_000,
  maxEvents: 5_000,
  cleanupIntervalHours: 24,
});

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clamp(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function asTime(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function compactText(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function evaluationKey(evaluation) {
  return `${String(evaluation?.topic || "")}\u0000${String(evaluation?.feedId || "")}`;
}

function topicMatchesFeed(topic, feed) {
  if (!topic) return false;
  return (feed.topicTags || []).includes(topic.tag) || (feed.sourceKeys || []).includes(topic.sourceKey);
}

function evaluationSortScore(evaluation) {
  if (!evaluation || evaluation.status === "error") return -1;
  if (Number.isFinite(Number(evaluation.matchScore))) return Number(evaluation.matchScore);
  return evaluation.matched ? Math.max(0, Math.min(1, Number(evaluation.confidence) || 0)) : 0;
}

function effectiveThresholdForTopic(topic) {
  const value = topic?.effectiveThreshold ?? topic?.ai?.effectiveThreshold;
  if (value == null || value === "") return null;
  const threshold = Number(value);
  return Number.isFinite(threshold) ? Math.max(0.1, Math.min(1, threshold)) : null;
}

export function resolveEvaluation(evaluation, topic = null) {
  if (!evaluation || typeof evaluation !== "object") return null;
  const numeric = (value) => {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const score = numeric(evaluation.matchScore);
  const storedThresholdAtEvaluation = numeric(evaluation.thresholdAtEvaluation);
  const thresholdAtEvaluation = storedThresholdAtEvaluation ?? numeric(evaluation.threshold);
  const matchedAtEvaluation = typeof evaluation.matchedAtEvaluation === "boolean"
    ? evaluation.matchedAtEvaluation
    : Boolean(evaluation.matched);
  const effectiveThreshold = effectiveThresholdForTopic(topic);
  const usesMatchScore = Number(evaluation.scoreVersion || 0) >= 2 && score != null;
  const currentThreshold = usesMatchScore && effectiveThreshold != null ? effectiveThreshold : thresholdAtEvaluation;
  const currentMatched = evaluation.status !== "error" && usesMatchScore && currentThreshold != null
    ? score >= currentThreshold
    : evaluation.status !== "error" && matchedAtEvaluation;
  return {
    ...evaluation,
    matchedAtEvaluation,
    thresholdAtEvaluation,
    currentMatched,
    currentThreshold,
    matched: currentMatched,
  };
}

export function pendingContinuationStart(nextPage, frontAnchorPage, overlapPages = 1) {
  const pendingPage = Math.max(2, Number(nextPage) || 2);
  const pageShift = Math.max(0, (Number(frontAnchorPage) || 1) - 1);
  const overlap = Math.max(0, Number(overlapPages) || 0);
  return Math.max(2, pendingPage + pageShift - overlap);
}

export function normalizeRetention(value = {}) {
  const input = plainObject(value);
  return {
    feedDays: clamp(input.feedDays, DEFAULT_RETENTION.feedDays, 7, 3_650),
    evaluationDays: clamp(input.evaluationDays, DEFAULT_RETENTION.evaluationDays, 7, 3_650),
    eventDays: clamp(input.eventDays, DEFAULT_RETENTION.eventDays, 7, 3_650),
    userDays: clamp(input.userDays, DEFAULT_RETENTION.userDays, 1, 365),
    maxFeeds: clamp(input.maxFeeds, DEFAULT_RETENTION.maxFeeds, 100, 100_000),
    maxEvaluations: clamp(input.maxEvaluations, DEFAULT_RETENTION.maxEvaluations, 100, 100_000),
    maxEvents: clamp(input.maxEvents, DEFAULT_RETENTION.maxEvents, 100, 50_000),
    cleanupIntervalHours: clamp(input.cleanupIntervalHours, DEFAULT_RETENTION.cleanupIntervalHours, 1, 168),
  };
}

export function createArchive(value = {}) {
  const input = plainObject(value);
  return {
    version: ARCHIVE_SCHEMA_VERSION,
    feeds: plainObject(input.feeds),
    evaluations: Array.isArray(input.evaluations) ? input.evaluations : [],
    users: plainObject(input.users),
    events: Array.isArray(input.events) ? input.events : [],
    maintenance: {
      lastCleanupAt: input.maintenance?.lastCleanupAt || null,
      lastCleanupSummary: plainObject(input.maintenance?.lastCleanupSummary),
    },
  };
}

export function archiveFeed(archive, feed, context = {}) {
  const id = String(feed?.id || "").trim();
  if (!id) return null;
  const now = context.now || new Date().toISOString();
  const existing = plainObject(archive.feeds[id]);
  const topicTags = uniqueStrings([...(existing.topicTags || []), context.topic, context.topicTag]);
  const sourceKeys = uniqueStrings([...(existing.sourceKeys || []), context.sourceKey]);
  const record = {
    ...existing,
    ...feed,
    id,
    topicTags,
    sourceKeys,
    firstSeenAt: existing.firstSeenAt || now,
    lastSeenAt: now,
    archivedAt: now,
  };
  archive.feeds[id] = record;
  return record;
}

export function archiveFeedDetail(archive, detail, context = {}) {
  const feed = detail?.feed || detail;
  const record = archiveFeed(archive, feed, context);
  if (!record) return null;
  const now = context.now || new Date().toISOString();
  const page = Number(context.page || detail?.page || 1);
  const existingDetail = plainObject(record.detail);
  record.detail = {
    ...existingDetail,
    feed: { ...plainObject(existingDetail.feed), ...plainObject(feed) },
    ...(page === 1 && Array.isArray(detail?.replies) ? { replies: detail.replies } : {}),
    page: page || existingDetail.page || 1,
    savedAt: now,
  };
  record.lastDetailAt = now;
  return record;
}

export function archiveUser(archive, user, now = new Date().toISOString()) {
  const uid = String(user?.uid || user?.id || "").trim();
  if (!uid) return null;
  const existing = plainObject(archive.users[uid]);
  const record = {
    ...existing,
    ...user,
    uid,
    firstSeenAt: existing.firstSeenAt || now,
    lastFetchedAt: now,
  };
  archive.users[uid] = record;
  return record;
}

export function appendArchiveEvent(archive, event, now = new Date().toISOString()) {
  const entry = {
    id: event?.id || `${now}-${Math.random().toString(36).slice(2, 8)}`,
    type: String(event?.type || "system"),
    level: String(event?.level || "info"),
    message: String(event?.message || "").slice(0, 500),
    topic: String(event?.topic || ""),
    sourceKey: String(event?.sourceKey || ""),
    feedId: event?.feedId == null ? "" : String(event.feedId),
    createdAt: event?.createdAt || now,
  };
  archive.events.unshift(entry);
  return entry;
}

function trimArrayByAgeAndLimit(items, dateField, cutoff, limit) {
  return items
    .filter((item) => asTime(item?.[dateField]) >= cutoff)
    .sort((left, right) => asTime(right?.[dateField]) - asTime(left?.[dateField]))
    .slice(0, limit);
}

export function cleanupArchive(archive, retentionInput = {}, nowInput = Date.now()) {
  const retention = normalizeRetention(retentionInput);
  const now = typeof nowInput === "number" ? nowInput : asTime(nowInput) || Date.now();
  const before = {
    feeds: Object.keys(archive.feeds || {}).length,
    evaluations: Array.isArray(archive.evaluations) ? archive.evaluations.length : 0,
    users: Object.keys(archive.users || {}).length,
    events: Array.isArray(archive.events) ? archive.events.length : 0,
  };

  const feedCutoff = now - retention.feedDays * 86_400_000;
  const feedRecords = Object.values(plainObject(archive.feeds))
    .filter((record) => asTime(record.lastSeenAt || record.createdAt) >= feedCutoff)
    .sort((left, right) => asTime(right.lastSeenAt || right.createdAt) - asTime(left.lastSeenAt || left.createdAt))
    .slice(0, retention.maxFeeds);
  archive.feeds = Object.fromEntries(feedRecords.map((record) => [String(record.id), record]));

  archive.evaluations = trimArrayByAgeAndLimit(
    Array.isArray(archive.evaluations) ? archive.evaluations : [],
    "evaluatedAt",
    now - retention.evaluationDays * 86_400_000,
    retention.maxEvaluations,
  );
  archive.events = trimArrayByAgeAndLimit(
    Array.isArray(archive.events) ? archive.events : [],
    "createdAt",
    now - retention.eventDays * 86_400_000,
    retention.maxEvents,
  );

  const userCutoff = now - retention.userDays * 86_400_000;
  archive.users = Object.fromEntries(Object.entries(plainObject(archive.users)).filter(([, record]) => asTime(record.lastFetchedAt || record.firstSeenAt) >= userCutoff));

  const after = {
    feeds: Object.keys(archive.feeds).length,
    evaluations: archive.evaluations.length,
    users: Object.keys(archive.users).length,
    events: archive.events.length,
  };
  const summary = {
    ...after,
    removed: {
      feeds: before.feeds - after.feeds,
      evaluations: before.evaluations - after.evaluations,
      users: before.users - after.users,
      events: before.events - after.events,
    },
    ranAt: new Date(now).toISOString(),
  };
  archive.maintenance = {
    ...plainObject(archive.maintenance),
    lastCleanupAt: summary.ranAt,
    lastCleanupSummary: summary,
  };
  return summary;
}

export function archiveSummary(archive) {
  return {
    feeds: Object.keys(plainObject(archive.feeds)).length,
    evaluations: Array.isArray(archive.evaluations) ? archive.evaluations.length : 0,
    users: Object.keys(plainObject(archive.users)).length,
    events: Array.isArray(archive.events) ? archive.events.length : 0,
    lastCleanupAt: archive.maintenance?.lastCleanupAt || null,
    lastCleanupSummary: plainObject(archive.maintenance?.lastCleanupSummary),
  };
}

export function latestEvaluations(items = []) {
  const latest = new Map();
  [...(Array.isArray(items) ? items : [])]
    .sort((left, right) => asTime(right?.evaluatedAt) - asTime(left?.evaluatedAt))
    .forEach((item) => {
      const key = evaluationKey(item);
      if (!latest.has(key)) latest.set(key, item);
    });
  return [...latest.values()];
}

export function evaluationSummary(items = [], topics = []) {
  const topicMap = new Map((Array.isArray(topics) ? topics : []).map((topic) => [String(topic.tag || ""), topic]));
  const records = latestEvaluations(items).map((item) => resolveEvaluation(item, topicMap.get(String(item.topic || ""))));
  return {
    total: records.length,
    matched: records.filter((item) => item.status !== "error" && item.matched).length,
    notified: records.filter((item) => item.notified).length,
    errors: records.filter((item) => item.status === "error").length,
  };
}

export function queryArchiveFeeds(archive, options = {}) {
  const topics = Array.isArray(options.topics) ? options.topics : [];
  const requestedTopic = String(options.topic || "").trim();
  const selectedTopic = requestedTopic ? topics.find((item) => item.tag === requestedTopic) : null;
  const monitoredOnly = options.monitoredOnly !== false;
  const query = compactText(options.q).toLowerCase();
  const aiStatus = options.aiStatus === "matched" ? "matched" : "all";
  const sort = ["created_desc", "created_asc", "updated_desc", "popular_desc", "ai_desc"].includes(options.sort) ? options.sort : "created_desc";
  const pageSize = Math.max(10, Math.min(100, Number(options.pageSize) || 20));
  const requestedPage = Math.max(1, Number(options.page) || 1);
  const latest = latestEvaluations(archive?.evaluations);
  const evaluationMap = new Map(latest.map((item) => [evaluationKey(item), item]));

  const records = Object.values(plainObject(archive?.feeds)).map((feed) => {
    const monitorTopics = selectedTopic
      ? (topicMatchesFeed(selectedTopic, feed) ? [selectedTopic] : [])
      : topics.filter((topic) => topicMatchesFeed(topic, feed));
    if (selectedTopic && !monitorTopics.length) return null;
    if (!selectedTopic && monitoredOnly && !monitorTopics.length) return null;
    const monitorAssociations = monitorTopics.map((topic) => ({
      topicTag: topic.tag,
      topicTitle: topic.detail?.title || topic.tag || "",
      evaluation: resolveEvaluation(evaluationMap.get(`${topic.tag}\u0000${String(feed.id)}`) || null, topic),
    })).sort((left, right) => evaluationSortScore(right.evaluation) - evaluationSortScore(left.evaluation));
    const preferredAssociation = monitorAssociations.find((item) => item.evaluation?.matched)
      || monitorAssociations.find((item) => item.evaluation)
      || monitorAssociations[0]
      || null;
    return {
      ...feed,
      monitorTopicTag: preferredAssociation?.topicTag || "",
      monitorTopicTitle: preferredAssociation?.topicTitle || "",
      monitorAssociations,
      evaluation: preferredAssociation?.evaluation || null,
    };
  }).filter(Boolean).filter((feed) => {
    const associationTitles = (feed.monitorAssociations || []).map((item) => item.topicTitle).join(" ");
    if (query && ![feed.title, feed.message, feed.username, feed.topic, feed.monitorTopicTitle, associationTitles].some((value) => compactText(value).toLowerCase().includes(query))) return false;
    if (aiStatus === "matched" && !(feed.monitorAssociations || []).some((item) => item.evaluation?.matched)) return false;
    return true;
  });

  records.sort((left, right) => {
    if (sort === "created_asc") return asTime(left.createdAt) - asTime(right.createdAt) || String(left.id).localeCompare(String(right.id));
    if (sort === "updated_desc") return asTime(right.updatedAt || right.createdAt) - asTime(left.updatedAt || left.createdAt) || String(right.id).localeCompare(String(left.id));
    if (sort === "popular_desc") {
      const popularity = (feed) => Number(feed.likes || 0) * 1_000 + Number(feed.comments || 0) * 20 + Number(feed.shares || 0) * 50;
      return popularity(right) - popularity(left) || asTime(right.createdAt) - asTime(left.createdAt);
    }
    if (sort === "ai_desc") return evaluationSortScore(right.evaluation) - evaluationSortScore(left.evaluation) || asTime(right.createdAt) - asTime(left.createdAt);
    return asTime(right.createdAt) - asTime(left.createdAt) || String(right.id).localeCompare(String(left.id));
  });

  const total = records.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;
  return {
    feeds: records.slice(offset, offset + pageSize),
    total,
    page,
    pageSize,
    totalPages,
    hasPrevious: page > 1,
    hasNext: page < totalPages,
  };
}

export function archivedFeedsForUser(archive, uid, limit = 20) {
  const userId = String(uid || "").trim();
  return Object.values(plainObject(archive.feeds))
    .filter((feed) => String(feed.userId || "") === userId)
    .sort((left, right) => asTime(right.lastSeenAt || right.createdAt) - asTime(left.lastSeenAt || left.createdAt))
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 20)));
}

export function archivedFeedDetail(archive, id) {
  return plainObject(archive.feeds)?.[String(id || "")]?.detail || null;
}
