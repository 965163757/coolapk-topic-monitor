import test from "node:test";
import assert from "node:assert/strict";
import { appendArchiveEvent, archiveFeed, archiveSummary, archiveUser, cleanupArchive, createArchive, normalizeRetention } from "../lib/store.js";

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
