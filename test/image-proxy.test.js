import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ImageProxyCache,
  etagMatches,
  imageContentType,
  isAllowedImageUrl,
  normalizeImageRequest,
  readImageBody,
} from "../lib/image-proxy.js";

test("normalizeImageRequest validates sources and creates bounded OSS variants", () => {
  const source = "http://image.coolapk.com/feed/2026/example.jpg?t=123";
  const result = normalizeImageRequest(source, { width: "99999", quality: "1", format: "webp" });
  const upstream = new URL(result.upstreamUrl);

  assert.equal(result.variant.width, 2560);
  assert.equal(result.variant.quality, 40);
  assert.equal(result.variant.format, "webp");
  assert.equal(result.optimized, true);
  assert.equal(
    upstream.searchParams.get("x-oss-process"),
    "image/resize,w_2560/format,webp/quality,q_40",
  );
  assert.equal(upstream.searchParams.get("t"), "123");
  assert.match(result.cacheKey, /^[a-f0-9]{64}$/);
});

test("normalizeImageRequest optimizes avatars by default but preserves feed originals", () => {
  const avatar = normalizeImageRequest("https://avatar.coolapk.com/data/avatar.jpg?t=1");
  const feed = normalizeImageRequest("https://image.coolapk.com/feed/photo.jpg");

  assert.deepEqual(avatar.variant, { width: 192, quality: 78, format: "webp" });
  assert.equal(avatar.optimized, true);
  assert.equal(feed.optimized, false);
  assert.equal(feed.upstreamUrl, feed.sourceUrl);
});

test("normalizeImageRequest does not send unsupported CDN transformations", () => {
  const result = normalizeImageRequest("https://pp.myapp.com/icon.png", { width: 480, format: "webp" });
  assert.equal(result.optimized, false);
  assert.equal(new URL(result.upstreamUrl).searchParams.has("x-oss-process"), false);
});

test("image source validation rejects credentials, custom ports and untrusted hosts", () => {
  assert.equal(isAllowedImageUrl("https://image.coolapk.com/a.jpg"), true);
  assert.equal(isAllowedImageUrl("https://evil.example/a.jpg"), false);
  assert.throws(() => normalizeImageRequest("https://user@example.com/a.jpg"), /认证信息或端口/);
  assert.throws(() => normalizeImageRequest("https://image.coolapk.com:8443/a.jpg"), /认证信息或端口/);
});

test("etagMatches handles weak tags and lists", () => {
  assert.equal(etagMatches('W/"old", "current"', 'W/"current"'), true);
  assert.equal(etagMatches('"other"', '"current"'), false);
  assert.equal(etagMatches("*", '"current"'), true);
});

test("imageContentType accepts safe declarations and sniffs common formats", () => {
  assert.equal(imageContentType(Buffer.from("anything"), "image/jpeg; charset=binary"), "image/jpeg");
  assert.equal(imageContentType(Buffer.from([0xff, 0xd8, 0xff, 0x00]), "application/octet-stream"), "image/jpeg");
  assert.equal(
    imageContentType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "application/octet-stream"),
    "image/png",
  );
  assert.equal(imageContentType(Buffer.from("<svg></svg>"), "image/svg+xml"), "");
});

test("readImageBody enforces the response size limit", async () => {
  const body = ReadableStream.from([Buffer.alloc(3), Buffer.alloc(3)]);
  await assert.rejects(() => readImageBody(body, 5), /体积过大/);
});

test("ImageProxyCache persists entries and reloads them from disk", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coolapk-image-cache-"));
  try {
    const now = Date.now();
    const cache = new ImageProxyCache({ directory, maxMemoryBytes: 1 });
    const entry = {
      body: Buffer.from("image bytes"),
      contentType: "image/jpeg",
      etag: '"local"',
      upstreamEtag: '"upstream"',
      lastModified: "Wed, 01 Jan 2025 00:00:00 GMT",
      createdAt: now,
      freshUntil: now + 1_000,
      staleUntil: now + 2_000,
      upstreamUrl: "https://image.coolapk.com/a.jpg",
    };
    await cache.set("cache-key", entry);

    const persisted = JSON.parse(await readFile(join(directory, "cache-key.json"), "utf8"));
    assert.equal(persisted.byteLength, entry.body.byteLength);
    const restarted = new ImageProxyCache({ directory });
    const loaded = await restarted.get("cache-key", now + 100);
    assert.equal(loaded.cacheLayer, "disk");
    assert.equal(loaded.body.toString(), "image bytes");
    assert.equal(loaded.etag, '"local"');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ImageProxyCache prunes expired files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coolapk-image-cache-"));
  try {
    const cache = new ImageProxyCache({ directory });
    await cache.set("expired", {
      body: Buffer.from("expired"),
      contentType: "image/png",
      etag: '"expired"',
      createdAt: 1,
      freshUntil: 2,
      staleUntil: 3,
      upstreamUrl: "https://image.coolapk.com/expired.png",
    });
    const stats = await cache.prune(10);
    assert.deepEqual(stats, { entries: 0, bytes: 0 });
    assert.equal(await cache.get("expired", 10), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ImageProxyCache serializes writes and keeps disk usage within hard limits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coolapk-image-cache-"));
  try {
    const now = Date.now();
    const cache = new ImageProxyCache({
      directory,
      maxMemoryBytes: 1,
      maxDiskBytes: 10,
      maxDiskEntries: 2,
    });
    const entry = (size, createdAt) => ({
      body: Buffer.alloc(size, createdAt % 255),
      contentType: "image/jpeg",
      etag: `"${createdAt}"`,
      createdAt,
      freshUntil: now + 10_000,
      staleUntil: now + 20_000,
      upstreamUrl: `https://image.coolapk.com/${createdAt}.jpg`,
    });

    await Promise.all([
      cache.set("a", entry(4, now + 1)),
      cache.set("b", entry(4, now + 2)),
      cache.set("c", entry(4, now + 3)),
      cache.prune(now),
    ]);
    let stats = cache.stats();
    assert.equal(stats.diskEntries, 2);
    assert.equal(stats.diskBytes, 8);
    assert.ok(stats.diskEntries <= stats.maxDiskEntries);
    assert.ok(stats.diskBytes <= stats.maxDiskBytes);

    await cache.set("b", entry(9, now + 4));
    stats = cache.stats();
    assert.equal(stats.diskEntries, 1);
    assert.equal(stats.diskBytes, 9);
    const restarted = new ImageProxyCache({ directory, maxDiskBytes: 10, maxDiskEntries: 2 });
    const replacement = await restarted.get("b", now + 5);
    assert.equal(replacement.body.byteLength, 9);

    // An entry larger than the full budget is kept in memory only and removes
    // a previous disk version so a restart can never serve stale bytes.
    await cache.set("b", entry(11, now + 6));
    assert.equal(cache.stats().diskEntries, 0);
    assert.equal(cache.stats().diskBytes, 0);
    assert.equal(await new ImageProxyCache({ directory }).get("b", now + 7), null);

    const names = await readdir(directory);
    assert.equal(names.some((name) => name.endsWith(".tmp")), false);
    const bodies = names.filter((name) => name.endsWith(".bin"));
    const sizes = await Promise.all(bodies.map(async (name) => (await stat(join(directory, name))).size));
    assert.ok(sizes.reduce((sum, size) => sum + size, 0) <= 10);
    assert.ok(bodies.length <= 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
