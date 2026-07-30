const CHANNELS = Object.freeze({
  home: {
    title: "首页推荐",
    description: "酷安头条、精选内容与热门入口",
    path: "/main/indexV8",
    params: {},
  },
  news: {
    title: "科技快讯",
    description: "数码与科技行业的新鲜消息",
    path: "/page/dataList",
    params: { url: "V11_HOME_TAB_NEWS" },
  },
  questions: {
    title: "问答",
    description: "酷友正在讨论的问题与回答",
    path: "/page/dataList",
    params: { url: "V9_HOME_TAB_WENDA" },
  },
  chat: {
    title: "闲聊",
    description: "社区日常与轻松话题",
    path: "/page/dataList",
    params: { url: "V8_HUODONG_XIANLIAO_20210523" },
  },
  new_devices: {
    title: "新机",
    description: "新设备发布与上手体验",
    path: "/page/dataList",
    params: { url: "V11_HOME_NEW" },
  },
  unboxing: {
    title: "开箱",
    description: "新品开箱与第一印象",
    path: "/page/dataList",
    params: { url: "V13_IOSHOME_OPENSHOW" },
  },
  photography: {
    title: "摄影",
    description: "手机摄影与影像创作",
    path: "/page/dataList",
    params: { url: "V13_HOME_SHEYING" },
  },
  tutorials: {
    title: "教程",
    description: "实用教程与玩机技巧",
    path: "/page/dataList",
    params: { url: "V11_HOME_TAB_JC" },
  },
  cars: {
    title: "汽车",
    description: "智能汽车与出行科技",
    path: "/page/dataList",
    params: { url: "V11_HOME_CAR" },
  },
  peripherals: {
    title: "外设",
    description: "键鼠、显示器与桌面设备",
    path: "/page/dataList",
    params: { url: "V14_WAISHE" },
  },
  videos: {
    title: "视频",
    description: "社区视频内容",
    path: "/page/dataList",
    params: { url: "V9_HOME_TAB_SHIPIN" },
  },
  customization: {
    title: "美化",
    description: "主题、桌面与系统美化",
    path: "/page/dataList",
    params: { url: "V11_HOME_MEIHUA" },
  },
  goods: {
    title: "好物",
    description: "酷友推荐的实用好物",
    path: "/page/dataList",
    params: { url: "V11_FIND_GOOD_GOODS_HOME" },
  },
  second_hand: {
    title: "二手",
    description: "社区二手交易信息",
    path: "/page/dataList",
    params: { url: "#/feed/ershouList" },
  },
  ratings: {
    title: "评分",
    description: "设备与应用评分内容",
    path: "/page/dataList",
    params: { url: "#/apk/appList?rankType=rating&cacheExpires=300&withRankCard=1&showSerialNumber=1&forumApp=0" },
  },
  pictures: {
    title: "酷图",
    description: "摄影、桌面与设备美图",
    path: "/page/dataList",
    params: { url: "V11_FIND_COOLPIC" },
  },
  digital: {
    title: "数码",
    description: "手机、电脑、耳机与智能设备",
    path: "/page/dataList",
    params: { url: "V10_DIGITAL_HOME" },
  },
  topics: {
    title: "热门话题",
    description: "正在升温的社区话题",
    path: "/page/dataList",
    params: { url: "V9_HOME_TAB_TOPIC" },
  },
  apps: {
    title: "应用与游戏",
    description: "应用更新、游戏与酷友点评",
    path: "/apk/index",
    params: {},
  },
  market: {
    title: "应用精选",
    description: "应用分类、排行榜与编辑精选",
    path: "/page/dataList",
    params: { url: "V10_MARKET_HOME" },
  },
  games: {
    title: "游戏",
    description: "热门游戏与玩家点评",
    path: "/page/dataList",
    params: { url: "V8_MARKET_GAME" },
  },
  app_rankings: {
    title: "应用排行",
    description: "应用与游戏排行榜",
    path: "/page/dataList",
    params: { url: "V10_MARKET_RANK" },
  },
});

export function webChannels() {
  return Object.entries(CHANNELS).map(([key, value]) => ({
    key,
    title: value.title,
    description: value.description,
  }));
}

export function webChannelConfig(value) {
  const key = String(value || "").trim().toLowerCase();
  return CHANNELS[key] ? { key, ...CHANNELS[key], params: { ...CHANNELS[key].params } } : null;
}

