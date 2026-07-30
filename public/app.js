const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const viewHost = $("#viewHost");
const toastRegion = $("#toastRegion");
const feedDialog = $("#feedDialog");
const feedDialogBody = $("#feedDialogBody");
const appDialog = $("#appDialog");
const appDialogBody = $("#appDialogBody");
const topicDialog = $("#topicDialog");
const topicDialogBody = $("#topicDialogBody");
const userDialog = $("#userDialog");
const userDialogBody = $("#userDialogBody");
const collectionDialog = $("#collectionDialog");
const collectionDialogBody = $("#collectionDialogBody");
const composeDialog = $("#composeDialog");
const ruleDialog = $("#ruleDialog");
const lightbox = $("#lightbox");
const lightboxImage = $("#lightboxImage");
const lightboxStage = $("#lightboxStage");

const state = {
  route: "home",
  routeParams: new URLSearchParams(),
  requestSequence: 0,
  topics: [],
  status: null,
  settings: null,
  account: null,
  notificationCounts: {},
  compose: { type: "feed", id: "", title: "", files: [], previewUrls: [] },
  evaluations: [],
  evaluationStats: { total: 0, matched: 0, notified: 0, errors: 0 },
  channelCache: new Map(),
  discover: { mode: "recent", page: 1, feeds: [] },
  monitor: {
    topic: "__all__",
    q: "",
    ai: "all",
    sort: "created_desc",
    page: 1,
    pageSize: 20,
    feeds: [],
    meta: { total: 0, totalPages: 1, page: 1 },
  },
  ai: { status: "matched", topic: "", page: 1, totalPages: 1 },
  activeFeedId: "",
  feedReplyPage: 1,
  activeRuleTopic: "",
  carouselTimer: null,
  lightbox: { zoom: 1, x: 0, y: 0, dragging: false, startX: 0, startY: 0 },
};

const numberFormat = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
const fullNumberFormat = new Intl.NumberFormat("zh-CN");
const dateFormat = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const PAGE_CHANNELS = {
  V11_HOME_TAB_NEWS: "news",
  V9_HOME_TAB_WENDA: "questions",
  V8_HUODONG_XIANLIAO_20210523: "chat",
  V11_HOME_NEW: "new_devices",
  V13_IOSHOME_OPENSHOW: "unboxing",
  V13_HOME_SHEYING: "photography",
  V11_HOME_TABJC: "tutorials",
  V11_HOME_CAR: "cars",
  V14_WAISHE: "peripherals",
  V9_HOME_TAB_SHIPIN: "videos",
  V11_HOME_MEIHUA: "customization",
  V11_FIND_COOLPIC: "pictures",
  V11_FIND_GOOD_GOODS_HOME: "goods",
  V11_DISCOVERY_SECOND_HAND: "second_hand",
  V13_PINGFEN: "ratings",
  V10_DIGITAL_HOME: "digital",
  V9_HOME_TAB_TOPIC: "topics",
  V10_MARKET_HOME: "apps",
  V8_MARKET_GAME: "games",
  V10_MARKET_RANK: "app_rankings",
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败（HTTP ${response.status}）`);
  return payload;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function stripHtml(value = "") {
  const documentNode = new DOMParser().parseFromString(String(value), "text/html");
  return documentNode.body.textContent?.replace(/\[[^\]]+\]/g, "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() || "";
}

function safeUrl(value = "") {
  try {
    const url = new URL(value, location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function imageUrl(value = "") {
  const url = safeUrl(value);
  return url ? `/api/image?url=${encodeURIComponent(url)}` : "";
}

function compactNumber(value) {
  return numberFormat.format(Number(value || 0));
}

function formatDate(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) || date.getTime() <= 0 ? "时间未知" : dateFormat.format(date);
}

function relativeTime(value) {
  const timestamp = new Date(value || 0).getTime();
  if (!timestamp) return "时间未知";
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)} 天前`;
  return formatDate(timestamp);
}

