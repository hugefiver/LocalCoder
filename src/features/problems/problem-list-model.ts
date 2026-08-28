import type { LanguageId, RuntimeId } from "../../domain/language.js";
import type { Problem } from "../../domain/problem.js";
import type { ProgressRecord } from "../../storage/schema.js";

export interface ProblemFilter {
  text: string;
  difficulty: readonly Problem["difficulty"][];
  status: "all" | "unattempted" | "attempted" | "solved";
}

export interface ProblemRowModel {
  id: number;
  slug: string;
  title: string;
  difficulty: Problem["difficulty"];
  tags: readonly string[];
  status: "unattempted" | "attempted" | "solved";
  acceptedLanguageId?: LanguageId;
  acceptedRuntimeId?: RuntimeId;
  lastAttemptAt?: number;
}

export function filterProblems(
  problems: readonly Problem[],
  progress: readonly ProgressRecord[],
  filter: ProblemFilter,
): readonly ProblemRowModel[] {
  const progressByProblem = new Map(progress.map((record) => [record.problemId, record]));
  const text = filter.text.trim().toLowerCase();
  const difficulties = new Set(filter.difficulty);

  return problems
    .map((problem) => toRow(problem, progressByProblem.get(problem.id)))
    .filter((row) => text === "" || searchableText(row).includes(text))
    .filter((row) => difficulties.size === 0 || difficulties.has(row.difficulty))
    .filter((row) => filter.status === "all" || row.status === filter.status)
    .sort((left, right) => left.id - right.id);
}

function toRow(problem: Problem, progress: ProgressRecord | undefined): ProblemRowModel {
  const status = progress?.acceptedAt !== undefined
    ? "solved"
    : (progress?.attempts ?? 0) > 0
      ? "attempted"
      : "unattempted";
  const row: ProblemRowModel = {
    id: problem.id,
    slug: problem.slug,
    title: problem.title,
    difficulty: problem.difficulty,
    tags: problem.tags,
    status,
  };

  if (status !== "unattempted" && progress !== undefined) row.lastAttemptAt = progress.lastAttemptAt;
  if (status === "solved" && progress?.acceptedLanguageId !== undefined) {
    row.acceptedLanguageId = progress.acceptedLanguageId;
  }
  if (status === "solved" && progress?.acceptedRuntimeId !== undefined) {
    row.acceptedRuntimeId = progress.acceptedRuntimeId;
  }
  return row;
}

function searchableText(row: ProblemRowModel): string {
  return [row.title, row.slug, ...row.tags].join(" ").toLowerCase();
}
