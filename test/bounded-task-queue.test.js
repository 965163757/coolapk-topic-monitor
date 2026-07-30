import assert from "node:assert/strict";
import test from "node:test";
import { BoundedTaskQueue, QueueCapacityError } from "../lib/bounded-task-queue.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("BoundedTaskQueue enforces hard active and queued limits", async () => {
  const queue = new BoundedTaskQueue({ maxActive: 2, maxQueued: 2 });
  const gates = Array.from({ length: 4 }, () => deferred());
  let running = 0;
  let peakRunning = 0;
  const tasks = gates.map((gate, index) => queue.run(async () => {
    running += 1;
    peakRunning = Math.max(peakRunning, running);
    await gate.promise;
    running -= 1;
    return index;
  }));

  assert.deepEqual(queue.stats(), {
    active: 2,
    queued: 2,
    maxActive: 2,
    maxQueued: 2,
    peakActive: 2,
    peakQueued: 2,
    started: 2,
    completed: 0,
    rejected: 0,
  });
  await assert.rejects(
    queue.run(async () => "overflow"),
    (error) => error instanceof QueueCapacityError
      && error.statusCode === 429
      && error.code === "QUEUE_CAPACITY_EXCEEDED",
  );

  gates[0].resolve();
  gates[1].resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queue.stats().active, 2);
  assert.equal(queue.stats().queued, 0);
  assert.equal(queue.stats().rejected, 1);

  gates[2].resolve();
  gates[3].resolve();
  assert.deepEqual(await Promise.all(tasks), [0, 1, 2, 3]);
  assert.equal(peakRunning, 2);
  assert.equal(queue.stats().completed, 4);
});

test("BoundedTaskQueue releases capacity after task errors", async () => {
  const queue = new BoundedTaskQueue({ maxActive: 1, maxQueued: 1 });
  const failed = queue.run(async () => {
    throw new Error("expected");
  });
  const next = queue.run(async () => "ok");

  await assert.rejects(failed, /expected/);
  assert.equal(await next, "ok");
  assert.equal(queue.stats().active, 0);
  assert.equal(queue.stats().queued, 0);
  assert.equal(queue.stats().completed, 2);
});
