const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const topicList = $("#topicList");
const feedList = $("#feedList");
const feedHeader = $("#feedHeader");
const feedCount = $("#feedCount");
const syncText = $("#syncText");
const statusDot = $(".status-dot");
const refreshAll = $("#refreshAll");
const detailDialog = $("#detailDialog");
const detailContent = $("#detailContent");
const detailTopicName = $("#detailTopicName");
const feedFilter = $("#feedFilter");
const searchForm = $("#searchForm");
const searchInput = $("#searchInput");
const dialogSearchForm = $("#dialogSearchForm");
const dialogSearchInput = $("#dialogSearchInput");
const searchResults = $("#searchResults");
const toastRegion = $("#toastRegion");
const ruleDialog = $("#ruleDialog");
const aiHistory = $("#aiHistory");
const lightbox = $("#lightbox");
const lightboxImage = $("#lightboxImage");
const lightboxStage = $("#lightboxStage");
const dashboardView = $("#dashboardView");
const exploreView = $("#exploreView");
const addView = $("#addView");
const aiView = $("#aiView");
const settingsView = $("#settingsView");
const breadcrumbCurrent = $("#breadcrumbCurrent");
const userDialog = $("#userDialog");
const userProfileContent = $("#userProfileContent");

let topics = [];
let evaluations = [];
let status = null;
let settingsSnapshot = null;
let archiveSnapshot = null;
let activeTopicTag = "";
let activeFeedId = "";
let activeDetail = null;
let historyFilter = "matched";
let feedFilterValue = "";
let feedAiFilter = "all";
let feedSortOrder = "created_desc";
let activeViewName = "dashboard";
let lightboxState = { zoom: 1, x: 0, y: 0, dragging: false, startX: 0, startY: 0 };
let activeExploreTab = "feeds";
let activeDiscoveryMode = "recent";
let discoveryLoaded = false;
let dashboardFeeds = [];
let dashboardFeedMeta = { total: 0, page: 1, pageSize: 20, totalPages: 1, hasPrevious: false, hasNext: false };
let evaluationStats = { total: 0, matched: 0, notified: 0, errors: 0 };
let historyEvaluations = [];
let historyMeta = { page: 1, pageSize: 50, total: 0, totalPages: 1 };
let feedLoadSequence = 0;
let historyLoadSequence = 0;
let feedFilterTimer = null;

const numberFormat = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
const dateTimeFormat = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const timeFormat = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

async function api(path, options) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function textOnly(html = "") {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return parsed.body.textContent?.replace(/\[[^\]]+\]/g, "").replace(/\s+/g, " ").trim() || "";
}

function imageUrl(url) {
  return url ? `/api/image?url=${encodeURIComponent(url)}` : "";
}

function avatar(url, alt, className = "") {
  if (!url) return `<span class="${className} feed-avatar-fallback"><i class="ph ph-user"></i></span>`;
  return `<img class="${className}" src="${escapeHtml(imageUrl(url))}" alt="${escapeHtml(alt)}" loading="lazy" />`;
}

function showDialog(dialog) {
  if (!dialog || dialog.open) return;
  try { dialog.showModal(); } catch { dialog.setAttribute("open", ""); }
}

function closeDialog(dialog) {
  if (!dialog?.open) return;
  try { dialog.close(); } catch { dialog.removeAttribute("open"); }
}

function toast(message, type = "") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  toastRegion.append(node);
  setTimeout(() => node.remove(), 3600);
}

const viewLabels = { dashboard: "动态看板", explore: "内容探索", add: "添加监控", ai: "AI 命中记录", settings: "系统设置" };

function showView(name) {
  const views = [dashboardView, exploreView, addView, aiView, settingsView];
  const next = views.find((view) => view?.dataset.view === name) || dashboardView;
  activeViewName = next.dataset.view;
  for (const view of views) {
    if (!view) continue;
    const active = view === next;
    view.hidden = !active;
    view.classList.toggle("active", active);
  }
  $$('[data-view-link]').forEach((button) => button.classList.toggle("active", button.dataset.viewLink === activeViewName));
  breadcrumbCurrent.textContent = viewLabels[activeViewName] || "监控中心";
  $(".crm-content").scrollTop = 0;
}

function activeTopic() {
  return topics.find((topic) => topic.tag === activeTopicTag) || topics[0] || null;
}

function evaluationFor(feedId) {
  const topicTag = arguments.length > 1 ? arguments[1] : activeTopicTag;
  return dashboardFeeds.find((feed) => String(feed.id) === String(feedId) && (feed.__monitorTopicTag || topicTag) === topicTag)?.evaluation
    || evaluations.find((item) => String(item.feedId) === String(feedId) && item.topic === topicTag)
    || null;
}

function evaluationMetric(evaluation) {
  if (!evaluation || evaluation.status === "error") return null;
  if (Number.isFinite(Number(evaluation.matchScore))) return { value: Number(evaluation.matchScore), label: "匹配度", legacy: false };
  if (Number.isFinite(Number(evaluation.confidence))) return { value: Number(evaluation.confidence), label: "旧版判定把握", legacy: true };
  return null;
}

function evaluationThreshold(evaluation) {
  const value = evaluation?.currentThreshold ?? evaluation?.threshold;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function fetchSortLabel(value) {
  return { dateline_desc: "最新发布", lastupdate_desc: "最近回复", popular: "互动热度" }[value] || "最新发布";
}

function displayFeedSort(left, right) {
  const leftEvaluation = evaluationFor(left.id, left.__monitorTopicTag || activeTopic()?.tag);
  const rightEvaluation = evaluationFor(right.id, right.__monitorTopicTag || activeTopic()?.tag);
  if (feedSortOrder === "created_asc") return new Date(left.createdAt || 0) - new Date(right.createdAt || 0);
  if (feedSortOrder === "updated_desc") return new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0);
  if (feedSortOrder === "popular_desc") {
    const score = (feed) => Number(feed.likes || 0) * 1_000 + Number(feed.comments || 0) * 20 + Number(feed.shares || 0) * 50;
    return score(right) - score(left);
  }
  if (feedSortOrder === "ai_desc") {
    const score = (evaluation) => {
      const metric = evaluationMetric(evaluation);
      if (!metric) return -1;
      if (metric.legacy && !evaluation.matched) return 0;
      return metric.value;
    };
    return score(rightEvaluation) - score(leftEvaluation);
  }
  return new Date(right.createdAt || 0) - new Date(left.createdAt || 0);
}

function shortTime(timestamp) {
  return timestamp ? timeFormat.format(new Date(timestamp)) : "时间未知";
}

function renderSidebar() {
  const totalFeeds = topics.reduce((sum, topic) => sum + Number(topic.archiveCount ?? topic.feeds?.length ?? 0), 0);
  topicList.innerHTML = `
    <button class="topic-item topic-item-all ${activeTopicTag === "__all__" ? "active" : ""}" type="button" data-topic="__all__">
      <span class="topic-item-label">全部话题</span><span class="topic-item-count">${totalFeeds}</span>
    </button>
    ${topics.map((topic) => {
      const topicMatches = topic.matchCount ?? evaluations.filter((item) => item.topic === topic.tag && item.matched).length;
      return `<button class="topic-item ${topic.tag === activeTopicTag ? "active" : ""}" type="button" data-topic="${escapeHtml(topic.tag)}" title="${escapeHtml(topic.tag)}">
        <i class="topic-bullet"></i><span class="topic-item-label">${escapeHtml(topic.detail?.title || topic.tag)}</span><span class="topic-item-count">${topicMatches ? `${topicMatches} 命中` : numberFormat.format(topic.archiveCount ?? topic.feeds?.length ?? 0)}</span>
      </button>`;
    }).join("")}`;
}

function renderMetrics() {
  const totalFeeds = topics.reduce((sum, topic) => sum + Number(topic.archiveCount ?? topic.feeds?.length ?? 0), 0);
  const matches = evaluationStats.matched ?? evaluations.filter((item) => item.matched).length;
  $("#metricTopics").textContent = numberFormat.format(topics.length);
  $("#metricFeeds").textContent = numberFormat.format(totalFeeds);
  $("#metricMatches").textContent = numberFormat.format(matches);
  $("#metricUpdated").textContent = status?.nextPollAt ? timeFormat.format(new Date(status.nextPollAt)) : "--:--";
  const archived = status?.archive?.feeds ?? archiveSnapshot?.feeds ?? 0;
  $("#metricFeedsHint").textContent = archived ? `监控范围 ${numberFormat.format(totalFeeds)} 条 · 全库 ${numberFormat.format(archived)} 条` : "当前监控归档";
  $("#archiveStatus").innerHTML = `<i class="ph ph-database"></i> 已归档 ${numberFormat.format(archived)} 条动态`;
}

