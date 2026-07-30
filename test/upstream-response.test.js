import test from "node:test";
import assert from "node:assert/strict";
import { invalidUpstreamResponseError, parseUpstreamJsonObject, upstreamResponseMetadata } from "../lib/upstream-response.js";

test("records only bounded metadata for invalid upstream responses", () => {
  const response = {
    status: 200,
    headers: { get: (name) => name === "content-type" ? "text/html; charset=utf-8" : null },
  };
  const secretBody = "<html>PRIVATE_UPSTREAM_BODY</html>";
  const metadata = upstreamResponseMetadata(response, secretBody);
  assert.deepEqual(metadata, {
    status: 200,
    contentType: "text/html; charset=utf-8",
    length: Buffer.byteLength(secretBody),
  });
  assert.equal(Object.hasOwn(metadata, "body"), false);
  assert.equal(Object.hasOwn(metadata, "text"), false);
});

test("maps invalid or empty Coolapk responses to a generic 502 error", () => {
  const error = invalidUpstreamResponseError();
  assert.equal(error.statusCode, 502);
  assert.equal(error.code, "UPSTREAM_INVALID_RESPONSE");
  assert.equal(error.message.includes("PRIVATE_UPSTREAM_BODY"), false);
});

test("rejects empty HTTP 200 and non-JSON responses without exposing their body", () => {
  const response = {
    status: 200,
    headers: { get: () => "text/plain; charset=utf-8" },
  };
  const observed = [];
  for (const body of ["", "PRIVATE_UPSTREAM_BODY", "null", "[]"]) {
    assert.throws(
      () => parseUpstreamJsonObject(response, body, { onInvalid: (metadata) => observed.push(metadata) }),
      (error) => error.statusCode === 502 && (!body || !error.message.includes(body)),
    );
  }
  assert.equal(observed.length, 4);
  assert.deepEqual(Object.keys(observed[1]).sort(), ["contentType", "length", "status"]);
  assert.deepEqual(parseUpstreamJsonObject(response, "{\"data\":[]}"), { data: [] });
});
