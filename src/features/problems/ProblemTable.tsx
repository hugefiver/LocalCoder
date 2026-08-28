import { CheckCircle2, Circle, CircleDot } from "lucide-react";
import { Link } from "react-router-dom";

import type { ProblemRowModel } from "./problem-list-model.js";

interface ProblemTableProps {
  rows: readonly ProblemRowModel[];
}

export function ProblemTable({ rows }: ProblemTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center" role="status">
        <h2 className="text-base font-semibold">没有匹配的题目</h2>
        <p className="mt-2 text-sm text-muted-foreground">调整搜索词或筛选条件后重试。</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="max-sm:hidden">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">题目目录及本地练习状态</caption>
          <thead className="border-b bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold" scope="col">题目</th>
              <th className="px-4 py-3 font-semibold" scope="col">难度与标签</th>
              <th className="px-4 py-3 font-semibold" scope="col">状态</th>
              <th className="px-4 py-3 font-semibold" scope="col">通过环境</th>
              <th className="px-4 py-3 font-semibold" scope="col">最近尝试</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr className="hover:bg-muted/60" key={row.id}>
                <th className="px-4 py-4 font-medium" scope="row">
                  <ProblemLink row={row} />
                </th>
                <td className="px-4 py-4"><DifficultyAndTags row={row} /></td>
                <td className="px-4 py-4"><Status row={row} /></td>
                <td className="px-4 py-4"><AcceptedRuntime row={row} /></td>
                <td className="px-4 py-4"><LastAttempt timestamp={row.lastAttemptAt} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y sm:hidden" aria-label="题目目录及本地练习状态">
        {rows.map((row) => (
          <li className="grid gap-4 p-4" key={row.id}>
            <ProblemLink row={row} />
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
              <dt className="text-muted-foreground">难度与标签</dt>
              <dd><DifficultyAndTags row={row} /></dd>
              <dt className="text-muted-foreground">状态</dt>
              <dd><Status row={row} /></dd>
              <dt className="text-muted-foreground">通过环境</dt>
              <dd><AcceptedRuntime row={row} /></dd>
              <dt className="text-muted-foreground">最近尝试</dt>
              <dd><LastAttempt timestamp={row.lastAttemptAt} /></dd>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProblemLink({ row }: { row: ProblemRowModel }) {
  return (
    <Link
      className="inline-flex max-w-full items-baseline gap-2 rounded-sm text-foreground underline-offset-4 hover:underline"
      data-problem-row-link={row.id}
      onKeyDown={(event) => {
        if (event.key !== " ") return;
        event.preventDefault();
        event.currentTarget.click();
      }}
      to={`/problems/${row.id}`}
    >
      <span className="font-mono text-xs text-muted-foreground">#{row.id}</span>
      <span className="min-w-0 overflow-wrap-anywhere">{row.title}</span>
    </Link>
  );
}

function DifficultyAndTags({ row }: { row: ProblemRowModel }) {
  return (
    <div className="grid gap-2">
      <span className="font-medium">{row.difficulty}</span>
      <ul className="flex flex-wrap gap-1" aria-label="标签">
        {row.tags.map((tag) => (
          <li className="rounded-full border px-2 py-0.5 font-mono text-xs text-muted-foreground" key={tag}>{tag}</li>
        ))}
      </ul>
    </div>
  );
}

function Status({ row }: { row: ProblemRowModel }) {
  const model = row.status === "solved"
    ? { Icon: CheckCircle2, label: "已解决", tone: "success" }
    : row.status === "attempted"
      ? { Icon: CircleDot, label: "已尝试", tone: "warning" }
      : { Icon: Circle, label: "未尝试", tone: "neutral" };
  return (
    <span className="inline-flex items-center gap-2" data-tone={model.tone}>
      <model.Icon aria-hidden="true" className="size-4 text-[var(--status-tone)]" />
      {model.label}
    </span>
  );
}

function AcceptedRuntime({ row }: { row: ProblemRowModel }) {
  if (row.acceptedLanguageId === undefined || row.acceptedRuntimeId === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="grid gap-1">
      <span>{row.acceptedLanguageId}</span>
      <code className="overflow-wrap-anywhere font-mono text-xs text-muted-foreground">{row.acceptedRuntimeId}</code>
    </span>
  );
}

function LastAttempt({ timestamp }: { timestamp: number | undefined }) {
  if (timestamp === undefined) return <span className="text-muted-foreground">—</span>;
  const date = new Date(timestamp);
  return <time dateTime={date.toISOString()}>{DATE_FORMAT.format(date)}</time>;
}

const DATE_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
