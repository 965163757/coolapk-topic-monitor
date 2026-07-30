import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
let raceFeedSearchRequests = 0;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function feed(id, message) {
  return {
    entityType: "feed",
    id,
    uid: 7000 + Number(id),
    username: `user-${id}`,
    title: message,
    message,
    dateline: 1_800_000_000 + Number(id),
    replynum: 2,
    likenum: 3,
  };
}

function app(id, title) {
  return {
    entityType: "apk",
    id,
    title,
    apkname: `com.example.${id}`,
    logo: "https://image.coolapk.com/mock.png",
    score_v10: 8.8,
  };
}

function upstreamFixture(request, response) {
  const url = new URL(request.url, "http://fixture.local");
  const send = (status, body, contentType = "application/json") => {
    response.writeHead(status, { "Content-Type": contentType });
    response.end(contentType === "application/json" ? JSON.stringify(body) : body);
  };
  if (url.pathname === "/v6/page/dataList") {
    const source = url.searchParams.get("url") || "";
    const page = Number(url.searchParams.get("page") || 1);
    if (source === "V8_BAD_RESPONSE") return send(200, "", "text/plain");
    if (source === "V9_HOME_TAB_RANKING") return send(200, { data: [feed(1000 + page, `hot-${page}`)] });
    if (source.includes("rankType=rating")) return send(200, { data: [app(2001, "评分应用")] });
    if (source === "#/feed/ershouList") return send(200, { data: [feed(3001, "二手内容")] });
    if (source.startsWith("/apk/categoryList")) {
      return send(200, {
        data: [
          { entityType: "category", id: 5, title: "系统工具", tags: "输入法,文件管理", logo: "https://image.coolapk.com/c1.png", url: "/apk/category?catId=5&apkType=1" },
          { entityType: "category", id: 6, title: "影音娱乐", tags: "视频,音乐", logo: "https://image.coolapk.com/c2.png", url: "/apk/category?catId=6&apkType=1" },
        ],
      });
    }
    return send(200, { data: [] });
  }
  if (url.pathname === "/v6/topic/recentFeedList") {
    const page = Number(url.searchParams.get("page") || 1);
    return send(200, { data: [feed(4000 + page, `recent-${page}`)] });
  }
  if (url.pathname === "/v6/search") {
    const type = url.searchParams.get("type");
    const searchValue = url.searchParams.get("searchValue") || "needle";
    const requestedPage = Number(url.searchParams.get("page") || 1);
    const page = requestedPage > 1 && (!url.searchParams.get("firstItem") || !url.searchParams.get("lastItem"))
      ? 1
      : requestedPage;
    const offset = page * 100;
    if (type === "feed") {
      const body = { data: Array.from({ length: 20 }, (_, index) => feed(offset + index, `${searchValue}-${page}-${index}`)) };
      if (searchValue === "race") {
        raceFeedSearchRequests += 1;
        return setTimeout(() => send(200, body), 50);
      }
      return send(200, body);
    }
    if (type === "user") {
      return send(200, {
        data: Array.from({ length: 20 }, (_, index) => ({
          entityType: "user",
          uid: String(offset + index),
          username: `${searchValue}-user-${page}-${index}`,
        })),
      });
    }
    if (type === "app") return send(200, { data: Array.from({ length: 20 }, (_, index) => app(offset + index, `${searchValue}-app-${page}-${index}`)) });
    return send(200, { data: [] });
  }
  if (url.pathname === "/v6/topic/newTagDetail") return send(200, { data: {} });
  if (url.pathname === "/v6/main/indexV8" || url.pathname === "/v6/apk/index") return send(200, { data: [] });
  return send(200, { data: [] });
}

function waitForApplication(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`application startup timed out\n${output}`)), 15_000);
    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/127\.0\.0\.1:(\d+)/);
      if (!match) return;
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      resolve(Number(match[1]));
    };
    child.stdout.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`application exited before startup (${code})\n${output}`));
    });
  });
}

