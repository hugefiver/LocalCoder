import { Braces, Clock3, FileOutput, TerminalSquare, TriangleAlert } from "lucide-react";

import { ScrollArea } from "../../components/ui/scroll-area.js";
import type { ExecutorSnapshot } from "./executor-controller.js";

interface ExecutorOutputProps {
  output: ExecutorSnapshot["output"];
  elapsedMs: number | undefined;
}

export function ExecutorOutput({ output, elapsedMs }: ExecutorOutputProps) {
  return (
    <section aria-label="执行输出" className="flex min-h-0 flex-1 flex-col bg-[var(--surface-inset)]">
      {output === undefined ? (
        <div className="grid min-h-[calc(var(--space-16)*5)] flex-1 place-items-center p-6 text-center">
          <div className="grid max-w-[calc(var(--space-16)*6)] justify-items-center gap-3 text-muted-foreground">
            <TerminalSquare aria-hidden="true" className="size-8 text-[var(--text-disabled)]" strokeWidth={1.5} />
            <div>
              <p className="m-0 text-sm font-semibold text-foreground">等待本地执行</p>
              <p className="mt-1 text-xs">标准输出、标准错误与返回的 JSON 值会分别显示在这里。</p>
            </div>
          </div>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="grid gap-4 p-4">
            {output.truncated ? (
              <div className="flex items-start gap-2 rounded-sm border border-[var(--status-warning)] bg-card p-3 text-xs" role="status">
                <TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0 text-[var(--status-warning)]" />
                <span>输出达到本地运行时上限，以下内容已截断。</span>
              </div>
            ) : null}

            <OutputStream label="stdout · 标准输出" text={output.stdout} />
            <OutputStream label="stderr · 标准错误" text={output.stderr} tone="error" />

            <section className="overflow-hidden rounded-lg border border-border bg-card">
              <h3 className="flex items-center gap-2 border-b border-border px-3 py-2 font-mono text-xs font-semibold">
                <Braces aria-hidden="true" className="size-4 text-[var(--status-info)]" />
                返回值 · JSON
              </h3>
              <pre className="m-0 min-h-[calc(var(--space-12)*2)] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-sm leading-[var(--leading-code)] text-foreground">
                {JSON.stringify(output.value, null, 2)}
              </pre>
            </section>
          </div>
        </ScrollArea>
      )}

      <footer className="flex min-h-10 items-center gap-2 border-t border-border bg-card px-4 py-2 font-mono text-xs text-muted-foreground">
        <Clock3 aria-hidden="true" className="size-4" />
        {elapsedMs === undefined
          ? "耗时将在执行后显示（本地设备参考）"
          : `${elapsedMs.toFixed(1)} ms · 本地设备参考`}
      </footer>
    </section>
  );
}

interface OutputStreamProps {
  label: string;
  text: string;
  tone?: "neutral" | "error";
}

function OutputStream({ label, text, tone = "neutral" }: OutputStreamProps) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <h3 className="flex items-center gap-2 border-b border-border px-3 py-2 font-mono text-xs font-semibold">
        <FileOutput
          aria-hidden="true"
          className={tone === "error" ? "size-4 text-[var(--status-error)]" : "size-4 text-[var(--status-success)]"}
        />
        {label}
      </h3>
      <pre
        className={tone === "error"
          ? "m-0 min-h-[calc(var(--space-12)*2)] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-sm leading-[var(--leading-code)] text-[var(--status-error)]"
          : "m-0 min-h-[calc(var(--space-12)*2)] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-sm leading-[var(--leading-code)] text-foreground"}
      >
        {text.length === 0 ? "（无输出）" : text}
      </pre>
    </section>
  );
}
