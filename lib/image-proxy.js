import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ALLOWED_IMAGE_HOSTS = new Set([
  "image.coolapk.com",
  "avatar.coolapk.com",
  "pp.myapp.com",
  "static.coolapk.com",
]);

const OSS_IMAGE_HOSTS = new Set([
  "image.coolapk.com",
  "avatar.coolapk.com",
  "static.coolapk.com",
]);

const IMAGE_FORMATS = new Set(["original", "webp", "jpeg", "png"]);

function boundedInteger(value, fallback, minimum, maximum) {
  if (value == null || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function publicImageUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw Object.assign(new Error("图片地址格式错误"), { statusCode: 400 });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw Object.assign(new Error("图片协议错误"), { statusCode: 400 });
  }
  if (parsed.username || parsed.password || parsed.port) {
    throw Object.assign(new Error("图片地址包含不允许的认证信息或端口"), { statusCode: 400 });
  }
  parsed.hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_IMAGE_HOSTS.has(parsed.hostname)) {
    throw Object.assign(new Error("图片来源未被允许"), { statusCode: 403 });
  }
  parsed.hash = "";
  return parsed;
}

/**
 * Normalize an image proxy request and, for Coolapk OSS-backed hosts, build a
 * safe server-side thumbnail URL. The original URL is retained for fallback.
 */
export function normalizeImageRequest(value, options = {}) {
  const original = publicImageUrl(value);
  const explicitWidth = options.width != null && options.width !== "";
  const explicitFormat = options.format != null && options.format !== "";
  let width = boundedInteger(options.width, null, 64, 2560);
  let quality = boundedInteger(options.quality, 78, 40, 95);
  let format = String(options.format || (width ? "webp" : "original")).trim().toLowerCase();
  if (!IMAGE_FORMATS.has(format)) format = width ? "webp" : "original";

  // Avatars are only rendered as small UI elements. Optimizing them by
  // default avoids repeatedly downloading oversized JPEGs without reducing
  // feed-gallery quality.
  if (!explicitWidth && !explicitFormat && original.hostname === "avatar.coolapk.com") {
    width = 192;
    quality = 78;
    format = "webp";
  }

  const source = new URL(original);
  source.searchParams.delete("x-oss-process");
  source.searchParams.delete("imageMogr2");
  source.searchParams.delete("imageView2");
  const upstream = new URL(source);
  const canOptimize = OSS_IMAGE_HOSTS.has(upstream.hostname) && Boolean(width || format !== "original");
  if (canOptimize) {
    const operations = [];
    if (width) operations.push(`resize,w_${width}`);
    if (format !== "original") operations.push(`format,${format}`);
    if (format === "jpeg" || format === "webp") operations.push(`quality,q_${quality}`);
    upstream.searchParams.set("x-oss-process", `image/${operations.join("/")}`);
  }

  const sourceUrl = source.toString();
  const upstreamUrl = canOptimize ? upstream.toString() : sourceUrl;
  return {
    sourceUrl,
    upstreamUrl,
    cacheKey: createHash("sha256").update(upstreamUrl).digest("hex"),
    optimized: canOptimize,
    variant: { width, quality, format: canOptimize ? format : "original" },
  };
}

export function isAllowedImageUrl(value) {
  try {
    publicImageUrl(value);
    return true;
  } catch {
    return false;
  }
}

export function etagMatches(header, etag) {
  if (!header || !etag) return false;
  const target = String(etag).replace(/^W\//i, "");
  return String(header)
    .split(",")
    .map((value) => value.trim().replace(/^W\//i, ""))
    .some((value) => value === "*" || value === target);
}

export function imageContentType(body, header = "") {
  const declared = String(header).split(";")[0].trim().toLowerCase();
  const safeDeclared = new Set([
    "image/avif",
    "image/bmp",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/x-icon",
    "image/vnd.microsoft.icon",
  ]);
  if (safeDeclared.has(declared)) return declared;
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body || []);
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6))) return "image/gif";
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp" && /^(avif|avis)$/.test(bytes.toString("ascii", 8, 12))) return "image/avif";
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return "image/x-icon";
  return "";
}

export async function readImageBody(body, maximumBytes) {
  if (!body) throw Object.assign(new Error("图片响应没有内容"), { statusCode: 502 });
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of body) {
    const bytes = Buffer.from(chunk);
    byteLength += bytes.byteLength;
    if (byteLength > maximumBytes) {
      if (typeof body.cancel === "function") await body.cancel().catch(() => {});
      throw Object.assign(new Error("上游图片体积过大"), { statusCode: 502 });
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, byteLength);
}

