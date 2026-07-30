import assert from "node:assert/strict";
import test from "node:test";
import {
  createPayloadVariants,
  isCompressible,
  preferredEncoding,
  requestEtagMatches,
  selectPayload,
} from "../lib/http-delivery.js";

test("selects the best supported response encoding", () => {
  assert.equal(preferredEncoding("gzip, deflate, br"), "br");
  assert.equal(preferredEncoding("br;q=0.4, gzip;q=0.8"), "gzip");
  assert.equal(preferredEncoding("br;q=0, gzip;q=0"), "identity");
  assert.equal(preferredEncoding("*;q=0.5"), "br");
});

test("compresses sufficiently large textual payloads", () => {
  const source = JSON.stringify({ rows: Array.from({ length: 200 }, (_, index) => ({ index, title: "性能优化数据" })) });
  const payload = createPayloadVariants(source, "application/json; charset=utf-8");
  assert.equal(isCompressible("application/json", Buffer.byteLength(source)), true);
  assert.ok(payload.variants.br.byteLength < payload.variants.identity.byteLength);
  assert.ok(payload.variants.gzip.byteLength < payload.variants.identity.byteLength);
  assert.equal(selectPayload(payload, "br, gzip").encoding, "br");
  assert.match(payload.etag, /^W\/"[A-Za-z0-9_-]{22}"$/);
});

test("keeps small or binary payloads as identity", () => {
  const small = createPayloadVariants("hello", "text/plain");
  const binary = createPayloadVariants(Buffer.alloc(2048), "image/png");
  assert.deepEqual(Object.keys(small.variants), ["identity"]);
  assert.deepEqual(Object.keys(binary.variants), ["identity"]);
  assert.equal(selectPayload(binary, "br").encoding, "identity");
});

test("matches weak and comma-separated request etags", () => {
  assert.equal(requestEtagMatches('W/"old", "current"', 'W/"current"'), true);
  assert.equal(requestEtagMatches('"other"', '"current"'), false);
  assert.equal(requestEtagMatches("*", '"current"'), true);
});
