import { Info, Laptop } from "lucide-react";

import type { Problem } from "../../domain/problem.js";

interface ProblemStatementPanelProps {
  problem: Problem;
}

export function ProblemStatementPanel({ problem }: ProblemStatementPanelProps) {
  return (
    <article className="h-full min-w-0 overflow-y-auto bg-card p-4 lg:p-6" aria-label={`题目说明：${problem.title}`}>
      <header className="grid gap-3 border-b border-border pb-5">
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
          <span>#{problem.id}</span>
          <span aria-hidden="true">/</span>
          <span>{problem.difficulty}</span>
          {problem.tags.map((tag) => (
            <span className="rounded-full border border-border bg-secondary px-2 py-1" key={tag}>{tag}</span>
          ))}
        </div>
        <h2 className="text-2xl font-bold tracking-tight">{problem.title}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{problem.summary}</p>
      </header>

      <div
        className="grid gap-4 py-6 text-base leading-relaxed text-foreground [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_code]:rounded-sm [&_code]:bg-secondary [&_code]:px-1 [&_code]:font-mono [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-5 [&_h3]:text-lg [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:grid [&_ol]:gap-2 [&_p]:m-0 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:bg-[var(--surface-inset)] [&_pre]:p-4 [&_ul]:grid [&_ul]:gap-2"
        dangerouslySetInnerHTML={{ __html: problem.safeHtml }}
      />

      {problem.examples.length === 0 ? null : (
        <section className="grid gap-3 border-t border-border py-5" aria-label="示例">
          <h3 className="text-lg font-semibold">示例</h3>
          {problem.examples.map((example, index) => (
            <div className="grid gap-3 rounded-lg border border-border bg-secondary p-4" key={`${example.input}-${index}`}>
              <div>
                <span className="font-mono text-xs font-semibold text-muted-foreground">输入</span>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-sm">{example.input}</pre>
              </div>
              <div>
                <span className="font-mono text-xs font-semibold text-muted-foreground">输出</span>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-sm">{example.output}</pre>
              </div>
              {example.explanation === undefined ? null : (
                <p className="text-sm text-muted-foreground">{example.explanation}</p>
              )}
            </div>
          ))}
        </section>
      )}

      {problem.constraints.length === 0 ? null : (
        <section className="grid gap-3 border-t border-border py-5" aria-label="约束">
          <h3 className="text-lg font-semibold">约束</h3>
          <ul className="grid gap-2 font-mono text-sm text-muted-foreground">
            {problem.constraints.map((constraint) => <li key={constraint}>— {constraint}</li>)}
          </ul>
        </section>
      )}

      <aside className="grid gap-3 border-t border-border py-5 text-sm text-muted-foreground" aria-label="本地判题边界说明">
        <p className="flex items-start gap-2">
          <Laptop aria-hidden="true" className="mt-1 size-4 shrink-0 text-[var(--status-info)]" />
          所有代码与用例都在当前浏览器本地执行；结果用于练习反馈，不是权威或安全隔离的远程判题。
        </p>
        <p className="flex items-start gap-2">
          <Info aria-hidden="true" className="mt-1 size-4 shrink-0 text-[var(--status-warning)]" />
          判题用例只在界面中隐藏，并非秘密；它们属于可检查的静态客户端资源。
        </p>
      </aside>
    </article>
  );
}
