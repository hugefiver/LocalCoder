import assert from "node:assert/strict";
import test from "node:test";

import type { LanguageId, RuntimeId } from "../../src/domain/language.js";
import type { Problem, ProblemCase } from "../../src/domain/problem.js";
import type { JudgeCommand, SubmissionResult, Verdict } from "../../src/domain/submission.js";
import { ProblemWorkspaceController } from "../../src/features/problems/workspace-controller.js";
import { parseRuntimeManifest } from "../../src/runtime/manifest.js";
import { RuntimeRegistry } from "../../src/runtime/registry.js";
import type { SubmissionOutcome } from "../../src/services/submission-service.js";
import type { SubmissionService } from "../../src/services/submission-service.js";
import type { LocalCoderRepository } from "../../src/storage/repository.js";
import type {
  DraftRecord,
  ProgressRecord,
  SettingsRecord,
  StorageState,
  SubmissionQuery,
  SubmissionRecord,
} from "../../src/storage/schema.js";
import { ManualClock } from "../helpers/manual-clock.js";

class FakeProblemRepository {
  readonly problems = new Map<number, Problem>();
  getByIdImplementation?: (problemId: number) => Promise<Problem | undefined>;

  async list(): Promise<readonly Problem[]> {
    return [...this.problems.values()];
  }

  async getById(problemId: number): Promise<Problem | undefined> {
    return this.getByIdImplementation?.(problemId) ?? this.problems.get(problemId);
  }
}

class FakeStorage {
  storageState: StorageState = { kind: "persistent" };
  settings = settings();
  readonly drafts = new Map<string, DraftRecord>();
  readonly customCases = new Map<number, readonly ProblemCase[]>();
  readonly progress = new Map<number, ProgressRecord>();
  recentSubmissions: readonly SubmissionRecord[] = [];
  readonly saveDraftCalls: DraftRecord[] = [];
  readonly saveCustomCasesCalls: Array<{ problemId: number; cases: readonly ProblemCase[] }> = [];
  readonly saveSettingsCalls: SettingsRecord[] = [];
  readonly listSubmissionCalls: SubmissionQuery[] = [];
  getProgressCalls = 0;
  saveDraftFailure?: unknown;
  saveCustomCasesFailure?: unknown;
  saveSettingsFailure?: unknown;
  getDraftImplementation?: (key: readonly [string, LanguageId, RuntimeId]) => Promise<DraftRecord | undefined>;
  readonly #listeners = new Set<(state: StorageState) => void>();

  async getDraft(key: readonly [string, LanguageId, RuntimeId]): Promise<DraftRecord | undefined> {
    return this.getDraftImplementation?.(key) ?? this.drafts.get(key.join("|"));
  }

  async saveDraft(record: DraftRecord): Promise<void> {
    this.saveDraftCalls.push(record);
    if (this.saveDraftFailure !== undefined) throw this.saveDraftFailure;
    this.drafts.set(draftKey(record.workspaceId, record.languageId, record.runtimeId), record);
  }

  async getCustomCases(problemId: number): Promise<readonly ProblemCase[]> {
    return this.customCases.get(problemId) ?? [];
  }

  async saveCustomCases(problemId: number, cases: readonly ProblemCase[]): Promise<void> {
    this.saveCustomCasesCalls.push({ problemId, cases });
    if (this.saveCustomCasesFailure !== undefined) throw this.saveCustomCasesFailure;
    this.customCases.set(problemId, cases);
  }

  async getSettings(): Promise<SettingsRecord> {
    return this.settings;
  }

  async saveSettings(value: SettingsRecord): Promise<void> {
    this.saveSettingsCalls.push(value);
    if (this.saveSettingsFailure !== undefined) throw this.saveSettingsFailure;
    this.settings = value;
  }

  async getProgress(problemId: number): Promise<ProgressRecord | undefined> {
    this.getProgressCalls += 1;
    return this.progress.get(problemId);
  }

