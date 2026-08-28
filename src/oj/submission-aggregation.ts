import type {
  SelectedCase,
  SubmissionResult,
  Verdict,
  VisibleCaseResult,
} from "../domain/submission.js";
import type { JudgeCasePayload, RuntimeFailure } from "../runtime/protocol.js";
import { compareJson } from "./comparer.js";

export interface FailureSummary {
  readonly code: string;
  readonly message: string;
}

type SubmissionRuntime = NonNullable<SubmissionResult["runtime"]>;

function judgeTotal(selected: readonly SelectedCase[]): number {
  return selected.filter(({ visibility }) => visibility === "judge").length;
}

export function verdictForFailure(failure: RuntimeFailure): Verdict {
  if (failure.kind === "compile") return "compile-error";
  if (failure.kind === "runtime") return "runtime-error";
  if (failure.kind === "cancelled") return "cancelled";
  if (failure.kind === "infrastructure" && failure.code === "execution-timeout") return "time-limit-exceeded";
  return "internal-error";
}

export function failureResult(
  verdict: Verdict,
  selected: readonly SelectedCase[],
  elapsedMs: number,
  failure: FailureSummary,
  runtime?: SubmissionRuntime,
): SubmissionResult {
  const total = judgeTotal(selected);
  return {
    verdict,
    elapsedMs,
    ...(runtime === undefined ? {} : { runtime }),
    publicCases: [],
    customCases: [],
    judgeSummary: { total, passed: 0, failed: total },
    output: { stdout: "", stderr: "", truncated: false },
    failure,
  };
}

function appendVisibleCase(
  publicCases: VisibleCaseResult[],
  customCases: VisibleCaseResult[],
  testCase: SelectedCase,
  response: JudgeCasePayload,
  comparison?: import("./comparer.js").JsonComparison,
): void {
  if (testCase.visibility === "judge") return;
  const destination = testCase.visibility === "public" ? publicCases : customCases;
  if (response.ok) {
    if (comparison === undefined) throw new Error("Successful judge response requires a comparison");
    destination.push({
      index: testCase.index,
      visibility: testCase.visibility,
      input: testCase.input,
      expected: testCase.expected,
      actual: response.actual,
      comparison,
      stdout: response.stdout.text,
      stderr: response.stderr.text,
    });
    return;
  }
  destination.push({
    index: testCase.index,
    visibility: testCase.visibility,
    input: testCase.input,
    expected: testCase.expected,
    failure: { code: response.failure.code, message: response.failure.message },
    stdout: response.stdout.text,
    stderr: response.stderr.text,
  });
}

/** Selected-case order (public, custom, judge) decides the first aggregate failure, never Worker response order. */
export function aggregateSubmission(
  selected: readonly SelectedCase[],
  responses: readonly JudgeCasePayload[],
  elapsedMs: number,
  runtime: SubmissionRuntime,
): SubmissionResult {
  const publicCases: VisibleCaseResult[] = [];
  const customCases: VisibleCaseResult[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  let truncated = false;
  let verdict: Verdict = "accepted";
  let failure: FailureSummary | undefined;
  let judgePassed = 0;

  for (const [index, testCase] of selected.entries()) {
    const response = responses[index]!;
    if (testCase.visibility !== "judge") {
      stdout.push(response.stdout.text);
      stderr.push(response.stderr.text);
      truncated ||= response.stdout.truncated || response.stderr.truncated;
    }
    if (response.ok) {
      const comparison = compareJson(response.actual, testCase.expected);
      if (testCase.visibility === "judge") judgePassed += comparison.equal ? 1 : 0;
      appendVisibleCase(publicCases, customCases, testCase, response, comparison);
      if (!comparison.equal && verdict === "accepted") verdict = "wrong-answer";
      continue;
    }

    appendVisibleCase(publicCases, customCases, testCase, response);
    if (verdict === "accepted") {
      verdict = verdictForFailure(response.failure);
      if (testCase.visibility !== "judge") {
        failure = { code: response.failure.code, message: response.failure.message };
      }
    }
  }

  const total = judgeTotal(selected);
  return {
    verdict,
    elapsedMs,
    runtime,
    publicCases,
    customCases,
    judgeSummary: { total, passed: judgePassed, failed: total - judgePassed },
    output: { stdout: stdout.join(""), stderr: stderr.join(""), truncated },
    ...(failure === undefined ? {} : { failure }),
  };
}
