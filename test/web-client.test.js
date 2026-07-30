import test from "node:test";
import assert from "node:assert/strict";
import { appSummary, collectEntities, collectionSummary, messageSummary, normalizePageKey, normalizePageTarget, notificationSummary, pageDecorations, relationshipUserSource, sessionCookieHeader, webChannelConfig, webChannels } from "../lib/web-client.js";

test("exposes only supported web channels", () => {
  assert.ok(webChannels().some((item) => item.key === "home"));
  assert.equal(webChannelConfig("digital").params.url, "V10_DIGITAL_HOME");
  assert.match(webChannelConfig("ratings").params.url, /rankType=rating/);
  assert.equal(webChannelConfig("second_hand").params.url, "#/feed/ershouList");
  assert.equal(webChannelConfig("../../account"), null);
  for (const channel of webChannels()) {
    const pageTarget = webChannelConfig(channel.key)?.params?.url;
    if (pageTarget) assert.equal(normalizePageTarget(pageTarget), pageTarget);
  }
});

test("collects nested entities and normalizes apps", () => {
  const data = [{ entityType: "card", entities: [{ entityType: "apk", id: 5189, title: "哔哩哔哩", score_v10: 6.9 }] }];
  const apps = collectEntities(data, (item) => item.entityType === "apk").map(appSummary);
  assert.deepEqual(apps.map((item) => item.id), ["5189"]);
  assert.equal(apps[0].score, 6.9);
});

test("selects the related user from Coolapk relationship rows", () => {
  const row = {
    uid: 3941065,
    username: "当前用户",
    fuid: 704548,
    fusername: "关注的用户",
    fUserAvatar: "https://avatar.coolapk.com/target.jpg",
    fUserInfo: { uid: 704548, username: "关注的用户", level: 11 },
  };
  assert.deepEqual(relationshipUserSource(row), row.fUserInfo);
  assert.equal(relationshipUserSource({ fuid: 2, fusername: "目标" }).uid, 2);
});

test("extracts banners and shortcuts from page cards", () => {
  const data = [
    { entityType: "card", entityTemplate: "imageCarouselCard_1", entities: [{ title: "今日酷安", pic: "https://image.coolapk.com/a.jpg", url: "/page?url=V8_JINRI_20260730" }] },
    {
      entityType: "card",
      entityTemplate: "iconLinkGridCard",
      entities: [{ title: "热闻", pic: "https://image.coolapk.com/b.png", url: "/page?url=V8_JINRI_NEWS" }],
    },
    {
      entityType: "card",
      entityTemplate: "iconTabLinkGridCard",
      entities: [{ title: "热门", url: "#/feed/digestList?orderBy=replynum&filterId=60" }],
    },
  ];
  const result = pageDecorations(data);
  assert.equal(result.banners[0].title, "今日酷安");
  assert.equal(result.banners[0].url, "/page?url=V8_JINRI_20260730");
  assert.deepEqual(result.shortcuts.map((item) => item.title), ["热闻", "热门"]);
  assert.equal(result.shortcuts[0].url, "/page?url=V8_JINRI_NEWS");
  assert.equal(result.shortcuts[1].url, "#/feed/digestList?orderBy=replynum&filterId=60");
});

test("accepts safe Coolapk page keys only", () => {
  assert.equal(normalizePageKey("V8_ZHUANTI_20180327"), "V8_ZHUANTI_20180327");
  assert.equal(normalizePageKey("  V8_JINRI_20260730  "), "V8_JINRI_20260730");
  assert.equal(normalizePageKey("abc"), "abc");
  for (const invalid of [
    "",
    "V8",
    "../../account",
    "%2e%2e%2faccount",
    "#/feed/list",
    "/page?url=V8_JINRI_NEWS",
    "V8_JINRI_NEWS&page=2",
    "V8-JINRI-NEWS",
    `V${"A".repeat(100)}`,
  ]) {
    assert.equal(normalizePageKey(invalid), "", `expected ${invalid} to be rejected`);
  }
});

test("accepts allowlisted Coolapk in-app page targets", () => {
  for (const target of [
    "#/feed/digestList?type=10&message_status=all",
    "#/feed/multiTagFeedList?title=%E7%A7%91%E6%8A%80",
    "#/feed/headlineV8List?filterId=0",
    "#/feed/coolPictureList?listType=hot&buildCard=1",
    "#/topic/tagList?keywords=%E7%8E%A9%E6%9C%BA",
    "#/product/unreleasedProductList?sortField=wish_count",
    "#/article/includeFeedList?dyhId=4829",
    "#/apk/realRankList?apkType=1",
    "/apk/categoryList?apkType=1",
    "/apk/category?title=%E7%B3%BB%E7%BB%9F%E5%B7%A5%E5%85%B7&catId=5&apkType=1",
    "/product/categoryList?id=1000",
    "/product/categoryDetailList?type=category&id=1000",
  ]) {
    assert.equal(normalizePageTarget(target), target);
  }
  for (const invalid of [
    "#/account",
    "#/feed/../../account",
    "#/feed/%2e%2e/account",
    "/api/settings",
    "https://example.com/page",
    "searchSpot://ershou",
    "/ershou/location",
    "/album/23084193",
  ]) {
    assert.equal(normalizePageTarget(invalid), "");
  }
});

test("preserves category and product-brand directories from generic pages", () => {
  const result = pageDecorations([
    {
      id: 5,
      entityType: "category",
      title: "系统工具",
      logo: "https://image.coolapk.com/category.png",
      tags: "输入法,文件管理",
      url: "/apk/category?catId=5&apkType=1",
    },
    {
      id: 1000,
      entityType: "productBrand",
      title: "手机",
      product_num: 1799,
      url: "/page?url=%2Fproduct%2FcategoryDetailList%3Ftype%3Dcategory%26id%3D1000",
    },
  ]);
  assert.equal(result.directories.length, 2);
  assert.equal(result.directories[0].subtitle, "输入法,文件管理");
  assert.equal(result.directories[1].subtitle, "1799 个产品");
});

test("builds a safe Coolapk session cookie", () => {
  assert.equal(
    sessionCookieHeader({ uid: "123", username: "测试 用户", token: "TOKEN" }),
    "uid=123; username=%E6%B5%8B%E8%AF%95%20%E7%94%A8%E6%88%B7; token=TOKEN",
  );
  assert.equal(sessionCookieHeader({ uid: "123", username: "name" }), "");
  assert.equal(
    sessionCookieHeader({ uid: "123\r\n", username: "name;", token: "TOKEN;" }),
    "uid=123; username=name; token=TOKEN",
  );
});

test("normalizes collections, notifications and chat sessions", () => {
  assert.equal(collectionSummary({ id: 8, title: "收藏", item_num: 3 }).id, "8");
  const notification = notificationSummary({
    id: 7,
    fromusername: "酷友",
    note: "回复了你",
    url: "/feed/42",
    dateline: 1_700_000_000,
  }, "list");
  assert.equal(notification.feedId, "42");
  assert.equal(notification.createdAt, 1_700_000_000_000);
  const message = messageSummary({
    id: 9,
    uid: 12,
    message: "你好",
    messageUserInfo: { username: "朋友", userAvatar: "https://avatar.coolapk.com/a.jpg" },
  });
  assert.equal(message.username, "朋友");
  assert.equal(message.uid, "12");
});