function displayFeedTitle(feed = {}) {
  const title = stripHtml(feed.title || "");
  if (title && !/^(?:酷安动态|用户动态|动态)$/u.test(title) && !/^.{1,60}的动态$/u.test(title)) return title;
  return stripHtml(feed.message || "")
    .replace(/^(?:#[^#\r\n]{1,80}#\s*)+/u, "")
    .replace(/\s*查看链接\s*/gu, " ")
    .split(/\n+/)[0]
    .trim()
    .slice(0, 120) || "酷安动态";
}

function avatarMarkup(url, name = "", className = "avatar") {
  const src = imageUrl(url);
  return src
    ? `<img class="${className}" src="${escapeHtml(src)}" alt="${escapeHtml(name)}" loading="lazy" />`
    : `<span class="${className} fallback"><i class="ph ph-user"></i></span>`;
}

function toast(message, type = "") {
  const icon = type === "error" ? "warning-circle" : type === "success" ? "check-circle" : "info";
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.innerHTML = `<i class="ph ph-${icon}"></i><span>${escapeHtml(message)}</span>`;
  toastRegion.append(node);
  setTimeout(() => node.remove(), 4200);
}

function showDialog(dialog) {
  if (!dialog || dialog.open) return;
  dialog._returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  try { dialog.showModal(); } catch { dialog.setAttribute("open", ""); }
}

function closeDialog(dialog) {
  if (!dialog?.open) return;
  try { dialog.close(); } catch { dialog.removeAttribute("open"); }
  const returnFocus = dialog._returnFocus;
  dialog._returnFocus = null;
  if (returnFocus?.isConnected) setTimeout(() => returnFocus.focus({ preventScroll: true }), 0);
}

function closeAllDialogs() {
  $$("dialog[open]").forEach((dialog) => closeDialog(dialog));
}

function routeToAccount(message = "连接酷安账号后即可继续") {
  closeAllDialogs();
  location.hash = "#/account";
  toast(message);
}

function pageLoading(title = "正在加载内容") {
  return `<section class="page-loading"><span class="loading-logo"><i class="ph-bold ph-lightning"></i></span><h1>${escapeHtml(title)}</h1><p>正在与酷安公开接口同步…</p></section>`;
}

function emptyState(icon, title, text, action = "") {
  return `<section class="empty-state"><span><i class="ph ph-${icon}"></i></span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p>${action}</section>`;
}

function skeletonFeeds(count = 3) {
  return `<div class="feed-stream">${Array.from({ length: count }, () => `<article class="feed-skeleton skeleton"></article>`).join("")}</div>`;
}

function pageHead(eyebrow, title, description, actions = "") {
  return `<header class="page-head"><div><p class="eyebrow"><i class="ph ph-lightning"></i>${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1><p class="description">${escapeHtml(description)}</p></div>${actions ? `<div class="page-head-actions">${actions}</div>` : ""}</header>`;
}

function evaluationFor(feed) {
  return feed?.evaluation || state.evaluations.find((item) => String(item.feedId) === String(feed?.id) && (!feed?.__monitorTopicTag || item.topic === feed.__monitorTopicTag)) || null;
}

function feedImageMarkup(feed) {
  const pictures = [...new Set((feed.pictures || []).filter(Boolean))];
  if (!pictures.length) return "";
  const visible = pictures.slice(0, 3);
  const className = visible.length === 1 ? "one" : visible.length === 2 ? "two" : "three";
  return `<div class="feed-images ${className}">${visible.map((picture, index) => {
    const more = index === 2 && pictures.length > 3 ? `+${pictures.length - 3}` : "";
    return `<button class="${more ? "more" : ""}" type="button" data-image="${escapeHtml(picture)}" data-caption="${escapeHtml(displayFeedTitle(feed))}" aria-label="放大帖子图片 ${index + 1}${more ? `，另有 ${pictures.length - 3} 张` : ""}" ${more ? `data-more="${more}"` : ""}><img src="${escapeHtml(imageUrl(picture))}" alt="帖子图片 ${index + 1}" loading="lazy" /></button>`;
  }).join("")}</div>`;
}

function feedCard(feed, options = {}) {
  const message = stripHtml(feed.message || "");
  const title = displayFeedTitle(feed);
  const evaluation = evaluationFor(feed);
  const score = Number(evaluation?.matchScore ?? evaluation?.confidence);
  const scoreMarkup = Number.isFinite(score)
    ? `<span class="ai-badge ${evaluation.matched ? "matched" : ""}"><i class="ph ph-sparkle"></i>${Math.round(score * 100)}%</span>`
    : evaluation?.status === "error" ? `<span class="ai-badge error"><i class="ph ph-warning"></i>判断异常</span>` : "";
  return `
    <article class="feed-card ${options.compact ? "compact" : ""}" data-feed-card="${escapeHtml(feed.id)}">
      <div class="feed-card-main">
        <header class="feed-author">
          ${avatarMarkup(feed.avatar, feed.username)}
          <div class="feed-author-info">
            <button type="button" data-user="${escapeHtml(feed.userId || "")}">${escapeHtml(feed.username || "酷友")}</button>
            <small>${escapeHtml(relativeTime(feed.createdAt))}${feed.device ? ` · ${escapeHtml(feed.device)}` : ""}</small>
          </div>
          ${feed.topic ? `<button class="feed-topic" type="button" data-public-topic="${escapeHtml(feed.topic)}"><i class="ph ph-hash"></i>${escapeHtml(feed.topic)}</button>` : ""}
        </header>
        <h2 class="feed-title">${escapeHtml(title)}</h2>
        ${message && message !== title ? `<p class="feed-text">${escapeHtml(message)}</p>` : ""}
        ${feedImageMarkup(feed)}
      </div>
      <footer class="feed-meta">
        <button class="${feed.liked ? "active" : ""}" type="button" data-feed-like="${escapeHtml(feed.id)}" data-liked="${feed.liked ? "1" : "0"}" aria-label="${feed.liked ? "取消点赞" : "点赞"}，当前 ${compactNumber(feed.likes)} 个赞"><i class="ph${feed.liked ? "-fill" : ""} ph-thumbs-up"></i><span data-interaction-count data-count="${Number(feed.likes || 0)}">${compactNumber(feed.likes)}</span></button>
        <button type="button" data-feed="${escapeHtml(feed.id)}" aria-label="查看 ${compactNumber(feed.comments)} 条评论"><i class="ph ph-chat-circle"></i>${compactNumber(feed.comments)}</button>
        <button class="share-action" type="button" data-share-feed="${escapeHtml(feed.id)}" data-share-url="${escapeHtml(feed.url || `https://www.coolapk.com/feed/${feed.id}`)}" data-share-title="${escapeHtml(title)}" aria-label="分享动态"><i class="ph ph-share-network"></i>${compactNumber(feed.shares)}</button>
        ${scoreMarkup}
        <button class="open-feed" type="button" data-feed="${escapeHtml(feed.id)}">查看详情<i class="ph ph-caret-right"></i></button>
      </footer>
    </article>`;
}

function feedStream(feeds, options = {}) {
  return feeds?.length
    ? `<div class="feed-stream">${feeds.map((feed) => feedCard(feed, options)).join("")}</div>`
    : emptyState("newspaper", "暂时没有内容", "该频道当前没有返回可展示的公开动态，请稍后刷新。");
}

function appCard(app) {
  return `<button class="app-card" type="button" data-app="${escapeHtml(app.id)}">
    ${app.logo ? `<img src="${escapeHtml(imageUrl(app.logo))}" alt="${escapeHtml(app.title)}" loading="lazy" />` : `<span class="app-logo-placeholder"><i class="ph ph-app-window"></i></span>`}
    <div><h3>${escapeHtml(app.title)}</h3><p>${escapeHtml(app.category || app.subtitle || app.packageName || "应用")}</p><footer><span class="score"><i class="ph-fill ph-star"></i> ${Number(app.score || 0).toFixed(1)}</span><span>${escapeHtml(app.version || "")}</span><span>${escapeHtml(app.size || "")}</span></footer></div>
  </button>`;
}

function appGrid(apps) {
  return apps?.length ? `<div class="app-grid">${apps.map(appCard).join("")}</div>` : emptyState("squares-four", "暂无应用", "当前页面没有返回应用数据。");
}

function topicCard(topic, { showMonitor = true } = {}) {
  const monitored = state.topics.some((item) => item.sourceKey === topic.sourceKey || item.tag === topic.tag);
  const logo = topic.logo ? `<img src="${escapeHtml(imageUrl(topic.logo))}" alt="" loading="lazy" />` : `<i class="ph ph-hash"></i>`;
  const title = topic.title || topic.tag;
  return `<article class="topic-card">
    <button class="topic-card-cover" type="button" data-public-topic="${escapeHtml(topic.tag || title)}" aria-label="查看话题：${escapeHtml(title)}">${topic.logo ? `<img src="${escapeHtml(imageUrl(topic.logo))}" alt="" loading="lazy" />` : ""}</button>
    <div class="topic-card-body"><span class="topic-card-logo">${logo}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(stripHtml(topic.description || topic.intro || "查看话题中的最新公开动态"))}</p>
      <footer><span>${compactNumber(topic.followers)} 关注</span><span>${compactNumber(topic.posts)} 动态</span>${showMonitor ? `<button type="button" data-monitor-add="${escapeHtml(topic.sourceKey || topic.tag)}" aria-label="${monitored ? "已监控" : "加入监控"}：${escapeHtml(title)}" ${monitored ? "disabled" : ""}>${monitored ? "已监控" : "加入监控"}</button>` : ""}</footer>
    </div>
  </article>`;
}

function topicGrid(topics, options = {}) {
  return topics?.length ? `<div class="topic-grid">${topics.map((topic) => topicCard(topic, options)).join("")}</div>` : emptyState("hash", "暂无话题", "输入关键词搜索一个公开话题。");
}

function userCards(users) {
  if (!users?.length) return emptyState("user-circle", "暂无用户", "没有找到匹配的公开用户资料。");
  return `<div class="app-grid">${users.map((user) => `<button class="app-card" type="button" data-user="${escapeHtml(user.uid)}">${avatarMarkup(user.avatar, user.username, "avatar")}<div><h3>${escapeHtml(user.username)}</h3><p>${escapeHtml(user.bio || user.verifyLabel || `UID ${user.uid}`)}</p><footer><span>${compactNumber(user.followers)} 粉丝</span><span>Lv.${Number(user.level || 0)}</span></footer></div></button>`).join("")}</div>`;
}

function renderHero(banners = []) {
  if (!banners.length) {
    return `<section class="hero-carousel"><div class="hero-fallback"><span>COOLAPK WEB</span><h2>在浏览器里，打开完整的酷安内容工作台</h2><p>首页、动态、应用、话题、详情评论与 AI 监控，现在统一在一个响应式界面中。</p></div></section>`;
  }
  return `<section class="hero-carousel" id="heroCarousel">${banners.map((banner, index) => `<button class="hero-slide ${index === 0 ? "active" : ""}" type="button" data-smart-link="${escapeHtml(banner.url)}" aria-label="打开精选内容：${escapeHtml(banner.title)}"><img src="${escapeHtml(imageUrl(banner.picture))}" alt="" /><span class="hero-caption"><small>今日精选</small><h2>${escapeHtml(banner.title)}</h2><p>${escapeHtml(banner.subtitle || "来自酷安社区的热门内容")}</p></span></button>`).join("")}<div class="hero-dots">${banners.map((_, index) => `<button class="${index === 0 ? "active" : ""}" type="button" data-hero-index="${index}" aria-label="切换到第 ${index + 1} 张精选内容"></button>`).join("")}</div></section>`;
}

function renderShortcuts(shortcuts = []) {
  const fallback = [
    { title: "科技快讯", url: "channel:news", icon: "lightning" },
    { title: "问答", url: "channel:questions", icon: "question" },
    { title: "酷图", url: "channel:pictures", icon: "image" },
    { title: "数码", url: "channel:digital", icon: "device-mobile" },
    { title: "话题", url: "#/topics", icon: "hash" },
  ];
  const items = shortcuts.length ? shortcuts.slice(0, 10) : fallback;
  return `<div class="shortcut-strip">${items.map((item) => `<button class="shortcut" type="button" data-smart-link="${escapeHtml(item.url)}">${item.picture ? `<img src="${escapeHtml(imageUrl(item.picture))}" alt="" loading="lazy" />` : `<span class="shortcut-icon"><i class="ph ph-${escapeHtml(item.icon || "sparkle")}"></i></span>`}<span>${escapeHtml(item.title)}</span></button>`).join("")}</div>`;
}

async function loadBaseState() {
  const [topicsPayload, statusPayload, evaluationsPayload, accountPayload] = await Promise.all([
    api("/api/topics").catch(() => ({ topics: [] })),
    api("/api/status").catch(() => null),
    api("/api/evaluations?status=matched&page=1&pageSize=20").catch(() => ({ evaluations: [], stats: {} })),
    api("/api/account").catch(() => null),
  ]);
  state.topics = topicsPayload.topics || [];
  state.status = statusPayload;
  state.evaluations = evaluationsPayload.evaluations || [];
  state.evaluationStats = evaluationsPayload.stats || state.evaluationStats;
  state.account = accountPayload;
  if (state.account?.configured) {
    const countsPayload = await api("/api/notifications/counts").catch(() => ({ counts: {} }));
    state.notificationCounts = countsPayload.counts || {};
  } else {
    state.notificationCounts = {};
  }
  updateChrome();
}

function updateChrome(error = false) {
  $("#monitorNavCount").textContent = state.topics.length;
  $("#aiNavCount").textContent = Number(state.evaluationStats.matched || 0);
  const notificationCount = Number(state.notificationCounts.badge || state.notificationCounts.notification || 0);
  $("#notificationNavCount").textContent = notificationCount;
  $("#notificationNavCount").hidden = notificationCount <= 0;
  $("#accountChipName").textContent = state.account?.configured ? state.account.username || `UID ${state.account.uid}` : "连接酷安账号";
  $("#accountChipStatus").textContent = state.account?.valid ? "账号会话正常" : state.account?.configured ? "会话待验证" : "公开浏览模式";
  const dot = $("#liveDot");
  dot.className = `live-dot ${error ? "error" : state.status ? "online" : ""}`;
  $("#railStatusTitle").textContent = error ? "连接异常" : state.status?.refreshing ? "正在同步" : state.status ? "服务运行中" : "正在连接";
  $("#railStatusText").textContent = state.status?.nextPollAt ? `下次 ${formatDate(state.status.nextPollAt)}` : error ? "请检查服务进程" : "读取服务状态…";
}

function setActiveNavigation(route) {
  const navRoute = route === "search" ? "" : route;
  $$("[data-nav]").forEach((item) => item.classList.toggle("active", item.dataset.nav === navRoute));
}

function parseRoute() {
  const value = location.hash.replace(/^#\/?/, "");
  const [path = "home", query = ""] = value.split("?");
  const route = ["home", "discover", "apps", "topics", "notifications", "account", "monitor", "ai", "settings", "search"].includes(path) ? path : "home";
  return { route, params: new URLSearchParams(query) };
}

async function route({ force = false } = {}) {
  closeAllDialogs();
  const parsed = parseRoute();
  state.route = parsed.route;
  state.routeParams = parsed.params;
  setActiveNavigation(parsed.route);
  document.body.classList.remove("mobile-rail-open");
  clearInterval(state.carouselTimer);
  const sequence = ++state.requestSequence;
  viewHost.innerHTML = pageLoading({
    home: "正在加载首页",
    discover: "正在加载动态广场",
    apps: "正在加载应用与游戏",
    topics: "正在加载话题",
    notifications: "正在加载通知与私信",
    account: "正在加载账号中心",
    monitor: "正在加载监控工作台",
    ai: "正在加载 AI 命中记录",
    settings: "正在加载系统设置",
    search: "正在搜索",
  }[parsed.route]);
  try {
    const renderers = { home: renderHome, discover: renderDiscover, apps: renderApps, topics: renderTopics, notifications: renderNotifications, account: renderAccount, monitor: renderMonitor, ai: renderAi, settings: renderSettings, search: renderSearch };
    await renderers[parsed.route]({ force, sequence });
    if (sequence === state.requestSequence) {
      viewHost.focus({ preventScroll: true });
      scrollTo({ top: 0, behavior: "instant" });
    }
  } catch (error) {
    if (sequence !== state.requestSequence) return;
    viewHost.innerHTML = `<section class="page">${pageHead("CONNECTION ERROR", "页面加载失败", error.message, `<button class="btn primary" type="button" data-retry><i class="ph ph-arrows-clockwise"></i>重新加载</button>`)}<div class="surface">${emptyState("warning-circle", "暂时无法取得数据", error.message)}</div></section>`;
    toast(error.message, "error");
  }
}

async function channelData(channel, { force = false, page = 1 } = {}) {
  const key = `${channel}:${page}`;
  if (!force && state.channelCache.has(key)) return state.channelCache.get(key);
  const data = await api(`/api/web/channel?channel=${encodeURIComponent(channel)}&page=${page}`);
  state.channelCache.set(key, data);
  return data;
}

async function renderHome({ force, sequence }) {
  const data = await channelData("home", { force });
  if (sequence !== state.requestSequence) return;
  const topics = data.topics.length ? data.topics : state.topics.map((item) => item.detail || item).filter(Boolean);
  viewHost.innerHTML = `<section class="page home-page">
    ${pageHead("COMMUNITY DESK", "今天，酷安有什么新鲜事", "将 Coolapk-UWP 的公开浏览体验重构为 Web，同时把 AI 监控作为独立工作台保留下来。", `<a class="btn secondary" href="#/monitor"><i class="ph ph-radar"></i>进入监控</a><button class="btn primary" type="button" data-route-refresh><i class="ph ph-arrows-clockwise"></i>刷新首页</button>`)}
    <div class="content-layout">
      <div class="content-column">
        ${renderHero(data.banners)}
        <section class="surface">${renderShortcuts(data.shortcuts)}</section>
        <div class="channel-tabs" id="homeChannelTabs">
          ${[["home", "头条"], ["news", "快讯"], ["questions", "问答"], ["pictures", "酷图"], ["digital", "数码"]].map(([key, label]) => `<button class="${key === "home" ? "active" : ""}" type="button" data-home-channel="${key}">${label}</button>`).join("")}
        </div>
        <div id="homeFeedRegion">${feedStream(data.feeds)}</div>
      </div>
      <aside class="side-column">
        <section class="surface"><header class="surface-head"><div><h3>智能监控概览</h3><p>每 5 分钟自动抓取与判断</p></div><a href="#/monitor">管理<i class="ph ph-caret-right"></i></a></header>
          <div class="stat-list"><article><small>监控话题</small><strong>${state.topics.length}</strong></article><article><small>AI 命中</small><strong>${compactNumber(state.evaluationStats.matched)}</strong></article><article><small>已通知</small><strong>${compactNumber(state.evaluationStats.notified)}</strong></article><article><small>归档动态</small><strong>${compactNumber(state.status?.archive?.feeds)}</strong></article></div>
        </section>
        <section class="surface"><header class="surface-head"><div><h3>热门话题</h3><p>社区正在讨论</p></div><a href="#/topics">全部</a></header><div class="topic-mini-list">${topics.slice(0, 6).map((topic) => `<button class="topic-mini" type="button" data-public-topic="${escapeHtml(topic.tag || topic.title)}">${topic.logo ? `<img src="${escapeHtml(imageUrl(topic.logo))}" alt="" loading="lazy" />` : `<span><i class="ph ph-hash"></i></span>`}<div><strong>${escapeHtml(topic.title || topic.tag)}</strong><small>${compactNumber(topic.followers || 0)} 人关注</small></div><i class="ph ph-caret-right"></i></button>`).join("") || emptyState("hash", "等待话题数据", "切换到话题页进行搜索。")}</div></section>
      </aside>
    </div>
  </section>`;
  startCarousel();
  const requestedChannel = state.routeParams.get("channel");
  if (requestedChannel && requestedChannel !== "home") loadHomeChannel(requestedChannel);
}

async function loadHomeChannel(channel) {
  const region = $("#homeFeedRegion");
  if (!region) return;
  $$("[data-home-channel]").forEach((button) => button.classList.toggle("active", button.dataset.homeChannel === channel));
  region.innerHTML = skeletonFeeds(2);
  try {
    const data = await channelData(channel);
    region.innerHTML = feedStream(data.feeds);
  } catch (error) {
    region.innerHTML = `<div class="inline-error">${escapeHtml(error.message)}</div>`;
  }
}

function startCarousel() {
  const carousel = $("#heroCarousel");
  if (!carousel) return;
  let index = 0;
  const slides = $$(".hero-slide", carousel);
  const dots = $$("[data-hero-index]", carousel);
  const show = (next) => {
    index = (next + slides.length) % slides.length;
    slides.forEach((slide, itemIndex) => slide.classList.toggle("active", itemIndex === index));
    dots.forEach((dot, itemIndex) => dot.classList.toggle("active", itemIndex === index));
  };
  carousel._showSlide = show;
  state.carouselTimer = setInterval(() => show(index + 1), 6000);
}

async function renderDiscover({ sequence }) {
  const mode = state.routeParams.get("mode") === "hot" ? "hot" : state.discover.mode;
  const payload = await api(`/api/discovery/feeds?mode=${mode}&page=1`);
  if (sequence !== state.requestSequence) return;
  state.discover = { mode, page: 1, feeds: payload.feeds || [] };
  viewHost.innerHTML = `<section class="page">
    ${pageHead("PUBLIC FEED", "动态广场", "浏览全站新鲜动态与热门内容，详情、评论和图片均在站内完成。", `<button class="btn secondary" type="button" data-route-refresh><i class="ph ph-arrows-clockwise"></i>刷新</button>`)}
    <div class="filter-tabs"><button class="${mode === "recent" ? "active" : ""}" type="button" data-discover-mode="recent">最新发布</button><button class="${mode === "hot" ? "active" : ""}" type="button" data-discover-mode="hot">热门动态</button></div>
    <div class="content-layout" style="margin-top:16px"><div class="content-column"><div id="discoverFeedRegion">${feedStream(state.discover.feeds)}</div><button class="btn secondary" id="discoverMore" type="button" data-discover-more>加载更多动态</button></div>
      <aside class="side-column"><section class="surface"><header class="surface-head"><div><h3>浏览说明</h3><p>公开内容只读模式</p></div></header><div class="about-card"><p>当前页面按发布时间或互动热度浏览。打开动态后可继续加载评论、查看用户公开主页和放大原图。</p></div></section><section class="surface"><header class="surface-head"><div><h3>快速频道</h3><p>来自 UWP 首页分类</p></div></header>${renderShortcuts([])}</section></aside>
    </div>
  </section>`;
}

async function loadMoreDiscover() {
  const button = $("#discoverMore");
  if (!button) return;
  button.disabled = true;
  button.innerHTML = `<i class="ph ph-circle-notch"></i>正在加载`;
  try {
    const nextPage = state.discover.page + 1;
    const payload = await api(`/api/discovery/feeds?mode=${state.discover.mode}&page=${nextPage}`);
    const map = new Map([...state.discover.feeds, ...(payload.feeds || [])].map((feed) => [String(feed.id), feed]));
    state.discover.feeds = [...map.values()];
    state.discover.page = nextPage;
    $("#discoverFeedRegion").innerHTML = feedStream(state.discover.feeds);
    button.disabled = !(payload.feeds || []).length;
    button.textContent = button.disabled ? "没有更多内容" : "加载更多动态";
  } catch (error) {
    toast(error.message, "error");
    button.disabled = false;
    button.textContent = "重新加载";
  }
}

async function renderApps({ force, sequence }) {
  const data = await channelData("apps", { force });
  if (sequence !== state.requestSequence) return;
  viewHost.innerHTML = `<section class="page">
    ${pageHead("APP MARKET", "应用与游戏", "浏览酷安应用资料、版本、评分和所属动态；应用详情在站内弹层展示。", `<a class="btn secondary" href="#/search?q=%E5%BA%94%E7%94%A8"><i class="ph ph-magnifying-glass"></i>搜索</a><button class="btn primary" type="button" data-route-refresh><i class="ph ph-arrows-clockwise"></i>刷新应用</button>`)}
    ${data.banners.length ? renderHero(data.banners) : ""}
    ${data.shortcuts.length ? `<section class="surface" style="margin:18px 0">${renderShortcuts(data.shortcuts)}</section>` : ""}
    <section class="surface"><header class="surface-head"><div><h2>最近更新</h2><p>应用、游戏与社区点评</p></div><button type="button" data-load-market>查看精选市场</button></header><div style="padding:16px" id="appsRegion">${appGrid(data.apps)}</div></section>
  </section>`;
}

async function renderTopics({ force, sequence }) {
  const data = await channelData("topics", { force });
  if (sequence !== state.requestSequence) return;
  viewHost.innerHTML = `<section class="page">
    ${pageHead("TOPIC DIRECTORY", "发现热门话题", "打开话题详情、浏览最新动态，或把感兴趣的话题直接加入 AI 监控。")}
    <section class="search-hero"><h1>今天想看什么？</h1><p>搜索数码产品、活动、优惠或任意社区话题</p><form class="search-page-form" id="topicSearchForm"><i class="ph ph-magnifying-glass"></i><input id="topicSearchInput" type="search" placeholder="输入话题关键词" /><button type="submit">搜索话题</button></form></section>
    <section class="surface"><header class="surface-head"><div><h2 id="topicRegionTitle">热门话题</h2><p>点击卡片在站内查看话题详情</p></div></header><div style="padding:16px" id="topicsRegion">${topicGrid(data.topics)}</div></section>
  </section>`;
}

async function searchTopicPage(keyword) {
  const region = $("#topicsRegion");
  if (!region) return;
  region.innerHTML = skeletonFeeds(2);
  try {
    const payload = await api(`/api/topics/search?q=${encodeURIComponent(keyword)}`);
    $("#topicRegionTitle").textContent = `“${keyword}”的搜索结果`;
    region.innerHTML = topicGrid(payload.results || []);
  } catch (error) {
    region.innerHTML = `<div class="inline-error">${escapeHtml(error.message)}</div>`;
  }
}

function monitorSourceButton(topic, active) {
  const detail = topic.detail || {};
  return `<button class="monitor-source ${active ? "active" : ""}" type="button" data-monitor-topic="${escapeHtml(topic.tag)}"><span>${detail.logo ? `<img src="${escapeHtml(imageUrl(detail.logo))}" alt="" />` : `<i class="ph ph-hash"></i>`}</span><div><strong>${escapeHtml(detail.title || topic.tag)}</strong><small>${compactNumber(topic.archiveCount || topic.feeds?.length || 0)} 条归档</small></div>${topic.lastError ? `<b title="${escapeHtml(topic.lastError)}"><i class="ph ph-warning"></i></b>` : ""}</button>`;
}

async function fetchMonitorData() {
  const monitor = state.monitor;
  const params = new URLSearchParams({
    page: String(monitor.page),
    pageSize: String(monitor.pageSize),
    sort: monitor.sort,
    ai: monitor.ai,
  });
  if (monitor.topic !== "__all__") params.set("topic", monitor.topic);
  if (monitor.q) params.set("q", monitor.q);
  return api(`/api/dashboard/feeds?${params}`);
}

async function renderMonitor({ sequence }) {
  const requestedTopic = state.routeParams.get("topic");
  if (requestedTopic) {
    state.monitor.topic = requestedTopic === "__all__" || state.topics.some((item) => item.tag === requestedTopic)
      ? requestedTopic
      : "__all__";
  } else if (state.monitor.topic !== "__all__" && !state.topics.some((item) => item.tag === state.monitor.topic)) {
    state.monitor.topic = "__all__";
  }
  const [payload, evaluationsPayload] = await Promise.all([
    fetchMonitorData(),
    api("/api/evaluations?status=all&page=1&pageSize=10").catch(() => ({ stats: state.evaluationStats })),
  ]);
  if (sequence !== state.requestSequence) return;
  state.monitor.feeds = payload.feeds || [];
  state.monitor.meta = payload.meta || payload;
  state.evaluationStats = evaluationsPayload.stats || state.evaluationStats;
  const activeTopic = state.topics.find((topic) => topic.tag === state.monitor.topic);
  viewHost.innerHTML = `<section class="page">
    ${pageHead("INTELLIGENCE RADAR", "话题监控", "监控是完整 Web 客户端中的智能模块：持续抓取、归档、关键词或 AI 判断，并按规则发送飞书。", `<button class="btn secondary" type="button" data-monitor-refresh><i class="ph ph-arrows-clockwise"></i>立即抓取</button><button class="btn primary" type="button" data-toggle-add-monitor><i class="ph ph-plus"></i>添加监控</button>`)}
    <div class="metric-grid">
      <article class="metric-card"><span class="metric-icon"><i class="ph ph-broadcast"></i></span><div><small>监控话题</small><strong>${state.topics.length}</strong></div></article>
      <article class="metric-card"><span class="metric-icon blue"><i class="ph ph-database"></i></span><div><small>归档动态</small><strong>${compactNumber(state.status?.archive?.feeds)}</strong></div></article>
      <article class="metric-card"><span class="metric-icon violet"><i class="ph ph-sparkle"></i></span><div><small>AI 命中</small><strong>${compactNumber(state.evaluationStats.matched)}</strong></div></article>
      <article class="metric-card"><span class="metric-icon amber"><i class="ph ph-paper-plane-tilt"></i></span><div><small>已发通知</small><strong>${compactNumber(state.evaluationStats.notified)}</strong></div></article>
    </div>
    <section class="surface" id="addMonitorPanel" hidden><header class="surface-head"><div><h2>搜索并添加监控源</h2><p>先从真实搜索结果中选择话题或产品</p></div><button type="button" data-toggle-add-monitor>收起</button></header><div style="padding:16px"><form class="search-page-form" id="monitorSearchForm"><i class="ph ph-magnifying-glass"></i><input id="monitorSearchInput" type="search" placeholder="输入精确话题名或产品关键词" /><button type="submit">搜索</button></form><div id="monitorSearchResults" style="margin-top:16px"></div></div></section>
    <div class="monitor-layout" style="margin-top:18px">
      <aside class="surface monitor-sources"><header class="surface-head"><div><h3>监控源</h3><p>按话题筛选归档</p></div></header><div class="monitor-source-list"><button class="monitor-source ${state.monitor.topic === "__all__" ? "active" : ""}" type="button" data-monitor-topic="__all__"><span><i class="ph ph-stack"></i></span><div><strong>全部话题</strong><small>${compactNumber(state.status?.archive?.feeds)} 条归档</small></div></button>${state.topics.map((topic) => monitorSourceButton(topic, state.monitor.topic === topic.tag)).join("")}</div></aside>
      <section class="surface monitor-workspace">
        <header class="surface-head"><div><h2>${escapeHtml(activeTopic?.detail?.title || activeTopic?.tag || "全部监控动态")}</h2><p>${activeTopic ? `${activeTopic.ai?.mode === "keyword" ? "关键词判断" : "AI 判断"} · ${activeTopic.ai?.notify === false ? "不通知" : "飞书通知开启"}` : "跨话题查看已归档内容"}</p></div>${activeTopic ? `<div><button type="button" data-rule-topic="${escapeHtml(activeTopic.tag)}"><i class="ph ph-funnel"></i>配置规则</button><button type="button" data-remove-topic="${escapeHtml(activeTopic.tag)}" style="color:var(--red)"><i class="ph ph-trash"></i>移除</button></div>` : ""}</header>
        <div class="monitor-toolbar"><label class="toolbar-search"><i class="ph ph-magnifying-glass"></i><input id="monitorFilter" type="search" value="${escapeHtml(state.monitor.q)}" placeholder="筛选归档正文" /></label><select id="monitorAiFilter"><option value="all">全部判断</option><option value="matched" ${state.monitor.ai === "matched" ? "selected" : ""}>仅命中</option><option value="unmatched" ${state.monitor.ai === "unmatched" ? "selected" : ""}>未命中</option><option value="error" ${state.monitor.ai === "error" ? "selected" : ""}>判断异常</option></select><select id="monitorSort"><option value="created_desc" ${state.monitor.sort === "created_desc" ? "selected" : ""}>发布时间</option><option value="updated_desc" ${state.monitor.sort === "updated_desc" ? "selected" : ""}>最近回复</option><option value="popular_desc" ${state.monitor.sort === "popular_desc" ? "selected" : ""}>互动热度</option><option value="ai_desc" ${state.monitor.sort === "ai_desc" ? "selected" : ""}>匹配度</option></select><select id="monitorPageSize"><option value="20" ${state.monitor.pageSize === 20 ? "selected" : ""}>20 条</option><option value="50" ${state.monitor.pageSize === 50 ? "selected" : ""}>50 条</option><option value="100" ${state.monitor.pageSize === 100 ? "selected" : ""}>100 条</option></select></div>
        <div class="monitor-feed-list" id="monitorFeedList">${monitorRows(state.monitor.feeds)}</div>
        ${monitorPagination()}
      </section>
    </div>
  </section>`;
  updateChrome();
}

function monitorRows(feeds) {
  if (!feeds?.length) return emptyState("tray", "没有符合条件的归档", "调整筛选条件，或立即执行一次抓取。");
  return feeds.map((feed) => {
    const evaluation = feed.evaluation || {};
    const score = Number(evaluation.matchScore ?? evaluation.confidence);
    const hasScore = Number.isFinite(score);
    const percent = hasScore ? Math.round(score * 100) : 0;
    const status = evaluation.status === "error" ? ["error", "判断异常"] : evaluation.notifiedAt ? ["sent", "已通知"] : evaluation.matched ? ["matched", "已命中"] : ["", evaluation.status ? "未命中" : "待判断"];
    return `<article class="monitor-feed-row"><div class="monitor-feed-primary"><strong>${escapeHtml(displayFeedTitle(feed))}</strong><p>${escapeHtml(stripHtml(feed.message || ""))}</p><small><span>${escapeHtml(feed.username || "酷友")}</span><span>${relativeTime(feed.createdAt)}</span><span>${escapeHtml(feed.__monitorTopicTag || feed.topicTags?.[0] || "")}</span></small></div><div class="monitor-feed-score"><span><b>${hasScore ? "匹配度" : "暂无评分"}</b><b>${hasScore ? `${percent}%` : "—"}</b></span><div class="score-track"><i class="${evaluation.matched ? "matched" : ""}" style="width:${percent}%"></i></div></div><span class="status-pill ${status[0]}"><i class="ph ph-${status[0] === "sent" ? "paper-plane-tilt" : status[0] === "matched" ? "check-circle" : status[0] === "error" ? "warning-circle" : "clock"}"></i>${status[1]}</span><div class="row-action"><button type="button" data-feed="${escapeHtml(feed.id)}">查看详情</button></div></article>`;
  }).join("");
}

function monitorPagination() {
  const meta = state.monitor.meta;
  const page = Number(meta.page || state.monitor.page || 1);
  const totalPages = Number(meta.totalPages || 1);
  const total = Number(meta.total || 0);
  return `<footer class="pagination"><small>共 ${fullNumberFormat.format(total)} 条 · 第 ${page}/${totalPages} 页</small><div><button type="button" data-monitor-page="${page - 1}" aria-label="上一页" ${page <= 1 ? "disabled" : ""}><i class="ph ph-caret-left"></i></button><button type="button" data-monitor-page="${page + 1}" aria-label="下一页" ${page >= totalPages ? "disabled" : ""}><i class="ph ph-caret-right"></i></button></div></footer>`;
}

async function reloadMonitorRegion() {
  const list = $("#monitorFeedList");
  if (list) list.innerHTML = `<div style="padding:16px">${skeletonFeeds(2)}</div>`;
  try {
    const payload = await fetchMonitorData();
    state.monitor.feeds = payload.feeds || [];
    state.monitor.meta = payload.meta || payload;
    if (list) list.innerHTML = monitorRows(state.monitor.feeds);
    const oldPagination = $(".monitor-workspace .pagination");
    if (oldPagination) oldPagination.outerHTML = monitorPagination();
  } catch (error) {
    if (list) list.innerHTML = `<div class="inline-error">${escapeHtml(error.message)}</div>`;
  }
}

async function renderAi({ sequence }) {
  const params = new URLSearchParams({ status: state.ai.status, page: String(state.ai.page), pageSize: "50" });
  if (state.ai.topic) params.set("topic", state.ai.topic);
  const payload = await api(`/api/evaluations?${params}`);
  if (sequence !== state.requestSequence) return;
  state.evaluations = payload.evaluations || [];
  state.evaluationStats = payload.stats || state.evaluationStats;
  state.ai.totalPages = payload.totalPages || 1;
  viewHost.innerHTML = `<section class="page">
    ${pageHead("MATCH HISTORY", "AI 命中记录", "百分比表示内容与关注意图的匹配程度；达到话题阈值后才会进入通知流程。", `<a class="btn secondary" href="#/settings"><i class="ph ph-sliders-horizontal"></i>AI 设置</a><button class="btn primary" type="button" data-route-refresh><i class="ph ph-arrows-clockwise"></i>刷新记录</button>`)}
    <div class="metric-grid"><article class="metric-card"><span class="metric-icon violet"><i class="ph ph-files"></i></span><div><small>全部判断</small><strong>${compactNumber(state.evaluationStats.total)}</strong></div></article><article class="metric-card"><span class="metric-icon"><i class="ph ph-check-circle"></i></span><div><small>符合规则</small><strong>${compactNumber(state.evaluationStats.matched)}</strong></div></article><article class="metric-card"><span class="metric-icon blue"><i class="ph ph-paper-plane-tilt"></i></span><div><small>已发通知</small><strong>${compactNumber(state.evaluationStats.notified)}</strong></div></article><article class="metric-card"><span class="metric-icon amber"><i class="ph ph-warning-circle"></i></span><div><small>判断异常</small><strong>${compactNumber(state.evaluationStats.errors)}</strong></div></article></div>
    <section class="surface"><header class="surface-head"><div><h2>内容判断流水</h2><p>每个话题独立展示规则、匹配度和通知状态</p></div><div class="filter-tabs"><button class="${state.ai.status === "matched" ? "active" : ""}" type="button" data-ai-status="matched">仅命中</button><button class="${state.ai.status === "all" ? "active" : ""}" type="button" data-ai-status="all">全部</button></div></header>
      <div class="monitor-toolbar"><select id="aiTopicFilter"><option value="">全部话题</option>${state.topics.map((topic) => `<option value="${escapeHtml(topic.tag)}" ${state.ai.topic === topic.tag ? "selected" : ""}>${escapeHtml(topic.detail?.title || topic.tag)}</option>`).join("")}</select></div>
      <div class="ai-history-list">${aiRows(state.evaluations)}</div>
      <footer class="pagination"><small>第 ${state.ai.page}/${state.ai.totalPages} 页</small><div><button type="button" data-ai-page="${state.ai.page - 1}" aria-label="上一页" ${state.ai.page <= 1 ? "disabled" : ""}><i class="ph ph-caret-left"></i></button><button type="button" data-ai-page="${state.ai.page + 1}" aria-label="下一页" ${state.ai.page >= state.ai.totalPages ? "disabled" : ""}><i class="ph ph-caret-right"></i></button></div></footer>
    </section>
  </section>`;
  updateChrome();
}

function aiRows(evaluations) {
  if (!evaluations?.length) return emptyState("sparkle", "暂无判断记录", "配置一个监控话题的规则并执行分析后，结果会显示在这里。");
  return evaluations.map((item) => {
    const score = Number(item.matchScore ?? item.confidence);
    const percent = Number.isFinite(score) ? Math.round(score * 100) : 0;
    const feed = item.feed || state.monitor.feeds.find((candidate) => String(candidate.id) === String(item.feedId));
    const status = item.status === "error" ? ["error", "异常"] : item.notifiedAt ? ["sent", "已通知"] : item.matched ? ["matched", "已命中"] : ["", "未命中"];
    return `<article class="ai-record"><div class="ai-score ${item.matched ? "matched" : ""}"><strong>${Number.isFinite(score) ? `${percent}%` : "—"}</strong><small>匹配度</small></div><div class="ai-record-main"><strong>${escapeHtml(displayFeedTitle(feed || { title: item.title || `动态 ${item.feedId}`, message: item.message || "" }))}</strong><p>${escapeHtml(item.reason || item.error || "暂无判断原因")}</p><small>${formatDate(item.evaluatedAt || item.updatedAt)} · ${escapeHtml(item.mode === "keyword" ? "关键词判断" : "AI 判断")}</small></div><span class="ai-record-topic"><i class="ph ph-hash"></i>${escapeHtml(item.topic || "未知话题")}</span><button class="status-pill ${status[0]}" type="button" data-feed="${escapeHtml(item.feedId)}"><i class="ph ph-${status[0] === "sent" ? "paper-plane-tilt" : status[0] === "matched" ? "check-circle" : status[0] === "error" ? "warning-circle" : "minus-circle"}"></i>${status[1]}</button></article>`;
  }).join("");
}

function accountRequiredCard(action = "使用账号互动功能") {
  return `<section class="surface account-gate">
    <span><i class="ph ph-user-circle-plus"></i></span>
    <div><h2>连接酷安账号</h2><p>${escapeHtml(action)}需要有效的酷安会话。连接后即可点赞、关注、回复、发布、查看通知和个人内容。</p></div>
    <a class="btn primary" href="#/account"><i class="ph ph-plugs-connected"></i>前往账号中心</a>
  </section>`;
}

function notificationRows(items = []) {
  if (!items.length) return emptyState("bell-slash", "暂无新内容", "该分类当前没有返回通知。");
  return `<div class="notification-list">${items.map((item) => `<article class="notification-row">
    ${avatarMarkup(item.avatar, item.username)}
    <div><header><strong>${escapeHtml(stripHtml(item.title || item.username || "酷安通知"))}</strong><small>${relativeTime(item.createdAt)}</small></header><p>${escapeHtml(stripHtml(item.message || ""))}</p><footer>${item.uid ? `<button type="button" data-user="${escapeHtml(item.uid)}">查看用户</button>` : ""}${item.feedId ? `<button type="button" data-feed="${escapeHtml(item.feedId)}">查看动态</button>` : ""}</footer></div>
  </article>`).join("")}</div>`;
}

function messageRows(items = []) {
  if (!items.length) return emptyState("chats", "暂无私信会话", "当前账号没有返回私信会话。");
  return `<div class="notification-list">${items.map((item) => `<article class="notification-row">
    ${avatarMarkup(item.avatar, item.username)}
    <div><header><strong>${escapeHtml(item.username)}</strong><small>${relativeTime(item.createdAt)}</small></header><p>${escapeHtml(stripHtml(item.message || "打开酷安 App 继续会话"))}</p><footer>${item.pinned ? `<span class="status-pill"><i class="ph ph-push-pin"></i>置顶</span>` : ""}${item.unreadCount ? `<span class="status-pill matched">${item.unreadCount} 条未读</span>` : ""}${item.uid ? `<button type="button" data-user="${escapeHtml(item.uid)}">查看主页</button>` : ""}</footer></div>
  </article>`).join("")}</div>`;
}

async function renderNotifications({ sequence }) {
  const account = await api("/api/account");
  state.account = account;
  if (sequence !== state.requestSequence) return;
  if (!account.configured) {
    viewHost.innerHTML = `<section class="page">${pageHead("INBOX", "通知与私信", "集中查看回复、@、点赞、关注和私信会话。")}${accountRequiredCard("查看账号通知")}</section>`;
    return;
  }
  const categories = [
    ["list", "回复我的", "chat-circle"],
    ["atMeList", "@我的动态", "at"],
    ["atCommentMeList", "@我的回复", "chats-circle"],
    ["feedLikeList", "收到的赞", "thumbs-up"],
    ["contactsFollowList", "新增关注", "user-plus"],
    ["messages", "私信", "envelope-simple"],
  ];
  const requestedTab = state.routeParams.get("tab") || "list";
  const tab = categories.some(([key]) => key === requestedTab) ? requestedTab : "list";
  const payload = tab === "messages"
    ? await api("/api/messages?page=1")
    : await api(`/api/notifications?type=${encodeURIComponent(tab)}&page=1`);
  if (sequence !== state.requestSequence) return;
  const counts = state.notificationCounts || {};
  viewHost.innerHTML = `<section class="page">
    ${pageHead("INBOX", "通知与私信", `已连接 ${account.username || `UID ${account.uid}`}，通知数据直接来自酷安账号。`, `<button class="btn secondary" type="button" data-route-refresh><i class="ph ph-arrows-clockwise"></i>刷新通知</button>`)}
    <div class="metric-grid notification-metrics">
      <article class="metric-card"><span class="metric-icon"><i class="ph ph-bell-ringing"></i></span><div><small>全部未读</small><strong>${compactNumber(counts.badge)}</strong></div></article>
      <article class="metric-card"><span class="metric-icon blue"><i class="ph ph-chat-circle"></i></span><div><small>新回复</small><strong>${compactNumber(counts.commentme)}</strong></div></article>
      <article class="metric-card"><span class="metric-icon violet"><i class="ph ph-thumbs-up"></i></span><div><small>收到的赞</small><strong>${compactNumber(counts.feedlike)}</strong></div></article>
      <article class="metric-card"><span class="metric-icon amber"><i class="ph ph-envelope"></i></span><div><small>新私信</small><strong>${compactNumber(counts.message)}</strong></div></article>
    </div>
    <section class="surface inbox-layout">
      <nav class="inbox-tabs">${categories.map(([key, label, icon]) => `<a class="${tab === key ? "active" : ""}" href="#/notifications?tab=${key}"><i class="ph ph-${icon}"></i><span>${label}</span></a>`).join("")}</nav>
      <div class="inbox-content">${tab === "messages" ? messageRows(payload.messages) : notificationRows(payload.notifications)}</div>
    </section>
  </section>`;
}

function collectionCards(collections = []) {
  if (!collections.length) return emptyState("bookmarks", "暂无收藏单", "该账号没有返回收藏单。");
  return `<div class="collection-grid">${collections.map((item) => `<button class="collection-card" type="button" data-collection="${escapeHtml(item.id)}">
    <span class="collection-cover">${item.cover ? `<img src="${escapeHtml(imageUrl(item.cover))}" alt="" loading="lazy" />` : `<i class="ph ph-bookmarks"></i>`}</span>
    <div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(stripHtml(item.description || item.subtitle || "酷安收藏单"))}</p><footer><span>${compactNumber(item.itemCount)} 项内容</span><span>${compactNumber(item.followers)} 关注</span></footer></div>
  </button>`).join("")}</div>`;
}

function accountTabContent(tab, payload) {
  if (["feeds", "articles", "questions"].includes(tab)) return feedStream(payload.feeds || []);
  if (tab === "collections") return collectionCards(payload.collections || []);
  if (["following", "fans"].includes(tab)) return userCards(payload.users || []);
  if (["history", "recent"].includes(tab)) {
    return `${feedStream(payload.feeds || [])}${payload.apps?.length ? `<section class="detail-section"><h3>访问过的应用</h3>${appGrid(payload.apps)}</section>` : ""}${payload.topics?.length ? `<section class="detail-section"><h3>访问过的话题</h3>${topicGrid(payload.topics)}</section>` : ""}`;
  }
  return "";
}

async function renderAccount({ sequence }) {
  const account = await api("/api/account");
  state.account = account;
  if (sequence !== state.requestSequence) return;
  if (!account.configured) {
    viewHost.innerHTML = `<section class="page account-page">
      ${pageHead("COOLAPK ACCOUNT", "连接酷安账号", "连接一次会话，即可在网页内使用点赞、关注、回复、发布、通知、私信列表、收藏和浏览历史。")}
      <div class="account-connect-layout">
        <form class="surface account-connect-card" id="accountForm">
          <header class="settings-card-head"><span><i class="ph ph-cookie"></i></span><div><h2>导入账号会话</h2><p>会话保存在当前服务器的 data/settings.json，不会返回到前端页面。</p></div></header>
          <div class="settings-fields">
            <label><span>UID</span><input id="coolapkUid" inputmode="numeric" autocomplete="off" placeholder="酷安数字 UID" required /></label>
            <label><span>用户名</span><input id="coolapkUsername" autocomplete="username" placeholder="酷安用户名" required /></label>
            <label class="wide"><span>Token</span><input id="coolapkToken" type="password" autocomplete="new-password" placeholder="登录 Cookie 中的 token" required /></label>
          </div>
          <footer class="settings-actions"><span id="accountConnectStatus">填写后将立即校验会话</span><button class="btn primary" type="submit"><i class="ph ph-plugs-connected"></i>连接并校验</button></footer>
        </form>
        <aside class="surface session-guide"><span><i class="ph ph-number-circle-one"></i></span><div><h3>取得会话字段</h3><p>在浏览器打开酷安账号页完成登录，再从开发者工具的 Application / Cookies 中读取 <code>uid</code>、<code>username</code>、<code>token</code> 三项。</p><a href="https://account.coolapk.com/auth/loginByCoolapk" target="_blank" rel="noreferrer">打开酷安登录页<i class="ph ph-arrow-square-out"></i></a></div><span><i class="ph ph-number-circle-two"></i></span><div><h3>导入并校验</h3><p>本站调用 <code>/v6/account/checkLoginInfo</code> 验证，通过后账号功能立即启用。</p></div></aside>
      </div>
    </section>`;
    return;
  }

  const tabs = [["feeds", "动态"], ["articles", "文章"], ["questions", "问答"], ["collections", "收藏"], ["following", "关注"], ["fans", "粉丝"], ["history", "历史"], ["recent", "常去"]];
  const requestedTab = state.routeParams.get("tab") || "feeds";
  const tab = tabs.some(([key]) => key === requestedTab) ? requestedTab : "feeds";
  const contentRequest = tab === "feeds" ? api(`/api/users/${account.uid}/feeds?branch=feed&page=1`)
    : tab === "articles" ? api(`/api/users/${account.uid}/feeds?branch=htmlFeed&page=1`)
      : tab === "questions" ? api(`/api/users/${account.uid}/feeds?branch=questionAndAnswer&page=1`)
        : tab === "collections" ? api(`/api/users/${account.uid}/collections?page=1`)
          : tab === "following" ? api(`/api/users/${account.uid}/connections?type=followList&page=1`)
            : tab === "fans" ? api(`/api/users/${account.uid}/connections?type=fansList&page=1`)
              : api(`/api/account/history?type=${tab === "recent" ? "recent" : "history"}&page=1`);
  const [profilePayload, contentPayload] = await Promise.all([
    api(`/api/users/${encodeURIComponent(account.uid)}?refresh=1`).catch(() => ({ profile: { uid: account.uid, username: account.username } })),
    contentRequest.catch((error) => ({ error: error.message })),
  ]);
  if (sequence !== state.requestSequence) return;
  const profile = profilePayload.profile || {};
  viewHost.innerHTML = `<section class="page account-page">
    ${pageHead("MY COOLAPK", "账号中心", "完整管理个人内容、社区关系、收藏与浏览记录。", `<button class="btn primary" type="button" data-compose="feed"><i class="ph ph-pencil-simple-line"></i>发布动态</button>`)}
    <section class="surface account-profile">
      ${avatarMarkup(profile.avatar, profile.username, "account-avatar")}
      <div class="account-profile-main"><small>已连接酷安账号</small><h2>${escapeHtml(profile.username || account.username)}</h2><p>${escapeHtml(profile.bio || profile.verifyLabel || `UID ${account.uid}`)}</p></div>
      <div class="profile-stats"><span><strong>${compactNumber(profile.followers)}</strong><small>粉丝</small></span><span><strong>${compactNumber(profile.following)}</strong><small>关注</small></span><span><strong>${compactNumber(profile.feeds)}</strong><small>动态</small></span><span><strong>${compactNumber(profile.likes)}</strong><small>获赞</small></span></div>
      <div class="account-actions"><button class="btn secondary" type="button" id="testAccount"><i class="ph ph-arrows-clockwise"></i>校验会话</button><button class="btn danger" type="button" id="disconnectAccount"><i class="ph ph-sign-out"></i>断开连接</button></div>
    </section>
    <div class="account-tabs">${tabs.map(([key, label]) => `<a class="${tab === key ? "active" : ""}" href="#/account?tab=${key}">${label}</a>`).join("")}</div>
    <section class="account-content">${contentPayload.error ? `<section class="surface">${emptyState("warning-circle", "账号内容加载失败", contentPayload.error)}</section>` : accountTabContent(tab, contentPayload)}</section>
  </section>`;
}

async function renderSettings({ sequence }) {
  const [settings, summary] = await Promise.all([
    api("/api/settings"),
    api("/api/archive/summary").catch(() => ({ archive: state.status?.archive || {}, retention: {} })),
  ]);
  if (sequence !== state.requestSequence) return;
  state.settings = settings;
  const ai = settings.ai || {};
  const feishu = settings.feishu || {};
  const retention = settings.retention || summary.retention || {};
  const archive = summary.archive || {};
  viewHost.innerHTML = `<section class="page">
    ${pageHead("SYSTEM CONFIGURATION", "系统设置", "集中管理 AI 兼容接口、飞书通知、数据留存与界面偏好；密钥仍只保存在服务端。")}
    <form class="settings-layout" id="settingsForm"><div class="settings-stack">
      <section class="surface settings-card"><header class="settings-card-head"><span><i class="ph ph-sparkle"></i></span><div><h2>AI 内容识别</h2><p>OpenAI、Anthropic、Gemini 与兼容接口自动适配</p></div><label class="toggle-row"><input id="aiEnabled" type="checkbox" ${ai.enabled ? "checked" : ""} /><span></span></label></header>
        <div class="settings-fields"><label class="wide"><span>API 地址</span><input id="aiBaseUrl" type="url" value="${escapeHtml(ai.baseUrl || "")}" placeholder="https://api.openai.com/v1" /></label><label><span>服务商</span><select id="aiProvider"><option value="auto">自动识别</option><option value="openai">OpenAI / 兼容服务</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option></select></label><label><span>模型</span><input id="aiModel" value="${escapeHtml(ai.model || "")}" /></label><label><span>接口协议</span><select id="aiApiMode"><option value="auto">自动选择</option><option value="responses">Responses API</option><option value="chat_completions">Chat Completions</option><option value="anthropic_messages">Anthropic Messages</option><option value="gemini_generate_content">Gemini GenerateContent</option></select></label><label><span>推理强度</span><select id="aiReasoning"><option value="none">无</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label><label class="wide"><span>API Key ${ai.apiKeyMasked ? `（当前 ${escapeHtml(ai.apiKeyMasked)}）` : ""}</span><input id="aiApiKey" type="password" autocomplete="new-password" placeholder="留空保留当前密钥" /></label><label><span>默认匹配阈值（%）</span><input id="aiThreshold" type="number" min="10" max="100" value="${Math.round(Number(ai.threshold || .72) * 100)}" /></label><label><span>单批判断条数</span><input id="aiBatchSize" type="number" min="1" max="20" value="${Number(ai.batchSize || 8)}" /></label><label class="wide toggle-row"><input id="aiIncludeImages" type="checkbox" ${ai.includeImages !== false ? "checked" : ""} /><span></span><b>把帖子图片一并交给支持视觉的模型判断</b></label></div>
        <footer class="settings-actions"><span id="aiTestStatus">保存前可先测试当前配置</span><button class="btn secondary" id="testAi" type="button"><i class="ph ph-plugs-connected"></i>测试 AI</button></footer>
      </section>
      <section class="surface settings-card"><header class="settings-card-head"><span class="blue"><i class="ph ph-paper-plane-tilt"></i></span><div><h2>飞书通知</h2><p>只推送标题或正文、图片、跳转链接与命中原因</p></div><label class="toggle-row"><input id="feishuEnabled" type="checkbox" ${feishu.enabled ? "checked" : ""} /><span></span></label></header>
        <div class="settings-fields"><label class="wide"><span>Webhook ${feishu.webhookMasked ? `（当前 ${escapeHtml(feishu.webhookMasked)}）` : ""}</span><input id="feishuWebhook" type="password" autocomplete="new-password" placeholder="留空保留当前 Webhook" /></label><label class="wide"><span>签名密钥 ${feishu.secretMasked ? `（当前 ${escapeHtml(feishu.secretMasked)}）` : ""}</span><input id="feishuSecret" type="password" autocomplete="new-password" placeholder="可选，留空保留当前密钥" /></label></div>
        <footer class="settings-actions"><span id="feishuTestStatus">测试消息不会包含 AI 配置</span><button class="btn secondary" id="testFeishu" type="button"><i class="ph ph-paper-plane-tilt"></i>测试飞书</button></footer>
      </section>
      <section class="surface settings-card"><header class="settings-card-head"><span class="amber"><i class="ph ph-database"></i></span><div><h2>数据留存与清理</h2><p>归档数据按时间和容量双重限制自动清理</p></div></header>
        <div class="settings-fields"><label><span>动态留存天数</span><input id="retentionFeedDays" type="number" min="7" max="3650" value="${Number(retention.feedDays || 365)}" /></label><label><span>AI 记录留存天数</span><input id="retentionEvaluationDays" type="number" min="7" max="3650" value="${Number(retention.evaluationDays || 365)}" /></label><label><span>用户缓存天数</span><input id="retentionUserDays" type="number" min="1" max="365" value="${Number(retention.userDays || 30)}" /></label><label><span>动态归档上限</span><input id="retentionMaxFeeds" type="number" min="100" max="100000" value="${Number(retention.maxFeeds || 20000)}" /></label><label><span>AI 记录上限</span><input id="retentionMaxEvaluations" type="number" min="100" max="100000" value="${Number(retention.maxEvaluations || 20000)}" /></label><label><span>清理间隔（小时）</span><input id="retentionCleanupHours" type="number" min="1" max="168" value="${Number(retention.cleanupIntervalHours || 24)}" /></label></div>
        <footer class="settings-actions"><span id="cleanupStatus">最近清理：${escapeHtml(archive.lastCleanupAt ? formatDate(archive.lastCleanupAt) : "尚无记录")}</span><button class="btn secondary" id="runCleanup" type="button"><i class="ph ph-broom"></i>立即清理</button></footer>
      </section>
      <div class="settings-actions surface"><span id="settingsSaveStatus">修改后点击保存生效</span><button class="btn primary" type="submit"><i class="ph ph-check"></i>保存全部设置</button></div>
    </div>
    <aside class="settings-aside"><section class="surface"><header class="surface-head"><div><h3>存储概览</h3><p>当前长期归档</p></div></header><div class="storage-stats"><div><small>动态</small><strong>${compactNumber(archive.feeds)}</strong></div><div><small>AI 判断</small><strong>${compactNumber(archive.evaluations)}</strong></div><div><small>用户</small><strong>${compactNumber(archive.users)}</strong></div><div><small>事件</small><strong>${compactNumber(archive.events)}</strong></div></div></section><section class="surface about-card"><h3>关于酷窗</h3><p>基于 Coolapk-UWP 的公开功能和 Coolapk-API-Collect 接口资料重新实现的响应式 Web 客户端。监控、AI 判断和飞书通知是本站新增的服务端能力。</p><a href="https://github.com/Coolapk-UWP/Coolapk-UWP" target="_blank" rel="noreferrer"><i class="ph ph-github-logo"></i>Coolapk-UWP</a></section></aside>
    </form>
  </section>`;
  $("#aiProvider").value = ai.provider || "auto";
  $("#aiApiMode").value = ai.apiMode || "auto";
  $("#aiReasoning").value = ai.reasoningEffort || "low";
}

function settingsPayload() {
  const apiKey = $("#aiApiKey").value.trim();
  const webhookUrl = $("#feishuWebhook").value.trim();
  const secret = $("#feishuSecret").value.trim();
  return {
    ai: {
      enabled: $("#aiEnabled").checked,
      baseUrl: $("#aiBaseUrl").value.trim(),
      provider: $("#aiProvider").value,
      model: $("#aiModel").value.trim(),
      apiMode: $("#aiApiMode").value,
      reasoningEffort: $("#aiReasoning").value,
      includeImages: $("#aiIncludeImages").checked,
      threshold: Number($("#aiThreshold").value) / 100,
      batchSize: Number($("#aiBatchSize").value),
      ...(apiKey ? { apiKey } : {}),
    },
    feishu: {
      enabled: $("#feishuEnabled").checked,
      ...(webhookUrl ? { webhookUrl } : {}),
      ...(secret ? { secret } : {}),
    },
    retention: {
      feedDays: Number($("#retentionFeedDays").value),
      evaluationDays: Number($("#retentionEvaluationDays").value),
      userDays: Number($("#retentionUserDays").value),
      maxFeeds: Number($("#retentionMaxFeeds").value),
      maxEvaluations: Number($("#retentionMaxEvaluations").value),
      cleanupIntervalHours: Number($("#retentionCleanupHours").value),
    },
  };
}

async function renderSearch({ sequence }) {
  const q = (state.routeParams.get("q") || "").trim();
  if (!q) {
    viewHost.innerHTML = `<section class="page"><section class="search-hero"><h1>搜索整个酷安工作台</h1><p>帖子、话题、用户和应用，一次搜索统一展示</p><form class="search-page-form" id="pageSearchForm"><i class="ph ph-magnifying-glass"></i><input id="pageSearchInput" type="search" autofocus placeholder="输入搜索关键词" /><button type="submit">开始搜索</button></form></section>${emptyState("magnifying-glass", "输入关键词开始", "例如：鸿蒙、Bug 价、哔哩哔哩或用户昵称。")}</section>`;
    return;
  }
  const payload = await api(`/api/search/all?q=${encodeURIComponent(q)}&page=1`);
  if (sequence !== state.requestSequence) return;
  viewHost.innerHTML = `<section class="page">
    <section class="search-hero"><h1>搜索结果</h1><p>正在展示与“${escapeHtml(q)}”相关的公开内容</p><form class="search-page-form" id="pageSearchForm"><i class="ph ph-magnifying-glass"></i><input id="pageSearchInput" type="search" value="${escapeHtml(q)}" /><button type="submit">重新搜索</button></form></section>
    <div class="filter-tabs" id="searchTabs"><button class="active" type="button" data-search-tab="all">全部</button><button type="button" data-search-tab="feeds">帖子 ${payload.feeds?.length || 0}</button><button type="button" data-search-tab="topics">话题 ${payload.topics?.length || 0}</button><button type="button" data-search-tab="users">用户 ${payload.users?.length || 0}</button><button type="button" data-search-tab="apps">应用 ${payload.apps?.length || 0}</button></div>
    <div id="searchResultsRegion" data-search-payload></div>
  </section>`;
  viewHost._searchPayload = payload;
  renderSearchTab("all");
}

function renderSearchTab(tab) {
  const payload = viewHost._searchPayload;
  const region = $("#searchResultsRegion");
  if (!payload || !region) return;
  $$("[data-search-tab]").forEach((button) => button.classList.toggle("active", button.dataset.searchTab === tab));
  const sections = [];
  if ((tab === "all" || tab === "topics") && payload.topics?.length) sections.push(`<section class="search-result-section surface"><header class="surface-head"><div><h2>话题</h2><p>${payload.topics.length} 个结果</p></div></header><div style="padding:16px">${topicGrid(payload.topics)}</div></section>`);
  if ((tab === "all" || tab === "users") && payload.users?.length) sections.push(`<section class="search-result-section surface"><header class="surface-head"><div><h2>用户</h2><p>${payload.users.length} 个结果</p></div></header><div style="padding:16px">${userCards(payload.users)}</div></section>`);
  if ((tab === "all" || tab === "apps") && payload.apps?.length) sections.push(`<section class="search-result-section surface"><header class="surface-head"><div><h2>应用</h2><p>${payload.apps.length} 个结果</p></div></header><div style="padding:16px">${appGrid(payload.apps)}</div></section>`);
  if ((tab === "all" || tab === "feeds") && payload.feeds?.length) sections.push(`<section class="search-result-section"><div class="surface-head surface"><div><h2>帖子</h2><p>${payload.feeds.length} 个结果</p></div></div>${feedStream(payload.feeds)}</section>`);
  region.innerHTML = sections.join("") || emptyState("magnifying-glass-minus", "没有找到匹配内容", "换一个更短或更通用的关键词再试一次。");
}

async function openFeed(id) {
  if (!id) return;
  state.activeFeedId = String(id);
  state.feedReplyPage = 1;
  feedDialogBody.innerHTML = `<div class="dialog-loading"><i class="ph ph-circle-notch"></i><span>正在读取动态与评论…</span></div>`;
  showDialog(feedDialog);
  try {
    const payload = await api(`/api/feeds/${encodeURIComponent(id)}?page=1`);
    if (state.activeFeedId !== String(id)) return;
    renderFeedDetail(payload);
  } catch (error) {
    feedDialogBody.innerHTML = emptyState("warning-circle", "详情加载失败", error.message, `<button class="btn primary" type="button" data-feed="${escapeHtml(id)}">重新加载</button>`);
  }
}

function commentMarkup(reply) {
  return `<article class="comment" data-reply-card="${escapeHtml(reply.id)}">${avatarMarkup(reply.avatar, reply.username, "avatar")}<div class="comment-main"><header class="comment-head"><button type="button" data-user="${escapeHtml(reply.userId || "")}">${escapeHtml(reply.username || "酷友")}</button>${reply.isAuthor ? `<span class="author-label">作者</span>` : ""}<small>${relativeTime(reply.createdAt)}</small></header><p>${reply.replyTo ? `<span style="color:var(--green)">@${escapeHtml(reply.replyTo)}</span> ` : ""}${escapeHtml(stripHtml(reply.message || ""))}</p>${reply.picture ? `<button type="button" data-image="${escapeHtml(reply.picture)}" aria-label="放大评论图片"><img src="${escapeHtml(imageUrl(reply.picture))}" alt="评论图片" style="max-height:180px;border-radius:9px" /></button>` : ""}<footer><button class="${reply.liked ? "active" : ""}" type="button" data-reply-like="${escapeHtml(reply.id)}" data-liked="${reply.liked ? "1" : "0"}" aria-label="${reply.liked ? "取消点赞评论" : "点赞评论"}，当前 ${compactNumber(reply.likes)} 个赞"><i class="ph${reply.liked ? "-fill" : ""} ph-thumbs-up"></i> <span data-interaction-count data-count="${Number(reply.likes || 0)}">${compactNumber(reply.likes)}</span></button><button type="button" data-compose="reply" data-compose-id="${escapeHtml(reply.id)}" data-compose-title="回复 ${escapeHtml(reply.username || "酷友")}"><i class="ph ph-chat-circle"></i> 回复</button></footer>${reply.replies?.length ? `<div class="nested-replies">${reply.replies.slice(0, 5).map((child) => `<p><button type="button" data-user="${escapeHtml(child.userId || "")}">${escapeHtml(child.username || "酷友")}</button><span>：${escapeHtml(stripHtml(child.message))}</span><button type="button" data-compose="reply" data-compose-id="${escapeHtml(child.id)}" data-compose-title="回复 ${escapeHtml(child.username || "酷友")}" aria-label="回复 ${escapeHtml(child.username || "酷友")}"><i class="ph ph-arrow-bend-up-left"></i></button></p>`).join("")}</div>` : ""}</div></article>`;
}

function renderFeedDetail(payload) {
  const feed = payload.feed;
  const title = displayFeedTitle(feed);
  const webUrl = feed.url || `https://www.coolapk.com/feed/${feed.id}`;
  $("#feedDialogSubtitle").textContent = feed.topic || `${feed.comments || payload.replies?.length || 0} 条评论`;
  feedDialogBody.innerHTML = `<article class="detail-feed"><header class="feed-author">${avatarMarkup(feed.avatar, feed.username)}<div class="feed-author-info"><button type="button" data-user="${escapeHtml(feed.userId || "")}">${escapeHtml(feed.username)}</button><small>${formatDate(feed.createdAt)}${feed.device ? ` · ${escapeHtml(feed.device)}` : ""}</small></div>${feed.topic ? `<button class="feed-topic" type="button" data-public-topic="${escapeHtml(feed.topic)}"><i class="ph ph-hash"></i>${escapeHtml(feed.topic)}</button>` : ""}</header><h2 class="feed-title">${escapeHtml(title)}</h2><p class="feed-text">${escapeHtml(stripHtml(feed.message || ""))}</p>${feedImageMarkup(feed)}<footer class="feed-meta detail-feed-actions" style="margin:18px -13px -24px"><button class="${feed.liked ? "active" : ""}" type="button" data-feed-like="${escapeHtml(feed.id)}" data-liked="${feed.liked ? "1" : "0"}" aria-label="${feed.liked ? "取消点赞" : "点赞"}，当前 ${compactNumber(feed.likes)} 个赞"><i class="ph${feed.liked ? "-fill" : ""} ph-thumbs-up"></i><span data-interaction-count data-count="${Number(feed.likes || 0)}">${compactNumber(feed.likes)}</span></button><button type="button" data-compose="feed-reply" data-compose-id="${escapeHtml(feed.id)}" data-compose-title="回复动态" aria-label="回复动态，当前 ${compactNumber(feed.replyCount || feed.comments)} 条评论"><i class="ph ph-chat-circle"></i>${compactNumber(feed.replyCount || feed.comments)}</button><button type="button" data-share-feed="${escapeHtml(feed.id)}" data-share-url="${escapeHtml(webUrl)}" data-share-title="${escapeHtml(title)}"><i class="ph ph-share-network"></i>分享</button><a href="coolmarket://feed/${escapeHtml(feed.id)}" class="open-feed" aria-label="在酷安 App 打开"><i class="ph ph-device-mobile"></i>App</a></footer></article><nav class="detail-subnav" aria-label="动态相关信息"><button type="button" data-feed-aux="${escapeHtml(feed.id)}" data-aux-type="likes"><i class="ph ph-users"></i>点赞用户</button><button type="button" data-feed-aux="${escapeHtml(feed.id)}" data-aux-type="forwards"><i class="ph ph-share-fat"></i>转发记录</button><button type="button" data-feed-aux="${escapeHtml(feed.id)}" data-aux-type="history"><i class="ph ph-clock-counter-clockwise"></i>编辑历史</button><a href="${escapeHtml(webUrl)}" target="_blank" rel="noreferrer"><i class="ph ph-browser"></i>网页版</a></nav><section class="comments-section"><header class="comments-head"><h3>全部评论</h3><span>第 <b id="replyPageNumber">1</b> 页</span></header>${state.account?.configured ? `<button class="quick-reply" type="button" data-compose="feed-reply" data-compose-id="${escapeHtml(feed.id)}" data-compose-title="回复动态"><i class="ph ph-pencil-simple-line"></i>写下你的回复</button>` : ""}<div class="comment-list" id="commentList">${payload.replies?.length ? payload.replies.map(commentMarkup).join("") : emptyState("chat-circle", "还没有评论", "该动态暂时没有返回公开评论。")}</div><div class="load-more"><button class="btn secondary" id="loadMoreReplies" type="button" data-load-replies ${payload.replies?.length ? "" : "disabled"}><i class="ph ph-chat-circle-dots"></i>加载更多评论</button></div></section>`;
}

async function loadMoreReplies() {
  const button = $("#loadMoreReplies");
  if (!button || !state.activeFeedId) return;
  button.disabled = true;
  button.textContent = "正在加载…";
  try {
    const page = state.feedReplyPage + 1;
    const payload = await api(`/api/feeds/${state.activeFeedId}/replies?page=${page}`);
    if (payload.replies?.length) {
      const existing = new Set($$("[data-reply-card]", $("#commentList")).map((item) => item.dataset.replyCard));
      const freshReplies = payload.replies.filter((reply) => !existing.has(String(reply.id)));
      if (freshReplies.length) $("#commentList").insertAdjacentHTML("beforeend", freshReplies.map(commentMarkup).join(""));
      state.feedReplyPage = page;
      $("#replyPageNumber").textContent = page;
      button.disabled = false;
      button.innerHTML = `<i class="ph ph-chat-circle-dots"></i>${freshReplies.length ? "加载更多评论" : "继续加载下一页"}`;
    } else {
      button.textContent = "没有更多评论";
    }
  } catch (error) {
    toast(error.message, "error");
    button.disabled = false;
    button.textContent = "重新加载";
  }
}

async function openApp(id) {
  if (!id) return;
  appDialogBody.innerHTML = `<div class="dialog-loading"><i class="ph ph-circle-notch"></i><span>正在读取应用详情…</span></div>`;
  showDialog(appDialog);
  try {
    const payload = await api(`/api/apps/${encodeURIComponent(id)}`);
    const app = payload.app;
    const webUrl = `https://www.coolapk.com/apk/${encodeURIComponent(app.packageName || app.id)}`;
    const appUrl = `coolmarket://apk/${encodeURIComponent(app.packageName || app.id)}`;
    appDialogBody.innerHTML = `<section class="app-detail-hero">${app.logo ? `<img src="${escapeHtml(imageUrl(app.logo))}" alt="${escapeHtml(app.title)}" />` : `<span class="app-logo-placeholder"><i class="ph ph-app-window"></i></span>`}<div><h2>${escapeHtml(app.title)}</h2><p>${escapeHtml(app.subtitle || app.packageName)}</p><div class="app-detail-stats"><span><strong>${Number(app.score || 0).toFixed(1)}</strong><small>酷友评分</small></span><span><strong>${escapeHtml(app.version || "—")}</strong><small>最新版本</small></span><span><strong>${escapeHtml(app.size || "—")}</strong><small>安装包</small></span><span><strong>${compactNumber(app.downloads)}</strong><small>下载</small></span></div><div class="detail-actions"><a class="btn primary" href="${escapeHtml(appUrl)}"><i class="ph ph-device-mobile"></i>酷安 App 打开</a><a class="btn secondary" href="${escapeHtml(webUrl)}" target="_blank" rel="noreferrer"><i class="ph ph-browser"></i>网页版</a></div></div></section>${app.packageName ? `<section class="detail-facts"><span><b>包名</b>${escapeHtml(app.packageName)}</span><span><b>开发者</b>${escapeHtml(app.developer || "—")}</span><span><b>分类</b>${escapeHtml(app.category || "—")}</span><span><b>更新时间</b>${escapeHtml(app.updatedAt ? formatDate(app.updatedAt) : "—")}</span></section>` : ""}${app.description ? `<section class="detail-section"><h3>应用介绍</h3><p>${escapeHtml(stripHtml(app.description))}</p></section>` : ""}${app.changelog ? `<section class="detail-section"><h3>更新说明</h3><p>${escapeHtml(stripHtml(app.changelog))}</p></section>` : ""}${app.screenshots?.length ? `<section class="detail-section"><h3>应用截图</h3><div class="screenshots">${app.screenshots.map((picture, index) => `<button type="button" data-image="${escapeHtml(picture)}" data-caption="${escapeHtml(app.title)}" aria-label="放大应用截图 ${index + 1}"><img src="${escapeHtml(imageUrl(picture))}" alt="应用截图 ${index + 1}" loading="lazy" /></button>`).join("")}</div></section>` : ""}<section class="detail-section"><h3>相关动态</h3>${feedStream(payload.feeds, { compact: true })}</section>`;
  } catch (error) {
    appDialogBody.innerHTML = emptyState("warning-circle", "应用详情加载失败", error.message);
  }
}

async function openTopic(tag) {
  if (!tag) return;
  topicDialogBody.innerHTML = `<div class="dialog-loading"><i class="ph ph-circle-notch"></i><span>正在读取话题详情…</span></div>`;
  showDialog(topicDialog);
  try {
    const payload = await api(`/api/web/topics/${encodeURIComponent(tag)}?page=1`);
    const topic = payload.topic;
    const monitored = state.topics.some((item) => item.sourceKey === topic.sourceKey || item.tag === topic.tag);
    topicDialogBody.innerHTML = `<section class="topic-detail-hero">${topic.logo ? `<img src="${escapeHtml(imageUrl(topic.logo))}" alt="" />` : `<span><i class="ph ph-hash"></i></span>`}<h2>${escapeHtml(topic.title || topic.tag)}</h2><p>${escapeHtml(stripHtml(topic.description || topic.intro || "公开话题"))}</p><div class="profile-stats"><span><strong>${compactNumber(topic.followers)}</strong><small>关注</small></span><span><strong>${compactNumber(topic.posts)}</strong><small>动态</small></span><span><strong>${compactNumber(topic.hot)}</strong><small>热度</small></span></div><div class="detail-actions"><button class="btn ${topic.followed ? "secondary active" : "primary"}" type="button" data-topic-follow="${escapeHtml(topic.tag)}" data-followed="${topic.followed ? "1" : "0"}"><i class="ph ph-${topic.followed ? "check" : "plus"}"></i>${topic.followed ? "已关注" : "关注话题"}</button><button class="btn secondary" type="button" data-monitor-add="${escapeHtml(topic.sourceKey || topic.tag)}" ${monitored ? "disabled" : ""}><i class="ph ph-radar"></i>${monitored ? "已加入监控" : "加入监控"}</button></div></section><section class="detail-section"><h3>最新动态</h3>${feedStream(payload.feeds, { compact: true })}</section>`;
  } catch (error) {
    topicDialogBody.innerHTML = emptyState("warning-circle", "话题详情加载失败", error.message);
  }
}

async function openUser(uid) {
  if (!uid) {
    toast("该动态没有提供可用的用户 UID", "error");
    return;
  }
  userDialogBody.innerHTML = `<div class="dialog-loading"><i class="ph ph-circle-notch"></i><span>正在读取用户公开主页…</span></div>`;
  showDialog(userDialog);
  try {
    const [payload, remoteFeeds] = await Promise.all([
      api(`/api/users/${encodeURIComponent(uid)}`),
      api(`/api/users/${encodeURIComponent(uid)}/feeds?branch=feed&page=1`).catch(() => ({ feeds: [] })),
    ]);
    const profile = payload.profile;
    const feeds = remoteFeeds.feeds?.length ? remoteFeeds.feeds : payload.localFeeds || [];
    const ownProfile = String(profile.uid) === String(state.account?.uid);
    const tabs = [["feed", "动态"], ["htmlFeed", "文章"], ["questionAndAnswer", "问答"], ["collections", "收藏"], ["followList", "关注"], ["fansList", "粉丝"]];
    userDialogBody.innerHTML = `<section class="user-detail-hero">${profile.avatar ? `<img src="${escapeHtml(imageUrl(profile.avatar))}" alt="${escapeHtml(profile.username)}" />` : `<span><i class="ph ph-user"></i></span>`}<h2>${escapeHtml(profile.username)}</h2><p>${escapeHtml(profile.bio || profile.verifyLabel || `UID ${profile.uid}`)}</p><div class="profile-stats"><span><strong>${compactNumber(profile.followers)}</strong><small>粉丝</small></span><span><strong>${compactNumber(profile.following)}</strong><small>关注</small></span><span><strong>${compactNumber(profile.feeds)}</strong><small>动态</small></span><span><strong>${compactNumber(profile.likes)}</strong><small>获赞</small></span></div>${!ownProfile ? `<button class="btn ${profile.followed ? "secondary active" : "primary"}" style="margin-top:16px" type="button" data-user-follow="${escapeHtml(profile.uid)}" data-followed="${profile.followed ? "1" : "0"}"><i class="ph ph-${profile.followed ? "check" : "user-plus"}"></i>${profile.followed ? "已关注" : "关注"}</button>` : ""}</section><nav class="detail-tabs" aria-label="用户主页内容">${tabs.map(([key, label], index) => `<button class="${index === 0 ? "active" : ""}" type="button" data-user-section="${key}" data-user-section-uid="${escapeHtml(profile.uid)}">${label}</button>`).join("")}</nav><section class="detail-section" id="userSectionRegion"><h3>${remoteFeeds.feeds?.length ? "最新动态" : "本站已归档动态"}</h3>${feedStream(feeds, { compact: true })}</section>`;
  } catch (error) {
    userDialogBody.innerHTML = emptyState("warning-circle", "用户主页加载失败", error.message);
  }
}

async function loadUserSection(button) {
  const uid = button.dataset.userSectionUid;
  const section = button.dataset.userSection;
  const region = $("#userSectionRegion");
  if (!uid || !section || !region) return;
  $$("[data-user-section]", userDialogBody).forEach((item) => item.classList.toggle("active", item === button));
  region.innerHTML = skeletonFeeds(2);
  button.disabled = true;
  try {
    let payload;
    let content;
    if (section === "collections") {
      payload = await api(`/api/users/${encodeURIComponent(uid)}/collections?page=1`);
      content = collectionCards(payload.collections || []);
    } else if (section === "followList" || section === "fansList") {
      payload = await api(`/api/users/${encodeURIComponent(uid)}/connections?type=${section}&page=1`);
      content = userCards(payload.users || []);
    } else {
      payload = await api(`/api/users/${encodeURIComponent(uid)}/feeds?branch=${section}&page=1`);
      content = feedStream(payload.feeds || [], { compact: true });
    }
    const labels = { feed: "动态", htmlFeed: "文章", questionAndAnswer: "问答", collections: "收藏", followList: "关注", fansList: "粉丝" };
    region.innerHTML = `<h3>${labels[section] || "公开内容"}</h3>${content}`;
  } catch (error) {
    region.innerHTML = emptyState("warning-circle", "内容加载失败", error.message);
  } finally {
    button.disabled = false;
  }
}

async function openCollection(id) {
  if (!id) return;
  collectionDialogBody.innerHTML = `<div class="dialog-loading"><i class="ph ph-circle-notch"></i><span>正在读取收藏单…</span></div>`;
  showDialog(collectionDialog);
  try {
    const payload = await api(`/api/collections/${encodeURIComponent(id)}?page=1`);
    const item = payload.collection;
    collectionDialogBody.innerHTML = `<section class="collection-detail-hero">${item.cover ? `<img src="${escapeHtml(imageUrl(item.cover))}" alt="" />` : `<span><i class="ph ph-bookmarks"></i></span>`}<div><small>酷安收藏单</small><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(stripHtml(item.description || item.subtitle || ""))}</p><div class="detail-actions"><button class="btn ${item.followed ? "secondary active" : "primary"}" type="button" data-collection-action="${escapeHtml(item.id)}" data-action="follow" data-enabled="${item.followed ? "1" : "0"}"><i class="ph ph-user-plus"></i>${item.followed ? "已关注" : "关注收藏单"}</button><button class="btn secondary ${item.liked ? "active" : ""}" type="button" data-collection-action="${escapeHtml(item.id)}" data-action="like" data-enabled="${item.liked ? "1" : "0"}"><i class="ph ph-thumbs-up"></i>${item.liked ? "已赞" : "点赞"}</button></div></div></section>${payload.feeds?.length ? `<section class="detail-section"><h3>收藏动态</h3>${feedStream(payload.feeds, { compact: true })}</section>` : ""}${payload.apps?.length ? `<section class="detail-section"><h3>收藏应用</h3>${appGrid(payload.apps)}</section>` : ""}`;
  } catch (error) {
    collectionDialogBody.innerHTML = emptyState("warning-circle", "收藏单加载失败", error.message);
  }
}

function openComposer(type = "feed", id = "", title = "") {
  if (!state.account?.configured) {
    return routeToAccount("连接酷安账号后即可发布和回复");
  }
  clearTimeout(composeDraftTimer);
  state.compose.previewUrls?.forEach((url) => URL.revokeObjectURL(url));
  const draftKey = `coolweb:draft:${state.account.uid}:${type}:${String(id || "new")}`;
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(draftKey) || "null"); } catch { draft = null; }
  state.compose = { type, id: String(id || ""), title: String(title || ""), files: [], previewUrls: [], draftKey };
  const isFeed = type === "feed";
  $("#composeTitle").textContent = isFeed ? "发布动态" : title || "回复动态";
  $("#composeSubtitle").textContent = isFeed ? "分享到酷安社区" : "回复将直接发布到当前会话";
  $("#composeMessage").value = typeof draft?.message === "string" ? draft.message : "";
  $("#composeImages").value = "";
  $("#composeMediaPreview").innerHTML = "";
  $("#composeCount").textContent = String($("#composeMessage").value.length);
  $("#composeDraftStatus").textContent = draft?.message ? "已恢复上次未发布的草稿" : "内容会自动保存为本地草稿";
  $("#composeStatus").textContent = isFeed ? "支持 #话题# 与 @酷友" : "请输入回复内容";
  showDialog(composeDialog);
  setTimeout(() => $("#composeMessage").focus(), 80);
}

function fileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`读取图片失败：${file.name}`));
    reader.readAsDataURL(file);
  });
}

function renderComposeMedia() {
  $("#composeMediaPreview").innerHTML = state.compose.files.map((file, index) => `<div><img src="${escapeHtml(state.compose.previewUrls[index])}" alt="${escapeHtml(file.name)}" /><button type="button" data-remove-compose-image="${index}" aria-label="移除图片"><i class="ph ph-x"></i></button></div>`).join("");
  $("#composeDropZone").classList.toggle("has-media", state.compose.files.length > 0);
}

function saveComposeDraft(draftKey = state.compose.draftKey, message = $("#composeMessage").value) {
  if (!draftKey) return;
  if (message.trim()) {
    localStorage.setItem(draftKey, JSON.stringify({ message, savedAt: new Date().toISOString() }));
    if (state.compose.draftKey === draftKey) $("#composeDraftStatus").textContent = "草稿已自动保存";
  } else {
    localStorage.removeItem(draftKey);
    if (state.compose.draftKey === draftKey) $("#composeDraftStatus").textContent = "内容会自动保存为本地草稿";
  }
}

function addComposeFiles(fileList) {
  const incoming = [...(fileList || [])];
  const candidates = incoming.filter((file) => /^image\/(?:png|jpe?g|webp|gif)$/i.test(file.type) && file.size <= 10 * 1024 * 1024);
  const files = [...state.compose.files, ...candidates].slice(0, 9);
  state.compose.previewUrls?.forEach((url) => URL.revokeObjectURL(url));
  state.compose.files = files;
  state.compose.previewUrls = files.map((file) => URL.createObjectURL(file));
  renderComposeMedia();
  if (candidates.length !== incoming.length) toast("已跳过格式不支持或超过 10MB 的图片", "error");
  if (state.compose.files.length >= 9 && candidates.length) $("#composeStatus").textContent = "已达到 9 张图片上限";
}

