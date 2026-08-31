import assert from "node:assert/strict";
import test from "node:test";

import type { JsonValue } from "../../src/domain/json-value.js";
import type { LanguageId, RuntimeId } from "../../src/domain/language.js";
import {
  ExecutorController,
} from "../../src/features/executor/executor-controller.js";
import { EXECUTOR_PRESETS } from "../../src/features/executor/executor-presets.js";
import { RuntimeAdapterRegistry } from "../../src/runtime/adapters/registry.js";
import type { RuntimeAdapter } from "../../src/runtime/adapters/types.js";
import { parseRuntimeManifest } from "../../src/runtime/manifest.js";
import type { ExecutePayload, RuntimeFailure } from "../../src/runtime/protocol.js";
import { RuntimeRegistry } from "../../src/runtime/registry.js";
import type { RuntimeInvocation, RuntimeOperationOptions, RuntimeOperationPhase } from "../../src/runtime/supervisor.js";
import type { LocalCoderRepository } from "../../src/storage/repository.js";
import type { DraftRecord, SettingsRecord, StorageState } from "../../src/storage/schema.js";
import { ManualClock } from "../helpers/manual-clock.js";

type ExecuteResult = RuntimeInvocation<ExecutePayload>;

class FakeRuntimeAdapter implements RuntimeAdapter {
  readonly calls: Array<{ source: string; options: RuntimeOperationOptions | undefined }> = [];
  readonly outcomes: Array<ExecuteResult | Promise<ExecuteResult>> = [];

  constructor(
    readonly runtimeId: RuntimeId,
    readonly languageId: LanguageId,
  ) {}

  async execute(source: string, options?: RuntimeOperationOptions): Promise<ExecuteResult> {
    this.calls.push({ source, options });
    const outcome = this.outcomes.shift();
    if (outcome === undefined) throw new Error(`No execute outcome queued for ${this.runtimeId}`);
    return outcome;
  }

  emitPhase(callIndex: number, phase: RuntimeOperationPhase): void {
    this.calls[callIndex]?.options?.onPhase?.(phase);
  }

  async judge(): Promise<never> {
    throw new Error("Executor must not call judge");
  }
}

class FakeStorage {
  storageState: StorageState = { kind: "persistent" };
  settings = createSettings();
  readonly drafts = new Map<string, DraftRecord>();
  readonly saveDraftCalls: DraftRecord[] = [];
  readonly saveSettingsCalls: SettingsRecord[] = [];
  getSettingsImplementation?: () => Promise<SettingsRecord>;
  getDraftImplementation?: (key: readonly [string, LanguageId, RuntimeId]) => Promise<DraftRecord | undefined>;
  saveDraftImplementation?: (record: DraftRecord) => Promise<void>;
  saveDraftFailure?: unknown;
  saveSettingsFailure?: unknown;
  readonly #listeners = new Set<(state: StorageState) => void>();

  async getDraft(key: readonly [string, LanguageId, RuntimeId]): Promise<DraftRecord | undefined> {
    return this.getDraftImplementation?.(key) ?? this.drafts.get(key.join("|"));
  }

  async saveDraft(record: DraftRecord): Promise<void> {
    this.saveDraftCalls.push(record);
    if (this.saveDraftImplementation !== undefined) {
      await this.saveDraftImplementation(record);
      return;
    }
    if (this.saveDraftFailure !== undefined) throw this.saveDraftFailure;
    this.drafts.set(draftKey(record.workspaceId, record.languageId, record.runtimeId), record);
  }

  async getSettings(): Promise<SettingsRecord> {
    return this.getSettingsImplementation?.() ?? this.settings;
  }

  async saveSettings(value: SettingsRecord): Promise<void> {
    this.saveSettingsCalls.push(value);
    if (this.saveSettingsFailure !== undefined) throw this.saveSettingsFailure;
    this.settings = value;
  }

  subscribeStorageState(listener: (state: StorageState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.storageState);
    return () => this.#listeners.delete(listener);
  }