function evaluationBadge(evaluation) {
  if (!evaluation) return "";
  if (evaluation.status === "error") return '<span class="ai-badge error" title="本次判断失败，系统会按退避时间自动重试"><i class="ph ph-warning"></i>等待重试</span>';
  const metric = evaluationMetric(evaluation);
  if (!metric) return '<span class="ai-badge waiting"><i class="ph ph-minus"></i>待判断</span>';
  const percentage = Math.round(metric.value * 100);
  if (metric.legacy) return `<span class="ai-badge ${evaluation.matched ? "" : "miss"}" title="旧记录保存的是模型对当时结论的把握度，不等同于匹配概率"><i class="ph ${evaluation.matched ? "ph-sparkle" : "ph-check"}"></i>${evaluation.matched ? "旧命中" : "旧未命中"} · ${percentage}%把握</span>`;
  return `<span class="ai-badge ${evaluation.matched ? "" : "miss"}" title="AI 自评的关注意图匹配程度；达到阈值后才算命中"><i class="ph ${evaluation.matched ? "ph-sparkle" : "ph-check"}"></i>${percentage}% 匹配</span>`;
}

function feedRow(feed) {
  const message = textOnly(feed.message);
  const title = textOnly(feed.title) || `${feed.username}的动态`;
  const picture = feed.pictures?.[0];
  const topicTag = feed.__monitorTopicTag || activeTopic()?.tag || "";
  const topicTitle = feed.__monitorTopicTitle || activeTopic()?.detail?.title || topicTag;
  const evaluation = evaluationFor(feed.id, topicTag);
  return `
    <button class="feed-row ${String(feed.id) === String(activeFeedId) ? "active" : ""}" type="button" data-feed-id="${feed.id}">
      <span class="feed-primary">
        ${avatar(feed.avatar, feed.username, "feed-avatar")}
        <span class="feed-copy">
          <strong>${escapeHtml(title)}</strong>
          <small><b>${escapeHtml(feed.username)}</b><i></i>${escapeHtml(message || "查看这条动态的完整内容")}</small>
        </span>
        ${picture ? `<img class="feed-thumb" data-lightbox src="${escapeHtml(imageUrl(picture))}" data-caption="${escapeHtml(title)}" alt="${escapeHtml(title)} 配图" loading="lazy" />` : ""}
      </span>
      <span class="table-topic"><i></i>#${escapeHtml(topicTitle || topicTag)}</span>
      <span class="table-metrics"><span><i class="ph ph-chat-circle"></i>${numberFormat.format(feed.comments)}</span><span><i class="ph ph-thumbs-up"></i>${numberFormat.format(feed.likes)}</span></span>
      <span class="table-ai">${evaluationBadge(evaluation) || '<span class="ai-badge waiting"><i class="ph ph-minus"></i>待判断</span>'}</span>
      <time class="table-time">${shortTime(feed.createdAt)}</time>
      <span class="row-action"><i class="ph ph-caret-right"></i></span>
    </button>`;
}

function renderFeedPagination() {
  $("#feedPageSize").value = String(dashboardFeedMeta.pageSize || 20);
  $("#feedPrevious").disabled = !dashboardFeedMeta.hasPrevious;
  $("#feedNext").disabled = !dashboardFeedMeta.hasNext;
  $("#feedPageLabel").textContent = `第 ${dashboardFeedMeta.page || 1} / ${dashboardFeedMeta.totalPages || 1} 页`;
}

function renderFeed() {
  const allView = activeTopicTag === "__all__";
  const topic = allView ? null : activeTopic();
  if (!topics.length) {
    feedHeader.innerHTML = '<div class="feed-heading"><h1>还没有监控话题</h1><p>搜索并添加一个话题开始监控</p></div><div class="feed-header-actions"><button type="button" data-open-search><i class="ph ph-plus"></i>添加话题</button></div>';
    feedList.innerHTML = '<div class="search-empty">点击顶部“添加监控话题”开始</div>';
    feedCount.textContent = "暂无动态";
    dashboardFeedMeta = { total: 0, page: 1, pageSize: dashboardFeedMeta.pageSize || 20, totalPages: 1, hasPrevious: false, hasNext: false };
    renderFeedPagination();
    return;
  }
  if (allView) {
    feedHeader.innerHTML = `
      <div class="feed-heading"><span class="feed-eyebrow">ALL WATCHES</span><h1>全部监控动态 <span class="live-label">归档</span></h1><p>${topics.length} 个话题 · 共 ${numberFormat.format(dashboardFeedMeta.total || 0)} 条可回溯动态</p></div>
      <div class="feed-header-actions"><button class="ai-rule-button active" type="button" data-open-search><i class="ph ph-plus"></i><span>添加监控</span></button></div>`;
  } else {
    const detail = topic.detail || { title: topic.tag };
    const aiActive = topic.ai?.enabled && topic.ai?.intent;
    feedHeader.innerHTML = `
      <div class="feed-heading"><span class="feed-eyebrow">ACTIVE WATCH</span><h1>${escapeHtml(detail.title || topic.tag)} <span class="live-label">监控中</span></h1><p>已归档 ${numberFormat.format(topic.archiveCount ?? dashboardFeedMeta.total ?? 0)} 条 · 本轮缓存 ${numberFormat.format(topic.currentFeedCount ?? topic.feeds?.length ?? 0)} 条 · 默认${fetchSortLabel(topic.fetch?.sort)}${aiActive ? " · AI 筛选已开启" : ""}</p></div>
      <div class="feed-header-actions">
        <button class="ai-rule-button ${aiActive ? "active" : ""}" type="button" id="openRule"><i class="ph ph-sparkle"></i><span>${aiActive ? "AI 规则" : "配置 AI"}</span></button>
        <button type="button" id="removeTopic" title="停止监控" aria-label="停止监控"><i class="ph ph-trash"></i><span>停止监控</span></button>
      </div>`;
  }
  const warning = !allView && topic.lastError
    ? `<div class="topic-warning"><i class="ph ph-warning"></i><span><strong>本次采集失败，正在展示已归档数据</strong><small>${escapeHtml(topic.lastError)}${topic.lastFetchedAt ? ` · 上次成功 ${dateTimeFormat.format(new Date(topic.lastFetchedAt))}` : ""}</small></span></div>`
    : "";
  feedList.innerHTML = warning + (dashboardFeeds.length ? dashboardFeeds.map(feedRow).join("") : '<div class="search-empty">当前筛选条件下没有归档动态</div>');
  const start = dashboardFeedMeta.total ? (dashboardFeedMeta.page - 1) * dashboardFeedMeta.pageSize + 1 : 0;
  const end = dashboardFeedMeta.total ? start + dashboardFeeds.length - 1 : 0;
  const filterLabel = feedFilterValue.trim() ? ` · 搜索“${feedFilterValue.trim()}”` : feedAiFilter === "matched" ? " · 仅 AI 命中" : "";
  feedCount.textContent = `显示 ${start}–${end} 条 / 共 ${numberFormat.format(dashboardFeedMeta.total || 0)} 条${filterLabel}`;
  renderFeedPagination();
}

function renderStatus() {
  if (!status) return;
  statusDot.classList.toggle("busy", status.refreshing || status.ai?.analyzing);
  if (status.ai?.analyzing) syncText.textContent = "AI 正在判断";
  else if (status.refreshing) syncText.textContent = "正在抓取";
  else syncText.textContent = "每 5 分钟更新";
  const failedTopics = topics.filter((topic) => topic.lastError);
  $("#dataSyncStatus").innerHTML = failedTopics.length
    ? `<i class="ph ph-warning"></i> ${failedTopics.length} 个话题等待重试`
    : '<i class="ph ph-check-circle"></i> 数据已同步';
  $("#dataSyncStatus").classList.toggle("has-error", Boolean(failedTopics.length));
}