function insertComposeToken(type) {
  const textarea = $("#composeMessage");
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const token = type === "mention" ? "@酷友 " : "#话题# ";
  textarea.setRangeText(token, start, end, "end");
  if (type === "mention") textarea.setSelectionRange(start + 1, start + 3);
  else textarea.setSelectionRange(start + 1, start + 3);
  textarea.focus();
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

async function submitComposer(event) {
  event.preventDefault();
  const message = $("#composeMessage").value.trim();
  if (!message) {
    $("#composeStatus").textContent = "请输入内容";
    return;
  }
  clearTimeout(composeDraftTimer);
  saveComposeDraft(state.compose.draftKey, $("#composeMessage").value);
  const button = $("#submitCompose");
  button.disabled = true;
  button.innerHTML = `<i class="ph ph-circle-notch"></i>正在发送`;
  try {
    const context = state.compose;
    const pictures = [];
    for (let index = 0; index < context.files.length; index += 1) {
      $("#composeStatus").textContent = `正在上传图片 ${index + 1}/${context.files.length}…`;
      const upload = await api("/api/account/upload-image", {
        method: "POST",
        body: JSON.stringify({ filename: context.files[index].name, dataUrl: await fileDataUrl(context.files[index]) }),
      });
      pictures.push(upload.url);
    }
    $("#composeStatus").textContent = context.type === "feed" ? "正在发布动态…" : "正在发布回复…";
    const path = context.type === "feed"
      ? "/api/feeds"
      : context.type === "reply"
        ? `/api/replies/${encodeURIComponent(context.id)}/replies`
        : `/api/feeds/${encodeURIComponent(context.id)}/replies`;
    await api(path, { method: "POST", body: JSON.stringify({ message, pictures }) });
    clearTimeout(composeDraftTimer);
    if (context.draftKey) localStorage.removeItem(context.draftKey);
    toast(context.type === "feed" ? "动态发布成功" : "回复发布成功", "success");
    closeDialog(composeDialog);
    if (context.type !== "feed" && state.activeFeedId) await openFeed(state.activeFeedId);
    else if (state.route === "account") await route({ force: true });
  } catch (error) {
    $("#composeStatus").textContent = error.message;
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.innerHTML = `<i class="ph ph-paper-plane-tilt"></i>发布`;
  }
}

async function toggleInteraction(button, path, property, next) {
  if (!state.account?.configured) {
    return routeToAccount("连接酷安账号后即可进行互动");
  }
  button.disabled = true;
  try {
    const payload = await api(path, { method: "POST", body: JSON.stringify({ [property]: next }) });
    button.dataset[property] = payload[property] ? "1" : "0";
    button.classList.toggle("active", Boolean(payload[property]));
    const icon = $("i", button);
    if (icon) icon.className = `ph${payload[property] ? "-fill" : ""} ph-${property === "followed" ? "check" : "thumbs-up"}`;
    if (property === "followed") {
      button.innerHTML = `<i class="ph ph-${payload.followed ? "check" : "user-plus"}"></i>${payload.followed ? "已关注" : "关注"}`;
    } else {
      const count = $("[data-interaction-count]", button);
      if (count) {
        const current = Number(count.dataset.count || 0);
        const nextCount = Math.max(0, current + (payload[property] ? 1 : -1));
        count.dataset.count = String(nextCount);
        count.textContent = compactNumber(nextCount);
      }
      button.setAttribute("aria-label", payload[property] ? "取消点赞" : "点赞");
    }
    toast(payload.message || "操作成功", "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function openFeedAux(id, type) {
  const labels = { likes: "点赞用户", forwards: "转发记录", history: "编辑历史" };
  feedDialogBody.innerHTML = `<div class="dialog-loading"><i class="ph ph-circle-notch"></i><span>正在读取${labels[type] || "相关信息"}…</span></div>`;
  try {
    const payload = await api(`/api/feeds/${encodeURIComponent(id)}/${type}?page=1`);
    const content = payload.users?.length ? userCards(payload.users) : payload.feeds?.length ? feedStream(payload.feeds, { compact: true }) : payload.items?.length ? `<div class="history-list">${payload.items.map((item) => `<article><small>${formatDate(item.createdAt)}</small><p>${escapeHtml(stripHtml(item.message))}</p></article>`).join("")}</div>` : emptyState("tray", "暂无记录", "当前没有返回相关数据。");
    feedDialogBody.innerHTML = `<button class="detail-back" type="button" data-feed="${escapeHtml(id)}"><i class="ph ph-arrow-left"></i>返回动态详情</button><section class="detail-section"><h3>${labels[type]}</h3>${content}</section>`;
  } catch (error) {
    const accountAction = error.message.includes("账号") || error.message.includes("登录") || error.message.includes("会话")
      ? `<button class="btn primary" type="button" data-account-required>连接账号</button>`
      : "";
    feedDialogBody.innerHTML = `${emptyState("warning-circle", `${labels[type] || "相关信息"}加载失败`, error.message, accountAction)}<button class="btn secondary detail-back" type="button" data-feed="${escapeHtml(id)}"><i class="ph ph-arrow-left"></i>返回动态详情</button>`;
  }
}

async function shareFeed(button) {
  const url = button.dataset.shareUrl || `https://www.coolapk.com/feed/${button.dataset.shareFeed}`;
  const title = button.dataset.shareTitle || "酷安动态";
  try {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ title, url });
      return;
    }
    const value = `${title}\n${url}`;
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) throw new Error("copy failed");
    }
    toast("动态标题和链接已复制", "success");
  } catch (error) {
    if (error?.name !== "AbortError") toast("复制失败，请从动态详情打开网页版", "error");
  }
}

