import type { LanguageId, RuntimeId } from "../../domain/language.js";
import type { Problem } from "../../domain/problem.js";
import type { Verdict } from "../../domain/submission.js";
import { runtimeLabel } from "../runtimes/runtime-view-model.js";
import type { SubmissionRecord } from "../../storage/schema.js";

export const SUBMISSION_VERDICTS = [
  "accepted",
  "wrong-answer",
  "compile-error",
  "runtime-error",
  "time-limit-exceeded",
  "cancelled",
  "internal-error",
  "runtime-unavailable",
] as const satisfies readonly Verdict[];

const VERDICT_LABELS: Readonly<Record<Verdict, string>> = Object.freeze({
  accepted: "AC · 通过",
  "wrong-answer": "WA · 答案错误",
  "compile-error": "CE · 编译错误",
  "runtime-error": "RE · 运行错误",
  "time-limit-exceeded": "TLE · 超时",
  cancelled: "已取消",
  "internal-error": "内部错误",
  "runtime-unavailable": "运行时不可用",
});

export interface SubmissionFilter {
  problemId?: number;
  runtimeId?: RuntimeId;
  verdicts: readonly Verdict[];
}

export interface SubmissionRowModel {
  readonly submissionId: number;
  readonly problemLabel: string;
  readonly runtimeLabel: string;
  readonly verdict: Verdict;
  readonly verdictLabel: string;
  readonly elapsedLabel: string;
  readonly createdAt: number;
  readonly source: string;
  readonly buildId: string;
  readonly runtimeVersion: string;
  readonly languageId: LanguageId;
  readonly caseSummary: SubmissionRecord["caseSummary"];
  readonly output: SubmissionRecord["output"];
}

export function buildSubmissionRows(
  records: readonly SubmissionRecord[],
  problems: readonly Problem[],
  filter: SubmissionFilter,
): readonly SubmissionRowModel[] {
  const problemTitles = new Map(problems.map(({ id, title }) => [id, title]));
  const verdicts = new Set(filter.verdicts);
  const rows = records
    .filter((record) => filter.problemId === undefined || record.problemId === filter.problemId)
    .filter((record) => filter.runtimeId === undefined || record.runtimeId === filter.runtimeId)
    .filter((record) => verdicts.size === 0 || verdicts.has(record.verdict))
    .sort(compareNewestFirst)
    .map((record) => toRow(record, problemTitles.get(record.problemId)));
  return Object.freeze(rows);
}

export function submissionVerdictLabel(verdict: Verdict): string {
  return VERDICT_LABELS[verdict];
}

function toRow(record: SubmissionRecord, problemTitle: string | undefined): SubmissionRowModel {
  if (record.id === undefined) {
    throw new TypeError("submission.id is required for a history row");
  }
  const caseSummary = Object.freeze({
    public: Object.freeze({ ...record.caseSummary.public }),
    custom: Object.freeze({ ...record.caseSummary.custom }),
    judge: Object.freeze({ ...record.caseSummary.judge }),
  });
  const output = Object.freeze({ ...record.output });
  return Object.freeze({
    submissionId: record.id,
    problemLabel: problemTitle === undefined ? `未知题目 #${record.problemId}` : `#${record.problemId} ${problemTitle}`,
    runtimeLabel: `${runtimeLabel(record.runtimeId)} / ${record.runtimeId}`,
    verdict: record.verdict,
    verdictLabel: submissionVerdictLabel(record.verdict),
    elapsedLabel: `${String(record.elapsedMs)} ms（本机参考）`,
    createdAt: record.createdAt,
    source: record.source,
    buildId: record.buildId,
    runtimeVersion: record.runtimeVersion,
    languageId: record.languageId,
    caseSummary,
    output,
  });
}

function compareNewestFirst(left: SubmissionRecord, right: SubmissionRecord): number {
  return right.createdAt - left.createdAt || (right.id ?? 0) - (left.id ?? 0);
}
