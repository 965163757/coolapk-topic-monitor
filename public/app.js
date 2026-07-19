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
const addView = $("#addView");
const aiView = $("#aiView");
const settingsView = $("#settingsView");
const breadcrumbCurrent = $("#breadcrumbCurrent");

let topics = [];
let evaluations = [];
let status = null;
let settingsSnapshot = null;
let activeTopicTag = "";
let activeFeedId = "";
let activeDetail = null;
let historyFilter = "matched";
let feedFilterValue = "";
let feedAiFilter = "all";
let feedSortOrder = "desc";
let activeViewName = "dashboard";
let lightboxState = { zoom: 1, x: 0, y: 0, dragging: false, startX: 0, startY: 0 };

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

const viewLabels = { dashboard: "动态看板", add: "添加监控", ai: "AI 命中记录", settings: "系统设置" };

function showView(name) {
  const next = [dashboardView, addView, aiView, settingsView].find((view) => view?.dataset.view === name) || dashboardView;
  activeViewName = next.dataset.view;
  for (const view of [dashboardView, addView, aiView, settingsView]) {
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
  return evaluations.find((item) => String(item.feedId) === String(feedId) && item.topic === topicTag) || null;
}

function shortTime(timestamp) {
  return timestamp ? timeFormat.format(new Date(timestamp)) : "时间未知";
}

function renderSidebar() {
  const totalFeeds = topics.reduce((sum, topic) => sum + (topic.feeds?.length || 0), 0);
  topicList.innerHTML = `
    <button class="topic-item topic-item-all ${activeTopicTag === "__all__" ? "active" : ""}" type="button" data-topic="__all__">
      <span class="topic-item-label">全部话题</span><span class="topic-item-count">${totalFeeds}</span>
    </button>
    ${topics.map((topic) => {
      const topicMatches = evaluations.filter((item) => item.topic === topic.tag && item.matched).length;
      return `<button class="topic-item ${topic.tag === activeTopicTag ? "active" : ""}" type="button" data-topic="${escapeHtml(topic.tag)}" title="${escapeHtml(topic.tag)}">
        <i class="topic-bullet"></i><span class="topic-item-label">${escapeHtml(topic.detail?.title || topic.tag)}</span><span class="topic-item-count">${topicMatches ? `${topicMatches} 命中` : topic.feeds?.length || 0}</span>
      </button>`;
    }).join("")}`;
}

function renderMetrics() {
  const totalFeeds = topics.reduce((sum, topic) => sum + (topic.feeds?.length || 0), 0);
  const matches = evaluations.filter((item) => item.matched).length;
  $("#metricTopics").textContent = numberFormat.format(topics.length);
  $("#metricFeeds").textContent = numberFormat.format(totalFeeds);
  $("#metricMatches").textContent = numberFormat.format(matches);
  $("#metricUpdated").textContent = status?.nextPollAt ? timeFormat.format(new Date(status.nextPollAt)) : "--:--";
}

function evaluationBadge(evaluation) {
  if (!evaluation) return "";
  if (evaluation.status === "error") return '<span class="ai-badge error"><i class="ph ph-warning"></i>AI 异常</span>';
  if (evaluation.matched) return `<span class="ai-badge"><i class="ph ph-sparkle"></i>${Math.round(evaluation.confidence * 100)}% 命中</span>`;
  return `<span class="ai-badge miss"><i class="ph ph-check"></i>${Math.round(evaluation.confidence * 100)}%</span>`;
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

function renderFeed() {
  const allView = activeTopicTag === "__all__";
  const topic = allView ? null : activeTopic();
  if (!topics.length) {
    feedHeader.innerHTML = '<div class="feed-heading"><h1>还没有监控话题</h1><p>搜索并添加一个话题开始监控</p></div><div class="feed-header-actions"><button type="button" data-open-search><i class="ph ph-plus"></i>添加话题</button></div>';
    feedList.innerHTML = '<div class="search-empty">点击顶部“添加监控话题”开始</div>';
    feedCount.textContent = "暂无动态";
    return;
  }
  let sourceFeeds = [];
  if (allView) {
    sourceFeeds = topics.flatMap((item) => (item.feeds || []).map((feed) => ({
      ...feed,
      __monitorTopicTag: item.tag,
      __monitorTopicTitle: item.detail?.title || item.tag,
    }))).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    feedHeader.innerHTML = `
      <div class="feed-heading"><span class="feed-eyebrow">ALL WATCHES</span><h1>全部监控动态 <span class="live-label">实时</span></h1><p>${topics.length} 个话题 · 汇总查看最近抓取结果</p></div>
      <div class="feed-header-actions"><button class="ai-rule-button active" type="button" data-open-search><i class="ph ph-plus"></i><span>添加监控</span></button></div>`;
  } else {
    const detail = topic.detail || { title: topic.tag };
    const aiActive = topic.ai?.enabled && topic.ai?.intent;
    sourceFeeds = topic.feeds || [];
    feedHeader.innerHTML = `
      <div class="feed-heading"><span class="feed-eyebrow">ACTIVE WATCH</span><h1>${escapeHtml(detail.title || topic.tag)} <span class="live-label">实时</span></h1><p>${numberFormat.format(detail.followers || 0)} 关注 · ${numberFormat.format(detail.posts || 0)} 条内容${aiActive ? " · AI 筛选已开启" : ""}</p></div>
      <div class="feed-header-actions">
        <button class="ai-rule-button ${aiActive ? "active" : ""}" type="button" id="openRule"><i class="ph ph-sparkle"></i><span>${aiActive ? "AI 规则" : "配置 AI"}</span></button>
        <button type="button" id="removeTopic" title="停止监控" aria-label="停止监控"><i class="ph ph-trash"></i><span>停止监控</span></button>
      </div>`;
  }
  const keyword = feedFilterValue.trim().toLowerCase();
  let visibleFeeds = keyword ? sourceFeeds.filter((feed) => [feed.title, feed.message, feed.username, feed.__monitorTopicTitle, feed.__monitorTopicTag].some((value) => textOnly(value || "").toLowerCase().includes(keyword))) : [...sourceFeeds];
  if (feedAiFilter === "matched") visibleFeeds = visibleFeeds.filter((feed) => evaluationFor(feed.id, feed.__monitorTopicTag || topic?.tag)?.matched);
  visibleFeeds.sort((a, b) => (new Date(b.createdAt || 0) - new Date(a.createdAt || 0)) * (feedSortOrder === "desc" ? 1 : -1));
  if (!allView && topic.lastError) feedList.innerHTML = `<div class="topic-error">本次抓取失败：${escapeHtml(topic.lastError)}</div>`;
  else if (visibleFeeds.length) feedList.innerHTML = visibleFeeds.map(feedRow).join("");
  else feedList.innerHTML = '<div class="search-empty">暂时没有获取到公开动态</div>';
  feedCount.textContent = keyword ? `筛选出 ${visibleFeeds.length} / ${sourceFeeds.length} 条动态` : `共 ${sourceFeeds.length} 条最新动态`;
}

function renderStatus() {
  if (!status) return;
  statusDot.classList.toggle("busy", status.refreshing || status.ai?.analyzing);
  if (status.refreshing) syncText.textContent = "正在抓取";
  else if (status.ai?.analyzing) syncText.textContent = "AI 正在判断";
  else syncText.textContent = "每 5 分钟更新";
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
  const stateClass = evaluation.status === "error" ? "error" : evaluation.matched ? "" : "miss";
  const label = evaluation.status === "error" ? "判断异常" : evaluation.matched ? "符合关注意图" : "未达到命中条件";
  return `<div class="ai-verdict ${stateClass}">
    <div class="ai-verdict-head"><span><i class="ph ph-sparkle"></i> ${label}</span><span>${Math.round(evaluation.confidence * 100)}%</span></div>
    <p>${escapeHtml(evaluation.reason)}</p>
    ${evaluation.imageFallback ? '<small class="ai-input-note"><i class="ph ph-text-t"></i> 当前模型未接收图片输入，已按文本完成判断</small>' : ""}
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
        <button class="follow-button" type="button">关注 TA</button>
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
  const topicTag = optimisticFeed?.__monitorTopicTag || activeTopic()?.tag || "";
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
  const count = evaluations.filter((item) => item.matched).length;
  const badge = $("#matchCount");
  badge.hidden = !count;
  badge.textContent = String(Math.min(99, count));
}

async function loadDashboard(showSkeleton = false) {
  if (showSkeleton) feedList.innerHTML = Array.from({ length: 7 }, () => '<div class="skeleton"></div>').join("");
  const [topicPayload, statusPayload, evaluationPayload] = await Promise.all([api("/api/topics"), api("/api/status"), api("/api/evaluations?limit=200")]);
  topics = topicPayload.topics;
  status = statusPayload;
  evaluations = evaluationPayload.evaluations;
  if (!activeTopicTag || (activeTopicTag !== "__all__" && !topics.some((topic) => topic.tag === activeTopicTag))) activeTopicTag = topics[0]?.tag || "";
  renderSidebar();
  renderFeed();
  renderStatus();
  renderMetrics();
  updateMatchCount();
  if (activeViewName === "ai") renderAiHistory();
  if (activeDetail) renderDetail();
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
    renderSidebar();
    renderFeed();
    renderMetrics();
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
  $("#aiModel").value = settingsSnapshot.ai.model;
  $("#aiApiMode").value = settingsSnapshot.ai.apiMode || "auto";
  $("#aiReasoning").value = settingsSnapshot.ai.reasoningEffort;
  $("#aiThreshold").value = settingsSnapshot.ai.threshold;
  $("#aiIncludeImages").checked = settingsSnapshot.ai.includeImages;
  $("#aiApiKey").value = "";
  $("#apiKeyHint").textContent = settingsSnapshot.ai.configured ? `已配置：${settingsSnapshot.ai.apiKeyMasked}` : "尚未配置";
  $("#feishuEnabled").checked = settingsSnapshot.feishu.enabled;
  $("#feishuWebhook").value = "";
  $("#feishuSecret").value = "";
  $("#webhookHint").textContent = settingsSnapshot.feishu.configured ? `已配置：${settingsSnapshot.feishu.webhookMasked}` : "尚未配置";
  $("#secretHint").textContent = settingsSnapshot.feishu.secretConfigured ? "已配置签名" : "未配置";
  return settingsSnapshot;
}

function settingsPayload() {
  return {
    ai: {
      enabled: $("#aiEnabled").checked,
      baseUrl: $("#aiBaseUrl").value.trim(),
      model: $("#aiModel").value.trim(),
      apiMode: $("#aiApiMode").value,
      reasoningEffort: $("#aiReasoning").value,
      threshold: Number($("#aiThreshold").value),
      includeImages: $("#aiIncludeImages").checked,
      apiKey: $("#aiApiKey").value.trim(),
    },
    feishu: {
      enabled: $("#feishuEnabled").checked,
      webhookUrl: $("#feishuWebhook").value.trim(),
      secret: $("#feishuSecret").value.trim(),
    },
  };
}

async function saveSettingsForm() {
  const button = $("#settingsForm .primary-button");
  button.disabled = true;
  $("#settingsSaveStatus").textContent = "正在保存…";
  try {
    settingsSnapshot = await api("/api/settings", { method: "PUT", body: JSON.stringify(settingsPayload()) });
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
  $("#ruleThreshold").value = topic.ai?.threshold ?? "";
  $("#ruleNotify").checked = topic.ai?.notify !== false;
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
      threshold: $("#ruleThreshold").value,
      notify: $("#ruleNotify").checked,
    },
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
  const matchedCount = evaluations.filter((item) => item.matched).length;
  const notifiedCount = evaluations.filter((item) => item.notified).length;
  $("#aiMetricTotal").textContent = numberFormat.format(evaluations.length);
  $("#aiMetricMatched").textContent = numberFormat.format(matchedCount);
  $("#aiMetricNotified").textContent = numberFormat.format(notifiedCount);
  const rows = historyFilter === "matched" ? evaluations.filter((item) => item.matched) : evaluations;
  aiHistory.innerHTML = rows.length ? rows.map((item) => {
    const stateClass = item.status === "error" ? "error" : item.matched ? "" : "miss";
    const icon = item.status === "error" ? "ph-warning" : item.matched ? "ph-sparkle" : "ph-check";
    const delivery = item.notified ? "已通知" : item.notificationError ? "通知失败" : item.matched ? "未通知" : "";
    return `<article class="history-item ${stateClass}">
      <span class="history-icon"><i class="ph ${icon}"></i></span>
      <div class="history-main"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.reason)}</p>${item.imageFallback ? '<small class="ai-input-note"><i class="ph ph-text-t"></i> 已按文本完成判断</small>' : ""}</div>
      <div class="history-meta"><b>${Math.round(item.confidence * 100)}%</b><span>${delivery}</span><time>${item.evaluatedAt ? `<br>${dateTimeFormat.format(new Date(item.evaluatedAt))}` : ""}</time></div>
    </article>`;
  }).join("") : `<div class="page-empty-state"><span><i class="ph ph-sparkle"></i></span><h3>${historyFilter === "matched" ? "还没有 AI 命中" : "还没有判断记录"}</h3><p>启用 AI 并设置话题关注意图后，新抓取的动态会自动进入这里。</p><button type="button" data-open-settings><i class="ph ph-gear-six"></i>配置 AI 连接</button></div>`;
}

function showAiCenter() {
  renderAiHistory();
  showView("ai");
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
  renderSidebar();
  renderFeed();
});

feedList.addEventListener("click", (event) => {
  const picture = event.target.closest("[data-lightbox]");
  if (picture) { event.preventDefault(); event.stopPropagation(); return openLightbox(picture); }
  const button = event.target.closest("[data-feed-id]");
  if (!button) return;
  const feed = activeTopicTag === "__all__"
    ? topics.flatMap((topic) => (topic.feeds || []).map((item) => ({ ...item, __monitorTopicTag: topic.tag, __monitorTopicTitle: topic.detail?.title || topic.tag }))).find((item) => String(item.id) === button.dataset.feedId)
    : activeTopic()?.feeds?.find((item) => String(item.id) === button.dataset.feedId);
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
    renderSidebar();
    renderFeed();
    renderMetrics();
    toast(`已停止监控 #${topic.tag}`);
  } catch (error) { toast(error.message, "error"); }
});