async function addMonitor(sourceKey, button) {
  if (!sourceKey) return;
  if (button) button.disabled = true;
  try {
    const payload = await api("/api/topics", { method: "POST", body: JSON.stringify({ tag: sourceKey }) });
    state.topics.unshift(payload.topic);
    updateChrome();
    toast(`已添加监控：${payload.topic.detail?.title || payload.topic.tag}`, "success");
    if (button) button.textContent = "已监控";
    if (state.route === "monitor") await route({ force: true });
  } catch (error) {
    toast(error.message, "error");
    if (button) button.disabled = false;
  }
}

function openRule(tag) {
  const topic = state.topics.find((item) => item.tag === tag);
  if (!topic) return;
  state.activeRuleTopic = tag;
  const ai = topic.ai || {};
  const mode = ai.mode === "keyword" ? "keyword" : "ai";
  $("#ruleDialogSubtitle").textContent = topic.detail?.title || topic.tag;
  $(`input[name="ruleMode"][value="${mode}"]`, ruleDialog).checked = true;
  $("#ruleKeywords").value = (ai.keywords || []).join("\n");
  $("#ruleIntent").value = ai.intent || "";
  $("#ruleExclude").value = ai.exclude || "";
  $("#ruleThreshold").value = ai.threshold == null ? "" : Math.round(Number(ai.threshold) * 100);
  $("#ruleSort").value = topic.fetch?.sort || "dateline_desc";
  $("#ruleLimit").value = topic.fetch?.limit || 20;
  $("#ruleNotify").checked = ai.notify !== false;
  $("#ruleStatus").textContent = "";
  syncRuleMode();
  showDialog(ruleDialog);
}