function replyCard(reply) {
  const children = reply.replies?.length
    ? `<div class="child-replies">${reply.replies.map((item) => `<div class="child-reply"><strong>${escapeHtml(item.username)}</strong>${item.replyTo ? ` 回复 ${escapeHtml(item.replyTo)}` : ""}：${escapeHtml(textOnly(item.message))}</div>`).join("")}</div>`
    : "";
  return `<article class="reply">
    ${avatar(reply.avatar, reply.username, "reply-avatar")}
    <div class="reply-main">
      <div class="reply-name">${escapeHtml(reply.username)}${reply.isAuthor ? '<span class="author-pill">作者</span>' : ""}</div>
      <p class="reply-text">${escapeHtml(textOnly(reply.message))}</p>
      ${reply.picture ? `<div class="detail-pictures"><img data-lightbox src="${escapeHtml(imageUrl(reply.picture))}" data-caption="${escapeHtml(reply.username)}的评论配图" alt="${escapeHtml(reply.username)}的评论配图" loading="lazy" /></div>` : ""}
      <div class="reply-meta"><time>${reply.createdAt ? dateTimeFormat.format(new Date(reply.createdAt)) : "时间未知"}</time><span>赞 ${numberFormat.format(reply.likes)}</span>${reply.replyCount ? `<span>${reply.replyCount} 条回复</span>` : ""}</div>
      ${children}
    </div>
  </article>`;
}

