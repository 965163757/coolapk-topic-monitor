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
const accessDialog = $("#accessDialog");
const accessForm = $("#accessForm");

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
  imageGroups: new Map(),
  evaluations: [],
  evaluationStats: { total: 0, matched: 0, notified: 0, errors: 0 },
  channelCache: new Map(),
  pageCache: new Map(),
  home: { channel: "home", page: 1, feeds: [], supportingData: null, requestId: 0, loading: false },
  channelPage: { source: "", page: 1, data: null, requestId: 0 },
  topicDetail: { source: "", sort: "dateline_desc", page: 1, feeds: [], requestId: 0 },
  detailRequests: { feed: 0, app: 0, topic: 0, user: 0, collection: 0 },
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
  lightbox: {
    sources: [],
    index: 0,
    caption: "查看图片",
    zoom: 1,
    x: 0,
    y: 0,
    dragging: false,
    startX: 0,
    startY: 0,
    swipeStart: null,
    pointers: new Map(),
    pinchDistance: 0,
    pinchZoom: 1,
  },
  access: {
    enabled: false,
    authenticated: true,
    initialized: false,
    waiters: [],
  },
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
const HOME_CHANNELS = [
  { key: "home", label: "推荐", icon: "house", description: "酷安编辑精选与社区热门内容" },
  { key: "news", label: "快讯", icon: "lightning", description: "数码科技行业的即时消息" },
  { key: "questions", label: "问答", icon: "question", description: "酷友正在讨论的问题与回答" },
  { key: "pictures", label: "酷图", icon: "image", description: "摄影、桌面与设备美图" },
  { key: "digital", label: "数码", icon: "device-mobile", description: "手机、电脑与智能设备内容" },
  { key: "goods", label: "好物", icon: "shopping-bag", description: "酷友分享的实用产品与体验" },
  { key: "tutorials", label: "教程", icon: "book-open-text", description: "玩机技巧与实用教程" },
  { key: "chat", label: "闲聊", icon: "chats-circle", description: "轻松日常与社区闲聊" },
];

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && payload.code === "AUTH_REQUIRED") {
      state.access.enabled = true;
      state.access.authenticated = false;
      showAccessGate(payload.error);
    }
    const error = new Error(payload.error || `请求失败（HTTP ${response.status}）`);
    error.code = payload.code || "";
    error.status = response.status;
    throw error;
  }
  return payload;
}

function showAccessGate(message = "") {
  if (!accessDialog) return;
  const status = $("#accessStatus");
  if (status) status.textContent = message;
  if (!accessDialog.open) accessDialog.showModal();
  requestAnimationFrame(() => $("#accessToken")?.focus());
}

function waitForAccess() {
  showAccessGate();
  return new Promise((resolve) => state.access.waiters.push(resolve));
}

async function ensureAccess() {
  try {
    const response = await fetch("/api/auth/status", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return;
    state.access.enabled = Boolean(payload.enabled);
    state.access.authenticated = Boolean(payload.authenticated);
    if (state.access.enabled && !state.access.authenticated) await waitForAccess();
  } catch {
    // The regular page loaders surface connectivity errors with their retry UI.
  }
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

function imageUrl(value = "", { width = 0, quality = 0, format = "", origin = false } = {}) {
  const url = safeUrl(value);
  if (!url) return "";
  const params = new URLSearchParams({ url });
  if (Number(width) > 0) params.set("w", String(Math.round(Number(width))));
  if (Number(quality) > 0) params.set("q", String(Math.round(Number(quality))));
  if (format) params.set("format", String(format));
  if (origin) params.set("__origin", "1");
  return `/api/image?${params}`;
}

function imageMarkup(value, {
  alt = "",
  className = "",
  width = 720,
  quality = 78,
  priority = false,
  carousel = false,
} = {}) {
  const variant = { width, quality, format: "webp" };
  const src = imageUrl(value, variant);
  if (!src) return "";
  const originFallback = imageUrl(value, { ...variant, origin: true });
  const sourceAttribute = priority ? "src" : carousel ? "data-carousel-src" : "data-lazy-src";
  return `<img${className ? ` class="${escapeHtml(className)}"` : ""} ${sourceAttribute}="${escapeHtml(src)}" data-image-origin-fallback="${escapeHtml(originFallback)}" alt="${escapeHtml(alt)}" loading="${priority ? "eager" : "lazy"}" decoding="async" fetchpriority="${priority ? "high" : "low"}" />`;
}

function retryImageAtOrigin(image) {
  const fallback = image?.dataset?.imageOriginFallback;
  if (!fallback || image.dataset.imageOriginRetried === "1") return false;
  image.dataset.imageOriginRetried = "1";
  image.style.visibility = "visible";
  image.classList.remove("image-ready");
  image.src = fallback;
  return true;
}

const lazyImageObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const image = entry.target;
      lazyImageObserver.unobserve(image);
      const src = image.dataset.lazySrc;
      if (!src) return;
      image.addEventListener("load", () => image.classList.add("image-ready"), { once: true });
      image.src = src;
      delete image.dataset.lazySrc;
    });
  }, { rootMargin: "320px 0px", threshold: 0.01 })
  : null;

function observeDeferredImages(root = document) {
  const images = [
    ...(root instanceof HTMLImageElement && root.dataset.lazySrc ? [root] : []),
    ...(root.querySelectorAll ? root.querySelectorAll("img[data-lazy-src]") : []),
  ];
  images.forEach((image) => {
    if (image.dataset.lazyObserved === "1") return;
    image.dataset.lazyObserved = "1";
    if (lazyImageObserver) lazyImageObserver.observe(image);
    else {
      image.src = image.dataset.lazySrc;
      delete image.dataset.lazySrc;
    }
  });
}

const lazyImageMutations = new MutationObserver((records) => {
  records.forEach((record) => {
    record.addedNodes.forEach((node) => {
      if (node instanceof Element) observeDeferredImages(node);
    });
    record.removedNodes.forEach((node) => {
      if (!lazyImageObserver || !(node instanceof Element)) return;
      if (node instanceof HTMLImageElement) lazyImageObserver.unobserve(node);
      node.querySelectorAll("img[data-lazy-observed]").forEach((image) => lazyImageObserver.unobserve(image));
    });
  });
});
lazyImageMutations.observe(document.body, { childList: true, subtree: true });

function publicSourceKey(value = "") {
  const source = String(value || "").trim();
  if (source.startsWith("topic:") || source.startsWith("product:")) return source;
  try {
    const url = new URL(source, location.origin);
    const topic = url.pathname.match(/^\/t\/(.+)$/);
    if (topic) return `topic:${decodeURIComponent(topic[1])}`;
    const product = url.pathname.match(/^\/product\/([^/]+)$/);
    if (product) return `product:${decodeURIComponent(product[1])}`;
  } catch {
    // Legacy plain topic names are handled below.
  }
  return source ? `topic:${source}` : "";
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
  const image = imageMarkup(url, { alt: name, className, width: 128, quality: 72 });
  return image
    ? image
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
  return `<section class="page-loading"><span class="loading-logo"><i class="ph ph-lightning"></i></span><h1>${escapeHtml(title)}</h1><p>正在与酷安公开接口同步…</p></section>`;
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
  const group = `feed:${String(feed.id || displayFeedTitle(feed))}`;
  state.imageGroups.set(group, pictures);
  const visible = pictures.slice(0, 3);
  const className = visible.length === 1 ? "one" : visible.length === 2 ? "two" : "three";
  return `<div class="feed-images ${className}">${visible.map((picture, index) => {
    const more = index === 2 && pictures.length > 3 ? `+${pictures.length - 3}` : "";
    return `<button class="${more ? "more" : ""}" type="button" data-image="${escapeHtml(picture)}" data-image-group="${escapeHtml(group)}" data-image-index="${index}" data-caption="${escapeHtml(displayFeedTitle(feed))}" aria-label="放大帖子图片 ${index + 1}${more ? `，另有 ${pictures.length - 3} 张` : ""}" ${more ? `data-more="${more}"` : ""}>${imageMarkup(picture, { alt: `帖子图片 ${index + 1}`, width: 720, quality: 78 })}</button>`;
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

  if (options.home) {
    const summary = message && message !== title ? message : "";
    return `
      <article class="feed-card home-feed-card compact" data-feed-card="${escapeHtml(feed.id)}">
        <div class="home-feed-identity">${avatarMarkup(feed.avatar, feed.username)}</div>
        <div class="home-feed-copy">
          <header class="home-feed-byline">
            <button type="button" data-user="${escapeHtml(feed.userId || "")}">${escapeHtml(feed.username || "酷友")}</button>
            ${feed.topic ? `<button class="feed-topic" type="button" data-public-topic="${escapeHtml(`topic:${feed.topic}`)}"><i class="ph ph-hash"></i>${escapeHtml(feed.topic)}</button>` : ""}
          </header>
          <button class="home-feed-open" type="button" data-feed="${escapeHtml(feed.id)}" aria-label="查看动态：${escapeHtml(title)}">
            <h2 class="feed-title">${escapeHtml(title)}</h2>
            ${summary ? `<p class="feed-text">${escapeHtml(summary)}</p>` : ""}
          </button>
        </div>
        ${feedImageMarkup(feed)}
        <footer class="feed-meta home-feed-actions">
          <small class="home-feed-time">${escapeHtml(relativeTime(feed.createdAt))}</small>
          <button type="button" data-feed="${escapeHtml(feed.id)}" aria-label="查看 ${compactNumber(feed.comments)} 条评论"><i class="ph ph-chat-circle"></i>${compactNumber(feed.comments)}</button>
          <button class="${feed.liked ? "active" : ""}" type="button" data-feed-like="${escapeHtml(feed.id)}" data-liked="${feed.liked ? "1" : "0"}" aria-label="${feed.liked ? "取消点赞" : "点赞"}，当前 ${compactNumber(feed.likes)} 个赞"><i class="ph${feed.liked ? "-fill" : ""} ph-thumbs-up"></i><span data-interaction-count data-count="${Number(feed.likes || 0)}">${compactNumber(feed.likes)}</span></button>
          <button class="share-action" type="button" data-share-feed="${escapeHtml(feed.id)}" data-share-url="${escapeHtml(feed.url || `https://www.coolapk.com/feed/${feed.id}`)}" data-share-title="${escapeHtml(title)}" aria-label="分享动态"><i class="ph ph-share-network"></i></button>
          ${scoreMarkup}
        </footer>
      </article>`;
  }

  return `
    <article class="feed-card ${options.compact ? "compact" : ""}" data-feed-card="${escapeHtml(feed.id)}">
      <div class="feed-card-main">
        <header class="feed-author">
          ${avatarMarkup(feed.avatar, feed.username)}
          <div class="feed-author-info">
            <button type="button" data-user="${escapeHtml(feed.userId || "")}">${escapeHtml(feed.username || "酷友")}</button>
            <small>${escapeHtml(relativeTime(feed.createdAt))}${feed.device ? ` · ${escapeHtml(feed.device)}` : ""}</small>
          </div>
          ${feed.topic ? `<button class="feed-topic" type="button" data-public-topic="${escapeHtml(`topic:${feed.topic}`)}"><i class="ph ph-hash"></i>${escapeHtml(feed.topic)}</button>` : ""}
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
    ? `<div class="feed-stream ${options.home ? "home-feed-list" : ""}">${feeds.map((feed) => feedCard(feed, options)).join("")}</div>`
    : emptyState("newspaper", "暂时没有内容", "该频道当前没有返回可展示的公开动态，请稍后刷新。");
}

