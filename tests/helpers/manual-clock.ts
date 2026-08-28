import { type Clock } from "../../src/runtime/worker-port.js";

interface ScheduledCallback {
  readonly callback: () => void;
  readonly dueAt: number;
  readonly sequence: number;
}

export class ManualClock implements Clock {
  #now = 0;
  #nextHandle = 1;
  #nextSequence = 1;
  readonly #callbacks = new Map<number, ScheduledCallback>();

  now(): number {
    return this.#now;
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const handle = this.#nextHandle++;
    this.#callbacks.set(handle, {
      callback,
      dueAt: this.#now + delayMs,
      sequence: this.#nextSequence++,
    });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === "number") this.#callbacks.delete(handle);
  }

  tick(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new RangeError("tick duration must be finite and non-negative");
    const target = this.#now + ms;

    while (true) {
      const next = [...this.#callbacks.entries()]
        .filter(([, scheduled]) => scheduled.dueAt <= target)
        .sort(([, left], [, right]) => left.dueAt - right.dueAt || left.sequence - right.sequence)[0];
      if (next === undefined) break;

      const [handle, scheduled] = next;
      this.#callbacks.delete(handle);
      this.#now = scheduled.dueAt;
      scheduled.callback();
    }

    this.#now = target;
  }

  pendingCount(): number {
    return this.#callbacks.size;
  }
}