export function normalizePageKey(value) {
  const key = String(value || "").trim();
  return /^[A-Za-z][A-Za-z0-9_]{2,99}$/.test(key) ? key : "";
}

export function normalizePageTarget(value) {
  const target = String(value || "").trim();
  const pageKey = normalizePageKey(target);
  if (pageKey) return pageKey;
  if (!target || target.length > 600 || /[\r\n\\]/.test(target) || /(?:^|\/)\.\.(?:\/|$)|%2e/i.test(target)) return "";
  const allowed = [
    /^#\/feed\/(?:digestList|multiTagFeedList|headlineV8List|coolPictureList|ershouList|mediaList|targetFeedList)(?:\?|$)/,
    /^#\/topic\/(?:hotTagList|tagList|userFollowTagList)(?:\?|$)/,
    /^#\/product\/unreleasedProductList(?:\?|$)/,
    /^#\/article\/(?:articlesList|includeFeedList)(?:\?|$)/,
    /^#\/apk\/(?:apkStatList|appList|realRankList)(?:\?|$)/,
    /^\/apk\/(?:category|categoryList|recommendList|updateList)(?:\?|$)/,
    /^\/product\/(?:categoryList|categoryDetailList)(?:\?|$)/,
  ];
  return allowed.some((pattern) => pattern.test(target)) ? target : "";
}

export function collectEntities(value, predicate, depth = 0, result = []) {
  if (depth > 5 || value == null) return result;
  if (Array.isArray(value)) {
    value.forEach((item) => collectEntities(item, predicate, depth + 1, result));
    return result;
  }
  if (typeof value !== "object") return result;
  if (predicate(value)) result.push(value);
  if (Array.isArray(value.entities)) collectEntities(value.entities, predicate, depth + 1, result);
  return result;
}

export function appSummary(app = {}) {
  const scoreV10 = Number(app.score_v10);
  const score = Number.isFinite(scoreV10) && scoreV10 > 0 ? scoreV10 : Number(app.score || 0) * 2;
  return {
    id: String(app.id || app.entityId || ""),
    title: String(app.title || app.shorttitle || "未命名应用"),
    subtitle: String(app.subtitle || app.description || ""),
    packageName: String(app.apkname || app.packageName || ""),
    logo: String(app.logo || app.icon || ""),
    cover: String(app.cover || ""),
    version: String(app.version || app.apkversionname || ""),
    size: String(app.apksize || ""),
    score: Math.max(0, Math.min(10, Number(score.toFixed(1)) || 0)),
    category: String(app.catName || app.apkTypeName || ""),
    developer: String(app.developername || ""),
    downloads: Number(app.downnum || 0),
    downloadText: String(app.downCount || ""),
    followers: Number(app.follownum || 0),
    comments: Number(app.commentnum || 0),
    hot: Number(app.hot_num || 0),
    updatedAt: Number(app.lastupdate || 0) * 1000,
    changelog: String(app.changelog || ""),
    description: String(app.description || ""),
    url: String(app.url || app.apkUrl || (app.apkname ? `/apk/${app.apkname}` : "")),
  };
}

function visualLink(item = {}) {
  return {
    title: String(item.title || ""),
    subtitle: String(
      item.subtitle
      || item.description
      || item.tags
      || (Number(item.product_num) > 0 ? `${Number(item.product_num)} 个产品` : ""),
    ),
    picture: String(item.pic || item.logo || item.cover || ""),
    url: String(item.url || ""),
    entityType: String(item.entityType || ""),
  };
}

export function pageDecorations(data) {
  const cards = collectEntities(data, (item) => item.entityType === "card");
  const directories = collectEntities(
    data,
    (item) => ["category", "productBrand"].includes(String(item.entityType || "")),
  ).map(visualLink).filter((item) => item.title && item.url);
  const banners = [];
  const shortcuts = [];
  const sections = [];
  for (const card of cards) {
    const items = Array.isArray(card.entities) ? card.entities.map(visualLink).filter((item) => item.title) : [];
    if (!items.length) continue;
    const template = String(card.entityTemplate || "");
    if (/carousel|banner/i.test(template)) banners.push(...items);
    else if (/icon|link/i.test(template)) shortcuts.push(...items);
    if (card.title) sections.push({ title: String(card.title), template, items: items.slice(0, 12) });
  }
  return {
    banners: [...new Map(banners.map((item) => [`${item.title}:${item.picture}`, item])).values()].slice(0, 8),
    shortcuts: [...new Map(shortcuts.map((item) => [item.title, item])).values()].slice(0, 12),
    sections: sections.slice(0, 8),
    directories: [...new Map(directories.map((item) => [item.url, item])).values()].slice(0, 50),
  };
}

