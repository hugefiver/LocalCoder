import assert from "node:assert/strict";
import test from "node:test";
import type { Problem } from "../../src/domain/problem.js";
import { selectCases } from "../../src/oj/case-selection.js";

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
    templates: { javascript: "function solution(input) { return input; }" },
    tests: {
      public: [{ input: { kind: "public" }, expected: { answer: 1 } }],
      judge: [{ input: { kind: "judge" }, expected: { answer: 2 } }],
    },
    markdown: "",
    safeHtml: "",
  };
}

test("Run selects public and custom cases with stable sequential indexes", () => {
  const cases = selectCases(problem(), "run", [
    { input: { kind: "custom-one" }, expected: 3 },
    { input: { kind: "custom-two" }, expected: 4 },
  ]);

  assert.deepEqual(cases, [
    { index: 0, visibility: "public", input: { kind: "public" }, expected: { answer: 1 } },
    { index: 1, visibility: "custom", input: { kind: "custom-one" }, expected: 3 },
    { index: 2, visibility: "custom", input: { kind: "custom-two" }, expected: 4 },
  ]);
});

test("Submit adds judge cases after public and custom cases", () => {
  const cases = selectCases(problem(), "submit", [{ input: "custom", expected: "custom result" }]);

  assert.deepEqual(cases.map(({ index, visibility }) => ({ index, visibility })), [
    { index: 0, visibility: "public" },
    { index: 1, visibility: "custom" },
    { index: 2, visibility: "judge" },
  ]);
  assert.deepEqual(cases[2], {
    index: 2,
    visibility: "judge",
    input: { kind: "judge" },
    expected: { answer: 2 },
  });
});
