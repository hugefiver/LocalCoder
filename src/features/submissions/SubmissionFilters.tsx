import { RotateCcw } from "lucide-react";

import { Button } from "../../components/ui/button.js";
import type { RuntimeId } from "../../domain/language.js";
import type { Problem } from "../../domain/problem.js";
import type { RuntimeCapability } from "../../runtime/registry.js";
import { runtimeLabel } from "../runtimes/runtime-view-model.js";
import {
  SUBMISSION_VERDICTS,
  submissionVerdictLabel,
  type SubmissionFilter,
} from "./submission-list-model.js";

interface SubmissionFiltersProps {
  readonly filter: SubmissionFilter;
  readonly problems: readonly Problem[];
  readonly runtimes: readonly RuntimeCapability[];
  readonly resultCount: number;
  readonly onChange: (filter: SubmissionFilter) => void;
}

export function SubmissionFilters({
  filter,
  problems,
  runtimes,
  resultCount,
  onChange,
}: SubmissionFiltersProps) {
  const resetDisabled = filter.problemId === undefined
    && filter.runtimeId === undefined
    && filter.verdicts.length === 0;

  return (
    <section aria-labelledby="submission-filters-title" className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold" id="submission-filters-title">筛选提交</h2>
          <p aria-live="polite" className="mt-1 text-sm text-muted-foreground">
            当前显示 {resultCount} 条记录
          </p>
        </div>
        <Button
          disabled={resetDisabled}
          onClick={() => onChange({ verdicts: [] })}
          size="sm"
          type="button"
          variant="ghost"
        >
          <RotateCcw aria-hidden="true" />
          重置
        </Button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium" htmlFor="submission-problem-filter">
            题目
            <select
              className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm"
              id="submission-problem-filter"
              onChange={(event) => onChange(withProblem(filter, event.target.value))}
              value={filter.problemId ?? ""}
            >
              <option value="">全部题目</option>
              {problems.map((problem) => (
                <option key={problem.id} value={problem.id}>#{problem.id} {problem.title}</option>
              ))}
            </select>
          </label>

          <label className="grid gap-2 text-sm font-medium" htmlFor="submission-runtime-filter">
            运行时
            <select
              className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm"
              id="submission-runtime-filter"
              onChange={(event) => onChange(withRuntime(filter, event.target.value))}
              value={filter.runtimeId ?? ""}
            >
              <option value="">全部运行时</option>
              {runtimes.map((runtime) => (
                <option key={runtime.runtimeId} value={runtime.runtimeId}>
                  {runtimeLabel(runtime.runtimeId)} / {runtime.runtimeId}
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">结果（可多选）</legend>
          <div className="flex flex-wrap gap-2">
            {SUBMISSION_VERDICTS.map((verdict) => (
              <label
                className="inline-flex min-h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm"
                key={verdict}
              >
                <input
                  checked={filter.verdicts.includes(verdict)}
                  className="accent-[var(--accent-primary)]"
                  onChange={() => onChange({ ...filter, verdicts: toggleVerdict(filter.verdicts, verdict) })}
                  type="checkbox"
                />
                {submissionVerdictLabel(verdict)}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </section>
  );
}

function withProblem(filter: SubmissionFilter, value: string): SubmissionFilter {
  const next = { ...filter };
  if (value === "") delete next.problemId;
  else next.problemId = Number(value);
  return next;
}

function withRuntime(filter: SubmissionFilter, value: string): SubmissionFilter {
  const next = { ...filter };
  if (value === "") delete next.runtimeId;
  else next.runtimeId = value as RuntimeId;
  return next;
}

function toggleVerdict(
  selected: SubmissionFilter["verdicts"],
  verdict: SubmissionFilter["verdicts"][number],
): readonly SubmissionFilter["verdicts"][number][] {
  return selected.includes(verdict)
    ? selected.filter((item) => item !== verdict)
    : [...selected, verdict];
}
