import { useCallback, useEffect, useState } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../../components/ui/resizable.js";
import { Button } from "../../components/ui/button.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs.js";
import type { RuntimeId } from "../../domain/language.js";
import type { ProblemCase } from "../../domain/problem.js";
import { useAppServices } from "../../hooks/use-app-services.js";
import type { SettingsRecord } from "../../storage/schema.js";
import { ProblemStatementPanel } from "./ProblemStatementPanel.js";
import { WorkspaceEditorPanel } from "./WorkspaceEditorPanel.js";
import { WorkspaceToolbar } from "./WorkspaceToolbar.js";
import { useProblemWorkspace } from "./use-problem-workspace.js";

interface ProblemWorkspaceProps {
  problemId: number;
}

interface WorkspaceLayoutState {
  ready: boolean;
  desktopProblemPercent: number;
  tabletTab: "problem" | "code";
}

const DEFAULT_LAYOUT: WorkspaceLayoutState = {
  ready: false,
  desktopProblemPercent: 36,
  tabletTab: "problem",
};

export function ProblemWorkspace({ problemId }: ProblemWorkspaceProps) {
  const services = useAppServices();
  const { controller, snapshot } = useProblemWorkspace(problemId);
  const [layout, setLayout] = useState<WorkspaceLayoutState>(DEFAULT_LAYOUT);
  const [layoutError, setLayoutError] = useState<string>();
  const [actionError, setActionError] = useState<string>();

  useEffect(() => {
    let active = true;
    void services.storage.getSettings()
      .then((settings) => {
        if (!active) return;
        setLayout({
          ready: true,
          desktopProblemPercent: boundedProblemPercent(settings.layout.desktopProblemPercent),
          tabletTab: settings.layout.tabletTab,
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLayout((current) => ({ ...current, ready: true }));
        setLayoutError(`未保存：布局设置读取失败（${messageFor(error)}）。`);
      });
    return () => {
      active = false;
    };
  }, [services]);

  const saveLayout = useCallback(async (change: Partial<SettingsRecord["layout"]>): Promise<void> => {
    try {
      const latest = await services.storage.getSettings();
      await services.storage.saveSettings({
        ...latest,
        preferredRuntimeByLanguage: { ...latest.preferredRuntimeByLanguage },
        layout: { ...latest.layout, ...change },
        updatedAt: Date.now(),
      });
      setLayoutError(undefined);
    } catch (error) {
      setLayoutError(`未保存：布局设置保存失败（${messageFor(error)}）。请检查浏览器存储后重试。`);
    }
  }, [services]);

  const selectRuntime = (runtimeId: RuntimeId): void => {
    setActionError(undefined);
    void controller.selectRuntime(runtimeId).catch((error: unknown) => setActionError(messageFor(error)));
  };
  const run = (): void => {
    setActionError(undefined);
    void controller.run().catch((error: unknown) => setActionError(messageFor(error)));
  };
  const submit = (): void => {
    setActionError(undefined);
    void controller.submit().catch((error: unknown) => setActionError(messageFor(error)));
  };
  const replaceCustomCases = async (cases: readonly ProblemCase[]): Promise<void> => {
    await controller.replaceCustomCases(cases);
  };
  const changeTab = (value: string): void => {
    if (value !== "problem" && value !== "code") return;
    setLayout((current) => ({ ...current, tabletTab: value }));
    void saveLayout({ tabletTab: value });
  };
  const changeDesktopLayout = (nextLayout: { [id: string]: number }): void => {
    const problemPercent = nextLayout.problem;
    if (problemPercent === undefined) return;
    const bounded = boundedProblemPercent(problemPercent);
    setLayout((current) => ({ ...current, desktopProblemPercent: bounded }));
    void saveLayout({ desktopProblemPercent: bounded });
  };

  const busy = snapshot.phase === "running"
    || snapshot.phase === "submitting"
    || snapshot.phase === "cancelling";
  const visibleError = actionError ?? snapshot.error ?? layoutError;

  return (
    <div className="min-w-0 bg-background pb-20 md:pb-0">
      <WorkspaceToolbar
        onCancel={() => controller.cancel()}
        onRun={run}
        onRuntimeChange={selectRuntime}
        onSubmit={submit}
        snapshot={snapshot}
      />

      {visibleError === undefined ? null : (
        <div className="flex items-start gap-2 border-b border-[var(--status-warning)] bg-card px-4 py-3 text-sm" role="alert">
          <TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0 text-[var(--status-warning)]" />
          <span className="overflow-wrap-anywhere text-muted-foreground">{visibleError}</span>
        </div>
      )}

      {snapshot.phase === "error" && snapshot.problem === undefined ? (
        <section className="grid min-h-[calc(var(--space-16)*6)] place-items-center p-6">
          <div className="grid max-w-xl gap-4 rounded-lg border border-[var(--status-error)] bg-card p-6">
            <TriangleAlert aria-hidden="true" className="size-6 text-[var(--status-error)]" />
            <div>
              <h2 className="text-xl font-semibold">无法打开题目工作区</h2>
              <p className="mt-2 text-sm text-muted-foreground">{snapshot.error}</p>
            </div>
            <Button className="w-fit" onClick={() => void controller.load(problemId)} type="button" variant="outline">
              <RotateCcw aria-hidden="true" />
              重试
            </Button>
          </div>
        </section>
      ) : snapshot.problem === undefined || snapshot.languageId === undefined ? (
        <section aria-busy="true" className="grid min-h-[calc(var(--space-16)*7)] gap-4 p-4" role="status">
          <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">正在恢复题目、运行时、草稿与自定义用例…</div>
          <div className="rounded-lg border border-border bg-secondary" />
        </section>
      ) : (
        <>
          <div className="hidden h-[calc(100dvh-(var(--space-16)*3))] min-h-[calc(var(--space-16)*8)] lg:flex">
            {layout.ready ? (
              <ResizablePanelGroup
                defaultLayout={{ problem: layout.desktopProblemPercent, workspace: 100 - layout.desktopProblemPercent }}
                direction="horizontal"
                id="problem-workspace-layout"
                onLayoutChanged={changeDesktopLayout}
              >
                <ResizablePanel id="problem" maxSize="55%" minSize="24%">
                  <ProblemStatementPanel problem={snapshot.problem} />
                </ResizablePanel>
                <ResizableHandle aria-label="调整题目与代码面板宽度；使用左右方向键进行键盘调整" withHandle />
                <ResizablePanel id="workspace" minSize="45%">
                  <div className="h-full overflow-y-auto">
                    <WorkspaceEditorPanel
                      busy={busy}
                      customCases={snapshot.customCases}
                      languageId={snapshot.languageId}
                      onEdit={(source) => controller.edit(source)}
                      onReplaceCustomCases={replaceCustomCases}
                      problem={snapshot.problem}
                      recentSubmissions={snapshot.recentSubmissions}
                      result={snapshot.result}
                      source={snapshot.source}
                    />
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              <div aria-busy="true" className="size-full border-b border-border bg-secondary p-6 text-sm text-muted-foreground" role="status">
                正在恢复面板布局…
              </div>
            )}
          </div>

          <Tabs className="gap-0 lg:hidden" onValueChange={changeTab} value={layout.tabletTab}>
            <div className="sticky top-0 z-20 border-b border-border bg-card px-4 py-2">
              <TabsList className="grid w-full grid-cols-2 rounded-lg border border-border bg-secondary p-1">
                <TabsTrigger className="shadow-none" value="problem">题目</TabsTrigger>
                <TabsTrigger className="shadow-none" value="code">代码</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent className="m-0 min-w-0" value="problem">
              <ProblemStatementPanel problem={snapshot.problem} />
            </TabsContent>
            <TabsContent className="m-0 min-w-0" value="code">
              <WorkspaceEditorPanel
                busy={busy}
                customCases={snapshot.customCases}
                languageId={snapshot.languageId}
                onEdit={(source) => controller.edit(source)}
                onReplaceCustomCases={replaceCustomCases}
                problem={snapshot.problem}
                recentSubmissions={snapshot.recentSubmissions}
                result={snapshot.result}
                source={snapshot.source}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function messageFor(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : "未知错误";
}

function boundedProblemPercent(value: number): number {
  return Math.min(55, Math.max(24, value));
}