function cachePaths(directory, key) {
  return {
    body: join(directory, `${key}.bin`),
    metadata: join(directory, `${key}.json`),
  };
}

/**
 * Small two-level LRU cache. Memory serves hot images without filesystem I/O;
 * disk keeps images warm across service restarts.
 */
export class ImageProxyCache {
  constructor({
    directory,
    maxMemoryBytes = 48 * 1024 * 1024,
    maxMemoryEntryBytes = 4 * 1024 * 1024,
    maxDiskBytes = 512 * 1024 * 1024,
    maxDiskEntries = 2_000,
  }) {
    this.directory = directory;
    this.maxMemoryBytes = maxMemoryBytes;
    this.maxMemoryEntryBytes = maxMemoryEntryBytes;
    this.maxDiskBytes = maxDiskBytes;
    this.maxDiskEntries = maxDiskEntries;
    this.memory = new Map();
    this.memoryBytes = 0;
    this.ready = null;
    this.diskIndex = new Map();
    this.diskBytes = 0;
    this.diskIndexReady = false;
    this.diskMutationQueue = Promise.resolve();
    this.diskMutationsPending = 0;
  }

  ensureDirectory() {
    if (!this.ready) this.ready = mkdir(this.directory, { recursive: true });
    return this.ready;
  }

  remember(key, entry) {
    if (!entry?.body || entry.body.byteLength > this.maxMemoryEntryBytes) return;
    const existing = this.memory.get(key);
    if (existing) this.memoryBytes -= existing.body.byteLength;
    this.memory.delete(key);
    this.memory.set(key, entry);
    this.memoryBytes += entry.body.byteLength;
    while (this.memoryBytes > this.maxMemoryBytes && this.memory.size) {
      const oldestKey = this.memory.keys().next().value;
      const oldest = this.memory.get(oldestKey);
      this.memory.delete(oldestKey);
      this.memoryBytes -= oldest.body.byteLength;
    }
  }

  serializeDiskMutation(task) {
    this.diskMutationsPending += 1;
    const operation = this.diskMutationQueue.then(task);
    this.diskMutationQueue = operation.catch(() => {});
    return operation.finally(() => {
      this.diskMutationsPending -= 1;
    });
  }

  async removeDiskRecord(key, record = this.diskIndex.get(key)) {
    const paths = cachePaths(this.directory, key);
    await Promise.all([rm(paths.metadata, { force: true }), rm(paths.body, { force: true })]);
    if (!record || !this.diskIndex.has(key)) return;
    this.diskIndex.delete(key);
    this.diskBytes = Math.max(0, this.diskBytes - record.bytes);
  }

  async scanDisk(now = Date.now()) {
    const names = await readdir(this.directory);
    const records = [];
    const validKeys = new Set();
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const key = name.slice(0, -5);
      const paths = cachePaths(this.directory, key);
      try {
        const [raw, bodyStat] = await Promise.all([readFile(paths.metadata, "utf8"), stat(paths.body)]);
        const metadata = JSON.parse(raw);
        if (
          metadata.version !== 1
          || metadata.key !== key
          || Number(metadata.staleUntil) <= now
          || Number(metadata.byteLength) !== bodyStat.size
        ) {
          await Promise.all([rm(paths.metadata, { force: true }), rm(paths.body, { force: true })]);
          continue;
        }
        validKeys.add(key);
        records.push({
          key,
          paths,
          bytes: bodyStat.size,
          createdAt: Number(metadata.createdAt) || 0,
        });
      } catch {
        await Promise.all([rm(paths.metadata, { force: true }), rm(paths.body, { force: true })]);
      }
    }

    // Remove interrupted-write leftovers and bodies without matching metadata.
    await Promise.all(names.map(async (name) => {
      if (name.endsWith(".tmp")) {
        await rm(join(this.directory, name), { force: true });
        return;
      }
      if (name.endsWith(".bin") && !validKeys.has(name.slice(0, -4))) {
        await rm(join(this.directory, name), { force: true });
      }
    }));

