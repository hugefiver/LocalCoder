# LocalCoder Pure-Frontend OJ Rebuild Design

**Date:** 2026-08-24
**Status:** Approved by delegated authority
**Product:** LocalCoder

## 1. Goal

Rebuild LocalCoder into a reliable static web application for local, single-user algorithm practice. The product must browse a versioned problem set, edit and execute code in multiple browser runtimes, judge solutions consistently, retain local drafts/progress/submissions, and deploy without an application backend.

The words “OJ platform” mean a local practice and evaluation workflow. They do not mean a trusted contest service.

## 2. Current Baseline

The repository already has React 19, Vite 7, CodeMirror 6, Markdown problems, Web Workers, Pyodide assets, local draft persistence, and GitHub Pages deployment. The implementation is not a complete OJ:

- each Worker owns its own execution and comparison semantics;
- execution timeout rejects the request but does not always terminate a blocked Worker;
- unavailable Racket, RustPython, and Haskell assets are still exposed by UI controls;
- TypeScript depends on a generated asset that is not currently present;
- solved state is read but never written;
- there is no submission record or storage migration strategy;
- problem frontmatter is permissive and unvalidated;
- browser Worker isolation is presented more strongly than it is;
- automated tests skip missing runtimes and strict type checking currently fails.

## 3. Scope

### Included

- Versioned problem schema and build-time validation.
- A runtime manifest as the only source of language/runtime availability.
- Versioned main-thread/Worker protocol.
- Runtime Registry, Runtime Supervisor, runtime adapters, and OJ Engine.
- Free execution and judged submission flows.
- JavaScript, TypeScript, and Pyodide Python as required runtimes.
- Racket, RustPython, and Haskell as gated runtimes that become selectable only after assets and contract tests pass.
- IndexedDB drafts, custom cases, progress, settings, and bounded submission history.
- Migration from the current `localStorage` keys.
- Responsive, accessible application shell, problem list, problem workspace, executor, and local submission history.
- Static deployment and fail-closed build/runtime checks.
- Automated logic/contract tests plus real-browser verification of user-visible behavior.

### Excluded

- Accounts, authentication, cloud sync, remote APIs, rankings, social features, multiplayer contests, and server-side judging.
- Secret or anti-cheat test cases. Judge cases shipped to a browser are inspectable.
- Authoritative CPU timing, memory limits, or performance comparison across devices.
- A claim that Web Workers safely contain hostile code.
- PWA cold-start offline support. Once the app and selected runtime assets are loaded, execution requires no application API.
- Installing additional software or dependencies without separate explicit user permission.

## 4. Chosen Architecture

### Considered approaches

1. **Patch existing Workers.** Lowest initial effort but preserves duplicated verdict logic, coupled language lists, and fragile lifecycle handling.
2. **Versioned runtime kernel with adapters.** Adds explicit boundaries while allowing each heterogeneous runtime to keep its natural loading mechanism.
3. **WASI-first universal runner.** Attractive ABI uniformity, but JS, TypeScript, Pyodide, Racket, and GHC still require compatibility layers; asset/toolchain cost is disproportionate.

The rebuild uses approach 2.

### Module boundaries

```text
Problem repository ──> Problem schema ──> Practice workspace
                                             │
                                             v
UI ──> Submission service ──> OJ Engine ──> Runtime Adapter
          │                      │                │
          v                      v                v
     Local database        Output comparer   Runtime Supervisor
                                                   │
                                                   v
                                           Versioned Web Worker

Runtime manifest ──> Runtime Registry ─────────────┘
```

- **Problem repository** imports static Markdown and returns validated domain objects.
- **Runtime Registry** joins language metadata with a validated runtime manifest and exposes capability states.
- **Runtime Supervisor** owns Worker creation, initialization, one-task-at-a-time execution, timeout, cancellation, termination, and restart.
- **Runtime Adapter** translates the canonical JSON-function contract into language-specific source wrappers and normalizes runtime output.
- **OJ Engine** validates inputs, invokes the adapter, compares outputs, maps failures to verdicts, and returns a submission result.
- **Local database** is the durable boundary for user-created state; React components do not access IndexedDB directly.

React hooks may consume these services, but core runtime, judging, problem, and storage modules must not import React.

## 5. Language and Runtime Model

Language and runtime are separate concepts.

