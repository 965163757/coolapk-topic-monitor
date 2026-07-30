import test from "node:test";
import assert from "node:assert/strict";
import { canonicalSource, inferSourceType, isSupportedSource, parseSourceKey } from "../lib/monitor-source.js";

test("distinguishes topic and product entities", () => {
  assert.equal(inferSourceType({ entityType: "topic", url: "/t/iPhone" }), "topic");
  assert.equal(inferSourceType({ entityType: "product", url: "/product/4283" }), "product");
  assert.equal(inferSourceType({ url: "/t/%E9%85%B7%E5%AE%89" }), "topic");
  assert.equal(inferSourceType({ url: "/product/4999?type=feed" }), "product");
  assert.equal(isSupportedSource({ entityType: "user", url: "/u/1" }), false);
  assert.equal(isSupportedSource({ entityType: "iconLink", url: "/product/categoryList" }), false);
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
    id: "4283",
    tag: "iPhone 17",
    key: "product:4283",
  });
  assert.deepEqual(canonicalSource({
    title: "活动_酷安表情二创大赛",
    entityType: "feedTopic",
    url: "/t/%E9%85%B7%E5%AE%89%E8%A1%A8%E6%83%85%E4%BA%8C%E5%88%9B%E5%A4%A7%E8%B5%9B?from=home#card",
  }), {
    type: "topic",
    id: null,
    tag: "酷安表情二创大赛",
    key: "topic:酷安表情二创大赛",
  });
  assert.deepEqual(canonicalSource({
    title: "iPhone 17 Pro Max",
    entityType: "product",
    url: "/product/4999?type=feed",
  }), {
    type: "product",
    id: "4999",
    tag: "iPhone 17 Pro Max",
    key: "product:4999",
  });
});

test("keeps malformed topic URLs non-throwing and deterministic", () => {
  assert.deepEqual(canonicalSource({
    title: "损坏编码的展示标题",
    url: "/t/%E0%A4%A",
  }), {
    type: "topic",
    id: null,
    tag: "%E0%A4%A",
    key: "topic:%E0%A4%A",
  });
});

test("uses absolute Coolapk URLs and ignores blank ids when building sources", () => {
  assert.deepEqual(
    canonicalSource({ url: "https://www.coolapk.com/t/%E6%9C%80%E8%BF%91%E4%B9%B0%E8%BF%87?from=home" }),
    { type: "topic", id: null, tag: "最近买过", key: "topic:最近买过" },
  );
  assert.deepEqual(
    canonicalSource({ sourceType: "product", sourceId: "", id: "", title: "设备", url: "https://www.coolapk.com/product/4999" }),
    { type: "product", id: "4999", tag: "设备", key: "product:4999" },
  );
  assert.deepEqual(
    canonicalSource({ entityType: "product", id: "decorative-card-8", title: "设备", url: "/product/1429" }),
    { type: "product", id: "1429", tag: "设备", key: "product:1429" },
  );
});

test("parses opaque source keys and legacy topic names", () => {
  assert.deepEqual(parseSourceKey("product:4283"), { type: "product", id: "4283", tag: "", key: "product:4283" });
  assert.deepEqual(parseSourceKey("topic:薅羊毛小分队"), { type: "topic", id: null, tag: "薅羊毛小分队", key: "topic:薅羊毛小分队" });
  assert.deepEqual(parseSourceKey("数码日常"), { type: "topic", id: null, tag: "数码日常", key: "topic:数码日常" });
  assert.deepEqual(parseSourceKey(" product:4999 "), { type: "product", id: "4999", tag: "", key: "product:4999" });
  assert.deepEqual(parseSourceKey("topic:"), { type: "topic", id: null, tag: "", key: "" });
  assert.deepEqual(parseSourceKey("product:"), { type: "product", id: "", tag: "", key: "" });
});
