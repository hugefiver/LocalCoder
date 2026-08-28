import { compareJson } from "../oj/comparer.js";
import type { Problem, ProblemCase } from "../domain/problem.js";
import type { RuntimeAdapter } from "./adapters/types.js";
import type { RuntimeOperationOptions } from "./supervisor.js";

const PYTHON_CORPUS_IDS = [1, 2, 3, 4, 5, 6] as const;

export const PYTHON_CORPUS_SOURCES = Object.freeze({
  1: "def solution(input):\n    seen = {}\n    for index, value in enumerate(input['nums']):\n        other = input['target'] - value\n        if other in seen:\n            return [seen[other], index]\n        seen[value] = index\n    return []",
  2: "def solution(input):\n    return list(reversed(input['s']))",
  3: "def solution(input):\n    text = ''.join(char.lower() for char in input['s'] if char.isalnum())\n    return text == text[::-1]",
  4: "def solution(input):\n    best = current = input['nums'][0]\n    for value in input['nums'][1:]:\n        current = max(value, current + value)\n        best = max(best, current)\n    return best",
  5: "def solution(input):\n    left = input['list1']\n    right = input['list2']\n    result = []\n    left_index = right_index = 0\n    while left_index < len(left) and right_index < len(right):\n        if left[left_index] <= right[right_index]:\n            result.append(left[left_index])\n            left_index += 1\n        else:\n            result.append(right[right_index])\n            right_index += 1\n    return result + left[left_index:] + right[right_index:]",
  6: "def solution(input):\n    seen = {}\n    start = best = 0\n    for index, char in enumerate(input['s']):\n        if char in seen and seen[char] >= start:\n            start = seen[char] + 1\n        seen[char] = index\n        best = max(best, index - start + 1)\n    return best",
});

export interface PythonCorpusFixture {
  readonly problemId: number;
  readonly source: string;
  readonly cases: readonly ProblemCase[];
}

export interface PythonParityReport {
  readonly problemCount: number;
  readonly caseCount: number;
  readonly mismatches: readonly { readonly problemId: number; readonly caseIndex: number; readonly reason: string }[];
}

export function createPythonCorpusFixtures(problems: readonly Problem[]): readonly PythonCorpusFixture[] {
  return Object.freeze(PYTHON_CORPUS_IDS.map((problemId) => {
    const problem = problems.find((candidate) => candidate.id === problemId);
    if (problem === undefined) throw new RangeError(`Python parity corpus is missing problem ${problemId}`);
    const source = PYTHON_CORPUS_SOURCES[problemId];
    const cases = Object.freeze([...problem.tests.public, ...problem.tests.judge]);
    return Object.freeze({ problemId, source, cases });
  }));
}

export async function verifyPythonParity(
  pyodide: RuntimeAdapter,
  rustpython: RuntimeAdapter,
  fixtures: readonly PythonCorpusFixture[],
  rustPythonOptions?: RuntimeOperationOptions,
): Promise<PythonParityReport> {
  const mismatches: Array<{ readonly problemId: number; readonly caseIndex: number; readonly reason: string }> = [];
  let caseCount = 0;
  for (const fixture of fixtures) {
    const inputs = fixture.cases.map(({ input }) => input);
    const [pyodideResult, rustpythonResult] = await Promise.all([
      pyodide.judge(fixture.source, inputs),
      rustpython.judge(fixture.source, inputs, rustPythonOptions),
    ]);
    caseCount += fixture.cases.length;
    for (const [caseIndex, expected] of fixture.cases.entries()) {
      const pyodideCase = pyodideResult.payload.cases.find((candidate) => candidate.index === caseIndex);
      const rustpythonCase = rustpythonResult.payload.cases.find((candidate) => candidate.index === caseIndex);
      const reason = parityMismatchReason(pyodideCase, rustpythonCase, expected);
      if (reason !== undefined) mismatches.push({ problemId: fixture.problemId, caseIndex, reason });
    }
  }
  return Object.freeze({ problemCount: fixtures.length, caseCount, mismatches: Object.freeze(mismatches) });
}

function parityMismatchReason(
  pyodideCase: import("./protocol.js").JudgeCasePayload | undefined,
  rustpythonCase: import("./protocol.js").JudgeCasePayload | undefined,
  expected: ProblemCase,
): string | undefined {
  if (pyodideCase === undefined || rustpythonCase === undefined) {
    return "classification-mismatch";
  }
  if (pyodideCase.ok === false) {
    if (rustpythonCase.ok !== false) return "classification-mismatch";
    return pyodideCase.failure.kind === rustpythonCase.failure.kind && pyodideCase.failure.code === rustpythonCase.failure.code
      ? undefined
      : "classification-mismatch";
  }
  if (rustpythonCase.ok === false) return "classification-mismatch";
  const pyodideExpected = compareJson(pyodideCase.actual, expected.expected);
  const rustpythonExpected = compareJson(rustpythonCase.actual, expected.expected);
  const actual = compareJson(pyodideCase.actual, rustpythonCase.actual);
  if (!actual.equal) return "actual-mismatch";
  if (!pyodideExpected.equal || !rustpythonExpected.equal) return "expected-mismatch";
  return undefined;
}