detailContent.addEventListener("click", async (event) => {
  const picture = event.target.closest("[data-lightbox]");
  if (picture) return openLightbox(picture);
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

$("#analyzeCurrent").addEventListener("click", async () => {
  const topic = activeTopic();
  const button = $("#analyzeCurrent");
  if (!topic || !(await saveRule())) return;
  button.disabled = true;
  button.innerHTML = '<i class="ph ph-circle-notch"></i> AI 分析中';
  $("#ruleSaveStatus").textContent = "逐条判断当前内容，可能需要一些时间…";
  try {
    const result = await api(`/api/topics/${encodeURIComponent(topic.tag)}/analyze`, { method: "POST", body: JSON.stringify({ force: true, notify: false }) });
    const ids = new Set(result.evaluations.map((item) => item.id));
    evaluations = [...result.evaluations, ...evaluations.filter((item) => !ids.has(item.id))];
    $("#ruleSaveStatus").textContent = `已完成 ${result.count} 条判断`;
    renderSidebar(); renderFeed(); renderMetrics(); if (activeDetail) renderDetail(); updateMatchCount();
    toast(`AI 已完成 ${result.count} 条判断`);
  } catch (error) { $("#ruleSaveStatus").textContent = error.message; toast(error.message, "error"); }
  finally { button.disabled = false; button.innerHTML = '<i class="ph ph-play"></i> 分析当前 10 条'; }
});

$$('[data-history-filter]').forEach((button) => button.addEventListener("click", () => {
  historyFilter = button.dataset.historyFilter;
  $$('[data-history-filter]').forEach((item) => item.classList.toggle("active", item === button));
  renderAiHistory();
}));

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

$("#closeDetail").addEventListener("click", () => closeDialog(detailDialog));
detailDialog.addEventListener("close", () => {
  activeFeedId = "";
  activeDetail = null;
  renderFeed();
  if (location.hash.startsWith("#feed-")) history.replaceState(null, "", `${location.pathname}${location.search}`);
});
feedFilter.addEventListener("input", () => {
  feedFilterValue = feedFilter.value;
  renderFeed();
});
$("#matchedFilter").addEventListener("click", () => {
  feedAiFilter = feedAiFilter === "all" ? "matched" : "all";
  $("#matchedFilter span").textContent = feedAiFilter === "matched" ? "仅看 AI 命中" : "全部状态";
  renderFeed();
});
$("#sortOrder").addEventListener("click", () => {
  feedSortOrder = feedSortOrder === "desc" ? "asc" : "desc";
  $("#sortOrder span").textContent = feedSortOrder === "desc" ? "最新发布" : "最早发布";
  renderFeed();
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
