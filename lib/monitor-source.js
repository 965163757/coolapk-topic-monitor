export function inferSourceType(detail = {}) {
  const explicit = String(detail.sourceType || detail.entityType || "").toLowerCase();
  if (explicit === "product") return "product";
  if (explicit === "topic" || explicit === "feedtopic") return "topic";
  return sourceFromUrl(detail.url).type;
}

export function isSupportedSource(detail = {}) {
  return Boolean(inferSourceType(detail));
}

function sourceFromUrl(value = "") {
  let pathname = "";
  try {
    pathname = new URL(String(value || "").trim(), "https://www.coolapk.com").pathname;
  } catch {
    pathname = String(value || "").trim().split(/[?#]/, 1)[0];
  }
  const topicMatch = pathname.match(/^\/t\/(.+)$/i);
  if (topicMatch) {
    try {
      return { type: "topic", tag: decodeURIComponent(topicMatch[1]), id: null };
    } catch {
      return { type: "topic", tag: topicMatch[1], id: null };
    }
  }
  const productMatch = pathname.match(/^\/product\/(\d{1,20})$/i);
  if (productMatch) return { type: "product", tag: "", id: productMatch[1] };
  return { type: "", tag: "", id: null };
}

export function canonicalSource(detail = {}, fallback = "") {
  const fallbackValue = String(fallback || "").trim();
  const routed = sourceFromUrl(detail.url);
  const type = routed.type || inferSourceType(detail) || (fallbackValue ? "topic" : "");
  const cleanId = (value) => value == null || String(value).trim() === ""
    ? null
    : typeof value === "string" ? value.trim() : value;
  const id = cleanId(detail.sourceId) ?? cleanId(routed.id) ?? cleanId(detail.id);
  const tag = String(
    type === "product"
      ? detail.title || detail.tag || fallbackValue
      : routed.tag || detail.tag || detail.tagname || detail.title || fallbackValue,
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
