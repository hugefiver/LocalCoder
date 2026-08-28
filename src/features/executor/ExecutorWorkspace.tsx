import { useId, useState } from "react";
import {
  CircleStop,
  Database,
  DatabaseZap,
  Play,
  RotateCcw,
  TerminalSquare,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { CodeEditor } from "../../components/CodeEditor.js";
import { Button } from "../../components/ui/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import type { RuntimeId } from "../../domain/language.js";
import type { ExecutorSnapshot } from "./executor-controller.js";
import { ExecutorOutput } from "./ExecutorOutput.js";
import { useExecutor } from "./use-executor.js";

export function ExecutorWorkspace() {
  const { controller, snapshot } = useExecutor();
  const [actionError, setActionError] = useState<string>();
  const selectorLabelId = useId();
  const reasonsId = useId();
  const unavailable = snapshot.runtimeOptions.filter((option) => option.disabled && option.reason !== undefined);
  const busy = snapshot.phase === "initializing"
    || snapshot.phase === "running"
    || snapshot.phase === "cancelling";
  const cancellable = snapshot.phase === "initializing" || snapshot.phase === "running";
  const visibleError = actionError ?? snapshot.error;

  const selectRuntime = (runtimeId: RuntimeId): void => {
    setActionError(undefined);
    void controller.selectRuntime(runtimeId).catch((error: unknown) => setActionError(messageFor(error)));
  };
  const execute = (): void => {
    setActionError(undefined);
    void controller.execute().catch((error: unknown) => setActionError(messageFor(error)));
  };

  return (
    <div className="min-w-0 bg-background pb-20 lg:pb-0">
      <header className="border-b border-border bg-card">
        <div className="grid gap-4 px-4 py-4 lg:grid-cols-3 lg:items-start lg:px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-sm border border-border bg-secondary text-primary">
                <TerminalSquare aria-hidden="true" className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="m-0 font-mono text-xs font-semibold uppercase text-muted-foreground">local execution</p>
                <h1 className="m-0 text-[length:var(--text-h3)] font-semibold leading-[var(--leading-h3)]">自由执行工作台</h1>
              </div>
            </div>
            <p className="mb-0 mt-3 max-w-xl text-sm text-muted-foreground">
              源码只发送给浏览器内已打包的运行时，不包含题目、期望值或提交记录。
            </p>
          </div>

          <div className="grid min-w-0 gap-3 lg:col-span-2">
            <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div className="grid min-w-0 gap-2">
                <label className="font-mono text-xs font-semibold text-muted-foreground" id={selectorLabelId}>
                  语言与本地运行时
                </label>
                <Select
                  disabled={busy || snapshot.phase === "loading"}
                  onValueChange={(value) => selectRuntime(value as RuntimeId)}
                  value={snapshot.runtimeId ?? ""}
                >
                  <SelectTrigger
                    aria-describedby={unavailable.length === 0 ? undefined : reasonsId}
                    aria-labelledby={selectorLabelId}
                    className="w-full bg-[var(--surface-raised)]"
                  >
                    <SelectValue placeholder="选择本地运行时" />
                  </SelectTrigger>
                  <SelectContent>
                    {snapshot.runtimeOptions.map((option) => (
                      <SelectItem disabled={option.disabled} key={option.value} value={option.value}>
                        <span>{option.label}</span>
                        <span className="font-mono text-xs text-muted-foreground">{option.statusLabel}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Button disabled={busy || snapshot.phase === "loading" || snapshot.runtimeId === undefined} onClick={execute} type="button">
                  <Play aria-hidden="true" />
                  执行
                </Button>
                <Button disabled={!cancellable} onClick={() => controller.cancel()} type="button" variant="destructive">
                  <CircleStop aria-hidden="true" />
                  取消
                </Button>
                <Button disabled={snapshot.output === undefined} onClick={() => controller.clearOutput()} type="button" variant="outline">
                  <Trash2 aria-hidden="true" />
                  清空
                </Button>
              </div>
            </div>

            {unavailable.length === 0 ? null : (
              <ul className="m-0 grid gap-1 pl-5 font-mono text-xs text-muted-foreground" id={reasonsId}>
                {unavailable.map((option) => (
                  <li key={option.value}><strong>{option.label}：</strong>{option.reason}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </header>

      <WorkspaceStatus error={visibleError} snapshot={snapshot} />

      {snapshot.phase === "error" && snapshot.languageId === undefined ? (
        <section className="grid min-h-[calc(var(--space-16)*6)] place-items-center p-6">
          <div className="grid max-w-[calc(var(--space-16)*8)] gap-4 rounded-lg border border-[var(--status-error)] bg-card p-6">
            <TriangleAlert aria-hidden="true" className="size-6 text-[var(--status-error)]" />
            <div>
              <h2 className="m-0 text-[length:var(--text-h3)] font-semibold leading-[var(--leading-h3)]">无法打开自由执行工作台</h2>
              <p className="mb-0 mt-2 text-sm text-muted-foreground">{snapshot.error}</p>
            </div>
            <Button className="w-fit" onClick={() => void controller.load()} type="button" variant="outline">
              <RotateCcw aria-hidden="true" />
              重试
            </Button>
          </div>
        </section>
      ) : snapshot.phase === "loading" || snapshot.languageId === undefined ? (
        <section aria-busy="true" className="grid min-h-[calc(var(--space-16)*8)] gap-4 p-4" role="status">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            <RotateCcw aria-hidden="true" className="size-4" />
            正在恢复运行时偏好与对应草稿…
          </div>
          <div className="rounded-lg border border-border bg-secondary" />
        </section>
      ) : (
        <div className="grid min-w-0 lg:h-[calc(100dvh-(var(--space-16)*3))] lg:min-h-[calc(var(--space-16)*8)] lg:grid-cols-5">
          <section aria-label="源码编辑器" className="flex min-w-0 flex-col border-b border-border bg-card lg:col-span-3 lg:border-b-0 lg:border-r">
            <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border px-4 py-2">
              <h2 className="m-0 text-sm font-semibold">源码</h2>
              <span className="truncate font-mono text-xs text-muted-foreground">{snapshot.languageId}</span>
            </div>
            <div className="h-[calc(var(--space-16)*7)] min-h-0 p-4 lg:h-auto lg:flex-1">
              <CodeEditor
                className="rounded-lg"
                language={snapshot.languageId}
                onChange={(source) => controller.edit(source)}
                value={snapshot.source}
              />
            </div>
          </section>

          <section aria-label="运行结果" className="flex min-h-[calc(var(--space-16)*6)] min-w-0 flex-col bg-[var(--surface-inset)] lg:col-span-2 lg:min-h-0">
            <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border bg-card px-4 py-2">
              <h2 className="m-0 text-sm font-semibold">输出</h2>
              <span aria-live="polite" className="font-mono text-xs text-muted-foreground">
                {phaseLabel(snapshot.phase)}
              </span>
            </div>
            <ExecutorOutput elapsedMs={snapshot.elapsedMs} output={snapshot.output} />
          </section>
        </div>
      )}
    </div>
  );
}

interface WorkspaceStatusProps {
  error: string | undefined;
  snapshot: ExecutorSnapshot;
}

function WorkspaceStatus({ error, snapshot }: WorkspaceStatusProps) {
  if (error !== undefined) {
    return (
      <div className="flex items-start gap-2 border-b border-[var(--status-warning)] bg-card px-4 py-3 text-sm lg:px-6" role="alert">
        <TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0 text-[var(--status-warning)]" />
        <span className="break-words text-muted-foreground">{error}</span>
      </div>
    );
  }
  if (snapshot.storageState.kind === "memory") {
    return (
      <div className="flex items-start gap-2 border-b border-[var(--status-warning)] bg-card px-4 py-3 text-sm lg:px-6" role="status">
        <DatabaseZap aria-hidden="true" className="mt-1 size-4 shrink-0 text-[var(--status-warning)]" />
        <span><strong>{snapshot.storageState.message}：</strong>{snapshot.storageState.reason}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 border-b border-border bg-secondary px-4 py-2 font-mono text-xs text-muted-foreground lg:px-6" role="status">
      <Database aria-hidden="true" className="size-4 shrink-0 text-[var(--status-success)]" />
      草稿在编辑停止 300ms 后保存到此浏览器
    </div>
  );
}

function phaseLabel(phase: ExecutorSnapshot["phase"]): string {
  switch (phase) {
    case "loading": return "正在恢复";
    case "ready": return "就绪";
    case "initializing": return "正在初始化运行时";
    case "running": return "正在本地执行";
    case "cancelling": return "正在取消";
    case "cancelled": return "已取消";
    case "error": return "执行失败";
  }
}

function messageFor(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : "未知错误";
}
