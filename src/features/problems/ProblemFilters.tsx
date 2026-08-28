import { RotateCcw, Search } from "lucide-react";

import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import type { ProblemDifficulty } from "../../domain/problem.js";
import type { ProblemFilter } from "./problem-list-model.js";

const DIFFICULTIES: readonly ProblemDifficulty[] = ["Easy", "Medium", "Hard"];

interface ProblemFiltersProps {
  filter: ProblemFilter;
  resultCount: number;
  onChange: (filter: ProblemFilter) => void;
}

export function ProblemFilters({ filter, resultCount, onChange }: ProblemFiltersProps) {
  const resetDisabled = filter.text === "" && filter.difficulty.length === 0 && filter.status === "all";

  return (
    <section aria-labelledby="problem-filters-heading" className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold" id="problem-filters-heading">筛选题目</h2>
          <p aria-live="polite" className="mt-1 text-sm text-muted-foreground">当前显示 {resultCount} 题</p>
        </div>
        <Button
          disabled={resetDisabled}
          onClick={() => onChange({ text: "", difficulty: [], status: "all" })}
          size="sm"
          type="button"
          variant="ghost"
        >
          <RotateCcw aria-hidden="true" />
          重置
        </Button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(14rem,1fr)_auto_minmax(10rem,auto)] lg:items-end">
        <label className="grid gap-2 text-sm font-medium" htmlFor="problem-search">
          搜索标题、标识或标签
          <span className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              id="problem-search"
              onChange={(event) => onChange({ ...filter, text: event.target.value })}
              placeholder="例如 array"
              type="search"
              value={filter.text}
            />
          </span>
        </label>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">难度</legend>
          <div className="flex flex-wrap gap-2">
            {DIFFICULTIES.map((difficulty) => (
              <label className="inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-sm" key={difficulty}>
                <input
                  checked={filter.difficulty.includes(difficulty)}
                  onChange={() => onChange({ ...filter, difficulty: toggleDifficulty(filter.difficulty, difficulty) })}
                  type="checkbox"
                />
                {difficulty}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="grid gap-2 text-sm font-medium" htmlFor="problem-status">
          状态
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            id="problem-status"
            onChange={(event) => onChange({ ...filter, status: event.target.value as ProblemFilter["status"] })}
            value={filter.status}
          >
            <option value="all">全部</option>
            <option value="unattempted">未尝试</option>
            <option value="attempted">已尝试</option>
            <option value="solved">已解决</option>
          </select>
        </label>
      </div>
    </section>
  );
}

function toggleDifficulty(
  selected: readonly ProblemDifficulty[],
  difficulty: ProblemDifficulty,
): readonly ProblemDifficulty[] {
  return selected.includes(difficulty)
    ? selected.filter((item) => item !== difficulty)
    : [...selected, difficulty];
}
