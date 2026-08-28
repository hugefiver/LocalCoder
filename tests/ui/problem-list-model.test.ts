import assert from "node:assert/strict";
import test from "node:test";

import type { Problem, ProblemDifficulty } from "../../src/domain/problem.js";
import type { ProgressRecord } from "../../src/storage/schema.js";
import { filterProblems } from "../../src/features/problems/problem-list-model.js";

const problems = [
  problem(5, "Merge Arrays", "merge-arrays", "Easy", ["array", "two-pointer"]),
  problem(3, "Graph Walk", "graph-walk", "Hard", ["graph"]),
  problem(1, "Array Sum", "array-sum", "Easy", ["array"]),
];

const progress: ProgressRecord[] = [
  {
    problemId: 1,
    attempts: 2,
    lastAttemptAt: 300,
    acceptedAt: 250,
    acceptedLanguageId: "typescript",
    acceptedRuntimeId: "typescript-official",
  },
  {
    problemId: 5,
    attempts: 1,
    lastAttemptAt: 200,
    acceptedLanguageId: "python",
    acceptedRuntimeId: "python-pyodide",
  },
  {
    problemId: 99,
    attempts: 1,
    lastAttemptAt: 1_000,
    acceptedAt: 1_000,
    acceptedLanguageId: "javascript",
    acceptedRuntimeId: "javascript-worker",
  },
];

test("filterProblems returns deterministic rows with current progress metadata", () => {
  assert.deepEqual(filterProblems(problems, progress, allFilter()), [
    {
      id: 1,
      slug: "array-sum",
      title: "Array Sum",
      difficulty: "Easy",
      tags: ["array"],
      status: "solved",
      acceptedLanguageId: "typescript",
      acceptedRuntimeId: "typescript-official",
      lastAttemptAt: 300,
    },
    {
      id: 3,
      slug: "graph-walk",
      title: "Graph Walk",
      difficulty: "Hard",
      tags: ["graph"],
      status: "unattempted",
    },
    {
      id: 5,
      slug: "merge-arrays",
      title: "Merge Arrays",
      difficulty: "Easy",
      tags: ["array", "two-pointer"],
      status: "attempted",
      lastAttemptAt: 200,
    },
  ]);
});

test("filterProblems searches title, slug, and tags case-insensitively", () => {
  assert.deepEqual(ids({ ...allFilter(), text: "ARRAY" }), [1, 5]);
  assert.deepEqual(ids({ ...allFilter(), text: "graph-walk" }), [3]);
  assert.deepEqual(ids({ ...allFilter(), text: "two-pointer" }), [5]);
});

test("filterProblems combines text, difficulty, and status filters", () => {
  assert.deepEqual(ids({ text: "array", difficulty: ["Easy"], status: "attempted" }), [5]);
  assert.deepEqual(ids({ text: "", difficulty: ["Easy"], status: "solved" }), [1]);
  assert.deepEqual(ids({ text: "", difficulty: ["Medium"], status: "all" }), []);
});

test("filterProblems omits stale accepted metadata when progress is not solved", () => {
  const [row] = filterProblems([problems[0]!], progress, allFilter());
  assert.equal(row?.status, "attempted");
  assert.equal("acceptedLanguageId" in (row ?? {}), false);
  assert.equal("acceptedRuntimeId" in (row ?? {}), false);
});

function ids(filter: Parameters<typeof filterProblems>[2]): number[] {
  return filterProblems(problems, progress, filter).map((row) => row.id);
}

function allFilter(): Parameters<typeof filterProblems>[2] {
  return { text: "", difficulty: [], status: "all" };
}

function problem(
  id: number,
  title: string,
  slug: string,
  difficulty: ProblemDifficulty,
  tags: readonly string[],
): Problem {
  return {
    schemaVersion: 2,
    id,
    slug,
    title,
    difficulty,
    summary: "Summary",
    tags,
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
