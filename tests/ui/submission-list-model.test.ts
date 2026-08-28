import assert from "node:assert/strict";
import test from "node:test";

import type { Problem } from "../../src/domain/problem.js";
import type { Verdict } from "../../src/domain/submission.js";
import {
  buildSubmissionRows,
  type SubmissionFilter,
} from "../../src/features/submissions/submission-list-model.js";
import type { SubmissionRecord } from "../../src/storage/schema.js";

const ALL_FILTER: SubmissionFilter = { verdicts: [] };
const PROBLEMS = [problem(1, "两数之和"), problem(2, "反转字符串")];

test("buildSubmissionRows sorts newest first and breaks timestamp ties by submission id descending", () => {
  const rows = buildSubmissionRows([
    submission(3, { createdAt: 200 }),
    submission(8, { createdAt: 100 }),
    submission(7, { createdAt: 200 }),
  ], PROBLEMS, ALL_FILTER);

  assert.deepEqual(rows.map((row) => row.submissionId), [7, 3, 8]);
});

test("buildSubmissionRows combines problem, runtime, and verdict filters with AND semantics", () => {
  const records = [
    submission(1, { problemId: 1, runtimeId: "javascript-worker", verdict: "accepted" }),
    submission(2, { problemId: 1, runtimeId: "javascript-worker", verdict: "wrong-answer" }),
    submission(3, { problemId: 1, runtimeId: "python-pyodide", verdict: "accepted", languageId: "python" }),
    submission(4, { problemId: 2, runtimeId: "javascript-worker", verdict: "accepted" }),
  ];

  assert.deepEqual(
    buildSubmissionRows(records, PROBLEMS, {
      problemId: 1,
      runtimeId: "javascript-worker",
      verdicts: ["accepted"],
    }).map((row) => row.submissionId),
    [1],
  );
  assert.deepEqual(
    buildSubmissionRows(records, PROBLEMS, { verdicts: [] }).map((row) => row.submissionId),
    [4, 3, 2, 1],
    "an empty verdict selection means all verdicts",
  );
});

test("buildSubmissionRows identifies unknown problems and derives runtime and elapsed labels", () => {
  const [row] = buildSubmissionRows([
    submission(9, { problemId: 999, elapsedMs: 12 }),
  ], PROBLEMS, ALL_FILTER);

  assert.equal(row?.problemLabel, "未知题目 #999");
  assert.equal(row?.runtimeLabel, "JavaScript / javascript-worker");
  assert.equal(row?.elapsedLabel, "12 ms（本机参考）");
});

test("buildSubmissionRows covers every verdict label", () => {
  const expected: Readonly<Record<Verdict, string>> = {
    accepted: "AC · 通过",
    "wrong-answer": "WA · 答案错误",
    "compile-error": "CE · 编译错误",
    "runtime-error": "RE · 运行错误",
    "time-limit-exceeded": "TLE · 超时",
    cancelled: "已取消",
    "internal-error": "内部错误",
    "runtime-unavailable": "运行时不可用",
  };
  const verdicts = Object.keys(expected) as Verdict[];
  const rows = buildSubmissionRows(
    verdicts.map((verdict, index) => submission(index + 1, { verdict })),
    PROBLEMS,
    ALL_FILTER,
  );

  assert.deepEqual(
    Object.fromEntries(rows.map((row) => [row.verdict, row.verdictLabel])),
    expected,
  );
});

test("buildSubmissionRows returns an empty frozen collection for no records", () => {
  const rows = buildSubmissionRows([], PROBLEMS, ALL_FILTER);

  assert.deepEqual(rows, []);
  assert.equal(Object.isFrozen(rows), true);
});

test("buildSubmissionRows snapshots and deep-freezes source, output, and case counts", () => {
  const record = submission(1, {
    source: "const answer = 1;",
    caseSummary: {
      public: { total: 2, passed: 2, failed: 0 },
      custom: { total: 1, passed: 0, failed: 1 },
      judge: { total: 12, passed: 11, failed: 1 },
    },
    output: { stdout: "before", stderr: "", truncated: false },
  });
  const rows = buildSubmissionRows([record], PROBLEMS, ALL_FILTER);
  const row = rows[0]!;

  record.source = "mutated";
  record.caseSummary.judge.passed = 0;
  record.output.stdout = "after";

  assert.equal(row.source, "const answer = 1;");
  assert.deepEqual(row.caseSummary.judge, { total: 12, passed: 11, failed: 1 });
  assert.deepEqual(row.output, { stdout: "before", stderr: "", truncated: false });
  assert.equal(Object.isFrozen(rows), true);
  assert.equal(Object.isFrozen(row), true);
  assert.equal(Object.isFrozen(row.caseSummary), true);
  assert.equal(Object.isFrozen(row.caseSummary.judge), true);
  assert.equal(Object.isFrozen(row.output), true);
});

test("submission rows expose judge information as counts only", () => {
  const [row] = buildSubmissionRows([
    submission(1, {
      caseSummary: {
        public: { total: 1, passed: 1, failed: 0 },
        custom: { total: 0, passed: 0, failed: 0 },
        judge: { total: 20, passed: 19, failed: 1 },
      },
    }),
  ], PROBLEMS, ALL_FILTER);

  assert.deepEqual(row?.caseSummary.judge, { total: 20, passed: 19, failed: 1 });
  assert.doesNotMatch(JSON.stringify(row), /"(?:input|expected|actual)"/);
});

function submission(
  id: number,
  overrides: Partial<SubmissionRecord> = {},
): SubmissionRecord {
  return {
    id,
    problemId: 1,
    languageId: "javascript",
    runtimeId: "javascript-worker",
    runtimeVersion: "1.0.0",
    buildId: "build-1",
    source: "function solution() { return 1; }",
    verdict: "accepted",
    elapsedMs: 10,
    caseSummary: {
      public: { total: 1, passed: 1, failed: 0 },
      custom: { total: 0, passed: 0, failed: 0 },
      judge: { total: 2, passed: 2, failed: 0 },
    },
    output: { stdout: "", stderr: "", truncated: false },
    createdAt: id,
    ...overrides,
  };
}

function problem(id: number, title: string): Problem {
  return {
    schemaVersion: 2,
    id,
    slug: `problem-${id}`,
    title,
    difficulty: "Easy",
    summary: "Fixture",
    tags: [],
    examples: [],
    constraints: [],
    entrypoint: "solution",
    contract: "json-function-v1",
    templates: { javascript: "function solution() {}" },
    tests: { public: [], judge: [] },
    markdown: "",
    safeHtml: "",
  };
}