function appCard(app) {
  return `<button class="app-card" type="button" data-app="${escapeHtml(app.id)}">
    ${app.logo ? imageMarkup(app.logo, { alt: app.title, width: 128, quality: 76 }) : `<span class="app-logo-placeholder"><i class="ph ph-app-window"></i></span>`}
    <div><h3>${escapeHtml(app.title)}</h3><p>${escapeHtml(app.category || app.subtitle || app.packageName || "应用")}</p><footer><span class="score"><i class="ph-fill ph-star"></i> ${Number(app.score || 0).toFixed(1)}</span><span>${escapeHtml(app.version || "")}</span><span>${escapeHtml(app.size || "")}</span></footer></div>
  </button>`;
}

function appGrid(apps) {
  return apps?.length ? `<div class="app-grid">${apps.map(appCard).join("")}</div>` : emptyState("squares-four", "暂无应用", "当前页面没有返回应用数据。");
}

function topicCard(topic, { showMonitor = true } = {}) {
  const monitored = state.topics.some((item) => item.sourceKey === topic.sourceKey || item.tag === topic.tag);
  const logo = topic.logo ? imageMarkup(topic.logo, { width: 128, quality: 74 }) : `<i class="ph ph-hash"></i>`;
  const title = topic.title || topic.tag;
  const source = topic.sourceKey || (topic.url ? topic.url : `topic:${topic.tag || title}`);
  return `<article class="topic-card">
    <button class="topic-card-cover" type="button" data-public-topic="${escapeHtml(source)}" aria-label="查看话题：${escapeHtml(title)}">${topic.logo ? imageMarkup(topic.logo, { width: 480, quality: 70 }) : ""}</button>
    <div class="topic-card-body"><span class="topic-card-logo">${logo}</span><button class="topic-card-open" type="button" data-public-topic="${escapeHtml(source)}"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(stripHtml(topic.description || topic.intro || "查看话题中的最新公开动态"))}</p></button>
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
  return `<section class="hero-carousel" id="heroCarousel" aria-label="今日精选">${banners.map((banner, index) => `<button class="hero-slide ${index === 0 ? "active" : ""}" type="button" data-smart-link="${escapeHtml(banner.url)}" data-link-title="${escapeHtml(banner.title)}" aria-label="打开精选内容：${escapeHtml(banner.title)}" aria-hidden="${index === 0 ? "false" : "true"}" tabindex="${index === 0 ? "0" : "-1"}">${imageMarkup(banner.picture, { width: 1280, quality: 80, priority: index === 0, carousel: index !== 0 })}<span class="hero-caption"><small>今日精选</small><h2>${escapeHtml(banner.title)}</h2><p>${escapeHtml(banner.subtitle || "来自酷安社区的热门内容")}</p><b>站内查看<i class="ph ph-arrow-right"></i></b></span></button>`).join("")}<div class="hero-dots">${banners.map((_, index) => `<button class="${index === 0 ? "active" : ""}" type="button" data-hero-index="${index}" aria-label="切换到第 ${index + 1} 张精选内容"></button>`).join("")}</div></section>`;
}

function renderShortcuts(shortcuts = []) {
  const fallback = [
    { title: "科技快讯", url: "channel:news", icon: "lightning" },
    { title: "问答", url: "channel:questions", icon: "question" },
    { title: "酷图", url: "channel:pictures", icon: "image" },
    { title: "数码", url: "channel:digital", icon: "device-mobile" },
    { title: "话题", url: "#/topics", icon: "hash" },
  ];
  const items = shortcuts.length ? shortcuts.slice(0, 8) : fallback;
  return `<nav class="shortcut-strip channel-shortcut-strip" aria-label="频道入口">${items.map((item) => `<button class="shortcut" type="button" data-smart-link="${escapeHtml(item.url)}" data-link-title="${escapeHtml(item.title)}" aria-label="打开${escapeHtml(item.title)}">${item.picture ? imageMarkup(item.picture, { width: 160, quality: 72 }) : `<span class="shortcut-icon"><i class="ph ph-${escapeHtml(item.icon || "sparkle")}"></i></span>`}<span>${escapeHtml(item.title)}</span><i class="ph ph-caret-right"></i></button>`).join("")}</nav>`;
}

function renderEditorialSections(sections = []) {
  return sections.filter((section) => section?.items?.length).slice(0, 2).map((section) => {
    const heading = /^(?:#?\/|[A-Za-z]+:\/\/)/.test(String(section.title || "")) ? "社区精选" : section.title || "精选内容";
    return `
      <section class="surface editorial-section channel-inline-section">
        <header class="surface-head"><div><h3>${escapeHtml(heading)}</h3></div><span>${section.items.length}</span></header>
        <div class="editorial-grid">${section.items.slice(0, 8).map((item, index) => `<button type="button" data-smart-link="${escapeHtml(item.url)}" data-link-title="${escapeHtml(item.title)}" aria-label="打开：${escapeHtml(item.title)}">${item.picture ? imageMarkup(item.picture, { width: 320, quality: 74 }) : `<span>${String(index + 1).padStart(2, "0")}</span>`}<div><strong>${escapeHtml(item.title)}</strong>${item.subtitle ? `<p>${escapeHtml(item.subtitle)}</p>` : ""}</div><i class="ph ph-caret-right"></i></button>`).join("")}</div>
      </section>`;
  }).join("");
}

function renderDirectories(items = []) {
  if (!items.length) return "";
  return `
    <section class="surface editorial-section channel-inline-section">
      <header class="surface-head"><div><h3>浏览分类</h3><p>选择分类继续在站内浏览</p></div><span>${items.length}</span></header>
      <div class="editorial-grid">${items.slice(0, 50).map((item, index) => `<button type="button" data-smart-link="${escapeHtml(item.url)}" data-link-title="${escapeHtml(item.title)}" aria-label="打开：${escapeHtml(item.title)}">${item.picture ? imageMarkup(item.picture, { width: 160, quality: 72 }) : `<span>${String(index + 1).padStart(2, "0")}</span>`}<div><strong>${escapeHtml(item.title)}</strong>${item.subtitle ? `<p>${escapeHtml(item.subtitle)}</p>` : ""}</div><i class="ph ph-caret-right"></i></button>`).join("")}</div>
    </section>`;
}

function homeChannelMeta(channel) {
  return HOME_CHANNELS.find((item) => item.key === channel) || HOME_CHANNELS[0];
}

function trendingTopicMarkup(topics = []) {
  if (!topics.length) return `<div class="home-topic-empty"><i class="ph ph-hash"></i><span>热榜同步中</span></div>`;
  return topics.slice(0, 6).map((topic, index) => {
    const title = topic.title || topic.tag || "热门话题";
    const source = topic.sourceKey || topic.url || `topic:${topic.tag || title}`;
    const monitorSource = topic.sourceKey || topic.tag || title;
    const monitored = state.topics.some((item) => item.sourceKey === monitorSource || item.tag === monitorSource || item.tag === topic.tag);
    return `<article class="trending-topic-row">
      <button class="trending-topic-main" type="button" data-public-topic="${escapeHtml(source)}" aria-label="查看话题：${escapeHtml(title)}">
        <b>${String(index + 1).padStart(2, "0")}</b>
        ${topic.logo ? imageMarkup(topic.logo, { width: 96, quality: 72 }) : `<span class="trending-topic-icon"><i class="ph ph-hash"></i></span>`}
        <div><strong>${escapeHtml(title)}</strong><small>${compactNumber(topic.followers || 0)} 关注 · ${compactNumber(topic.posts || topic.hot || 0)} 动态</small></div>
      </button>
      <button class="trending-topic-monitor" type="button" data-monitor-add="${escapeHtml(monitorSource)}" aria-label="${monitored ? "已监控" : "加入监控"}：${escapeHtml(title)}" ${monitored ? "disabled" : ""}><i class="ph ph-${monitored ? "check" : "radar"}"></i><span>${monitored ? "已监控" : "监控"}</span></button>
    </article>`;
  }).join("");
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
  const homeStats = {
    homeStatTopics: state.topics.length,
    homeStatMatched: compactNumber(state.evaluationStats.matched),
    homeStatNotified: compactNumber(state.evaluationStats.notified),
    homeStatArchived: compactNumber(state.status?.archive?.feeds),
  };
  Object.entries(homeStats).forEach(([id, value]) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  });
}

function setActiveNavigation(route) {
  const navRoute = route === "channel" ? "home" : route === "search" ? "" : route;
  $$("[data-nav]").forEach((item) => item.classList.toggle("active", item.dataset.nav === navRoute));
}

function parseRoute() {
  const value = location.hash.replace(/^#\/?/, "");
  const [path = "home", query = ""] = value.split("?");
  const route = ["home", "channel", "discover", "apps", "topics", "notifications", "account", "monitor", "ai", "settings", "search"].includes(path) ? path : "home";
  return { route, params: new URLSearchParams(query) };
}

async function route({ force = false } = {}) {
  closeAllDialogs();
  const headerMore = $(".header-more");
  if (headerMore) headerMore.open = false;
  state.imageGroups.clear();
  const parsed = parseRoute();
  state.route = parsed.route;
  state.routeParams = parsed.params;
  document.body.dataset.route = parsed.route;
  setActiveNavigation(parsed.route);
  document.body.classList.remove("mobile-rail-open");
  $("#mobileMenu")?.setAttribute("aria-expanded", "false");
  clearInterval(state.carouselTimer);
  const sequence = ++state.requestSequence;
  viewHost.innerHTML = pageLoading({
    home: "正在加载首页",
    channel: "正在加载内容频道",
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
    const renderers = { home: renderHome, channel: renderChannel, discover: renderDiscover, apps: renderApps, topics: renderTopics, notifications: renderNotifications, account: renderAccount, monitor: renderMonitor, ai: renderAi, settings: renderSettings, search: renderSearch };
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
  const storageKey = `coolweb:channel:v1:${key}`;
  if (force) {
    [...state.channelCache.keys()].filter((item) => item.startsWith(`${channel}:`)).forEach((item) => state.channelCache.delete(item));
    try { sessionStorage.removeItem(storageKey); } catch { /* Storage may be unavailable. */ }
  }
  if (!force && state.channelCache.has(key)) return state.channelCache.get(key);
  if (!force && page === 1 && ["home", "topics"].includes(channel)) {
    try {
      const cached = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (cached?.data && Date.now() - Number(cached.savedAt || 0) < 180_000) {
        state.channelCache.set(key, cached.data);
        return cached.data;
      }
    } catch {
      // Ignore malformed or unavailable session storage.
    }
  }
  const data = await api(`/api/web/channel?channel=${encodeURIComponent(channel)}&page=${page}${force ? "&refresh=1" : ""}`);
  state.channelCache.set(key, data);
  if (page === 1 && ["home", "topics"].includes(channel)) {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ savedAt: Date.now(), data })); } catch { /* Quota is best-effort. */ }
  }
  return data;
}

async function pageData(source, { force = false, page = 1 } = {}) {
  const key = `${source}:${page}`;
  if (force) {
    [...state.pageCache.keys()].filter((item) => item.startsWith(`${source}:`)).forEach((item) => state.pageCache.delete(item));
  }
  if (!force && state.pageCache.has(key)) return state.pageCache.get(key);
  const data = await api(`/api/web/page?source=${encodeURIComponent(source)}&page=${page}${force ? "&refresh=1" : ""}`);
  state.pageCache.set(key, data);
  return data;
}

async function renderHome({ force, sequence }) {
  const trendingRequest = channelData("topics", { force }).catch(() => ({ topics: [] }));
  const data = await channelData("home", { force });
  if (sequence !== state.requestSequence) return;
  const topics = data.topics || [];
  const homeFeeds = data.feeds || [];
  const requested = state.routeParams.get("channel") || "home";
  const initialChannel = HOME_CHANNELS.some((item) => item.key === requested) ? requested : "home";
  const initialMeta = homeChannelMeta(initialChannel);
  const feedById = new Map(homeFeeds.map((feed) => [String(feed.id), feed]));
  const latestHits = state.evaluations.filter((item) => item.matched && item.feedId).slice(0, 3);
  const runtimeLabel = state.status?.refreshing ? "同步中" : state.status ? "运行中" : "连接中";
  const nextPollLabel = state.status?.nextPollAt ? `下次 ${formatDate(state.status.nextPollAt)}` : "每 5 分钟同步";
  const latestHitMarkup = latestHits.length ? latestHits.map((item) => {
    const feed = feedById.get(String(item.feedId));
    const score = Number(item.matchScore ?? item.confidence);
    const percent = Number.isFinite(score) ? Math.round(Math.max(0, Math.min(1, score)) * 100) : null;
    const reasonLead = String(item.reason || "").split(/[，。；;：:]/)[0].trim();
    const fallbackTitle = /的动态$/.test(String(item.title || ""))
      ? reasonLead || `${item.topic || "监控规则"}命中`
      : item.title || reasonLead || `动态 ${item.feedId}`;
    const title = feed ? displayFeedTitle(feed) : fallbackTitle;
    const picture = feed?.pictures?.find(Boolean) || item.picture || item.image || "";
    return `<article class="home-hit-row">
      <button class="home-hit-main" type="button" data-feed="${escapeHtml(item.feedId)}" aria-label="查看命中动态：${escapeHtml(title)}">
        ${picture ? imageMarkup(picture, { width: 240, quality: 74 }) : `<span class="home-hit-thumb"><i class="ph ph-sparkle"></i></span>`}
        <div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(item.reason || "符合当前监控规则")}</p></div>
        <span class="home-hit-score"><strong>${percent == null ? "—" : `${percent}%`}</strong><small>匹配</small></span>
      </button>
      ${item.topic ? `<button class="home-hit-topic" type="button" data-monitor-topic="${escapeHtml(item.topic)}"><i class="ph ph-hash"></i>${escapeHtml(item.topic)}</button>` : ""}
    </article>`;
  }).join("") : `<div class="home-hit-empty"><i class="ph ph-sparkle"></i><strong>暂无命中</strong><a href="#/monitor">查看监控</a></div>`;

  state.home = {
    channel: initialChannel,
    page: 1,
    feeds: initialChannel === "home" ? homeFeeds : [],
    supportingData: initialChannel === "home" ? {} : null,
    requestId: state.home.requestId,
    loading: initialChannel !== "home",
  };

  viewHost.innerHTML = `<section class="page home-page home-command-page">
    <nav class="channel-tabs home-channel-tabs" id="homeChannelTabs" aria-label="首页内容频道" role="tablist">
      ${HOME_CHANNELS.map((item) => `<button class="${item.key === initialChannel ? "active" : ""}" id="homeChannelTab-${item.key}" type="button" role="tab" data-home-channel="${item.key}" aria-controls="homeFeedRegion" aria-selected="${item.key === initialChannel ? "true" : "false"}" tabindex="${item.key === initialChannel ? "0" : "-1"}"><i class="ph ph-${item.icon}"></i><span>${item.label}</span></button>`).join("")}
      <a class="home-channel-more" href="#/discover"><i class="ph ph-squares-four"></i><span>广场</span></a>
    </nav>

    <section class="surface home-topic-board">
      <header class="home-topic-board-head"><div><i class="ph-fill ph-fire"></i><h2>热门话题</h2></div><a href="#/topics">查看全部<i class="ph ph-caret-right"></i></a></header>
      <div class="home-topic-bar" id="homeTrendingTopics">${trendingTopicMarkup(topics)}</div>
    </section>

    <div class="content-layout home-workspace">
      <main class="content-column">
        <section class="home-feed-panel" id="homeFeedPanel">
          <header class="home-feed-toolbar">
            <div><h2 id="homeChannelTitle">${escapeHtml(initialMeta.label)}动态</h2><p id="homeChannelDescription">${escapeHtml(initialMeta.description)}</p></div>
            <div class="home-feed-toolbar-actions"><span id="homeChannelStatus">${initialChannel === "home" ? `${homeFeeds.length} 条` : "正在加载"}</span><button type="button" data-route-refresh aria-label="刷新内容"><i class="ph ph-arrows-clockwise"></i><span>刷新</span></button></div>
          </header>
          <div id="homeFeedRegion" role="tabpanel" aria-labelledby="homeChannelTab-${initialChannel}" aria-live="polite" aria-busy="${initialChannel === "home" ? "false" : "true"}">${initialChannel === "home" ? feedStream(homeFeeds, { home: true }) : skeletonFeeds(4)}</div>
          <div class="load-more home-load-more"><button class="btn secondary" type="button" data-home-load-more ${initialChannel === "home" && homeFeeds.length ? "" : "disabled"}><i class="ph ph-plus-circle"></i>加载更多</button></div>
        </section>
      </main>

      <aside class="side-column home-monitor-rail">
        <section class="surface home-monitor-card ai-command-card">
          <header class="home-monitor-head"><div><h2>AI 监控</h2><span class="home-monitor-state"><i></i>${runtimeLabel}</span></div><a href="#/monitor">管理<i class="ph ph-caret-right"></i></a></header>
          <div class="home-monitor-summary">
            <article><small>监控话题</small><strong id="homeStatTopics">${state.topics.length}</strong></article>
            <article><small>已判断</small><strong>${compactNumber(state.evaluationStats.total)}</strong></article>
            <article><small>AI 命中</small><strong id="homeStatMatched">${compactNumber(state.evaluationStats.matched)}</strong></article>
            <article><small>已通知</small><strong id="homeStatNotified">${compactNumber(state.evaluationStats.notified)}</strong></article>
          </div>
          <div class="home-monitor-meta"><span><i class="ph ph-clock"></i>${escapeHtml(nextPollLabel)}</span><span>归档 <b id="homeStatArchived">${compactNumber(state.status?.archive?.feeds)}</b></span></div>
          <section class="home-latest-hits">
            <header><h3>最新命中</h3><a href="#/ai">查看全部<i class="ph ph-caret-right"></i></a></header>
            <div class="home-hit-list">${latestHitMarkup}</div>
          </section>
        </section>
      </aside>
    </div>
  </section>`;

  trendingRequest.then((trending) => {
    const region = $("#homeTrendingTopics");
    if (!region || sequence !== state.requestSequence || state.route !== "home" || !trending.topics?.length) return;
    region.innerHTML = trendingTopicMarkup(trending.topics);
  });
  if (initialChannel !== "home") loadHomeChannel(initialChannel, { updateUrl: false, force });
}

async function loadHomeChannel(channel, { append = false, force = false, updateUrl = true } = {}) {
  const region = $("#homeFeedRegion");
  const panel = $("#homeFeedPanel");
  const loadMore = $("[data-home-load-more]");
  if (!region || !panel || !HOME_CHANNELS.some((item) => item.key === channel)) return;
  const meta = homeChannelMeta(channel);
  const requestId = ++state.home.requestId;
  const nextPage = append && state.home.channel === channel ? state.home.page + 1 : 1;
  state.home.channel = channel;
  state.home.loading = true;
  $$("[data-home-channel]").forEach((button) => {
    const active = button.dataset.homeChannel === channel;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  region.setAttribute("aria-labelledby", `homeChannelTab-${channel}`);
  $("#homeChannelTitle").textContent = `${meta.label}动态`;
  $("#homeChannelDescription").textContent = meta.description;
  $("#homeChannelStatus").textContent = append ? `正在加载第 ${nextPage} 页` : "正在加载";
  region.setAttribute("aria-busy", "true");
  panel.classList.add("loading");
  if (!append) region.innerHTML = skeletonFeeds(2);
  if (loadMore) {
    loadMore.disabled = true;
    loadMore.innerHTML = `<i class="ph ph-circle-notch"></i>正在加载`;
  }
  if (updateUrl) {
    const query = channel === "home" ? "" : `?channel=${encodeURIComponent(channel)}`;
    history.replaceState(null, "", `#/home${query}`);
  }
  try {
    const data = await channelData(channel, { page: nextPage, force });
    if (requestId !== state.home.requestId || state.route !== "home") return;
    const previousFeedCount = state.home.feeds.length;
    const feeds = append
      ? [...new Map([...state.home.feeds, ...(data.feeds || [])].map((feed) => [String(feed.id), feed])).values()]
      : data.feeds || [];
    const addedFeedCount = append ? feeds.length - previousFeedCount : feeds.length;
    const supportingData = channel === "home" ? {} : append ? state.home.supportingData || {} : data;
    state.home = { ...state.home, channel, page: nextPage, feeds, supportingData, loading: false, requestId };
    const supportingCount = (supportingData.apps?.length || 0) + (supportingData.topics?.length || 0) + (supportingData.users?.length || 0) + (supportingData.shortcuts?.length || 0);
    const supportingContent = [
      supportingData.shortcuts?.length ? `<section class="surface channel-inline-section"><header class="surface-head"><div><h3>频道入口</h3><p>继续在站内浏览细分内容</p></div></header>${renderShortcuts(supportingData.shortcuts)}</section>` : "",
      renderEditorialSections(supportingData.sections),
      supportingData.apps?.length ? `<section class="surface channel-inline-section"><header class="surface-head"><div><h3>应用与游戏</h3><p>${supportingData.apps.length} 个结果</p></div></header><div class="entity-section-body">${appGrid(supportingData.apps)}</div></section>` : "",
      supportingData.topics?.length ? `<section class="surface channel-inline-section"><header class="surface-head"><div><h3>话题与产品</h3><p>${supportingData.topics.length} 个结果</p></div></header><div class="entity-section-body">${topicGrid(supportingData.topics)}</div></section>` : "",
      supportingData.users?.length ? `<section class="surface channel-inline-section"><header class="surface-head"><div><h3>推荐酷友</h3><p>${supportingData.users.length} 位用户</p></div></header><div class="entity-section-body">${userCards(supportingData.users)}</div></section>` : "",
    ].filter(Boolean).join("");
    region.innerHTML = `${supportingContent}${feeds.length || !supportingContent ? feedStream(feeds, { home: true }) : ""}`;
    $("#homeChannelStatus").textContent = `${feeds.length + supportingCount} 条内容 · 第 ${nextPage} 页`;
    if (loadMore) {
      loadMore.disabled = addedFeedCount <= 0;
      loadMore.innerHTML = loadMore.disabled
        ? `<i class="ph ph-check"></i>没有更多内容`
        : `<i class="ph ph-plus-circle"></i>加载更多${escapeHtml(meta.label)}`;
    }
  } catch (error) {
    if (requestId !== state.home.requestId) return;
    state.home.loading = false;
    if (!append) {
      region.innerHTML = `<div class="inline-error"><i class="ph ph-warning-circle"></i><span>${escapeHtml(error.message)}</span><button type="button" data-home-retry>重新加载</button></div>`;
    } else {
      toast(`第 ${nextPage} 页加载失败：${error.message}`, "error");
    }
    $("#homeChannelStatus").textContent = append ? `第 ${nextPage} 页加载失败，已保留现有内容` : "加载失败";
    if (loadMore) {
      loadMore.disabled = !append;
      loadMore.innerHTML = append
        ? `<i class="ph ph-arrow-clockwise"></i>重试加载第 ${nextPage} 页`
        : `<i class="ph ph-warning"></i>等待重试`;
    }
  } finally {
    if (requestId === state.home.requestId) {
      region.setAttribute("aria-busy", "false");
      panel.classList.remove("loading");
    }
  }
}

