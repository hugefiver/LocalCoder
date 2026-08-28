import assert from "node:assert/strict";
import test from "node:test";
import { type SubmissionRecord } from "../../src/storage/schema.js";
import { MemoryDriver } from "../../src/storage/memory-driver.js";
import { LocalCoderRepository, openLocalCoderRepository } from "../../src/storage/repository.js";

const NOW = 1_700_000_000_000;

function submission(index: number, overrides: Partial<Omit<SubmissionRecord, "id">> = {}): Omit<SubmissionRecord, "id"> {
  return {
    problemId: index % 2 === 0 ? 2 : 1,
    languageId: "javascript",
    runtimeId: "javascript-worker",
    runtimeVersion: `runtime-${index}`,
    buildId: `build-${index}`,
    source: `function solution() { return ${index}; }`,
    verdict: index % 2 === 0 ? "wrong-answer" : "accepted",
    elapsedMs: index,
    caseSummary: {
      public: { total: 2, passed: 1, failed: 1 },
      custom: { total: 1, passed: 1, failed: 0 },
      judge: { total: 3, passed: 2, failed: 1 },
    },
    output: { stdout: `out-${index}`, stderr: "", truncated: false },
    createdAt: NOW + index,
    ...overrides,
  };
}

test("persists exact draft, custom-case, settings, and progress records without exposing mutable state", async () => {
  const repository = await openLocalCoderRepository({ now: () => NOW });
  const draft = {
    workspaceId: "problem:1",
    languageId: "python" as const,
    runtimeId: "python-pyodide" as const,
    source: "def solution(value): return value",
    updatedAt: NOW,
  };

  await repository.saveDraft(draft);
  await repository.saveCustomCases(1, [{ input: { value: 1 }, expected: 1 }]);
  await repository.saveSettings({
    key: "app",
    theme: "dark",
    preferredRuntimeByLanguage: { python: "python-pyodide" },
    layout: { desktopProblemPercent: 60, tabletTab: "code" },
    updatedAt: NOW + 1,
  });
  await repository.recordSubmission({
    submission: submission(1),
    progressUpdate: {
      problemId: 1,
      attemptedAt: NOW + 1,
      accepted: {
        acceptedAt: NOW + 1,
        acceptedLanguageId: "javascript",
        acceptedRuntimeId: "javascript-worker",
      },
    },
  });

  const readDraft = await repository.getDraft(["problem:1", "python", "python-pyodide"]);
  assert.deepEqual(readDraft, draft);
  if (readDraft === undefined) assert.fail("missing draft");
  readDraft.source = "mutated";
  assert.equal((await repository.getDraft(["problem:1", "python", "python-pyodide"]))?.source, draft.source);
  assert.deepEqual(await repository.getCustomCases(1), [{ input: { value: 1 }, expected: 1 }]);
  assert.deepEqual(await repository.getSettings(), {
    key: "app",
    theme: "dark",
    preferredRuntimeByLanguage: { python: "python-pyodide" },
    layout: { desktopProblemPercent: 60, tabletTab: "code" },
    updatedAt: NOW + 1,
  });
  assert.deepEqual(await repository.getProgress(1), {
    problemId: 1,
    attempts: 1,
    lastAttemptAt: NOW + 1,
    acceptedAt: NOW + 1,
    acceptedLanguageId: "javascript",
    acceptedRuntimeId: "javascript-worker",
  });
  assert.equal((await repository.listSubmissions())[0]?.runtimeVersion, "runtime-1");
  assert.deepEqual(await repository.getSettings(), await repository.getSettings());
  repository.close();
});

test("caps submission history atomically at 200 and combines newest-first filters", async () => {
  const repository = await openLocalCoderRepository({ now: () => NOW });
  for (let index = 1; index <= 201; index += 1) {
    await repository.recordSubmission({ submission: submission(index) });
  }

  const all = await repository.listSubmissions();
  assert.equal(all.length, 200);
  assert.equal(all[0]?.id, 201);
  assert.equal(all[all.length - 1]?.id, 2);
  assert.equal(all[0]?.source, "function solution() { return 201; }");
  assert.equal(all[0]?.runtimeVersion, "runtime-201");
  assert.equal(all[0]?.buildId, "build-201");
  assert.equal(all[0]?.verdict, "accepted");
  assert.equal(all[0]?.createdAt, NOW + 201);

  const filtered = await repository.listSubmissions({
    problemId: 1,
    runtimeId: "javascript-worker",
    verdicts: ["accepted"],
    limit: 3,
  });
  assert.deepEqual(filtered.map(({ id }) => id), [201, 199, 197]);
  repository.close();
});

