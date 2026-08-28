import type { Problem, ProblemCase } from "../domain/problem.js";
import type { SelectedCase } from "../domain/submission.js";

function appendCases(
  selected: SelectedCase[],
  cases: readonly ProblemCase[],
  visibility: SelectedCase["visibility"],
): void {
  for (const testCase of cases) {
    selected.push({
      index: selected.length,
      visibility,
      input: testCase.input,
      expected: testCase.expected,
    });
  }
}

export function selectCases(
  problem: Problem,
  mode: "run" | "submit",
  customCases: readonly ProblemCase[],
): readonly SelectedCase[] {
  const selected: SelectedCase[] = [];
  appendCases(selected, problem.tests.public, "public");
  appendCases(selected, customCases, "custom");
  if (mode === "submit") appendCases(selected, problem.tests.judge, "judge");
  return selected;
}
