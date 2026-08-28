# PROJECT KNOWLEDGE BASE

**Generated:** 2026-08-28
**Baseline commit:** `c434655`
**Branch:** `master`

## OVERVIEW

LocalCoder is a static React/Vite browser application for single-user algorithm practice. It runs and judges code locally through versioned Workers; it has no backend, accounts, remote runner, secret tests, or trusted contest boundary.

## SOURCE OF TRUTH

| Concern | Authority |
|---|---|
| Product limits and setup | `README.md` |
| Visual and interaction rules | `DESIGN.md`, then actual tokens in `src/styles/` |
| Runtime architecture | `docs/architecture/runtime-kernel.md` |
| Assets, receipts, and capability states | `docs/operations/runtime-assets.md` |
| Current runtime packaging | generated `public/runtime-manifest.json` |
| Current acceptance evidence | `docs/qa/2026-08-24-localcoder-rebuild-results.md`, `artifacts/qa/task23/` |

The generated manifest overrides prose when packaged assets change. `packaged` does not mean an optional runtime is verified or selectable.

## STRUCTURE

```text
src/app, pages, features/  React shell, routes, and product workflows
src/runtime, workers/      Manifest, Registry, Supervisor, adapters, Worker hosts
src/oj, storage, problems/ Main-thread judging, persistence, static corpus
scripts/                   Asset staging, Worker identity, manifest, checks, builds
tests/                     Node test suites mirroring production boundaries
runtimes/                  External Haskell/Racket/RustPython build inputs
public/                    Deployable/generated runtime assets
docs/                      Architecture, operations, QA, and approved design/plan
```

Read the nearest child `AGENTS.md` before changing a specialized subtree.

## WHERE TO LOOK

| Task | Location | Notes |
|---|---|---|
| App boot and routes | `src/main.tsx`, `src/App.tsx`, `src/app/` | Pages uses HashRouter; other builds use BrowserRouter |
| Composition root | `src/services/app-services.ts` | Constructs problems, runtime kernel, OJ, storage, submissions |
| Problem workspace | `src/features/problems/` | Run/Submit, drafts, custom cases, responsive panels |
| Free executor | `src/features/executor/` | Adapter `execute` only; no OJ verdict or submission |
| Runtime availability | `src/runtime/registry.ts`, `src/runtime/optional-verification.ts` | Optional execution is gated by verification |
| Worker protocol | `src/runtime/protocol.ts`, `src/workers/shared/endpoint.ts` | Strict envelopes and bounded output |
| Verdicts | `src/oj/` | Expected values, comparison, and AC/WA live only here |
| Persistence | `src/storage/`, `src/services/submission-service.ts` | IndexedDB first, explicit memory fallback |
| Runtime asset build | `scripts/build-worker-assets.mjs`, `scripts/lib/worker-build-*` | Identity binds plan, import closure, toolchain, runtime assets |
| CI/CD | `.github/workflows/` | Node 24, pnpm 12, Git LFS, Pages deployment |

## CODE MAP

LSP/codegraph centrality is unmeasured in this environment; entries below are traced from imports and call sites.

| Symbol | Location | Role |
|---|---|---|
| `createAppServices` | `src/services/app-services.ts` | Non-React composition root |
| `RuntimeRegistry` | `src/runtime/registry.ts` | Immutable capabilities, state, execution eligibility |
| `RuntimeSupervisor` | `src/runtime/supervisor.ts` | FIFO operations, Worker lifecycle, timeout/cancel/recovery |
| `OptionalRuntimeVerifier` | `src/runtime/optional-verification.ts` | Opaque verification session and runtime contract checks |
| `createWorkerEndpoint` | `src/workers/shared/endpoint.ts` | Common Worker protocol boundary |
| `OjEngine` | `src/oj/engine.ts` | Case selection, adapter judge, central result aggregation |
| `SubmissionService` | `src/services/submission-service.ts` | Separates side-effect-free Run from persisted Submit |
| `LocalCoderRepository` | `src/storage/repository.ts` | Validated IndexedDB/memory persistence facade |
| `buildWorkerAssets` | `scripts/build-worker-assets.mjs` | Deterministic Worker bundles and build IDs |

