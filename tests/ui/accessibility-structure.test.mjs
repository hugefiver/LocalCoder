import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);

async function source(relativePath) {
  return readFile(new URL(relativePath, rootUrl), "utf8");
}

test("declares Chinese as the document language", async () => {
  const html = await source("index.html");
  assert.match(html, /<html\s+lang="zh-CN">/u);
});

test("declares an empty data URL favicon", async () => {
  const html = await source("index.html");
  assert.match(html, /<head>[\s\S]*<link\s+rel="icon"\s+href="data:,">[\s\S]*<\/head>/u);
});

test("keeps AppShell as the only ready-state main landmark", async () => {
  const [shell, executor] = await Promise.all([
    source("src/components/app/AppShell.tsx"),
    source("src/features/executor/ExecutorWorkspace.tsx"),
  ]);
  assert.match(shell, /<main\b/u);
  assert.doesNotMatch(executor, /<main\b/u);
});

test("reusable workspace panels do not emit shared fixed IDs", async () => {
  const files = await Promise.all([
    source("src/components/CodeEditor.tsx"),
    source("src/features/problems/ProblemStatementPanel.tsx"),
    source("src/features/problems/ResultPanel.tsx"),
    source("src/features/problems/RecentProblemSubmissions.tsx"),
  ]);
  const combined = files.join("\n");
  for (const id of [
    "code-editor",
    "problem-statement-title",
    "problem-examples-title",
    "problem-constraints-title",
    "workspace-result-title",
    "judge-summary-title",
    "result-output-title",
    "recent-problem-submissions-title",
  ]) {
    assert.doesNotMatch(combined, new RegExp(`(?:id|aria-labelledby)=[{]?['"]${id}['"]`, "u"), id);
  }
});

test("describes runtime identity as protocol-validated rather than authenticated", async () => {
  const [readme, architecture] = await Promise.all([
    source("README.md"),
    source("docs/architecture/runtime-kernel.md"),
  ]);
  const combined = `${readme}\n${architecture}`;
  assert.doesNotMatch(combined, /authenticated handshake identity/iu);
  assert.match(combined, /protocol-validated handshake identity/iu);
});