```text
LanguageId = javascript | typescript | python | racket | haskell

RuntimeId =
  javascript-worker |
  typescript-official |
  python-pyodide |
  python-rustpython |
  racket-wasm |
  haskell-ghc-wasi
```

RustPython is a Python runtime, not a separate programming language. A problem template is keyed by `LanguageId`; a saved draft and submission additionally record `RuntimeId`.

Required runtimes are JavaScript, TypeScript, and Pyodide Python. Their missing assets fail the production readiness check. Optional runtimes are visible in capability information but disabled until all required assets, protocol handshake, smoke execution, and judge contract checks pass.

## 6. Runtime Manifest and Registry

`public/runtime-manifest.json` is generated from actual packaged artifacts. Hand-authored availability booleans are not trusted.

Each entry contains:

```ts
interface RuntimeManifestEntry {
  runtimeId: RuntimeId;
  languageId: LanguageId;
  protocolVersion: 1;
  runtimeVersion: string;
  worker: { url: string; type: "classic" | "module" };
  assets: Array<{ url: string; bytes: number }>;
  required: boolean;
  packaged: boolean;
  unavailableReason?: string;
  reuse: "per-submission" | "session";
  timeouts: { initializeMs: number; executeMs: number };
  limits: { sourceBytes: number; caseCount: number; outputBytes: number };
}
```

The Registry validates the document before use and exposes:

- `not-packaged`: assets are absent; selection is disabled with a reason;
- `loadable`: packaged assets are present but not initialized;
- `initializing`, `ready`, `running`;
- `failed`: load or execution infrastructure failure;
- `incompatible`: manifest/Worker protocol mismatch.

The UI derives all selectors from the Registry. No component owns a copied language list.

## 7. Worker Protocol

Every message includes `protocolVersion`, `requestId`, and `runtimeId`. Unknown protocol versions fail closed.

Requests:

- `initialize`: load assets and return runtime/version capabilities;
- `execute`: run free-form source and return normalized stdout, stderr, value, and error details;
- `judge`: execute a batch of canonical JSON cases and return actual values or case-level failures;
- `dispose`: best-effort cleanup before normal termination.

Responses/events:

- `status`: non-terminal initialization/execution progress;
- `complete`: successful protocol operation, not necessarily an accepted solution;
- `failure`: structured infrastructure, compile, or runtime failure.

Workers never compare expected values. They return actual values and structured errors to the OJ Engine.

Default protocol limits:

- source: 256 KiB;
- test cases per submission: 100;
- combined stdout/stderr per submission: 64 KiB;
- case input/output must be JSON-compatible—no `undefined`, `BigInt`, non-finite numbers, functions, symbols, or cyclic values.

## 8. Runtime Supervisor

The state machine is:

```text
unavailable -> idle -> initializing -> ready -> running -> ready
                            |           |         |
                            +--------> failed <----+
                                         |
                                         v
                                        idle (new Worker on next request)
```

Rules:

- one Worker handles at most one task at a time;
- calls for a session-reused runtime are queued in arrival order;
- JavaScript and TypeScript use a fresh Worker per submission;
- heavy runtimes may remain initialized within the session, but adapters create a fresh namespace/filesystem context for each submission;
- initialization timeout, execution timeout, cancellation, Worker error, malformed response, and fatal runtime failure immediately terminate the Worker;
- all timers, event listeners, queued operations, and pending promises are settled exactly once;
- late messages from a terminated or previous-generation Worker are ignored;
- the next operation after termination creates and handshakes a fresh Worker.

A main-thread timeout is the source of TLE. Browser timing is approximate and is reported as local reference data only.

## 9. Runtime Adapters

All judged problems initially use `json-function-v1`: a named `solution` entrypoint receives one JSON-compatible value and returns one JSON-compatible value.

- **JavaScript**: wraps user source and invokes `solution(input)` in the submission Worker.
- **TypeScript**: transpiles with the packaged official TypeScript compiler, reports transpilation diagnostics as compile errors when they prevent emission, then uses the JavaScript adapter path.
- **Pyodide Python**: converts JSON to Python values, invokes `solution(value)`, and converts the result back through a strict JSON bridge.
- **RustPython**: implements the same Python contract and is enabled only when its WASI artifact passes parity tests with Pyodide for the problem corpus.
- **Racket**: converts JSON through a dedicated bridge and invokes a `solution` procedure; current JavaScript-mode syntax fallback is removed.
- **Haskell**: the adapter owns JSON string conversion for the current `String -> String` runtime ABI so that special handling does not leak into problem definitions.