function syncRuleMode() {
  const mode = $('input[name="ruleMode"]:checked', ruleDialog)?.value || "ai";
  $("#keywordFields").hidden = mode !== "keyword";
  $("#aiFields").hidden = mode !== "ai";
}

async function saveRule(event) {
  event.preventDefault();
  const topic = state.topics.find((item) => item.tag === state.activeRuleTopic);
  if (!topic) return;
  const mode = $('input[name="ruleMode"]:checked', ruleDialog)?.value || "ai";
  const status = $("#ruleStatus");
  const button = $('button[type="submit"]', event.currentTarget);
  status.textContent = "正在保存…";
  button.disabled = true;
  try {
    const payload = {
      ai: {
        mode,
        keywords: $("#ruleKeywords").value,
        intent: $("#ruleIntent").value,
        exclude: $("#ruleExclude").value,
        threshold: $("#ruleThreshold").value ? Number($("#ruleThreshold").value) / 100 : null,
        notify: $("#ruleNotify").checked,
      },
      fetch: { sort: $("#ruleSort").value, limit: Number($("#ruleLimit").value) },
    };
    const response = await api(`/api/topics/${encodeURIComponent(topic.tag)}`, { method: "PATCH", body: JSON.stringify(payload) });
    const index = state.topics.findIndex((item) => item.tag === topic.tag);
    state.topics[index] = response.topic;
    status.textContent = "已保存";
    toast("监控规则已保存", "success");
    setTimeout(() => closeDialog(ruleDialog), 450);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function analyzeRule() {
  if (!state.activeRuleTopic) return;
  const button = $("#analyzeRule");
  button.disabled = true;
  button.innerHTML = `<i class="ph ph-circle-notch"></i>分析中`;
  try {
    const payload = await api(`/api/topics/${encodeURIComponent(state.activeRuleTopic)}/analyze`, { method: "POST", body: JSON.stringify({ force: true, notify: false }) });
    toast(`已完成 ${payload.count} 条内容判断`, "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.innerHTML = `<i class="ph ph-play"></i>立即分析`;
  }
}

async function removeTopic(tag) {
  const topic = state.topics.find((item) => item.tag === tag);
  if (!topic || !confirm(`停止监控“${topic.detail?.title || topic.tag}”？已归档数据仍会保留。`)) return;
  try {
    await api(`/api/topics/${encodeURIComponent(tag)}`, { method: "DELETE" });
    state.topics = state.topics.filter((item) => item.tag !== tag);
    state.monitor.topic = "__all__";
    updateChrome();
    toast("已停止监控，历史归档已保留", "success");
    await route({ force: true });
  } catch (error) {
    toast(error.message, "error");
  }
}

function openLightbox(url, caption = "查看图片") {
  const src = imageUrl(url);
  if (!src) return;
  state.lightbox = { zoom: 1, x: 0, y: 0, dragging: false, startX: 0, startY: 0 };
  lightboxImage.src = src;
  $("#lightboxCaption").textContent = caption;
  updateLightbox();
  showDialog(lightbox);
}

function updateLightbox() {
  const item = state.lightbox;
  lightboxImage.style.transform = `translate(${item.x}px, ${item.y}px) scale(${item.zoom})`;
  $("#zoomReset").textContent = `${Math.round(item.zoom * 100)}%`;
}

function setZoom(value) {
  state.lightbox.zoom = Math.max(.25, Math.min(5, value));
  if (state.lightbox.zoom === 1) {
    state.lightbox.x = 0;
    state.lightbox.y = 0;
  }
  updateLightbox();
}

function handleSmartLink(value) {
  const link = String(value || "");
  if (link.startsWith("channel:")) return loadHomeChannel(link.slice(8));
  if (link.startsWith("#/")) {
    location.hash = link;
    return;
  }
  const topic = link.match(/^\/t\/(.+)/);
  if (topic) return openTopic(decodeURIComponent(topic[1].split("?")[0]));
  const feed = link.match(/^\/feed\/(\d+)/);
  if (feed) return openFeed(feed[1]);
  const app = link.match(/^\/(?:apk|game)\/(.+)/);
  if (app) {
    toast("正在通过应用列表匹配该应用，可使用全局搜索继续查找");
    location.hash = `#/search?q=${encodeURIComponent(app[1])}`;
    return;
  }
  const pageKey = new URLSearchParams(link.split("?")[1] || "").get("url");
  if (pageKey && PAGE_CHANNELS[pageKey]) {
    const channel = PAGE_CHANNELS[pageKey];
    if (channel === "topics" || channel === "apps") location.hash = `#/${channel}`;
    else if (state.route === "home") loadHomeChannel(channel);
    else location.hash = `#/home?channel=${encodeURIComponent(channel)}`;
  }
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button, a");
  if (!target) return;
  if (target.matches("[data-close]")) closeDialog($(`#${target.dataset.close}`));
  if (target.matches("[data-retry], [data-route-refresh]")) route({ force: true });
  if (target.matches("[data-home-channel]")) loadHomeChannel(target.dataset.homeChannel);
  if (target.matches("[data-hero-index]")) target.closest("#heroCarousel")?._showSlide?.(Number(target.dataset.heroIndex));
  if (target.matches("[data-smart-link]")) handleSmartLink(target.dataset.smartLink);
  if (target.matches("[data-feed]")) openFeed(target.dataset.feed);
  if (target.matches("[data-app]")) openApp(target.dataset.app);
  if (target.matches("[data-public-topic]")) openTopic(target.dataset.publicTopic);
  if (target.matches("[data-user]")) openUser(target.dataset.user);
  if (target.matches("[data-user-section]")) loadUserSection(target);
  if (target.matches("[data-collection]")) openCollection(target.dataset.collection);
  if (target.matches("[data-image]")) openLightbox(target.dataset.image, target.dataset.caption);
  if (target.matches("[data-share-feed]")) shareFeed(target);
  if (target.matches("[data-account-required]")) routeToAccount();
  if (target.matches("[data-compose-insert]")) insertComposeToken(target.dataset.composeInsert);
  if (target.matches("[data-remove-compose-image]")) {
    const index = Number(target.dataset.removeComposeImage);
    URL.revokeObjectURL(state.compose.previewUrls[index]);
    state.compose.files.splice(index, 1);
    state.compose.previewUrls.splice(index, 1);
    renderComposeMedia();
  }
  if (target.matches("[data-compose]")) openComposer(target.dataset.compose, target.dataset.composeId, target.dataset.composeTitle);
  if (target.matches("[data-feed-like]")) {
    const next = target.dataset.liked !== "1";
    toggleInteraction(target, `/api/interactions/feeds/${encodeURIComponent(target.dataset.feedLike)}/like`, "liked", next);
  }
  if (target.matches("[data-reply-like]")) {
    const next = target.dataset.liked !== "1";
    toggleInteraction(target, `/api/interactions/replies/${encodeURIComponent(target.dataset.replyLike)}/like`, "liked", next);
  }
  if (target.matches("[data-user-follow]")) {
    const next = target.dataset.followed !== "1";
    toggleInteraction(target, `/api/interactions/users/${encodeURIComponent(target.dataset.userFollow)}/follow`, "followed", next);
  }
  if (target.matches("[data-topic-follow]")) {
    const next = target.dataset.followed !== "1";
    toggleInteraction(target, `/api/interactions/topics/${encodeURIComponent(target.dataset.topicFollow)}/follow`, "followed", next);
  }
  if (target.matches("[data-collection-action]")) {
    if (!state.account?.configured) return routeToAccount("连接酷安账号后即可管理收藏单");
    const enabled = target.dataset.enabled !== "1";
    target.disabled = true;
    try {
      const payload = await api(`/api/interactions/collections/${encodeURIComponent(target.dataset.collectionAction)}/${target.dataset.action}`, { method: "POST", body: JSON.stringify({ enabled }) });
      target.dataset.enabled = payload.enabled ? "1" : "0";
      target.classList.toggle("active", payload.enabled);
      target.innerHTML = target.dataset.action === "follow"
        ? `<i class="ph ph-${payload.enabled ? "check" : "user-plus"}"></i>${payload.enabled ? "已关注" : "关注收藏单"}`
        : `<i class="ph ph-thumbs-up"></i>${payload.enabled ? "已赞" : "点赞"}`;
      toast(payload.message || "操作成功", "success");
    } catch (error) {
      toast(error.message, "error");
    } finally { target.disabled = false; }
  }
  if (target.matches("[data-feed-aux]")) openFeedAux(target.dataset.feedAux, target.dataset.auxType);
  if (target.matches("[data-load-replies]")) loadMoreReplies();
  if (target.matches("[data-discover-mode]")) {
    state.discover.mode = target.dataset.discoverMode;
    location.hash = `#/discover?mode=${state.discover.mode}`;
  }
  if (target.matches("[data-discover-more]")) loadMoreDiscover();
  if (target.matches("[data-load-market]")) {
    const region = $("#appsRegion");
    region.innerHTML = skeletonFeeds(2);
    try { region.innerHTML = appGrid((await channelData("market")).apps); } catch (error) { region.innerHTML = `<div class="inline-error">${escapeHtml(error.message)}</div>`; }
  }
  if (target.matches("[data-search-tab]")) renderSearchTab(target.dataset.searchTab);
  if (target.matches("[data-toggle-add-monitor]")) {
    const panel = $("#addMonitorPanel");
    if (panel) panel.hidden = !panel.hidden;
  }
  if (target.matches("[data-monitor-add]")) addMonitor(target.dataset.monitorAdd, target);
  if (target.matches("[data-monitor-topic]")) {
    state.monitor.topic = target.dataset.monitorTopic;
    state.monitor.page = 1;
    location.hash = `#/monitor?topic=${encodeURIComponent(state.monitor.topic)}`;
  }
  if (target.matches("[data-monitor-page]") && !target.disabled) {
    state.monitor.page = Number(target.dataset.monitorPage);
    reloadMonitorRegion();
  }
  if (target.matches("[data-rule-topic]")) openRule(target.dataset.ruleTopic);
  if (target.matches("[data-remove-topic]")) removeTopic(target.dataset.removeTopic);
  if (target.matches("[data-monitor-refresh]")) {
    const original = target.innerHTML;
    target.disabled = true;
    target.innerHTML = `<i class="ph ph-circle-notch"></i>抓取中`;
    try {
      await api("/api/refresh", { method: "POST" });
      state.channelCache.clear();
      await loadBaseState();
      toast("全部监控源已完成抓取", "success");
      await route({ force: true });
    } catch (error) {
      toast(error.message, "error");
    } finally {
      if (target.isConnected) {
        target.disabled = false;
        target.innerHTML = original;
      }
    }
  }
  if (target.matches("[data-ai-status]")) {
    state.ai.status = target.dataset.aiStatus;
    state.ai.page = 1;
    route();
  }
  if (target.matches("[data-ai-page]") && !target.disabled) {
    state.ai.page = Number(target.dataset.aiPage);
    route();
  }
});

viewHost.addEventListener("submit", async (event) => {
  if (event.target.matches("#topicSearchForm")) {
    event.preventDefault();
    const keyword = $("#topicSearchInput").value.trim();
    if (keyword) searchTopicPage(keyword);
  }
  if (event.target.matches("#pageSearchForm")) {
    event.preventDefault();
    const keyword = $("#pageSearchInput").value.trim();
    if (keyword) location.hash = `#/search?q=${encodeURIComponent(keyword)}`;
  }
  if (event.target.matches("#monitorSearchForm")) {
    event.preventDefault();
    const keyword = $("#monitorSearchInput").value.trim();
    if (!keyword) return;
    const region = $("#monitorSearchResults");
    region.innerHTML = skeletonFeeds(1);
    try {
      const payload = await api(`/api/topics/search?q=${encodeURIComponent(keyword)}`);
      region.innerHTML = topicGrid(payload.results || []);
    } catch (error) {
      region.innerHTML = `<div class="inline-error">${escapeHtml(error.message)}</div>`;
    }
  }
  if (event.target.matches("#settingsForm")) {
    event.preventDefault();
    const status = $("#settingsSaveStatus");
    const button = $('button[type="submit"]', event.target);
    status.textContent = "正在保存…";
    button.disabled = true;
    try {
      state.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify(settingsPayload()) });
      status.textContent = "设置已保存";
      toast("系统设置已保存", "success");
      await loadBaseState();
    } catch (error) {
      status.textContent = error.message;
      toast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  }
  if (event.target.matches("#accountForm")) {
    event.preventDefault();
    const status = $("#accountConnectStatus");
    const button = $('button[type="submit"]', event.target);
    status.textContent = "正在校验会话…";
    button.disabled = true;
    try {
      const payload = await api("/api/account", {
        method: "PUT",
        body: JSON.stringify({
          uid: $("#coolapkUid").value.trim(),
          username: $("#coolapkUsername").value.trim(),
          token: $("#coolapkToken").value.trim(),
        }),
      });
      state.account = payload.account;
      toast(`已连接酷安账号：${payload.account.username}`, "success");
      await loadBaseState();
      await route({ force: true });
    } catch (error) {
      status.textContent = error.message;
      toast(error.message, "error");
    } finally { button.disabled = false; }
  }
});

let monitorFilterTimer = null;
viewHost.addEventListener("input", (event) => {
  if (event.target.matches("#monitorFilter")) {
    clearTimeout(monitorFilterTimer);
    monitorFilterTimer = setTimeout(() => {
      state.monitor.q = event.target.value.trim();
      state.monitor.page = 1;
      reloadMonitorRegion();
    }, 350);
  }
});

viewHost.addEventListener("change", (event) => {
  if (event.target.matches("#monitorAiFilter")) {
    state.monitor.ai = event.target.value;
    state.monitor.page = 1;
    reloadMonitorRegion();
  }
  if (event.target.matches("#monitorSort")) {
    state.monitor.sort = event.target.value;
    state.monitor.page = 1;
    reloadMonitorRegion();
  }
  if (event.target.matches("#monitorPageSize")) {
    state.monitor.pageSize = Number(event.target.value);
    state.monitor.page = 1;
    reloadMonitorRegion();
  }
  if (event.target.matches("#aiTopicFilter")) {
    state.ai.topic = event.target.value;
    state.ai.page = 1;
    route();
  }
});

viewHost.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.matches("#testAi")) {
    button.disabled = true;
    $("#aiTestStatus").textContent = "正在测试连接…";
    try {
      const payload = await api("/api/integrations/test-ai", { method: "POST", body: JSON.stringify(settingsPayload().ai) });
      $("#aiTestStatus").textContent = payload.message || "AI 连接成功";
      toast("AI 连接测试成功", "success");
    } catch (error) {
      $("#aiTestStatus").textContent = error.message;
      toast(error.message, "error");
    } finally { button.disabled = false; }
  }
  if (button.matches("#testFeishu")) {
    button.disabled = true;
    $("#feishuTestStatus").textContent = "正在发送测试消息…";
    try {
      const payload = await api("/api/integrations/test-feishu", { method: "POST" });
      $("#feishuTestStatus").textContent = payload.message || "测试消息已发送";
      toast("飞书测试消息已发送", "success");
    } catch (error) {
      $("#feishuTestStatus").textContent = error.message;
      toast(error.message, "error");
    } finally { button.disabled = false; }
  }
  if (button.matches("#runCleanup")) {
    button.disabled = true;
    $("#cleanupStatus").textContent = "正在清理过期数据…";
    try {
      await api("/api/maintenance/cleanup", { method: "POST" });
      $("#cleanupStatus").textContent = "清理完成";
      toast("归档清理完成", "success");
    } catch (error) {
      $("#cleanupStatus").textContent = error.message;
    } finally { button.disabled = false; }
  }
  if (button.matches("#testAccount")) {
    button.disabled = true;
    try {
      const payload = await api("/api/account/test", { method: "POST" });
      state.account = payload.account;
      updateChrome();
      toast("酷安会话有效", "success");
    } catch (error) {
      toast(error.message, "error");
    } finally { button.disabled = false; }
  }
  if (button.matches("#disconnectAccount")) {
    if (!confirm("断开当前酷安账号会话？监控和归档数据不会删除。")) return;
    button.disabled = true;
    try {
      await api("/api/account", { method: "DELETE" });
      state.account = null;
      state.notificationCounts = {};
      updateChrome();
      toast("已断开酷安账号", "success");
      await route({ force: true });
    } catch (error) {
      toast(error.message, "error");
      button.disabled = false;
    }
  }
});

