import { ArrowLeft, CircleStop, Play, Send } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "../../components/ui/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import type { RuntimeId } from "../../domain/language.js";
import type { ProblemWorkspaceSnapshot } from "./workspace-controller.js";

interface WorkspaceToolbarProps {
  snapshot: ProblemWorkspaceSnapshot;
  onRuntimeChange: (runtimeId: RuntimeId) => void;
  onRun: () => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function WorkspaceToolbar({
  snapshot,
  onRuntimeChange,
  onRun,
  onSubmit,
  onCancel,
}: WorkspaceToolbarProps) {
  const busy = snapshot.phase === "loading"
    || snapshot.phase === "running"
    || snapshot.phase === "submitting"
    || snapshot.phase === "cancelling";
  const canExecute = snapshot.problem !== undefined && snapshot.runtimeId !== undefined && !busy;

  return (
    <header className="border-b border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild size="sm" variant="ghost">
            <Link to="/problems">
              <ArrowLeft aria-hidden="true" />
              返回题库
            </Link>
          </Button>
          <span aria-hidden="true" className="h-6 w-px bg-border" />
          <div className="min-w-0">
            <p className="truncate font-mono text-xs font-semibold text-muted-foreground">PROBLEM WORKSPACE</p>
            <h1 className="truncate text-lg font-semibold leading-tight">
              {snapshot.problem?.title ?? "正在加载题目"}
            </h1>
          </div>
        </div>

        <div className="flex min-w-48 flex-1 items-center justify-end gap-3 sm:flex-initial">
          <span className="sr-only" id="workspace-runtime-label">本地判题运行时</span>
          <Select
            disabled={busy || snapshot.runtimeOptions.length === 0}
            onValueChange={(value) => onRuntimeChange(value as RuntimeId)}
            value={snapshot.runtimeId ?? ""}
          >
            <SelectTrigger aria-labelledby="workspace-runtime-label" className="w-full min-w-48 sm:w-64">
              <SelectValue placeholder="选择本地运行时" />
            </SelectTrigger>
            <SelectContent>
              {snapshot.runtimeOptions.map((option) => (
                <SelectItem disabled={option.disabled} key={option.value} value={option.value}>
                  <span className="grid min-w-0">
                    <span>{option.label} · {option.statusLabel}</span>
                    {option.reason === undefined ? null : (
                      <span className="truncate text-xs text-muted-foreground">{option.reason}</span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="hidden items-center gap-2 md:flex">
            <ActionButtons
              canExecute={canExecute}
              phase={snapshot.phase}
              onCancel={onCancel}
              onRun={onRun}
              onSubmit={onSubmit}
            />
          </div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-end gap-2 border-t border-border bg-card px-4 py-3 md:hidden">
        <ActionButtons
          canExecute={canExecute}
          phase={snapshot.phase}
          onCancel={onCancel}
          onRun={onRun}
          onSubmit={onSubmit}
        />
      </div>
    </header>
  );
}

function ActionButtons({
  canExecute,
  phase,
  onRun,
  onSubmit,
  onCancel,
}: {
  canExecute: boolean;
  phase: ProblemWorkspaceSnapshot["phase"];
  onRun: () => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const active = phase === "running" || phase === "submitting" || phase === "cancelling";
  return (
    <>
      <Button disabled={!canExecute} onClick={onRun} size="sm" type="button" variant="outline">
        <Play aria-hidden="true" />
        {phase === "running" ? "运行中" : "运行"}
      </Button>
      <Button disabled={!canExecute} onClick={onSubmit} size="sm" type="button">
        <Send aria-hidden="true" />
        {phase === "submitting" ? "提交中" : "提交"}
      </Button>
      <Button
        disabled={!active || phase === "cancelling"}
        onClick={onCancel}
        size="sm"
        type="button"
        variant="destructive"
      >
        <CircleStop aria-hidden="true" />
        {phase === "cancelling" ? "取消中" : "取消"}
      </Button>
    </>
  );
}
