import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const ACCESS_AUTH_COOKIE = "coolapk_access_session";
export const DEFAULT_ACCESS_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function digestText(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest();
}

export function timingSafeTextEqual(candidate, expected) {
  const candidateIsString = typeof candidate === "string";
  const expectedIsString = typeof expected === "string";
  const equal = timingSafeEqual(
    digestText(candidateIsString ? candidate : ""),
    digestText(expectedIsString ? expected : ""),
  );
  return candidateIsString && expectedIsString && equal;
}

export function parseCookieHeader(header) {
  const cookies = new Map();
  for (const part of String(header || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    if (!name) continue;
    try {
      cookies.set(name, decodeURIComponent(rawValue));
    } catch {
      cookies.set(name, rawValue);
    }
  }
  return cookies;
}

export function serializeAccessCookie(session, {
  maxAgeSeconds = DEFAULT_ACCESS_SESSION_TTL_SECONDS,
  secure = false,
} = {}) {
  const value = encodeURIComponent(String(session || ""));
  const attributes = [
    `${ACCESS_AUTH_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(1, Math.trunc(Number(maxAgeSeconds)) || DEFAULT_ACCESS_SESSION_TTL_SECONDS)}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function serializeExpiredAccessCookie({ secure = false } = {}) {
  const attributes = [
    `${ACCESS_AUTH_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

function sessionDigest(value) {
  return digestText(value).toString("hex");
}

export class AccessAuth {
  #accessToken;
  #sessions = new Map();
  #now;
  #randomBytes;
  #ttlMs;
  #maxSessions;

  constructor(accessToken, {
    now = () => Date.now(),
    randomBytesFn = randomBytes,
    ttlSeconds = DEFAULT_ACCESS_SESSION_TTL_SECONDS,
    maxSessions = 256,
  } = {}) {
    this.#accessToken = typeof accessToken === "string" ? accessToken : "";
    this.#now = now;
    this.#randomBytes = randomBytesFn;
    this.#ttlMs = Math.max(60_000, (Number(ttlSeconds) || DEFAULT_ACCESS_SESSION_TTL_SECONDS) * 1000);
    this.#maxSessions = Math.max(1, Math.trunc(Number(maxSessions)) || 256);
  }

  get enabled() {
    return this.#accessToken.length > 0;
  }

  get ttlSeconds() {
    return Math.trunc(this.#ttlMs / 1000);
  }

  createSession(candidate) {
    if (!this.enabled || !timingSafeTextEqual(candidate, this.#accessToken)) return null;
    this.#prune();
    const session = this.#randomBytes(32).toString("base64url");
    const now = this.#now();
    this.#sessions.set(sessionDigest(session), { createdAt: now, expiresAt: now + this.#ttlMs });
    this.#trim();
    return session;
  }

  isAuthenticated(cookieHeader) {
    if (!this.enabled) return true;
    this.#prune();
    const session = parseCookieHeader(cookieHeader).get(ACCESS_AUTH_COOKIE);
    if (!session) return false;
    const record = this.#sessions.get(sessionDigest(session));
    return Boolean(record && record.expiresAt > this.#now());
  }

  revoke(cookieHeader) {
    const session = parseCookieHeader(cookieHeader).get(ACCESS_AUTH_COOKIE);
    if (!session) return false;
    return this.#sessions.delete(sessionDigest(session));
  }

  #prune() {
    const now = this.#now();
    for (const [key, record] of this.#sessions) {
      if (record.expiresAt <= now) this.#sessions.delete(key);
    }
  }

  #trim() {
    if (this.#sessions.size <= this.#maxSessions) return;
    const oldest = [...this.#sessions.entries()].sort((left, right) => left[1].createdAt - right[1].createdAt);
    while (this.#sessions.size > this.#maxSessions && oldest.length) {
      this.#sessions.delete(oldest.shift()[0]);
    }
  }
}