test("merges accepted metadata from the transaction current progress for accepted and non-accepted orderings", async () => {
  const repository = await openLocalCoderRepository({ now: () => NOW });
  const accepted = {
    acceptedAt: NOW + 11,
    acceptedLanguageId: "javascript" as const,
    acceptedRuntimeId: "javascript-worker" as const,
  };

  await repository.recordSubmission({
    submission: submission(1, { createdAt: NOW + 1, verdict: "accepted" }),
    progressUpdate: { problemId: 1, attemptedAt: NOW + 11, accepted },
  });
  await repository.recordSubmission({
    submission: submission(2, { problemId: 1, createdAt: NOW + 2, verdict: "wrong-answer" }),
    progressUpdate: { problemId: 1, attemptedAt: NOW + 12 },
  });
  assert.deepEqual(await repository.getProgress(1), {
    problemId: 1,
    attempts: 2,
    lastAttemptAt: NOW + 12,
    ...accepted,
  });

  await repository.recordSubmission({
    submission: submission(4, { createdAt: NOW + 3, verdict: "wrong-answer" }),
    progressUpdate: { problemId: 2, attemptedAt: NOW + 21 },
  });
  await repository.recordSubmission({
    submission: submission(6, { createdAt: NOW + 4, verdict: "accepted" }),
    progressUpdate: { problemId: 2, attemptedAt: NOW + 22, accepted },
  });
  assert.deepEqual(await repository.getProgress(2), {
    problemId: 2,
    attempts: 2,
    lastAttemptAt: NOW + 22,
    ...accepted,
  });
  repository.close();
});

test("concurrent repositories sharing one MemoryDriver retain attempts, submissions, and prior acceptance metadata", async () => {
  const driver = new MemoryDriver();
  const left = new LocalCoderRepository({
    driver,
    storageState: { kind: "memory", message: "未保存", reason: "test" },
    now: () => NOW,
  });
  const right = new LocalCoderRepository({
    driver,
    storageState: { kind: "memory", message: "未保存", reason: "test" },
    now: () => NOW,
  });
  const accepted = {
    acceptedAt: NOW + 30,
    acceptedLanguageId: "javascript" as const,
    acceptedRuntimeId: "javascript-worker" as const,
  };

  await left.recordSubmission({
    submission: submission(3, { problemId: 3, createdAt: NOW, verdict: "accepted" }),
    progressUpdate: { problemId: 3, attemptedAt: NOW + 30, accepted },
  });
  const first = left.recordSubmission({
    submission: submission(5, { problemId: 3, createdAt: NOW + 1, verdict: "wrong-answer" }),
    progressUpdate: { problemId: 3, attemptedAt: NOW + 31 },
  });
  const second = right.recordSubmission({
    submission: submission(7, { problemId: 3, createdAt: NOW + 2, verdict: "wrong-answer" }),
    progressUpdate: { problemId: 3, attemptedAt: NOW + 32 },
  });
  await Promise.all([first, second]);

  assert.equal((await left.listSubmissions({ problemId: 3 })).length, 3);
  assert.deepEqual(await right.getProgress(3), {
    problemId: 3,
    attempts: 3,
    lastAttemptAt: NOW + 32,
    ...accepted,
  });
  left.close();
  right.close();
});

test("fails closed without adding a submission when progress attempts cannot safely increment", async () => {
  const driver = new MemoryDriver();
  const repository = new LocalCoderRepository({
    driver,
    storageState: { kind: "memory", message: "未保存", reason: "test" },
    now: () => NOW,
  });
  await driver.transaction(["progress"], "readwrite", async (transaction) => {
    await transaction.put("progress", {
      problemId: 9,
      attempts: Number.MAX_SAFE_INTEGER,
      lastAttemptAt: NOW,
    });
  });

  await assert.rejects(
    repository.recordSubmission({
      submission: submission(9, { problemId: 9, verdict: "wrong-answer" }),
      progressUpdate: { problemId: 9, attemptedAt: NOW + 1 },
    }),
    /cannot increment/,
  );
  assert.equal((await repository.listSubmissions({ problemId: 9 })).length, 0);
  assert.deepEqual(await repository.getProgress(9), {
    problemId: 9,
    attempts: Number.MAX_SAFE_INTEGER,
    lastAttemptAt: NOW,
  });
  repository.close();
});

