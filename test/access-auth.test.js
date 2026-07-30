import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCESS_AUTH_COOKIE,
  AccessAuth,
  parseCookieHeader,
  serializeAccessCookie,
  serializeExpiredAccessCookie,
  timingSafeTextEqual,
} from "../lib/access-auth.js";

test("compares access tokens without exposing length-sensitive string comparison", () => {
  assert.equal(timingSafeTextEqual("correct horse", "correct horse"), true);
  assert.equal(timingSafeTextEqual("wrong", "correct horse"), false);
  assert.equal(timingSafeTextEqual(123, "123"), false);
});

test("keeps local development open when APP_ACCESS_TOKEN is not configured", () => {
  const auth = new AccessAuth("");
  assert.equal(auth.enabled, false);
  assert.equal(auth.isAuthenticated(""), true);
  assert.equal(auth.createSession("anything"), null);
});

test("creates an opaque session only for the configured access token", () => {
  const auth = new AccessAuth("APP_ACCESS_TOKEN", {
    randomBytesFn: () => Buffer.alloc(32, 7),
  });
  assert.equal(auth.enabled, true);
  assert.equal(auth.createSession("wrong"), null);
  const session = auth.createSession("APP_ACCESS_TOKEN");
  assert.match(session, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(session.includes("APP_ACCESS_TOKEN"), false);
  assert.equal(auth.isAuthenticated(`${ACCESS_AUTH_COOKIE}=${session}`), true);
});

test("expires and revokes authenticated sessions", () => {
  let now = 1_000;
  const auth = new AccessAuth("TOKEN", {
    now: () => now,
    ttlSeconds: 60,
    randomBytesFn: () => Buffer.alloc(32, 9),
  });
  const session = auth.createSession("TOKEN");
  const cookie = `${ACCESS_AUTH_COOKIE}=${session}`;
  assert.equal(auth.isAuthenticated(cookie), true);
  assert.equal(auth.revoke(cookie), true);
  assert.equal(auth.isAuthenticated(cookie), false);

  const replacement = auth.createSession("TOKEN");
  now += 60_001;
  assert.equal(auth.isAuthenticated(`${ACCESS_AUTH_COOKIE}=${replacement}`), false);
});

test("serializes strict HttpOnly session and logout cookies", () => {
  const cookie = serializeAccessCookie("opaque_session", { maxAgeSeconds: 3600, secure: true });
  assert.match(cookie, new RegExp(`^${ACCESS_AUTH_COOKIE}=opaque_session;`));
  for (const attribute of ["Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=3600", "Secure"]) {
    assert.equal(cookie.includes(attribute), true);
  }
  const expired = serializeExpiredAccessCookie();
  assert.equal(expired.includes("Max-Age=0"), true);
  assert.equal(expired.includes("Expires=Thu, 01 Jan 1970 00:00:00 GMT"), true);
});

test("parses encoded cookies without accepting malformed segments", () => {
  const cookies = parseCookieHeader("theme=dark; coolapk_access_session=a%2Fb; malformed; empty=");
  assert.equal(cookies.get("theme"), "dark");
  assert.equal(cookies.get(ACCESS_AUTH_COOKIE), "a/b");
  assert.equal(cookies.has("malformed"), false);
  assert.equal(cookies.get("empty"), "");
});
