import { ArrowRight, ListChecks, TerminalSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "../components/ui/button.js";
import { buildHomeSummary, type HomeSummaryModel } from "../features/home/home-view-model.js";
import { ProgressSummary } from "../features/home/ProgressSummary.js";
import { useAppServices } from "../hooks/use-app-services.js";

export function HomePage() {
  const services = useAppServices();
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<HomeState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void Promise.all([
      services.problems.list(),
      services.storage.listProgress(),
      services.storage.listSubmissions(),
    ]).then(([problems, progress, submissions]) => {
      if (!cancelled) setState({ kind: "ready", summary: buildHomeSummary(problems, progress, submissions) });
    }).catch((error: unknown) => {
      if (!cancelled) setState({ kind: "error", message: errorMessage(error) });
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, services]);

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-8 sm:px-6 sm:py-12">
      <header className="grid max-w-3xl gap-4">
        <p className="font-mono text-xs font-semibold text-muted-foreground">BROWSER-LOCAL OJ</p>
        <h1 className="text-4xl font-bold tracking-tight">LocalCoder</h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          在浏览器中运行、判题并保存本地练习记录。运行时状态和数据耐久性始终明确可见。
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild><Link to="/problems"><ListChecks aria-hidden="true" />浏览题库</Link></Button>
          <Button asChild variant="outline"><Link to="/executor"><TerminalSquare aria-hidden="true" />自由执行</Link></Button>
        </div>
      </header>

      <HomeContent onRetry={() => setReloadKey((value) => value + 1)} state={state} />
    </div>
  );
}

type HomeState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; summary: HomeSummaryModel };

function HomeContent({ state, onRetry }: { state: HomeState; onRetry: () => void }) {
  if (state.kind === "loading") {
    return <div aria-busy="true" className="min-h-72 rounded-lg border bg-card p-6" role="status">正在读取本地进度…</div>;
  }
  if (state.kind === "error") {
    return (
      <section className="rounded-lg border border-destructive bg-card p-6" role="alert">
        <h2 className="font-semibold">无法读取本地进度</h2>
        <p className="mt-2 overflow-wrap-anywhere text-sm text-muted-foreground">{state.message}</p>
        <Button className="mt-4" onClick={onRetry} type="button" variant="outline">重试</Button>
      </section>
    );
  }
  return (
    <div className="grid gap-8">
      <ProgressSummary summary={state.summary} />
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-5">
        <div>
          <h2 className="font-semibold">继续本地练习</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {state.summary.recentProblemId === undefined ? "从题库选择第一道题开始。" : `返回最近练习的题目 #${state.summary.recentProblemId}。`}
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link to={state.summary.recentProblemId === undefined ? "/problems" : `/problems/${state.summary.recentProblemId}`}>
            {state.summary.recentProblemId === undefined ? "打开题库" : "继续练习"}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </section>
    </div>
  );
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= 500 ? message : `${message.slice(0, 497)}…`;
}
