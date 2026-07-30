export class QueueCapacityError extends Error {
  constructor(message = "任务队列已满，请稍后重试") {
    super(message);
    this.name = "QueueCapacityError";
    this.code = "QUEUE_CAPACITY_EXCEEDED";
    this.statusCode = 429;
    this.retryAfterSeconds = 1;
  }
}

/**
 * A small FIFO executor with hard active and waiting limits.
 *
 * `run()` starts work immediately while an active slot is available, queues at
 * most `maxQueued` additional tasks, and rejects before retaining the task once
 * both limits are exhausted.
 */
export class BoundedTaskQueue {
  constructor({ maxActive = 12, maxQueued = 64 } = {}) {
    if (!Number.isSafeInteger(maxActive) || maxActive < 1) {
      throw new TypeError("maxActive 必须是大于 0 的安全整数");
    }
    if (!Number.isSafeInteger(maxQueued) || maxQueued < 0) {
      throw new TypeError("maxQueued 必须是大于等于 0 的安全整数");
    }
    this.maxActive = maxActive;
    this.maxQueued = maxQueued;
    this.active = 0;
    this.queue = [];
    this.started = 0;
    this.completed = 0;
    this.rejected = 0;
    this.peakActive = 0;
    this.peakQueued = 0;
  }

  run(task) {
    if (typeof task !== "function") throw new TypeError("task 必须是函数");
    return new Promise((resolve, reject) => {
      const item = { task, resolve, reject };
      if (this.active < this.maxActive) {
        this.#start(item);
        return;
      }
      if (this.queue.length >= this.maxQueued) {
        this.rejected += 1;
        reject(new QueueCapacityError());
        return;
      }
      this.queue.push(item);
      this.peakQueued = Math.max(this.peakQueued, this.queue.length);
    });
  }

  #start(item) {
    this.active += 1;
    this.started += 1;
    this.peakActive = Math.max(this.peakActive, this.active);
    Promise.resolve()
      .then(item.task)
      .then(
        (value) => this.#finish(item, true, value),
        (error) => this.#finish(item, false, error),
      );
  }

  #finish(item, succeeded, value) {
    this.active -= 1;
    this.completed += 1;
    const next = this.queue.shift();
    if (next) this.#start(next);
    if (succeeded) item.resolve(value);
    else item.reject(value);
  }

  stats() {
    return {
      active: this.active,
      queued: this.queue.length,
      maxActive: this.maxActive,
      maxQueued: this.maxQueued,
      peakActive: this.peakActive,
      peakQueued: this.peakQueued,
      started: this.started,
      completed: this.completed,
      rejected: this.rejected,
    };
  }
}
