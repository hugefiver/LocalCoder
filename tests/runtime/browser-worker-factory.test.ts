import assert from "node:assert/strict";
import test from "node:test";
import {
  createBrowserWorkerFactory,
  type BrowserWorkerConstructor,
} from "../../src/runtime/browser-worker-factory.js";
import { type RuntimeManifestEntry } from "../../src/runtime/manifest.js";
import { type WorkerRequest } from "../../src/runtime/protocol.js";

class FakeBrowserWorker {
  static readonly instances: FakeBrowserWorker[] = [];
  readonly listeners = new Map<string, Set<EventListener>>();
  readonly posted: WorkerRequest[] = [];
  terminated = 0;

  constructor(readonly url: string | URL, readonly options?: WorkerOptions) {
    FakeBrowserWorker.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(message: WorkerRequest): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated += 1;
  }
}

function entry(type: "classic" | "module"): RuntimeManifestEntry {
  return {
    runtimeId: "javascript-worker",
    languageId: "javascript",
    protocolVersion: 1,
    runtimeVersion: "artifact-derived",
    worker: { url: "workers/js-worker.js", type },
    assets: [],
    required: true,
    packaged: true,
    reuse: "per-submission",
    capabilities: { execute: true, judge: true },
    timeouts: { initializeMs: 1, executeMs: 1 },
    limits: { sourceBytes: 1, caseCount: 1, outputBytes: 1 },
  };
}

test("browser Worker factory resolves a deployment-relative URL and maps classic/module options", () => {
  FakeBrowserWorker.instances.length = 0;
  const factory = createBrowserWorkerFactory(
    "https://example.test/localcoder/diagnostics/runtime-harness.html",
    FakeBrowserWorker as unknown as BrowserWorkerConstructor,
  );

  factory(entry("classic"));
  factory(entry("module"));

  const classic = FakeBrowserWorker.instances[0];
  const module = FakeBrowserWorker.instances[1];
  assert.equal(new URL(classic?.url ?? "").href, "https://example.test/localcoder/diagnostics/workers/js-worker.js");
  assert.deepEqual(classic?.options, { type: "classic" });
  assert.deepEqual(module?.options, { type: "module" });
});

test("browser Worker facade delegates listeners/messages and terminates native Worker once", () => {
  FakeBrowserWorker.instances.length = 0;
  const factory = createBrowserWorkerFactory(
    new URL("https://example.test/localcoder/"),
    FakeBrowserWorker as unknown as BrowserWorkerConstructor,
  );
  const port = factory(entry("classic"));
  const native = FakeBrowserWorker.instances[0];
  if (native === undefined) throw new Error("expected native worker");
  const listener = (() => undefined) as (event: MessageEvent<unknown>) => void;
  const errorListener = (() => undefined) as (event: ErrorEvent) => void;
  const request: WorkerRequest = {
    protocolVersion: 1,
    requestId: "request-1",
    runtimeId: "javascript-worker",
    type: "dispose",
  };

  port.addEventListener("message", listener);
  port.addEventListener("error", errorListener);
  port.removeEventListener("message", listener);
  port.removeEventListener("error", errorListener);
  port.postMessage(request);
  port.terminate();
  port.terminate();

  assert.equal(native.listeners.get("message")?.size, 0);
  assert.equal(native.listeners.get("error")?.size, 0);
  assert.deepEqual(native.posted, [request]);
  assert.equal(native.terminated, 1);
});