function startCarousel() {
  const carousel = $("#heroCarousel");
  if (!carousel) return;
  let index = 0;
  let preloadTimer = null;
  const slides = $$(".hero-slide", carousel);
  const dots = $$("[data-hero-index]", carousel);
  const loadSlide = (slideIndex) => {
    const image = $("img[data-carousel-src]", slides[(slideIndex + slides.length) % slides.length]);
    if (!image) return;
    image.addEventListener("load", () => image.classList.add("image-ready"), { once: true });
    image.src = image.dataset.carouselSrc;
    delete image.dataset.carouselSrc;
  };
  const scheduleNextImage = () => {
    clearTimeout(preloadTimer);
    preloadTimer = setTimeout(() => {
      if (carousel.isConnected && document.visibilityState === "visible") loadSlide(index + 1);
    }, 3200);
  };
  const show = (next) => {
    index = (next + slides.length) % slides.length;
    loadSlide(index);
    slides.forEach((slide, itemIndex) => {
      const active = itemIndex === index;
      slide.classList.toggle("active", active);
      slide.setAttribute("aria-hidden", String(!active));
      slide.tabIndex = active ? 0 : -1;
    });
    dots.forEach((dot, itemIndex) => dot.classList.toggle("active", itemIndex === index));
    scheduleNextImage();
  };
  carousel._showSlide = show;
  const play = () => {
    clearInterval(state.carouselTimer);
    state.carouselTimer = setInterval(() => show(index + 1), 6000);
  };
  const pause = () => clearInterval(state.carouselTimer);
  carousel.addEventListener("mouseenter", pause);
  carousel.addEventListener("mouseleave", play);
  carousel.addEventListener("focusin", pause);
  carousel.addEventListener("focusout", (event) => {
    if (!carousel.contains(event.relatedTarget)) play();
  });
  scheduleNextImage();
  play();
}

