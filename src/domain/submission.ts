import type { Problem, ProblemCase } from "./problem.js";
import type { JsonValue } from "./json-value.js";
import type { RuntimeId } from "./language.js";
import type { JsonComparison } from "../oj/comparer.js";

export type Verdict =
  | "accepted"
  | "wrong-answer"
  | "compile-error"
  | "runtime-error"
  | "time-limit-exceeded"
  | "cancelled"
  | "internal-error"
  | "runtime-unavailable";

export interface JudgeCommand {
  readonly mode: "run" | "submit";
  readonly problem: Problem;
  readonly runtimeId: RuntimeId;
  readonly source: string;
  readonly customCases: readonly ProblemCase[];
  readonly signal?: AbortSignal;
}

export interface VisibleCaseResult {
  readonly index: number;
  readonly visibility: "public" | "custom";
  readonly input: JsonValue;
  readonly expected: JsonValue;
  readonly actual?: JsonValue;
  readonly comparison?: JsonComparison;
  readonly failure?: { readonly code: string; readonly message: string };
  readonly stdout: string;
  readonly stderr: string;
}

export interface SubmissionResult {
  readonly verdict: Verdict;
  readonly elapsedMs: number;
  /** Present only when the adapter returned a validated runtime handshake. */
  readonly runtime?: { readonly runtimeId: RuntimeId; readonly runtimeVersion: string; readonly buildId: string };
  readonly publicCases: readonly VisibleCaseResult[];
  readonly customCases: readonly VisibleCaseResult[];
  readonly judgeSummary: { readonly total: number; readonly passed: number; readonly failed: number };
  readonly output: { readonly stdout: string; readonly stderr: string; readonly truncated: boolean };
  readonly failure?: { readonly code: string; readonly message: string };
}

export interface SelectedCase {
  readonly index: number;
  readonly visibility: "public" | "custom" | "judge";
  readonly input: JsonValue;
  readonly expected: JsonValue;
}
