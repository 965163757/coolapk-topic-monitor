import test from "node:test";
import assert from "node:assert/strict";
import {
  IMAGE_CDN_ORIGIN_PARAM,
  imageBrowserCacheControl,
  imageCdnRedirectUrl,
  imageSurrogateCacheControl,
  normalizeImageCdnBase,
} from "../lib/image-delivery.js";

test("normalizes safe image CDN origins", () => {
  assert.equal(normalizeImageCdnBase("https://cdn.example.com"), "https://cdn.example.com/");
  assert.equal(normalizeImageCdnBase("https://cdn.example.com/assets/"), "https://cdn.example.com/assets/");
  assert.equal(normalizeImageCdnBase("ftp://cdn.example.com"), "");
  assert.equal(normalizeImageCdnBase("https://user:pass@cdn.example.com"), "");
  assert.equal(normalizeImageCdnBase("https://cdn.example.com/?token=secret"), "");
});

test("builds a cacheable CDN image URL and prevents origin redirect loops", () => {
  const request = new URL(
    "http://origin.example.com/api/image?url=https%3A%2F%2Fimage.coolapk.com%2Fa.jpg&w=720&q=78&format=webp",
  );
  const redirected = new URL(imageCdnRedirectUrl(request, "https://cdn.example.com/cache"));
  assert.equal(redirected.origin, "https://cdn.example.com");
  assert.equal(redirected.pathname, "/cache/api/image");
  assert.equal(redirected.searchParams.get("url"), "https://image.coolapk.com/a.jpg");
  assert.equal(redirected.searchParams.get("w"), "720");
  assert.equal(redirected.searchParams.get(IMAGE_CDN_ORIGIN_PARAM), "1");

  assert.equal(imageCdnRedirectUrl(redirected, "https://cdn.example.com/cache"), "");
  assert.equal(imageCdnRedirectUrl(request, ""), "");
});

test("image responses expose browser and surrogate long-lived cache policies", () => {
  assert.match(imageBrowserCacheControl(), /max-age=31536000/);
  assert.match(imageBrowserCacheControl(), /s-maxage=31536000/);
  assert.match(imageBrowserCacheControl(), /immutable/);
  assert.match(imageSurrogateCacheControl(), /stale-if-error=2592000/);
});