function channelPageContent(data) {
  const sections = [
    data.banners?.length ? renderHero(data.banners) : "",
    data.shortcuts?.length ? `<section class="surface home-shortcuts"><header class="surface-head"><div><h2>频道入口</h2><p>继续在站内打开分类与专题</p></div></header>${renderShortcuts(data.shortcuts)}</section>` : "",
    renderEditorialSections(data.sections),
    renderDirectories(data.directories),
    data.feeds?.length ? `<section class="channel-result-section"><header class="surface-head"><div><h2>动态内容</h2><p>${data.feeds.length} 条公开内容</p></div></header><div id="channelPageFeeds">${feedStream(data.feeds)}</div></section>` : "",
    data.apps?.length ? `<section class="surface channel-entity-section"><header class="surface-head"><div><h2>应用与游戏</h2><p>${data.apps.length} 个结果</p></div></header><div class="entity-section-body">${appGrid(data.apps)}</div></section>` : "",
    data.topics?.length ? `<section class="surface channel-entity-section"><header class="surface-head"><div><h2>话题与产品</h2><p>${data.topics.length} 个结果</p></div></header><div class="entity-section-body">${topicGrid(data.topics)}</div></section>` : "",
    data.users?.length ? `<section class="surface channel-entity-section"><header class="surface-head"><div><h2>推荐酷友</h2><p>${data.users.length} 位用户</p></div></header><div class="entity-section-body">${userCards(data.users)}</div></section>` : "",
  ].filter(Boolean);
  return sections.length ? sections.join("") : emptyState("files", "该频道暂时没有内容", "上游页面没有返回可展示的公开数据，请稍后刷新。");
}

function channelResultCount(data = {}) {
  return ["feeds", "apps", "topics", "users", "shortcuts", "sections", "banners", "directories"]
    .reduce((total, key) => total + (Array.isArray(data[key]) ? data[key].length : 0), 0);
}

function mergeChannelPageData(current = {}, next = {}) {
  const uniqueBy = (items, key) => [...new Map(items.filter(Boolean).map((item, index) => [String(item?.[key] || `${item?.title || ""}:${item?.url || ""}:${index}`), item])).values()];
  return {
    ...current,
    ...next,
    banners: uniqueBy([...(current.banners || []), ...(next.banners || [])], "url"),
    shortcuts: uniqueBy([...(current.shortcuts || []), ...(next.shortcuts || [])], "url"),
    feeds: uniqueBy([...(current.feeds || []), ...(next.feeds || [])], "id"),
    apps: uniqueBy([...(current.apps || []), ...(next.apps || [])], "id"),
    topics: uniqueBy([...(current.topics || []), ...(next.topics || [])], "sourceKey"),
    users: uniqueBy([...(current.users || []), ...(next.users || [])], "uid"),
    sections: uniqueBy([...(current.sections || []), ...(next.sections || [])], "title"),
    directories: uniqueBy([...(current.directories || []), ...(next.directories || [])], "url"),
  };
}

async function renderChannel({ force, sequence }) {
  const source = String(state.routeParams.get("source") || "").trim();
  const title = String(state.routeParams.get("title") || "酷安专题").trim().slice(0, 80);
  if (!source) throw new Error("缺少频道页面标识");
  const data = await pageData(source, { force, page: 1 });
  if (sequence !== state.requestSequence) return;
  state.channelPage = { source, page: 1, data, requestId: state.channelPage.requestId + 1 };
  viewHost.innerHTML = `<section class="page channel-page">
    ${pageHead("COOLAPK CHANNEL", title, data.channel?.description || "酷安专题与编辑精选内容", `<a class="btn secondary" href="#/home"><i class="ph ph-arrow-left"></i>返回首页</a><button class="btn primary" type="button" data-route-refresh><i class="ph ph-arrows-clockwise"></i>刷新频道</button>`)}
    <div id="channelPageContent">${channelPageContent(data)}</div>
    ${channelResultCount(data) ? `<div class="load-more channel-page-more"><button class="btn secondary" type="button" data-channel-load-more><i class="ph ph-plus-circle"></i>加载更多内容</button></div>` : ""}
  </section>`;
  startCarousel();
}