test("memory transactions roll back an injected failure without advancing auto-increment state", async () => {
  const driver = new MemoryDriver();
  driver.failNextTransaction(new Error("injected transaction failure"));

  await assert.rejects(
    driver.transaction(["submissions", "progress"], "readwrite", async (transaction) => {
      await transaction.add("submissions", { id: 1, marker: "rolled-back" });
      await transaction.put("progress", { problemId: 1, attempts: 1 }, 1);
    }),
    /injected transaction failure/,
  );

  await driver.transaction(["submissions", "progress"], "readonly", async (transaction) => {
    assert.equal(await transaction.count("submissions"), 0);
    assert.equal(await transaction.get("progress", 1), undefined);
  });

  const nextId = await driver.transaction(["submissions"], "readwrite", (transaction) => (
    transaction.add("submissions", { marker: "committed" })
  ));
  assert.equal(nextId, 1);
});

test("MemoryDriver queues overlapping transactions before snapshots and releases the queue after rollback", async () => {
  const driver = new MemoryDriver();
  const firstStarted = deferred<void>();
  const releaseFirst = deferred<void>();
  const first = driver.transaction(["submissions"], "readwrite", async (transaction) => {
    firstStarted.resolve();
    await releaseFirst.promise;
    return transaction.add("submissions", { marker: "first" });
  });
  await firstStarted.promise;
  const second = driver.transaction(["submissions"], "readwrite", (transaction) => (
    transaction.add("submissions", { marker: "second" })
  ));
  await waitForTurn();
  releaseFirst.resolve();

  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  await driver.transaction(["submissions"], "readonly", async (transaction) => {
    assert.equal(await transaction.count("submissions"), 2);
  });

  driver.failNextTransaction(new Error("queued rollback"));
  const rejected = driver.transaction(["submissions"], "readwrite", (transaction) => (
    transaction.add("submissions", { marker: "rolled-back" })
  ));
  const following = driver.transaction(["submissions"], "readwrite", (transaction) => (
    transaction.add("submissions", { marker: "following" })
  ));
  await assert.rejects(rejected, /queued rollback/);
  assert.equal(await following, 3);
  await driver.transaction(["submissions"], "readonly", async (transaction) => {
    assert.equal(await transaction.count("submissions"), 3);
  });
});

test("rejects non-canonical records and incompatible language/runtime pairs at the repository boundary", async () => {
  const repository = await openLocalCoderRepository({ now: () => NOW });

  await assert.rejects(
    repository.saveDraft({
      workspaceId: "problem:1",
      languageId: "python",
      runtimeId: "javascript-worker",
      source: "x",
      updatedAt: NOW,
    }),
    /runtimeId/,
  );
  await assert.rejects(
    repository.saveCustomCases(1, [{ input: Number.NaN, expected: 1 }]),
    /canonical JSON/,
  );
  await assert.rejects(
    repository.recordSubmission({
      submission: submission(1, { output: { stdout: "x", stderr: "", truncated: false }, elapsedMs: Number.NaN }),
    }),
    /elapsedMs/,
  );
  await assert.rejects(
    repository.recordSubmission({
      submission: submission(1),
      progressUpdate: {
        problemId: 1,
        attemptedAt: NOW,
        accepted: { acceptedAt: NOW, acceptedLanguageId: "javascript" },
      } as never,
    }),
    /acceptedRuntimeId/,
  );
  await assert.rejects(
    repository.recordSubmission({
      submission: submission(1),
      progressUpdate: { problemId: 1, attemptedAt: Number.POSITIVE_INFINITY },
    }),
    /attemptedAt/,
  );
  await assert.rejects(
    repository.recordSubmission({
      submission: submission(1),
      progressUpdate: {
        problemId: 1,
        attemptedAt: NOW,
        accepted: {
          acceptedAt: NOW,
          acceptedLanguageId: "javascript",
          acceptedRuntimeId: "python-pyodide",
        },
      },
    }),
    /does not support/,
  );
  await assert.rejects(
    repository.recordSubmission({
      submission: submission(2, { verdict: "wrong-answer" }),
      progressUpdate: {
        problemId: 2,
        attemptedAt: NOW,
        accepted: {
          acceptedAt: NOW,
          acceptedLanguageId: "javascript",
          acceptedRuntimeId: "javascript-worker",
        },
      },
    }),
    /only accompany an accepted submission/,
  );
  await assert.rejects(
    repository.recordSubmission({
      submission: submission(1),
      progress: { problemId: 1, attempts: 1, lastAttemptAt: NOW },
    } as never),
    /unknown field/,
  );
  repository.close();
});

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function waitForTurn(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
