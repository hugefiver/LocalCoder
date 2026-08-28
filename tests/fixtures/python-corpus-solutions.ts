import type { JsonValue } from "../../src/domain/json-value.js";
import {
  PYTHON_CORPUS_SOURCES,
  type PythonCorpusFixture,
} from "../../src/runtime/python-parity.js";

export const PYTHON_CORPUS_FIXTURE_SOURCES = PYTHON_CORPUS_SOURCES;

export const PYTHON_CORPUS_FIXTURES: readonly PythonCorpusFixture[] = Object.freeze([
  fixture(1, [{ nums: [2, 7, 11, 15], target: 9 }, { nums: [3, 2, 4], target: 6 }, { nums: [3, 3], target: 6 }], [[0, 1], [1, 2], [0, 1]]),
  fixture(2, [{ s: ["h", "e", "l", "l", "o"] }, { s: ["H", "a", "n", "n", "a", "h"] }, { s: ["A"] }], [["o", "l", "l", "e", "h"], ["h", "a", "n", "n", "a", "H"], ["A"]]),
  fixture(3, [{ s: "A man, a plan, a canal: Panama" }, { s: "race a car" }, { s: " " }], [true, false, true]),
  fixture(4, [{ nums: [-2, 1, -3, 4, -1, 2, 1, -5, 4] }, { nums: [1] }, { nums: [5, 4, -1, 7, 8] }], [6, 1, 23]),
  fixture(5, [{ list1: [1, 2, 4], list2: [1, 3, 4] }, { list1: [], list2: [] }, { list1: [], list2: [0] }], [[1, 1, 2, 3, 4, 4], [], [0]]),
  fixture(6, [{ s: "abcabcbb" }, { s: "bbbbb" }, { s: "pwwkew" }], [3, 1, 3]),
]);

function fixture(problemId: 1 | 2 | 3 | 4 | 5 | 6, inputs: readonly JsonValue[], expected: readonly JsonValue[]): PythonCorpusFixture {
  if (inputs.length !== expected.length) throw new Error("Python corpus fixture has mismatched inputs and expected values");
  return {
    problemId,
    source: PYTHON_CORPUS_SOURCES[problemId],
    cases: inputs.map((input, index) => {
      const expectedValue = expected[index];
      if (expectedValue === undefined) throw new Error("Python corpus fixture expected value is missing");
      return { input, expected: expectedValue };
    }),
  };
}
