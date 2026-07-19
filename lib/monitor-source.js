export function inferSourceType(detail = {}) {
  const explicit = String(detail.sourceType || detail.entityType || "").toLowerCase();
  if (explicit === "product") return "product";
  if (explicit === "topic" || explicit === "feedtopic") return "topic";
  const url = String(detail.url || "");
  if (/^\/product\//i.test(url)) return "product";
  if (/^\/t\//i.test(url)) return "topic";
  return "";
}

export function isSupportedSource(detail = {}) {
  return Boolean(inferSourceType(detail));
}

export function canonicalSource(detail = {}, fallback = "") {
  const fallbackValue = String(fallback || "").trim();
  const type = inferSourceType(detail) || (fallbackValue ? "topic" : "");
  const id = detail.sourceId ?? detail.id ?? null;
  const tag = String(
    type === "product"
      ? detail.title || detail.tag || fallbackValue
      : detail.tag || detail.tagname || detail.title || fallbackValue,
  ).trim();
  const key = type === "product" && id != null && String(id)
    ? `product:${id}`
    : type === "topic" && tag
      ? `topic:${tag}`
      : "";
  return { type, id, tag, key };
}

export function parseSourceKey(value = "") {
  const key = String(value || "").trim();
  if (key.startsWith("product:")) {
    const id = key.slice("product:".length).trim();
    return { type: "product", id, tag: "", key: id ? `product:${id}` : "" };
  }
  if (key.startsWith("topic:")) {
    const tag = key.slice("topic:".length).trim();
    return { type: "topic", id: null, tag, key: tag ? `topic:${tag}` : "" };
  }
  return { type: "topic", id: null, tag: key, key: key ? `topic:${key}` : "" };
}
