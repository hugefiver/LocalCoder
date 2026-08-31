import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { LANGUAGE_IDS } from "../../src/domain/language.js";
import { parseProblemDocument, validateProblemCorpus } from "../../src/problems/problem-schema.js";

const problemsDirectory = path.resolve(process.cwd(), "src/problems");
const problemDocumentPattern = /^[0-9]{3}-.*\.md$/;
const expectedSlugs = [
  "two-sum",
  "reverse-string",
  "valid-palindrome",
  "maximum-subarray",
  "merge-two-sorted-lists",
  "longest-substring-without-repeating",
];

test("the disk corpus is exactly the stable six validated problems", async () => {
  const filenames = (await readdir(problemsDirectory))
    .filter((filename) => problemDocumentPattern.test(filename))
    .sort();

  assert.equal(filenames.length, 6);
  assert.deepEqual(filenames, [
    "001-two-sum.md",
    "002-reverse-string.md",
    "003-valid-palindrome.md",
    "004-maximum-subarray.md",
    "005-merge-two-sorted-lists.md",
    "006-longest-substring-without-repeating.md",
  ]);

  const parsed = await Promise.all(filenames.map(async (filename) => (
    parseProblemDocument(filename, await readFile(path.join(problemsDirectory, filename), "utf8"))
  )));
  const corpus = validateProblemCorpus(parsed);

  assert.deepEqual(corpus.map((problem) => problem.id), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(corpus.map((problem) => problem.slug), expectedSlugs);
  for (const problem of corpus) {
    assert.ok(problem.tests.public.length >= 1, `${problem.slug} needs a public case`);
    assert.ok(problem.tests.judge.length >= 1, `${problem.slug} needs a judge case`);
    for (const language of ["javascript", "typescript", "python"] as const) {
      assert.ok(problem.templates[language]?.trim(), `${problem.slug} needs ${language}`);
    }
    for (const language of Object.keys(problem.templates)) {
      assert.ok(LANGUAGE_IDS.includes(language as (typeof LANGUAGE_IDS)[number]));
    }
  }
});
