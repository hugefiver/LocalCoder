import { useEffect, useState } from "react";
import { Beaker, ClipboardCheck, History } from "lucide-react";

import { CodeEditor } from "../../components/CodeEditor.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs.js";
import type { LanguageId } from "../../domain/language.js";
import type { Problem, ProblemCase } from "../../domain/problem.js";
import type { SubmissionResult } from "../../domain/submission.js";
import type { SubmissionRecord } from "../../storage/schema.js";
import { CaseEditorPanel } from "./CaseEditorPanel.js";
import { RecentProblemSubmissions } from "./RecentProblemSubmissions.js";
import { ResultPanel } from "./ResultPanel.js";

interface WorkspaceEditorPanelProps {
  problem: Problem;
  languageId: LanguageId;
  source: string;
  customCases: readonly ProblemCase[];
  result: SubmissionResult | undefined;
  recentSubmissions: readonly SubmissionRecord[];
  busy: boolean;
  onEdit: (source: string) => void;
  onReplaceCustomCases: (cases: readonly ProblemCase[]) => Promise<void>;
}

type LowerPanelTab = "cases" | "result" | "recent";

export function WorkspaceEditorPanel({
  problem,
  languageId,
  source,
  customCases,
  result,
  recentSubmissions,
  busy,
  onEdit,
  onReplaceCustomCases,
}: WorkspaceEditorPanelProps) {
  const [activeTab, setActiveTab] = useState<LowerPanelTab>(result === undefined ? "cases" : "result");

  useEffect(() => {
    if (result !== undefined) setActiveTab("result");
  }, [result]);

  return (
    <section className="grid min-w-0 gap-4 bg-[var(--surface-panel)] p-4 lg:p-6" aria-label="代码与判题工作区">
      <div className="grid min-w-0 gap-3">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">代码编辑器</h2>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{languageId} · solution(JSON) → JSON</p>
          </div>
          <p className="text-xs text-muted-foreground">Tab 缩进；先按 Escape，再按 Tab 可移出编辑器。</p>
        </header>
        <div className="h-[calc(var(--space-16)*6)] min-h-80 min-w-0" aria-busy={busy || undefined}>
          <CodeEditor className="rounded-lg" language={languageId} onChange={onEdit} value={source} />
        </div>
      </div>

      <Tabs className="min-w-0 gap-4" onValueChange={(value) => setActiveTab(value as LowerPanelTab)} value={activeTab}>
        <TabsList className="grid h-auto w-full grid-cols-3 rounded-lg border border-border bg-secondary p-1 sm:w-fit sm:min-w-96">
          <TabsTrigger className="shadow-none" value="cases">
            <Beaker aria-hidden="true" />
            用例
          </TabsTrigger>
          <TabsTrigger className="shadow-none" value="result">
            <ClipboardCheck aria-hidden="true" />
            结果
          </TabsTrigger>
          <TabsTrigger className="shadow-none" value="recent">
            <History aria-hidden="true" />
            最近提交
          </TabsTrigger>
        </TabsList>
        <TabsContent className="m-0 min-w-0" value="cases">
          <CaseEditorPanel
            customCases={customCases}
            onReplaceCustomCases={onReplaceCustomCases}
            publicCases={problem.tests.public}
          />
        </TabsContent>
        <TabsContent className="m-0 min-w-0" value="result">
          <ResultPanel result={result} />
        </TabsContent>
        <TabsContent className="m-0 min-w-0" value="recent">
          <RecentProblemSubmissions records={recentSubmissions} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
