import assert from "node:assert/strict";
import test from "node:test";
import type { Problem } from "../../src/domain/problem.js";
import type { JudgeCommand, SubmissionResult, Verdict, VisibleCaseResult } from "../../src/domain/submission.js";
import { OjEngine } from "../../src/oj/engine.js";
import { SubmissionService } from "../../src/services/submission-service.js";
import { MemoryDriver } from "../../src/storage/memory-driver.js";
import { LocalCoderRepository } from "../../src/storage/repository.js";
import type { AtomicSubmissionWrite, StorageState } from "../../src/storage/schema.js";

const NOW = 1_700_000_000_000;
const RUNTIME = {
  runtimeId: "javascript-worker" as const,
  runtimeVersion: "handshake-version",
  buildId: "handshake-build",
};

class FakeEngine {
  readonly calls: JudgeCommand[] = [];
  readonly outcomes: SubmissionResult[] = [];

  async run(command: JudgeCommand): Promise<SubmissionResult> {
    this.calls.push(command);
    const outcome = this.outcomes.shift();
    if (outcome === undefined) throw new Error("FakeEngine has no queued result");
    return outcome;
  }
}

class FakeRepository {
  readonly recordSubmissionCalls: AtomicSubmissionWrite[] = [];
  storageState: StorageState = { kind: "persistent" };
  recordSubmissionFailure: unknown;

  async getProgress(): Promise<never> {
    throw new Error("SubmissionService must not read progress outside recordSubmission");
  }

  async recordSubmission(input: AtomicSubmissionWrite): Promise<number> {
    this.recordSubmissionCalls.push(input);
    if (this.recordSubmissionFailure !== undefined) throw this.recordSubmissionFailure;
    return this.recordSubmissionCalls.length;
  }
}

function problem(): Problem {
  return {
    schemaVersion: 2,
    id: 1,
    slug: "fixture",
    title: "Fixture",
    difficulty: "Easy",
    summary: "Fixture problem",
    tags: [],
    examples: [],
    constraints: [],
    entrypoint: "solution",
    contract: "json-function-v1",
    templates: {
      javascript: "function solution(value) { return value; }",
      typescript: "function solution(value: number) { return value; }",
    },
    tests: { public: [{ input: 1, expected: 1 }], judge: [{ input: 2, expected: 2 }] },
    markdown: "",
    safeHtml: "",
  };
}

function command(): Omit<JudgeCommand, "mode"> {
  return {
    problem: problem(),
    runtimeId: "javascript-worker",
    source: "function solution(value) { return value; }",
    customCases: [{ input: 3, expected: 3 }],
  };
}

function visibleCase(equal: boolean): VisibleCaseResult {
  return {
    index: 0,
    visibility: "public",
    input: 1,
    expected: 1,
    actual: equal ? 1 : 2,
    comparison: equal ? { equal: true } : { equal: false, path: "$", reason: "value-mismatch", actual: 2, expected: 1 },
    stdout: "visible output",
    stderr: "",
  };
}

function result(options: {
  verdict?: Verdict;
  runtime?: SubmissionResult["runtime"];
  publicCases?: readonly VisibleCaseResult[];
  customCases?: readonly VisibleCaseResult[];
  judgeSummary?: SubmissionResult["judgeSummary"];
} = {}): SubmissionResult {
  const runtime = Object.prototype.hasOwnProperty.call(options, "runtime") ? options.runtime : RUNTIME;
  return {
    verdict: options.verdict ?? "accepted",
    elapsedMs: 12,
    ...(runtime === undefined ? {} : { runtime }),
    publicCases: options.publicCases ?? [visibleCase(true)],
    customCases: options.customCases ?? [visibleCase(true)],
    judgeSummary: options.judgeSummary ?? { total: 2, passed: 2, failed: 0 },
    output: { stdout: "visible output", stderr: "", truncated: false },
  };
}

function service(engine: FakeEngine, repository: FakeRepository): SubmissionService {
  return new SubmissionService({
    engine: engine as unknown as OjEngine,
    repository: repository as unknown as LocalCoderRepository,
    now: () => NOW,
  });
}

test("Run invokes the engine once without reading or writing repository state", async () => {
  const engine = new FakeEngine();
  const repository = new FakeRepository();
  engine.outcomes.push(result());

  const outcome = await service(engine, repository).run(command());

  assert.equal(outcome.result.verdict, "accepted");
  assert.deepEqual(outcome.persistence, { state: "not-requested" });
  assert.equal(engine.calls.length, 1);
  assert.equal(engine.calls[0]?.mode, "run");
  assert.equal(repository.recordSubmissionCalls.length, 0);
});