Free execution is a separate adapter capability. A runtime may support judged problems before it supports a useful REPL-like executor, or vice versa; the manifest reports both capabilities.

## 10. OJ Engine and Verdicts

The OJ Engine is a deterministic, side-effect-light module. Its verdicts are:

- `accepted` (AC);
- `wrong-answer` (WA);
- `compile-error` (CE);
- `runtime-error` (RE);
- `time-limit-exceeded` (TLE);
- `cancelled`;
- `internal-error`;
- `runtime-unavailable`.

Version 1 implements `json-deep-equal`:

- object key order is ignored;
- array order is significant;
- strings are exact;
- numbers are exact finite JSON numbers;
- missing properties differ from properties whose value is `null`.

The result contains the aggregate verdict, local elapsed time, runtime/build identity, public-case details, custom-case details, and a count-only summary for judge cases. Judge cases are hidden from the normal UI but are explicitly documented as inspectable client assets, not secrets.

An accepted judged submission updates progress and stores a submission in one database transaction after execution completes. A “Run” against public/custom cases does not mark the problem solved; “Submit” includes judge cases and can update progress.

## 11. Problem Schema

Problems remain authored as Markdown with frontmatter, upgraded to `schemaVersion: 2`.

Required fields:

```text
schemaVersion: 2
id: positive integer
slug: stable kebab-case string
title: non-empty string
difficulty: Easy | Medium | Hard
summary: non-empty string
entrypoint: solution
contract: json-function-v1
templates: non-empty map keyed by supported LanguageId
tests.public: at least one case
tests.judge: at least one case
```

Optional fields include tags, constraints, examples, and per-problem timeout overrides within platform limits.

Validation happens during tests/build and at runtime as a defensive boundary. Duplicate IDs/slugs, invalid templates, unsupported values, empty test groups, and malformed Markdown fail with a file-specific diagnostic. Raw HTML in Markdown is escaped/disabled before rendering; problem content cannot inject active HTML.

The six current problems are migrated to v2 without changing their intended algorithms.

## 12. Persistence

Use native IndexedDB through one repository layer; no new dependency is required.

Database: `localcoder`, schema version 1.

Object stores:

- `drafts`: key `[workspaceId, languageId, runtimeId]`, source and update time;
- `customCases`: key `problemId`, validated JSON cases;
- `submissions`: auto-increment ID plus problem, source snapshot, runtime/build, verdict, elapsed time, case summary, and timestamp;
- `progress`: key `problemId`, attempts, accepted runtime/language, and accepted time;
- `settings`: selected theme, language/runtime preferences, and layout choices;
- `meta`: migration state and schema information.

Submission history is capped at 200 records. The oldest records are removed in the same transaction that inserts beyond the limit.

Migration reads the existing keys:

- `problem-{id}-language`;
- `problem-{id}-code-{language}`;
- `problem-{id}-custom-tests`;
- `executor-language` and `executor-code-{language}`;
- `solved-problems`.

The migration is idempotent. It marks completion only after a successful transaction and retains old localStorage values for one application schema version. If IndexedDB is unavailable or quota is exceeded, the app continues with in-memory session state and displays a persistent “未保存” status; data loss is never silent.

## 13. Product Surfaces

- **App shell**: product navigation, theme control, storage status, and runtime status access.
- **Home**: concise local progress summary and direct entry to problems or executor; no generic feature-card marketing layout.
- **Problems**: filterable semantic table/list with difficulty, tags, status, accepted language, and last attempt.
- **Problem workspace**: responsive problem/editor/test-results composition, explicit Run and Submit actions, runtime rail, custom cases, and recent submissions.
- **Executor**: free execution with normalized stdout/stderr/value, clear cancellation, and capability-aware runtime selection.
- **Submissions**: local bounded history with verdict, problem, language/runtime, elapsed time, and source inspection.
- **Runtime details**: packaged/ready/failed status and honest unavailable reasons.