  async listSubmissions(query: SubmissionQuery = {}): Promise<readonly SubmissionRecord[]> {
    this.listSubmissionCalls.push(query);
    return this.recentSubmissions
      .filter((record) => query.problemId === undefined || record.problemId === query.problemId)
      .slice(0, query.limit);
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

class FakeSubmissions {
  readonly runCalls: Array<Omit<JudgeCommand, "mode">> = [];
  readonly submitCalls: Array<Omit<JudgeCommand, "mode">> = [];
  readonly runOutcomes: Array<SubmissionOutcome | Promise<SubmissionOutcome>> = [];
  readonly submitOutcomes: Array<SubmissionOutcome | Promise<SubmissionOutcome>> = [];
  onSubmit?: () => void;

  async run(command: Omit<JudgeCommand, "mode">): Promise<SubmissionOutcome> {
    this.runCalls.push(command);
    return nextOutcome(this.runOutcomes);
  }

  async submit(command: Omit<JudgeCommand, "mode">): Promise<SubmissionOutcome> {
    this.submitCalls.push(command);
    this.onSubmit?.();
    return nextOutcome(this.submitOutcomes);
  }
}

test("load restores custom cases, a valid preferred runtime, and its exact draft", async () => {
  const harness = createHarness();
  harness.storage.settings = settings({ typescript: "typescript-official" });
  harness.storage.customCases.set(1, [{ input: [7], expected: 7 }]);
  harness.storage.drafts.set(draftKey("problem:1", "typescript", "typescript-official"), {
    workspaceId: "problem:1",
    languageId: "typescript",
    runtimeId: "typescript-official",
    source: "saved TypeScript source",
    updatedAt: 50,
  });

  await harness.controller.load(1);

  assert.equal(harness.controller.snapshot.phase, "ready");
  assert.equal(harness.controller.snapshot.runtimeId, "typescript-official");
  assert.equal(harness.controller.snapshot.languageId, "typescript");
  assert.equal(harness.controller.snapshot.source, "saved TypeScript source");
  assert.deepEqual(harness.controller.snapshot.customCases, [{ input: [7], expected: 7 }]);
  assert.deepEqual(harness.controller.snapshot.runtimeOptions.map(({ value }) => value), [
    "javascript-worker",
    "typescript-official",
    "python-pyodide",
    "python-rustpython",
    "racket-wasm",
    "haskell-ghc-wasi",
  ]);
  assert.equal(harness.controller.snapshot.runtimeOptions.find(({ value }) => value === "python-rustpython")?.disabled, true);
  assert.ok(Object.isFrozen(harness.controller.snapshot.runtimeOptions));
  assert.ok(Object.isFrozen(harness.controller.snapshot.customCases));
});

test("load falls back within the preferred language when its optional runtime is unavailable", async () => {
  const harness = createHarness();
  harness.storage.settings = settings({ python: "python-rustpython" });

  await harness.controller.load(1);

  assert.equal(harness.controller.snapshot.runtimeId, "python-pyodide");
  assert.equal(harness.controller.snapshot.languageId, "python");
  assert.equal(harness.controller.snapshot.source, problem(1).templates.python);
});

test("edit saves after 300ms and runtime switch plus dispose flush pending drafts", async () => {
  const harness = createHarness();
  await harness.controller.load(1);

  harness.controller.edit("first edit");
  harness.clock.tick(299);
  await settle();
  assert.equal(harness.storage.saveDraftCalls.length, 0);
  harness.clock.tick(1);
  await settle();
  assert.equal(last(harness.storage.saveDraftCalls)?.source, "first edit");
  assert.equal(last(harness.storage.saveDraftCalls)?.runtimeId, "javascript-worker");

  harness.controller.edit("flush before switch");
  await harness.controller.selectRuntime("typescript-official");
  assert.equal(last(harness.storage.saveDraftCalls)?.source, "flush before switch");
  assert.equal(harness.controller.snapshot.source, problem(1).templates.typescript);
  assert.equal(last(harness.storage.saveSettingsCalls)?.theme, "dark");
  assert.deepEqual(last(harness.storage.saveSettingsCalls)?.layout, { desktopProblemPercent: 36, tabletTab: "problem" });

  harness.controller.edit("flush on dispose");
  harness.controller.dispose();
  await settle();
  assert.equal(last(harness.storage.saveDraftCalls)?.source, "flush on dispose");
  assert.equal(harness.clock.pendingCount(), 0);
});

test("runtime selection rejects unknown, wrong-template, and disabled runtimes without changing selection", async () => {
  const harness = createHarness({ problem: problem(1) });
  await harness.controller.load(1);
  const initialRuntime = harness.controller.snapshot.runtimeId;

  await assert.rejects(
    harness.controller.selectRuntime("unknown-runtime" as RuntimeId),
    /unknown|does not contain/i,
  );
  await assert.rejects(harness.controller.selectRuntime("racket-wasm"), /模板/);
  await assert.rejects(harness.controller.selectRuntime("python-rustpython"), /不可用|未打包/);
  assert.equal(harness.controller.snapshot.runtimeId, initialRuntime);
});

test("custom cases require canonical JSON, enforce the cap, and expose persistence failures", async () => {
  const harness = createHarness();
  await harness.controller.load(1);

  await assert.rejects(
    harness.controller.replaceCustomCases([{ input: new Date() as never, expected: null }]),
    /canonical JSON/,
  );
  await assert.rejects(
    harness.controller.replaceCustomCases(Array.from({ length: 101 }, (_, index) => ({ input: index, expected: index }))),
    /100/,
  );
  const valid = [{ input: { values: [1, 2] }, expected: 3 }];
  await harness.controller.replaceCustomCases(valid);
  assert.deepEqual(last(harness.storage.saveCustomCasesCalls), { problemId: 1, cases: valid });

  harness.storage.saveCustomCasesFailure = new Error("quota denied");
  await assert.rejects(harness.controller.replaceCustomCases([{ input: 2, expected: 2 }]), /quota denied/);
  assert.match(harness.controller.snapshot.error ?? "", /未保存.*quota denied/);
  assert.deepEqual(harness.controller.snapshot.customCases, [{ input: 2, expected: 2 }]);

  harness.storage.transitionStorage({ kind: "memory", message: "未保存", reason: "IndexedDB unavailable" });
  assert.deepEqual(harness.controller.snapshot.storageState, {
    kind: "memory",
    message: "未保存",
    reason: "IndexedDB unavailable",
  });
});

test("Run and Submit invoke distinct service methods and only Submit refreshes persisted state", async () => {
  const harness = createHarness();
  await harness.controller.load(1);
  harness.submissions.runOutcomes.push(outcome(result("accepted"), "not-requested"));
  harness.submissions.submitOutcomes.push(outcome(result("accepted"), "saved"));
  harness.submissions.onSubmit = () => {
    harness.storage.progress.set(1, {
      problemId: 1,
      attempts: 1,
      lastAttemptAt: 80,
      acceptedAt: 80,
      acceptedLanguageId: "javascript",
      acceptedRuntimeId: "javascript-worker",
    });
    harness.storage.recentSubmissions = [submissionRecord(1, "accepted")];
  };
  const initialSubmissionReads = harness.storage.listSubmissionCalls.length;

  await harness.controller.run();
  assert.equal(harness.submissions.runCalls.length, 1);
  assert.equal(harness.submissions.submitCalls.length, 0);
  assert.equal(harness.storage.getProgressCalls, 0);
  assert.equal(harness.storage.listSubmissionCalls.length, initialSubmissionReads);

  await harness.controller.submit();
  assert.equal(harness.submissions.runCalls.length, 1);
  assert.equal(harness.submissions.submitCalls.length, 1);
  assert.equal(harness.storage.getProgressCalls, 1);
  assert.equal(harness.storage.listSubmissionCalls.length, initialSubmissionReads + 1);
  assert.equal(harness.controller.snapshot.recentSubmissions[0]?.verdict, "accepted");
});

test("Submit preserves the verdict and exposes a persistence warning", async () => {
  const harness = createHarness();
  await harness.controller.load(1);
  harness.submissions.submitOutcomes.push({
    result: result("wrong-answer"),
    persistence: { state: "failed", message: "提交结果未保存：请检查浏览器存储后重试" },
  });

  await harness.controller.submit();

  assert.equal(harness.controller.snapshot.result?.verdict, "wrong-answer");
  assert.match(harness.controller.snapshot.error ?? "", /未保存/);
  assert.equal(harness.controller.snapshot.phase, "ready");
});

test("cancel aborts the active command and resolves as a normal cancelled result", async () => {
  const harness = createHarness();
  await harness.controller.load(1);
  const deferred = promiseWithResolvers<SubmissionOutcome>();
  harness.submissions.runOutcomes.push(deferred.promise);

  const running = harness.controller.run();
  assert.equal(harness.controller.snapshot.phase, "running");
  harness.controller.cancel();
  assert.equal(harness.controller.snapshot.phase, "cancelling");
  assert.equal(harness.submissions.runCalls[0]?.signal?.aborted, true);
  deferred.reject(new DOMException("cancelled", "AbortError"));
  await running;

  assert.equal(harness.controller.snapshot.phase, "ready");
  assert.equal(harness.controller.snapshot.result?.verdict, "cancelled");
  assert.equal(harness.controller.snapshot.error, undefined);
});

test("a TLE does not prevent a successful rerun", async () => {
  const harness = createHarness();
  await harness.controller.load(1);
  harness.submissions.runOutcomes.push(
    outcome(result("time-limit-exceeded"), "not-requested"),
    outcome(result("accepted"), "not-requested"),
  );

  await harness.controller.run();
  assert.equal(harness.controller.snapshot.result?.verdict, "time-limit-exceeded");
  await harness.controller.run();
  assert.equal(harness.controller.snapshot.result?.verdict, "accepted");
  assert.equal(harness.submissions.runCalls.length, 2);
});

test("a failed runtime remains retryable so the Supervisor can rebuild it", async () => {
  const harness = createHarness();
  await harness.controller.load(1);
  harness.registry.transition("javascript-worker", {
    kind: "failed",
    code: "cancelled",
    message: "Runtime operation was cancelled",
  });
  harness.submissions.runOutcomes.push(outcome(result("accepted"), "not-requested"));

  await harness.controller.run();

  assert.equal(harness.submissions.runCalls.length, 1);
  assert.equal(harness.controller.snapshot.result?.verdict, "accepted");
});

test("a missing route problem becomes a bounded error state", async () => {
  const harness = createHarness();

  await harness.controller.load(404);

  assert.equal(harness.controller.snapshot.phase, "error");
  assert.equal(harness.controller.snapshot.problem, undefined);
  assert.match(harness.controller.snapshot.error ?? "", /404.*不存在|未找到.*404/);
});

test("a stale problem load cannot replace the current problem", async () => {
  const harness = createHarness();
  harness.problems.problems.set(2, problem(2));
  const first = promiseWithResolvers<Problem | undefined>();
  harness.problems.getByIdImplementation = (problemId) => (
    problemId === 1 ? first.promise : Promise.resolve(harness.problems.problems.get(problemId))
  );

  const staleLoad = harness.controller.load(1);
  await harness.controller.load(2);
  first.resolve(problem(1));
  await staleLoad;

  assert.equal(harness.controller.snapshot.problem?.id, 2);
  assert.equal(harness.controller.snapshot.phase, "ready");
});

test("a stale execution result is ignored after switching runtimes", async () => {
  const harness = createHarness();
  await harness.controller.load(1);
  const stale = promiseWithResolvers<SubmissionOutcome>();
  harness.submissions.runOutcomes.push(stale.promise);

  const running = harness.controller.run();
  await harness.controller.selectRuntime("typescript-official");
  stale.resolve(outcome(result("wrong-answer"), "not-requested"));
  await running;

  assert.equal(harness.controller.snapshot.runtimeId, "typescript-official");
  assert.equal(harness.controller.snapshot.result, undefined);
  assert.equal(harness.controller.snapshot.phase, "ready");
});

test("snapshots are immutable, listeners are isolated, and dispose releases resources", async () => {
  const harness = createHarness();
  let notifications = 0;
  harness.controller.subscribe(() => {
    throw new Error("observer failed");
  });
  harness.controller.subscribe(() => {
    notifications += 1;
  });
  await harness.controller.load(1);
  const beforeEdit = notifications;
  harness.controller.edit("changed");
  assert.equal(notifications, beforeEdit + 1);
  assert.ok(Object.isFrozen(harness.controller.snapshot));
  assert.ok(Object.isFrozen(harness.controller.snapshot.problem));
  assert.throws(() => {
    (harness.controller.snapshot.runtimeOptions as Array<unknown>).push({});
  });

  harness.controller.dispose();
  assert.equal(harness.storage.listenerCount(), 0);
  assert.equal(harness.clock.pendingCount(), 0);
  const afterDispose = notifications;
  harness.registry.transition("javascript-worker", { kind: "initializing" });
  assert.equal(notifications, afterDispose);
});

function createHarness(options: { problem?: Problem } = {}) {
  const clock = new ManualClock();
  const problems = new FakeProblemRepository();
  problems.problems.set(1, options.problem ?? problem(1));
  const storage = new FakeStorage();
  const submissions = new FakeSubmissions();
  const registry = runtimeRegistry();
  const controller = new ProblemWorkspaceController({
    problems,
    registry,
    submissions: submissions as unknown as SubmissionService,
    storage: storage as unknown as LocalCoderRepository,
    clock,
  });
  return { clock, problems, storage, submissions, registry, controller };
}

function runtimeRegistry(): RuntimeRegistry {
  return RuntimeRegistry.fromManifest(parseRuntimeManifest({
    schemaVersion: 1,
    runtimes: [
      runtime("javascript-worker", "javascript", true),
      runtime("typescript-official", "typescript", true),
      runtime("python-pyodide", "python", true),
      runtime("python-rustpython", "python", false, false),
      runtime("racket-wasm", "racket", false, false),
      runtime("haskell-ghc-wasi", "haskell", false, false),
    ],
  }));
}

function runtime(runtimeId: RuntimeId, languageId: LanguageId, required: boolean, packaged = true): object {
  return {
    runtimeId,
    languageId,
    protocolVersion: 1,
    runtimeVersion: "1.0.0",
    worker: { url: `workers/${runtimeId}.js`, type: "module" },
    assets: [{ url: `assets/${runtimeId}.wasm`, bytes: 1 }],
    required,
    packaged,
    ...(packaged ? {} : { unavailableReason: `${runtimeId} 未打包` }),
    reuse: "per-submission",
    capabilities: { execute: packaged, judge: packaged },
    timeouts: { initializeMs: 1_000, executeMs: 5_000 },
    limits: { sourceBytes: 262_144, caseCount: 100, outputBytes: 65_536 },
  };
}

function problem(id: number, templates: { racket?: string } = {}): Problem {
  return {
    schemaVersion: 2,
    id,
    slug: `problem-${id}`,
    title: `Problem ${id}`,
    difficulty: "Easy",
    summary: "Summary",
    tags: ["array"],
    examples: [{ input: "1", output: "1", explanation: "identity" }],
    constraints: ["1 <= n <= 10"],
    entrypoint: "solution",
    contract: "json-function-v1",
    templates: {
      javascript: "function solution(value) { return value; }",
      typescript: "function solution(value: number) { return value; }",
      python: "def solution(value):\n    return value",
      ...(templates.racket === undefined ? {} : { racket: templates.racket }),
    },
    tests: {
      public: [{ input: 1, expected: 1 }],
      judge: [{ input: 2, expected: 2 }],
    },
    markdown: "# Problem",
    safeHtml: "<h1>Problem</h1>",
  };
}

function settings(preferences: Partial<Record<LanguageId, RuntimeId>> = {}): SettingsRecord {
  return {
    key: "app",
    theme: "dark",
    preferredRuntimeByLanguage: preferences,
    layout: { desktopProblemPercent: 36, tabletTab: "problem" },
    updatedAt: 10,
  };
}

function result(verdict: Verdict): SubmissionResult {
  return {
    verdict,
    elapsedMs: 12,
    runtime: { runtimeId: "javascript-worker", runtimeVersion: "1.0.0", buildId: "fixture" },
    publicCases: [],
    customCases: [],
    judgeSummary: { total: 1, passed: verdict === "accepted" ? 1 : 0, failed: verdict === "accepted" ? 0 : 1 },
    output: { stdout: "", stderr: "", truncated: false },
  };
}

function outcome(
  submissionResult: SubmissionResult,
  state: SubmissionOutcome["persistence"]["state"],
): SubmissionOutcome {
  return { result: submissionResult, persistence: { state } };
}

function submissionRecord(problemId: number, verdict: Verdict): SubmissionRecord {
  return {
    id: 1,
    problemId,
    languageId: "javascript",
    runtimeId: "javascript-worker",
    runtimeVersion: "1.0.0",
    buildId: "fixture",
    source: "source",
    verdict,
    elapsedMs: 12,
    caseSummary: {
      public: { total: 1, passed: 1, failed: 0 },
      custom: { total: 0, passed: 0, failed: 0 },
      judge: { total: 1, passed: 1, failed: 0 },
    },
    output: { stdout: "", stderr: "", truncated: false },
    createdAt: 80,
  };
}

function draftKey(workspaceId: string, languageId: LanguageId, runtimeId: RuntimeId): string {
  return [workspaceId, languageId, runtimeId].join("|");
}

async function nextOutcome(queue: Array<SubmissionOutcome | Promise<SubmissionOutcome>>): Promise<SubmissionOutcome> {
  const value = queue.shift();
  if (value === undefined) throw new Error("No fake submission outcome queued");
  return value;
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
