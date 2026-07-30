import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const publicFile = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
const indexHtml = readFileSync(publicFile("index.html"), "utf8");
const appJs = readFileSync(publicFile("app.js"), "utf8");

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function openingTags(source, name) {
  return source.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) || [];
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2] ?? "";
}

function tagWith(source, name, attributeName, value) {
  return openingTags(source, name).find((tag) => attribute(tag, attributeName) === value) || "";
}

function elementBlockById(source, name, id) {
  const start = tagWith(source, name, "id", id);
  if (!start) return "";
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(`</${name}>`, startIndex + start.length);
  return endIndex < 0 ? start : source.slice(startIndex, endIndex + name.length + 3);
}

function declaredIds(source) {
  const ids = new Set();
  const pattern = /\bid\s*=\s*(["'`])([A-Za-z][\w:-]*)\1/g;
  for (const match of source.matchAll(pattern)) ids.add(match[2]);
  return ids;
}

function directlyQueriedStaticIds(source) {
  const ids = new Set();
  const patterns = [
    /\$\(\s*(["'`])#([A-Za-z][\w:-]*)\1\s*(?:,|\))/g,
    /getElementById\(\s*(["'`])([A-Za-z][\w:-]*)\1\s*\)/g,
    /querySelector(?:All)?\(\s*(["'`])#([A-Za-z][\w:-]*)\1\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) ids.add(match[2]);
  }
  return ids;
}

function assertIds(source, group, ids) {
  const available = declaredIds(source);
  const missing = ids.filter((id) => !available.has(id));
  assert.deepEqual(missing, [], `${group} missing fixed IDs: ${missing.join(", ")}`);
}

test("keeps the fixed shell, dialog, rule and lightbox initialization IDs", () => {
  assertIds(indexHtml, "navigation and search", [
    "sideRail",
    "primaryNavigation",
    "mobileMenu",
    "viewHost",
    "toastRegion",
    "globalSearchForm",
    "globalSearchInput",
    "composeTrigger",
    "quickRefresh",
    "themeToggle",
    "accountChip",
    "monitorNavCount",
    "notificationNavCount",
    "aiNavCount",
    "liveDot",
    "railStatusTitle",
    "railStatusText",
    "collapseRail",
  ]);

  assertIds(indexHtml, "dialogs", [
    "feedDialog",
    "feedDialogBody",
    "appDialog",
    "appDialogBody",
    "topicDialog",
    "topicDialogBody",
    "userDialog",
    "userDialogBody",
    "collectionDialog",
    "collectionDialogBody",
    "composeDialog",
    "composeForm",
    "ruleDialog",
    "ruleForm",
  ]);

  assertIds(indexHtml, "rule form", [
    "ruleDialogSubtitle",
    "keywordFields",
    "aiFields",
    "ruleKeywords",
    "ruleIntent",
    "ruleExclude",
    "ruleThreshold",
    "ruleSort",
    "ruleLimit",
    "ruleNotify",
    "ruleStatus",
    "analyzeRule",
  ]);

  assertIds(indexHtml, "lightbox", [
    "lightbox",
    "lightboxCaption",
    "lightboxCounter",
    "lightboxOriginal",
    "lightboxPrevious",
    "lightboxNext",
    "lightboxStage",
    "lightboxLoading",
    "lightboxImage",
    "lightboxError",
    "lightboxRetry",
    "lightboxThumbs",
    "zoomOut",
    "zoomReset",
    "zoomIn",
  ]);
});

test("every static ID queried directly by app.js is declared by static or rendered markup", () => {
  const queried = directlyQueriedStaticIds(appJs);
  const declared = declaredIds(`${indexHtml}\n${appJs}`);
  const missing = [...queried].filter((id) => !declared.has(id)).sort();

  assert.ok(queried.size > 50, "expected to discover the app's direct static ID queries");
  assert.deepEqual(missing, [], `app.js queries IDs that no template declares: ${missing.join(", ")}`);
});

test("keeps homepage interaction hooks and every supported application route", () => {
  const homepageHooks = ["home-channel", "home-load-more", "smart-link", "route-refresh"];
  for (const hook of homepageHooks) {
    assert.match(appJs, new RegExp(`\\bdata-${escapeRegExp(hook)}\\b`), `missing data-${hook} markup hook`);
    assert.match(appJs, new RegExp(`\\[data-${escapeRegExp(hook)}\\]`), `missing data-${hook} delegated handler`);
  }

  const supportedRoutes = [
    "home",
    "channel",
    "discover",
    "apps",
    "topics",
    "notifications",
    "account",
    "monitor",
    "ai",
    "settings",
    "search",
  ];
  const parseRouteBody = appJs.match(/function\s+parseRoute\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  const rendererBody = appJs.match(/\bconst\s+renderers\s*=\s*\{([^}]+)\}/)?.[1] || "";
  assert.ok(parseRouteBody, "parseRoute() must remain available");
  assert.ok(rendererBody, "the route renderer table must remain available");

  for (const route of supportedRoutes) {
    assert.match(parseRouteBody, new RegExp(`["']${escapeRegExp(route)}["']`), `route "${route}" is no longer accepted`);
    assert.match(rendererBody, new RegExp(`(?:^|,)\\s*${escapeRegExp(route)}\\s*:`), `route "${route}" has no renderer`);
  }

  for (const route of ["home", "discover", "apps", "topics", "monitor", "notifications", "account", "ai", "settings"]) {
    assert.match(indexHtml, new RegExp(`data-nav\\s*=\\s*(["'])${escapeRegExp(route)}\\1`), `missing data-nav hook for "${route}"`);
  }
  assert.match(appJs, /\[data-nav\]/, "navigation hooks must remain connected to app.js");
});

test("horizontal header navigation and utility menus remain linked and accessible", () => {
  const header = openingTags(indexHtml, "header").find((tag) => attribute(tag, "class").split(/\s+/).includes("global-header"));
  assert.ok(header, "the horizontal global header is missing");

  const mobileMenu = tagWith(indexHtml, "button", "id", "mobileMenu");
  assert.ok(attribute(mobileMenu, "aria-label"), "mobile navigation control needs an aria-label");
  assert.equal(attribute(mobileMenu, "aria-controls"), "primaryNavigation");
  assert.equal(attribute(mobileMenu, "aria-expanded"), "false");

  const primaryNavigation = elementBlockById(indexHtml, "nav", "primaryNavigation");
  assert.ok(primaryNavigation, "primary navigation is missing");
  assert.ok(attribute(tagWith(primaryNavigation, "nav", "id", "primaryNavigation"), "aria-label"), "primary navigation needs an aria-label");
  for (const route of ["home", "discover", "apps", "topics", "monitor"]) {
    const link = openingTags(primaryNavigation, "a").find((tag) => attribute(tag, "data-nav") === route);
    assert.ok(link, `primary navigation is missing "${route}"`);
    assert.equal(attribute(link, "href"), `#/${route}`, `"${route}" must use an in-app link`);
  }

  const notification = openingTags(indexHtml, "a").find((tag) => attribute(tag, "data-nav") === "notifications");
  assert.equal(attribute(notification, "href"), "#/notifications");
  assert.ok(attribute(notification, "aria-label"), "notification link needs an aria-label");

  const account = tagWith(indexHtml, "a", "id", "accountChip");
  assert.equal(attribute(account, "href"), "#/account");
  assert.equal(attribute(account, "data-nav"), "account");
  assert.ok(attribute(account, "aria-label"), "account link needs an aria-label");

  const more = openingTags(indexHtml, "details").find((tag) => attribute(tag, "class").split(/\s+/).includes("header-more"));
  assert.ok(more, "the more menu is missing");
  const moreStart = indexHtml.indexOf(more);
  const moreEnd = indexHtml.indexOf("</details>", moreStart);
  const moreBlock = indexHtml.slice(moreStart, moreEnd + "</details>".length);
  assert.ok(attribute(openingTags(moreBlock, "summary")[0] || "", "aria-label"), "more menu trigger needs an aria-label");
  const moreNav = openingTags(moreBlock, "nav")[0] || "";
  assert.ok(attribute(moreNav, "aria-label"), "more menu needs an aria-label");
  for (const route of ["ai", "settings"]) {
    const link = openingTags(moreBlock, "a").find((tag) => attribute(tag, "data-nav") === route);
    assert.equal(attribute(link, "href"), `#/${route}`, `more menu "${route}" link is not usable`);
  }

  for (const action of ["compose", "refresh", "theme"]) {
    assert.ok(
      openingTags(moreBlock, "button").some((tag) => attribute(tag, "data-header-action") === action),
      `more menu is missing the compact "${action}" action`,
    );
  }
  for (const route of ["notifications", "account"]) {
    assert.ok(
      openingTags(moreBlock, "a").some((tag) => attribute(tag, "data-nav") === route),
      `more menu is missing the mobile "${route}" route`,
    );
  }

  assert.match(appJs, /Promise\.race\(\[loadState,\s*new Promise/, "home initialization must keep a bounded first render");
});

test("styles-v4 uses scoped transitions and honors responsive motion preferences when present", (context) => {
  const stylesheet = publicFile("styles-v4.css");
  if (!existsSync(stylesheet)) {
    context.skip("styles-v4.css has not been introduced");
    return;
  }

  const css = readFileSync(stylesheet, "utf8");
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(withoutComments, /\btransition\s*:\s*all\b/i, "avoid transition: all; enumerate animated properties");
  assert.match(withoutComments, /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/i);

  const maxWidths = [...withoutComments.matchAll(/@media[^{]*\(\s*max-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)/gi)]
    .map((match) => Number(match[1]));
  assert.ok(maxWidths.some((width) => width > 800 && width <= 1280), "missing a desktop/tablet responsive breakpoint");
  assert.ok(maxWidths.some((width) => width <= 800), "missing a mobile responsive breakpoint");
});
