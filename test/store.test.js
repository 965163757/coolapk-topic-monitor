import test from "node:test";
import assert from "node:assert/strict";
import { appendArchiveEvent, archiveFeed, archiveSummary, archiveUser, cleanupArchive, createArchive, evaluationSummary, latestEvaluations, normalizeRetention, pendingContinuationStart, queryArchiveFeeds } from "../lib/store.js";

test("archives feeds idempotently while preserving discovery metadata", () => {
  const archive = createArchive();
  archiveFeed(archive, { id: 42, title: "first", userId: "7", createdAt: 1 }, { topic: "优惠", sourceKey: "topic:优惠", now: "2026-01-01T00:00:00.000Z" });
  archiveFeed(archive, { id: 42, title: "updated", userId: "7", createdAt: 1 }, { topic: "数码", sourceKey: "product:1", now: "2026-01-02T00:00:00.000Z" });
  assert.equal(Object.keys(archive.feeds).length, 1);
  assert.equal(archive.feeds["42"].title, "updated");
  assert.deepEqual(archive.feeds["42"].topicTags.sort(), ["优惠", "数码"]);
  assert.deepEqual(archive.feeds["42"].sourceKeys.sort(), ["product:1", "topic:优惠"]);
});

test("cleans records by retention period and record cap", () => {
  const archive = createArchive({
    feeds: {
      old: { id: "old", lastSeenAt: "2025-01-01T00:00:00.000Z" },
      keep: { id: "keep", lastSeenAt: "2026-01-10T00:00:00.000Z" },
      newest: { id: "newest", lastSeenAt: "2026-01-11T00:00:00.000Z" },
    },
    evaluations: [
      { id: "old-eval", evaluatedAt: "2025-01-01T00:00:00.000Z" },
      { id: "keep-eval", evaluatedAt: "2026-01-11T00:00:00.000Z" },
    ],
  });
  archiveUser(archive, { uid: "1", username: "old" }, "2025-01-01T00:00:00.000Z");
  appendArchiveEvent(archive, { id: "old-event", createdAt: "2025-01-01T00:00:00.000Z" });
  const retention = normalizeRetention({ feedDays: 10, evaluationDays: 10, eventDays: 10, userDays: 10, maxFeeds: 1, maxEvaluations: 10, maxEvents: 10 });
  const result = cleanupArchive(archive, retention, new Date("2026-01-12T00:00:00.000Z").getTime());
  assert.deepEqual(Object.keys(archive.feeds).sort(), ["keep", "newest"]);
  assert.equal(archive.evaluations.length, 1);
  assert.equal(Object.keys(archive.users).length, 0);
  assert.equal(archive.events.length, 0);
  assert.equal(result.removed.feeds, 1);
  assert.equal(archiveSummary(archive).feeds, 2);
});

test("queries monitored archive feeds with stable pagination and latest evaluations", () => {
  const archive = createArchive();
  for (let index = 1; index <= 35; index += 1) {
    archiveFeed(archive, { id: index, title: `优惠 ${index}`, createdAt: index, updatedAt: index, likes: index }, { topic: "优惠", sourceKey: "topic:优惠" });
  }
  archive.evaluations = [
    { id: "old", topic: "优惠", feedId: "35", matchScore: 0.1, matched: false, status: "completed", evaluatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "new", topic: "优惠", feedId: "35", matchScore: 0.9, matched: true, notified: true, status: "completed", evaluatedAt: "2026-01-02T00:00:00.000Z" },
  ];
  const topics = [{ tag: "优惠", sourceKey: "topic:优惠", detail: { title: "优惠" } }];
  const page = queryArchiveFeeds(archive, { topics, topic: "优惠", page: 2, pageSize: 20, sort: "created_desc" });
  assert.equal(page.total, 35);
  assert.equal(page.feeds.length, 15);
  assert.equal(page.page, 2);
  assert.equal(page.totalPages, 2);
  assert.equal(latestEvaluations(archive.evaluations).length, 1);
  assert.deepEqual(evaluationSummary(archive.evaluations), { total: 1, matched: 1, notified: 1, errors: 0 });

  const matched = queryArchiveFeeds(archive, { topics, monitoredOnly: true, aiStatus: "matched", pageSize: 20, sort: "ai_desc" });
  assert.equal(matched.total, 1);
  assert.equal(matched.feeds[0].id, "35");
  assert.equal(matched.feeds[0].evaluation.id, "new");
});

