# LocalCoder Rebuild, Task 23 QA Results

## Release-evidence verdict

**PASS for the current working-tree release handoff.** Required build, test, runtime, storage, browser, accessibility, Pages, and claim-boundary checks passed. Optional runtimes are recorded as **UNAVAILABLE**, not as passing execution support. The source evidence is [`artifacts/qa/task23/runtime-results.json`](../../artifacts/qa/task23/runtime-results.json), [`artifacts/qa/task23/storage-results.json`](../../artifacts/qa/task23/storage-results.json), and [`artifacts/qa/task23/ui-results.json`](../../artifacts/qa/task23/ui-results.json). The acceptance criteria are defined by [`docs/qa/localcoder-browser-acceptance.md`](localcoder-browser-acceptance.md).

## Command and distribution evidence

| Check | Result | Evidence |
|---|---|---|
| `pnpm run typecheck` | PASS | Exit 0. |
| `pnpm run lint` | PASS | Exit 0 with zero lint warnings. |
| `pnpm test` | PASS | 270 of 270 tests passed, including GitHub Actions runtime-input ordering, release pinning, and esbuild platform-resolution regressions. |
| `pnpm run runtime:manifest` and `pnpm run runtime:check` | PASS | Required manifest and readiness checks passed. |
| Default build | PASS | `pnpm run build` and downstream verification reported 270 of 270, including readiness and smoke checks. |
| GitHub Pages build | PASS | `GITHUB_PAGES` `pnpm run build` and smoke reported 270 of 270 after rebuilding TypeScript and Pyodide inputs before Worker identities. |

The build emitted three nonblocking tool warnings: `gray-matter` dependency evaluation, Node `DEP0205` for `module.register`, and Node test support for `localStorage` marked experimental. They did not change exit status, test results, readiness, smoke, or browser verdicts.

The authoritative pre-merge Pages recheck is `pagesBuildPlanClosureRecheck` in `artifacts/qa/task23/ui-results.json`. It verified 28 dist assets, including all 8 required runtime assets. It directly loaded `#/`, `#/problems`, `#/problems/1`, `#/executor`, and `#/submissions`; all five reached their expected surface with one `main`, `lang="zh-CN"`, no root horizontal overflow, zero console errors, and zero page exceptions. `dist/index.html` and `dist/404.html` used relative build-authored asset references, matching chunks, and served successfully. The root `runtime-manifest.json` declared every required asset. Required JavaScript and TypeScript runtime assets, plus exactly these five Pyodide assets, returned 200 with manifest-matching bytes: `pyodide.js`, `pyodide.asm.js`, `pyodide.asm.wasm`, `python_stdlib.zip`, and `pyodide-lock.json`. The pnpm migration and remote dependency merge regenerate platform-specific identities; the pushed GitHub Actions run is the authoritative distribution check for that merged tree.

## Required runtime browser matrix

At `/problems/1`, every required runtime completed the full sequence **AC, WA, AC, CE, AC, RE, AC, TLE, AC**. Source text was verified before each submission, and the post-TLE result recovered to AC with the corresponding runtime identity.

| Runtime | Handshake identity | Result |
|---|---|---|
| JavaScript, `javascript-worker` | `javascript-es2020` / `32c927a7995bc8b8` | PASS |
| TypeScript, `typescript-official` | `5.9.3` / `32c927a7995bc8b8` | PASS, including CE identity retention |
| Python, `python-pyodide` | `0.29.1` / `c0af25cee696df69` | PASS |

The refreshed full matrix observed TLE termination and recovery for all three runtimes. A refreshed warm Pyodide session was then switched offline without reload and returned AC. Navigation entries remained at one, network events during the offline step were empty, and no application request occurred. This verifies warm-session execution after assets are loaded, not cold-start offline support.

Screenshots: `artifacts/qa/task23/runtime-javascript-worker.png`, `artifacts/qa/task23/runtime-typescript-official.png`, `artifacts/qa/task23/runtime-python-pyodide.png`, and `artifacts/qa/task23/runtime-python-pyodide-offline.png`.

## Storage, migration, and persistence

The six legacy families, `problem-<id>-language`, `problem-<id>-code-<language>`, `problem-<id>-custom-tests`, `executor-language`, `executor-code-<language>`, and `solved-problems`, migrated once. The first migration imported five records; the second returned `already-migrated` with zero imports. Old keys remained during the retention period. All six stores were observed: `drafts`, `customCases`, `submissions`, `progress`, `settings`, and `meta`.

Run returned AC with zero changes to submissions or progress. An AC Submit created exactly one atomic submission and progress write, preserving language `javascript` and runtime `javascript-worker`. History filtering, exact source snapshot, count-only judge summary, and reload restoration passed. The repository retained exactly 200 submissions after 205 harness inserts, trimming the oldest record and retaining the newest. Refreshed native IndexedDB concurrency evidence used the current JavaScript identity across two pages and four submissions in two rounds with reversed commit order. The attempt count reached four, all four submissions were retained, and the final WA preserved the earlier AC accepted metadata. `storage-results.json` records this as `current.concurrentSubmissions: PASS`.

With IndexedDB disabled at document creation, session work continued with the persistent `未保存` indicator on workspace and history. The exact source was retained, Submit returned AC, and session history had exactly one row.

Screenshots: `artifacts/qa/task23/storage-migration.png`, `artifacts/qa/task23/storage-run.png`, `artifacts/qa/task23/storage-history.png`, `artifacts/qa/task23/storage-reload.png`, `artifacts/qa/task23/storage-memory.png`, and `artifacts/qa/task23/storage-concurrent.png`.

