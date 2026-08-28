import { CircleCheck, CircleMinus, CircleX } from "lucide-react";

import type { Verdict } from "../../domain/submission.js";
import { SubmissionDetailDialog } from "./SubmissionDetailDialog.js";
import type { SubmissionRowModel } from "./submission-list-model.js";

export function SubmissionHistory({ rows }: { readonly rows: readonly SubmissionRowModel[] }) {
  if (rows.length === 0) {
    return (
      <section className="rounded-lg border border-dashed bg-card p-8 text-center" role="status">
        <h2 className="font-semibold">没有匹配的提交</h2>
        <p className="mt-2 text-sm text-muted-foreground">调整筛选条件或重置筛选后重试。</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="submission-history-title" className="grid gap-3">
      <header>
        <h2 className="text-lg font-semibold" id="submission-history-title">历史记录</h2>
        <p className="mt-1 text-sm text-muted-foreground">按提交时间倒序排列；相同时间按提交编号倒序排列。</p>
      </header>

      <div className="rounded-lg border bg-card">
        <div className="max-sm:hidden">
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <caption className="sr-only">本地提交历史及只读详情入口</caption>
            <thead className="border-b bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="w-1/4 px-4 py-3 font-semibold" scope="col">题目</th>
                <th className="w-1/4 px-4 py-3 font-semibold" scope="col">运行时</th>
                <th className="px-4 py-3 font-semibold" scope="col">结果</th>
                <th className="px-4 py-3 font-semibold" scope="col">耗时</th>
                <th className="px-4 py-3 font-semibold" scope="col">时间</th>
                <th className="px-4 py-3 text-right font-semibold" scope="col">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr className="hover:bg-muted/60" key={row.submissionId}>
                  <th className="overflow-wrap-anywhere px-4 py-4 font-medium" scope="row">{row.problemLabel}</th>
                  <td className="overflow-wrap-anywhere px-4 py-4 font-mono text-xs">{row.runtimeLabel}</td>
                  <td className="px-4 py-4"><VerdictStatus row={row} /></td>
                  <td className="px-4 py-4 font-mono text-xs">{row.elapsedLabel}</td>
                  <td className="px-4 py-4"><Timestamp value={row.createdAt} /></td>
                  <td className="px-4 py-4 text-right"><SubmissionDetailDialog row={row} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ol aria-label="本地提交历史及只读详情入口" className="divide-y sm:hidden">
          {rows.map((row) => (
            <li className="grid gap-4 p-4" key={row.submissionId}>
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="overflow-wrap-anywhere font-semibold">{row.problemLabel}</p>
                  <p className="mt-1 overflow-wrap-anywhere font-mono text-xs text-muted-foreground">
                    提交 #{row.submissionId}
                  </p>
                </div>
                <SubmissionDetailDialog row={row} />
              </div>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
                <dt className="text-muted-foreground">运行时</dt>
                <dd className="overflow-wrap-anywhere font-mono text-xs">{row.runtimeLabel}</dd>
                <dt className="text-muted-foreground">结果</dt>
                <dd><VerdictStatus row={row} /></dd>
                <dt className="text-muted-foreground">耗时</dt>
                <dd className="font-mono text-xs">{row.elapsedLabel}</dd>
                <dt className="text-muted-foreground">时间</dt>
                <dd><Timestamp value={row.createdAt} /></dd>
              </dl>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function VerdictStatus({ row }: { row: SubmissionRowModel }) {
  const presentation = verdictPresentation(row.verdict);
  return (
    <span className="inline-flex items-center gap-2 font-medium" data-tone={presentation.tone}>
      <presentation.Icon aria-hidden="true" className="size-4 shrink-0 text-[var(--status-tone)]" />
      <span>{row.verdictLabel}</span>
    </span>
  );
}

function Timestamp({ value }: { value: number }) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return <span className="text-muted-foreground">时间不可用</span>;
  return (
    <time className="text-xs text-muted-foreground" dateTime={date.toISOString()}>
      {TIMESTAMP_FORMAT.format(date)}
    </time>
  );
}

function verdictPresentation(verdict: Verdict): {
  tone: "neutral" | "success" | "warning" | "error";
  Icon: typeof CircleCheck;
} {
  if (verdict === "accepted") return { tone: "success", Icon: CircleCheck };
  if (verdict === "cancelled") return { tone: "neutral", Icon: CircleMinus };
  if (verdict === "runtime-unavailable") return { tone: "warning", Icon: CircleX };
  return { tone: "error", Icon: CircleX };
}

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short",
  timeStyle: "medium",
});