async function loadMoreChannelPage() {
  const button = $("[data-channel-load-more]");
  if (!button || !state.channelPage.source) return;
  const requestId = ++state.channelPage.requestId;
  const nextPage = state.channelPage.page + 1;
  button.disabled = true;
  button.innerHTML = `<i class="ph ph-circle-notch"></i>正在加载第 ${nextPage} 页`;
  try {
    const data = await pageData(state.channelPage.source, { page: nextPage });
    if (requestId !== state.channelPage.requestId || state.route !== "channel") return;
    const previousData = state.channelPage.data || {};
    const previousCount = channelResultCount(previousData);
    const mergedData = mergeChannelPageData(previousData, data);
    const addedCount = channelResultCount(mergedData) - previousCount;
    state.channelPage.data = mergedData;
    state.channelPage.page = nextPage;
    const region = $("#channelPageContent");
    if (region) region.innerHTML = channelPageContent(mergedData);
    startCarousel();
    button.disabled = addedCount <= 0;
    button.innerHTML = addedCount > 0
      ? `<i class="ph ph-plus-circle"></i>加载更多内容`
      : `<i class="ph ph-check"></i>没有更多内容`;
  } catch (error) {
    toast(error.message, "error");
    button.disabled = false;
    button.innerHTML = `<i class="ph ph-arrow-clockwise"></i>重新加载`;
  }
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
  return `<button class="monitor-source ${active ? "active" : ""}" type="button" data-monitor-topic="${escapeHtml(topic.tag)}"><span>${detail.logo ? imageMarkup(detail.logo, { width: 128, quality: 72 }) : `<i class="ph ph-hash"></i>`}</span><div><strong>${escapeHtml(detail.title || topic.tag)}</strong><small>${compactNumber(topic.archiveCount || topic.feeds?.length || 0)} 条归档</small></div>${topic.lastError ? `<b title="${escapeHtml(topic.lastError)}"><i class="ph ph-warning"></i></b>` : ""}</button>`;
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
    <span class="collection-cover">${item.cover ? imageMarkup(item.cover, { width: 360, quality: 74 }) : `<i class="ph ph-bookmarks"></i>`}</span>
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
  const requestedPage = Math.max(1, Math.min(50, Math.trunc(Number(state.routeParams.get("page"))) || 1));
  const payload = await api(`/api/search/all?q=${encodeURIComponent(q)}&page=${requestedPage}`);
  if (sequence !== state.requestSequence) return;
  const page = Number(payload.page || requestedPage);
  const resultCount = ["feeds", "topics", "users", "apps"].reduce((total, key) => total + (payload[key]?.length || 0), 0);
  const canLoadNext = payload.hasMore
    ? Object.values(payload.hasMore).some(Boolean)
    : resultCount > 0;
  viewHost.innerHTML = `<section class="page">
    <section class="search-hero"><h1>搜索结果</h1><p>“${escapeHtml(q)}” · 第 ${page} 页</p><form class="search-page-form" id="pageSearchForm"><i class="ph ph-magnifying-glass"></i><input id="pageSearchInput" type="search" value="${escapeHtml(q)}" /><button type="submit">重新搜索</button></form></section>
    <div class="filter-tabs" id="searchTabs"><button class="active" type="button" data-search-tab="all">全部</button><button type="button" data-search-tab="feeds">帖子 ${payload.feeds?.length || 0}</button><button type="button" data-search-tab="topics">话题 ${payload.topics?.length || 0}</button><button type="button" data-search-tab="users">用户 ${payload.users?.length || 0}</button><button type="button" data-search-tab="apps">应用 ${payload.apps?.length || 0}</button></div>
    <div id="searchResultsRegion" data-search-payload></div>
    <nav class="pagination" aria-label="搜索结果分页"><button type="button" data-search-page="${page - 1}" ${page <= 1 ? "disabled" : ""}><i class="ph ph-caret-left"></i>上一页</button><span>第 ${page} 页</span><button type="button" data-search-page="${page + 1}" ${canLoadNext ? "" : "disabled"}>下一页<i class="ph ph-caret-right"></i></button></nav>
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
  const requestId = ++state.detailRequests.feed;
  state.activeFeedId = String(id);
  state.feedReplyPage = 1;
  feedDialogBody.scrollTop = 0;
  feedDialogBody.innerHTML = `<div class="dialog-loading"><i class="ph ph-circle-notch"></i><span>正在读取动态与评论…</span></div>`;
  showDialog(feedDialog);
  try {
    const payload = await api(`/api/feeds/${encodeURIComponent(id)}?page=1`);
    if (requestId !== state.detailRequests.feed || state.activeFeedId !== String(id) || !feedDialog.open) return;
    renderFeedDetail(payload);
  } catch (error) {
    if (requestId !== state.detailRequests.feed) return;
    feedDialogBody.innerHTML = emptyState("warning-circle", "详情加载失败", error.message, `<button class="btn primary" type="button" data-feed="${escapeHtml(id)}">重新加载</button>`);
  }
}

function commentMarkup(reply) {
  return `<article class="comment" data-reply-card="${escapeHtml(reply.id)}">${avatarMarkup(reply.avatar, reply.username, "avatar")}<div class="comment-main"><header class="comment-head"><button type="button" data-user="${escapeHtml(reply.userId || "")}">${escapeHtml(reply.username || "酷友")}</button>${reply.isAuthor ? `<span class="author-label">作者</span>` : ""}<small>${relativeTime(reply.createdAt)}</small></header><p>${reply.replyTo ? `<span style="color:var(--green)">@${escapeHtml(reply.replyTo)}</span> ` : ""}${escapeHtml(stripHtml(reply.message || ""))}</p>${reply.picture ? `<button type="button" data-image="${escapeHtml(reply.picture)}" aria-label="放大评论图片">${imageMarkup(reply.picture, { alt: "评论图片", className: "comment-picture", width: 720, quality: 78 })}</button>` : ""}<footer><button class="${reply.liked ? "active" : ""}" type="button" data-reply-like="${escapeHtml(reply.id)}" data-liked="${reply.liked ? "1" : "0"}" aria-label="${reply.liked ? "取消点赞评论" : "点赞评论"}，当前 ${compactNumber(reply.likes)} 个赞"><i class="ph${reply.liked ? "-fill" : ""} ph-thumbs-up"></i> <span data-interaction-count data-count="${Number(reply.likes || 0)}">${compactNumber(reply.likes)}</span></button><button type="button" data-compose="reply" data-compose-id="${escapeHtml(reply.id)}" data-compose-title="回复 ${escapeHtml(reply.username || "酷友")}"><i class="ph ph-chat-circle"></i> 回复</button></footer>${reply.replies?.length ? `<div class="nested-replies">${reply.replies.slice(0, 5).map((child) => `<p><button type="button" data-user="${escapeHtml(child.userId || "")}">${escapeHtml(child.username || "酷友")}</button><span>：${escapeHtml(stripHtml(child.message))}</span><button type="button" data-compose="reply" data-compose-id="${escapeHtml(child.id)}" data-compose-title="回复 ${escapeHtml(child.username || "酷友")}" aria-label="回复 ${escapeHtml(child.username || "酷友")}"><i class="ph ph-arrow-bend-up-left"></i></button></p>`).join("")}</div>` : ""}</div></article>`;
}

function renderFeedDetail(payload) {
  const feed = payload.feed;
  const title = displayFeedTitle(feed);
  const webUrl = feed.url || `https://www.coolapk.com/feed/${feed.id}`;
  $("#feedDialogSubtitle").textContent = feed.topic || `${feed.comments || payload.replies?.length || 0} 条评论`;
  feedDialogBody.innerHTML = `<article class="detail-feed"><header class="feed-author">${avatarMarkup(feed.avatar, feed.username)}<div class="feed-author-info"><button type="button" data-user="${escapeHtml(feed.userId || "")}">${escapeHtml(feed.username)}</button><small>${formatDate(feed.createdAt)}${feed.device ? ` · ${escapeHtml(feed.device)}` : ""}</small></div>${feed.topic ? `<button class="feed-topic" type="button" data-public-topic="${escapeHtml(`topic:${feed.topic}`)}"><i class="ph ph-hash"></i>${escapeHtml(feed.topic)}</button>` : ""}</header><h2 class="feed-title">${escapeHtml(title)}</h2><p class="feed-text">${escapeHtml(stripHtml(feed.message || ""))}</p>${feedImageMarkup(feed)}<footer class="feed-meta detail-feed-actions" style="margin:18px -13px -24px"><button class="${feed.liked ? "active" : ""}" type="button" data-feed-like="${escapeHtml(feed.id)}" data-liked="${feed.liked ? "1" : "0"}" aria-label="${feed.liked ? "取消点赞" : "点赞"}，当前 ${compactNumber(feed.likes)} 个赞"><i class="ph${feed.liked ? "-fill" : ""} ph-thumbs-up"></i><span data-interaction-count data-count="${Number(feed.likes || 0)}">${compactNumber(feed.likes)}</span></button><button type="button" data-compose="feed-reply" data-compose-id="${escapeHtml(feed.id)}" data-compose-title="回复动态" aria-label="回复动态，当前 ${compactNumber(feed.replyCount || feed.comments)} 条评论"><i class="ph ph-chat-circle"></i>${compactNumber(feed.replyCount || feed.comments)}</button><button type="button" data-share-feed="${escapeHtml(feed.id)}" data-share-url="${escapeHtml(webUrl)}" data-share-title="${escapeHtml(title)}"><i class="ph ph-share-network"></i>分享</button><a href="coolmarket://feed/${escapeHtml(feed.id)}" class="open-feed" aria-label="在酷安 App 打开"><i class="ph ph-device-mobile"></i>App</a></footer></article><nav class="detail-subnav" aria-label="动态相关信息"><button type="button" data-feed-aux="${escapeHtml(feed.id)}" data-aux-type="likes"><i class="ph ph-users"></i>点赞用户</button><button type="button" data-feed-aux="${escapeHtml(feed.id)}" data-aux-type="forwards"><i class="ph ph-share-fat"></i>转发记录</button><button type="button" data-feed-aux="${escapeHtml(feed.id)}" data-aux-type="history"><i class="ph ph-clock-counter-clockwise"></i>编辑历史</button><a href="${escapeHtml(webUrl)}" target="_blank" rel="noreferrer"><i class="ph ph-browser"></i>网页版</a></nav><section class="comments-section"><header class="comments-head"><h3>全部评论</h3><span>第 <b id="replyPageNumber">1</b> 页</span></header>${state.account?.configured ? `<button class="quick-reply" type="button" data-compose="feed-reply" data-compose-id="${escapeHtml(feed.id)}" data-compose-title="回复动态"><i class="ph ph-pencil-simple-line"></i>写下你的回复</button>` : ""}<div class="comment-list" id="commentList">${payload.replies?.length ? payload.replies.map(commentMarkup).join("") : emptyState("chat-circle", "还没有评论", "该动态暂时没有返回公开评论。")}</div><div class="load-more"><button class="btn secondary" id="loadMoreReplies" type="button" data-load-replies ${payload.replies?.length ? "" : "disabled"}><i class="ph ph-chat-circle-dots"></i>加载更多评论</button></div></section>`;
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
  const requestId = ++state.detailRequests.app;
  appDialogBody.scrollTop = 0;
  appDialogBody.innerHTML = `<div class="dialog-loading"><i class="ph ph-circle-notch"></i><span>正在读取应用详情…</span></div>`;
  showDialog(appDialog);
  try {
    const payload = await api(`/api/apps/${encodeURIComponent(id)}`);
    if (requestId !== state.detailRequests.app || !appDialog.open) return;
    const app = payload.app;
    const screenshotGroup = `app:${app.id}`;
    state.imageGroups.set(screenshotGroup, app.screenshots || []);
    const webUrl = `https://www.coolapk.com/apk/${encodeURIComponent(app.packageName || app.id)}`;
    const appUrl = `coolmarket://apk/${encodeURIComponent(app.packageName || app.id)}`;
    appDialogBody.innerHTML = `<section class="app-detail-hero">${app.logo ? imageMarkup(app.logo, { alt: app.title, width: 192, quality: 78 }) : `<span class="app-logo-placeholder"><i class="ph ph-app-window"></i></span>`}<div><h2>${escapeHtml(app.title)}</h2><p>${escapeHtml(app.subtitle || app.packageName)}</p><div class="app-detail-stats"><span><strong>${Number(app.score || 0).toFixed(1)}</strong><small>酷友评分</small></span><span><strong>${escapeHtml(app.version || "—")}</strong><small>最新版本</small></span><span><strong>${escapeHtml(app.size || "—")}</strong><small>安装包</small></span><span><strong>${compactNumber(app.downloads)}</strong><small>下载</small></span></div><div class="detail-actions"><a class="btn primary" href="${escapeHtml(appUrl)}"><i class="ph ph-device-mobile"></i>酷安 App 打开</a><a class="btn secondary" href="${escapeHtml(webUrl)}" target="_blank" rel="noreferrer"><i class="ph ph-browser"></i>网页版</a></div></div></section>${app.packageName ? `<section class="detail-facts"><span><b>包名</b>${escapeHtml(app.packageName)}</span><span><b>开发者</b>${escapeHtml(app.developer || "—")}</span><span><b>分类</b>${escapeHtml(app.category || "—")}</span><span><b>更新时间</b>${escapeHtml(app.updatedAt ? formatDate(app.updatedAt) : "—")}</span></section>` : ""}${app.description ? `<section class="detail-section"><h3>应用介绍</h3><p>${escapeHtml(stripHtml(app.description))}</p></section>` : ""}${app.changelog ? `<section class="detail-section"><h3>更新说明</h3><p>${escapeHtml(stripHtml(app.changelog))}</p></section>` : ""}${app.permissions?.length ? `<section class="detail-section"><h3>应用权限</h3><div class="permission-list">${app.permissions.map((permission) => `<span><i class="ph ph-shield-check"></i>${escapeHtml(permission)}</span>`).join("")}</div></section>` : ""}${app.screenshots?.length ? `<section class="detail-section"><h3>应用截图</h3><div class="screenshots">${app.screenshots.map((picture, index) => `<button type="button" data-image="${escapeHtml(picture)}" data-image-group="${escapeHtml(screenshotGroup)}" data-image-index="${index}" data-caption="${escapeHtml(app.title)}" aria-label="放大应用截图 ${index + 1}">${imageMarkup(picture, { alt: `应用截图 ${index + 1}`, width: 720, quality: 78 })}</button>`).join("")}</div></section>` : ""}<section class="detail-section"><h3>相关动态</h3>${feedStream(payload.feeds, { compact: true })}</section>`;
  } catch (error) {
    if (requestId !== state.detailRequests.app) return;
    appDialogBody.innerHTML = emptyState("warning-circle", "应用详情加载失败", error.message);
  }
}

async function openTopic(value) {
  const source = publicSourceKey(value);
  if (!source) return;
  const requestId = ++state.detailRequests.topic;
  topicDialogBody.scrollTop = 0;
  topicDialogBody.innerHTML = `<div class="dialog-loading"><i class="ph ph-circle-notch"></i><span>正在读取话题详情…</span></div>`;
  showDialog(topicDialog);
  try {
    const payload = await api(`/api/web/topics/${encodeURIComponent(source)}?page=1&sort=dateline_desc`);
    if (requestId !== state.detailRequests.topic || !topicDialog.open) return;
    const topic = payload.topic;
    const monitored = state.topics.some((item) => item.sourceKey === topic.sourceKey || item.tag === topic.tag);
    const isProduct = topic.sourceType === "product";
    state.topicDetail = { source: topic.sourceKey || source, sort: "dateline_desc", page: 1, feeds: payload.feeds || [], requestId };
    topicDialogBody.innerHTML = `<section class="topic-detail-hero">${topic.logo ? imageMarkup(topic.logo, { width: 192, quality: 78 }) : `<span><i class="ph ph-${isProduct ? "cube" : "hash"}"></i></span>`}<small class="detail-kicker">${isProduct ? "数码产品" : "社区话题"}</small><h2>${escapeHtml(topic.title || topic.tag)}</h2><p>${escapeHtml(stripHtml(topic.description || topic.intro || (isProduct ? "酷安数码产品讨论" : "公开话题")))}</p><div class="profile-stats"><span><strong>${compactNumber(topic.followers)}</strong><small>关注</small></span><span><strong>${compactNumber(topic.posts)}</strong><small>动态</small></span><span><strong>${compactNumber(topic.hot)}</strong><small>热度</small></span></div><div class="detail-actions">${isProduct ? "" : `<button class="btn ${topic.followed ? "secondary active" : "primary"}" type="button" data-topic-follow="${escapeHtml(topic.tag)}" data-followed="${topic.followed ? "1" : "0"}"><i class="ph ph-${topic.followed ? "check" : "plus"}"></i>${topic.followed ? "已关注" : "关注话题"}</button>`}<button class="btn secondary" type="button" data-monitor-add="${escapeHtml(topic.sourceKey || topic.tag)}" ${monitored ? "disabled" : ""}><i class="ph ph-radar"></i>${monitored ? "已加入监控" : "加入监控"}</button></div></section>
      <nav class="detail-tabs topic-sort-tabs" aria-label="${isProduct ? "产品讨论" : "话题动态"}排序"><button class="active" type="button" data-topic-sort="dateline_desc">最新发布</button><button type="button" data-topic-sort="lastupdate_desc">最近回复</button><button type="button" data-topic-sort="popular">热门内容</button></nav>
      <section class="detail-section"><header class="comments-head"><h3 id="topicFeedHeading">最新发布</h3><span id="topicPageStatus">第 1 页</span></header><div id="topicFeedRegion">${feedStream(payload.feeds, { compact: true })}</div><div class="load-more"><button class="btn secondary" type="button" data-topic-load-more ${payload.feeds?.length ? "" : "disabled"}><i class="ph ph-plus-circle"></i>加载更多动态</button></div></section>`;
  } catch (error) {
    if (requestId !== state.detailRequests.topic) return;
    topicDialogBody.innerHTML = emptyState("warning-circle", "话题详情加载失败", error.message);
  }
}

