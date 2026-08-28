import { CheckCircle2, CircleDot, ListChecks } from "lucide-react";

import type { HomeSummaryModel } from "./home-view-model.js";

interface ProgressSummaryProps {
  summary: HomeSummaryModel;
}

export function ProgressSummary({ summary }: ProgressSummaryProps) {
  const remaining = Math.max(0, summary.total - summary.solved);

  return (
    <section aria-labelledby="progress-heading" className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-mono text-xs font-semibold text-muted-foreground">LOCAL PROGRESS</p>
          <h2 className="mt-1 text-xl font-semibold" id="progress-heading">本地练习进度</h2>
        </div>
        <p className="text-sm text-muted-foreground">数据只保存在此浏览器中</p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <Metric icon={<CheckCircle2 aria-hidden="true" />} label="已解决" value={summary.solved} />
        <Metric icon={<CircleDot aria-hidden="true" />} label="已尝试" value={summary.attempted} />
        <Metric icon={<ListChecks aria-hidden="true" />} label="待解决" value={remaining} />
      </dl>

      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-semibold">通过记录所用运行时</h3>
        {summary.runtimeSummary.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">完成一次提交后，这里会汇总通过记录。</p>
        ) : (
          <ul className="mt-3 grid gap-2" aria-label="通过记录运行时汇总">
            {summary.runtimeSummary.map((item) => (
              <li className="flex items-center justify-between gap-4 text-sm" key={item.runtimeId}>
                <code className="min-w-0 overflow-wrap-anywhere font-mono text-xs text-muted-foreground">
                  {item.runtimeId}
                </code>
                <strong>{item.accepted} 次</strong>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

interface MetricProps {
  icon: React.ReactNode;
  label: string;
  value: number;
}

function Metric({ icon, label, value }: MetricProps) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <dt className="flex items-center gap-2 text-sm text-muted-foreground [&_svg]:size-4" data-tone="info">
        {icon}
        {label}
      </dt>
      <dd className="mt-2 font-mono text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
