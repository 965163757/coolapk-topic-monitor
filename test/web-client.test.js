import test from "node:test";
import assert from "node:assert/strict";
import { appSummary, collectEntities, collectionSummary, messageSummary, notificationSummary, pageDecorations, sessionCookieHeader, webChannelConfig, webChannels } from "../lib/web-client.js";

test("exposes only supported web channels", () => {
  assert.ok(webChannels().some((item) => item.key === "home"));
  assert.equal(webChannelConfig("digital").params.url, "V10_DIGITAL_HOME");
  assert.equal(webChannelConfig("../../account"), null);
});

test("collects nested entities and normalizes apps", () => {
  const data = [{ entityType: "card", entities: [{ entityType: "apk", id: 5189, title: "哔哩哔哩", score_v10: 6.9 }] }];
  const apps = collectEntities(data, (item) => item.entityType === "apk").map(appSummary);
  assert.deepEqual(apps.map((item) => item.id), ["5189"]);
  assert.equal(apps[0].score, 6.9);
});

test("extracts banners and shortcuts from page cards", () => {
  const data = [
    { entityType: "card", entityTemplate: "imageCarouselCard_1", entities: [{ title: "活动", pic: "https://image.coolapk.com/a.jpg", url: "/t/活动" }] },
    { entityType: "card", entityTemplate: "iconLinkGridCard", entities: [{ title: "值得看", pic: "https://image.coolapk.com/b.png", url: "/page?url=V8" }] },
  ];
  const result = pageDecorations(data);
  assert.equal(result.banners[0].title, "活动");
  assert.equal(result.shortcuts[0].title, "值得看");
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
