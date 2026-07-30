/**
 * Coalesce repeated snapshots of one mutable JSON document.
 *
 * `write` is still responsible for durable/atomic replacement. This class
 * only controls when serialization happens and guarantees that an awaited
 * flush does not finish while a newer revision observed during the write is
 * still dirty.
 */
export class CoalescedJsonWriter {
  constructor({
    getValue,
    write,
    serialize = (value) => JSON.stringify(value, null, 2),
    delayMs = 1_500,
    onBackgroundError = () => {},
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    if (typeof getValue !== "function") throw new TypeError("getValue must be a function");
    if (typeof write !== "function") throw new TypeError("write must be a function");
    this.getValue = getValue;
    this.write = write;
    this.serialize = serialize;
    this.delayMs = Math.max(0, Number(delayMs) || 0);
    this.onBackgroundError = onBackgroundError;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.revision = 0;
    this.persistedRevision = 0;
    this.timer = null;
    this.flushPromise = null;
  }

  markDirty({ schedule = true } = {}) {
    this.revision += 1;
    if (schedule) this.#schedule();
    return this.revision;
  }

  save() {
    const targetRevision = this.markDirty({ schedule: false });
    return this.flush(targetRevision);
  }

  defer() {
    this.#clearScheduled();
  }

  flush(targetRevision = this.revision) {
    this.#clearScheduled();
    if (this.persistedRevision >= targetRevision) return Promise.resolve();
    if (!this.flushPromise) {
      this.flushPromise = this.#drain().finally(() => {
        this.flushPromise = null;
      });
    }
    return this.flushPromise.then(() => {
      if (this.persistedRevision < targetRevision) return this.flush(targetRevision);
      return undefined;
    });
  }

  stats() {
    return {
      revision: this.revision,
      persistedRevision: this.persistedRevision,
      dirty: this.persistedRevision < this.revision,
      scheduled: Boolean(this.timer),
      writing: Boolean(this.flushPromise),
    };
  }

  #schedule() {
    if (this.timer || this.persistedRevision >= this.revision) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.flush().catch(this.onBackgroundError);
    }, this.delayMs);
    this.timer?.unref?.();
  }

  #clearScheduled() {
    if (!this.timer) return;
    this.clearTimer(this.timer);
    this.timer = null;
  }

  async #drain() {
    try {
      while (this.persistedRevision < this.revision) {
        const writeRevision = this.revision;
        const payload = this.serialize(this.getValue());
        await this.write(payload, writeRevision);
        this.persistedRevision = writeRevision;
      }
    } catch (error) {
      this.#schedule();
      throw error;
    }
  }
}
