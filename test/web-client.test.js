import test from "node:test";
import assert from "node:assert/strict";
import { appSummary, collectEntities, pageDecorations, webChannelConfig, webChannels } from "../lib/web-client.js";

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
