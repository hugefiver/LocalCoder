import assert from "node:assert/strict";
import test from "node:test";
import { parseProblemDocument } from "../../src/problems/problem-schema.js";

function unsafeDocument(markdown: string): string {
  return `---
schemaVersion: 2
id: 99
slug: markdown-safety
title: Markdown Safety
difficulty: Easy
summary: Exercise the Markdown rendering boundary.
tags: [security]
examples:
  - input: value = 1
    output: "1"
constraints: [value is JSON]
entrypoint: solution
contract: json-function-v1
templates:
  javascript: |
    function solution(input) { return input; }
  typescript: |
    function solution(input: unknown): unknown { return input; }
  python: |
    def solution(input):
        return input
tests:
  public:
    - input: 1
      expected: 1
  judge:
    - input: 2
      expected: 2
---
${markdown}
`;
}

test("problem markdown escapes raw HTML and disables dangerous URL schemes", () => {
  const problem = parseProblemDocument(
    "unsafe.md",
    unsafeDocument(`<img src=x onerror=alert(1)>

[script](javascript:alert%281%29) [encoded](%6a%61%76%61%73%63%72%69%70%74%3Aalert%281%29) [control](java%0ascript:alert%281%29) ![image](data:text/html;base64,PHNjcmlwdD4=)`),
  );

  assert.doesNotMatch(problem.safeHtml, /<img\b/i);
  assert.doesNotMatch(problem.safeHtml, /<[^>]+\bonerror\s*=/i);
  assert.doesNotMatch(problem.safeHtml, /href=["'](?:javascript|data|vbscript):/i);
  assert.match(problem.safeHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(problem.safeHtml, /script/);
  assert.match(problem.safeHtml, /encoded/);
  assert.match(problem.safeHtml, /control/);
});

test("safe Markdown links, images, and fenced code retain their normal rendering", () => {
  const problem = parseProblemDocument(
    "safe.md",
    unsafeDocument(`[relative](./guide) [site](https://example.test/guide) [mail](mailto:test@example.test)

![diagram](./diagram.png)

\`\`\`javascript
const value = "<not html>";
\`\`\``),
  );

  assert.match(problem.safeHtml, /href="\.\/guide"/);
  assert.match(problem.safeHtml, /href="https:\/\/example\.test\/guide"/);
  assert.match(problem.safeHtml, /href="mailto:test@example\.test"/);
  assert.match(problem.safeHtml, /<img src="\.\/diagram\.png" alt="diagram">/);
  assert.match(problem.safeHtml, /<pre><code class="language-javascript">/);
  assert.match(problem.safeHtml, /&lt;not html&gt;/);
});