$("#globalSearchForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const keyword = $("#globalSearchInput").value.trim();
  if (keyword) location.hash = `#/search?q=${encodeURIComponent(keyword)}`;
});

$("#mobileMenu").addEventListener("click", () => document.body.classList.toggle("mobile-rail-open"));
$("#collapseRail").addEventListener("click", () => {
  document.body.classList.toggle("rail-collapsed");
  localStorage.setItem("coolweb:rail-collapsed", document.body.classList.contains("rail-collapsed") ? "1" : "0");
});

$("#quickRefresh").addEventListener("click", (event) => {
  event.currentTarget.classList.add("loading");
  route({ force: true }).finally(() => event.currentTarget.classList.remove("loading"));
});

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("#themeToggle").innerHTML = `<i class="ph ph-${theme === "dark" ? "sun" : "moon"}"></i>`;
  localStorage.setItem("coolweb:theme", theme);
}

$("#themeToggle").addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
$("#composeTrigger").addEventListener("click", () => openComposer("feed"));
$("#composeForm").addEventListener("submit", submitComposer);
let composeDraftTimer = null;
$("#composeMessage").addEventListener("input", (event) => {
  $("#composeCount").textContent = String(event.target.value.length);
  $("#composeCount").parentElement.classList.toggle("near-limit", event.target.value.length >= 9000);
  clearTimeout(composeDraftTimer);
  $("#composeDraftStatus").textContent = "正在保存草稿…";
  const draftKey = state.compose.draftKey;
  const draftMessage = event.target.value;
  composeDraftTimer = setTimeout(() => saveComposeDraft(draftKey, draftMessage), 350);
});
$("#composeImages").addEventListener("change", (event) => {
  addComposeFiles(event.target.files);
  event.target.value = "";
});
const composeDropZone = $("#composeDropZone");
["dragenter", "dragover"].forEach((type) => composeDropZone.addEventListener(type, (event) => {
  event.preventDefault();
  composeDropZone.classList.add("dragging");
}));
["dragleave", "drop"].forEach((type) => composeDropZone.addEventListener(type, (event) => {
  event.preventDefault();
  composeDropZone.classList.remove("dragging");
  if (type === "drop") addComposeFiles(event.dataTransfer?.files);
}));
$("#composeMessage").addEventListener("paste", (event) => {
  const files = [...(event.clipboardData?.files || [])];
  if (files.length) addComposeFiles(files);
});
ruleDialog.addEventListener("change", (event) => { if (event.target.name === "ruleMode") syncRuleMode(); });
$("#ruleForm").addEventListener("submit", saveRule);
$("#analyzeRule").addEventListener("click", analyzeRule);