## UI, interaction, and accessibility

The six surfaces, Home, Problems, Problem Workspace, Executor, Submissions, and Runtime Details, passed at 375px, 768px, and 1280px in light and dark themes: 36 combinations. Every checked surface had `lang="zh-CN"`, one `main`, no duplicate IDs, no labelled-by issue, no root horizontal overflow, and no blocking clipping.

The nine affected light-theme combinations for Home, Problem Workspace, and Executor were rechecked after the contrast repair. They passed, with the lowest observed browser contrast at **4.5779**, above the 4.5 requirement. Keyboard-only navigation, visible tokenized focus, skip link, row activation, dialog focus trap and restoration, tabs, resizer alternatives, CodeMirror entry and escape, reduced-motion state parity, and scoped live regions all passed. The runtime live-region sequence included `loadable`, `initializing`, `running`, and `ready` without consecutive duplicate announcements.

Representative screenshots: `artifacts/qa/task23/ui-home-375-light.png`, `artifacts/qa/task23/ui-problems-768-dark.png`, `artifacts/qa/task23/ui-workspace-1280-light.png`, `artifacts/qa/task23/ui-executor-375-dark.png`, `artifacts/qa/task23/ui-submissions-768-light.png`, `artifacts/qa/task23/ui-runtime-details-1280-dark.png`, `artifacts/qa/task23/ui-workspace-768-dark-reduced-motion.png`, and `artifacts/qa/task23/ui-pages-current.png`.

The final console-clean recheck covered Home, Problem Workspace, Executor, and Runtime Details, including a JavaScript operation. It recorded zero warnings, zero errors, zero page exceptions, zero uncontrolled-to-controlled Select warnings, zero illegal transitions, and zero favicon requests or 404s. That result supersedes the earlier Select and favicon console observations.

## Optional runtime truth table

| Runtime | Product state | Exact unavailable reason | Execution evidence |
|---|---|---|---|
| `python-rustpython` | UNAVAILABLE, selector disabled | Missing asset groups: one of `rustpython/runner.wasm.gz` or `rustpython/runner.wasm` | Handshake, smoke, judge, and six-problem parity were not run. No verified receipt exists. |
| `racket-wasm` | UNAVAILABLE, selector disabled | Missing asset groups: `racket/racket.js`; one of `racket/racket.wasm.gz` or `racket/racket.wasm` | Handshake, smoke, and judge were not run. No verified receipt exists. |
| `haskell-ghc-wasi` | LOADABLE_UNVERIFIED, selector disabled | No matching current verification receipt | Packaged assets are present, but handshake, smoke, and judge are not counted as passed. No verified receipt exists. |

These disabled states are acceptable product truth, but they are not runtime test passes.

## Task 23 blockers resolved and superseded evidence

Task 23 found and repaired the document language and main landmark contract, duplicate IDs, the initializing status transition, light-theme contrast, post-handshake identity retention for nonfatal errors, controlled Select state, and favicon handling. The final review also resolved three blockers: the optional-runtime verification gate is orthogonal (`not-required`, `unverified`, or `verified`) and prohibits execution before verification; submissions pass attempt deltas into one storage transaction so concurrent writes do not lose attempts, submissions, or accepted metadata; and Worker identity now binds the canonical effective esbuild build plan, including entrypoint, bundle, format, platform, target, legal comments, node paths, and sentinel define contract, together with actual metafile-resolved import-closure bytes and the toolchain and runtime assets. It does not hash emitted output, the manifest, or `dist`. For every present runtime-loadable variant in a one-of asset group, the manifest declares it, Worker identity hashes it, readiness byte-checks it, and the receipt digest binds it. No variant retains a single stable missing sentinel. Racket, RustPython, and Haskell continue to support gzip-to-raw fallback, but cannot execute an undeclared or unhashed variant. The README now points to the generated manifest and current QA evidence instead of hardcoding identities. The fail-closed Pyodide allowlist repair removed stale console HTML and CDN entrypoints, the smoke check rejects undeclared Pyodide files, and all three runtime READMEs now use pnpm with the current RustPython protocol.

Older debug and driver evidence is retained for traceability but is not release evidence. The earlier `initializing -> initializing` exception and light contrast blockers are superseded by the focused recheck. The older `keyboard.type` CE observation in storage is superseded as a driver defect: character-by-character input triggered CodeMirror auto-closing braces. The accepted rechecks use focused CDP `Input.insertText` and verify exact CodeMirror text before execution. The prior Pages recheck field, prior required-runtime identities, rejected identities and receipts, and earlier evidence are historical and superseded. They are not authoritative release evidence and no review-session identifier is published here.

## Truth boundary and cleanup

The release does not claim a secure sandbox, secret tests, authoritative time or memory measurement, MLE, a backend, an application API, accounts, cloud services, or cold-start offline operation. Workers provide local execution isolation and a termination boundary, not hostile-code containment. Browser-shipped judge assets remain inspectable. Local elapsed time is reference data only, and memory is not authoritatively bounded.

Cleanup completed: temporary loopback servers, browser profiles, drivers, and debug journals were removed. The public dist no longer publishes console HTML. QA artifacts were retained under `artifacts/qa/task23/`.

## Working-tree identity handoff

The authoritative working-tree digest and file count will be generated after this report is updated. No earlier working-tree identity value is authoritative. The artifact directory is excluded from that digest, so this report is included in the identified working tree without making the generated identity artifact self-referential.

*Author's note: Written as the release-evidence handoff for the Task 23 working-tree identity.*
