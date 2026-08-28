import { CircleCheck, CircleX, Clock3 } from "lucide-react";

import type { Verdict } from "../../domain/submission.js";
import type { SubmissionRecord } from "../../storage/schema.js";

const DISPLAY_LIMIT = 12;

interface RecentProblemSubmissionsProps {
  records: readonly SubmissionRecord[];
}

export function RecentProblemSubmissions({ records }: RecentProblemSubmissionsProps) {
  const visible = records.slice(0, DISPLAY_LIMIT);
  return (
    <section className="grid min-w-0 gap-3" aria-label="最近提交">
      <header>
        <h3 className="text-lg font-semibold">最近提交</h3>
        <p className="mt-1 text-sm text-muted-foreground">仅显示当前题目的本地记录；源码查看由提交历史页提供。</p>
      </header>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-secondary p-4 text-sm text-muted-foreground">
          当前题目还没有已保存的提交。
        </div>
      ) : (
        <ol className="grid gap-2">
          {visible.map((record) => {
            const accepted = record.verdict === "accepted";
            return (
              <li className="grid gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={record.id ?? `${record.runtimeId}-${record.createdAt}`}>
                <div className="flex min-w-0 items-start gap-3">
                  {accepted ? (
                    <CircleCheck aria-hidden="true" className="mt-1 size-4 shrink-0 text-[var(--status-success)]" />
                  ) : (
                    <CircleX aria-hidden="true" className="mt-1 size-4 shrink-0 text-[var(--status-error)]" />
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold">{verdictLabel(record.verdict)}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {record.runtimeId} · {record.runtimeVersion}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  <Clock3 aria-hidden="true" className="size-4" />
                  <time dateTime={new Date(record.createdAt).toISOString()}>{formatTimestamp(record.createdAt)}</time>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(timestamp);
}

function verdictLabel(verdict: Verdict): string {
  switch (verdict) {
    case "accepted": return "AC · 通过";
    case "wrong-answer": return "WA · 答案错误";
    case "compile-error": return "CE · 编译错误";
    case "runtime-error": return "RE · 运行错误";
    case "time-limit-exceeded": return "TLE · 超时";
    case "cancelled": return "已取消";
    case "internal-error": return "内部错误";
    case "runtime-unavailable": return "运行时不可用";
  }
}
