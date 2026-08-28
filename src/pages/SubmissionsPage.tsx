import { AlertTriangle, History } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "../components/ui/button.js";
import { SubmissionFilters } from "../features/submissions/SubmissionFilters.js";
import { SubmissionHistory } from "../features/submissions/SubmissionHistory.js";
import {
  buildSubmissionRows,
  type SubmissionFilter,
} from "../features/submissions/submission-list-model.js";
import { useSubmissions } from "../features/submissions/use-submissions.js";
import { useRuntimeRegistry } from "../hooks/use-runtime-registry.js";
import { useStorageState } from "../hooks/use-storage-state.js";

export function SubmissionsPage() {
  const { state, retry } = useSubmissions();
  const runtimes = useRuntimeRegistry();
  const storageState = useStorageState();
  const [filter, setFilter] = useState<SubmissionFilter>({ verdicts: [] });
  const rows = useMemo(
    () => state.kind === "ready" ? buildSubmissionRows(state.records, state.problems, filter) : [],
    [filter, state],
  );

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="grid max-w-3xl gap-2">
        <div className="flex items-center gap-2 font-mono text-xs font-semibold text-muted-foreground">
          <History aria-hidden="true" className="size-4" />
          LOCAL SUBMISSIONS
        </div>
        <h1 className="text-3xl font-bold tracking-tight">提交历史</h1>
        <p className="text-sm text-muted-foreground">
          查看此浏览器保存的本地判题记录、源码快照与计数摘要。
        </p>
      </header>

      {storageState.kind === "memory" ? (
        <section className="flex items-start gap-3 rounded-lg border border-[var(--status-warning)] bg-card p-4" role="status">
          <AlertTriangle aria-hidden="true" className="mt-1 size-4 shrink-0 text-[var(--status-warning)]" />
          <div>
            <h2 className="font-semibold">当前会话记录未持久化</h2>
            <p className="mt-1 overflow-wrap-anywhere text-sm text-muted-foreground">
              本次会话中的提交记录仍可查看，但刷新或关闭页面后可能丢失。原因：{storageState.reason}
            </p>
          </div>
        </section>
      ) : null}

      {state.kind === "loading" ? (
        <section aria-busy="true" className="min-h-80 rounded-lg border bg-card p-6" role="status">
          正在加载本地提交历史…
        </section>
      ) : state.kind === "error" ? (
        <section className="rounded-lg border border-destructive bg-card p-6" role="alert">
          <h2 className="font-semibold">无法加载提交历史</h2>
          <p className="mt-2 overflow-wrap-anywhere text-sm text-muted-foreground">{state.message}</p>
          <Button className="mt-4" onClick={retry} type="button" variant="outline">重试</Button>
        </section>
      ) : state.records.length === 0 ? (
        <section className="rounded-lg border border-dashed bg-card p-8 text-center" role="status">
          <h2 className="font-semibold">还没有本地提交</h2>
          <p className="mt-2 text-sm text-muted-foreground">完成一次题目提交后，记录会出现在这里。</p>
        </section>
      ) : (
        <>
          <SubmissionFilters
            filter={filter}
            onChange={setFilter}
            problems={state.problems}
            resultCount={rows.length}
            runtimes={runtimes}
          />
          <SubmissionHistory rows={rows} />
        </>
      )}
    </div>
  );
}
