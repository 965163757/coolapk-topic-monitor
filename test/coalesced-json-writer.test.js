import assert from "node:assert/strict";
import test from "node:test";
import { CoalescedJsonWriter } from "../lib/coalesced-json-writer.js";

test("deferred dirty marks share one scheduled snapshot", async () => {
  let value = { count: 1 };
  const writes = [];
  let scheduledCallback;
  let schedules = 0;
  const writer = new CoalescedJsonWriter({
    getValue: () => value,
    write: async (payload) => writes.push(payload),
    setTimer(callback) {
      schedules += 1;
      scheduledCallback = callback;
      return { unref() {} };
    },
    clearTimer() {
      scheduledCallback = null;
    },
  });

  writer.markDirty();
  value = { count: 2 };
  writer.markDirty();

  assert.equal(schedules, 1);
  assert.equal(writes.length, 0);
  scheduledCallback();
  await writer.flush();

  assert.deepEqual(writes, ['{\n  "count": 2\n}']);
  assert.equal(writer.stats().dirty, false);
});

test("a mutation arriving during a write is included before flush resolves", async () => {
  let value = { count: 1 };
  const writes = [];
  let releaseFirstWrite;
  const firstWriteGate = new Promise((resolve) => {
    releaseFirstWrite = resolve;
  });
  const writer = new CoalescedJsonWriter({
    getValue: () => value,
    write: async (payload) => {
      writes.push(payload);
      if (writes.length === 1) await firstWriteGate;
    },
  });

  const save = writer.save();
  await Promise.resolve();
  assert.equal(writes.length, 1);

  value = { count: 2 };
  writer.markDirty({ schedule: false });
  releaseFirstWrite();
  await save;

  assert.equal(writes.length, 2);
  assert.match(writes[1], /"count": 2/);
  assert.equal(writer.stats().dirty, false);
});

test("defer cancels an automatic flush but keeps the revision for a batch commit", async () => {
  const writes = [];
  let scheduledCallback;
  const writer = new CoalescedJsonWriter({
    getValue: () => ({ batch: "complete" }),
    write: async (payload) => writes.push(payload),
    setTimer(callback) {
      scheduledCallback = callback;
      return { unref() {} };
    },
    clearTimer() {
      scheduledCallback = null;
    },
  });

  writer.markDirty();
  writer.defer();

  assert.equal(scheduledCallback, null);
  assert.equal(writer.stats().dirty, true);
  assert.equal(writes.length, 0);
  await writer.save();
  assert.equal(writes.length, 1);
  assert.equal(writer.stats().dirty, false);
});

test("failed background writes remain dirty and can be flushed safely", async () => {
  let attempts = 0;
  let scheduledCallback;
  const errors = [];
  const writer = new CoalescedJsonWriter({
    getValue: () => ({ ok: true }),
    write: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("disk unavailable");
    },
    onBackgroundError: (error) => errors.push(error.message),
    setTimer(callback) {
      scheduledCallback = callback;
      return { unref() {} };
    },
    clearTimer() {
      scheduledCallback = null;
    },
  });

  writer.markDirty();
  scheduledCallback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(errors, ["disk unavailable"]);
  assert.equal(writer.stats().dirty, true);
  await writer.flush();
  assert.equal(attempts, 2);
  assert.equal(writer.stats().dirty, false);
});
