export function normalizeKeywords(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[\n,，;；]+/);
  const seen = new Set();
  const keywords = [];
  for (const item of items) {
    const keyword = String(item || "").trim().replace(/\s+/g, " ").slice(0, 80);
    const key = keyword.toLocaleLowerCase("zh-CN");
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
    if (keywords.length >= 50) break;
  }
  return keywords;
}

export function normalizeRuleMode(value, rule = {}) {
  if (value === "keyword" || value === "ai") return value;
  const hasAiRule = Boolean(rule?.enabled && String(rule?.intent || "").trim());
  return !hasAiRule && normalizeKeywords(rule?.keywords).length ? "keyword" : "ai";
}

export function aiRuleInstructions(rule = {}) {
  const intent = String(rule?.intent || "").trim();
  const exclude = String(rule?.exclude || "").trim();
  return [
    `需要关注：${intent || "未填写"}`,
    `明确排除：${exclude || "无"}`,
    "判定要求：明确排除项优先级最高；只要帖子符合任意排除项，就必须显著降低 matchScore，通常不高于 0.1。信息隐晦、关键价格或条件缺失时不得猜测命中。只有在满足需要关注的条件，且不符合任何排除项时，才给出高匹配分。",
  ].join("\n");
}

export function matchFeedKeywords(feed = {}, value = []) {
  const keywords = normalizeKeywords(value);
  const text = [feed.title, feed.message, feed.topic]
    .map((item) => String(item || "").replace(/<[^>]+>/g, " "))
    .join("\n")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("zh-CN");
  const matchedKeywords = keywords.filter((keyword) => text.includes(keyword.toLocaleLowerCase("zh-CN")));
  return { matched: matchedKeywords.length > 0, matchedKeywords };
}

export function chunkItems(items, size) {
  const batchSize = Math.max(1, Math.min(20, Number(size) || 8));
  const chunks = [];
  for (let index = 0; index < items.length; index += batchSize) chunks.push(items.slice(index, index + batchSize));
  return chunks;
}

export function requiresNotification(evaluation = {}, topic = {}, feishuEnabled = false) {
  return Boolean(
    feishuEnabled
    && topic?.ai?.notify !== false
    && evaluation.status !== "error"
    && evaluation.matched
    && !evaluation.notified
    && (evaluation.deliveryPending === true || Boolean(evaluation.notificationError))
  );
}