async function loadTopicContent(sort = state.topicDetail.sort, { append = false } = {}) {
  const region = $("#topicFeedRegion");
  const more = $("[data-topic-load-more]");
  if (!region || !state.topicDetail.source) return;
  const requestId = ++state.detailRequests.topic;
  const nextPage = append && sort === state.topicDetail.sort ? state.topicDetail.page + 1 : 1;
  $$("[data-topic-sort]", topicDialogBody).forEach((button) => {
    const active = button.dataset.topicSort === sort;
    button.classList.toggle("active", active);
    button.disabled = true;
  });
  if (!append) {
    region.classList.add("is-refreshing");
    region.setAttribute("aria-busy", "true");
  }
  if (more) {
    delete more.dataset.retrySort;
    delete more.dataset.retryAppend;
    more.disabled = true;
    more.innerHTML = `<i class="ph ph-circle-notch"></i>正在加载`;
  }
  try {
    const payload = await api(`/api/web/topics/${encodeURIComponent(state.topicDetail.source)}?page=${nextPage}&sort=${encodeURIComponent(sort)}`);
    if (requestId !== state.detailRequests.topic || !topicDialog.open) return;
    const previousCount = state.topicDetail.feeds.length;
    const feeds = append
      ? [...new Map([...state.topicDetail.feeds, ...(payload.feeds || [])].map((feed) => [String(feed.id), feed])).values()]
      : payload.feeds || [];
    const addedCount = append ? feeds.length - previousCount : feeds.length;
    state.topicDetail = { ...state.topicDetail, sort, page: nextPage, feeds, requestId };
    region.innerHTML = feedStream(feeds, { compact: true });
    const labels = { dateline_desc: "最新发布", lastupdate_desc: "最近回复", popular: "热门内容" };
    $("#topicFeedHeading").textContent = labels[sort] || "话题动态";
    $("#topicPageStatus").textContent = `第 ${nextPage} 页 · ${feeds.length} 条`;
    if (more) {
      more.disabled = addedCount <= 0;
      more.innerHTML = more.disabled
        ? `<i class="ph ph-check"></i>没有更多动态`
        : `<i class="ph ph-plus-circle"></i>加载更多动态`;
    }
  } catch (error) {
    if (requestId !== state.detailRequests.topic) return;
    if (!append) {
      $$("[data-topic-sort]", topicDialogBody).forEach((button) => {
        button.classList.toggle("active", button.dataset.topicSort === state.topicDetail.sort);
      });
    }
    toast(error.message, "error");
    if (more) {
      more.disabled = false;
      more.dataset.retrySort = sort;
      more.dataset.retryAppend = append ? "1" : "0";
      more.innerHTML = `<i class="ph ph-arrow-clockwise"></i>重新加载`;
    }
  } finally {
    if (requestId === state.detailRequests.topic) {
      region.classList.remove("is-refreshing");
      region.removeAttribute("aria-busy");
      $$("[data-topic-sort]", topicDialogBody).forEach((button) => { button.disabled = false; });
    }
  }
}

