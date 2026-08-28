import {
  Ban,
  Bug,
  CircleCheck,
  CircleX,
  CodeXml,
  PackageX,
  TimerOff,
  TriangleAlert,
} from "lucide-react";

import type { JsonValue } from "../../domain/json-value.js";
import type { SubmissionResult, Verdict, VisibleCaseResult } from "../../domain/submission.js";

const DISPLAY_OUTPUT_LIMIT = 8_000;

interface ResultPanelProps {
  result: SubmissionResult | undefined;
}

export function ResultPanel({ result }: ResultPanelProps) {
  if (result === undefined) {
    return (
      <section className="grid min-h-40 place-items-center rounded-lg border border-dashed border-border bg-secondary p-6 text-center" aria-label="运行结果">
        <div className="grid gap-2 text-muted-foreground">
          <CodeXml aria-hidden="true" className="mx-auto size-6" />
          <p className="text-sm">运行或提交后，这里会显示可见用例和判题汇总。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="grid min-w-0 gap-5" aria-label="运行结果">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h3 className="text-lg font-semibold">运行结果</h3>
          <p className="mt-1 font-mono text-xs text-muted-foreground">本地耗时 {result.elapsedMs.toFixed(1)} ms</p>
        </div>
        <div aria-live="polite" aria-atomic="true" role="status">
          <VerdictBadge verdict={result.verdict} />
        </div>
      </header>

      {result.runtime === undefined ? null : (
        <dl className="grid gap-2 rounded-lg border border-border bg-secondary p-3 font-mono text-xs sm:grid-cols-3">
          <RuntimeFact label="运行时" value={result.runtime.runtimeId} />
          <RuntimeFact label="版本" value={result.runtime.runtimeVersion} />
          <RuntimeFact label="构建" value={result.runtime.buildId} />
        </dl>
      )}

      {result.failure === undefined ? null : (
        <div className="rounded-lg border border-[var(--status-error)] bg-card p-3 text-sm" role="alert">
          <p className="font-mono text-xs font-semibold text-[var(--status-error)]">{result.failure.code}</p>
          <p className="mt-1 overflow-wrap-anywhere text-muted-foreground">{result.failure.message}</p>
        </div>
      )}

      <VisibleCases cases={result.publicCases} title="公开用例" />
      <VisibleCases cases={result.customCases} title="自定义用例" />

      <section className="rounded-lg border border-border bg-card p-4" aria-label="判题用例">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="font-semibold">判题用例</h4>
            <p className="mt-1 text-xs text-muted-foreground">界面只显示计数，不渲染判题输入、预期值或实际值。</p>
          </div>
          <span className="rounded-full border border-border bg-secondary px-3 py-1 font-mono text-xs">
            {result.judgeSummary.passed}/{result.judgeSummary.total} 通过
          </span>
        </div>
      </section>

      <OutputSection output={result.output} />
    </section>
  );
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

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const tone = verdictTone(verdict);
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-current px-3 py-1 text-sm font-semibold text-[var(--status-tone)]" data-tone={tone}>
      <span>{verdictIcon(verdict)}</span>
      {verdictLabel(verdict)}
    </span>
  );
}

function VisibleCases({ cases, title }: { cases: readonly VisibleCaseResult[]; title: string }) {
  if (cases.length === 0) return null;
  return (
    <section className="grid gap-3" aria-label={title}>
      <h4 className="font-semibold">{title} · {cases.length}</h4>
      {cases.map((testCase) => {
        const passed = testCase.comparison?.equal === true;
        return (
          <details className="rounded-lg border border-border bg-card open:border-[var(--border-strong)]" key={`${testCase.visibility}-${testCase.index}`}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
              <span>用例 #{testCase.index + 1}</span>
              <span className={passed ? "text-[var(--status-success)]" : "text-[var(--status-error)]"}>
                {passed ? "通过" : "未通过"}
              </span>
            </summary>
            <div className="grid min-w-0 gap-3 border-t border-border p-4 sm:grid-cols-2">
              <JsonFact label="输入" value={testCase.input} />
              <JsonFact label="预期" value={testCase.expected} />
              {testCase.actual === undefined ? null : <JsonFact label="实际" value={testCase.actual} />}
              {testCase.failure === undefined ? null : (
                <TextFact label={`失败 · ${testCase.failure.code}`} value={testCase.failure.message} />
              )}
              {testCase.stdout.length === 0 ? null : <TextFact label="stdout" value={testCase.stdout} />}
              {testCase.stderr.length === 0 ? null : <TextFact label="stderr" value={testCase.stderr} />}
            </div>
          </details>
        );
      })}
    </section>
  );
}

function OutputSection({ output }: { output: SubmissionResult["output"] }) {
  const stdout = truncateForDisplay(output.stdout);
  const stderr = truncateForDisplay(output.stderr);
  if (stdout.text.length === 0 && stderr.text.length === 0 && !output.truncated) return null;
  return (
    <section className="grid min-w-0 gap-3 rounded-lg border border-border bg-[var(--surface-inset)] p-4" aria-label="程序输出">
      <h4 className="font-semibold">程序输出</h4>
      {stdout.text.length === 0 ? null : <TextFact label="stdout" value={stdout.text} />}
      {stderr.text.length === 0 ? null : <TextFact label="stderr" value={stderr.text} />}
      {output.truncated || stdout.truncated || stderr.truncated ? (
        <p className="text-xs text-[var(--status-warning)]">
          输出已截断。为保持界面可读，此处只展示服务边界内的有限内容。
        </p>
      ) : null}
    </section>
  );
}

function JsonFact({ label, value }: { label: string; value: JsonValue }) {
  return <TextFact label={label} value={JSON.stringify(value, null, 2)} />;
}

function TextFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-xs font-semibold text-muted-foreground">{label}</p>
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-[var(--surface-inset)] p-3 font-mono text-xs leading-relaxed">{value}</pre>
    </div>
  );
}

function RuntimeFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

function truncateForDisplay(value: string): { text: string; truncated: boolean } {
  if (value.length <= DISPLAY_OUTPUT_LIMIT) return { text: value, truncated: false };
  return { text: `${value.slice(0, DISPLAY_OUTPUT_LIMIT)}\n…`, truncated: true };
}

function verdictTone(verdict: Verdict): "success" | "warning" | "error" | "info" {
  if (verdict === "accepted") return "success";
  if (verdict === "cancelled") return "info";
  if (verdict === "time-limit-exceeded") return "warning";
  return "error";
}

function verdictIcon(verdict: Verdict) {
  const className = "size-4";
  switch (verdict) {
    case "accepted": return <CircleCheck aria-hidden="true" className={className} />;
    case "wrong-answer": return <CircleX aria-hidden="true" className={className} />;
    case "compile-error": return <CodeXml aria-hidden="true" className={className} />;
    case "runtime-error": return <Bug aria-hidden="true" className={className} />;
    case "time-limit-exceeded": return <TimerOff aria-hidden="true" className={className} />;
    case "cancelled": return <Ban aria-hidden="true" className={className} />;
    case "internal-error": return <TriangleAlert aria-hidden="true" className={className} />;
    case "runtime-unavailable": return <PackageX aria-hidden="true" className={className} />;
  }
}
