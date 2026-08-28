import assert from "node:assert/strict";
import test from "node:test";
import { parseProblemDocument, validateProblemCorpus } from "../../src/problems/problem-schema.js";
import { createProblemRepository } from "../../src/problems/problem-repository.js";

function validProblemDocument(body = "## Two Sum\n\nReturn the two indices."): string {
  return `---
schemaVersion: 2
id: 1
slug: two-sum
title: Two Sum
difficulty: Easy
summary: Return the indices of two values that add to the target.
tags:
  - array
  - hash-table
examples:
  - input: nums = [2,7,11,15], target = 9
    output: "[0,1]"
    explanation: nums[0] + nums[1] equals 9.
constraints:
  - 2 <= nums.length <= 10000
entrypoint: solution
contract: json-function-v1
templates:
  javascript: |
    function solution(input) {
      return [];
    }
  typescript: |
    function solution(input: { nums: number[]; target: number }): number[] {
      return [];
    }
  python: |
    def solution(input):
        return []
tests:
  public:
    - input: { nums: [2, 7, 11, 15], target: 9 }
      expected: [0, 1]
  judge:
    - input: { nums: [3, 3], target: 6 }
      expected: [0, 1]
---
${body}
`;
}

function expectSchemaError(raw: string, fieldPath: string): void {
  assert.throws(
    () => parseProblemDocument("fixtures/two-sum.md", raw),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^fixtures\/two-sum\.md: frontmatter\./);
      assert.match(error.message, new RegExp(fieldPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.ok(error.message.length < 600);
      return true;
    },
  );
}

test("parses a strict json-function-v1 problem document", () => {
  const problem = parseProblemDocument("001-two-sum.md", validProblemDocument());

  assert.equal(problem.schemaVersion, 2);
  assert.equal(problem.id, 1);
  assert.equal(problem.slug, "two-sum");
  assert.equal(problem.contract, "json-function-v1");
  assert.equal(problem.entrypoint, "solution");
  assert.ok(problem.tests.public.length >= 1);
  assert.ok(problem.tests.judge.length >= 1);
  assert.match(problem.safeHtml, /<h2>Two Sum<\/h2>/);
});

test("parses multiline YAML frontmatter without a global Buffer", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer");
  try {
    assert.equal(Reflect.deleteProperty(globalThis, "Buffer"), true);
    const parsed = parseProblemDocument(
      "browser-safe.md",
      validProblemDocument().replace(/\n/g, "\r\n"),
    );
    assert.equal(parsed.templates.typescript?.includes("function solution"), true);
    assert.deepEqual(parsed.tests.public[0], {
      input: { nums: [2, 7, 11, 15], target: 9 },
      expected: [0, 1],
    });
  } finally {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, "Buffer");
    else Object.defineProperty(globalThis, "Buffer", descriptor);
  }
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, "Buffer"), descriptor);
});

test("requires opening and closing frontmatter delimiters at document boundaries", () => {
  assert.throws(
    () => parseProblemDocument("fixtures/prefixed.md", `prefix text\n${validProblemDocument()}`),
    /fixtures\/prefixed\.md: frontmatter: YAML frontmatter is required/,
  );
  assert.throws(
    () => parseProblemDocument("fixtures/no-opening.md", validProblemDocument().slice(4)),
    /fixtures\/no-opening\.md: frontmatter: YAML frontmatter is required/,
  );
  assert.throws(
    () => parseProblemDocument("fixtures/no-closing.md", validProblemDocument().replace("\n---\n##", "\n##")),
    /fixtures\/no-closing\.md: frontmatter: YAML frontmatter is required/,
  );
  assert.throws(
    () => parseProblemDocument("fixtures/invalid-yaml.md", validProblemDocument().replace("id: 1", "id: [")),
    /fixtures\/invalid-yaml\.md: frontmatter: Invalid YAML frontmatter/,
  );
});

