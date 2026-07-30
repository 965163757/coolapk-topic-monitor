export const IMAGE_CDN_ORIGIN_PARAM = "__origin";

/**
 * Accept only an HTTP(S) CDN origin. Credentials, query strings and fragments
 * are rejected so an environment value cannot accidentally leak into every
 * image URL.
 */
export function normalizeImageCdnBase(value = "") {
  const input = String(value || "").trim();
  if (!input) return "";
  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return "";
    }
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
    return url.href;
  } catch {
    return "";
  }
}

/**
 * Build a CDN URL that can safely pull the same image route from this origin.
 * The private-looking marker is deliberately not a secret: it only bypasses
 * the redirect so a CDN origin request cannot loop back to the CDN.
 */
export function imageCdnRedirectUrl(requestUrl, cdnBaseUrl) {
  const base = normalizeImageCdnBase(cdnBaseUrl);
  if (!base || requestUrl.searchParams.get(IMAGE_CDN_ORIGIN_PARAM) === "1") return "";
  const target = new URL(requestUrl.pathname.replace(/^\/+/, ""), base);
  for (const [key, value] of requestUrl.searchParams) target.searchParams.append(key, value);
  target.searchParams.set(IMAGE_CDN_ORIGIN_PARAM, "1");
  return target.href;
}

export function imageBrowserCacheControl() {
  return "public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=2592000, stale-if-error=2592000, immutable";
}

export function imageSurrogateCacheControl() {
  return "max-age=31536000, stale-while-revalidate=2592000, stale-if-error=2592000";
}
