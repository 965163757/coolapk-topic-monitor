import test from "node:test";
import assert from "node:assert/strict";
import { parseBoundedInt, parseJsonObjectBody, safeDecodeURIComponent } from "../lib/http-input.js";

test("parses and clamps bounded integer query values", () => {
  const options = { min: 1, max: 50, fallback: 1 };
  assert.equal(parseBoundedInt("12", options), 12);
  assert.equal(parseBoundedInt("999", options), 50);
  assert.equal(parseBoundedInt("-3", options), 1);
});

test("falls back for missing, non-finite, fractional and malformed integers", () => {
  const options = { min: 1, max: 500, fallback: 200 };
  for (const value of [null, undefined, "", " ", "nope", "NaN", "Infinity", Infinity, 1.5, "2.5"]) {
    assert.equal(parseBoundedInt(value, options), 200);
  }
  assert.equal(parseBoundedInt("20", { min: 10, max: 5, fallback: 99 }), 10);
  assert.equal(parseBoundedInt("bad", { min: 10, max: 500, fallback: Number.NaN }), 10);
});

test("decodes valid URL components and reports malformed encoding as a client error", () => {
  assert.equal(safeDecodeURIComponent("%E8%96%85%E7%BE%8A%E6%AF%9B"), "薅羊毛");
  assert.equal(safeDecodeURIComponent("plain-tag"), "plain-tag");
  assert.throws(
    () => safeDecodeURIComponent("%E0%A4%A"),
    (error) => error.statusCode === 400 && error.code === "INVALID_URL_ENCODING",
  );
});

test("parses JSON request objects and replaces parser details with a generic client error", () => {
  assert.deepEqual(parseJsonObjectBody(""), {});
  assert.deepEqual(parseJsonObjectBody(" \r\n "), {});
  assert.deepEqual(parseJsonObjectBody('{"enabled":true}'), { enabled: true });
  assert.throws(
    () => parseJsonObjectBody('{"secret":"SENSITIVE",'),
    (error) => error.statusCode === 400
      && error.code === "INVALID_JSON_BODY"
      && error.message === "请求体不是有效的 JSON"
      && !error.message.includes("SENSITIVE"),
  );
  for (const value of ["null", "true", "42", '"text"', "[]"]) {
    assert.throws(
      () => parseJsonObjectBody(value),
      (error) => error.statusCode === 400
        && error.code === "INVALID_JSON_BODY"
        && error.message === "请求体必须是 JSON 对象",
    );
  }
});