async function openUser(uid) {
  if (!uid) {
    toast("该动态没有提供可用的用户 UID", "error");
    return;
  }
  const requestId = ++state.detailRequests.user;
  userDialogBody.scrollTop = 0;
  userDialogBody.innerHTML = `<div class="dialog-loading"><i class="ph ph-circle-notch"></i><span>正在读取用户公开主页…</span></div>`;
  showDialog(userDialog);
  try {
    const [payload, remoteFeeds] = await Promise.all([
      api(`/api/users/${encodeURIComponent(uid)}`),
      api(`/api/users/${encodeURIComponent(uid)}/feeds?branch=feed&page=1`).catch(() => ({ feeds: [] })),
    ]);
    if (requestId !== state.detailRequests.user || !userDialog.open) return;
    const profile = payload.profile;
    const feeds = remoteFeeds.feeds?.length ? remoteFeeds.feeds : payload.localFeeds || [];
    const ownProfile = String(profile.uid) === String(state.account?.uid);
    const tabs = [["feed", "动态"], ["htmlFeed", "文章"], ["questionAndAnswer", "问答"], ["collections", "收藏"], ["followList", "关注"], ["fansList", "粉丝"]];
    userDialogBody.innerHTML = `<section class="user-detail-hero">${profile.avatar ? imageMarkup(profile.avatar, { alt: profile.username, width: 192, quality: 78 }) : `<span><i class="ph ph-user"></i></span>`}<h2>${escapeHtml(profile.username)}</h2><p>${escapeHtml(profile.bio || profile.verifyLabel || `UID ${profile.uid}`)}</p><div class="profile-stats"><span><strong>${compactNumber(profile.followers)}</strong><small>粉丝</small></span><span><strong>${compactNumber(profile.following)}</strong><small>关注</small></span><span><strong>${compactNumber(profile.feeds)}</strong><small>动态</small></span><span><strong>${compactNumber(profile.likes)}</strong><small>获赞</small></span></div>${!ownProfile ? `<button class="btn ${profile.followed ? "secondary active" : "primary"}" style="margin-top:16px" type="button" data-user-follow="${escapeHtml(profile.uid)}" data-followed="${profile.followed ? "1" : "0"}"><i class="ph ph-${profile.followed ? "check" : "user-plus"}"></i>${profile.followed ? "已关注" : "关注"}</button>` : ""}</section><nav class="detail-tabs" aria-label="用户主页内容">${tabs.map(([key, label], index) => `<button class="${index === 0 ? "active" : ""}" type="button" data-user-section="${key}" data-user-section-uid="${escapeHtml(profile.uid)}">${label}</button>`).join("")}</nav><section class="detail-section" id="userSectionRegion"><h3>${remoteFeeds.feeds?.length ? "最新动态" : "本站已归档动态"}</h3>${feedStream(feeds, { compact: true })}</section>`;
  } catch (error) {
    if (requestId !== state.detailRequests.user) return;
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
      let sectionFeeds = payload.feeds || [];
      if (section === "feed" && !sectionFeeds.length) {
        const profilePayload = await api(`/api/users/${encodeURIComponent(uid)}`);
        sectionFeeds = profilePayload.localFeeds || [];
      }
      content = feedStream(sectionFeeds, { compact: true });
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
  const requestId = ++state.detailRequests.collection;
  collectionDialogBody.scrollTop = 0;
  collectionDialogBody.innerHTML = `<div class="dialog-loading"><i class="ph ph-circle-notch"></i><span>正在读取收藏单…</span></div>`;
  showDialog(collectionDialog);
  try {
    const payload = await api(`/api/collections/${encodeURIComponent(id)}?page=1`);
    if (requestId !== state.detailRequests.collection || !collectionDialog.open) return;
    const item = payload.collection;
    collectionDialogBody.innerHTML = `<section class="collection-detail-hero">${item.cover ? imageMarkup(item.cover, { width: 360, quality: 78 }) : `<span><i class="ph ph-bookmarks"></i></span>`}<div><small>酷安收藏单</small><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(stripHtml(item.description || item.subtitle || ""))}</p><div class="detail-actions"><button class="btn ${item.followed ? "secondary active" : "primary"}" type="button" data-collection-action="${escapeHtml(item.id)}" data-action="follow" data-enabled="${item.followed ? "1" : "0"}"><i class="ph ph-user-plus"></i>${item.followed ? "已关注" : "关注收藏单"}</button><button class="btn secondary ${item.liked ? "active" : ""}" type="button" data-collection-action="${escapeHtml(item.id)}" data-action="like" data-enabled="${item.liked ? "1" : "0"}"><i class="ph ph-thumbs-up"></i>${item.liked ? "已赞" : "点赞"}</button></div></div></section>${payload.feeds?.length ? `<section class="detail-section"><h3>收藏动态</h3>${feedStream(payload.feeds, { compact: true })}</section>` : ""}${payload.apps?.length ? `<section class="detail-section"><h3>收藏应用</h3>${appGrid(payload.apps)}</section>` : ""}`;
  } catch (error) {
    if (requestId !== state.detailRequests.collection) return;
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

function lightboxGallery(url, trigger) {
  const group = trigger?.dataset.imageGroup;
  const registered = group ? state.imageGroups.get(group) : null;
  const container = trigger?.closest(".feed-images, .screenshots, .comment");
  const discovered = container ? $$("[data-image]", container).map((item) => item.dataset.image) : [];
  const values = registered?.length ? registered : discovered.length ? discovered : [url];
  return [...new Set(values.map(String).map((item) => safeUrl(item)).filter(Boolean))];
}

function cssPixels(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
}

function syncLightboxFit() {
  const style = getComputedStyle(lightboxStage);
  const width = Math.max(
    1,
    lightboxStage.clientWidth - cssPixels(style.paddingLeft) - cssPixels(style.paddingRight),
  );
  const height = Math.max(
    1,
    lightboxStage.clientHeight - cssPixels(style.paddingTop) - cssPixels(style.paddingBottom),
  );
  state.lightbox.fitWidth = width;
  state.lightbox.fitHeight = height;
  lightboxImage.style.setProperty("--lightbox-fit-width", `${width}px`);
  lightboxImage.style.setProperty("--lightbox-fit-height", `${height}px`);
  return { width, height };
}

function preferredLightboxWidth() {
  const { width } = syncLightboxFit();
  const desired = width * Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
  return [960, 1280, 1600, 1920].find((candidate) => candidate >= desired) || 1920;
}

function lightboxSourceVariant(original, width) {
  const variant = { width, quality: width >= 1920 ? 88 : 84, format: "webp" };
  return {
    src: imageUrl(original, variant),
    originFallback: imageUrl(original, { ...variant, origin: true }),
  };
}

function resetLightboxTransform() {
  state.lightbox.zoom = 1;
  state.lightbox.x = 0;
  state.lightbox.y = 0;
  state.lightbox.dragging = false;
  state.lightbox.swipeStart = null;
  state.lightbox.pointers = new Map();
  state.lightbox.pinchDistance = 0;
  state.lightbox.pinchZoom = 1;
  lightboxStage.classList.remove("dragging");
}

function renderLightboxThumbs() {
  const item = state.lightbox;
  $("#lightboxThumbs").innerHTML = item.sources.length > 1
    ? item.sources.map((source, index) => `<button class="${index === item.index ? "active" : ""}" type="button" data-lightbox-index="${index}" aria-label="查看第 ${index + 1} 张图片">${imageMarkup(source, { width: 192, quality: 72 })}</button>`).join("")
    : "";
  $(".lightbox-footer", lightbox).classList.toggle("single", item.sources.length <= 1);
  requestAnimationFrame(() => $("[data-lightbox-index].active", $("#lightboxThumbs"))?.scrollIntoView({ block: "nearest", inline: "center" }));
}

function loadLightboxImage(index = state.lightbox.index) {
  const item = state.lightbox;
  if (!item.sources.length) return;
  item.index = (Number(index) + item.sources.length) % item.sources.length;
  resetLightboxTransform();
  const original = item.sources[item.index];
  item.requestWidth = preferredLightboxWidth();
  item.upgrading = false;
  item.upgradeToken = Symbol("lightbox-image");
  const { src, originFallback } = lightboxSourceVariant(original, item.requestWidth);
  $("#lightboxCounter").textContent = `${item.index + 1} / ${item.sources.length}`;
  $("#lightboxOriginal").href = safeUrl(original) || src;
  $("#lightboxPrevious").disabled = item.sources.length <= 1;
  $("#lightboxNext").disabled = item.sources.length <= 1;
  $("#lightboxLoading").hidden = false;
  $("#lightboxError").hidden = true;
  lightboxImage.classList.remove("ready");
  lightboxImage.style.visibility = "visible";
  lightboxImage.dataset.imageOriginFallback = originFallback;
  delete lightboxImage.dataset.imageOriginRetried;
  lightboxImage.alt = `${item.caption}，第 ${item.index + 1} 张`;
  syncLightboxFit();
  lightboxImage.src = src;
  renderLightboxThumbs();
  updateLightbox();
}

function openLightbox(url, caption = "查看图片", trigger = null) {
  const sources = lightboxGallery(url, trigger);
  if (!sources.length) return;
  const requestedIndex = Number(trigger?.dataset.imageIndex);
  const matchedIndex = sources.indexOf(safeUrl(url));
  state.lightbox = {
    sources,
    index: Number.isInteger(requestedIndex) && requestedIndex >= 0 ? requestedIndex : Math.max(0, matchedIndex),
    caption: caption || "查看图片",
    zoom: 1,
    x: 0,
    y: 0,
    dragging: false,
    startX: 0,
    startY: 0,
    swipeStart: null,
    pointers: new Map(),
    pinchDistance: 0,
    pinchZoom: 1,
    fitWidth: 1,
    fitHeight: 1,
    requestWidth: 960,
    upgrading: false,
    upgradeToken: null,
  };
  $("#lightboxCaption").textContent = state.lightbox.caption;
  showDialog(lightbox);
  syncLightboxFit();
  loadLightboxImage(state.lightbox.index);
}

function clampLightboxPan() {
  const item = state.lightbox;
  if (item.zoom <= 1) {
    item.x = 0;
    item.y = 0;
    return;
  }
  const viewportWidth = Math.max(1, Number(item.fitWidth) || lightboxStage.clientWidth);
  const viewportHeight = Math.max(1, Number(item.fitHeight) || lightboxStage.clientHeight);
  const maxX = Math.max(0, (lightboxImage.clientWidth * item.zoom - viewportWidth) / 2);
  const maxY = Math.max(0, (lightboxImage.clientHeight * item.zoom - viewportHeight) / 2);
  item.x = Math.max(-maxX, Math.min(maxX, item.x));
  item.y = Math.max(-maxY, Math.min(maxY, item.y));
}

function updateLightbox() {
  const item = state.lightbox;
  clampLightboxPan();
  lightboxImage.style.transform = `translate3d(${item.x}px, ${item.y}px, 0) scale(${item.zoom})`;
  $("#zoomReset").textContent = item.zoom === 1 ? "适合屏幕" : `${Math.round(item.zoom * 100)}%`;
  $("#zoomOut").disabled = item.zoom <= 1;
  $("#zoomIn").disabled = item.zoom >= 5;
  lightboxStage.classList.toggle("zoomed", item.zoom > 1);
}

function upgradeLightboxImageIfNeeded() {
  const item = state.lightbox;
  if (item.zoom < 1.4 || item.requestWidth >= 1920 || item.upgrading || !item.sources.length) return;
  item.upgrading = true;
  const index = item.index;
  const token = Symbol("lightbox-upgrade");
  item.upgradeToken = token;
  const original = item.sources[item.index];
  const { src, originFallback } = lightboxSourceVariant(original, 1920);
  const candidate = new Image();
  candidate.decoding = "async";
  const applyUpgrade = (selectedSrc, usedOriginFallback = false) => {
    if (!lightbox.open || state.lightbox.upgradeToken !== token || state.lightbox.index !== index) return;
    state.lightbox.upgrading = false;
    if (state.lightbox.zoom < 1.4) return;
    state.lightbox.requestWidth = 1920;
    lightboxImage.dataset.imageOriginFallback = originFallback;
    if (usedOriginFallback) lightboxImage.dataset.imageOriginRetried = "1";
    else delete lightboxImage.dataset.imageOriginRetried;
    lightboxImage.src = selectedSrc;
  };
  candidate.addEventListener("load", () => applyUpgrade(candidate.src, candidate.src.includes("__origin=1")), { once: true });
  candidate.addEventListener("error", () => {
    const stillRelevant = lightbox.open
      && state.lightbox.upgradeToken === token
      && state.lightbox.index === index
      && state.lightbox.zoom >= 1.4;
    if (!stillRelevant) {
      if (state.lightbox.upgradeToken === token) state.lightbox.upgrading = false;
      return;
    }
    if (candidate.src.includes("__origin=1")) {
      if (state.lightbox.upgradeToken === token) state.lightbox.upgrading = false;
      return;
    }
    candidate.src = originFallback;
  });
  candidate.src = src;
}

function setZoom(value) {
  state.lightbox.zoom = Math.max(1, Math.min(5, Number(value) || 1));
  if (state.lightbox.zoom === 1) {
    state.lightbox.x = 0;
    state.lightbox.y = 0;
  }
  updateLightbox();
  upgradeLightboxImageIfNeeded();
}

function stepLightbox(direction) {
  if (state.lightbox.sources.length <= 1) return;
  loadLightboxImage(state.lightbox.index + direction);
}

function pointerDistance(points) {
  const [first, second] = [...points.values()];
  return first && second ? Math.hypot(second.x - first.x, second.y - first.y) : 0;
}

function isCoolapkPageTarget(value) {
  const target = String(value || "").trim();
  return [
    /^#\/feed\/(?:digestList|multiTagFeedList|headlineV8List|coolPictureList|ershouList|mediaList|targetFeedList)(?:\?|$)/,
    /^#\/topic\/(?:hotTagList|tagList|userFollowTagList)(?:\?|$)/,
    /^#\/product\/unreleasedProductList(?:\?|$)/,
    /^#\/article\/(?:articlesList|includeFeedList)(?:\?|$)/,
    /^#\/apk\/(?:apkStatList|appList|realRankList)(?:\?|$)/,
    /^\/apk\/(?:category|categoryList|recommendList|updateList)(?:\?|$)/,
    /^\/product\/(?:categoryList|categoryDetailList)(?:\?|$)/,
  ].some((pattern) => pattern.test(target));
}

function openChannelPage(source, title = "酷安专题") {
  location.hash = `#/channel?source=${encodeURIComponent(source)}&title=${encodeURIComponent(title || "酷安专题")}`;
}

function handleSmartLink(value, trigger = null) {
  const link = String(value || "").trim();
  const linkTitle = String(trigger?.dataset?.linkTitle || trigger?.textContent || "酷安内容").trim().replace(/\s+/g, " ").slice(0, 80);
  if (!link) {
    toast("该入口暂时没有可用链接", "error");
    return;
  }
  if (link.startsWith("channel:")) {
    const channel = link.slice(8);
    if (!HOME_CHANNELS.some((item) => item.key === channel)) {
      toast("该内容频道暂未接入", "error");
      return;
    }
    if (state.route === "home") loadHomeChannel(channel);
    else location.hash = `#/home?channel=${encodeURIComponent(channel)}`;
    return;
  }
  if (/^[A-Za-z][A-Za-z0-9_]{2,99}$/.test(link)) {
    openChannelPage(link, linkTitle);
    return;
  }
  if (/^searchSpot:\/\/ershou/i.test(link)) {
    location.hash = `#/search?q=${encodeURIComponent(linkTitle || "二手")}`;
    return;
  }

  // Coolapk occasionally returns an in-app hash route instead of a regular URL.
  // Resolve its page payload here before the generic local-route branch.
  let normalizedLink = link;
  if (/^#\/page(?:\?|$)/.test(normalizedLink)) normalizedLink = normalizedLink.slice(1);
  if (normalizedLink.startsWith("#/")) {
    const routeName = normalizedLink.slice(2).split(/[/?]/)[0];
    if (["home", "discover", "apps", "topics", "notifications", "account", "monitor", "ai", "settings", "search", "channel"].includes(routeName)) {
      location.hash = normalizedLink;
    } else if (isCoolapkPageTarget(normalizedLink)) {
      openChannelPage(normalizedLink, linkTitle);
    } else {
      toast(`“${linkTitle}”尚未提供可识别的站内页面`, "error");
    }
    return;
  }

  let parsed;
  try {
    parsed = new URL(normalizedLink, location.origin);
  } catch {
    toast(`“${linkTitle}”的链接格式无效`, "error");
    return;
  }
  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  if (path === "/feed/writer") {
    const tag = parsed.searchParams.get("tag");
    openComposer("feed");
    if (state.account?.configured && tag) {
      const textarea = $("#composeMessage");
      textarea.value = `#${tag}# `;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return;
  }
  const pageKey = parsed.searchParams.get("url");
  if ((path === "/page" || path === "/") && pageKey) {
    if (isCoolapkPageTarget(pageKey)) {
      openChannelPage(pageKey, linkTitle);
      return;
    }
    if (!/^[A-Za-z][A-Za-z0-9_]{2,99}$/.test(pageKey)) {
      toast(`“${linkTitle}”的页面标识无效`, "error");
      return;
    }
    const channel = PAGE_CHANNELS[pageKey];
    if (channel === "topics" || channel === "apps") {
      location.hash = `#/${channel}`;
    } else if (channel && HOME_CHANNELS.some((item) => item.key === channel)) {
      if (state.route === "home") loadHomeChannel(channel);
      else location.hash = `#/home?channel=${encodeURIComponent(channel)}`;
    } else {
      openChannelPage(pageKey, linkTitle);
    }
    return;
  }

  const relativeTarget = `${path}${parsed.search}`;
  if (isCoolapkPageTarget(relativeTarget)) {
    openChannelPage(relativeTarget, linkTitle);
    return;
  }
  const topic = path.match(/^\/t\/(.+)/);
  if (topic) return openTopic(`topic:${decodeURIComponent(topic[1])}`);
  const product = path.match(/^\/product\/([^/]+)/);
  if (product) return openTopic(`product:${decodeURIComponent(product[1])}`);
  const feed = path.match(/^\/feed\/(\d+)/);
  if (feed) return openFeed(feed[1]);
  const user = path.match(/^\/u\/([^/]+)/);
  if (user) return openUser(decodeURIComponent(user[1]));
  const collection = path.match(/^\/collection\/([^/]+)/);
  if (collection) return openCollection(decodeURIComponent(collection[1]));
  const app = path.match(/^\/(?:apk|game)\/(.+)/);
  if (app) {
    const appKey = decodeURIComponent(app[1]);
    if (/^\d+$/.test(appKey)) return openApp(appKey);
    location.hash = `#/search?q=${encodeURIComponent(appKey)}`;
    toast(`正在站内搜索“${linkTitle || appKey}”`);
    return;
  }
  toast(`“${linkTitle}”暂未匹配到可用的站内页面`, "error");
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button, a");
  if (!target) return;
  if (target.matches("[data-close]")) closeDialog($(`#${target.dataset.close}`));
  if (target.matches("[data-retry], [data-route-refresh]")) route({ force: true });
  if (target.matches("[data-home-channel]")) loadHomeChannel(target.dataset.homeChannel);
  if (target.matches("[data-hero-index]")) target.closest("#heroCarousel")?._showSlide?.(Number(target.dataset.heroIndex));
  if (target.matches("[data-smart-link]")) {
    event.preventDefault();
    handleSmartLink(target.dataset.smartLink, target);
  }
  if (target.matches("[data-home-load-more]") && !target.disabled) loadHomeChannel(state.home.channel, { append: true, updateUrl: false });
  if (target.matches("[data-home-retry]")) loadHomeChannel(state.home.channel, { force: true, updateUrl: false });
  if (target.matches("[data-channel-load-more]") && !target.disabled) loadMoreChannelPage();
  if (target.matches("[data-topic-sort]") && !target.disabled) loadTopicContent(target.dataset.topicSort);
  if (target.matches("[data-topic-load-more]") && !target.disabled) {
    const retrySort = target.dataset.retrySort;
    loadTopicContent(retrySort || state.topicDetail.sort, {
      append: retrySort ? target.dataset.retryAppend === "1" : true,
    });
  }
  if (target.matches("[data-feed]")) openFeed(target.dataset.feed);
  if (target.matches("[data-app]")) openApp(target.dataset.app);
  if (target.matches("[data-public-topic]")) openTopic(target.dataset.publicTopic);
  if (target.matches("[data-user]")) openUser(target.dataset.user);
  if (target.matches("[data-user-section]")) loadUserSection(target);
  if (target.matches("[data-collection]")) openCollection(target.dataset.collection);
  if (target.matches("[data-image]")) openLightbox(target.dataset.image, target.dataset.caption, target);
  if (target.matches("[data-lightbox-index]")) loadLightboxImage(Number(target.dataset.lightboxIndex));
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
  if (target.matches("[data-search-page]") && !target.disabled) {
    const q = (state.routeParams.get("q") || "").trim();
    const page = Math.max(1, Math.min(50, Number(target.dataset.searchPage) || 1));
    location.hash = `#/search?q=${encodeURIComponent(q)}&page=${page}`;
  }
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
      state.pageCache.clear();
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
$("#globalSearchInput").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const keyword = event.currentTarget.value.trim();
  if (keyword) location.hash = `#/search?q=${encodeURIComponent(keyword)}`;
});

$("#mobileMenu").addEventListener("click", (event) => {
  const open = document.body.classList.toggle("mobile-rail-open");
  event.currentTarget.setAttribute("aria-expanded", String(open));
});
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
  const toggle = $("#themeToggle");
  toggle.innerHTML = `<i class="ph ph-${theme === "dark" ? "sun" : "moon"}"></i>`;
  toggle.setAttribute("aria-label", theme === "dark" ? "切换浅色模式" : "切换深色模式");
  toggle.title = theme === "dark" ? "切换浅色模式" : "切换深色模式";
  const menuToggle = $('[data-header-action="theme"]');
  if (menuToggle) {
    menuToggle.innerHTML = `<i class="ph ph-${theme === "dark" ? "sun" : "moon"}" aria-hidden="true"></i><span>${theme === "dark" ? "浅色模式" : "深色模式"}</span>`;
    menuToggle.setAttribute("aria-label", theme === "dark" ? "切换浅色模式" : "切换深色模式");
  }
  localStorage.setItem("coolweb:theme", theme);
}

$("#themeToggle").addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
$("#composeTrigger").addEventListener("click", () => openComposer("feed"));
accessDialog?.addEventListener("cancel", (event) => {
  if (state.access.enabled && !state.access.authenticated) event.preventDefault();
});
accessForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const tokenInput = $("#accessToken");
  const submit = $("#accessSubmit");
  const status = $("#accessStatus");
  const token = tokenInput?.value || "";
  if (!token.trim()) {
    status.textContent = "请输入访问口令";
    tokenInput?.focus();
    return;
  }
  submit.disabled = true;
  status.textContent = "正在验证…";
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `验证失败（HTTP ${response.status}）`);
    state.access.enabled = Boolean(payload.enabled);
    state.access.authenticated = Boolean(payload.authenticated);
    status.textContent = "";
    tokenInput.value = "";
    accessDialog.close();
    state.access.waiters.splice(0).forEach((resolve) => resolve());
    if (state.access.initialized) {
      await loadBaseState().catch(() => updateChrome(true));
      await route({ force: true });
    }
  } catch (error) {
    status.textContent = error.message;
    tokenInput?.select();
  } finally {
    submit.disabled = false;
  }
});
$$("[data-header-action]").forEach((button) => {
  button.addEventListener("click", async () => {
    const action = button.dataset.headerAction;
    const headerMore = $(".header-more");
    if (headerMore) headerMore.open = false;
    if (action === "compose") openComposer("feed");
    if (action === "theme") applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    if (action === "refresh") {
      button.classList.add("loading");
      try {
        await route({ force: true });
      } finally {
        button.classList.remove("loading");
      }
    }
    if (action === "lock") {
      try {
        const payload = await api("/api/auth/logout", { method: "POST" });
        state.access.enabled = Boolean(payload.enabled);
        state.access.authenticated = Boolean(payload.authenticated);
        if (state.access.enabled && !state.access.authenticated) showAccessGate("网站已锁定");
        else toast("服务器未启用访问口令");
      } catch (error) {
        toast(error.message, "error");
      }
    }
  });
});
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
$("#lightboxPrevious").addEventListener("click", () => stepLightbox(-1));
$("#lightboxNext").addEventListener("click", () => stepLightbox(1));
$("#lightboxRetry").addEventListener("click", () => {
  loadLightboxImage(state.lightbox.index);
});
lightboxImage.addEventListener("load", () => {
  $("#lightboxLoading").hidden = true;
  $("#lightboxError").hidden = true;
  lightboxImage.style.visibility = "visible";
  lightboxImage.classList.add("ready");
  syncLightboxFit();
  updateLightbox();
});
lightboxImage.addEventListener("error", () => {
  if (retryImageAtOrigin(lightboxImage)) {
    $("#lightboxLoading").hidden = false;
    $("#lightboxError").hidden = true;
    return;
  }
  $("#lightboxLoading").hidden = true;
  $("#lightboxError").hidden = false;
  lightboxImage.classList.remove("ready");
});
lightboxStage.addEventListener("wheel", (event) => {
  event.preventDefault();
  setZoom(state.lightbox.zoom + (event.deltaY < 0 ? .2 : -.2));
}, { passive: false });
lightboxStage.addEventListener("pointerdown", (event) => {
  const item = state.lightbox;
  item.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (item.pointers.size === 1) {
    item.swipeStart = { x: event.clientX, y: event.clientY, time: Date.now() };
    item.dragging = item.zoom > 1;
    item.startX = event.clientX - item.x;
    item.startY = event.clientY - item.y;
  } else if (item.pointers.size === 2) {
    item.pinchDistance = pointerDistance(item.pointers);
    item.pinchZoom = item.zoom;
    item.dragging = false;
  }
  lightboxStage.classList.toggle("dragging", item.dragging);
  lightboxStage.setPointerCapture(event.pointerId);
});
lightboxStage.addEventListener("pointermove", (event) => {
  const item = state.lightbox;
  if (!item.pointers.has(event.pointerId)) return;
  item.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (item.pointers.size === 2) {
    const distance = pointerDistance(item.pointers);
    if (item.pinchDistance > 0) setZoom(item.pinchZoom * (distance / item.pinchDistance));
    return;
  }
  if (item.dragging && item.zoom > 1) {
    item.x = event.clientX - item.startX;
    item.y = event.clientY - item.startY;
    updateLightbox();
  }
});
function releaseLightboxPointer(event, cancelled = false) {
  const item = state.lightbox;
  const start = item.swipeStart;
  const wasSinglePointer = item.pointers.size === 1;
  item.pointers.delete(event.pointerId);
  if (!cancelled && wasSinglePointer && item.zoom === 1 && start) {
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    const elapsed = Date.now() - start.time;
    if (elapsed < 700 && Math.abs(deltaX) > 65 && Math.abs(deltaY) < 70) stepLightbox(deltaX < 0 ? 1 : -1);
  }
  if (item.pointers.size === 1) {
    const remaining = [...item.pointers.values()][0];
    item.startX = remaining.x - item.x;
    item.startY = remaining.y - item.y;
    item.dragging = item.zoom > 1;
  } else if (item.pointers.size === 0) {
    item.dragging = false;
    item.swipeStart = null;
  }
  item.pinchDistance = 0;
  item.pinchZoom = item.zoom;
  lightboxStage.classList.toggle("dragging", item.dragging);
}
lightboxStage.addEventListener("pointerup", (event) => {
  releaseLightboxPointer(event);
});
lightboxStage.addEventListener("pointercancel", (event) => {
  releaseLightboxPointer(event, true);
});
lightboxStage.addEventListener("lostpointercapture", (event) => {
  if (!state.lightbox.pointers.has(event.pointerId)) return;
  releaseLightboxPointer(event, true);
});
lightbox.addEventListener("close", () => {
  state.lightbox.pointers.clear();
  state.lightbox.dragging = false;
  lightboxStage.classList.remove("dragging");
});
lightboxStage.addEventListener("dblclick", () => setZoom(state.lightbox.zoom === 1 ? 2 : 1));

