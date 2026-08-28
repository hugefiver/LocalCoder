# LocalCoder Browser Acceptance

This is the Task 23 acceptance plan. It records what must be checked and how to record it. It is not a QA results document and makes no claim that a command, browser flow, or optional runtime has passed.

## Automated matrix

Run every command separately in PowerShell. Record the command, exit code, test count where applicable, and concise output in the Task 23 results artifact.

```powershell
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run runtime:manifest
pnpm run runtime:check
pnpm run build
pnpm run smoke
node scripts/report-runtime-capabilities.mjs
```

Expected command outcomes: typecheck, lint, tests, build, and smoke exit `0`; lint has zero warnings; required runtime checks have no skips. Record optional states exactly as observed. `UNAVAILABLE` is a disabled state, not a test pass, and `BROKEN` stops acceptance.

Build the Pages variant in a separate PowerShell process:

```powershell
$env:GITHUB_PAGES = "true"
$env:VITE_GITHUB_PAGES = "true"
pnpm run build
pnpm run smoke
```

Verify `./` asset paths, `404.html`, HashRouter direct-route loading, and required manifest URLs. Do not use Bash `export` syntax.

## Browser launch rules

All browser debugging and QA runs drive a real browser through CDP, never a signed-in desktop browser:

- Launch with `--remote-debugging-port=<port>` bound to loopback plus a throwaway `--user-data-dir` under the OS temp area.
- Launch the browser and any dev/preview server as detached background processes with output redirected to log files; never run them as foreground shell commands that block the terminal tool.
- Never use the default browser profile: no extensions, no signed-in accounts, no settings sync. Disable first-run and background-networking flags.
- Terminate only the processes and ports the QA run started, verified by exact command line, then delete the temp profile directory.

## Required runtime browser matrix

Start the local server with `pnpm run dev -- --host 127.0.0.1 --port 4173`. For each required runtime, `javascript-worker`, `typescript-official`, and `python-pyodide`, run the same problem contract and record route, runtime/build identity, visible verdict, console and network evidence, and recovery outcome.

| Scenario | JavaScript | TypeScript | Pyodide Python |
|---|---|---|---|
| Correct source returns AC | Required | Required | Required |
| Incorrect source returns WA | Required | Required | Required |
| Syntax source returns CE where applicable | Required | Required | Required |
| Thrown or runtime failure returns RE | Required | Required | Required |
| Infinite loop returns TLE and terminates the Worker | Required | Required | Required |
| Valid source immediately after each failure returns success with a fresh or recovered identity | Required | Required | Required |

No required language can be skipped. Record the handshake identity beside every scenario. A post-handshake error retains the identity from that handshake. A failure before handshake must not be attributed to a fabricated identity.

## Migration, persistence, and Run/Submit matrix

Use a fresh browser profile or context.

1. Seed every legacy key family, boot the app, verify the one-time idempotent migration, and confirm legacy values remain for the defined one-schema-version retention period.
2. Save drafts under more than one runtime ID, add custom cases, and change theme and layout preferences.
3. Use Run and prove solved/progress state does not change.
4. Submit an AC result and prove exactly one atomic submission and progress write, including language, runtime, and runtime/build identity.
5. Create non-AC records, filter history, and inspect source snapshots.
6. Reload and verify drafts, custom cases, settings, progress, and history restore.
7. Use `storage-harness.html` repository calls to create more than 200 submissions and prove the oldest records are removed in the insertion transaction.
8. Force IndexedDB or quota failure. Confirm session work continues and a persistent `未保存` indicator appears.

Inspect the six IndexedDB stores, `drafts`, `customCases`, `submissions`, `progress`, `settings`, and `meta`. Do not expose judge-case values in evidence beyond permitted count summaries.

## Optional runtime truth table

Choose exactly one observed branch per runtime. Do not state that an unavailable runtime passed.

| runtimeId | assets | handshake | smoke | judge | parity | product state | evidence |
|---|---|---|---|---|---|---|---|
| `racket-wasm` | Record observed state | Record result or not run reason | Record result or not run reason | Record result or not run reason | Not applicable | `VERIFIED`, `LOADABLE_UNVERIFIED`, `UNAVAILABLE`, or `BROKEN` | Receipt, UI state, or exact asset reason |
| `python-rustpython` | Record observed state | Record result or not run reason | Record result or not run reason | Record result or not run reason | Six-problem Pyodide parity result or not run reason | `VERIFIED`, `LOADABLE_UNVERIFIED`, `UNAVAILABLE`, or `BROKEN` | Receipt, UI state, or exact asset reason |
| `haskell-ghc-wasi` | Record observed state | Record result or not run reason | Record result or not run reason | Record result or not run reason | Not applicable | `VERIFIED`, `LOADABLE_UNVERIFIED`, `UNAVAILABLE`, or `BROKEN` | Receipt, UI state, or exact asset reason |

`VERIFIED` requires assets, handshake, smoke, judge contract, a matching receipt, an enabled selector, and a successful user flow. RustPython also requires six-problem Pyodide parity. `LOADABLE_UNVERIFIED` means packaged assets without at least one required current receipt check and keeps the selector disabled. `UNAVAILABLE` gives the concrete missing-asset or unverified reason and keeps the selector disabled. `BROKEN` is a blocker and must return to the owning task.

## Surface, interaction, and accessibility matrix

Check Home, Problems, Problem Workspace, Executor, Submissions, and Runtime Details at 375px, 768px, and 1280px in both light and dark themes. At every viewport, assert `document.documentElement.scrollWidth === document.documentElement.clientWidth`.

For every surface, test horizontal overflow, keyboard-only traversal, visible focus, dialog focus trap and restoration, row activation, resizer alternatives, and CodeMirror focus entry and escape. Emulate `prefers-reduced-motion: reduce` and verify essential state remains visible. Check loading, error, empty, populated, unsaved, unavailable, and cancelled states for stable dimensions.

Review contrast and the accessibility tree for WCAG 2.2 AA blockers. Verify runtime and verdict changes have scoped live regions without repeated-log spam. Any unapproved accessibility exception blocks acceptance.

## Static boundary and claim audit

After the app and selected runtime assets load, take the browser context offline without reloading and execute again. Confirm the active session needs no application API. This is not a claim of cold-start offline support.

Audit README, architecture and operations docs, UI copy, and runtime details for forbidden claims: secure sandbox, hidden or secret tests, authoritative timing or memory, MLE, trusted contest, cloud or API dependency, localStorage as the current persistence architecture, unavailable runtime support, or optional execution reported as passed. Confirm the documentation explains Worker access limits and that judge assets shipped to a browser are inspectable.

## Completion, cleanup, and exact-identity review

For an observed defect, first add or strengthen the smallest owning regression, reproduce it, fix it, then rerun its focused suite and affected downstream checks. Do not broaden scope or install tools. Recheck only evidence invalidated by changed inputs.

Write Task 23 command and browser evidence to `docs/qa/2026-08-24-localcoder-rebuild-results.md` only after QA. Then run `node scripts/working-tree-identity.mjs` and record the resulting SHA-256 digest and file count from `artifacts/qa/working-tree-identity.json`. The final independent review must receive the approved spec and plan, QA results, exact current identity, capability table, and command outputs. Conditional approval, stale identity, partial review, timeout, or an unresolved finding is not completion.

*Author's note: Written for the final browser QA owner, with the expectation that every result is tied to a runtime state and one exact tested tree.*