## CONVENTIONS

- Package manager is pnpm 12 only. Keep `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml` synchronized; use `pnpm install --frozen-lockfile` for reproducible installs.
- TypeScript remains strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and related flags). Source ESM relative imports commonly use `.js`; `@/` aliases target `src/`.
- ESLint permits zero warnings. Do not hide errors with broad disables, `any`, unchecked casts, or `--noCheck`.
- Route pages stay lazy-loaded through `PageRoute`; do not suspend or replace the persistent `AppShell` while a page chunk loads.
- UI uses semantic CSS tokens and the workbench rules in `DESIGN.md`: no gradients, hover lift, raw status colors, `100vh`, `h-screen`, or color-only status.
- Runtime selectors derive from Registry snapshots. Do not copy runtime ID arrays into UI code.
- Generated Workers, compiler/Pyodide assets, runtime metadata, and manifest are regenerated from their declared sources; never patch generated output as the source fix.

## ANTI-PATTERNS

- Never describe Web Workers as a secure sandbox, browser judge cases as secret, or device timing as authoritative. There is no MLE verdict.
- Never send expected values, passed flags, or verdicts to a Worker. Workers return actual values or structured failures; the main-thread OJ owns comparison.
- Never enable an optional runtime because assets are merely present. `LOADABLE_UNVERIFIED` and `UNAVAILABLE` remain disabled; only current verification can produce `VERIFIED`.
- Never infer runtime/build identity from manifest prose. Use the protocol-validated Worker handshake for that generation.
- Never read progress outside the atomic submission transaction, present memory fallback as saved, or use `localStorage` for current persistence.
- Never run two `pnpm test` commands concurrently in one worktree: both own and delete `.test-dist`.
- Never omit Git LFS checkout when validating packaged Haskell assets; pointer files must not pass non-empty asset checks.

## COMMANDS

```powershell
pnpm install --frozen-lockfile
pnpm run dev
pnpm run typecheck
pnpm run lint
pnpm test
pnpm test -- tests/runtime/supervisor.test.ts
pnpm run runtime:manifest
pnpm run runtime:check
pnpm run runtime:report
pnpm run build
pnpm run smoke
pnpm run identity
```

`pnpm run build:runtimes` is separate and may require external GHC/Racket/Emscripten/Rust toolchains. A normal app build consumes the runtime assets already present under `public/`.

## TEST AND QA NOTES

- `pnpm test` uses Node's test runner. TypeScript tests compile into `.test-dist`; focused paths still compile the configured TypeScript test graph.
- Node tests do not replace browser QA. Worker/runtime, IndexedDB, CodeMirror, focus, responsive UI, Pages base paths, or offline-session changes require real browser evidence using the harnesses and `docs/qa/localcoder-browser-acceptance.md`.
- Browser debugging/QA launches the browser via CDP (`--remote-debugging-port` on loopback) with a throwaway `--user-data-dir` profile under the OS temp area: no extensions, no signed-in accounts, no settings sync, never the default profile. Launch the browser and any dev/preview server as detached background processes with output redirected to log files so the shell tool is never blocked. Terminate only the processes/ports the QA run started and delete its temp profile afterward.
- Optional runtime exit code `2` means unavailable or loadable-unverified, not pass. Exit `0` requires a current browser receipt; exit `1` is broken.
- Required runtime or identity input changes require regenerated Workers/manifest and refreshed handshake evidence.

## NOTES

- Required runtimes are JavaScript, official TypeScript, and Pyodide Python. At this baseline RustPython and Racket are unavailable; Haskell assets are packaged but remain loadable-unverified and disabled.
- `public/runtime-manifest.json` and the QA report can change generated identities; avoid hard-coding transient build IDs in maintenance prose.
- Worktree identity intentionally excludes only top-level `dist`, `.test-dist`, `node_modules`, `.git`, and `artifacts`.
- Current CI deploys GitHub Pages from `master`; the workflow prepares TypeScript/Pyodide before Worker identity analysis and checks manifest/readiness/smoke before deployment.
