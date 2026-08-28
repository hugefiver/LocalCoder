import type { Clock } from "../../runtime/worker-port.js";
import type { LocalCoderRepository } from "../../storage/repository.js";
import type { DraftRecord } from "../../storage/schema.js";

const DRAFT_DEBOUNCE_MS = 300;

interface ExecutorDraftPersistenceOptions {
  clock: Clock;
  storage: LocalCoderRepository;
  onSaved: () => void;
  onFailure: (error: unknown) => void;
}

export class ExecutorDraftPersistence {
  readonly #options: ExecutorDraftPersistenceOptions;
  #timer: unknown;
  #pending: DraftRecord | undefined;
  #queue: Promise<void> = Promise.resolve();
  #generation = 0;
  #disposed = false;

  constructor(options: ExecutorDraftPersistenceOptions) {
    this.#options = options;
  }

  schedule(record: DraftRecord): void {
    if (this.#disposed) return;
    this.#pending = record;
    if (this.#timer !== undefined) this.#options.clock.clearTimeout(this.#timer);
    this.#timer = this.#options.clock.setTimeout(() => {
      this.#timer = undefined;
      const pending = this.#pending;
      this.#pending = undefined;
      if (pending !== undefined) void this.#enqueue(pending);
    }, DRAFT_DEBOUNCE_MS);
  }

  async flush(): Promise<void> {
    if (this.#timer !== undefined) {
      this.#options.clock.clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    const pending = this.#pending;
    this.#pending = undefined;
    if (pending !== undefined) await this.#enqueue(pending);
    else await this.#queue;
  }

  dispose(): void {
    if (this.#disposed) return;
    if (this.#timer !== undefined) {
      this.#options.clock.clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    const pending = this.#pending;
    this.#pending = undefined;
    if (pending !== undefined) void this.#enqueue(pending);
    this.#disposed = true;
  }

  #enqueue(record: DraftRecord): Promise<void> {
    const generation = ++this.#generation;
    const task = this.#queue.then(async () => {
      try {
        await this.#options.storage.saveDraft(record);
        if (!this.#disposed && generation === this.#generation) this.#options.onSaved();
      } catch (error) {
        if (!this.#disposed && generation === this.#generation) this.#options.onFailure(error);
      }
    });
    this.#queue = task;
    return task;
  }
}
