import { Code2, Eye } from "lucide-react";

import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog.js";
import type { CaseCountSummary } from "../../storage/schema.js";
import type { SubmissionRowModel } from "./submission-list-model.js";

export function SubmissionDetailDialog({ row }: { readonly row: SubmissionRowModel }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button aria-label={`查看提交 #${row.submissionId} 详情`} size="sm" type="button" variant="ghost">
          <Eye aria-hidden="true" />
          详情
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-var(--space-8))] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>提交 #{row.submissionId}</DialogTitle>
          <DialogDescription>
            只读本地快照；运行耗时仅作本机参考，不代表在线评测结果。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6">
          <section aria-labelledby={`submission-${row.submissionId}-overview`} className="grid gap-3">
            <h3 className="text-base font-semibold" id={`submission-${row.submissionId}-overview`}>提交信息</h3>
            <dl className="grid gap-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-2">
              <DetailItem label="题目" value={row.problemLabel} />
              <DetailItem label="结果" value={row.verdictLabel} />
              <DetailItem label="运行时" value={row.runtimeLabel} />
              <DetailItem label="语言" value={row.languageId} mono />
              <DetailItem label="运行时版本" value={row.runtimeVersion} mono />
              <DetailItem label="构建标识" value={row.buildId} mono />
              <DetailItem label="耗时" value={row.elapsedLabel} mono />
              <DetailItem label="提交时间" value={formatTimestamp(row.createdAt)} />
            </dl>
          </section>

          <section aria-labelledby={`submission-${row.submissionId}-cases`} className="grid gap-3">
            <div>
              <h3 className="text-base font-semibold" id={`submission-${row.submissionId}-cases`}>用例统计</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                判题用例仅显示数量统计，不显示判题输入、预期值或实际值。
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <CaseSummary label="公开用例" summary={row.caseSummary.public} />
              <CaseSummary label="自定义用例" summary={row.caseSummary.custom} />
              <CaseSummary label="判题用例（仅计数）" summary={row.caseSummary.judge} />
            </div>
          </section>

          <section aria-labelledby={`submission-${row.submissionId}-source`} className="grid gap-3">
            <div className="flex items-center gap-2">
              <Code2 aria-hidden="true" className="size-4 text-muted-foreground" />
              <h3 className="text-base font-semibold" id={`submission-${row.submissionId}-source`}>源码快照</h3>
            </div>
            <pre className="max-h-80 overflow-auto rounded-lg border bg-secondary p-4 font-mono text-sm whitespace-pre-wrap break-words" tabIndex={0}>
              <code>{row.source}</code>
            </pre>
          </section>

          <section aria-labelledby={`submission-${row.submissionId}-output`} className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold" id={`submission-${row.submissionId}-output`}>进程输出</h3>
              <span className="rounded-full border px-2 py-1 font-mono text-xs text-muted-foreground">
                {row.output.truncated ? "输出已截断" : "输出未截断"}
              </span>
            </div>
            <OutputBlock label="stdout" value={row.output.stdout} />
            <OutputBlock label="stderr" value={row.output.stderr} />
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`mt-1 overflow-wrap-anywhere ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}

function CaseSummary({ label, summary }: { label: string; summary: CaseCountSummary }) {
  return (
    <article className="rounded-lg border bg-card p-4">
      <h4 className="text-sm font-semibold">{label}</h4>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center font-mono text-xs">
        <div><dt className="text-muted-foreground">总数</dt><dd className="mt-1 text-base text-foreground">{summary.total}</dd></div>
        <div><dt className="text-muted-foreground">通过</dt><dd className="mt-1 text-base text-foreground">{summary.passed}</dd></div>
        <div><dt className="text-muted-foreground">失败</dt><dd className="mt-1 text-base text-foreground">{summary.failed}</dd></div>
      </dl>
    </article>
  );
}

function OutputBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2">
      <h4 className="font-mono text-xs font-semibold text-muted-foreground">{label}</h4>
      <pre className="max-h-48 overflow-auto rounded-lg border bg-secondary p-4 font-mono text-sm whitespace-pre-wrap break-words" tabIndex={0}>
        {value === "" ? "（无输出）" : value}
      </pre>
    </div>
  );
}

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "medium",
});

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.valueOf()) ? "时间不可用" : TIMESTAMP_FORMAT.format(date);
}