  transitionStorage(state: StorageState): void {
    this.storageState = state;
    for (const listener of [...this.#listeners]) listener(state);
  }

  listenerCount(): number {
    return this.#listeners.size;
  }
}

test("load defaults to JavaScript, exposes all registry options, and uses a preset without a draft", async () => {
  const harness = createHarness();

  await harness.controller.load();

  assert.equal(harness.controller.snapshot.phase, "ready");
  assert.equal(harness.controller.snapshot.runtimeId, "javascript-worker");
  assert.equal(harness.controller.snapshot.languageId, "javascript");
  assert.equal(harness.controller.snapshot.source, EXECUTOR_PRESETS.javascript);
  assert.deepEqual(harness.controller.snapshot.runtimeOptions.map(({ value }) => value), [
    "javascript-worker",
    "typescript-official",
    "python-pyodide",
    "python-rustpython",
    "racket-wasm",
    "haskell-ghc-wasi",
  ]);
  assert.deepEqual(
    harness.controller.snapshot.runtimeOptions
      .filter(({ disabled }) => disabled)
      .map(({ value, reason }) => ({ value, reason })),
    [
      { value: "python-rustpython", reason: "RustPython 可选资源未打包" },
      { value: "racket-wasm", reason: "Racket 可选资源未打包" },
      { value: "haskell-ghc-wasi", reason: "此运行时不提供本地执行能力" },
    ],
  );
  assert.equal(hasOwn(harness.controller.snapshot, "output"), false);
  assert.equal(hasOwn(harness.controller.snapshot, "error"), false);
});

test("load restores the exact runtime draft and falls back within a preferred language", async () => {
  const exact = createHarness();
  exact.storage.settings = createSettings({ typescript: "typescript-official" });
  exact.storage.drafts.set(draftKey("executor", "typescript", "typescript-official"), {
    workspaceId: "executor",
    languageId: "typescript",
    runtimeId: "typescript-official",
    source: "const restored: number = 42;\nreturn restored;",
    updatedAt: 20,
  });
  await exact.controller.load();
  assert.equal(exact.controller.snapshot.runtimeId, "typescript-official");
  assert.equal(exact.controller.snapshot.source, "const restored: number = 42;\nreturn restored;");

  const fallback = createHarness();
  fallback.storage.settings = createSettings({ python: "python-rustpython" });
  await fallback.controller.load();
  assert.equal(fallback.controller.snapshot.runtimeId, "python-pyodide");
  assert.equal(fallback.controller.snapshot.languageId, "python");
  assert.equal(fallback.controller.snapshot.source, EXECUTOR_PRESETS.python);
});

test("invalid and disabled runtime selections are blocked without changing state", async () => {
  const harness = createHarness();
  await harness.controller.load();
  const initial = harness.controller.snapshot;

  await assert.rejects(harness.controller.selectRuntime("unknown-runtime" as RuntimeId), /unknown|does not contain/i);
  await assert.rejects(harness.controller.selectRuntime("python-rustpython"), /不可用|未打包/);
  await assert.rejects(harness.controller.selectRuntime("haskell-ghc-wasi"), /不提供本地执行能力/);
  harness.registry.transition("typescript-official", {
    kind: "failed",
    code: "worker-failed",
    message: "worker crashed",
  });
  await assert.rejects(harness.controller.selectRuntime("typescript-official"), /失败|worker crashed/);

  assert.equal(harness.controller.snapshot.runtimeId, initial.runtimeId);
  assert.equal(harness.controller.snapshot.languageId, initial.languageId);
  assert.equal(harness.controller.snapshot.source, initial.source);
});

test("drafts debounce for 300ms and flush before switching runtimes and disposing", async () => {
  const harness = createHarness();
  await harness.controller.load();

  harness.controller.edit("first edit");
  harness.clock.tick(299);
  await settle();
  assert.equal(harness.storage.saveDraftCalls.length, 0);
  harness.clock.tick(1);
  await settle();
  assert.deepEqual(last(harness.storage.saveDraftCalls), {
    workspaceId: "executor",
    languageId: "javascript",
    runtimeId: "javascript-worker",
    source: "first edit",
    updatedAt: 0,
  });

  harness.controller.edit("flush before switch");
  await harness.controller.selectRuntime("typescript-official");
  assert.equal(last(harness.storage.saveDraftCalls)?.source, "flush before switch");
  assert.equal(harness.controller.snapshot.source, EXECUTOR_PRESETS.typescript);
  assert.deepEqual(last(harness.storage.saveSettingsCalls), {
    ...createSettings({ typescript: "typescript-official" }),
    updatedAt: 300,
  });

  harness.controller.edit("flush on dispose");
  harness.controller.dispose();
  await settle();
  assert.equal(last(harness.storage.saveDraftCalls)?.source, "flush on dispose");
  assert.equal(harness.clock.pendingCount(), 0);
});

test("draft and runtime preference failures preserve source and expose a bounded unsaved warning", async () => {
  const harness = createHarness();
  harness.storage.settings = createSettings({ javascript: "javascript-worker" });
  await harness.controller.load();
  harness.storage.saveDraftFailure = new Error("quota denied");

  harness.controller.edit("keep this source in session");
  harness.clock.tick(300);
  await settle();
  assert.equal(harness.controller.snapshot.source, "keep this source in session");
  assert.match(harness.controller.snapshot.error ?? "", /^未保存：草稿未保存。.*quota denied/);

  harness.storage.saveSettingsFailure = new Error("settings blocked");
  await harness.controller.selectRuntime("typescript-official");
  assert.equal(harness.controller.snapshot.source, EXECUTOR_PRESETS.typescript);
  assert.match(harness.controller.snapshot.error ?? "", /^未保存：运行时偏好未保存。.*settings blocked/);
  assert.equal(last(harness.storage.saveSettingsCalls)?.theme, "dark");
  assert.deepEqual(last(harness.storage.saveSettingsCalls)?.layout, {
    desktopProblemPercent: 36,
    tabletTab: "problem",
  });
  assert.equal(last(harness.storage.saveSettingsCalls)?.preferredRuntimeByLanguage.javascript, "javascript-worker");
});

test("serialized draft saves ignore a stale failure once a newer save is queued", async () => {
  const harness = createHarness();
  await harness.controller.load();
  const firstSave = promiseWithResolvers<void>();
  let saveCall = 0;
  harness.storage.saveDraftImplementation = async () => {
    saveCall += 1;
    if (saveCall === 1) await firstSave.promise;
  };

  harness.controller.edit("older source");
  harness.clock.tick(300);
  await settle();
  harness.controller.edit("newest source");
  harness.clock.tick(300);
  firstSave.reject(new Error("stale quota failure"));
  await settle();
  await settle();

  assert.deepEqual(harness.storage.saveDraftCalls.map(({ source }) => source), ["older source", "newest source"]);
  assert.equal(harness.controller.snapshot.source, "newest source");
  assert.equal(harness.controller.snapshot.error, undefined);
});

test("cold execution publishes callback phases and measures only the 12ms user execution after 80ms initialization", async () => {
  const harness = createHarness();
  await harness.controller.load();
  const deferred = promiseWithResolvers<ExecuteResult>();
  harness.adapters.javascript.outcomes.push(deferred.promise);

  const execution = harness.controller.execute();
  assert.equal(harness.controller.snapshot.phase, "ready");
  harness.adapters.javascript.emitPhase(0, "initializing");
  assert.equal(harness.controller.snapshot.phase, "initializing");
  harness.clock.tick(80);
  harness.adapters.javascript.emitPhase(0, "executing");
  assert.equal(harness.controller.snapshot.phase, "running");
  harness.clock.tick(12);
  deferred.resolve(invocation(output("hello\n", "warning\n", { answer: [42] })));
  await execution;

  assert.equal(harness.adapters.javascript.calls.length, 1);
  assert.equal(harness.adapters.javascript.calls[0]?.source, EXECUTOR_PRESETS.javascript);
  assert.ok(harness.adapters.javascript.calls[0]?.options?.signal instanceof AbortSignal);
  assert.equal(typeof harness.adapters.javascript.calls[0]?.options?.onPhase, "function");
  assert.deepEqual(harness.controller.snapshot.output, {
    stdout: "hello\n",
    stderr: "warning\n",
    value: { answer: [42] },
    truncated: false,
  });
  assert.equal(harness.controller.snapshot.elapsedMs, 12);
  assert.equal(harness.controller.snapshot.phase, "ready");
});

test("warm execution measures its 12ms executing phase without an initialization callback", async () => {
  const harness = createHarness();
  await harness.controller.load();
  const deferred = promiseWithResolvers<ExecuteResult>();
  harness.adapters.javascript.outcomes.push(deferred.promise);

  const execution = harness.controller.execute();
  harness.adapters.javascript.emitPhase(0, "executing");
  assert.equal(harness.controller.snapshot.phase, "running");
  harness.clock.tick(12);
  deferred.resolve(invocation(output("warm", "", 1)));
  await execution;

  assert.equal(harness.controller.snapshot.elapsedMs, 12);
});

test("execute combines stdout and stderr truncation and clearOutput omits prior result fields", async () => {
  const harness = createHarness();
  await harness.controller.load();
  harness.adapters.javascript.outcomes.push(invocation({
    stdout: { text: "partial", bytes: 7, truncated: false },
    stderr: { text: "cut", bytes: 3, truncated: true },
    value: null,
  }));

  await harness.controller.execute();
  assert.equal(harness.controller.snapshot.output?.truncated, true);
  harness.controller.clearOutput();
  assert.equal(hasOwn(harness.controller.snapshot, "output"), false);
  assert.equal(hasOwn(harness.controller.snapshot, "elapsedMs"), false);
});

test("a runtime user error becomes an error state without fabricating output", async () => {
  const harness = createHarness();
  await harness.controller.load();
  harness.adapters.javascript.outcomes.push(Promise.reject(runtimeFailure("runtime", "user-error", "boom")));

  await harness.controller.execute();

  assert.equal(harness.controller.snapshot.phase, "error");
  assert.match(harness.controller.snapshot.error ?? "", /执行失败.*boom/);
  assert.equal(hasOwn(harness.controller.snapshot, "output"), false);
  assert.equal(harness.controller.snapshot.elapsedMs, 0);
});

test("cancel aborts the active execution and settles as cancelled", async () => {
  const harness = createHarness();
  await harness.controller.load();
  const deferred = promiseWithResolvers<ExecuteResult>();
  harness.adapters.javascript.outcomes.push(deferred.promise);

  const execution = harness.controller.execute();
  harness.controller.cancel();
  assert.equal(harness.controller.snapshot.phase, "cancelling");
  assert.equal(harness.adapters.javascript.calls[0]?.options?.signal?.aborted, true);
  deferred.reject(runtimeFailure("cancelled", "cancelled", "Runtime operation was cancelled", true));
  await execution;

  assert.equal(harness.controller.snapshot.phase, "cancelled");
  assert.equal(harness.controller.snapshot.error, undefined);
  assert.equal(harness.controller.snapshot.elapsedMs, 0);
});

test("timeout, runtime failure, and cancellation after execution each retain the 12ms user duration", async () => {
  const cases: readonly [string, RuntimeFailure, "error" | "cancelled"][] = [
    ["timeout", runtimeFailure("infrastructure", "execution-timeout", "late", true), "error"],
    ["runtime failure", runtimeFailure("runtime", "user-error", "boom"), "error"],
    ["cancellation", runtimeFailure("cancelled", "cancelled", "Runtime operation was cancelled", true), "cancelled"],
  ];

  for (const [, failure, finalPhase] of cases) {
    const harness = createHarness();
    await harness.controller.load();
    const deferred = promiseWithResolvers<ExecuteResult>();
    harness.adapters.javascript.outcomes.push(deferred.promise);

    const execution = harness.controller.execute();
    harness.adapters.javascript.emitPhase(0, "executing");
    harness.clock.tick(12);
    if (finalPhase === "cancelled") harness.controller.cancel();
    deferred.reject(failure);
    await execution;

    assert.equal(harness.controller.snapshot.phase, finalPhase);
    assert.equal(harness.controller.snapshot.elapsedMs, 12);
  }
});

test("the selected failed runtime remains executable for cancellation recovery", async () => {
  const harness = createHarness();
  await harness.controller.load();
  const cancelled = promiseWithResolvers<ExecuteResult>();
  harness.adapters.javascript.outcomes.push(cancelled.promise);
  const first = harness.controller.execute();
  harness.controller.cancel();
  harness.registry.transition("javascript-worker", {
    kind: "failed",
    code: "cancelled",
    message: "Runtime operation was cancelled",
  });
  cancelled.reject(runtimeFailure("cancelled", "cancelled", "Runtime operation was cancelled", true));
  await first;
  harness.adapters.javascript.outcomes.push(invocation(output("recovered\n", "", 7)));

  await harness.controller.execute();

  assert.equal(harness.adapters.javascript.calls.length, 2);
  assert.equal(harness.controller.snapshot.output?.stdout, "recovered\n");
  assert.equal(harness.controller.snapshot.output?.value, 7);
  assert.equal(harness.controller.snapshot.phase, "ready");
});

test("stale loads and executions cannot overwrite the current context", async () => {
  const loadHarness = createHarness();
  const firstSettings = promiseWithResolvers<SettingsRecord>();
  let settingsRead = 0;
  loadHarness.storage.getSettingsImplementation = () => {
    settingsRead += 1;
    return settingsRead === 1
      ? firstSettings.promise
      : Promise.resolve(createSettings({ typescript: "typescript-official" }));
  };
  const staleLoad = loadHarness.controller.load();
  await settle();
  await loadHarness.controller.load();
  firstSettings.resolve(createSettings({ python: "python-pyodide" }));
  await staleLoad;
  assert.equal(loadHarness.controller.snapshot.runtimeId, "typescript-official");

  const draftHarness = createHarness();
  const staleDraft = promiseWithResolvers<DraftRecord | undefined>();
  let draftRead = 0;
  draftHarness.storage.getDraftImplementation = (key) => {
    draftRead += 1;
    return draftRead === 1
      ? staleDraft.promise
      : Promise.resolve({
        workspaceId: key[0],
        languageId: key[1],
        runtimeId: key[2],
        source: "current draft",
        updatedAt: 1,
      });
  };
  const staleDraftLoad = draftHarness.controller.load();
  await settle();
  await draftHarness.controller.load();
  staleDraft.reject(new Error("stale draft failure"));
  await staleDraftLoad;
  assert.equal(draftHarness.controller.snapshot.source, "current draft");
  assert.equal(draftHarness.controller.snapshot.error, undefined);

  const executeHarness = createHarness();
  await executeHarness.controller.load();
  const staleResult = promiseWithResolvers<ExecuteResult>();
  executeHarness.adapters.javascript.outcomes.push(staleResult.promise);
  const staleExecution = executeHarness.controller.execute();
  await executeHarness.controller.selectRuntime("typescript-official");
  staleResult.resolve(invocation(output("stale", "", 1)));
  await staleExecution;
  assert.equal(executeHarness.controller.snapshot.runtimeId, "typescript-official");
  assert.equal(hasOwn(executeHarness.controller.snapshot, "output"), false);
  assert.equal(executeHarness.adapters.javascript.calls[0]?.options?.signal?.aborted, true);
});

test("snapshots are deeply immutable, listeners are isolated, and dispose releases subscriptions", async () => {
  const harness = createHarness();
  let notifications = 0;
  harness.controller.subscribe(() => {
    throw new Error("observer failed");
  });
  harness.controller.subscribe(() => {
    notifications += 1;
  });
  await harness.controller.load();
  harness.adapters.javascript.outcomes.push(invocation(output("", "", { nested: [1] })));
  await harness.controller.execute();

  assert.ok(Object.isFrozen(harness.controller.snapshot));
  assert.ok(Object.isFrozen(harness.controller.snapshot.runtimeOptions));
  assert.ok(harness.controller.snapshot.runtimeOptions.every(Object.isFrozen));
  assert.ok(Object.isFrozen(harness.controller.snapshot.output));
  assert.ok(Object.isFrozen(harness.controller.snapshot.output?.value));
  assert.ok(Object.isFrozen((harness.controller.snapshot.output?.value as { nested: number[] }).nested));
  assert.ok(Object.isFrozen(harness.controller.snapshot.storageState));
  assert.ok(notifications > 0);

  harness.controller.dispose();
  assert.equal(harness.storage.listenerCount(), 0);
  const afterDispose = notifications;
  harness.storage.transitionStorage({ kind: "memory", message: "未保存", reason: "IndexedDB unavailable" });
  harness.registry.transition("javascript-worker", { kind: "initializing" });
  assert.equal(notifications, afterDispose);
});

function createHarness() {
  const clock = new ManualClock();
  const storage = new FakeStorage();
  const registry = runtimeRegistry();
  const adapterRegistry = new RuntimeAdapterRegistry();
  const javascript = new FakeRuntimeAdapter("javascript-worker", "javascript");
  const typescript = new FakeRuntimeAdapter("typescript-official", "typescript");
  const python = new FakeRuntimeAdapter("python-pyodide", "python");
  adapterRegistry.register(javascript);
  adapterRegistry.register(typescript);
  adapterRegistry.register(python);
  const controller = new ExecutorController({
    registry,
    adapters: adapterRegistry,
    storage: storage as unknown as LocalCoderRepository,
    clock,
  });
  return {
    clock,
    storage,
    registry,
    controller,
    adapters: { javascript, typescript, python },
  };
}

function runtimeRegistry(): RuntimeRegistry {
  return RuntimeRegistry.fromManifest(parseRuntimeManifest({
    schemaVersion: 1,
    runtimes: [
      runtime("javascript-worker", "javascript", true),
      runtime("typescript-official", "typescript", true),
      runtime("python-pyodide", "python", true),
      runtime("python-rustpython", "python", false, false, "RustPython 可选资源未打包"),
      runtime("racket-wasm", "racket", false, false, "Racket 可选资源未打包"),
      runtime("haskell-ghc-wasi", "haskell", false, true, undefined, false),
    ],
  }));
}

function runtime(
  runtimeId: RuntimeId,
  languageId: LanguageId,
  required: boolean,
  packaged = true,
  unavailableReason?: string,
  execute = packaged,
): object {
  return {
    runtimeId,
    languageId,
    protocolVersion: 1,
    runtimeVersion: "1.0.0",
    worker: { url: `workers/${runtimeId}.js`, type: "module" },
    assets: [{ url: `assets/${runtimeId}.wasm`, bytes: 1 }],
    required,
    packaged,
    ...(unavailableReason === undefined ? {} : { unavailableReason }),
    reuse: "per-submission",
    capabilities: { execute, judge: execute },
    timeouts: { initializeMs: 1_000, executeMs: 5_000 },
    limits: { sourceBytes: 262_144, caseCount: 100, outputBytes: 65_536 },
  };
}

function createSettings(preferences: Partial<Record<LanguageId, RuntimeId>> = {}): SettingsRecord {
  return {
    key: "app",
    theme: "dark",
    preferredRuntimeByLanguage: { ...preferences },
    layout: { desktopProblemPercent: 36, tabletTab: "problem" },
    updatedAt: 10,
  };
}

function invocation(payload: ExecutePayload): ExecuteResult {
  return {
    identity: { runtimeVersion: "1.0.0", buildId: "fixture" },
    payload,
  };
}

function output(stdout: string, stderr: string, value: JsonValue): ExecutePayload {
  return {
    stdout: { text: stdout, bytes: new TextEncoder().encode(stdout).byteLength, truncated: false },
    stderr: { text: stderr, bytes: new TextEncoder().encode(stderr).byteLength, truncated: false },
    value,
  };
}

function runtimeFailure(
  kind: RuntimeFailure["kind"],
  code: string,
  message: string,
  fatal = false,
): RuntimeFailure {
  return { kind, code, message, fatal };
}

function draftKey(workspaceId: string, languageId: LanguageId, runtimeId: RuntimeId): string {
  return [workspaceId, languageId, runtimeId].join("|");
}

function promiseWithResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function last<T>(values: readonly T[]): T | undefined {
  return values[values.length - 1];
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