test("Submit records one source snapshot with accepted progress in the same repository write", async () => {
  const engine = new FakeEngine();
  const repository = new FakeRepository();
  engine.outcomes.push(result());

  const outcome = await service(engine, repository).submit(command());

  assert.equal(outcome.result.verdict, "accepted");
  assert.deepEqual(outcome.persistence, { state: "saved" });
  assert.equal(engine.calls.length, 1);
  assert.equal(engine.calls[0]?.mode, "submit");
  assert.equal(repository.recordSubmissionCalls.length, 1);
  assert.deepEqual(repository.recordSubmissionCalls[0], {
    submission: {
      problemId: 1,
      languageId: "javascript",
      runtimeId: "javascript-worker",
      runtimeVersion: "handshake-version",
      buildId: "handshake-build",
      source: "function solution(value) { return value; }",
      verdict: "accepted",
      elapsedMs: 12,
      caseSummary: {
        public: { total: 1, passed: 1, failed: 0 },
        custom: { total: 1, passed: 1, failed: 0 },
        judge: { total: 2, passed: 2, failed: 0 },
      },
      output: { stdout: "visible output", stderr: "", truncated: false },
      createdAt: NOW,
    },
    progressUpdate: {
      problemId: 1,
      attemptedAt: NOW,
      accepted: {
        acceptedLanguageId: "javascript",
        acceptedRuntimeId: "javascript-worker",
        acceptedAt: NOW,
      },
    },
  });
  assert.doesNotMatch(JSON.stringify(repository.recordSubmissionCalls[0]), /"input"|"expected"|"actual"/);
});

test("Submit sends an attempt delta for every judged non-accepted attempt", async () => {
  const engine = new FakeEngine();
  const repository = new FakeRepository();
  const verdicts: readonly Verdict[] = [
    "wrong-answer",
    "compile-error",
    "runtime-error",
    "time-limit-exceeded",
    "internal-error",
  ];
  for (const verdict of verdicts) engine.outcomes.push(result({ verdict }));
  const submissionService = service(engine, repository);

  for (const verdict of verdicts) {
    const outcome = await submissionService.submit(command());
    assert.equal(outcome.result.verdict, verdict);
    assert.deepEqual(outcome.persistence, { state: "saved" });
  }

  assert.deepEqual(repository.recordSubmissionCalls.map((call) => call.progressUpdate), [
    { problemId: 1, attemptedAt: NOW },
    { problemId: 1, attemptedAt: NOW },
    { problemId: 1, attemptedAt: NOW },
    { problemId: 1, attemptedAt: NOW },
    { problemId: 1, attemptedAt: NOW },
  ]);
  assert.deepEqual(repository.recordSubmissionCalls.map((call) => call.submission.verdict), verdicts);
});

test("Concurrent Submit calls atomically retain both real MemoryDriver submissions and attempts", async () => {
  const driver = new MemoryDriver();
  const repository = new LocalCoderRepository({
    driver,
    storageState: { kind: "persistent" },
    now: () => NOW,
  });
  let arrivals = 0;
  let releaseBoth!: () => void;
  const bothEntered = new Promise<void>((resolve) => {
    releaseBoth = resolve;
  });
  let releaseEngines!: () => void;
  const engineGate = new Promise<void>((resolve) => {
    releaseEngines = resolve;
  });
  const engineFor = (outcome: SubmissionResult) => ({
    async run(): Promise<SubmissionResult> {
      arrivals += 1;
      if (arrivals === 2) releaseBoth();
      await engineGate;
      return outcome;
    },
  });
  const firstService = new SubmissionService({
    engine: engineFor(result({ verdict: "accepted" })) as unknown as OjEngine,
    repository,
    now: () => NOW,
  });
  const secondService = new SubmissionService({
    engine: engineFor(result({ verdict: "wrong-answer" })) as unknown as OjEngine,
    repository,
    now: () => NOW + 1,
  });

  const first = firstService.submit(command());
  const second = secondService.submit(command());
  await bothEntered;
  releaseEngines();
  const [firstOutcome, secondOutcome] = await Promise.all([first, second]);

  assert.equal(firstOutcome.persistence.state, "saved");
  assert.equal(secondOutcome.persistence.state, "saved");
  assert.equal((await repository.listSubmissions()).length, 2);
  assert.deepEqual(await repository.getProgress(1), {
    problemId: 1,
    attempts: 2,
    lastAttemptAt: NOW + 1,
    acceptedAt: NOW,
    acceptedLanguageId: "javascript",
    acceptedRuntimeId: "javascript-worker",
  });
});

