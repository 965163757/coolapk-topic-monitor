export function parseBoundedInt(value, { min, max, fallback } = {}) {
  const lower = Number.isFinite(Number(min)) ? Math.trunc(Number(min)) : 0;
  const upperCandidate = Number.isFinite(Number(max)) ? Math.trunc(Number(max)) : Number.MAX_SAFE_INTEGER;
  const upper = Math.max(lower, upperCandidate);
  const fallbackCandidate = Number(fallback);
  const normalizedFallback = Number.isFinite(fallbackCandidate) && Number.isInteger(fallbackCandidate)
    ? Math.max(lower, Math.min(upper, fallbackCandidate))
    : lower;

  if (value == null || (typeof value === "string" && !value.trim())) return normalizedFallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return normalizedFallback;
  return Math.max(lower, Math.min(upper, parsed));
}

export function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(String(value ?? ""));
  } catch {
    throw Object.assign(new Error("URL 参数编码无效"), {
      statusCode: 400,
      code: "INVALID_URL_ENCODING",
    });
  }
}

export function parseJsonObjectBody(value) {
  const source = String(value ?? "");
  if (!source.trim()) return {};

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw Object.assign(new Error("请求体不是有效的 JSON"), {
      statusCode: 400,
      code: "INVALID_JSON_BODY",
    });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("请求体必须是 JSON 对象"), {
      statusCode: 400,
      code: "INVALID_JSON_BODY",
    });
  }
  return parsed;
}
