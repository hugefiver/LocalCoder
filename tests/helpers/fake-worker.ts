import {
  type WorkerErrorListener,
  type WorkerMessageListener,
  type WorkerPort,
} from "../../src/runtime/worker-port.js";
import { type WorkerRequest } from "../../src/runtime/protocol.js";
import { type RuntimeManifestEntry } from "../../src/runtime/manifest.js";

export class FakeWorker implements WorkerPort {
  readonly posted: WorkerRequest[] = [];
  readonly #messageListeners = new Set<WorkerMessageListener>();
  readonly #errorListeners = new Set<WorkerErrorListener>();
  terminated = 0;

  constructor(readonly generation: number) {}

  addEventListener(type: "message", listener: WorkerMessageListener): void;
  addEventListener(type: "error", listener: WorkerErrorListener): void;
  addEventListener(type: "message" | "error", listener: WorkerMessageListener | WorkerErrorListener): void {
    if (type === "message") {
      this.#messageListeners.add(listener as WorkerMessageListener);
    } else {
      this.#errorListeners.add(listener as WorkerErrorListener);
    }
  }

  removeEventListener(type: "message", listener: WorkerMessageListener): void;
  removeEventListener(type: "error", listener: WorkerErrorListener): void;
  removeEventListener(type: "message" | "error", listener: WorkerMessageListener | WorkerErrorListener): void {
    if (type === "message") {
      this.#messageListeners.delete(listener as WorkerMessageListener);
    } else {
      this.#errorListeners.delete(listener as WorkerErrorListener);
    }
  }

  postMessage(message: WorkerRequest): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated += 1;
  }

  emit(message: unknown): void {
    const event = { data: message } as MessageEvent<unknown>;
    for (const listener of [...this.#messageListeners]) listener(event);
  }

  fail(error: Error): void {
    const event = { error } as ErrorEvent;
    for (const listener of [...this.#errorListeners]) listener(event);
  }

  listenerCount(type?: "message" | "error"): number {
    if (type === "message") return this.#messageListeners.size;
    if (type === "error") return this.#errorListeners.size;
    return this.#messageListeners.size + this.#errorListeners.size;
  }
}

export class FakeWorkerFactory {
  readonly workers: FakeWorker[] = [];

  create = (_entry: RuntimeManifestEntry): FakeWorker => {
    const worker = new FakeWorker(this.workers.length + 1);
    this.workers.push(worker);
    return worker;
  };
}
