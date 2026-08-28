import { House, RefreshCw, TriangleAlert } from "lucide-react";
import type { FallbackProps } from "react-error-boundary";
import { Link } from "react-router-dom";

import { Button } from "../ui/button.js";

export function AppErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const detail = error instanceof Error ? error.message : String(error);
  return (
    <main className="app-error" role="alert">
      <div className="app-error__panel">
        <TriangleAlert className="app-error__icon" aria-hidden="true" />
        <p className="app-error__eyebrow">LocalCoder 无法加载</p>
        <h1>本地工作台遇到问题</h1>
        <p>当前页面没有继续运行。你可以返回首页，或重新加载以再次初始化本地运行时和存储。</p>
        <details>
          <summary>查看错误详情</summary>
          <pre>{detail}</pre>
        </details>
        <div className="app-error__actions">
          <Button asChild variant="outline">
            <Link to="/" onClick={() => queueMicrotask(resetErrorBoundary)}>
              <House aria-hidden="true" />返回首页
            </Link>
          </Button>
          <Button type="button" onClick={() => window.location.reload()}>
            <RefreshCw aria-hidden="true" />重新加载
          </Button>
        </div>
      </div>
    </main>
  );
}