test("uses every monitored topic association when filtering AI matches", () => {
  const archive = createArchive();
  archiveFeed(archive, { id: "shared", title: "共享帖子", createdAt: 1 }, { topic: "话题A", sourceKey: "topic:A" });
  archiveFeed(archive, { id: "shared", title: "共享帖子", createdAt: 1 }, { topic: "话题B", sourceKey: "topic:B" });
  archive.evaluations = [
    { id: "a", topic: "话题A", feedId: "shared", matchScore: 0.4, matched: false, threshold: 0.7, scoreVersion: 2, status: "completed", evaluatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "b", topic: "话题B", feedId: "shared", matchScore: 0.9, matched: true, threshold: 0.7, scoreVersion: 2, status: "completed", evaluatedAt: "2026-01-01T00:00:01.000Z" },
  ];
  const topics = [
    { tag: "话题A", sourceKey: "topic:A", effectiveThreshold: 0.7 },
    { tag: "话题B", sourceKey: "topic:B", effectiveThreshold: 0.7 },
  ];
  const allMatches = queryArchiveFeeds(archive, { topics, aiStatus: "matched" });
  assert.equal(allMatches.total, 1);
  assert.equal(allMatches.feeds[0].monitorTopicTag, "话题B");
  assert.equal(allMatches.feeds[0].monitorAssociations.length, 2);
  assert.equal(queryArchiveFeeds(archive, { topics, topic: "话题A", aiStatus: "matched" }).total, 0);
  assert.equal(queryArchiveFeeds(archive, { topics, topic: "话题B", aiStatus: "matched" }).total, 1);
});

test("recomputes score-based matches with the current topic threshold", () => {
  const archive = createArchive();
  archiveFeed(archive, { id: "threshold", title: "阈值测试", createdAt: 1 }, { topic: "优惠", sourceKey: "topic:优惠" });
  archive.evaluations = [{
    id: "evaluated-at-70", topic: "优惠", feedId: "threshold", matchScore: 0.8, matched: true,
    threshold: 0.7, scoreVersion: 2, status: "completed", evaluatedAt: "2026-01-01T00:00:00.000Z",
  }];
  const topics = [{ tag: "优惠", sourceKey: "topic:优惠", effectiveThreshold: 0.9 }];
  const page = queryArchiveFeeds(archive, { topics, topic: "优惠" });
  assert.equal(page.feeds[0].evaluation.matchedAtEvaluation, true);
  assert.equal(page.feeds[0].evaluation.thresholdAtEvaluation, 0.7);
  assert.equal(page.feeds[0].evaluation.currentThreshold, 0.9);
  assert.equal(page.feeds[0].evaluation.matched, false);
  assert.equal(queryArchiveFeeds(archive, { topics, topic: "优惠", aiStatus: "matched" }).total, 0);
  assert.deepEqual(evaluationSummary(archive.evaluations, topics), { total: 1, matched: 0, notified: 0, errors: 0 });
});

test("shifts a pending continuation after new front pages without leaving a gap", () => {
  // 上轮已处理到第 10 页、待续第 11 页；本轮新增 3 页后，旧第 11 页移动到第 14 页。
  // 从第 13 页重叠续抓可覆盖边界，不会直接从旧坐标第 10 页跳走。
  assert.equal(pendingContinuationStart(11, 4), 13);
  assert.equal(pendingContinuationStart(11, 1), 10);
});