All routes support light/dark themes, 375/768/1280px widths, keyboard navigation, visible focus, reduced motion, and stable loading/error/empty states. Visual rules are defined in `/DESIGN.md`.

## 14. Security and Trust Boundary

- Web Workers protect main-thread responsiveness and provide a termination boundary; they are not a secure sandbox.
- User JavaScript can reach APIs available in its Worker, including same-origin network/storage APIs. The application must not store credentials or secrets that user code is expected not to access.
- Client-shipped judge cases are inspectable and cannot provide anti-cheat guarantees.
- Browser memory cannot be reliably limited per runtime; MLE is not emitted.
- Output and source size limits reduce accidental abuse but are not a hostile-code defense.
- Runtime and UI copy must use “local execution isolation” and avoid claims of secure sandboxing or trusted competition.

## 15. Error Handling

- Manifest/schema failures identify the offending runtime or problem and disable only the affected optional capability; required runtime failure blocks production readiness.
- Runtime initialization and execution errors produce structured codes plus a user-actionable message.
- Cancellation is a normal terminal outcome, not a toast-level failure.
- Storage failures preserve in-memory work and show a persistent save-state warning.
- Error boundaries use LocalCoder-specific recovery copy and preserve navigation to a safe route.
- Logs are bounded and truncation is explicit.

## 16. Test and Verification Strategy

Use the existing toolchain where possible: Node's built-in test runner, TypeScript, ESLint, Vite, and browser-accessible runtime harnesses. No missing runtime may be reported as a passing skipped test.

Automated suites cover:

- protocol and runtime-manifest validation;
- canonical JSON validation and deep comparison;
- problem schema and all six migrated problem files;
- Registry capability derivation;
- Supervisor initialization, serialization, timeout, cancellation, late messages, failure cleanup, and restart;
- OJ verdict mapping for AC, WA, CE, RE, TLE, cancelled, unavailable, and internal failures;
- IndexedDB repository behavior and localStorage migration using test doubles;
- required runtime asset checks and Worker contract harnesses;
- strict type checking, linting, production build, and smoke checks.

Real-surface acceptance scenarios:

1. JavaScript, TypeScript, and Pyodide Python each produce AC and WA on the same problem contract.
2. Syntax/runtime failures map to CE/RE without breaking the next submission.
3. An infinite loop reaches TLE, the Worker is terminated, and a subsequent valid submission succeeds.
4. Run uses public/custom cases without changing solved state; Submit includes judge cases and accepted results update progress.
5. Refresh restores drafts, custom cases, settings, progress, and local submissions.
6. Unavailable optional runtimes are disabled with a specific reason and are never advertised as ready.
7. The executor runs without an application API after its static assets and selected runtime are loaded.
8. 375px, 768px, and 1280px layouts have no horizontal document overflow; keyboard, focus, loading, empty, error, and reduced-motion states work.

## 17. Migration Sequence

1. Establish strict type/build/test baseline and remove unused broken UI surface that prevents type checking.
2. Add shared domain types, protocol, schema validators, manifest model, comparer, and tests.
3. Implement Registry and Supervisor with fake-Worker tests.
4. Migrate JavaScript, TypeScript, and Pyodide Workers to protocol v1 and prove runtime contracts.
5. Implement OJ Engine and migrate six problems to schema v2.
6. Implement IndexedDB repositories and idempotent legacy migration.
7. Create the design-system-backed app shell and migrate problem, workspace, executor, and submission surfaces.
8. Gate and migrate Racket, RustPython, and Haskell one at a time; enable only after artifacts and contracts pass.
9. Delete old Worker protocol, duplicated language lists, and obsolete localStorage access after all consumers move.
10. Run strict checks, production/browser QA, and final independent acceptance review.

## 18. Completion Criteria

The rebuild is complete only when:

- required runtime assets and contracts pass without skips;
- all six current problems validate under schema v2;
- required-language AC/WA/error/TLE/restart scenarios pass;
- progress and local submission history form a complete Run/Submit/restore loop;
- optional runtimes are either fully verified and enabled or explicitly unavailable with truthful reasons;
- strict type checking, lint, tests, smoke checks, and production build pass;
- real-browser responsive and accessibility checks pass on the rebuilt routes;
- documentation no longer claims hidden tests, strong sandboxing, or unavailable runtime support;
- final implementation review gives unconditional approval for the current working-tree identity.