export function uniqueSummaries(items, key = "id") {
  return [...new Map(items.filter(Boolean).map((item) => [String(item?.[key] || ""), item])).values()]
    .filter((item) => String(item?.[key] || ""));
}

function epochMs(value) {
  const timestamp = Number(value || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
  return timestamp > 9_999_999_999 ? timestamp : timestamp * 1000;
}

function cookieValue(value) {
  return String(value || "").trim().replace(/[\r\n;]/g, "");
}

export function sessionCookieHeader(session = {}) {
  const uid = cookieValue(session.uid);
  const username = cookieValue(session.username);
  const token = cookieValue(session.token);
  if (!uid || !username || !token) return "";
  return `uid=${uid}; username=${encodeURIComponent(username)}; token=${token}`;
}

export function collectionSummary(collection = {}) {
  return {
    id: String(collection.id || collection.entityId || ""),
    title: String(collection.title || collection.name || "未命名收藏单"),
    subtitle: String(collection.subTitle || collection.subtitle || ""),
    description: String(collection.description || collection.intro || ""),
    cover: String(collection.cover_pic || collection.cover || collection.pic || ""),
    itemCount: Number(collection.item_num || collection.itemCount || 0),
    followers: Number(collection.follow_num || collection.follownum || 0),
    likes: Number(collection.like_num || collection.likenum || 0),
    followed: Boolean(collection.userAction?.follow || collection.followed),
    liked: Boolean(collection.userAction?.like || collection.liked),
    url: String(collection.url || (collection.id ? `/collection/${collection.id}` : "")),
  };
}

export function relationshipUserSource(item = {}) {
  if (item.fUserInfo && typeof item.fUserInfo === "object") return item.fUserInfo;
  if (item.userInfo && typeof item.userInfo === "object") return item.userInfo;
  if (item.fuid || item.fusername || item.fUserAvatar) {
    return {
      uid: item.fuid,
      username: item.fusername,
      userAvatar: item.fUserAvatar,
      cover: item.fUserCover || "",
      level: item.flevel || 0,
    };
  }
  return item;
}

export function notificationSummary(item = {}, type = "list") {
  const actor = item.fromUserInfo || item.likeUserInfo || item.messageUserInfo || item.userInfo || {};
  const username = String(
    item.fromusername
    || item.likeUsername
    || item.username
    || actor.username
    || "酷友",
  );
  const avatar = String(
    item.fromUserAvatar
    || item.likeAvatar
    || item.userAvatar
    || actor.userAvatar
    || "",
  );
  const uid = String(
    item.fromuid
    || item.likeUid
    || item.uid
    || actor.uid
    || actor.id
    || "",
  );
  const title = String(
    item.feedTypeName
      ? `${username} 赞了你的${item.feedTypeName}`
      : item.title || item.infoHtml || item.note || `${username} 发来一条通知`,
  );
  const message = String(item.message || item.note || item.extra_title || item.infoHtml || "");
  const url = String(item.url || item.ukey || "");
  const feedMatch = url.match(/\/feed\/(\d+)/);
  return {
    id: String(item.id || item.entityId || `${type}:${uid}:${item.dateline || item.likeTime || ""}`),
    type,
    title,
    message,
    username,
    uid,
    avatar,
    url,
    feedId: String(item.fid || item.feed_id || item.feedId || feedMatch?.[1] || ""),
    createdAt: epochMs(item.dateline || item.likeTime || item.create_time),
    unread: item.is_read == null ? true : !Boolean(Number(item.is_read)),
  };
}

export function messageSummary(item = {}) {
  const user = item.messageUserInfo || item.userInfo || {};
  return {
    id: String(item.id || item.entityId || item.ukey || ""),
    ukey: String(item.ukey || ""),
    uid: String(item.uid || user.uid || user.id || ""),
    username: String(item.username || user.username || "酷友"),
    avatar: String(item.userAvatar || user.userAvatar || ""),
    message: String(item.message || item.last_message || ""),
    createdAt: epochMs(item.dateline || item.lastupdate || item.create_time),
    unreadCount: Number(item.unreadNum || item.unread_num || item.unread || 0),
    pinned: Boolean(Number(item.is_top || 0)),
  };
}