function renderVerdict(evaluation, topicTag = activeTopicTag) {
  if (!evaluation) {
    const topic = topics.find((item) => item.tag === topicTag) || activeTopic();
    return topic?.ai?.enabled ? '<div class="ai-verdict miss"><div class="ai-verdict-head"><span><i class="ph ph-sparkle"></i> 等待 AI 判断</span></div><p>新抓取的帖子会自动按照当前话题的关注意图进行识别。</p></div>' : "";
  }
  if (evaluation.status === "error") {
    return `<div class="ai-verdict error"><div class="ai-verdict-head"><span><i class="ph ph-warning"></i> 判断失败，等待自动重试</span></div><p>${escapeHtml(evaluation.reason)}</p>${evaluation.nextRetryAt ? `<small class="ai-input-note"><i class="ph ph-clock"></i> 预计 ${dateTimeFormat.format(new Date(evaluation.nextRetryAt))} 后重试</small>` : ""}</div>`;
  }
  const stateClass = evaluation.status === "error" ? "error" : evaluation.matched ? "" : "miss";
  const label = evaluation.matched ? "符合关注意图" : "未达到匹配阈值";
  const metric = evaluationMetric(evaluation);
  const metricLabel = metric ? `${metric.label} ${Math.round(metric.value * 100)}%` : "暂无评分";
  const threshold = evaluationThreshold(evaluation);
  const thresholdLabel = threshold == null ? "" : ` · 当前阈值 ${Math.round(threshold * 100)}%`;
  return `<div class="ai-verdict ${stateClass}">
    <div class="ai-verdict-head"><span><i class="ph ph-sparkle"></i> ${label}</span><span>${metricLabel}${thresholdLabel}</span></div>
    <p>${escapeHtml(evaluation.reason)}</p>
    ${metric?.legacy ? '<small class="ai-input-note"><i class="ph ph-info"></i> 旧记录保存的是模型对结论的把握度；新记录统一显示关注意图匹配度</small>' : ""}
    ${evaluation.imageFallback ? '<small class="ai-input-note"><i class="ph ph-text-t"></i> 当前模型未接收图片输入，已按文本完成判断</small>' : ""}
    ${evaluation.compatibilityFallback ? '<small class="ai-input-note"><i class="ph ph-plugs-connected"></i> 该服务使用了兼容请求格式</small>' : ""}
    ${evaluation.evidence?.length ? `<div class="ai-evidence">${evaluation.evidence.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
  </div>`;
}

function renderDetail() {
  if (!activeDetail) return;
  const { feed, replies, page } = activeDetail;
  const evaluation = evaluationFor(feed.id, activeDetail.topicTag || feed.topic || activeTopicTag);
  detailContent.innerHTML = `
    <article>
      <div class="detail-author">
        ${avatar(feed.avatar, feed.username, "feed-avatar")}
        <div><strong>${escapeHtml(feed.username)}</strong><small>${feed.createdAt ? dateTimeFormat.format(new Date(feed.createdAt)) : "时间未知"}${feed.device ? ` · 来自 ${escapeHtml(feed.device)}` : ""}</small></div>
        ${feed.userId ? `<button class="follow-button" type="button" data-open-user="${escapeHtml(feed.userId)}"><i class="ph ph-user-circle"></i>用户主页</button>` : ""}
      </div>
      <h2 class="detail-title">${escapeHtml(textOnly(feed.title))}</h2>
      <p class="detail-message">${escapeHtml(textOnly(feed.message))}</p>
      ${feed.pictures?.length ? `<div class="detail-pictures">${feed.pictures.map((url, index) => `<img data-lightbox src="${escapeHtml(imageUrl(url))}" data-caption="动态配图 ${index + 1}" alt="动态配图 ${index + 1}" loading="lazy" />`).join("")}</div>` : ""}
      ${feed.topic ? `<span class="topic-tag"># ${escapeHtml(feed.topic)}</span>` : ""}
      <div class="detail-stats"><span><i class="ph ph-chat-circle"></i>${numberFormat.format(feed.replyCount)}</span><span><i class="ph ph-thumbs-up"></i>${numberFormat.format(feed.likes)}</span><span><i class="ph ph-star"></i>收藏</span><span><i class="ph ph-share-fat"></i>分享</span></div>
      ${renderVerdict(evaluation, activeDetail.topicTag || feed.topic)}
    </article>
    <section>
      <div class="replies-head"><h3>评论（${numberFormat.format(feed.replyCount)}）</h3><button class="sort-select" type="button">最热 <i class="ph ph-caret-down"></i></button></div>
      <div id="replyList">${replies.length ? replies.map(replyCard).join("") : '<div class="search-empty">还没有评论</div>'}</div>
      ${replies.length ? `<button class="load-more" type="button" data-load-page="${page + 1}">加载更多评论</button>` : ""}
    </section>`;
}

async function openDetail(id, optimisticFeed) {
  activeFeedId = String(id);
  renderFeed();
  const topicTag = optimisticFeed?.__monitorTopicTag || optimisticFeed?.topic || (activeTopicTag === "__all__" ? "" : activeTopic()?.tag || "");
  const topicTitle = optimisticFeed?.__monitorTopicTitle || topics.find((item) => item.tag === topicTag)?.detail?.title || topicTag;
  detailTopicName.textContent = topicTitle ? `#${topicTitle} · 完整内容与评论记录` : "完整内容与评论记录";
  showDialog(detailDialog);
  if (optimisticFeed) {
    activeDetail = { feed: { ...optimisticFeed, replyCount: optimisticFeed.comments, favorites: 0, topic: topicTag }, replies: [], page: 1, topicTag };
    renderDetail();
  } else detailContent.innerHTML = '<div class="detail-loading">正在获取详情和评论…</div>';
  try {
    activeDetail = { ...await api(`/api/feeds/${id}?page=1`), topicTag };
    renderDetail();
    history.replaceState(null, "", `#feed-${id}`);
  } catch (error) {
    if (!optimisticFeed) detailContent.innerHTML = `<div class="topic-error">${escapeHtml(error.message)}</div>`;
    else toast(`详情更新失败：${error.message}`, "error");
  }
}

function updateMatchCount() {
  const count = evaluationStats.matched ?? evaluations.filter((item) => item.matched).length;
  const badge = $("#matchCount");
  badge.hidden = !count;
  badge.textContent = String(Math.min(99, count));
}

async function loadFeedPage({ resetPage = false, showSkeleton = false, page = null, pageSize = null } = {}) {
  const targetPage = resetPage ? 1 : Math.max(1, Number(page ?? dashboardFeedMeta.page) || 1);
  const targetPageSize = Math.max(10, Number(pageSize ?? dashboardFeedMeta.pageSize) || 20);
  if (!topics.length) {
    dashboardFeeds = [];
    renderFeed();
    return;
  }
  const sequence = ++feedLoadSequence;
  if (showSkeleton) feedList.innerHTML = Array.from({ length: 7 }, () => '<div class="skeleton"></div>').join("");
  const params = new URLSearchParams({
    page: String(targetPage),
    pageSize: String(targetPageSize),
    sort: feedSortOrder,
    ai: feedAiFilter,
  });
  if (activeTopicTag && activeTopicTag !== "__all__") params.set("topic", activeTopicTag);
  if (feedFilterValue.trim()) params.set("q", feedFilterValue.trim());
  try {
    const payload = await api(`/api/dashboard/feeds?${params}`);
    if (sequence !== feedLoadSequence) return;
    dashboardFeeds = (payload.feeds || []).map((feed) => ({
      ...feed,
      __monitorTopicTag: feed.monitorTopicTag || activeTopicTag,
      __monitorTopicTitle: feed.monitorTopicTitle || topics.find((topic) => topic.tag === (feed.monitorTopicTag || activeTopicTag))?.detail?.title || feed.monitorTopicTag || activeTopicTag,
    }));
    dashboardFeedMeta = {
      total: payload.total || 0,
      page: payload.page || 1,
      pageSize: payload.pageSize || dashboardFeedMeta.pageSize || 20,
      totalPages: payload.totalPages || 1,
      hasPrevious: Boolean(payload.hasPrevious),
      hasNext: Boolean(payload.hasNext),
    };
    const pageEvaluations = dashboardFeeds.map((feed) => feed.evaluation).filter(Boolean);
    const pageKeys = new Set(pageEvaluations.map((item) => `${item.topic}\u0000${item.feedId}`));
    evaluations = [...pageEvaluations, ...evaluations.filter((item) => !pageKeys.has(`${item.topic}\u0000${item.feedId}`))];
    renderFeed();
  } catch (error) {
    if (sequence !== feedLoadSequence) return;
    feedList.innerHTML = `<div class="topic-error">归档列表加载失败：${escapeHtml(error.message)}</div>`;
    renderFeedPagination();
    toast(error.message, "error");
  }
}

async function loadDashboard(showSkeleton = false) {
  if (showSkeleton) feedList.innerHTML = Array.from({ length: 7 }, () => '<div class="skeleton"></div>').join("");
  const [topicPayload, statusPayload, evaluationPayload] = await Promise.all([api("/api/topics"), api("/api/status"), api("/api/evaluations?pageSize=200")]);
  topics = topicPayload.topics;
  status = statusPayload;
  archiveSnapshot = statusPayload.archive || archiveSnapshot;
  evaluations = evaluationPayload.evaluations;
  evaluationStats = evaluationPayload.stats || evaluationStats;
  if (!activeTopicTag || (activeTopicTag !== "__all__" && !topics.some((topic) => topic.tag === activeTopicTag))) activeTopicTag = topics[0]?.tag || "";
  renderSidebar();
  renderStatus();
  renderMetrics();
  updateMatchCount();
  if (activeViewName === "ai") renderAiHistory();
  if (activeDetail) renderDetail();
  await loadFeedPage({ showSkeleton });
}

function showSearchPage(keyword = "") {
  showView("add");
  dialogSearchInput.value = keyword;
  searchResults.innerHTML = keyword
    ? '<div class="page-empty-state compact"><span><i class="ph ph-circle-notch"></i></span><h3>正在准备搜索</h3><p>正在校验可监控的内容源信息。</p></div>'
    : '<div class="page-empty-state compact"><span><i class="ph ph-broadcast"></i></span><h3>搜索一个内容源开始监控</h3><p>支持酷安话题与数码产品，系统会自动选择对应的动态接口。</p></div>';
  requestAnimationFrame(() => dialogSearchInput.focus());
  if (keyword) void searchKeyword(keyword);
}

async function searchKeyword(keyword) {
  const q = keyword.replace(/^#+/, "").trim();
  if (!q) return dialogSearchInput.focus();
  dialogSearchInput.value = q;
  searchResults.innerHTML = '<div class="search-empty">正在查找酷安内容…</div>';
  try {
    const { results } = await api(`/api/topics/search?q=${encodeURIComponent(q)}`);
    searchResults.innerHTML = results.length ? `<div class="result-summary"><div><strong>搜索结果</strong><span>选择需要持续抓取的内容源</span></div><b>${results.length} 个结果</b></div>${results.map((item) => {
      const sourceKey = item.sourceKey || item.tag || item.title;
      const sourceLabel = item.sourceType === "product" ? "数码产品" : "话题";
      const monitored = topics.some((topic) => topic.sourceKey === sourceKey || topic.tag === item.tag || topic.tag === item.title);
      return `<div class="search-result">
        ${avatar(item.logo, item.title, "")}
        <div class="search-result-info"><strong>${item.sourceType === "product" ? "" : "#"}${escapeHtml(item.title)} <em class="source-kind ${item.sourceType === "product" ? "product" : "topic"}">${sourceLabel}</em></strong><small>${escapeHtml(item.description || item.intro || `${numberFormat.format(item.followers)} 人关注`)}</small></div>
        <button type="button" data-add="${escapeHtml(sourceKey)}" ${monitored ? "disabled" : ""}>${monitored ? "已监控" : "+ 监控"}</button>
      </div>`;
    }).join("")}` : '<div class="page-empty-state compact"><span><i class="ph ph-magnifying-glass"></i></span><h3>这次没有匹配结果</h3><p>试试更短的关键词，或输入酷安中的完整话题名称。</p></div>';
  } catch (error) { searchResults.innerHTML = `<div class="topic-error">${escapeHtml(error.message)}</div>`; }
}

async function addTopic(tag, button) {
  const cleanTag = String(tag || "").replace(/^#+/, "").trim();
  if (!cleanTag) return dialogSearchInput.focus();
  if (topics.some((topic) => topic.tag === cleanTag || topic.sourceKey === cleanTag)) return toast("该内容已在监控列表中");
  const previousLabel = button?.textContent || "";
  if (button) { button.disabled = true; button.textContent = "添加中…"; }
  try {
    const { topic } = await api("/api/topics", { method: "POST", body: JSON.stringify({ tag: cleanTag }) });
    topics.unshift(topic);
    activeTopicTag = topic.tag;
    activeFeedId = "";
    dashboardFeedMeta.page = 1;
    renderSidebar();
    renderMetrics();
    await loadFeedPage({ showSkeleton: true });
    toast(`已开始监控 #${topic.tag}`);
    searchInput.value = "";
    showView("dashboard");
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = previousLabel || "+ 监控"; }
    if (/话题不存在|未找到/.test(error.message)) {
      await searchKeyword(dialogSearchInput.value || cleanTag.replace(/^(topic|product):/, ""));
      toast("话题数据正在刷新，请稍后再次点击监控", "error");
      return;
    }
    toast(error.message, "error");
  }
}

async function loadSettings() {
  settingsSnapshot = await api("/api/settings");
  $("#aiEnabled").checked = settingsSnapshot.ai.enabled;
  $("#aiBaseUrl").value = settingsSnapshot.ai.baseUrl;
  $("#aiProvider").value = settingsSnapshot.ai.provider || "auto";
  $("#aiModel").value = settingsSnapshot.ai.model;
  $("#aiApiMode").value = settingsSnapshot.ai.apiMode || "auto";
  $("#aiReasoning").value = settingsSnapshot.ai.reasoningEffort;
  $("#aiThreshold").value = Math.round(settingsSnapshot.ai.threshold * 100);
  $("#aiIncludeImages").checked = settingsSnapshot.ai.includeImages;
  $("#aiApiKey").value = "";
  $("#apiKeyHint").textContent = settingsSnapshot.ai.configured ? `已配置：${settingsSnapshot.ai.apiKeyMasked}` : "尚未配置";
  $("#feishuEnabled").checked = settingsSnapshot.feishu.enabled;
  $("#feishuWebhook").value = "";
  $("#feishuSecret").value = "";
  $("#webhookHint").textContent = settingsSnapshot.feishu.configured ? `已配置：${settingsSnapshot.feishu.webhookMasked}` : "尚未配置";
  $("#secretHint").textContent = settingsSnapshot.feishu.secretConfigured ? "已配置签名" : "未配置";
  $("#retentionFeedDays").value = settingsSnapshot.retention.feedDays;
  $("#retentionEvaluationDays").value = settingsSnapshot.retention.evaluationDays;
  $("#retentionUserDays").value = settingsSnapshot.retention.userDays;
  $("#retentionMaxFeeds").value = settingsSnapshot.retention.maxFeeds;
  $("#retentionMaxEvaluations").value = settingsSnapshot.retention.maxEvaluations;
  $("#retentionCleanupHours").value = settingsSnapshot.retention.cleanupIntervalHours;
  archiveSnapshot = settingsSnapshot.archive || archiveSnapshot;
  renderArchiveOverview(settingsSnapshot.archive, settingsSnapshot.retention);
  return settingsSnapshot;
}

function renderArchiveOverview(summary = archiveSnapshot || {}, retention = settingsSnapshot?.retention || {}) {
  const lastCleanup = summary?.lastCleanupAt ? dateTimeFormat.format(new Date(summary.lastCleanupAt)) : "暂未清理";
  $("#archiveOverview").innerHTML = `
    <span><i class="ph ph-article"></i><b>${numberFormat.format(summary?.feeds || 0)}</b> 动态归档</span>
    <span><i class="ph ph-sparkle"></i><b>${numberFormat.format(summary?.evaluations || 0)}</b> AI 记录</span>
    <span><i class="ph ph-user-circle"></i><b>${numberFormat.format(summary?.users || 0)}</b> 用户资料</span>
    <small>最近清理：${lastCleanup} · 每 ${retention?.cleanupIntervalHours || "--"} 小时执行</small>`;
}

function settingsPayload() {
  return {
    ai: {
      enabled: $("#aiEnabled").checked,
      baseUrl: $("#aiBaseUrl").value.trim(),
      provider: $("#aiProvider").value,
      model: $("#aiModel").value.trim(),
      apiMode: $("#aiApiMode").value,
      reasoningEffort: $("#aiReasoning").value,
      threshold: Number($("#aiThreshold").value) / 100,
      includeImages: $("#aiIncludeImages").checked,
      apiKey: $("#aiApiKey").value.trim(),
    },
    feishu: {
      enabled: $("#feishuEnabled").checked,
      webhookUrl: $("#feishuWebhook").value.trim(),
      secret: $("#feishuSecret").value.trim(),
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

async function saveSettingsForm() {
  const button = $("#settingsForm .primary-button");
  button.disabled = true;
  $("#settingsSaveStatus").textContent = "正在保存…";
  try {
    settingsSnapshot = await api("/api/settings", { method: "PUT", body: JSON.stringify(settingsPayload()) });
    archiveSnapshot = settingsSnapshot.archive || archiveSnapshot;
    renderArchiveOverview(settingsSnapshot.archive, settingsSnapshot.retention);
    $("#settingsSaveStatus").textContent = "设置已保存";
    await loadSettings();
    toast("AI 与通知设置已保存");
    return true;
  } catch (error) {
    $("#settingsSaveStatus").textContent = error.message;
    toast(error.message, "error");
    return false;
  } finally { button.disabled = false; }
}

async function showSettings() {
  showView("settings");
  $("#settingsSaveStatus").textContent = "";
  try { await loadSettings(); } catch (error) { toast(error.message, "error"); }
}

function showRuleDialog() {
  const topic = activeTopic();
  if (!topic) return toast("请先添加一个监控话题", "error");
  $("#ruleTopicName").textContent = `#${topic.tag} · 定义真正值得提醒的内容`;
  $("#ruleEnabled").checked = Boolean(topic.ai?.enabled);
  $("#ruleIntent").value = topic.ai?.intent || "";
  $("#ruleThreshold").value = topic.ai?.threshold == null ? "" : Math.round(topic.ai.threshold * 100);
  const effectiveThreshold = topic.ai?.effectiveThreshold ?? settingsSnapshot?.ai?.threshold ?? 0.72;
  $("#ruleThresholdHint").textContent = topic.ai?.threshold == null
    ? `当前继承全局阈值 ${Math.round(effectiveThreshold * 100)}%。`
    : `当前话题单独使用 ${Math.round(topic.ai.threshold * 100)}%。`;
  $("#ruleNotify").checked = topic.ai?.notify !== false;
  $("#fetchSort").value = topic.fetch?.sort || "dateline_desc";
  $("#fetchLimit").value = topic.fetch?.limit || 20;
  $("#analyzeCurrent span").textContent = `分析当前 ${topic.feeds?.length || 0} 条`;
  $("#ruleSaveStatus").textContent = "";
  showDialog(ruleDialog);
}

async function saveRule() {
  const topic = activeTopic();
  if (!topic) return false;
  const payload = {
    ai: {
      enabled: $("#ruleEnabled").checked,
      intent: $("#ruleIntent").value.trim(),
      threshold: $("#ruleThreshold").value === "" ? "" : Number($("#ruleThreshold").value) / 100,
      notify: $("#ruleNotify").checked,
    },
    fetch: { sort: $("#fetchSort").value, limit: Number($("#fetchLimit").value) },
  };
  $("#ruleSaveStatus").textContent = "正在保存…";
  try {
    const { topic: updated } = await api(`/api/topics/${encodeURIComponent(topic.tag)}`, { method: "PATCH", body: JSON.stringify(payload) });
    topics = topics.map((item) => item.tag === updated.tag ? updated : item);
    $("#ruleSaveStatus").textContent = "规则已保存";
    renderSidebar();
    renderFeed();
    toast(`#${topic.tag} 的 AI 规则已保存`);
    return true;
  } catch (error) {
    $("#ruleSaveStatus").textContent = error.message;
    toast(error.message, "error");
    return false;
  }
}

function renderAiHistory() {
  $("#aiMetricTotal").textContent = numberFormat.format(evaluationStats.total ?? evaluations.length);
  $("#aiMetricMatched").textContent = numberFormat.format(evaluationStats.matched ?? evaluations.filter((item) => item.matched).length);
  $("#aiMetricNotified").textContent = numberFormat.format(evaluationStats.notified ?? evaluations.filter((item) => item.notified).length);
  const rows = historyEvaluations;
  aiHistory.innerHTML = rows.length ? rows.map((item) => {
    const stateClass = item.status === "error" ? "error" : item.matched ? "" : "miss";
    const icon = item.status === "error" ? "ph-warning" : item.matched ? "ph-sparkle" : "ph-check";
    const delivery = item.status === "error" ? "等待重试" : item.notified ? "已通知" : item.notificationError ? "通知失败" : item.matched ? "未通知" : "";
    const metric = evaluationMetric(item);
    const metricText = item.status === "error" ? "判断失败" : metric ? `${metric.label} ${Math.round(metric.value * 100)}%` : "暂无评分";
    const threshold = evaluationThreshold(item);
    const thresholdText = item.status === "error" || threshold == null ? "" : ` · 当前阈值 ${Math.round(threshold * 100)}%`;
    return `<article class="history-item ${stateClass}">
      <span class="history-icon"><i class="ph ${icon}"></i></span>
      <div class="history-main"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.reason)}</p>${metric?.legacy ? '<small class="ai-input-note"><i class="ph ph-info"></i> 旧版评分口径</small>' : ""}${item.imageFallback ? '<small class="ai-input-note"><i class="ph ph-text-t"></i> 已按文本完成判断</small>' : ""}${item.compatibilityFallback ? '<small class="ai-input-note"><i class="ph ph-plugs-connected"></i> 已自动切换兼容请求格式</small>' : ""}</div>
      <div class="history-meta"><b>${metricText}</b><span>${thresholdText}${delivery ? `${thresholdText ? " · " : ""}${delivery}` : ""}</span><time>${item.evaluatedAt ? `<br>${dateTimeFormat.format(new Date(item.evaluatedAt))}` : ""}</time></div>
    </article>`;
  }).join("") : `<div class="page-empty-state"><span><i class="ph ph-sparkle"></i></span><h3>${historyFilter === "matched" ? "还没有 AI 命中" : "还没有判断记录"}</h3><p>启用 AI 并设置话题关注意图后，新抓取的动态会自动进入这里。</p><button type="button" data-open-settings><i class="ph ph-gear-six"></i>配置 AI 连接</button></div>`;
  $("#aiHistoryCount").textContent = `已显示 ${numberFormat.format(rows.length)} / ${numberFormat.format(historyMeta.total || 0)} 条当前判断`;
  $("#loadMoreEvaluations").hidden = historyMeta.page >= historyMeta.totalPages;
}

async function loadAiHistory({ reset = false, page = null } = {}) {
  const targetPage = reset ? 1 : Math.max(1, Number(page ?? historyMeta.page) || 1);
  const sequence = ++historyLoadSequence;
  const button = $("#loadMoreEvaluations");
  button.disabled = true;
  if (reset) aiHistory.innerHTML = '<div class="detail-loading">正在加载判断记录…</div>';
  try {
    const params = new URLSearchParams({ page: String(targetPage), pageSize: String(historyMeta.pageSize), status: historyFilter });
    const payload = await api(`/api/evaluations?${params}`);
    if (sequence !== historyLoadSequence) return;
    evaluationStats = payload.stats || evaluationStats;
    historyEvaluations = reset ? payload.evaluations : [...historyEvaluations, ...payload.evaluations];
    historyMeta = { page: payload.page || 1, pageSize: payload.pageSize || 50, total: payload.total || 0, totalPages: payload.totalPages || 1 };
    renderAiHistory();
    renderMetrics();
    updateMatchCount();
  } catch (error) {
    if (sequence !== historyLoadSequence) return;
    aiHistory.innerHTML = `<div class="topic-error">${escapeHtml(error.message)}</div>`;
  } finally { if (sequence === historyLoadSequence) button.disabled = false; }
}

function showAiCenter() {
  showView("ai");
  void loadAiHistory({ reset: true });
}

function exploreFeedCard(feed, source = "搜索结果") {
  const title = textOnly(feed.title) || `${feed.username || "酷友"}的动态`;
  const message = textOnly(feed.message);
  const popular = `${numberFormat.format(feed.likes || 0)} 赞 · ${numberFormat.format(feed.comments || 0)} 评`;
  return `<article class="explore-feed-card" tabindex="0" role="button" data-explore-feed-id="${escapeHtml(feed.id)}">
    <div class="explore-feed-main">
      ${avatar(feed.avatar, feed.username, "explore-avatar")}
      <div class="explore-feed-copy"><div class="explore-feed-title"><strong>${escapeHtml(title)}</strong>${feed.pictures?.[0] ? `<img src="${escapeHtml(imageUrl(feed.pictures[0]))}" alt="${escapeHtml(title)} 配图" loading="lazy" />` : ""}</div><p>${escapeHtml(message || "查看完整动态内容")}</p><span>${escapeHtml(feed.topic || source)} · ${shortTime(feed.createdAt)}</span></div>
    </div>
    <footer><span><i class="ph ph-thumbs-up"></i>${popular}</span>${feed.userId ? `<button type="button" data-open-user="${escapeHtml(feed.userId)}"><i class="ph ph-user-circle"></i>${escapeHtml(feed.username || "用户主页")}</button>` : ""}<span class="explore-open"><i class="ph ph-arrow-up-right"></i>打开详情</span></footer>
  </article>`;
}

function renderExploreFeeds(target, feeds, emptyTitle, emptyText, source) {
  target.innerHTML = feeds?.length
    ? `<div class="explore-result-summary"><strong>找到 ${feeds.length} 条公开动态</strong><span>点击任意卡片在当前页面查看详情与评论</span></div>${feeds.map((feed) => exploreFeedCard(feed, source)).join("")}`
    : `<div class="page-empty-state compact"><span><i class="ph ph-magnifying-glass"></i></span><h3>${escapeHtml(emptyTitle)}</h3><p>${escapeHtml(emptyText)}</p></div>`;
}

function renderUserSearchResults(users) {
  const target = $("#userSearchResults");
  target.innerHTML = users?.length ? users.map((user) => `<article class="user-search-card">
    ${avatar(user.avatar, user.username, "user-search-avatar")}
    <div><strong>${escapeHtml(user.username)}${user.verifyLabel ? `<em>${escapeHtml(user.verifyLabel)}</em>` : ""}</strong><p>${escapeHtml(user.bio || `UID ${user.uid}`)}</p><span>UID ${escapeHtml(user.uid)} · ${numberFormat.format(user.followers || 0)} 粉丝</span></div>
    <button type="button" data-open-user="${escapeHtml(user.uid)}"><i class="ph ph-user-circle"></i>查看主页</button>
  </article>`).join("") : '<div class="page-empty-state compact"><span><i class="ph ph-user-circle"></i></span><h3>没有找到相关用户</h3><p>试试完整昵称，或直接输入用户 UID。</p></div>';
}

function setExploreTab(tab) {
  activeExploreTab = ["feeds", "discovery", "users"].includes(tab) ? tab : "feeds";
  $$('[data-explore-tab]').forEach((button) => button.classList.toggle("active", button.dataset.exploreTab === activeExploreTab));
  $$('[data-explore-panel]').forEach((panel) => {
    const active = panel.dataset.explorePanel === activeExploreTab;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  if (activeExploreTab === "discovery" && !discoveryLoaded) void loadDiscovery();
}

function showExplore(tab = activeExploreTab) {
  showView("explore");
  setExploreTab(tab);
}

async function searchExploreFeeds() {
  const input = $("#feedSearchInput");
  const q = input.value.trim();
  if (!q) return input.focus();
  const target = $("#feedSearchResults");
  target.innerHTML = '<div class="search-empty">正在搜索公开帖子…</div>';
  try {
    const sort = $("#feedSearchSort").value;
    const { feeds } = await api(`/api/search/feeds?q=${encodeURIComponent(q)}&sort=${encodeURIComponent(sort)}`);
    renderExploreFeeds(target, feeds, "没有匹配的帖子", "试试更短的关键词，或用产品名、价格条件重新搜索。", "帖子搜索");
    archiveSnapshot = { ...(archiveSnapshot || {}), feeds: Math.max(archiveSnapshot?.feeds || 0, (status?.archive?.feeds || 0) + feeds.length) };
  } catch (error) { target.innerHTML = `<div class="topic-error">${escapeHtml(error.message)}</div>`; }
}

async function loadDiscovery(force = false) {
  const target = $("#discoveryResults");
  if (!force && discoveryLoaded) return;
  target.innerHTML = '<div class="search-empty">正在获取全站公开动态…</div>';
  try {
    const { feeds } = await api(`/api/discovery/feeds?mode=${activeDiscoveryMode}`);
    renderExploreFeeds(target, feeds, activeDiscoveryMode === "hot" ? "暂时没有热门动态" : "暂时没有最新动态", "稍后刷新，或切换另一种发现排序。", activeDiscoveryMode === "hot" ? "全站热门" : "全站最新");
    discoveryLoaded = true;
  } catch (error) { target.innerHTML = `<div class="topic-error">${escapeHtml(error.message)}</div>`; }
}

async function searchExploreUsers() {
  const input = $("#userSearchInput");
  const q = input.value.trim();
  if (!q) return input.focus();
  const target = $("#userSearchResults");
  target.innerHTML = '<div class="search-empty">正在搜索用户…</div>';
  try {
    if (/^\d{1,20}$/.test(q)) {
      target.innerHTML = "";
      return void openUserProfile(q);
    }
    const { users } = await api(`/api/search/users?q=${encodeURIComponent(q)}`);
    renderUserSearchResults(users);
  } catch (error) { target.innerHTML = `<div class="topic-error">${escapeHtml(error.message)}</div>`; }
}

async function openUserProfile(uid) {
  const cleanUid = String(uid || "").trim();
  if (!cleanUid) return;
  userProfileContent.innerHTML = '<div class="detail-loading">正在获取用户公开资料…</div>';
  showDialog(userDialog);
  try {
    const { profile, localFeeds, cached } = await api(`/api/users/${encodeURIComponent(cleanUid)}`);
    userProfileContent.innerHTML = `<section class="user-profile-hero">
      <div class="user-profile-cover">${profile.cover ? `<img src="${escapeHtml(imageUrl(profile.cover))}" alt="" loading="lazy" />` : ""}</div>
      <div class="user-profile-summary">${avatar(profile.avatar, profile.username, "user-profile-avatar")}<div><h3>${escapeHtml(profile.username)}${profile.verifyLabel ? `<em>${escapeHtml(profile.verifyLabel)}</em>` : ""}</h3><span>UID ${escapeHtml(profile.uid)} · Lv.${numberFormat.format(profile.level || 0)}${profile.location ? ` · ${escapeHtml(profile.location)}` : ""}</span><p>${escapeHtml(profile.bio || "这个用户暂未填写个人简介。")}</p></div></div>
      <div class="user-stat-grid"><span><b>${numberFormat.format(profile.followers || 0)}</b>粉丝</span><span><b>${numberFormat.format(profile.following || 0)}</b>关注</span><span><b>${numberFormat.format(profile.feeds || 0)}</b>动态</span><span><b>${numberFormat.format(profile.likes || 0)}</b>获赞</span></div>
    </section>
    <section class="user-local-history"><header><div><h3>本地归档动态</h3><p>${cached ? "使用 30 分钟内的资料缓存" : "资料已从公开主页更新"}</p></div><button type="button" data-refresh-user="${escapeHtml(profile.uid)}"><i class="ph ph-arrow-clockwise"></i>刷新资料</button></header><div>${localFeeds?.length ? localFeeds.map((feed) => `<article class="profile-feed" tabindex="0" role="button" data-explore-feed-id="${escapeHtml(feed.id)}"><strong>${escapeHtml(textOnly(feed.title) || `${feed.username}的动态`)}</strong><p>${escapeHtml(textOnly(feed.message) || "查看完整动态")}</p><span>${shortTime(feed.createdAt)} · 最近发现 ${dateTimeFormat.format(new Date(feed.lastSeenAt || feed.createdAt || Date.now()))}</span></article>`).join("") : '<div class="search-empty">该用户的动态将在你搜索、查看或监控到后自动写入本地归档。</div>'}</div></section>`;
  } catch (error) { userProfileContent.innerHTML = `<div class="topic-error">${escapeHtml(error.message)}</div>`; }
}

function updateLightboxTransform() {
  lightboxImage.style.transform = `translate(${lightboxState.x}px, ${lightboxState.y}px) scale(${lightboxState.zoom})`;
  $("#zoomReset").textContent = `${Math.round(lightboxState.zoom * 100)}%`;
}

function openLightbox(image) {
  lightboxImage.src = image.currentSrc || image.src;
  $("#lightboxCaption").textContent = image.dataset.caption || image.alt || "查看图片";
  lightboxState = { zoom: 1, x: 0, y: 0, dragging: false, startX: 0, startY: 0 };
  updateLightboxTransform();
  showDialog(lightbox);
}

function setZoom(next) {
  lightboxState.zoom = Math.max(.5, Math.min(5, next));
  if (lightboxState.zoom === 1) { lightboxState.x = 0; lightboxState.y = 0; }
  updateLightboxTransform();
}


topicList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-topic]");
  if (!button) return;
  showView("dashboard");
  activeTopicTag = button.dataset.topic;
  activeFeedId = "";
  activeDetail = null;
  feedFilterValue = "";
  feedFilter.value = "";
  dashboardFeedMeta.page = 1;
  const selectedTopic = activeTopic();
  if (activeTopicTag !== "__all__" && selectedTopic?.fetch?.sort) {
    feedSortOrder = { dateline_desc: "created_desc", lastupdate_desc: "updated_desc", popular: "popular_desc" }[selectedTopic.fetch.sort] || "created_desc";
    $("#sortOrder").value = feedSortOrder;
  }
  renderSidebar();
  void loadFeedPage({ showSkeleton: true });
});

feedList.addEventListener("click", (event) => {
  const picture = event.target.closest("[data-lightbox]");
  if (picture) { event.preventDefault(); event.stopPropagation(); return openLightbox(picture); }
  const button = event.target.closest("[data-feed-id]");
  if (!button) return;
  const feed = dashboardFeeds.find((item) => String(item.id) === button.dataset.feedId);
  void openDetail(button.dataset.feedId, feed);
});

feedHeader.addEventListener("click", async (event) => {
  if (event.target.closest("#openRule")) return showRuleDialog();
  if (event.target.closest("[data-open-search]")) return showSearchPage();
  if (!event.target.closest("#removeTopic")) return;
  const topic = activeTopic();
  if (!topic || !confirm(`停止监控 #${topic.tag}？历史 AI 判断记录会保留。`)) return;
  try {
    await api(`/api/topics/${encodeURIComponent(topic.tag)}`, { method: "DELETE" });
    topics = topics.filter((item) => item.tag !== topic.tag);
    activeTopicTag = topics[0]?.tag || "";
    activeFeedId = "";
    activeDetail = null;
    dashboardFeedMeta.page = 1;
    renderSidebar();
    renderMetrics();
    await loadFeedPage({ showSkeleton: true });
    toast(`已停止监控 #${topic.tag}`);
  } catch (error) { toast(error.message, "error"); }
});

detailContent.addEventListener("click", async (event) => {
  const picture = event.target.closest("[data-lightbox]");
  if (picture) return openLightbox(picture);
  const userButton = event.target.closest("[data-open-user]");
  if (userButton) return void openUserProfile(userButton.dataset.openUser);
  const button = event.target.closest("[data-load-page]");
  if (!button || !activeDetail) return;
  button.disabled = true;
  button.textContent = "加载中…";
  try {
    const next = await api(`/api/feeds/${activeDetail.feed.id}/replies?page=${button.dataset.loadPage}`);
    if (!next.replies.length) { button.textContent = "已经到底了"; return; }
    activeDetail.replies.push(...next.replies);
    activeDetail.page = next.page;
    renderDetail();
  } catch (error) { button.disabled = false; button.textContent = "重新加载"; toast(error.message, "error"); }
});

searchForm.addEventListener("submit", (event) => { event.preventDefault(); showSearchPage(searchInput.value); });
dialogSearchForm.addEventListener("submit", (event) => { event.preventDefault(); void searchKeyword(dialogSearchInput.value); });
$("#feedSearchForm").addEventListener("submit", (event) => { event.preventDefault(); void searchExploreFeeds(); });
$("#userSearchForm").addEventListener("submit", (event) => { event.preventDefault(); void searchExploreUsers(); });
searchResults.addEventListener("click", (event) => {
  const button = event.target.closest("[data-add]");
  if (button && !button.disabled) void addTopic(button.dataset.add, button);
});

$("#settingsForm").addEventListener("submit", async (event) => { event.preventDefault(); await saveSettingsForm(); });
$("#ruleForm").addEventListener("submit", async (event) => { event.preventDefault(); if (await saveRule()) setTimeout(() => closeDialog(ruleDialog), 350); });

$("#testAi").addEventListener("click", async () => {
  const button = $("#testAi");
  button.disabled = true;
  $("#aiTestStatus").textContent = "正在验证…";
  try {
    if (!(await saveSettingsForm())) return;
    const result = await api("/api/integrations/test-ai", { method: "POST" });
    $("#aiTestStatus").textContent = `${result.model} · ${result.modeLabel || result.mode} 连接成功`;
  } catch (error) { $("#aiTestStatus").textContent = error.message; toast(error.message, "error"); }
  finally { button.disabled = false; }
});

$("#testFeishu").addEventListener("click", async () => {
  const button = $("#testFeishu");
  button.disabled = true;
  $("#feishuTestStatus").textContent = "正在发送…";
  try {
    if (!(await saveSettingsForm())) return;
    await api("/api/integrations/test-feishu", { method: "POST" });
    $("#feishuTestStatus").textContent = "测试通知已发送";
  } catch (error) { $("#feishuTestStatus").textContent = error.message; toast(error.message, "error"); }
  finally { button.disabled = false; }
});

$("#runCleanup").addEventListener("click", async () => {
  const button = $("#runCleanup");
  button.disabled = true;
  $("#cleanupStatus").textContent = "正在清理…";
  try {
    if (!(await saveSettingsForm())) return;
    const result = await api("/api/maintenance/cleanup", { method: "POST" });
    archiveSnapshot = { feeds: result.feeds, evaluations: result.evaluations, users: result.users, events: result.events, lastCleanupAt: result.ranAt || new Date().toISOString(), lastCleanupSummary: result };
    renderArchiveOverview(archiveSnapshot, settingsSnapshot?.retention);
    $("#cleanupStatus").textContent = `已清理 ${Object.values(result.removed || {}).reduce((sum, value) => sum + Number(value || 0), 0)} 条过期数据`;
    await loadDashboard();
    toast("本地归档已完成清理");
  } catch (error) { $("#cleanupStatus").textContent = error.message; toast(error.message, "error"); }
  finally { button.disabled = false; }
});

$("#aiProvider").addEventListener("change", () => {
  const provider = $("#aiProvider").value;
  const base = $("#aiBaseUrl");
  const model = $("#aiModel");
  const mode = $("#aiApiMode");
  const presets = {
    anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-20250514", apiMode: "anthropic_messages" },
    gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-flash", apiMode: "gemini_generate_content" },
    openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-5.6-luna", apiMode: "auto" },
  };
  const preset = presets[provider];
  if (!preset) return;
  base.value = preset.baseUrl;
  model.value = preset.model;
  mode.value = preset.apiMode;
});

$("#analyzeCurrent").addEventListener("click", async () => {
  const topic = activeTopic();
  const button = $("#analyzeCurrent");
  if (!topic || !(await saveRule())) return;
  button.disabled = true;
  button.innerHTML = '<i class="ph ph-circle-notch"></i> AI 分析中';
  $("#ruleSaveStatus").textContent = "逐条判断当前内容，可能需要一些时间…";
  try {
    const result = await api(`/api/topics/${encodeURIComponent(topic.tag)}/analyze`, { method: "POST", body: JSON.stringify({ force: true, notify: false }) });
    const keys = new Set(result.evaluations.map((item) => `${item.topic}\u0000${item.feedId}`));
    evaluations = [...result.evaluations, ...evaluations.filter((item) => !keys.has(`${item.topic}\u0000${item.feedId}`))];
    $("#ruleSaveStatus").textContent = `已完成 ${result.count} 条判断`;
    await loadDashboard();
    toast(`AI 已完成 ${result.count} 条判断`);
  } catch (error) { $("#ruleSaveStatus").textContent = error.message; toast(error.message, "error"); }
  finally { button.disabled = false; button.innerHTML = `<i class="ph ph-play"></i><span>分析当前 ${activeTopic()?.feeds?.length || 0} 条</span>`; }
});

$$('[data-history-filter]').forEach((button) => button.addEventListener("click", () => {
  historyFilter = button.dataset.historyFilter;
  $$('[data-history-filter]').forEach((item) => item.classList.toggle("active", item === button));
  void loadAiHistory({ reset: true });
}));
$("#loadMoreEvaluations").addEventListener("click", () => {
  if (historyMeta.page >= historyMeta.totalPages) return;
  void loadAiHistory({ page: historyMeta.page + 1 });
});

refreshAll.addEventListener("click", async () => {
  refreshAll.disabled = true;
  refreshAll.classList.add("loading");
  statusDot.classList.add("busy");
  syncText.textContent = "正在抓取";
  try {
    await api("/api/refresh", { method: "POST" });
    await loadDashboard();
    toast("全部话题已刷新");
  } catch (error) { toast(error.message, "error"); }
  finally { refreshAll.disabled = false; refreshAll.classList.remove("loading"); statusDot.classList.remove("busy"); }
});

document.addEventListener("click", (event) => {
  if (event.target.closest("#showSearch, #sidebarSearch, #manageTopics")) { event.preventDefault(); showSearchPage(); }
  if (event.target.closest("#openDashboardSidebar, [data-return-dashboard]")) { event.preventDefault(); showView("dashboard"); }
  if (event.target.closest("#openExploreSidebar, #openExplore")) { event.preventDefault(); showExplore(); }
  if (event.target.closest("#openSettings, #openSettingsSidebar, [data-open-settings]")) { event.preventDefault(); void showSettings(); }
  if (event.target.closest("#openAiCenter, #openAiCenterSidebar")) { event.preventDefault(); showAiCenter(); }
  const quickSearch = event.target.closest("[data-search-keyword]");
  if (quickSearch) {
    event.preventDefault();
    dialogSearchInput.value = quickSearch.dataset.searchKeyword;
    void searchKeyword(quickSearch.dataset.searchKeyword);
  }
  const close = event.target.closest("[data-close-dialog]");
  if (close) closeDialog($(`#${close.dataset.closeDialog}`));
});

exploreView.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-explore-tab]");
  if (tab) return setExploreTab(tab.dataset.exploreTab);
  const discovery = event.target.closest("[data-discovery-mode]");
  if (discovery) {
    activeDiscoveryMode = discovery.dataset.discoveryMode === "hot" ? "hot" : "recent";
    $$('[data-discovery-mode]').forEach((button) => button.classList.toggle("active", button === discovery));
    discoveryLoaded = false;
    return void loadDiscovery(true);
  }
  if (event.target.closest("#refreshDiscovery")) {
    discoveryLoaded = false;
    return void loadDiscovery(true);
  }
  const userButton = event.target.closest("[data-open-user]");
  if (userButton) return void openUserProfile(userButton.dataset.openUser);
  const feedCard = event.target.closest("[data-explore-feed-id]");
  if (feedCard) {
    const id = feedCard.dataset.exploreFeedId;
    const detail = { id, title: feedCard.querySelector("strong")?.textContent || "动态详情", message: "", username: "", pictures: [] };
    return void openDetail(id, detail);
  }
});

exploreView.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-explore-feed-id]")) {
    event.preventDefault();
    void openDetail(event.target.dataset.exploreFeedId, { id: event.target.dataset.exploreFeedId, title: event.target.querySelector("strong")?.textContent || "动态详情", message: "", username: "", pictures: [] });
  }
});