test("rejects missing or invalid strict fields", () => {
  expectSchemaError(validProblemDocument().replace("title: Two Sum\n", ""), "title");
  expectSchemaError(validProblemDocument().replace("slug: two-sum", "slug: Two Sum"), "slug");
  expectSchemaError(validProblemDocument().replace("tags:\n  - array\n  - hash-table", "tags: []"), "tags");
  expectSchemaError(
    validProblemDocument().replace(
      "examples:\n  - input: nums = [2,7,11,15], target = 9\n    output: \"[0,1]\"\n    explanation: nums[0] + nums[1] equals 9.\nconstraints:",
      "examples: []\nconstraints:",
    ),
    "examples",
  );
  expectSchemaError(
    validProblemDocument().replace("constraints:\n  - 2 <= nums.length <= 10000", "constraints: []"),
    "constraints",
  );
  expectSchemaError(
    validProblemDocument().replace(
      "  python: |",
      "  ruby: |\n    def solution(input)\n      []\n  python: |",
    ),
    "templates",
  );
  expectSchemaError(
    validProblemDocument().replace("function solution(input)", "function answer(input)"),
    "templates.javascript",
  );
  expectSchemaError(
    validProblemDocument().replace("  python: |\n    def solution(input):\n        return []\n", ""),
    "templates.python",
  );
  expectSchemaError(
    validProblemDocument().replace(
      "  public:\n    - input: { nums: [2, 7, 11, 15], target: 9 }\n      expected: [0, 1]",
      "  public: []",
    ),
    "tests.public",
  );
  expectSchemaError(
    validProblemDocument().replace(
      "  judge:\n    - input: { nums: [3, 3], target: 6 }\n      expected: [0, 1]",
      "  judge: []",
    ),
    "tests.judge",
  );
  expectSchemaError(
    validProblemDocument().replace("expected: [0, 1]", "expected: .nan"),
    "tests.public[0].expected");
  expectSchemaError(
    validProblemDocument().replace("templates:\n", "timeoutMs: 120001\ntemplates:\n"),
    "timeoutMs",
  );
  expectSchemaError(
    validProblemDocument().replace("entrypoint: solution\n", "entrypoint: solution\nunknown: nope\n"),
    "unknown",
  );
});

test("schema diagnostics identify their source filename and field path", () => {
  assert.throws(
    () => parseProblemDocument("fixtures/missing.md", validProblemDocument().replace("summary: Return the indices of two values that add to the target.\n", "")),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^fixtures\/missing\.md: frontmatter\.summary:/);
      assert.doesNotMatch(error.message, /Return the indices of two values/);
      return true;
    },
  );
});

test("validates unique corpus identities and returns ID-sorted documents", () => {
  const first = parseProblemDocument("001-two-sum.md", validProblemDocument());
  const second = parseProblemDocument(
    "002-reverse-string.md",
    validProblemDocument()
      .replace("id: 1", "id: 2")
      .replace("slug: two-sum", "slug: reverse-string")
      .replace("title: Two Sum", "title: Reverse String"),
  );

  assert.deepEqual(validateProblemCorpus([second, first]).map((problem) => problem.id), [1, 2]);
  assert.throws(() => validateProblemCorpus([first, { ...second, id: 1 }]), /duplicate id 1/);
  assert.throws(() => validateProblemCorpus([first, { ...second, slug: "two-sum" }]), /duplicate slug two-sum/);
});

test("repository is Node-testable and retries failed corpus loads without caching them", async () => {
  let attempts = 0;
  const repository = createProblemRepository({
    "001-two-sum.md": async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary loader failure");
      return validProblemDocument();
    },
  });

  await assert.rejects(repository.list(), /temporary loader failure/);
  const problems = await repository.list();
  assert.equal(attempts, 2);
  assert.equal(problems.length, 1);
  assert.equal((await repository.getById(1))?.slug, "two-sum");
  await repository.list();
  assert.equal(attempts, 2);
});