async function requestJson(origin, path, { cookie = "", ...options } = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

test("HTTP server protects private APIs and keeps every public content route functional", { timeout: 40_000 }, async (context) => {
  const upstream = createServer(upstreamFixture);
  const upstreamPort = await listen(upstream);
  const dataDir = await mkdtemp(join(tmpdir(), "coolapk-http-test-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "0",
      APP_DATA_DIR: dataDir,
      COOLAPK_API_ROOT: `http://127.0.0.1:${upstreamPort}/v6`,
      APP_ACCESS_TOKEN: "INTEGRATION_ACCESS_TOKEN",
      DISABLE_BACKGROUND_TASKS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  context.after(async () => {
    const exited = child.exitCode == null
      ? new Promise((resolve) => child.once("exit", resolve))
      : Promise.resolve();
    child.kill("SIGTERM");
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    await close(upstream);
    await rm(dataDir, { recursive: true, force: true });
  });

  const port = await waitForApplication(child);
  const origin = `http://127.0.0.1:${port}`;

  const staticPage = await fetch(`${origin}/`);
  assert.equal(staticPage.status, 200);
  assert.match(await staticPage.text(), /id="accessDialog"/);

  const status = await requestJson(origin, "/api/auth/status");
  assert.deepEqual(status.body, { enabled: true, authenticated: false });
  assert.equal((await requestJson(origin, "/api/settings")).response.status, 401);
  assert.equal((await requestJson(origin, "/api/messages?page=1")).response.status, 401);

  const malformedJson = await requestJson(origin, "/api/auth/login", {
    method: "POST",
    body: '{"token":"INTEGRATION_ACCESS_TOKEN",',
  });
  assert.equal(malformedJson.response.status, 400);
  assert.deepEqual(malformedJson.body, { error: "请求体不是有效的 JSON" });
  assert.equal(JSON.stringify(malformedJson.body).includes("INTEGRATION_ACCESS_TOKEN"), false);
  assert.equal(JSON.stringify(malformedJson.body).includes("Unexpected"), false);

  const rejected = await requestJson(origin, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ token: "wrong" }),
  });
  assert.equal(rejected.response.status, 401);

  const accepted = await requestJson(origin, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ token: "INTEGRATION_ACCESS_TOKEN" }),
  });
  assert.equal(accepted.response.status, 200);
  const cookie = accepted.response.headers.get("set-cookie")?.split(";", 1)[0] || "";
  assert.match(cookie, /^coolapk_access_session=/);
  assert.equal((await requestJson(origin, "/api/settings", { cookie })).response.status, 200);

  const invalidAiUrl = await requestJson(origin, "/api/settings", {
    method: "PUT",
    cookie,
    body: JSON.stringify({ ai: { enabled: true, baseUrl: "not a URL" } }),
  });
  assert.equal(invalidAiUrl.response.status, 400);
  assert.deepEqual(invalidAiUrl.body, { error: "AI API 地址格式不正确" });
  const settingsAfterInvalidUrl = await requestJson(origin, "/api/settings", { cookie });
  assert.equal(settingsAfterInvalidUrl.body.ai.enabled, false);
  assert.equal(settingsAfterInvalidUrl.body.ai.baseUrl, "https://api.openai.com/v1");

  const channels = await requestJson(origin, "/api/web/channels", { cookie });
  assert.equal(channels.response.status, 200);
  assert.equal(channels.body.channels.length, 22);
  for (const channel of channels.body.channels) {
    const result = await requestJson(origin, `/api/web/channel?channel=${encodeURIComponent(channel.key)}&page=1`, { cookie });
    assert.equal(result.response.status, 200, `${channel.key} failed: ${JSON.stringify(result.body)}`);
  }

  const hot = await requestJson(origin, "/api/discovery/feeds?mode=hot&page=1", { cookie });
  assert.equal(hot.response.status, 200);
  assert.equal(String(hot.body.feeds[0].id), "1001");
  assert.equal(hot.body.mode, "hot");
  const hotCached = await requestJson(origin, "/api/discovery/feeds?mode=hot&page=1", { cookie });
  assert.equal(hotCached.response.headers.get("x-data-cache"), "HIT");

  const recent = await requestJson(origin, "/api/discovery/feeds?mode=recent&page=not-a-number", { cookie });
  assert.equal(recent.response.status, 200);
  assert.equal(recent.body.page, 1);
  assert.equal(String(recent.body.feeds[0].id), "4001");

  const ratings = await requestJson(origin, "/api/web/channel?channel=ratings&page=1", { cookie });
  assert.equal(ratings.body.apps[0].title, "评分应用");
  const secondHand = await requestJson(origin, "/api/web/channel?channel=second_hand&page=1", { cookie });
  assert.equal(String(secondHand.body.feeds[0].id), "3001");
  const categories = await requestJson(origin, `/api/web/page?source=${encodeURIComponent("/apk/categoryList?apkType=1")}&page=1`, { cookie });
  assert.deepEqual(categories.body.directories.map((item) => item.title), ["系统工具", "影音娱乐"]);

  const [concurrentAllSearch, concurrentFeedSearch] = await Promise.all([
    requestJson(origin, `/api/search/all?q=${encodeURIComponent("race")}&page=1`, { cookie }),
    requestJson(origin, `/api/search/feeds?q=${encodeURIComponent("race")}&page=1`, { cookie }),
  ]);
  assert.equal(concurrentAllSearch.response.status, 200);
  assert.equal(concurrentFeedSearch.response.status, 200);
  assert.equal(concurrentAllSearch.body.feeds.length, 20);
  assert.equal(concurrentFeedSearch.body.feeds.length, 20);
  assert.deepEqual(
    concurrentAllSearch.body.feeds.map((item) => String(item.id)),
    concurrentFeedSearch.body.feeds.map((item) => String(item.id)),
  );
  assert.equal(raceFeedSearchRequests, 1);

  const firstSearch = await requestJson(origin, `/api/search/all?q=${encodeURIComponent("needle")}&page=1`, { cookie });
  const secondSearch = await requestJson(origin, `/api/search/all?q=${encodeURIComponent("needle")}&page=2`, { cookie });
  assert.equal(firstSearch.response.status, 200);
  assert.equal(secondSearch.response.status, 200);
  for (const [key, idKey] of [["feeds", "id"], ["users", "uid"], ["apps", "id"]]) {
    const firstIds = new Set(firstSearch.body[key].map((item) => String(item[idKey])));
    const overlap = secondSearch.body[key].filter((item) => firstIds.has(String(item[idKey])));
    assert.deepEqual(overlap, [], `${key} search pages overlap`);
  }
  assert.equal(secondSearch.body.topics.length, 0);
  assert.equal(secondSearch.body.meta.feeds.page, 2);

  const malformed = await requestJson(origin, "/api/web/topics/%E0%A4%A?page=1", { cookie });
  assert.equal(malformed.response.status, 400);
  const invalidUpstream = await requestJson(origin, "/api/web/page?source=V8_BAD_RESPONSE&page=1", { cookie });
  assert.equal(invalidUpstream.response.status, 502);

  const logout = await requestJson(origin, "/api/auth/logout", { method: "POST", cookie });
  assert.equal(logout.response.status, 200);
  assert.equal((await requestJson(origin, "/api/settings", { cookie })).response.status, 401);
  assert.equal(stderr.includes("INTEGRATION_ACCESS_TOKEN"), false);
});