$("#zoomIn").addEventListener("click", () => setZoom(state.lightbox.zoom + .25));
$("#zoomOut").addEventListener("click", () => setZoom(state.lightbox.zoom - .25));
$("#zoomReset").addEventListener("click", () => setZoom(1));
lightboxStage.addEventListener("wheel", (event) => {
  event.preventDefault();
  setZoom(state.lightbox.zoom + (event.deltaY < 0 ? .18 : -.18));
}, { passive: false });
lightboxStage.addEventListener("pointerdown", (event) => {
  state.lightbox.dragging = true;
  state.lightbox.startX = event.clientX - state.lightbox.x;
  state.lightbox.startY = event.clientY - state.lightbox.y;
  lightboxStage.classList.add("dragging");
  lightboxStage.setPointerCapture(event.pointerId);
});
lightboxStage.addEventListener("pointermove", (event) => {
  if (!state.lightbox.dragging) return;
  state.lightbox.x = event.clientX - state.lightbox.startX;
  state.lightbox.y = event.clientY - state.lightbox.startY;
  updateLightbox();
});
lightboxStage.addEventListener("pointerup", () => {
  state.lightbox.dragging = false;
  lightboxStage.classList.remove("dragging");
});
lightboxStage.addEventListener("pointercancel", () => {
  state.lightbox.dragging = false;
  lightboxStage.classList.remove("dragging");
});
lightboxStage.addEventListener("dblclick", () => setZoom(state.lightbox.zoom === 1 ? 2 : 1));

document.addEventListener("error", (event) => {
  if (event.target instanceof HTMLImageElement) {
    event.target.style.visibility = "hidden";
    event.target.closest("button, .app-card, .topic-card-logo")?.classList.add("image-error");
  }
}, true);

window.addEventListener("hashchange", () => route());
window.addEventListener("keydown", (event) => {
  if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    $("#globalSearchInput").focus();
  }
  if (event.key === "Escape") document.body.classList.remove("mobile-rail-open");
});

async function initialize() {
  const preferredTheme = localStorage.getItem("coolweb:theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(preferredTheme);
  if (localStorage.getItem("coolweb:rail-collapsed") === "1") document.body.classList.add("rail-collapsed");
  try {
    await loadBaseState();
  } catch {
    updateChrome(true);
  }
  if (!location.hash) history.replaceState(null, "", "#/home");
  await route();
}

initialize();