userProfileContent.addEventListener("click", (event) => {
  const refresh = event.target.closest("[data-refresh-user]");
  if (refresh) return void (async () => {
    userProfileContent.querySelector("[data-refresh-user]")?.setAttribute("disabled", "");
    try { await api(`/api/users/${encodeURIComponent(refresh.dataset.refreshUser)}?refresh=1`); await openUserProfile(refresh.dataset.refreshUser); }
    catch (error) { toast(error.message, "error"); }
  })();
  const feedCard = event.target.closest("[data-explore-feed-id]");
  if (feedCard) return void openDetail(feedCard.dataset.exploreFeedId, { id: feedCard.dataset.exploreFeedId, title: feedCard.querySelector("strong")?.textContent || "动态详情", message: "", username: "", pictures: [] });
});

$("#closeDetail").addEventListener("click", () => closeDialog(detailDialog));
detailDialog.addEventListener("close", () => {
  activeFeedId = "";
  activeDetail = null;
  renderFeed();
  if (location.hash.startsWith("#feed-")) history.replaceState(null, "", `${location.pathname}${location.search}`);
});
feedFilter.addEventListener("input", () => {
  feedFilterValue = feedFilter.value;
  clearTimeout(feedFilterTimer);
  feedFilterTimer = setTimeout(() => void loadFeedPage({ resetPage: true, showSkeleton: true }), 250);
});
$("#matchedFilter").addEventListener("click", () => {
  feedAiFilter = feedAiFilter === "all" ? "matched" : "all";
  $("#matchedFilter span").textContent = feedAiFilter === "matched" ? "仅看 AI 命中" : "全部状态";
  void loadFeedPage({ resetPage: true, showSkeleton: true });
});
$("#sortOrder").addEventListener("change", () => {
  feedSortOrder = $("#sortOrder").value;
  void loadFeedPage({ resetPage: true, showSkeleton: true });
});
$("#feedPrevious").addEventListener("click", () => {
  if (!dashboardFeedMeta.hasPrevious) return;
  void loadFeedPage({ page: dashboardFeedMeta.page - 1, showSkeleton: true });
});
$("#feedNext").addEventListener("click", () => {
  if (!dashboardFeedMeta.hasNext) return;
  void loadFeedPage({ page: dashboardFeedMeta.page + 1, showSkeleton: true });
});
$("#feedPageSize").addEventListener("change", () => {
  void loadFeedPage({ resetPage: true, pageSize: Number($("#feedPageSize").value) || 20, showSkeleton: true });
});
$("#closeLightbox").addEventListener("click", () => closeDialog(lightbox));
lightboxImage.addEventListener("error", () => { closeDialog(lightbox); toast("这张图片暂时加载失败", "error"); });
$("#zoomIn").addEventListener("click", () => setZoom(lightboxState.zoom + .25));
$("#zoomOut").addEventListener("click", () => setZoom(lightboxState.zoom - .25));
$("#zoomReset").addEventListener("click", () => { lightboxState.x = 0; lightboxState.y = 0; setZoom(1); });
lightboxStage.addEventListener("wheel", (event) => { event.preventDefault(); setZoom(lightboxState.zoom + (event.deltaY < 0 ? .2 : -.2)); }, { passive: false });
lightboxStage.addEventListener("pointerdown", (event) => {
  if (lightboxState.zoom <= 1) return;
  lightboxState.dragging = true;
  lightboxState.startX = event.clientX - lightboxState.x;
  lightboxState.startY = event.clientY - lightboxState.y;
  lightboxStage.classList.add("dragging");
  lightboxStage.setPointerCapture(event.pointerId);
});
lightboxStage.addEventListener("pointermove", (event) => {
  if (!lightboxState.dragging) return;
  lightboxState.x = event.clientX - lightboxState.startX;
  lightboxState.y = event.clientY - lightboxState.startY;
  updateLightboxTransform();
});
lightboxStage.addEventListener("pointerup", (event) => {
  lightboxState.dragging = false;
  lightboxStage.classList.remove("dragging");
  if (lightboxStage.hasPointerCapture(event.pointerId)) lightboxStage.releasePointerCapture(event.pointerId);
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchInput.focus(); }
  if (event.key === "Escape" && lightbox.open) closeDialog(lightbox);
});

document.addEventListener("error", (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || image.id === "lightboxImage") return;
  const fallback = document.createElement("span");
  if (image.matches(".feed-thumb")) fallback.className = "feed-thumb feed-thumb-placeholder";
  else if (image.matches(".feed-avatar, .reply-avatar")) fallback.className = `${image.className} feed-avatar-fallback`;
  else if (image.closest(".detail-pictures")) fallback.className = "detail-image-error";
  else fallback.className = "image-error";
  fallback.setAttribute("aria-label", `${image.alt || "图片"}加载失败`);
  fallback.innerHTML = '<i class="ph ph-image-broken"></i>';
  image.replaceWith(fallback);
}, true);

loadDashboard(true).catch((error) => { feedList.innerHTML = `<div class="topic-error">${escapeHtml(error.message)}</div>`; });
setInterval(() => loadDashboard().catch(() => {}), 30_000);
