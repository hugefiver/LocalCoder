import { useEffect, useMemo, useState } from "react";

import { Button } from "../components/ui/button.js";
import type { Problem } from "../domain/problem.js";
import { ProblemFilters } from "../features/problems/ProblemFilters.js";
import { filterProblems, type ProblemFilter } from "../features/problems/problem-list-model.js";
import { ProblemTable } from "../features/problems/ProblemTable.js";
import { useAppServices } from "../hooks/use-app-services.js";
import type { ProgressRecord } from "../storage/schema.js";

export function ProblemsPage() {
  const services = useAppServices();
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<ProblemsState>({ kind: "loading" });
  const [filter, setFilter] = useState<ProblemFilter>({ text: "", difficulty: [], status: "all" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void Promise.all([services.problems.list(), services.storage.listProgress()])
      .then(([problems, progress]) => {
        if (!cancelled) setState({ kind: "ready", problems, progress });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ kind: "error", message: errorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, services]);

  const rows = useMemo(
    () => state.kind === "ready" ? filterProblems(state.problems, state.progress, filter) : [],
    [filter, state],
  );

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="grid max-w-3xl gap-2">
        <p className="font-mono text-xs font-semibold text-muted-foreground">PROBLEM CATALOGUE</p>
        <h1 className="text-3xl font-bold tracking-tight">题库</h1>
        <p className="text-sm text-muted-foreground">筛选静态题库，并按此浏览器中的真实提交进度继续练习。</p>
      </header>

      {state.kind === "loading" ? (
        <div aria-busy="true" className="min-h-80 rounded-lg border bg-card p-6" role="status">正在加载题库与本地进度…</div>
      ) : state.kind === "error" ? (
        <section className="rounded-lg border border-destructive bg-card p-6" role="alert">
          <h2 className="font-semibold">无法加载题库</h2>
          <p className="mt-2 overflow-wrap-anywhere text-sm text-muted-foreground">{state.message}</p>
          <Button className="mt-4" onClick={() => setReloadKey((value) => value + 1)} type="button" variant="outline">重试</Button>
        </section>
      ) : state.problems.length === 0 ? (
        <section className="rounded-lg border bg-card p-8 text-center" role="status">
          <h2 className="font-semibold">题库为空</h2>
          <p className="mt-2 text-sm text-muted-foreground">当前构建没有可用题目。</p>
        </section>
      ) : (
        <>
          <ProblemFilters filter={filter} onChange={setFilter} resultCount={rows.length} />
          <ProblemTable rows={rows} />
        </>
      )}
    </div>
  );
}

type ProblemsState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; problems: readonly Problem[]; progress: readonly ProgressRecord[] };

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= 500 ? message : `${message.slice(0, 497)}…`;
}