    records.sort((left, right) => right.createdAt - left.createdAt);
    this.diskIndex = new Map();
    this.diskBytes = 0;
    for (const record of records) {
      if (
        this.diskIndex.size < this.maxDiskEntries
        && this.diskBytes + record.bytes <= this.maxDiskBytes
      ) {
        this.diskIndex.set(record.key, record);
        this.diskBytes += record.bytes;
      } else {
        await Promise.all([
          rm(record.paths.metadata, { force: true }),
          rm(record.paths.body, { force: true }),
        ]);
      }
    }
    this.diskIndexReady = true;
  }

  async ensureDiskIndex(now = Date.now()) {
    if (!this.diskIndexReady) await this.scanDisk(now);
  }

  async get(key, now = Date.now()) {
    const memoryEntry = this.memory.get(key);
    if (memoryEntry) {
      if (memoryEntry.staleUntil > now) {
        this.memory.delete(key);
        this.memory.set(key, memoryEntry);
        return { ...memoryEntry, cacheLayer: "memory" };
      }
      this.memory.delete(key);
      this.memoryBytes -= memoryEntry.body.byteLength;
    }

    await this.ensureDirectory();
    const paths = cachePaths(this.directory, key);
    try {
      const [rawMetadata, body] = await Promise.all([readFile(paths.metadata, "utf8"), readFile(paths.body)]);
      const metadata = JSON.parse(rawMetadata);
      if (
        metadata.version !== 1
        || metadata.key !== key
        || metadata.byteLength !== body.byteLength
        || Number(metadata.staleUntil) <= now
      ) {
        return null;
      }
      const entry = { ...metadata, body };
      this.remember(key, entry);
      return { ...entry, cacheLayer: "disk" };
    } catch (error) {
      if (!["ENOENT", "SyntaxError"].includes(error.code) && !(error instanceof SyntaxError)) {
        console.warn(`读取图片缓存失败：${error.message}`);
      }
      return null;
    }
  }

  async set(key, entry) {
    const normalized = {
      version: 1,
      key,
      contentType: entry.contentType,
      etag: entry.etag,
      upstreamEtag: entry.upstreamEtag || "",
      lastModified: entry.lastModified || "",
      createdAt: Number(entry.createdAt) || Date.now(),
      freshUntil: Number(entry.freshUntil),
      staleUntil: Number(entry.staleUntil),
      byteLength: entry.body.byteLength,
      upstreamUrl: entry.upstreamUrl,
    };
    const complete = { ...normalized, body: entry.body };
    this.remember(key, complete);
    await this.serializeDiskMutation(async () => {
      await this.ensureDirectory();
      await this.ensureDiskIndex();
      const paths = cachePaths(this.directory, key);

      // Drop the previous body before writing its replacement. Together with
      // serial mutations this reserves a hard body-byte slot for the new file,
      // including while its temporary file is being written.
      if (this.diskIndex.has(key)) await this.removeDiskRecord(key);
      if (
        this.maxDiskEntries < 1
        || entry.body.byteLength > this.maxDiskBytes
      ) {
        return;
      }

      const oldestFirst = () => [...this.diskIndex.values()]
        .sort((left, right) => left.createdAt - right.createdAt);
      while (
        this.diskIndex.size + 1 > this.maxDiskEntries
        || this.diskBytes + entry.body.byteLength > this.maxDiskBytes
      ) {
        const oldest = oldestFirst()[0];
        if (!oldest) return;
        await this.removeDiskRecord(oldest.key, oldest);
      }

      const token = `${process.pid}-${randomBytes(5).toString("hex")}`;
      const temporaryBody = `${paths.body}.${token}.tmp`;
      const temporaryMetadata = `${paths.metadata}.${token}.tmp`;
      try {
        await Promise.all([
          writeFile(temporaryBody, entry.body),
          writeFile(temporaryMetadata, JSON.stringify(normalized)),
        ]);
        await rename(temporaryBody, paths.body);
        await rename(temporaryMetadata, paths.metadata);
        const record = {
          key,
          paths,
          bytes: entry.body.byteLength,
          createdAt: normalized.createdAt,
        };
        this.diskIndex.set(key, record);
        this.diskBytes += record.bytes;
      } catch (error) {
        await Promise.all([rm(paths.body, { force: true }), rm(paths.metadata, { force: true })]);
        throw error;
      } finally {
        await Promise.all([rm(temporaryBody, { force: true }), rm(temporaryMetadata, { force: true })]);
      }
    });
    return complete;
  }

  async prune(now = Date.now()) {
    return this.serializeDiskMutation(async () => {
      await this.ensureDirectory();
      await this.scanDisk(now);
      return { entries: this.diskIndex.size, bytes: this.diskBytes };
    });
  }

  stats() {
    return {
      memoryEntries: this.memory.size,
      memoryBytes: this.memoryBytes,
      maxMemoryBytes: this.maxMemoryBytes,
      diskEntries: this.diskIndex.size,
      diskBytes: this.diskBytes,
      maxDiskEntries: this.maxDiskEntries,
      maxDiskBytes: this.maxDiskBytes,
      diskReady: this.diskIndexReady,
      diskMutationsPending: this.diskMutationsPending,
    };
  }
}
