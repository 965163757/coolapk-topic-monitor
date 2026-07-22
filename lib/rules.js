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
