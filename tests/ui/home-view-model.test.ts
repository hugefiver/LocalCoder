import assert from "node:assert/strict";
import test from "node:test";

import type { Problem } from "../../src/domain/problem.js";
import type { ProgressRecord, SubmissionRecord } from "../../src/storage/schema.js";
import { buildHomeSummary } from "../../src/features/home/home-view-model.js";

test("buildHomeSummary reports an empty local history without optional placeholders", () => {
  assert.deepEqual(buildHomeSummary([problem(2), problem(1)], [], []), {
    solved: 0,
    attempted: 0,
    total: 2,
    runtimeSummary: [],
  });
});

test("buildHomeSummary uses current progress and known accepted submissions", () => {
  const problems = [problem(4), problem(1), problem(2)];
  const progress: ProgressRecord[] = [
    {
      problemId: 1,
      attempts: 2,
      lastAttemptAt: 100,
      acceptedAt: 90,
      acceptedLanguageId: "javascript",
      acceptedRuntimeId: "javascript-worker",
    },
    { problemId: 2, attempts: 1, lastAttemptAt: 110 },
    {
      problemId: 99,
      attempts: 1,
      lastAttemptAt: 1_000,
      acceptedAt: 1_000,
      acceptedLanguageId: "typescript",
      acceptedRuntimeId: "typescript-official",
    },
  ];
  const submissions = [
    submission(1, "javascript-worker", "accepted", 120),
    submission(2, "typescript-official", "wrong-answer", 130),
    submission(4, "javascript-worker", "accepted", 140),
    submission(99, "python-pyodide", "accepted", 1_000),
  ];

  assert.deepEqual(buildHomeSummary(problems, progress, submissions), {
    solved: 1,
    attempted: 2,
    total: 3,
    recentProblemId: 4,
    runtimeSummary: [{ runtimeId: "javascript-worker", accepted: 2 }],
  });
});

test("buildHomeSummary falls back to attempted progress with deterministic ties", () => {
  const progress: ProgressRecord[] = [
    { problemId: 3, attempts: 1, lastAttemptAt: 500 },
    { problemId: 1, attempts: 1, lastAttemptAt: 500 },
    { problemId: 2, attempts: 0, lastAttemptAt: 900 },
  ];

  assert.equal(buildHomeSummary([problem(3), problem(2), problem(1)], progress, []).recentProblemId, 1);
});

test("accepted submission history does not turn stale progress into solved progress", () => {
  const summary = buildHomeSummary(
    [problem(1)],
    [],
    [submission(1, "python-pyodide", "accepted", 20)],
  );

  assert.equal(summary.solved, 0);
  assert.equal(summary.attempted, 0);
  assert.equal(summary.recentProblemId, 1);
  assert.deepEqual(summary.runtimeSummary, [{ runtimeId: "python-pyodide", accepted: 1 }]);
});

function problem(id: number): Problem {
  return {
    schemaVersion: 2,
    id,
    slug: `problem-${id}`,
    title: `Problem ${id}`,
    difficulty: "Easy",
    summary: "Summary",
    tags: ["array"],
    examples: [],
    constraints: [],
    entrypoint: "solution",
    contract: "json-function-v1",
    templates: {
      javascript: "function solution(input) { return input; }",
      typescript: "function solution(input: unknown) { return input; }",
      python: "def solution(input):\n    return input",
    },
    tests: {
      public: [{ input: null, expected: null }],
      judge: [{ input: true, expected: true }],
    },
    markdown: "# Problem",
    safeHtml: "<h1>Problem</h1>",
  };
}

function submission(
  problemId: number,
  runtimeId: SubmissionRecord["runtimeId"],
  verdict: SubmissionRecord["verdict"],
  createdAt: number,
): SubmissionRecord {
  const languageId = runtimeId === "javascript-worker"
    ? "javascript"
    : runtimeId === "typescript-official"
      ? "typescript"
      : "python";
  return {
    id: createdAt,
    problemId,
    languageId,
    runtimeId,
    runtimeVersion: "test-runtime",
    buildId: "test-build",
    source: "source",
    verdict,
    elapsedMs: 1,
    caseSummary: {
      public: { total: 1, passed: 1, failed: 0 },
      custom: { total: 0, passed: 0, failed: 0 },
      judge: { total: 1, passed: 1, failed: 0 },
    },
    output: { stdout: "", stderr: "", truncated: false },
    createdAt,
  };
}