test("Submit leaves cancelled and results without a validated runtime identity unpersisted", async () => {
  const engine = new FakeEngine();
  const repository = new FakeRepository();
  engine.outcomes.push(
    result({ verdict: "cancelled" }),
    result({ verdict: "runtime-unavailable", runtime: undefined }),
  );
  const submissionService = service(engine, repository);

  const cancelled = await submissionService.submit(command());
  const unavailable = await submissionService.submit(command());

  assert.equal(cancelled.result.verdict, "cancelled");
  assert.deepEqual(cancelled.result.runtime, RUNTIME);
  assert.equal(unavailable.result.verdict, "runtime-unavailable");
  assert.equal(unavailable.result.runtime, undefined);
  assert.deepEqual(cancelled.persistence, { state: "not-requested" });
  assert.deepEqual(unavailable.persistence, { state: "not-requested" });
  assert.equal(repository.recordSubmissionCalls.length, 0);
});

test("Submit reports a bounded persistence failure without replacing the computed verdict", async () => {
  const engine = new FakeEngine();
  const repository = new FakeRepository();
  const computed = result({ verdict: "wrong-answer" });
  engine.outcomes.push(computed);
  repository.recordSubmissionFailure = new Error("storage transaction rejected".repeat(40));

  const outcome = await service(engine, repository).submit(command());

  assert.strictEqual(outcome.result, computed);
  assert.equal(outcome.persistence.state, "failed");
  assert.match(outcome.persistence.message ?? "", /未保存.*重试/);
  assert.ok((outcome.persistence.message?.length ?? 0) <= 256);
  assert.equal(repository.recordSubmissionCalls.length, 1);
});

test("Submit reports successful memory-only writes with an explicit 未保存 reason", async () => {
  const engine = new FakeEngine();
  const repository = new FakeRepository();
  repository.storageState = { kind: "memory", message: "未保存", reason: "IndexedDB is unavailable" };
  engine.outcomes.push(result());

  const outcome = await service(engine, repository).submit(command());

  assert.equal(outcome.persistence.state, "memory-only");
  assert.equal(outcome.persistence.message, "未保存：IndexedDB is unavailable");
  assert.equal(repository.recordSubmissionCalls.length, 1);
});

test("Saved listeners are notified after persistent and memory-only submission writes", async () => {
  const engine = new FakeEngine();
  const repository = new FakeRepository();
  const submissionService = service(engine, repository);
  const notifications: string[] = [];
  submissionService.subscribeSaved(() => notifications.push(repository.storageState.kind));
  engine.outcomes.push(result(), result());

  await submissionService.submit(command());
  repository.storageState = { kind: "memory", message: "未保存", reason: "session only" };
  await submissionService.submit(command());

  assert.deepEqual(notifications, ["persistent", "memory"]);
});

test("Saved listeners are not notified for run, cancelled, unavailable, or failed writes", async () => {
  const engine = new FakeEngine();
  const repository = new FakeRepository();
  const submissionService = service(engine, repository);
  let notifications = 0;
  submissionService.subscribeSaved(() => {
    notifications += 1;
  });
  engine.outcomes.push(
    result(),
    result({ verdict: "cancelled" }),
    result({ verdict: "runtime-unavailable", runtime: undefined }),
    result({ verdict: "wrong-answer" }),
  );

  await submissionService.run(command());
  await submissionService.submit(command());
  await submissionService.submit(command());
  repository.recordSubmissionFailure = new Error("write failed");
  await submissionService.submit(command());

  assert.equal(notifications, 0);
});

test("Saved listener failures are isolated and unsubscribe prevents later notification", async () => {
  const engine = new FakeEngine();
  const repository = new FakeRepository();
  const submissionService = service(engine, repository);
  let healthyNotifications = 0;
  submissionService.subscribeSaved(() => {
    throw new Error("observer failed");
  });
  const unsubscribe = submissionService.subscribeSaved(() => {
    healthyNotifications += 1;
  });
  engine.outcomes.push(result(), result());

  const first = await submissionService.submit(command());
  unsubscribe();
  const second = await submissionService.submit(command());

  assert.equal(first.persistence.state, "saved");
  assert.equal(second.persistence.state, "saved");
  assert.equal(healthyNotifications, 1);
});