document.addEventListener("error", (event) => {
  if (event.target instanceof HTMLImageElement) {
    if (event.target === lightboxImage || retryImageAtOrigin(event.target)) return;
    event.target.style.visibility = "hidden";
    event.target.closest("button, .app-card, .topic-card-logo")?.classList.add("image-error");
  }
}, true);

window.addEventListener("hashchange", () => route());
window.addEventListener("resize", () => {
  if (lightbox.open) {
    syncLightboxFit();
    updateLightbox();
  }
});
window.visualViewport?.addEventListener("resize", () => {
  if (!lightbox.open) return;
  syncLightboxFit();
  updateLightbox();
});
window.addEventListener("keydown", (event) => {
  if (lightbox.open) {
    if (event.key === "ArrowLeft") stepLightbox(-1);
    else if (event.key === "ArrowRight") stepLightbox(1);
    else if (event.key === "+" || event.key === "=") setZoom(state.lightbox.zoom + .25);
    else if (event.key === "-") setZoom(state.lightbox.zoom - .25);
    else if (event.key === "0") setZoom(1);
    else return;
    event.preventDefault();
    return;
  }
  if ((event.key === "/" || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k"))
      && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    $("#globalSearchInput").focus();
  }
  if (event.key === "Escape") {
    document.body.classList.remove("mobile-rail-open");
    $("#mobileMenu")?.setAttribute("aria-expanded", "false");
    const headerMore = $(".header-more");
    if (headerMore) headerMore.open = false;
  }
});

async function initialize() {
  const searchHint = $(".global-search kbd");
  if (searchHint) searchHint.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K";
  const preferredTheme = localStorage.getItem("coolweb:theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(preferredTheme);
  if (localStorage.getItem("coolweb:rail-collapsed") === "1") document.body.classList.add("rail-collapsed");
  if (!location.hash) history.replaceState(null, "", "#/home");
  await ensureAccess();
  const initialRoute = parseRoute().route;
  const publicRoutes = new Set(["home", "channel", "discover", "apps", "topics", "search"]);
  let baseStateSettled = false;
  const loadState = loadBaseState()
    .catch(() => updateChrome(true))
    .finally(() => {
      baseStateSettled = true;
    });
  if (initialRoute === "home") {
    await Promise.race([loadState, new Promise((resolve) => setTimeout(resolve, 900))]);
    await route();
    if (!baseStateSettled) {
      loadState.then(() => {
        if (parseRoute().route === "home" && state.route === "home") route();
      });
    }
  } else if (publicRoutes.has(initialRoute)) {
    await Promise.all([route(), loadState]);
  } else {
    await loadState;
    await route();
  }
  state.access.initialized = true;
}

initialize();
