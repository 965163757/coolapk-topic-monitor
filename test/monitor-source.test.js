import test from "node:test";
import assert from "node:assert/strict";
import { canonicalSource, inferSourceType, isSupportedSource, parseSourceKey } from "../lib/monitor-source.js";

test("distinguishes topic and product entities", () => {
  assert.equal(inferSourceType({ entityType: "topic", url: "/t/iPhone" }), "topic");
  assert.equal(inferSourceType({ entityType: "product", url: "/product/4283" }), "product");
  assert.equal(isSupportedSource({ entityType: "user", url: "/u/1" }), false);
});

test("builds stable monitor keys", () => {
  assert.deepEqual(canonicalSource({ id: 10371, title: "iPhone", entityType: "topic", url: "/t/iPhone" }), {
    type: "topic",
    id: 10371,
    tag: "iPhone",
    key: "topic:iPhone",
  });
  assert.deepEqual(canonicalSource({ id: 4283, title: "iPhone 17", entityType: "product", url: "/product/4283" }), {
    type: "product",
    id: 4283,
    tag: "iPhone 17",
    key: "product:4283",
  });
});

test("parses opaque source keys and legacy topic names", () => {
  assert.deepEqual(parseSourceKey("product:4283"), { type: "product", id: "4283", tag: "", key: "product:4283" });
  assert.deepEqual(parseSourceKey("topic:薅羊毛小分队"), { type: "topic", id: null, tag: "薅羊毛小分队", key: "topic:薅羊毛小分队" });
  assert.deepEqual(parseSourceKey("数码日常"), { type: "topic", id: null, tag: "数码日常", key: "topic:数码日常" });
});
