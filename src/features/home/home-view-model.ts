import type { Problem } from "../../domain/problem.js";
import type { RuntimeId } from "../../domain/language.js";
import type { ProgressRecord, SubmissionRecord } from "../../storage/schema.js";

export interface HomeSummaryModel {
  solved: number;
  attempted: number;
  total: number;
  recentProblemId?: number;
  runtimeSummary: readonly { runtimeId: RuntimeId; accepted: number }[];
}

export function buildHomeSummary(
  problems: readonly Problem[],
  progress: readonly ProgressRecord[],
  submissions: readonly SubmissionRecord[],
): HomeSummaryModel {
  const knownProblemIds = new Set(problems.map((problem) => problem.id));
  const knownProgress = progress.filter((record) => knownProblemIds.has(record.problemId));
  const knownSubmissions = submissions.filter((record) => knownProblemIds.has(record.problemId));
  const runtimeCounts = new Map<RuntimeId, number>();

  for (const submission of knownSubmissions) {
    if (submission.verdict === "accepted") {
      runtimeCounts.set(submission.runtimeId, (runtimeCounts.get(submission.runtimeId) ?? 0) + 1);
    }
  }

  const recentSubmission = newestSubmission(knownSubmissions);
  const recentProgress = recentSubmission === undefined ? newestAttempt(knownProgress) : undefined;
  const recentProblemId = recentSubmission?.problemId ?? recentProgress?.problemId;
  const summary: HomeSummaryModel = {
    solved: knownProgress.filter((record) => record.acceptedAt !== undefined).length,
    attempted: knownProgress.filter((record) => record.attempts > 0).length,
    total: problems.length,
    runtimeSummary: [...runtimeCounts.entries()]
      .map(([runtimeId, accepted]) => ({ runtimeId, accepted }))
      .sort((left, right) => right.accepted - left.accepted || compareRuntimeIds(left.runtimeId, right.runtimeId)),
  };

  return recentProblemId === undefined ? summary : { ...summary, recentProblemId };
}

function compareRuntimeIds(left: RuntimeId, right: RuntimeId): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function newestSubmission(submissions: readonly SubmissionRecord[]): SubmissionRecord | undefined {
  return submissions.reduce<SubmissionRecord | undefined>((newest, submission) => {
    if (newest === undefined || submission.createdAt > newest.createdAt) return submission;
    if (submission.createdAt === newest.createdAt && submission.problemId < newest.problemId) return submission;
    return newest;
  }, undefined);
}

function newestAttempt(progress: readonly ProgressRecord[]): ProgressRecord | undefined {
  return progress.reduce<ProgressRecord | undefined>((newest, record) => {
    if (record.attempts < 1) return newest;
    if (newest === undefined || record.lastAttemptAt > newest.lastAttemptAt) return record;
    if (record.lastAttemptAt === newest.lastAttemptAt && record.problemId < newest.problemId) return record;
    return newest;
  }, undefined);
}
