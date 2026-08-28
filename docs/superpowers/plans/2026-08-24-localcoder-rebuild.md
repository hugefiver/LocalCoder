# LocalCoder Pure-Frontend OJ Rebuild Implementation Plan

> **For agentic workers:** Use the subagent-driven-development skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 LocalCoder 重构为一个无应用后端、可诚实报告浏览器运行时能力、可稳定判题并持久保存本地练习状态的静态单用户 OJ。

**Architecture:** 以版本化题目 schema、运行时 manifest 和 Worker protocol 为边界，主线程中的 Registry、Supervisor、runtime adapters 与 OJ Engine 统一生命周期和判题语义；React 只通过 service/hook 层消费这些无 React 的核心模块。用户状态通过一个原生 IndexedDB repository 持久化，并在不可用时显式降级到内存；所有可选运行时先保持门控，只有资产、握手、冒烟和判题契约全部通过后才可选择。

**Tech Stack:** React 19、Vite 7、TypeScript 5.9 strict mode、Zod 4、CodeMirror 6、Web Workers、Pyodide 0.29、原生 IndexedDB、Node.js 内置 test runner、ESLint 9、现有 esbuild、Radix/shadcn、GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-08-24-localcoder-rebuild-design.md`（实现问题的唯一 source of truth；视觉实现同时受 `/DESIGN.md` 约束）

**Global Constraints:**
- “OJ platform” means a local practice and evaluation workflow. It does not mean a trusted contest service.
- Required runtimes are JavaScript, TypeScript, and Pyodide Python. Their missing assets fail the production readiness check.
- Optional runtimes are visible in capability information but disabled until all required assets, protocol handshake, smoke execution, and judge contract checks pass.
- Every message includes `protocolVersion`, `requestId`, and `runtimeId`. Unknown protocol versions fail closed.
- Default protocol limits are source 256 KiB, at most 100 cases per submission, and combined stdout/stderr 64 KiB.
- Case input/output must be JSON-compatible: no `undefined`, `BigInt`, non-finite numbers, functions, symbols, or cyclic values.
- Workers never compare expected values. They return actual values and structured errors to the OJ Engine.
- JavaScript and TypeScript use a fresh Worker per submission; session runtimes still create a fresh namespace/filesystem context per submission.
- A main-thread timeout is the source of TLE; elapsed time is local reference data only and MLE is never emitted.
- Use native IndexedDB through one repository layer; no new dependency is required.
- Submission history is capped at 200 records, with overflow deletion in the insertion transaction.
- Legacy migration is idempotent, retains old `localStorage` values for one application schema version, and marks completion only after its transaction succeeds.
- If IndexedDB is unavailable or quota is exceeded, continue with in-memory session state and show persistent `未保存`; data loss is never silent.
- Web Workers are “local execution isolation”, not a secure sandbox; never claim hidden tests, trusted competition, hostile-code containment, or authoritative resource limits.
- Raw HTML in problem Markdown is escaped/disabled before rendering.
- No missing runtime may be reported as a passing skipped test.
- All rebuilt routes meet `/DESIGN.md`: light/dark, 375/768/1280px, keyboard navigation, visible focus, reduced motion, stable loading/error/empty states, WCAG 2.2 AA, and no unapproved accessibility debt.
- User-facing actions, statuses, errors, and recovery copy use consistent Simplified Chinese; language/runtime names, code, IDs, and protocol terms retain their canonical spelling.
- No accounts, authentication, cloud sync, remote API, rankings, social features, multiplayer contests, server judging, anti-cheat, PWA cold-start support, or secrets enter scope.
- Do not add or install dependencies/software. Use only checked-in code and packages already present in `package.json`/lockfiles.
- Local and agent-run commands assume Windows PowerShell. Invoke only existing `npm`, `node`, or local binaries through `npx`; never use Bash syntax or command chaining.
- Keep production files focused: avoid a single file above about 250 non-generated LOC and a function above about 50 LOC; split by responsibility before crossing those limits.
- Each task's Git step is only a prepared file list and suggested semantic message. An actual `git commit`, push, tag, or other Git write requires separate user authorization and must not be executed by this plan.

---

## Delivery order and test discipline

Execute Tasks 1–23 in order. Every behavior task follows RED → GREEN → focused regression → real surface. A task is complete only when its focused test proves the behavior and its stated real-surface check is recorded; a skipped or unavailable runtime is never renamed “pass.” If a later task changes an earlier interface, update the producing task's tests and rerun all consumers before continuing.

The test runner introduced in Task 1 compiles selected TypeScript into the exact temporary directory `.test-dist/`, discovers explicit test paths, and invokes Node's built-in test runner. It accepts focused paths, for example:

```powershell
npm test -- tests/runtime/supervisor.test.ts
```

No task may invoke `npx` in a way that downloads a missing package. `npx tsc`, `npx eslint`, and `npx vite` are permitted only because those tools already exist in this repository.

All modules executed by Node tests—core modules and pure UI view models—use relative ESM imports ending in `.js`; Vite resolves those imports to TypeScript sources. Browser-only `import.meta.glob`, Worker constructors, DOM boot, and CSS imports live in thin adapters not evaluated by Node tests.

## File structure map

```text
src/
├── domain/
│   ├── json-value.ts              # Canonical JSON validation and byte limits
│   ├── language.ts                # LanguageId/RuntimeId and immutable display metadata
│   ├── problem.ts                 # Validated Problem/TestCase domain objects
│   └── submission.ts              # Verdicts, results, persistence records
├── problems/
│   ├── problem-schema.ts          # Zod v2 frontmatter/document boundary
│   ├── problem-repository.ts      # import.meta.glob -> validated/safe Problem objects
│   └── 001…006-*.md               # Six migrated v2 problems
├── runtime/
│   ├── protocol.ts                # Protocol v1 request/response schemas
│   ├── manifest.ts                # Manifest schema and parser
│   ├── registry.ts                # Capability derivation and lifecycle state store
│   ├── supervisor.ts              # Queue, generation, timers, terminate/restart
│   ├── worker-port.ts             # Browser Worker abstraction
│   ├── adapters/                  # Main-thread canonical contract adapters
│   └── optional-verification.ts   # verified/unavailable/broken classification
├── workers/
│   ├── shared/                    # Protocol endpoint, output limiter, error normalization
│   ├── javascript/                # JS execution and official TypeScript transpilation
│   ├── python/                    # Pyodide bridge and namespace reset
│   ├── racket/                    # Racket JSON bridge and Emscripten host
│   ├── rustpython/                # RustPython WASI host bridge
│   ├── haskell/                   # GHC assets, virtual FS, bridge, WASI execution
│   └── *.worker.ts                # Small generated-worker entrypoints
├── oj/
│   ├── comparer.ts                # json-deep-equal v1 only
│   ├── engine.ts                  # Limits, invocation, verdict mapping, safe result shape
│   └── case-selection.ts          # Run vs Submit case visibility
├── storage/
│   ├── schema.ts                  # DB/store names and persisted record schemas
│   ├── driver.ts                  # Transaction interface used by repositories/tests
│   ├── indexeddb-driver.ts        # Native IDB implementation and upgrade
│   ├── memory-driver.ts           # Explicit session-only fallback/test double
│   ├── repository.ts              # Draft/custom/settings/progress/submission API
│   └── legacy-migration.ts        # Idempotent old-key import
├── services/
│   ├── submission-service.ts      # Engine + atomic accepted progress/submission write
│   └── app-services.ts            # Non-React composition root
├── app/
│   ├── AppProviders.tsx           # React contexts around services
│   └── routes.tsx                 # Product route table
├── features/
│   ├── home/                      # Progress summary
│   ├── problems/                  # Catalogue and problem workspace vertical slice
│   ├── executor/                  # Free execution vertical slice
│   ├── submissions/               # Bounded local history and source inspection
│   └── runtimes/                  # Runtime rail/details/selectors
├── components/app/                # AppShell, nav, storage status, error recovery
└── styles/                         # DESIGN.md tokens, foundations, workspace/layout CSS

tests/
├── helpers/                        # Manual clock, fake Worker, memory legacy storage
├── domain/                         # JSON/comparer tests
├── problems/                       # Schema, safety, and six-file corpus tests
├── runtime/                        # Manifest/Registry/Supervisor/adapter contracts
├── oj/                             # Verdict and case-visibility tests
├── storage/                        # Repository/transaction/migration tests
├── services/                       # Run/Submit transaction tests
└── ui/                             # Pure view-model/controller tests (no new DOM test lib)

scripts/
├── run-tests.mjs                   # Compile-and-run Node test harness
├── build-app.mjs                   # Cross-platform strict/test/build orchestrator
├── build-worker-assets.mjs         # esbuild worker entrypoints to stable public URLs
├── generate-runtime-manifest.mjs   # Artifact-derived manifest
├── check-runtime-assets.mjs        # Required readiness and optional classification
├── verify-optional-runtime.mjs     # Exit 0 verified, 2 unavailable, 1 broken
├── smoke-check.mjs                 # Dist-level static asset and route checks
└── working-tree-identity.mjs       # SHA-256 acceptance identity, no Git write
```

Generated `public/*-worker.js` and `public/runtime-manifest.json` remain deployable artifacts; their editable sources live under `src/workers/` and `scripts/`. Core files under `src/domain`, `src/problems`, `src/runtime`, `src/oj`, `src/storage`, and `src/services` must not import React.

### Task 1: Establish a strict, zero-warning, runnable test baseline

**Files:**
- Create: `tsconfig.test.json`
- Create: `scripts/run-tests.mjs`
- Create: `scripts/build-app.mjs`
- Create: `tests/baseline/test-runner.test.ts`
- Modify: `tsconfig.json`
- Modify: `package.json`
- Modify: `eslint.config.js`
- Modify: `vite.config.ts`
- Modify: `src/ErrorFallback.tsx`
- Modify: `src/components/CodeEditor.tsx`
- Modify: `src/components/TestCaseManager.tsx`
- Modify: `src/hooks/use-code-execution.ts`
- Modify: `src/hooks/use-local-storage.ts`
- Modify: `src/hooks/use-problems.ts`
- Modify: `src/hooks/use-worker-loader.ts`
- Delete: `src/components/ui/chart.tsx` (unreferenced broken generated surface)
- Delete: `src/components/ui/form.tsx` (unreferenced generated surface with non-component export warning)
- Delete: `src/components/ui/sidebar.tsx` (unreferenced oversized generated surface with non-component export warning)
- Delete: `src/vite-end.d.ts` (stale misspelled duplicate declaration)

**Interfaces:**
- Consumes: current scripts from `package.json`, existing local TypeScript/ESLint/Vite packages, and the known RED baseline (`chart.tsx` type failure; 13 lint warnings).
- Produces: `npm test -- [focused test paths]`, `npm run typecheck`, `npm run lint`, and a strict TypeScript baseline that every later task can use.

- [ ] **Step 1: Capture the strict and lint RED evidence before edits**

Run:

```powershell
npx tsc --noEmit
npm run lint -- --max-warnings=0
```

Expected: typecheck exits non-zero in `src/components/ui/chart.tsx`; lint exits non-zero because the existing 13 warnings exceed zero. Save the exact diagnostics in the task receipt rather than weakening compiler or lint rules.

- [ ] **Step 2: Turn on the complete strict compiler contract and remove only dead/broken baseline surfaces**

Set the effective compiler options to this shape (retain the existing alias and DOM libraries):

```json
{
  "strict": true,
  "noImplicitOverride": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "noFallthroughCasesInSwitch": true,
  "noUncheckedSideEffectImports": true,
  "noEmit": true
}
```

Delete the unreferenced chart/form/sidebar modules instead of patching unused generated surfaces. Type `ErrorFallback` with `FallbackProps`; remove `pythonLanguage`/the unused Racket keyword constant from CodeMirror; make its construction effect read current callbacks without stale captures; change the ignored TestCaseManager catch binding to `catch {}`; type `useProblems` catches as `unknown`; and make each hook dependency explicit (`getTimeoutMs` for execution and stable snapshots/callbacks for worker state). Do not disable `strict`, `react-hooks`, `noUncheckedIndexedAccess`, or `--max-warnings=0` to make the command green.

Remove `@ts-nocheck` from `vite.config.ts`, include that config in the strict project, and type its Node/Vite APIs rather than exempting the build boundary. `tsconfig.test.json` extends the strict config and overrides exactly:

```json
{
  "compilerOptions": {
    "noEmit": false,
    "allowImportingTsExtensions": false,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": ".test-dist",
    "types": ["node"]
  },
  "include": ["tests/**/*.ts"]
}
```

- [ ] **Step 3: Add a no-dependency TypeScript test runner**

`scripts/run-tests.mjs` must use only Node APIs and the installed TypeScript CLI:

```js
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tscCli = resolve(projectRoot, "node_modules/typescript/bin/tsc");
run(process.execPath, [tscCli, "-p", "tsconfig.test.json"]);
const requested = process.argv.slice(2);
const testFiles = requested.length > 0
  ? requested.map((path) => path.endsWith(".test.mjs") ? resolveInsideTests(path) : toCompiledTestPath(path))
  : [
      ...await findFiles(resolve(projectRoot, ".test-dist/tests"), ".test.js"),
      ...await findFiles(resolve(projectRoot, "tests"), ".test.mjs"),
    ];
if (testFiles.length === 0) throw new Error("No tests discovered");
run(process.execPath, ["--test", ...testFiles]);
```

The runner must reject requested paths outside `tests/`, clean only the resolved `<projectRoot>/.test-dist` directory, preserve exit codes, and never treat zero discovered tests as success. `tsconfig.test.json` emits NodeNext ESM into `.test-dist`; tested core modules use relative imports ending in `.js` so emitted imports resolve under Node 20.

- [ ] **Step 4: Write and run the runner canary**

```ts
import assert from "node:assert/strict";
import test from "node:test";

test("focused TypeScript tests execute through the local harness", () => {
  assert.deepEqual({ runner: "node:test", transpiler: "typescript" }, {
    runner: "node:test",
    transpiler: "typescript",
  });
});
```

Run:

```powershell
npm test -- tests/baseline/test-runner.test.ts
```

Expected: one test passes and output names the canary. A zero-test run is a failure.

- [ ] **Step 5: Make the repository quality commands explicit and cross-platform**

Add scripts with these responsibilities:

```json
{
  "test": "node scripts/run-tests.mjs",
  "typecheck": "tsc --noEmit",
  "lint": "eslint . --max-warnings=0",
  "build": "node scripts/build-app.mjs"
}
```

At this task, `build-app.mjs` may initially run local TypeScript, tests, and Vite in sequence through `spawnSync`; later tasks extend it with worker generation, manifest validation, and dist smoke checks. It must invoke binaries with `process.execPath`/resolved local entrypoints rather than shell chaining.

- [ ] **Step 6: Prove the baseline is green without hiding current runtime gaps**

Run:

```powershell
npm run typecheck
npm run lint
npm test
```

Expected: all three exit 0, lint reports zero warnings, and `npm test` runs at least the canary. The old Racket skip script is not wired into `npm test`; Task 19 replaces it with a three-state verifier.

- [ ] **Step 7: Prepare the review boundary**

Prepare a file list containing only the baseline/test-harness changes and suggest `chore: establish strict test baseline`. Do not execute a Git write; actual commit authorization must come from the user.

### Task 2: Enforce canonical JSON values and one deep comparer

**Files:**
- Create: `src/domain/json-value.ts`
- Create: `src/oj/comparer.ts`
- Create: `tests/domain/json-value.test.ts`
- Create: `tests/oj/comparer.test.ts`

**Interfaces:**
- Consumes: strict/test harness from Task 1.
- Produces: `JsonValue`, `JsonObject`, `validateJsonValue(value, limits?)`, `assertJsonValue(value, label, limits?)`, and `compareJson(actual, expected): JsonComparison`.

- [ ] **Step 1: Write JSON-boundary RED tests**

Cover accepted nested values plus every forbidden category and a cycle:

```ts
test("canonical JSON rejects non-finite and non-JSON values with a path", () => {
  for (const [value, code] of [
    [undefined, "unsupported-type"],
    [1n, "unsupported-type"],
    [Number.NaN, "non-finite-number"],
    [Number.POSITIVE_INFINITY, "non-finite-number"],
    [() => 1, "unsupported-type"],
    [Symbol("x"), "unsupported-type"],
  ] as const) {
    const result = validateJsonValue(value);
    assert.equal(result.ok, false);
    if (result.ok) assert.fail("value unexpectedly passed canonical JSON validation");
    assert.equal(result.issues[0]?.code, code);
  }
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const cyclicResult = validateJsonValue(cyclic);
  if (cyclicResult.ok) assert.fail("cycle unexpectedly passed canonical JSON validation");
  assert.equal(cyclicResult.issues[0]?.code, "cyclic-value");
});
```

Also assert source/case payload byte accounting uses UTF-8 and reports an exact path such as `$.items[2].value`.

- [ ] **Step 2: Run the boundary test and verify RED**

Run:

```powershell
npm test -- tests/domain/json-value.test.ts
```

Expected: compilation fails because `validateJsonValue` and its result types do not exist.

- [ ] **Step 3: Implement iterative validation with bounded diagnostics**

Use this public shape and keep traversal helpers below 50 LOC:

```ts
export type JsonPrimitive = null | boolean | number | string;
export interface JsonObject { [key: string]: JsonValue }
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export type JsonIssueCode = "unsupported-type" | "non-finite-number" | "cyclic-value" | "byte-limit";
export interface JsonIssue { code: JsonIssueCode; path: string; message: string }
export type JsonValidation =
  | { ok: true; value: JsonValue; bytes: number }
  | { ok: false; issues: readonly JsonIssue[] };
export function validateJsonValue(value: unknown, limits?: { maxBytes?: number }): JsonValidation;
export function assertJsonValue(value: unknown, label: string, limits?: { maxBytes?: number }): JsonValue;
```

Track ancestor objects in a `WeakSet`, stop after a bounded number of issues, accept only plain enumerable object properties/arrays, and compute bytes with `TextEncoder` after validation.

- [ ] **Step 4: Write comparer RED tests for semantic edge cases**

```ts
test("json-deep-equal ignores object key order but preserves array order", () => {
  assert.equal(compareJson({ a: 1, b: [2, 3] }, { b: [2, 3], a: 1 }).equal, true);
  assert.deepEqual(compareJson([1, 2], [2, 1]), {
    equal: false,
    path: "$[0]",
    reason: "value-mismatch",
    actual: 1,
    expected: 2,
  });
  assert.equal(compareJson({}, { missing: null }).equal, false);
});
```

Run `npm test -- tests/oj/comparer.test.ts`; expected RED is a missing `compareJson` export.

- [ ] **Step 5: Implement the only allowed comparer and make both suites GREEN**

```ts
export type JsonComparison =
  | { equal: true }
  | { equal: false; path: string; reason: "type-mismatch" | "missing-key" | "extra-key" | "length-mismatch" | "value-mismatch"; actual?: JsonValue; expected?: JsonValue };

export function compareJson(actual: JsonValue, expected: JsonValue): JsonComparison {
  return compareNode(actual, expected, "$", new WeakMap<object, object>());
}
```

Do not stringify objects for equality. Compare finite numbers exactly, strings exactly, arrays by index, and objects by key sets independent of insertion order.

Run:

```powershell
npm test -- tests/domain/json-value.test.ts tests/oj/comparer.test.ts
```

Expected: all canonical JSON and comparison cases pass.

- [ ] **Step 6: Prepare the review boundary**

Prepare the four files and suggest `feat: add canonical json comparison`. Do not execute the commit.

### Task 3: Define and fail-close the runtime manifest and Worker protocol

**Files:**
- Create: `src/domain/language.ts`
- Create: `src/runtime/manifest.ts`
- Create: `src/runtime/protocol.ts`
- Create: `tests/runtime/manifest.test.ts`
- Create: `tests/runtime/protocol.test.ts`

**Interfaces:**
- Consumes: `JsonValue`/`validateJsonValue` from Task 2 and installed Zod 4.
- Produces: `LanguageId`, `RuntimeId`, `RuntimeManifestDocument`, `RuntimeManifestEntry`, `parseRuntimeManifest`, protocol request/response unions, `parseWorkerRequest`, and `parseWorkerResponse`.

- [ ] **Step 1: Write manifest RED tests around exact IDs, limits, and capability flags**

Use one valid fixture and mutate it to prove duplicate runtime IDs, language/runtime mismatch, protocol version `2`, negative asset bytes, an empty unavailable reason, invalid worker URL, and limits above platform maxima all fail with runtime-specific diagnostics.

```ts
const parsed = parseRuntimeManifest(validManifest);
assert.equal(parsed.schemaVersion, 1);
assert.equal(parsed.runtimes[0]?.runtimeId, "javascript-worker");
assert.deepEqual(parsed.runtimes[0]?.capabilities, { execute: true, judge: true });
```

Run `npm test -- tests/runtime/manifest.test.ts`; expected RED is the missing schema/parser.

- [ ] **Step 2: Implement immutable language/runtime IDs and manifest parsing**

```ts
export const LANGUAGE_IDS = ["javascript", "typescript", "python", "racket", "haskell"] as const;
export type LanguageId = (typeof LANGUAGE_IDS)[number];
export const RUNTIME_IDS = [
  "javascript-worker", "typescript-official", "python-pyodide",
  "python-rustpython", "racket-wasm", "haskell-ghc-wasi",
] as const;
export type RuntimeId = (typeof RUNTIME_IDS)[number];
```

```ts
export interface RuntimeManifestEntry {
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
  capabilities: { execute: boolean; judge: boolean };
  timeouts: { initializeMs: number; executeMs: number };
  limits: { sourceBytes: number; caseCount: number; outputBytes: number };
}
export interface RuntimeManifestDocument { schemaVersion: 1; runtimes: RuntimeManifestEntry[] }
export function parseRuntimeManifest(input: unknown): RuntimeManifestDocument;
```

Enforce required IDs (`javascript-worker`, `typescript-official`, `python-pyodide`) as `required: true`; all optional IDs are `required: false`. `packaged:false` requires a non-empty reason and never gains capability readiness merely because a hand-authored flag says so.

- [ ] **Step 3: Write protocol RED tests for all operations and hostile envelopes**

```ts
for (const request of [initializeRequest, executeRequest, judgeRequest, disposeRequest]) {
  assert.equal(parseWorkerRequest(request).protocolVersion, 1);
}
assert.throws(
  () => parseWorkerResponse({ ...completeResponse, protocolVersion: 2 }, "javascript-worker"),
  /unsupported protocolVersion 2/,
);
assert.throws(
  () => parseWorkerResponse({ ...completeResponse, runtimeId: "python-pyodide" }, "javascript-worker"),
  /runtimeId mismatch/,
);
```

Also cover missing/blank `requestId`, malformed completion payloads, unknown message types, and non-JSON case values.

- [ ] **Step 4: Implement protocol v1 as discriminated unions plus runtime validation**

```ts
interface Envelope { protocolVersion: 1; requestId: string; runtimeId: RuntimeId }
export interface JudgeCaseRequest { index: number; input: JsonValue }
export type WorkerRequest = Envelope & (
  | { type: "initialize" }
  | { type: "execute"; source: string }
  | { type: "judge"; source: string; cases: readonly JudgeCaseRequest[] }
  | { type: "dispose" }
);
export type WorkerResponse = Envelope & (
  | { type: "status"; phase: "initializing" | "executing"; message: string }
  | { type: "complete"; operation: "initialize"; payload: InitializePayload }
  | { type: "complete"; operation: "execute"; payload: ExecutePayload }
  | { type: "complete"; operation: "judge"; payload: JudgePayload }
  | { type: "complete"; operation: "dispose"; payload: { disposed: true } }
  | { type: "failure"; error: RuntimeFailure }
);
export interface RuntimeFailure {
  kind: "compile" | "runtime" | "infrastructure" | "protocol" | "cancelled";
  code: string;
  message: string;
  details?: string;
  fatal: boolean;
}
export interface InitializePayload {
  runtimeVersion: string;
  buildId: string;
  capabilities: { execute: boolean; judge: boolean };
}
export interface BoundedText { text: string; bytes: number; truncated: boolean }
export interface ExecutePayload { stdout: BoundedText; stderr: BoundedText; value: JsonValue | null }
export type JudgeCasePayload =
  | { index: number; ok: true; actual: JsonValue; stdout: BoundedText; stderr: BoundedText }
  | { index: number; ok: false; failure: RuntimeFailure; stdout: BoundedText; stderr: BoundedText };
export interface JudgePayload { cases: readonly JudgeCasePayload[] }
```

`JudgePayload` contains actual values or per-case structured failures only; it has no `expected`, `passed`, or verdict field. Bound `message`, `details`, stdout, and stderr lengths during parsing.

- [ ] **Step 5: Prove fail-closed parsing is GREEN**

Run:

```powershell
npm test -- tests/runtime/manifest.test.ts tests/runtime/protocol.test.ts
npm run typecheck
```

Expected: all fixtures pass, every malformed envelope throws a bounded diagnostic, and strict typecheck passes.

- [ ] **Step 6: Prepare the review boundary**

Prepare these five contract files and suggest `feat: define runtime protocol contracts`. Do not execute the commit.

### Task 4: Generate a truthful artifact-derived runtime manifest and readiness report

**Files:**
- Create: `scripts/lib/runtime-catalog.mjs`
- Create: `scripts/generate-runtime-manifest.mjs`
- Create: `scripts/check-runtime-assets.mjs`
- Create: `tests/scripts/runtime-manifest-generation.test.mjs`
- Create: `tests/runtime/generated-manifest.test.ts`
- Modify: `scripts/build-app.mjs`
- Modify: `scripts/build-runtimes.mjs`
- Modify: `scripts/copy-typescript-asset.mjs`
- Modify: `scripts/setup-pyodide.js`
- Modify: `package.json`
- Generate: `public/runtime-manifest.json`

**Interfaces:**
- Consumes: manifest contract from Task 3, existing `public` assets, and existing setup/build scripts.
- Produces: `buildManifest({ root }): RuntimeManifestDocument`, `checkRuntimeAssets({ root, manifest, target }): ReadinessReport`, `npm run runtime:manifest`, and `npm run runtime:check`.

- [ ] **Step 1: Write generation RED tests in disposable fixture directories**

Use `node:fs` under the OS temp directory, never the workspace, to create fake assets. Assert:

```js
const manifest = await buildManifest({ root: fixtureRoot });
assert.equal(byId(manifest, "javascript-worker").packaged, true);
assert.equal(byId(manifest, "javascript-worker").assets[0].bytes, 23);
assert.equal(byId(manifest, "python-rustpython").packaged, false);
assert.match(byId(manifest, "python-rustpython").unavailableReason, /runner\.wasm/);
```

Delete one required TypeScript compiler fixture and assert `checkRuntimeAssets` returns `ready:false` with a required failure. Missing optional Racket must be classified `unavailable`, not `passed` or `skipped`.

`generated-manifest.test.ts` reads the real generated JSON, passes it through `parseRuntimeManifest`, asserts all six runtime IDs occur exactly once, and checks each listed asset exists with the declared byte count. This is the build-time link between the Node generator and the Zod runtime boundary; the generator does not carry a second permissive schema.

- [ ] **Step 2: Run generation tests and verify RED**

Run:

```powershell
npm test -- tests/scripts/runtime-manifest-generation.test.mjs tests/runtime/generated-manifest.test.ts
```

Expected: Node cannot import `buildManifest` because the generator/catalog does not exist.

- [ ] **Step 3: Define the catalog without availability booleans**

Each catalog item specifies identity, stable worker URL/type, required asset alternatives, capability intent, reuse, and limits; it never contains `available` or `packaged`:

```js
export const runtimeCatalog = [
  runtime("javascript-worker", "javascript", true, "js-worker.js", [file("js-worker.js")], "per-submission"),
  runtime("typescript-official", "typescript", true, "js-worker.js", [file("js-worker.js"), file("typescript/typescript.js")], "per-submission"),
  runtime("python-pyodide", "python", true, "python-worker.js", [file("python-worker.js"), file("pyodide/pyodide.js"), file("pyodide/pyodide.asm.wasm"), file("pyodide/python_stdlib.zip")], "session"),
  runtime("python-rustpython", "python", false, "rustpython-worker.js", [file("rustpython-worker.js"), oneOf("rustpython/runner.wasm.gz", "rustpython/runner.wasm")], "session"),
  runtime("racket-wasm", "racket", false, "racket-worker.js", [file("racket-worker.js"), file("racket/racket.js"), oneOf("racket/racket.wasm.gz", "racket/racket.wasm")], "session"),
  runtime("haskell-ghc-wasi", "haskell", false, "haskell-worker.js", [file("haskell-worker.js"), oneOf("haskell/ghc.wasm.gz", "haskell/ghc.wasm"), oneOf("haskell/libdir.tar.gz", "haskell/libdir.tar"), file("haskell/wasi-shim.js"), file("haskell/runner.meta.json")], "session"),
];
```

Resolve each present file with `stat.size > 0`; include only concrete URLs and byte counts in the manifest. A missing group yields an explicit list in `unavailableReason`.

- [ ] **Step 4: Implement readiness as a report with three honest states**

```js
export function checkRuntimeAssets({ root, manifest, target }) {
  return {
    ready: requiredFailures.length === 0,
    required: requiredEntries.map(toReadyOrBroken),
    optional: optionalEntries.map(toPackagedUnavailableOrBroken),
    requiredFailures,
  };
}
```

Required missing/mismatched files exit 1. This static report classifies optional entries only as `packaged`, `unavailable`, or `broken`; `packaged` means assets exist, not that the runtime contract passed. A cleanly absent artifact is `unavailable` with a reason. A declared packaged artifact that is missing, empty, or inconsistent is `broken` and exits 1. Browser verification in Tasks 19–21 is the only path from packaged/loadable to verified/ready.

- [ ] **Step 5: Wire setup and build scripts without shell syntax**

`build-runtimes.mjs` copies artifacts, then calls the shared generator; it no longer writes the old keyed manifest. `build-app.mjs` invokes in order: TypeScript asset copy, Pyodide setup, worker build (added in Task 8), manifest generation, typecheck, tests, Vite build, dist asset check, smoke. Until Task 8, guard only the not-yet-created worker build entry by an explicit file existence check and remove that guard in Task 8.

Add scripts:

```json
{
  "runtime:manifest": "node scripts/generate-runtime-manifest.mjs",
  "runtime:check": "node scripts/check-runtime-assets.mjs public"
}
```

- [ ] **Step 6: Make focused tests GREEN and inspect the real workspace report**

Run:

```powershell
node scripts/copy-typescript-asset.mjs
npm run runtime:manifest
npm test -- tests/scripts/runtime-manifest-generation.test.mjs tests/runtime/generated-manifest.test.ts
npm run runtime:check
```

Expected now: generator tests pass. Required JS/Pyodide must be ready; TypeScript is ready only after its existing copy script finds the installed compiler. Missing optional assets print `UNAVAILABLE <runtimeId>: <specific missing paths>` and are not counted in a pass total. Any required miss is a real blocker, not a skipped test.

- [ ] **Step 7: Prepare the review boundary**

Prepare generator/catalog/readiness changes plus the generated manifest and suggest `feat: derive runtime manifest from assets`. Do not execute the commit.

### Task 5: Validate schema v2 and migrate the complete six-problem corpus

**Files:**
- Create: `src/domain/problem.ts`
- Create: `src/problems/problem-schema.ts`
- Create: `src/problems/problem-repository.ts`
- Create: `src/problems/problem-modules.ts`
- Create: `tests/problems/problem-schema.test.ts`
- Create: `tests/problems/problem-corpus.test.ts`
- Create: `tests/problems/markdown-safety.test.ts`
- Modify: `src/hooks/use-problems.ts`
- Modify: `src/problems/001-two-sum.md`
- Modify: `src/problems/002-reverse-string.md`
- Modify: `src/problems/003-valid-palindrome.md`
- Modify: `src/problems/004-maximum-subarray.md`
- Modify: `src/problems/005-merge-two-sorted-lists.md`
- Modify: `src/problems/006-longest-substring-without-repeating.md`
- Delete after consumer migration: `src/lib/problems.ts`

**Interfaces:**
- Consumes: `LanguageId` and `JsonValue` from Tasks 2–3, Zod 4, gray-matter, marked, and six existing algorithms/templates.
- Produces: `Problem`, `ProblemCase`, `ProblemRepository`, `parseProblemDocument(filePath, raw)`, `validateProblemCorpus(documents)`, `loadProblems()`, and `getProblemById(id)`.

- [ ] **Step 1: Write schema/corpus RED tests**

Test all required fields and cross-document uniqueness:

```ts
const problem = parseProblemDocument("001-two-sum.md", validTwoSumV2);
assert.equal(problem.schemaVersion, 2);
assert.equal(problem.slug, "two-sum");
assert.equal(problem.contract, "json-function-v1");
assert.ok(problem.tests.public.length >= 1);
assert.ok(problem.tests.judge.length >= 1);
assert.throws(() => validateProblemCorpus([problem, { ...problem, slug: "duplicate" }]), /duplicate id 1/);
```

Mutations must reject invalid kebab-case slug, unsupported template key, missing `solution` entrypoint, empty public/judge groups, malformed JSON values, timeout above manifest limits, and a diagnostic lacking the source filename.

- [ ] **Step 2: Run schema tests and verify RED**

Run:

```powershell
npm test -- tests/problems/problem-schema.test.ts
```

Expected: missing `parseProblemDocument`/schema exports.

- [ ] **Step 3: Implement the v2 parser and safe Markdown boundary**

```ts
export interface ProblemCase { input: JsonValue; expected: JsonValue }
export interface Problem {
  schemaVersion: 2;
  id: number;
  slug: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  summary: string;
  tags: readonly string[];
  examples: readonly { input: string; output: string; explanation?: string }[];
  constraints: readonly string[];
  entrypoint: "solution";
  contract: "json-function-v1";
  templates: Readonly<Partial<Record<LanguageId, string>>>;
  tests: { public: readonly ProblemCase[]; judge: readonly ProblemCase[] };
  timeoutMs?: number;
  markdown: string;
  safeHtml: string;
}
export function parseProblemDocument(filePath: string, raw: string): Problem;
export function validateProblemCorpus(documents: readonly Problem[]): readonly Problem[];
export interface ProblemRepository {
  list(): Promise<readonly Problem[]>;
  getById(problemId: number): Promise<Problem | undefined>;
}
export function createProblemRepository(loaders: Record<string, () => Promise<string>>): ProblemRepository;
```

Escape/disable raw HTML tokens and reject unsafe URL schemes before assigning `safeHtml`; preserve ordinary Markdown/code fences. Every thrown schema error begins with the file path and a field path.

- [ ] **Step 4: Lock the Markdown trust boundary with RED then GREEN**

```ts
test("problem markdown cannot inject active html or javascript urls", () => {
  const p = parseProblemDocument("unsafe.md", rawV2("<img src=x onerror=alert(1)> [x](javascript:alert(1))"));
  assert.doesNotMatch(p.safeHtml, /<img|onerror|href=["']javascript:/i);
  assert.match(p.safeHtml, /&lt;img/);
});
```

Run `npm test -- tests/problems/markdown-safety.test.ts`; expected RED before the safe renderer is wired, then GREEN after the boundary is implemented.

- [ ] **Step 5: Migrate all six files without changing their intended algorithms**

Every frontmatter gains `schemaVersion: 2`, `slug`, `summary`, `entrypoint: solution`, `contract: json-function-v1`, tags, and separate `tests.public`/`tests.judge`. Preserve IDs and use these stable slugs:

```text
1 two-sum
2 reverse-string
3 valid-palindrome
4 maximum-subarray
5 merge-two-sorted-lists
6 longest-substring-without-repeating
```

Keep at least one public and one judge case per problem; public examples remain visible and judge values never enter normal result details. Keep required JavaScript, TypeScript, and Python templates; retain optional language templates only when they satisfy `json-function-v1`.

- [ ] **Step 6: Validate the real corpus and defensive runtime loader**

`problem-corpus.test.ts` reads exactly the six Markdown files from disk, parses all of them, checks IDs/slugs are unique and sorted, and asserts public/judge groups plus required templates. The pure `problem-repository.ts` accepts loader functions and remains Node-testable. Browser-only `problem-modules.ts` calls `import.meta.glob("./*.md", { query:"?raw", import:"default" })`, passes those loaders to `createProblemRepository`, caches only a successful corpus, and exposes compatibility functions `loadProblems()`/`getProblemById()` through that repository. `useProblems` exposes errors without substituting permissive defaults.

Run:

```powershell
npm test -- tests/problems/problem-schema.test.ts tests/problems/markdown-safety.test.ts tests/problems/problem-corpus.test.ts
npm run typecheck
```

Expected: six documents validate; unsafe fixtures fail safely; no duplicate/permissive fallback remains.

- [ ] **Step 7: Prepare the review boundary**

Prepare parser/repository/tests and all six Markdown files; suggest `feat: migrate problem corpus to schema v2`. Do not execute the commit.

### Task 6: Derive every selectable runtime capability through the Registry

**Files:**
- Create: `src/runtime/registry.ts`
- Create: `tests/runtime/registry.test.ts`
- Modify: `src/runtime/manifest.ts`

**Interfaces:**
- Consumes: `RuntimeManifestDocument`, `RuntimeId`, and `LanguageId` from Task 3.
- Produces: `RuntimeCapabilityState`, `RuntimeCapability`, and `RuntimeRegistry` methods `list()`, `forLanguage()`, `get()`, `resolveDefault()`, `transition()`, `subscribe()`.

- [ ] **Step 1: Write Registry RED tests for required, optional, incompatible, and transition paths**

```ts
const registry = RuntimeRegistry.fromManifest(manifestWithMissingOptionals);
assert.equal(registry.get("python-rustpython").state.kind, "not-packaged");
assert.match(registry.get("python-rustpython").state.reason, /runner\.wasm/);
assert.equal(registry.resolveDefault("python", "judge")?.runtimeId, "python-pyodide");
assert.throws(() => registry.transition("racket-wasm", { kind: "ready" }), /not packaged/);
```

Also test `loadable → initializing → ready → running → ready`, failure/retry to `loadable`, protocol mismatch to `incompatible`, immutable snapshots, listener unsubscribe, and no language list outside manifest-derived results.

- [ ] **Step 2: Run Registry tests and verify RED**

Run:

```powershell
npm test -- tests/runtime/registry.test.ts
```

Expected: missing `RuntimeRegistry` export.

- [ ] **Step 3: Implement the capability store with explicit transition guards**

```ts
export type RuntimeCapabilityState =
  | { kind: "not-packaged"; reason: string }
  | { kind: "loadable" }
  | { kind: "initializing"; message?: string }
  | { kind: "ready" }
  | { kind: "running"; requestId: string }
  | { kind: "failed"; code: string; message: string }
  | { kind: "incompatible"; expected: 1; received: number };

export interface RuntimeCapability extends RuntimeManifestEntry { state: RuntimeCapabilityState }
export class RuntimeRegistry {
  static fromManifest(document: RuntimeManifestDocument): RuntimeRegistry;
  list(): readonly RuntimeCapability[];
  forLanguage(languageId: LanguageId, capability?: "execute" | "judge"): readonly RuntimeCapability[];
  get(runtimeId: RuntimeId): RuntimeCapability;
  resolveDefault(languageId: LanguageId, capability: "execute" | "judge"): RuntimeCapability | undefined;
  transition(runtimeId: RuntimeId, next: RuntimeCapabilityState): void;
  subscribe(listener: (snapshot: readonly RuntimeCapability[]) => void): () => void;
}
```

Store cloned/frozen snapshots; notifications occur only on a real state change. `resolveDefault` never returns disabled, failed, or incompatible entries and prefers the required runtime for a language.

- [ ] **Step 4: Make Registry tests GREEN and add a generated-manifest integration assertion**

Run:

```powershell
npm test -- tests/runtime/manifest.test.ts tests/runtime/registry.test.ts
```

Expected: valid transitions pass; illegal transitions and optional enable attempts fail; current missing optional entries remain visible but disabled with exact reasons.

- [ ] **Step 5: Prepare the review boundary**

Prepare Registry and tests; suggest `feat: derive runtime capabilities from manifest`. Do not execute the commit.

### Task 7: Guarantee Supervisor serialization, termination, cancellation, and restart

**Files:**
- Create: `src/runtime/worker-port.ts`
- Create: `src/runtime/supervisor.ts`
- Create: `tests/helpers/manual-clock.ts`
- Create: `tests/helpers/fake-worker.ts`
- Create: `tests/runtime/supervisor.test.ts`

**Interfaces:**
- Consumes: `RuntimeRegistry`, protocol parsers/unions, manifest timeout/reuse settings.
- Produces: `WorkerPort`, `WorkerFactory`, `Clock`, `RuntimeIdentity`, `RuntimeInvocation<T>`, `RuntimeSupervisor.initialize()`, `.execute()`, `.judge()`, `.cancel()`, `.dispose()`.

- [ ] **Step 1: Build deterministic clock and Worker test doubles**

```ts
export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}
export class ManualClock implements Clock { tick(ms: number): void; pendingCount(): number }
export class FakeWorker implements WorkerPort {
  readonly posted: WorkerRequest[] = [];
  readonly generation: number;
  terminated = false;
  emit(response: unknown): void;
  fail(error: Error): void;
}
```

The fake must expose listener counts so tests can prove cleanup rather than merely observe resolved promises.

- [ ] **Step 2: Write the complex lifecycle RED suite**

Cover, as separate named tests:

1. session runtime requests execute FIFO and never overlap;
2. per-submission runtime gets a new Worker for every operation;
3. initialization timeout terminates, rejects once, clears timers/listeners, and marks failed;
4. execution timeout terminates and rejects with code `execution-timeout`;
5. AbortSignal cancellation is a normal `cancelled` terminal result;
6. Worker `error`, malformed response, request/runtime mismatch, and fatal failure terminate immediately;
7. late completion from generation N is ignored after generation N+1 starts;
8. every queued/pending promise settles exactly once;
9. the next operation after failure creates, initializes, and uses a fresh Worker.

Use explicit assertions such as:

```ts
clock.tick(5_001);
await assert.rejects(run, isRuntimeFault("execution-timeout"));
assert.equal(firstWorker.terminated, true);
assert.equal(clock.pendingCount(), 0);
const recovered = supervisor.judge(runtimeId, source, cases);
assert.notEqual(factory.workers.at(-1), firstWorker);
```

- [ ] **Step 3: Run the lifecycle suite and verify RED**

Run:

```powershell
npm test -- tests/runtime/supervisor.test.ts
```

Expected: missing Supervisor/WorkerPort exports.

- [ ] **Step 4: Implement one queue per runtime and generation-checked message routing**

```ts
export class RuntimeSupervisor {
  constructor(options: { registry: RuntimeRegistry; workerFactory: WorkerFactory; clock?: Clock });
  initialize(runtimeId: RuntimeId, signal?: AbortSignal): Promise<InitializePayload>;
  execute(runtimeId: RuntimeId, source: string, options?: RuntimeOperationOptions): Promise<RuntimeInvocation<ExecutePayload>>;
  judge(runtimeId: RuntimeId, source: string, cases: readonly JudgeCaseRequest[], options?: RuntimeOperationOptions): Promise<RuntimeInvocation<JudgePayload>>;
  cancel(runtimeId: RuntimeId, requestId: string): void;
  dispose(runtimeId?: RuntimeId): Promise<void>;
}
export interface RuntimeIdentity { runtimeVersion: string; buildId: string }
export interface RuntimeInvocation<T> { identity: RuntimeIdentity; payload: T }
export interface RuntimeOperationOptions { signal?: AbortSignal; timeoutMs?: number }
```

Each runtime owns `{ generation, worker, identity, initialized, active, queue }`. Initialization stores the `runtimeVersion`/`buildId` from that exact generation's handshake; every execute/judge completion returns that identity beside its payload, never a Registry guess or stale generation. `runOperation` validates limits before enqueueing, initializes through protocol v1, chooses `min(options.timeoutMs, manifest.timeouts.executeMs)` when a positive override is supplied, sets one operation timer, and routes only a matching generation/request/runtime response. Invalid/non-positive overrides fail before enqueueing. `terminateGeneration` clears identity, timers, and listeners first, terminates once, settles active and queued operations according to reason, deletes the worker, and leaves restartable state. For session reuse, create a per-submission namespace through the worker request; for per-submission reuse, always terminate in `finally` after capturing that generation's identity.

- [ ] **Step 5: Make all lifecycle evidence GREEN**

Run:

```powershell
npm test -- tests/runtime/supervisor.test.ts
npm run typecheck
```

Expected: all nine scenarios pass, fake listener/timer counts return to zero, every result carries the current generation's handshake identity, a shorter valid timeout overrides the manifest default and terminates/restarts correctly, an excessive override is capped, and no late message changes a completed result.

- [ ] **Step 6: Prepare the review boundary**

Prepare Supervisor, ports, fakes, and tests; suggest `feat: supervise worker lifecycle safely`. Do not execute the commit.

### Task 8: Deliver JavaScript protocol v1 execution through generated Workers

**Files:**
- Create: `src/runtime/adapters/types.ts`
- Create: `src/runtime/adapters/registry.ts`
- Create: `src/runtime/adapters/javascript.ts`
- Create: `src/runtime/browser-worker-factory.ts`
- Create: `src/workers/shared/endpoint.ts`
- Create: `src/workers/shared/output-buffer.ts`
- Create: `src/workers/shared/runtime-errors.ts`
- Create: `src/workers/javascript/evaluator.ts`
- Create: `src/workers/javascript.worker.ts`
- Create: `scripts/build-worker-assets.mjs`
- Create: `runtime-harness.html`
- Create: `src/harness/runtime-contract-harness.ts`
- Create: `tests/runtime/javascript-adapter.test.ts`
- Create: `tests/runtime/browser-worker-factory.test.ts`
- Create: `tests/workers/javascript-worker.test.ts`
- Modify: `scripts/build-app.mjs`
- Modify: `scripts/lib/runtime-catalog.mjs`
- Modify: `package.json`
- Modify: `vite.config.ts`
- Modify: `src/vite-env.d.ts`
- Generate/replace: `public/js-worker.js`

**Interfaces:**
- Consumes: protocol v1, `RuntimeSupervisor`, `JsonValue`, source/output limits, and existing esbuild.
- Produces: `RuntimeAdapter`, `RuntimeAdapterRegistry`, `createJavascriptAdapter()`, `createBrowserWorkerFactory()`, `window.localCoderHarness`, `createWorkerEndpoint()`, `createJavaScriptRuntime()`, and generated `public/js-worker.js`.

- [ ] **Step 1: Write adapter and worker RED contract tests**

Assert the adapter sends only source/inputs and the worker returns only actual values/errors:

```ts
const response = await runtime.judge(
  "function solution(input) { return { sum: input.a + input.b }; }",
  [{ index: 0, input: { a: 2, b: 3 } }],
);
const firstCase = response.payload.cases[0];
assert.equal(firstCase?.ok, true);
if (!firstCase?.ok) assert.fail("JavaScript case did not complete");
assert.deepEqual(firstCase.actual, { sum: 5 });
assert.equal("expected" in firstCase, false);
assert.equal("passed" in firstCase, false);
```

Separate tests cover syntax error → structured `compile`, thrown error → structured `runtime`, Promise return, stdout/stderr capture, free execution return value, per-case fresh namespace, and explicit truncation at 64 KiB. The browser factory test asserts base-path URL resolution, classic/module constructor options, listener removal, and one terminate call.

- [ ] **Step 2: Run the JavaScript contract tests and verify RED**

Run:

```powershell
npm test -- tests/runtime/javascript-adapter.test.ts tests/runtime/browser-worker-factory.test.ts tests/workers/javascript-worker.test.ts
```

Expected: missing adapter/worker runtime modules.

- [ ] **Step 3: Define adapters as protocol request builders, not judges**

```ts
export interface RuntimeAdapter {
  readonly runtimeId: RuntimeId;
  readonly languageId: LanguageId;
  execute(source: string, options?: RuntimeOperationOptions): Promise<RuntimeInvocation<ExecutePayload>>;
  judge(source: string, inputs: readonly JsonValue[], options?: RuntimeOperationOptions): Promise<RuntimeInvocation<JudgePayload>>;
}
export class RuntimeAdapterRegistry {
  register(adapter: RuntimeAdapter): void;
  get(runtimeId: RuntimeId): RuntimeAdapter;
}
export function createJavascriptAdapter(supervisor: RuntimeSupervisor): RuntimeAdapter;
```

The JavaScript adapter numbers cases and delegates to Supervisor. It validates canonical inputs but never receives expected values and never imports the comparer. It forwards `signal` and the already validated operation timeout and returns the Supervisor's identity-bound invocation unchanged. `createBrowserWorkerFactory(baseUrl)` resolves the manifest's relative worker URL against the current document base, passes its exact classic/module type, and returns the `WorkerPort` listener/terminate facade tested with an injected Worker constructor.

- [ ] **Step 4: Implement a bounded protocol endpoint and JavaScript runtime**

```ts
export interface WorkerRuntime {
  initialize(): Promise<InitializePayload>;
  execute(source: string): Promise<ExecutePayload>;
  judge(source: string, cases: readonly JudgeCaseRequest[]): Promise<JudgePayload>;
  dispose(): Promise<void>;
}
export function createWorkerEndpoint(options: { runtimeId: RuntimeId; runtime: WorkerRuntime; post: (message: WorkerResponse) => void }): (event: MessageEvent<unknown>) => Promise<void>;
```

The endpoint validates every request, emits bounded `status`, maps thrown values to `RuntimeFailure`, and echoes envelope identity. `createJavaScriptRuntime` compiles once per case in a fresh closure, restores console methods in `finally`, awaits returned Promises, and uses `OutputBuffer` to cap combined stdout/stderr with `{ text, bytes, truncated }` metadata. It does not implement an in-Worker timeout; Supervisor termination is authoritative.

- [ ] **Step 5: Generate the stable Worker artifact from TypeScript source**

`build-worker-assets.mjs` uses the installed esbuild API with explicit entry metadata:

```js
await build({
  entryPoints: [resolve(root, "src/workers/javascript.worker.ts")],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  outfile: resolve(root, "public/js-worker.js"),
});
```

Before bundling, hash the sorted editable Worker source bytes plus relevant package versions and inject the first 16 SHA-256 hex characters as `__LOCALCODER_BUILD_ID__`; each runtime returns that exact value in `InitializePayload.buildId`. Export `buildWorkerAssets({ root })` for fixture tests, and make `build-app.mjs` invoke it before manifest generation. Remove Task 4's temporary existence guard. Do not edit the generated worker manually.

Add `runtime-harness.html` as a second explicit Vite Rollup input. Its module script creates a Registry/Supervisor with `createBrowserWorkerFactory`, fetches and validates `/runtime-manifest.json`, and exposes this diagnostic-only API plus a JSON `<pre data-testid="runtime-harness-result">`:

```ts
export interface RuntimeHarnessApi {
  initialize(runtimeId: RuntimeId): Promise<InitializePayload>;
  execute(runtimeId: RuntimeId, source: string, options?: RuntimeOperationOptions): Promise<RuntimeInvocation<ExecutePayload>>;
  judge(runtimeId: RuntimeId, source: string, inputs: readonly JsonValue[], options?: RuntimeOperationOptions): Promise<RuntimeInvocation<JudgePayload>>;
  dispose(runtimeId?: RuntimeId): Promise<void>;
}
declare global { interface Window { localCoderHarness: RuntimeHarnessApi } }
```

The harness is an honest browser contract surface, not an alternate product service: it has no expected values, comparer, storage, or API server.

- [ ] **Step 6: Make unit/contract/build evidence GREEN**

Run:

```powershell
npm test -- tests/runtime/javascript-adapter.test.ts tests/runtime/browser-worker-factory.test.ts tests/workers/javascript-worker.test.ts
node scripts/build-worker-assets.mjs
npm run runtime:manifest
npm run runtime:check
```

Expected: tests pass; `public/js-worker.js` is regenerated and non-empty; `javascript-worker` remains packaged and required. No response contains expected values or verdicts.

- [ ] **Step 7: Exercise the real Worker surface**

Run the dev server in a dedicated PowerShell terminal:

```powershell
npm run dev -- --host 127.0.0.1 --port 4173
```

Using browser MCP, open `http://127.0.0.1:4173/runtime-harness.html`, call `window.localCoderHarness.initialize/execute/judge`, and inspect the result `<pre>`. Record that `{a:2,b:3}` returns `{sum:5}`, a thrown error is structured, and a second run succeeds; expected values/verdicts never appear in the harness response.

- [ ] **Step 8: Prepare the review boundary**

Prepare adapter/shared Worker source, build script, generated worker, and tests; suggest `feat: migrate javascript worker to protocol v1`. Do not execute the commit.

### Task 9: Add official TypeScript transpilation with truthful compile errors

**Files:**
- Create: `src/runtime/adapters/typescript.ts`
- Create: `src/workers/javascript/typescript-compiler.ts`
- Create: `tests/runtime/typescript-adapter.test.ts`
- Create: `tests/workers/typescript-compiler.test.ts`
- Modify: `src/workers/javascript.worker.ts`
- Modify: `scripts/build-worker-assets.mjs`
- Modify: `scripts/copy-typescript-asset.mjs`
- Generate/replace: `public/js-worker.js`
- Generate/verify: `public/typescript/typescript.js`

**Interfaces:**
- Consumes: `RuntimeAdapter`, JavaScript evaluator/runtime, protocol failures, and the installed official `typescript` package/asset.
- Produces: `createTypescriptAdapter(supervisor)`, `transpileTypeScript(compiler, source): TranspileResult`, and `typescript-official` protocol behavior.

- [ ] **Step 1: Write RED tests using the installed compiler API**

```ts
const good = transpileTypeScript(ts, "function solution(input: { n: number }): number { return input.n + 1; }");
assert.equal(good.ok, true);
assert.doesNotMatch(good.code, /: number/);

const bad = transpileTypeScript(ts, "function solution( { return 1 }");
assert.equal(bad.ok, false);
assert.equal(bad.failure.kind, "compile");
assert.match(bad.failure.message, /TS\d+/);
```

Also assert diagnostics are bounded, include line/column, prevent JavaScript evaluation, and that the TypeScript adapter uses runtime ID `typescript-official` while language ID remains `typescript`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npm test -- tests/workers/typescript-compiler.test.ts tests/runtime/typescript-adapter.test.ts
```

Expected: missing compiler/adapter exports.

- [ ] **Step 3: Implement transpilation and route emitted JavaScript through the proven evaluator**

```ts
export type TranspileResult =
  | { ok: true; code: string; diagnostics: readonly string[] }
  | { ok: false; failure: RuntimeFailure };
export interface TypeScriptCompilerLike {
  transpileModule(source: string, options: object): { outputText: string; diagnostics?: readonly unknown[] };
  flattenDiagnosticMessageText(message: unknown, newline: string): string;
  DiagnosticCategory: { Error: number };
}
export function transpileTypeScript(compiler: TypeScriptCompilerLike, source: string): TranspileResult;
export function createTypescriptAdapter(supervisor: RuntimeSupervisor): RuntimeAdapter;
```

Use ES2020, `ModuleKind.None`, `reportDiagnostics:true`. Any error-category diagnostic returns a compile failure and does not call the evaluator. Successful output is passed to the exact JavaScript execute/judge path from Task 8, preserving output limits and fresh-Worker semantics.

- [ ] **Step 4: Fail initialization if the official compiler asset is absent or incompatible**

The Worker loads `./typescript/typescript.js` only for `typescript-official`, verifies `ts.version` and `ts.transpileModule`, and reports `typescript-asset-missing`/`typescript-api-incompatible` as fatal infrastructure failures. The manifest `runtimeVersion` is the packaged `typescript` version. The copy script reads that version from installed package metadata and never advises installing software during a readiness check.

- [ ] **Step 5: Make tests and real asset checks GREEN**

Run:

```powershell
node scripts/copy-typescript-asset.mjs
node scripts/build-worker-assets.mjs
npm test -- tests/workers/typescript-compiler.test.ts tests/runtime/typescript-adapter.test.ts
npm run runtime:manifest
npm run runtime:check
```

Expected: tests pass; TypeScript asset is non-empty; `typescript-official` is packaged/required. Removing the asset in a temp fixture makes readiness fail, not skip.

- [ ] **Step 6: Verify the browser contract**

With the Task 8 dev-server pattern and browser MCP, run one valid typed `solution` to actual value, one syntax error to CE-shaped runtime failure, and a valid request immediately afterward. Record compiler version and successful recovery; no network request may fetch the compiler from a CDN.

- [ ] **Step 7: Prepare the review boundary**

Prepare compiler/adapter/tests/generated assets and suggest `feat: add official typescript runtime`. Do not execute the commit.

### Task 10: Add Pyodide Python with a strict JSON bridge and fresh submission namespaces

**Files:**
- Create: `src/runtime/adapters/python.ts`
- Create: `src/workers/python/pyodide-host.ts`
- Create: `src/workers/python/python-bridge.ts`
- Create: `src/workers/pyodide.worker.ts`
- Create: `tests/runtime/python-adapter.test.ts`
- Create: `tests/workers/pyodide-host.test.ts`
- Modify: `scripts/build-worker-assets.mjs`
- Modify: `scripts/setup-pyodide.js`
- Generate/replace: `public/python-worker.js`

**Interfaces:**
- Consumes: protocol endpoint, canonical JSON validator, `RuntimeAdapter`, Supervisor session reuse, and local Pyodide assets.
- Produces: `createPythonAdapter(supervisor, "python-pyodide")`, `createPyodideHost(deps)`, strict Python/JSON conversion, and generated `public/python-worker.js`.

- [ ] **Step 1: Write Pyodide-host RED tests with a narrow fake**

Define a `PyodideLike` fake exposing only `runPythonAsync`, `globals.set/delete`, and proxy cleanup. Assert:

```ts
const first = await host.judge(sourceThatMutatesGlobal, [{ index: 0, input: { n: 1 } }]);
const second = await host.judge(sourceThatReadsGlobal, [{ index: 0, input: { n: 1 } }]);
const firstCase = first.cases[0];
const secondCase = second.cases[0];
if (!firstCase?.ok || !secondCase?.ok) assert.fail("Pyodide case did not complete");
assert.deepEqual(firstCase.actual, 1);
assert.deepEqual(secondCase.actual, 0); // no namespace leakage
assert.equal(fakePyodide.liveProxyCount, 0);
```

Also cover Unicode JSON, nested values, Python exception → runtime failure, invalid return (`float("nan")`, set, custom object) → `json-bridge-error`, stdout/stderr limits, initialization progress, and executor output.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npm test -- tests/workers/pyodide-host.test.ts tests/runtime/python-adapter.test.ts
```

Expected: missing host/adapter exports.

- [ ] **Step 3: Implement a JSON-string bridge, never source interpolation**

```ts
export interface PyodideLike {
  runPythonAsync(code: string, options?: { globals?: unknown }): Promise<unknown>;
  globals: { set(name: string, value: unknown): void; delete(name: string): boolean };
}
export function createPyodideHost(options: { load: () => Promise<PyodideLike>; outputBytes: number }): WorkerRuntime;
export function createPythonAdapter(supervisor: RuntimeSupervisor, runtimeId: "python-pyodide"): RuntimeAdapter;
```

Pass source and input as globals/JSON strings, parse with Python `json.loads`, call `solution(value)`, and serialize with `json.dumps(..., allow_nan=False)`. Each execute/judge operation creates a new Python dict namespace and removes globals/proxies in `finally`; the expensive Pyodide interpreter may remain initialized for the session.

- [ ] **Step 4: Build a classic Worker that loads only local Pyodide assets**

The generated Worker calls `importScripts(<BASE>pyodide/pyodide.js)`, computes `indexURL` from `self.location`, handshakes with runtime version from `pyodide.version`, and uses the shared protocol endpoint. Initialization timeout remains Supervisor-owned. Setup fails if required Pyodide files are absent instead of warning and continuing.

- [ ] **Step 5: Make unit, manifest, and generated-asset checks GREEN**

Run:

```powershell
node scripts/setup-pyodide.js
node scripts/build-worker-assets.mjs
npm test -- tests/workers/pyodide-host.test.ts tests/runtime/python-adapter.test.ts
npm run runtime:manifest
npm run runtime:check
```

Expected: tests pass; `python-pyodide` is packaged/required with concrete asset sizes. A temp fixture missing `pyodide.asm.wasm` fails required readiness.

- [ ] **Step 6: Verify real Pyodide AC/error/recovery behavior in browser**

Using the dev server and browser MCP, execute a nested JSON solution, a Python syntax/runtime failure, and a valid second run. Inspect network requests to prove assets come from `127.0.0.1:4173` and no application API/CDN is used. Record the first-load status transitions and Pyodide version.

- [ ] **Step 7: Prepare the review boundary**

Prepare Python adapter/host/worker/tests/generated worker and suggest `feat: migrate pyodide runtime to protocol v1`. Do not execute the commit.

### Task 11: Judge Run and Submit deterministically in the OJ Engine

**Files:**
- Create: `src/domain/submission.ts`
- Create: `src/oj/case-selection.ts`
- Create: `src/oj/engine.ts`
- Create: `tests/helpers/fake-runtime-adapter.ts`
- Create: `tests/oj/case-selection.test.ts`
- Create: `tests/oj/engine.test.ts`
- Modify: `src/harness/runtime-contract-harness.ts`

**Interfaces:**
- Consumes: validated `Problem`, `RuntimeAdapterRegistry`, `compareJson`, canonical limits, and structured runtime/Supervisor failures.
- Produces: `Verdict`, `JudgeCommand`, `SubmissionResult`, `OjEngine.run(command)`, and `selectCases(problem, mode, customCases)`.

- [ ] **Step 1: Write RED tests for case selection and judge-case secrecy boundaries**

```ts
const run = selectCases(problem, "run", customCases);
assert.deepEqual(run.map((c) => c.visibility), ["public", "custom"]);
const submit = selectCases(problem, "submit", customCases);
assert.ok(submit.some((c) => c.visibility === "judge"));
```

Assert Run never includes judge cases. Submit includes them, but its serialized public result contains only `{ total, passed, failed }` for judge cases and no judge input/expected/actual.

- [ ] **Step 2: Write the complete verdict RED matrix**

Using `FakeRuntimeAdapter`, create named tests for AC, WA, CE, RE, TLE, cancelled, internal-error, and runtime-unavailable. Add cases for source >256 KiB, >100 combined cases, invalid custom JSON, mismatched/missing case response, truncated logs, object-key reordering, array-order mismatch, and a successful request after timeout/fatal failure.

```ts
const wa = await engine.run(command({ actual: { values: [2, 1] }, expected: { values: [1, 2] } }));
assert.equal(wa.verdict, "wrong-answer");
assert.equal(wa.publicCases[0]?.comparison?.path, "$.values[0]");
```

- [ ] **Step 3: Run OJ tests and verify RED**

Run:

```powershell
npm test -- tests/oj/case-selection.test.ts tests/oj/engine.test.ts
```

Expected: missing engine/result/case-selection exports.

- [ ] **Step 4: Define the stable result contract**

```ts
export type Verdict = "accepted" | "wrong-answer" | "compile-error" | "runtime-error" |
  "time-limit-exceeded" | "cancelled" | "internal-error" | "runtime-unavailable";
export interface JudgeCommand {
  mode: "run" | "submit";
  problem: Problem;
  runtimeId: RuntimeId;
  source: string;
  customCases: readonly ProblemCase[];
  signal?: AbortSignal;
}
export interface VisibleCaseResult {
  index: number;
  visibility: "public" | "custom";
  input: JsonValue;
  expected: JsonValue;
  actual?: JsonValue;
  comparison?: JsonComparison;
  failure?: { code: string; message: string };
  stdout: string;
  stderr: string;
}
export interface SubmissionResult {
  verdict: Verdict;
  elapsedMs: number;
  runtime: { runtimeId: RuntimeId; runtimeVersion: string; buildId: string };
  publicCases: readonly VisibleCaseResult[];
  customCases: readonly VisibleCaseResult[];
  judgeSummary: { total: number; passed: number; failed: number };
  output: { stdout: string; stderr: string; truncated: boolean };
  failure?: { code: string; message: string };
}
export interface SelectedCase { index: number; visibility: "public" | "custom" | "judge"; input: JsonValue; expected: JsonValue }
export function selectCases(problem: Problem, mode: "run" | "submit", customCases: readonly ProblemCase[]): readonly SelectedCase[];
export class OjEngine {
  constructor(options: { registry: RuntimeRegistry; adapters: RuntimeAdapterRegistry; now: () => number });
  run(command: JudgeCommand): Promise<SubmissionResult>;
}
```

- [ ] **Step 5: Implement deterministic validation, invocation, comparison, and mapping**

`OjEngine.run` validates source/case limits, resolves an available adapter, selects cases, records local monotonic elapsed time, validates the optional problem timeout as positive and no greater than the selected runtime manifest maximum, invokes the adapter once with `{ signal, timeoutMs: problem.timeoutMs }`, validates one response per case, copies runtime identity only from that invocation, compares actual/expected centrally, and returns the first aggregate failure by deterministic precedence. Map compile/runtime failures directly; Supervisor `execution-timeout` to TLE; abort to cancelled; disabled capability to runtime-unavailable; malformed/protocol/infrastructure defects to internal-error. Never emit MLE.

- [ ] **Step 6: Make all verdict and recovery tests GREEN**

Run:

```powershell
npm test -- tests/oj/case-selection.test.ts tests/oj/engine.test.ts
npm test -- tests/runtime/supervisor.test.ts
npm run typecheck
```

Expected: every verdict test passes, judge details remain count-only, `SubmissionResult.runtime` exactly matches the invocation handshake, a problem-level short timeout produces TLE followed by a successful fresh-generation run, an override above the manifest limit is rejected deterministically, and Supervisor recovery remains green.

- [ ] **Step 7: Prove same-contract AC/WA across required runtimes in the browser**

Extend `window.localCoderHarness` with `judgeProblem({ problemId, runtimeId, source, mode, customCases })` by composing the problem repository, required adapters, and `OjEngine` directly (still no storage). Through that harness/browser MCP, submit the same `two-sum` contract with JavaScript, TypeScript, and Pyodide Python: one correct source yields AC and one wrong source yields WA for each. Record runtime/build identity and verify the result contains no judge-case details.

- [ ] **Step 8: Prepare the review boundary**

Prepare domain/result/engine/tests and suggest `feat: add deterministic oj engine`. Do not execute the commit.

### Task 12: Persist local work in IndexedDB and migrate legacy state idempotently

**Files:**
- Create: `src/storage/schema.ts`
- Create: `src/storage/driver.ts`
- Create: `src/storage/indexeddb-driver.ts`
- Create: `src/storage/memory-driver.ts`
- Create: `src/storage/repository.ts`
- Create: `src/storage/legacy-migration.ts`
- Create: `tests/helpers/memory-legacy-storage.ts`
- Create: `tests/storage/repository.test.ts`
- Create: `tests/storage/legacy-migration.test.ts`
- Create: `tests/storage/fallback.test.ts`
- Create: `storage-harness.html`
- Create: `src/harness/storage-contract-harness.ts`
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: `LanguageId`, `RuntimeId`, `ProblemCase`, `SubmissionResult`, and native browser `IDBFactory`/`Storage` injected at the boundary.
- Produces: `DatabaseDriver`, `LocalCoderRepository`, `openLocalCoderRepository()`, `runLegacyMigration()`, and observable `StorageState`.

- [ ] **Step 1: Write repository RED tests against the in-memory transaction double**

Cover exact keys and records for drafts, custom cases, settings, progress, and submissions. Assert insertion 201 leaves IDs 2–201, all record schemas validate, ordering is newest-first, filters work, source snapshot/runtime/build/verdict/timestamp persist, and a transaction failure leaves both progress and submission unchanged.

```ts
await repository.saveDraft({ workspaceId: "problem:1", languageId: "python", runtimeId: "python-pyodide", source: "x", updatedAt: 10 });
assert.equal((await repository.getDraft(["problem:1", "python", "python-pyodide"]))?.source, "x");
```

- [ ] **Step 2: Write migration RED tests for every legacy key family**

Seed `problem-{id}-language`, `problem-{id}-code-{language}`, `problem-{id}-custom-tests`, `executor-language`, `executor-code-{language}`, and `solved-problems`. Assert RustPython maps to language `python` plus runtime `python-rustpython`, standard Python maps to `python-pyodide`, executor uses workspace `executor`, and solved IDs become accepted progress. Run migration twice and assert no duplicates/attempt inflation. Inject a failed transaction and assert migration meta is absent and old keys remain.

- [ ] **Step 3: Run storage tests and verify RED**

Run:

```powershell
npm test -- tests/storage/repository.test.ts tests/storage/legacy-migration.test.ts tests/storage/fallback.test.ts
```

Expected: missing storage contracts/repository.

- [ ] **Step 4: Define native DB schema and transaction boundary**

```ts
export const DB_NAME = "localcoder";
export const DB_VERSION = 1;
export type StoreName = "drafts" | "customCases" | "submissions" | "progress" | "settings" | "meta";
export interface DatabaseDriver {
  transaction<T>(stores: readonly StoreName[], mode: "readonly" | "readwrite", work: (tx: TransactionView) => Promise<T>): Promise<T>;
  close(): void;
}
export interface TransactionView {
  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined>;
  getAll<T>(store: StoreName): Promise<readonly T[]>;
  put<T>(store: StoreName, value: T, key?: IDBValidKey): Promise<IDBValidKey>;
  add<T>(store: StoreName, value: T): Promise<IDBValidKey>;
  delete(store: StoreName, key: IDBValidKey): Promise<void>;
  count(store: StoreName): Promise<number>;
}
export type StorageState =
  | { kind: "persistent" }
  | { kind: "memory"; message: "未保存"; reason: string };
export interface DraftRecord { workspaceId: string; languageId: LanguageId; runtimeId: RuntimeId; source: string; updatedAt: number }
export interface SettingsRecord {
  key: "app";
  theme: "light" | "dark" | "system";
  preferredRuntimeByLanguage: Partial<Record<LanguageId, RuntimeId>>;
  layout: { desktopProblemPercent: number; tabletTab: "problem" | "code" };
  updatedAt: number;
}
export interface ProgressRecord {
  problemId: number;
  attempts: number;
  lastAttemptAt: number;
  acceptedAt?: number;
  acceptedLanguageId?: LanguageId;
  acceptedRuntimeId?: RuntimeId;
}
export interface CaseCountSummary { total: number; passed: number; failed: number }
export interface SubmissionRecord {
  id?: number;
  problemId: number;
  languageId: LanguageId;
  runtimeId: RuntimeId;
  runtimeVersion: string;
  buildId: string;
  source: string;
  verdict: Verdict;
  elapsedMs: number;
  caseSummary: { public: CaseCountSummary; custom: CaseCountSummary; judge: CaseCountSummary };
  output: { stdout: string; stderr: string; truncated: boolean };
  createdAt: number;
}
export interface SubmissionQuery { problemId?: number; runtimeId?: RuntimeId; verdicts?: readonly Verdict[]; limit?: number }
export interface AtomicSubmissionWrite { submission: Omit<SubmissionRecord, "id">; progress?: ProgressRecord }
export interface LegacyImportBatch {
  drafts: readonly DraftRecord[];
  customCases: readonly { problemId: number; cases: readonly ProblemCase[]; updatedAt: number }[];
  settings?: SettingsRecord;
  progress: readonly ProgressRecord[];
  migrationVersion: 1;
}
```

`indexeddb-driver.ts` creates exactly: `drafts` with key path `[workspaceId, languageId, runtimeId]`; `customCases` key path `problemId`; `submissions` key path `id` with auto-increment plus indices `createdAt`, `problemId`, `runtimeId`, and `verdict`; `progress` key path `problemId`; `settings` key path `key`; and `meta` key path `key`. Resolve a transaction only on `oncomplete`; abort/reject on request error, transaction error, or quota error. Components never receive `IDBDatabase`/transactions.

- [ ] **Step 5: Implement repository operations and atomic history trimming**

```ts
export interface LocalCoderRepository {
  readonly storageState: StorageState;
  subscribeStorageState(listener: (state: StorageState) => void): () => void;
  getDraft(key: readonly [string, LanguageId, RuntimeId]): Promise<DraftRecord | undefined>;
  listDrafts(): Promise<readonly DraftRecord[]>;
  saveDraft(record: DraftRecord): Promise<void>;
  getCustomCases(problemId: number): Promise<readonly ProblemCase[]>;
  saveCustomCases(problemId: number, cases: readonly ProblemCase[]): Promise<void>;
  getSettings(): Promise<SettingsRecord>;
  saveSettings(settings: SettingsRecord): Promise<void>;
  getProgress(problemId: number): Promise<ProgressRecord | undefined>;
  listProgress(): Promise<readonly ProgressRecord[]>;
  listSubmissions(query?: SubmissionQuery): Promise<readonly SubmissionRecord[]>;
  recordSubmission(input: AtomicSubmissionWrite): Promise<number>;
  importLegacyState(batch: LegacyImportBatch): Promise<void>;
  close(): void;
}
export function openLocalCoderRepository(options: { indexedDB?: IDBFactory; legacyStorage?: Storage; now?: () => number }): Promise<LocalCoderRepository>;
```

`recordSubmission` writes the new submission, conditionally updates progress, counts submissions, and deletes oldest overflow in one readwrite transaction.

- [ ] **Step 6: Implement idempotent migration and honest fallback**

```ts
export async function runLegacyMigration(options: {
  repository: LocalCoderRepository;
  legacy: Pick<Storage, "getItem" | "key" | "length">;
  now: () => number;
}): Promise<{ state: "migrated" | "already-migrated"; imported: number }>;
```

Read/validate legacy values into one `LegacyImportBatch`, then `importLegacyState` commits data plus `meta["legacyMigrationVersion"] = 1` in one transaction. Never delete old values in DB version 1. `openLocalCoderRepository` falls back to `MemoryDriver` for missing IDB, open errors, blocked upgrades, quota failures, or transaction failures, preserves session work, and emits persistent `未保存` state with the cause.

Add `storage-harness.html` as a Vite input. It exposes only the repository contract for browser QA:

```ts
export interface StorageHarnessApi {
  state(): StorageState;
  seedLegacy(entries: Readonly<Record<string, string>>): Promise<void>;
  migrate(): Promise<{ state: "migrated" | "already-migrated"; imported: number }>;
  snapshot(): Promise<{ drafts: readonly DraftRecord[]; progress: readonly ProgressRecord[]; submissions: readonly SubmissionRecord[]; settings: SettingsRecord }>;
  recordSubmissions(records: readonly Omit<SubmissionRecord, "id">[]): Promise<void>;
  close(): void;
}
declare global { interface Window { localCoderStorageHarness: StorageHarnessApi } }
```

The harness is excluded from product navigation and has no direct IDB calls beyond `openLocalCoderRepository`.

- [ ] **Step 7: Make repository, migration, and fallback tests GREEN**

Run:

```powershell
npm test -- tests/storage/repository.test.ts tests/storage/legacy-migration.test.ts tests/storage/fallback.test.ts
npm run typecheck
```

Expected: all store/migration/cap/fallback tests pass; no test imports an IndexedDB package; old keys are retained.

- [ ] **Step 8: Verify native IndexedDB in a real browser**

Using browser MCP against `storage-harness.html`, seed representative legacy keys before boot, reload, inspect `localcoder` DB/version/stores and migrated records, reload again to prove idempotency, then block/disable storage in a fresh context and verify work continues with persistent `未保存`. Record both persistent and fallback evidence.

- [ ] **Step 9: Prepare the review boundary**

Prepare storage modules/tests and suggest `feat: persist and migrate local practice state`. Do not execute the commit.

### Task 13: Make Submit atomically update progress while Run remains non-mutating

**Files:**
- Create: `src/services/submission-service.ts`
- Create: `src/services/app-services.ts`
- Create: `tests/services/submission-service.test.ts`
- Create: `tests/services/app-services.test.ts`

**Interfaces:**
- Consumes: `OjEngine`, `LocalCoderRepository.recordSubmission`, `RuntimeAdapterRegistry`, `RuntimeRegistry`, and problem repository.
- Produces: `SubmissionService.run()`, `SubmissionService.submit()`, `AppServices`, and one composition root for UI tasks.

- [ ] **Step 1: Write service RED tests around the Run/Submit distinction**

```ts
const runOutcome = await service.run(command);
assert.equal(runOutcome.result.verdict, "accepted");
assert.equal(repository.recordSubmissionCalls.length, 0);

const submitOutcome = await service.submit(command);
assert.equal(submitOutcome.result.verdict, "accepted");
assert.deepEqual(repository.recordSubmissionCalls[0]?.progress, {
  problemId: 1,
  attempts: 1,
  lastAttemptAt: now,
  acceptedLanguageId: "javascript",
  acceptedRuntimeId: "javascript-worker",
  acceptedAt: now,
});
```

Also assert WA/CE/RE/TLE submissions increment attempts and are recorded but do not overwrite an earlier accepted runtime/time; cancelled runs are not persisted; a failed repository transaction returns a saved-state warning without changing the already-computed verdict.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npm test -- tests/services/submission-service.test.ts tests/services/app-services.test.ts
```

Expected: missing service/composition exports.

- [ ] **Step 3: Implement explicit Run and Submit methods**

```ts
export class SubmissionService {
  constructor(options: { engine: OjEngine; repository: LocalCoderRepository; now: () => number });
  run(command: Omit<JudgeCommand, "mode">): Promise<SubmissionOutcome>;
  submit(command: Omit<JudgeCommand, "mode">): Promise<SubmissionOutcome>;
}
export interface SubmissionOutcome {
  result: SubmissionResult;
  persistence: { state: "not-requested" | "saved" | "memory-only" | "failed"; message?: string };
}
```

`run` invokes mode `run` and makes no progress/submission write. `submit` invokes mode `submit`, builds a source-snapshot record after execution, and calls exactly one `recordSubmission`; accepted progress and submission therefore share the repository transaction.

- [ ] **Step 4: Compose services once without importing React into core**

```ts
export interface AppServices {
  problems: ProblemRepository;
  registry: RuntimeRegistry;
  supervisor: RuntimeSupervisor;
  adapters: RuntimeAdapterRegistry;
  engine: OjEngine;
  storage: LocalCoderRepository;
  submissions: SubmissionService;
}
export interface AppServiceDependencies {
  problems?: ProblemRepository;
  manifestUrl?: string;
  fetchJson?: (url: string) => Promise<unknown>;
  workerFactory?: WorkerFactory;
  indexedDB?: IDBFactory;
  legacyStorage?: Storage;
  clock?: Clock;
  now?: () => number;
}
export async function createAppServices(deps?: AppServiceDependencies): Promise<AppServices>;
```

Composition order is problem repository (injected in Node tests; dynamically imported from `problem-modules.ts` in browser) + manifest fetch/parse → Registry → Supervisor → adapters → Engine → storage open/migration → SubmissionService. A required manifest failure rejects application readiness; optional failures stay represented in Registry.

- [ ] **Step 5: Make service tests GREEN and rerun atomic storage tests**

Run:

```powershell
npm test -- tests/services/submission-service.test.ts tests/services/app-services.test.ts
npm test -- tests/storage/repository.test.ts
```

Expected: Run never writes solved state; Submit records each terminal judged attempt; accepted progress/submission are atomic; storage warnings remain explicit.

- [ ] **Step 6: Prepare the review boundary**

Prepare services/tests and suggest `feat: add atomic run and submit service`. Do not execute the commit.

### Task 14: Apply the DESIGN.md system to the app shell and runtime status surfaces

**Files:**
- Create: `src/app/AppProviders.tsx`
- Create: `src/app/ThemeProvider.tsx`
- Create: `src/app/routes.tsx`
- Create: `src/components/app/AppShell.tsx`
- Create: `src/components/app/AppNav.tsx`
- Create: `src/components/app/StorageStatus.tsx`
- Create: `src/components/app/AppErrorFallback.tsx`
- Create: `src/features/runtimes/runtime-view-model.ts`
- Create: `src/features/runtimes/RuntimeRail.tsx`
- Create: `src/features/runtimes/RuntimeSelector.tsx`
- Create: `src/features/runtimes/RuntimeDetailsDialog.tsx`
- Create: `src/hooks/use-app-services.ts`
- Create: `src/hooks/use-runtime-registry.ts`
- Create: `src/hooks/use-storage-state.ts`
- Create: `src/styles/tokens.css`
- Create: `src/styles/foundations.css`
- Create: `src/styles/layout.css`
- Create: `tests/ui/runtime-view-model.test.ts`
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/ThemeToggle.tsx`
- Modify: `src/components/CodeEditor.tsx`
- Modify: `src/components/ui/button.tsx`
- Modify: `src/components/ui/select.tsx`
- Delete after imports move: `src/ErrorFallback.tsx`
- Delete after imports move: `src/main.css`
- Delete after imports move: `src/index.css`
- Delete after imports move: `src/styles/theme.css`

**Interfaces:**
- Consumes: `createAppServices`, Registry snapshots/states, repository `StorageState`/`SettingsRecord`, current router, and every token/interaction rule in `/DESIGN.md`.
- Produces: one `AppServicesProvider`, stable app shell/navigation, capability-derived runtime controls, persistent storage warning, and reusable design tokens.

- [ ] **Step 1: Write runtime/status view-model RED tests**

```ts
assert.deepEqual(toRuntimeOption(notPackagedRacket), {
  value: "racket-wasm",
  label: "Racket",
  statusLabel: "不可用",
  disabled: true,
  reason: "缺少 racket/racket.js, racket/racket.wasm",
});
assert.equal(toRuntimeOption(readyPyodide).disabled, false);
assert.equal(toRuntimeRailItem(runningJs).ariaLive, "JavaScript 正在本地执行");
assert.equal(toStorageBanner({ kind: "memory", message: "未保存", reason: "quota" }).persistent, true);
```

Test all Registry states, verdict/status text plus icon tokens, failure copy, and no use of “sandbox”, “hidden tests”, or readiness claims for unavailable runtimes.

- [ ] **Step 2: Run the view-model suite and verify RED**

Run:

```powershell
npm test -- tests/ui/runtime-view-model.test.ts
```

Expected: missing runtime view-model exports.

- [ ] **Step 3: Implement semantic view models and React service hooks**

```ts
export interface RuntimeOptionModel {
  value: RuntimeId;
  label: string;
  statusLabel: string;
  disabled: boolean;
  reason?: string;
}
export interface RuntimeRailItemModel {
  runtimeId: RuntimeId;
  label: string;
  state: RuntimeCapabilityState["kind"];
  statusLabel: string;
  tone: "neutral" | "info" | "success" | "warning" | "error";
  ariaLive: string;
}
export interface StorageBannerModel { label: "未保存"; reason: string; persistent: true }
export function toRuntimeOption(capability: RuntimeCapability, purpose: "execute" | "judge"): RuntimeOptionModel;
export function toRuntimeRailItem(capability: RuntimeCapability): RuntimeRailItemModel;
export function toStorageBanner(state: StorageState): StorageBannerModel | null;
```

`useRuntimeRegistry` subscribes with `useSyncExternalStore`; selectors render `registry.forLanguage(...)` and contain no local language array. `AppProviders` owns one asynchronous service boot, exposes stable loading/fatal states, and closes Supervisor/storage during teardown. The local `ThemeProvider` loads `SettingsRecord.theme`, applies the `light`/`dark` root class, follows system changes only in `system` mode, and persists theme changes back through the repository; remove the `next-themes` wrapper so settings do not bypass the storage boundary.

- [ ] **Step 4: Consolidate all visual tokens exactly once**

`tokens.css` defines the light/dark semantic OKLCH values from DESIGN.md (`--surface-*`, `--text-*`, `--border-*`, `--accent-*`, `--status-*`, `--focus-ring`), spacing 1/2/3/4/5/6/8/10/12/16, typography, radius, and motion durations. `foundations.css` maps shadcn aliases to those semantic tokens, applies `min-height:100dvh`, visible `:focus-visible`, contrast-safe status styling, and reduced-motion overrides. `layout.css` contains only shell/workspace breakpoints and never `100vh`/`h-screen`, gradients, hover lift, or undeclared shadows.

- [ ] **Step 5: Compose the shell, runtime rail/details, and LocalCoder recovery boundary**

```tsx
<AppShell
  navigation={<AppNav />}
  runtimeRail={<RuntimeRail items={runtimeItems} aria-live="polite" />}
  storageStatus={<StorageStatus model={storageBanner} />}
>
  <Outlet />
</AppShell>
```

At this stage the nav exposes Home, Problems, Executor, theme, and runtime details; Task 18 adds Submissions only when its route exists. Runtime details show packaged/loadable/ready/failed/incompatible plus exact reasons. Error recovery says LocalCoder failed to load, provides safe Home/Reload actions, and never rethrows only because development mode is active. CodeMirror colors reference semantic tokens, supports `Escape` then `Tab` to move focus out, and preserves standard shortcuts.

- [ ] **Step 6: Make tests/type/lint GREEN**

Run:

```powershell
npm test -- tests/ui/runtime-view-model.test.ts
npm run typecheck
npm run lint
```

Expected: view models pass, old triple token imports are gone, and strict/lint remain zero-warning.

- [ ] **Step 7: Verify the real shell at target states and widths**

Using browser MCP, inspect light/dark at 375, 768, and 1280px; keyboard through nav/theme/runtime dialog; close the dialog and verify focus restoration; emulate reduced motion; inspect unavailable optional reason and forced memory-storage `未保存`. Record screenshots/DOM evidence and confirm no horizontal document overflow.

- [ ] **Step 8: Prepare the review boundary**

Prepare shell/providers/runtime surfaces/tokens/tests and suggest `feat: build local workbench app shell`. Do not execute the commit.

### Task 15: Deliver a progress-first Home and filterable semantic problem catalogue

**Files:**
- Create: `src/features/home/home-view-model.ts`
- Create: `src/features/home/ProgressSummary.tsx`
- Create: `src/features/problems/problem-list-model.ts`
- Create: `src/features/problems/ProblemFilters.tsx`
- Create: `src/features/problems/ProblemTable.tsx`
- Create: `tests/ui/home-view-model.test.ts`
- Create: `tests/ui/problem-list-model.test.ts`
- Modify: `src/pages/HomePage.tsx`
- Modify: `src/pages/ProblemsPage.tsx`
- Delete after route migration: `src/components/ProblemList.tsx`

**Interfaces:**
- Consumes: validated problems, repository `listProgress()`, submissions metadata, app shell routes.
- Produces: `buildHomeSummary(problems, progress, submissions)`, `filterProblems(problems, progress, query)`, and accessible Home/Problems product surfaces.

- [ ] **Step 1: Write Home and catalogue model RED tests**

```ts
assert.deepEqual(buildHomeSummary(problems, progress, submissions), {
  solved: 2,
  attempted: 3,
  total: 6,
  recentProblemId: 4,
  runtimeSummary: [{ runtimeId: "javascript-worker", accepted: 2 }],
});
assert.deepEqual(
  filterProblems(problems, progress, { text: "array", difficulty: ["Easy"], status: "attempted" }).map((p) => p.id),
  [1, 5],
);
```

Cover empty state, no stale accepted status, tag/title search, difficulty/status filters, deterministic ID sort, accepted language/runtime, and last-attempt display.

- [ ] **Step 2: Run focused model tests and verify RED**

Run:

```powershell
npm test -- tests/ui/home-view-model.test.ts tests/ui/problem-list-model.test.ts
```

Expected: missing model exports.

- [ ] **Step 3: Implement pure summaries/filters and repository-backed page loading**

```ts
export interface HomeSummaryModel {
  solved: number;
  attempted: number;
  total: number;
  recentProblemId?: number;
  runtimeSummary: readonly { runtimeId: RuntimeId; accepted: number }[];
}
export interface ProblemFilter {
  text: string;
  difficulty: readonly Problem["difficulty"][];
  status: "all" | "unattempted" | "attempted" | "solved";
}
export interface ProblemRowModel {
  id: number;
  slug: string;
  title: string;
  difficulty: Problem["difficulty"];
  tags: readonly string[];
  status: "unattempted" | "attempted" | "solved";
  acceptedLanguageId?: LanguageId;
  acceptedRuntimeId?: RuntimeId;
  lastAttemptAt?: number;
}
export function buildHomeSummary(
  problems: readonly Problem[],
  progress: readonly ProgressRecord[],
  submissions: readonly SubmissionRecord[],
): HomeSummaryModel;
export function filterProblems(
  problems: readonly Problem[],
  progress: readonly ProgressRecord[],
  filter: ProblemFilter,
): readonly ProblemRowModel[];
```

Pages read through app services/hooks, expose stable loading/error/empty states, and keep filters in component state only. They do not read `localStorage` or IndexedDB directly.

- [ ] **Step 4: Render the selected DESIGN.md information hierarchy**

Home uses one concise title, local progress metrics, recent-work continuation, and direct Problems/Executor actions—no feature-card marketing grid. Problems uses a semantic `<table>` at desktop and equivalent labelled rows below 640px; each row includes ID/title, difficulty text, tags, unattempted/attempted/solved text+icon, accepted language/runtime, and last attempt. Row activation works with Enter/Space and a normal route link.

- [ ] **Step 5: Make focused tests and quality gates GREEN**

Run:

```powershell
npm test -- tests/ui/home-view-model.test.ts tests/ui/problem-list-model.test.ts
npm run typecheck
npm run lint
```

Expected: all summary/filter cases pass; no legacy `solved-problems` read remains in these pages.

- [ ] **Step 6: Verify real loading/empty/populated/filter states**

With browser MCP, clear DB for empty progress, then use `storage-harness.html` repository calls to seed attempted/accepted submissions and reload the product routes. Verify Home totals/recent link and Problems filters at 375/768/1280px, keyboard row activation, status not conveyed by color alone, and no generic marketing cards.

- [ ] **Step 7: Prepare the review boundary**

Prepare Home/catalogue slices/tests and suggest `feat: add progress and problem catalogue`. Do not execute the commit.

### Task 16: Deliver the responsive problem workspace with distinct Run and Submit flows

**Files:**
- Create: `src/features/problems/workspace-controller.ts`
- Create: `src/features/problems/use-problem-workspace.ts`
- Create: `src/features/problems/ProblemWorkspace.tsx`
- Create: `src/features/problems/WorkspaceToolbar.tsx`
- Create: `src/features/problems/ProblemStatementPanel.tsx`
- Create: `src/features/problems/WorkspaceEditorPanel.tsx`
- Create: `src/features/problems/CaseEditorPanel.tsx`
- Create: `src/features/problems/ResultPanel.tsx`
- Create: `src/features/problems/RecentProblemSubmissions.tsx`
- Create: `tests/ui/problem-workspace-controller.test.ts`
- Modify: `src/pages/ProblemEditorPage.tsx`
- Modify: `src/components/CodeEditor.tsx`
- Delete after route migration: `src/components/EditorView.tsx`
- Delete after route migration: `src/components/ProblemDescription.tsx`
- Delete after route migration: `src/components/TestCaseManager.tsx`
- Delete after route migration: `src/components/TestResults.tsx`

**Interfaces:**
- Consumes: problem repository, Registry selectors, `SubmissionService`, storage draft/custom/settings/submission APIs, and `CodeEditor`.
- Produces: `ProblemWorkspaceController`, `useProblemWorkspace(problemId)`, explicit Run/Submit/Cancel actions, and restored workspace state.

- [ ] **Step 1: Write controller RED tests for restore, selection, autosave, and actions**

Use injected services/manual clock and assert:

```ts
await controller.load(1);
assert.equal(controller.snapshot.source, savedDraft.source);
controller.edit("new source");
clock.tick(300);
assert.equal(repository.savedDrafts.at(-1)?.runtimeId, "typescript-official");

await controller.run();
assert.equal(submissionService.runCalls.length, 1);
assert.equal(submissionService.submitCalls.length, 0);
await controller.submit();
assert.equal(submissionService.submitCalls.length, 1);
```

Cover template fallback, runtime preference invalidated by unavailability, custom JSON validation, max 100 cases, save failure → persistent `未保存`, Run no progress mutation, Submit accepted refreshes progress/recent list, cancellation, TLE followed by successful rerun, route problem-not-found, and stale async result ignored after language/runtime switch.

- [ ] **Step 2: Run controller tests and verify RED**

Run:

```powershell
npm test -- tests/ui/problem-workspace-controller.test.ts
```

Expected: missing workspace controller.

- [ ] **Step 3: Implement a service-driven state machine outside React**

```ts
export type WorkspacePhase = "loading" | "ready" | "running" | "submitting" | "cancelling" | "error";
export interface WorkspaceDependencies {
  problems: ProblemRepository;
  registry: RuntimeRegistry;
  submissions: SubmissionService;
  storage: LocalCoderRepository;
  clock: Clock;
}
export interface ProblemWorkspaceSnapshot {
  phase: WorkspacePhase;
  problem?: Problem;
  runtimeId?: RuntimeId;
  languageId?: LanguageId;
  runtimeOptions: readonly RuntimeOptionModel[];
  source: string;
  customCases: readonly ProblemCase[];
  result?: SubmissionResult;
  recentSubmissions: readonly SubmissionRecord[];
  storageState: StorageState;
  error?: string;
}
export class ProblemWorkspaceController {
  constructor(deps: WorkspaceDependencies);
  readonly snapshot: ProblemWorkspaceSnapshot;
  load(problemId: number): Promise<void>;
  selectRuntime(runtimeId: RuntimeId): Promise<void>;
  edit(source: string): void;
  replaceCustomCases(cases: readonly ProblemCase[]): Promise<void>;
  run(): Promise<void>;
  submit(): Promise<void>;
  cancel(): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ProblemWorkspaceSnapshot;
  dispose(): void;
}
```

Use operation generations to ignore stale load/run results, debounce draft writes at 300ms with a flush on dispose/runtime switch, and source runtime options exclusively from Registry. The hook wraps `useSyncExternalStore`; React components contain presentation/interaction only.

- [ ] **Step 4: Build separate public/custom/judge result presentations**

Run passes public+custom and never changes solved state. Submit includes judge cases through the service; `ResultPanel` renders public/custom details and judge count only. Verdict badges cover AC/WA/CE/RE/TLE/cancelled/internal/unavailable with text+icon; output truncation is explicit. Custom case inputs/expected values are JSON editors validated by `validateJsonValue` before persistence.

- [ ] **Step 5: Implement responsive workspace composition and accessible controls**

Desktop uses 36% statement / 64% editor+results resizable panels and persists layout in settings. Tablet uses “题目”/“代码” tabs with results below editor. Mobile uses one-column tabs and a sticky Run/Submit/Cancel action bar. Resize handles have keyboard alternatives; loading dimensions remain stable; editor focus escape is documented in nearby assistive text.

- [ ] **Step 6: Make controller and quality gates GREEN**

Run:

```powershell
npm test -- tests/ui/problem-workspace-controller.test.ts
npm run typecheck
npm run lint
```

Expected: restore/autosave/action/cancel/recovery cases pass and no workspace component imports legacy storage or Worker manager.

- [ ] **Step 7: Exercise RED → GREEN → real user flows in browser**

At all three widths with browser MCP:

1. open problem 1, edit each required language draft, switch away/back, and reload to prove restore;
2. add a custom case, Run a correct solution, verify solved count unchanged;
3. Submit it, verify AC/progress/recent submission and judge count-only result;
4. run a wrong solution for WA;
5. run syntax/runtime failures for CE/RE and then a valid source;
6. run JavaScript infinite loop for TLE, observe Worker termination, then submit valid source successfully;
7. cancel a running session and verify normal cancelled state without error toast.

Record verdicts, runtime/build identity, database records, keyboard flow, and no overflow.

- [ ] **Step 8: Prepare the review boundary**

Prepare workspace/controller/components/tests and suggest `feat: add judged problem workspace`. Do not execute the commit.

### Task 17: Deliver capability-aware free execution without an application API

**Files:**
- Create: `src/features/executor/executor-controller.ts`
- Create: `src/features/executor/use-executor.ts`
- Create: `src/features/executor/executor-presets.ts`
- Create: `src/features/executor/ExecutorWorkspace.tsx`
- Create: `src/features/executor/ExecutorOutput.tsx`
- Create: `tests/ui/executor-controller.test.ts`
- Modify: `src/pages/ExecutorPage.tsx`
- Delete after route migration: `src/components/ExecutorView.tsx`

**Interfaces:**
- Consumes: Registry execute capabilities, Runtime adapters `execute`, executor drafts/settings storage, Supervisor cancellation.
- Produces: `ExecutorController`, `useExecutor()`, normalized stdout/stderr/value UI, and capability-aware free execution.

- [ ] **Step 1: Write executor-controller RED tests**

```ts
await controller.load();
assert.equal(controller.snapshot.runtimeId, "javascript-worker");
await controller.execute();
assert.deepEqual(controller.snapshot.output, {
  stdout: "hello\n",
  stderr: "",
  value: 3,
  truncated: false,
});
```

Cover per-runtime draft restore, preset only when no draft exists, unavailable selection blocked with reason, initializing/running/cancelled/error/success states, output truncation, stale result suppression, and cancellation followed by successful execute.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npm test -- tests/ui/executor-controller.test.ts
```

Expected: missing controller/preset exports.

- [ ] **Step 3: Implement free-execution orchestration separately from OJ judging**

```ts
export interface ExecutorDependencies {
  registry: RuntimeRegistry;
  adapters: RuntimeAdapterRegistry;
  storage: LocalCoderRepository;
  clock: Clock;
}
export interface ExecutorSnapshot {
  phase: "loading" | "ready" | "initializing" | "running" | "cancelling" | "cancelled" | "error";
  runtimeId?: RuntimeId;
  languageId?: LanguageId;
  runtimeOptions: readonly RuntimeOptionModel[];
  source: string;
  output?: { stdout: string; stderr: string; value: JsonValue | null; truncated: boolean };
  elapsedMs?: number;
  storageState: StorageState;
  error?: string;
}
export class ExecutorController {
  constructor(deps: ExecutorDependencies);
  readonly snapshot: ExecutorSnapshot;
  load(): Promise<void>;
  selectRuntime(runtimeId: RuntimeId): Promise<void>;
  edit(source: string): void;
  execute(): Promise<void>;
  cancel(): void;
  clearOutput(): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ExecutorSnapshot;
  dispose(): void;
}
```

Use adapter `execute` only; do not invent expected values/verdicts. Presets are keyed by `LanguageId`, while persisted drafts include `RuntimeId`. Selector uses only entries whose `capabilities.execute` is true and keeps unavailable entries disabled with reasons.

- [ ] **Step 4: Build the workbench executor UI**

Render editor and output panels with stable dimensions, explicit stdout/stderr/value sections, elapsed local-reference label, truncation marker, Execute/Cancel/Clear actions, runtime rail, and persistent save status. Tablet/mobile stack panels without horizontal document overflow.

- [ ] **Step 5: Make focused tests and quality gates GREEN**

Run:

```powershell
npm test -- tests/ui/executor-controller.test.ts
npm run typecheck
npm run lint
```

Expected: all state/restore/cancel tests pass and the executor contains no copied language list or `localStorage` call.

- [ ] **Step 6: Prove static, local free execution in the browser**

Using browser MCP, load the app and selected required runtime assets, execute JS/TS/Python output/value scenarios, then block all requests except already-loaded static resources (or switch the browser context offline without reloading). Execute again in the existing session and verify no application API request is attempted. Exercise cancel/recovery and unavailable optional selector copy at 375/768/1280px.

- [ ] **Step 7: Prepare the review boundary**

Prepare executor/controller/tests and suggest `feat: add capability aware executor`. Do not execute the commit.

### Task 18: Deliver bounded local submission history with source inspection

**Files:**
- Create: `src/features/submissions/submission-list-model.ts`
- Create: `src/features/submissions/use-submissions.ts`
- Create: `src/features/submissions/SubmissionHistory.tsx`
- Create: `src/features/submissions/SubmissionFilters.tsx`
- Create: `src/features/submissions/SubmissionDetailDialog.tsx`
- Create: `src/pages/SubmissionsPage.tsx`
- Create: `tests/ui/submission-list-model.test.ts`
- Modify: `src/app/routes.tsx`
- Modify: `src/components/app/AppNav.tsx`

**Interfaces:**
- Consumes: repository `listSubmissions`, validated problem metadata, Registry language/runtime display metadata, storage state.
- Produces: `buildSubmissionRows(records, problems, filter)`, `/submissions`, local filters, and read-only source/result inspection.

- [ ] **Step 1: Write submission-list model RED tests**

```ts
const rows = buildSubmissionRows(records, problems, { verdicts: ["accepted"], problemId: 1 });
assert.deepEqual(rows.map((row) => row.submissionId), [202, 199]);
assert.equal(rows[0]?.runtimeLabel, "JavaScript / javascript-worker");
assert.equal(rows[0]?.elapsedLabel, "12 ms（本机参考）");
```

Cover newest-first sorting, problem/runtime/verdict filters, unknown migrated problem fallback, all verdict labels, empty state, memory-only warning, source snapshot immutability, and judge details remaining count-only.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npm test -- tests/ui/submission-list-model.test.ts
```

Expected: missing model export.

- [ ] **Step 3: Implement model/hook and product route**

```ts
export interface SubmissionFilter {
  problemId?: number;
  runtimeId?: RuntimeId;
  verdicts: readonly Verdict[];
}
export interface SubmissionRowModel {
  submissionId: number;
  problemLabel: string;
  runtimeLabel: string;
  verdict: Verdict;
  verdictLabel: string;
  elapsedLabel: string;
  createdAt: number;
  source: string;
  buildId: string;
  caseSummary: SubmissionRecord["caseSummary"];
  output: SubmissionRecord["output"];
}
export function buildSubmissionRows(
  records: readonly SubmissionRecord[],
  problems: readonly Problem[],
  filter: SubmissionFilter,
): readonly SubmissionRowModel[];
```

The hook queries only the repository and refreshes after the submission service emits a saved event. Detail dialog shows read-only source, runtime/build, verdict, elapsed local-reference value, public/custom summaries, judge count, output truncation, and timestamp; it never reconstructs hidden judge values.

- [ ] **Step 4: Make focused tests and quality gates GREEN**

Run:

```powershell
npm test -- tests/ui/submission-list-model.test.ts
npm run typecheck
npm run lint
```

Expected: filters/labels/details pass and `/submissions` compiles in both BrowserRouter and HashRouter builds.

- [ ] **Step 5: Verify empty, populated, filtered, capped, and fallback states**

With browser MCP, inspect empty history, create AC/WA/CE/RE/TLE entries through Submit, filter them, inspect source, and use `window.localCoderStorageHarness.recordSubmissions(...)` on `storage-harness.html` to insert 201 records through the repository and verify only 200 remain. Force memory storage and confirm `未保存` stays visible while session entries remain usable.

- [ ] **Step 6: Prepare the review boundary**

Prepare history route/components/model/tests and suggest `feat: add local submission history`. Do not execute the commit.

### Task 19: Gate and migrate Racket without a JavaScript-syntax fallback

**Files:**
- Create: `src/runtime/optional-verification.ts`
- Create: `src/runtime/contracts/runtime-contract-cases.ts`
- Create: `src/runtime/adapters/racket.ts`
- Create: `src/workers/racket/json-bridge.ts`
- Create: `src/workers/racket/emscripten-host.ts`
- Create: `src/workers/racket.worker.ts`
- Create: `scripts/verify-optional-runtime.mjs`
- Create: `scripts/runtime-verification-server.mjs`
- Create: `tests/runtime/optional-verification.test.ts`
- Create: `tests/runtime/racket-adapter.test.ts`
- Create: `tests/workers/racket-bridge.test.ts`
- Modify: `scripts/build-worker-assets.mjs`
- Modify: `scripts/build-runtimes.mjs`
- Modify: `scripts/lib/runtime-catalog.mjs`
- Modify: `src/services/app-services.ts`
- Modify: `tests/services/app-services.test.ts`
- Modify: `src/harness/runtime-contract-harness.ts`
- Modify: `src/features/runtimes/RuntimeDetailsDialog.tsx`
- Generate/replace: `public/racket-worker.js`

**Interfaces:**
- Consumes: Registry/Supervisor, protocol endpoint, optional artifact classification, Racket Emscripten assets when present.
- Produces: `OptionalRuntimeVerifier.verify(runtimeId)`, `createRacketAdapter(supervisor)`, browser receipt verification, dedicated JSON↔Racket bridge, and the exact states `verified | unavailable | broken`.

- [ ] **Step 1: Write RED tests for the optional-runtime gate itself**

```ts
const absent = await verifier.verify("racket-wasm");
assert.deepEqual(absent, { state: "unavailable", runtimeId: "racket-wasm", reason: "missing racket/racket.js, racket/racket.wasm" });
assert.equal(registry.get("racket-wasm").state.kind, "not-packaged");

const failedSmoke = await packagedVerifier.verify("racket-wasm");
assert.equal(failedSmoke.state, "broken");
assert.equal(registry.get("racket-wasm").state.kind, "failed");
```

A verified path must require, in order, packaged non-empty assets, protocol handshake/version, free-execution smoke, and judge-contract actual value; only then may Registry reach `ready`. A missing runtime is asserted as `unavailable`, never skipped/passed.

- [ ] **Step 2: Write Racket bridge/adapter RED tests**

Test nested objects/arrays, booleans, null, escaping, Unicode, invalid result, runtime exception, and no expected value in Worker output. Assert wrapper source contains `string->jsexpr`, `jsexpr->string`, and `(solution __lc_input)`, and does not convert JavaScript expressions or compare values.

```ts
const program = buildRacketJudgeProgram(userSource, JSON.stringify({ text: "a\"b", list: [1, null] }));
assert.match(program, /string->jsexpr/);
assert.doesNotMatch(program, /stableStringify|expected|passed/);
```

- [ ] **Step 3: Run optional/Racket tests and verify RED**

Run:

```powershell
npm test -- tests/runtime/optional-verification.test.ts tests/runtime/racket-adapter.test.ts tests/workers/racket-bridge.test.ts
```

Expected: missing verifier/adapter/bridge exports.

- [ ] **Step 4: Implement the shared optional verification state machine**

```ts
export type RuntimeVerification =
  | { state: "verified"; runtimeId: RuntimeId; runtimeVersion: string; checks: readonly RuntimeVerificationCheck[] }
  | { state: "unavailable"; runtimeId: RuntimeId; reason: string }
  | { state: "broken"; runtimeId: RuntimeId; code: string; message: string };
export type RuntimeVerificationCheck = "assets" | "handshake" | "smoke" | "judge-contract" | "pyodide-corpus-parity";
export class OptionalRuntimeVerifier {
  constructor(options: { registry: RuntimeRegistry; supervisor: RuntimeSupervisor; adapters: RuntimeAdapterRegistry });
  verify(runtimeId: RuntimeId): Promise<RuntimeVerification>;
}
```

For a packaged optional runtime, run the language-specific smoke source/case from `runtime-contract-cases.ts`. A failed/mismatched check terminates the Worker and leaves it disabled. RuntimeDetailsDialog may expose “验证运行时” for packaged/loadable optionals; selectors remain disabled until the current session reaches verified/ready.

- [ ] **Step 5: Implement the Racket host with fresh files/namespaces**

```ts
export interface RacketModule {
  FS: { writeFile(path: string, contents: string): void; unlink(path: string): void };
  callMain(args: readonly string[]): number | void;
  print: (text: string) => void;
  printErr: (text: string) => void;
}
export function buildRacketJudgeProgram(source: string, inputJson: string): string;
export function createRacketHost(options: { loadModule: () => Promise<RacketModule>; outputBytes: number }): WorkerRuntime;
export function createRacketAdapter(supervisor: RuntimeSupervisor): RuntimeAdapter;
```

The host writes a unique `.rkt` file, invokes the official interpreter, parses one JSON protocol payload, and removes the file in `finally`. Every submission creates a fresh program context. Compile/read errors are structured; stdout/stderr are bounded. Remove the current `jsToRacketExpr` and Worker-local `stableStringify` paths completely.

Extend the browser composition root in the same task: register `createRacketAdapter(supervisor)` in its existing `RuntimeAdapterRegistry`, construct one `OptionalRuntimeVerifier` from the same Registry/Supervisor/adapter instances, expose it as `AppServices.optionalRuntimes`, and pass that service to `RuntimeDetailsDialog`. Extend `app-services.test.ts` to prove the adapter is addressable, the dialog verification action calls that exact shared verifier, and an unavailable Racket remains disabled rather than throwing for a missing adapter.

- [ ] **Step 6: Implement the CLI classifier without false success**

`node scripts/verify-optional-runtime.mjs racket-wasm` checks manifest/assets and prints one machine-readable classification. Exit codes are fixed:

```text
0 = VERIFIED (only after a current browser/runtime contract receipt)
2 = UNAVAILABLE or LOADABLE_UNVERIFIED (not a pass)
1 = BROKEN/INCONSISTENT
```

The script must never print “tests passed” for exit 2. For packaged assets, run `node scripts/verify-optional-runtime.mjs racket-wasm --browser --port 4180` in a dedicated terminal. It starts a loopback-only receipt endpoint, prints the exact `runtime-harness.html?runtimeId=racket-wasm&receiptPort=4180&suite=optional-v1` URL, and waits. Browser MCP opens that URL; the harness runs the checked-in smoke/judge contract and POSTs the result. The server validates runtime ID, check list, asset SHA-256 digest, and current manifest, writes `artifacts/runtime-verification/racket-wasm.json`, then exits 0 only for a complete receipt or 1 for failure. The current repository has no `public/racket/racket.js`/WASM, so the expected current result after unit migration is exit 2 with `UNAVAILABLE racket-wasm: ...` and a disabled UI reason. That unavailable state satisfies the gate but is not runtime support.

- [ ] **Step 7: Make unit/build evidence GREEN and classify the real runtime honestly**

Run:

```powershell
node scripts/build-worker-assets.mjs
npm test -- tests/runtime/optional-verification.test.ts tests/runtime/racket-adapter.test.ts tests/workers/racket-bridge.test.ts
npm run runtime:manifest
node scripts/verify-optional-runtime.mjs racket-wasm
```

Expected: unit tests pass. For the current missing assets, the last command exits 2 and says `UNAVAILABLE`; do not mark the runtime test green. If assets are present, use browser MCP to run handshake, executor smoke, and judge actual-value contract; only a complete receipt permits exit 0/Registry enablement. Any partial/failing artifact is exit 1 `BROKEN`.

- [ ] **Step 8: Verify the product gate in browser**

Current-asset path: Runtime details shows Racket unavailable with missing paths, selectors are disabled, and no Racket Worker request occurs. Asset-present path: first verify through the dialog, then run AC/WA through OJ and a post-error recovery; record all four verification checks. Execute exactly the path matching the actual workspace, never both as claimed success.

- [ ] **Step 9: Prepare the review boundary**

Prepare verifier/Racket source/tests/generated worker and suggest `feat: gate racket runtime contract`. Do not execute the commit.

### Task 20: Gate RustPython on full Pyodide parity for the six-problem corpus

**Files:**
- Create: `src/runtime/adapters/rustpython.ts`
- Create: `src/workers/wasi/io.ts`
- Create: `src/workers/wasi/runner.ts`
- Create: `src/workers/rustpython/payload.ts`
- Create: `src/workers/rustpython/host.ts`
- Create: `src/workers/rustpython.worker.ts`
- Create: `tests/fixtures/python-corpus-solutions.ts`
- Create: `tests/runtime/rustpython-parity.test.ts`
- Create: `tests/workers/rustpython-host.test.ts`
- Modify: `src/runtime/optional-verification.ts`
- Modify: `src/runtime/contracts/runtime-contract-cases.ts`
- Modify: `scripts/build-worker-assets.mjs`
- Modify: `scripts/build-runtimes.mjs`
- Modify: `runtimes/rustpython-runner/src/main.rs`
- Modify: `src/services/app-services.ts`
- Modify: `tests/services/app-services.test.ts`
- Generate/replace: `public/rustpython-worker.js`

**Interfaces:**
- Consumes: optional verifier, Pyodide adapter as parity reference, six validated problems, existing RustPython runner crate/artifact when present.
- Produces: `createRustPythonAdapter(supervisor)`, `createRustPythonHost()`, safe runner payloads, and `verifyPythonParity(pyodide, rustpython, corpus)`.

- [ ] **Step 1: Write RED tests for safe payload construction and WASI host normalization**

```ts
const payload = makeRustPythonPayload({ source: "print(\"'''\")", input: { text: "'''\\n雪" } });
assert.deepEqual(JSON.parse(payload), { mode: "judge", source: "print(\"'''\")", input: { text: "'''\\n雪" } });
const runnerSource = readFileSync(resolve(projectRoot, "runtimes/rustpython-runner/src/main.rs"), "utf8");
assert.doesNotMatch(runnerSource, /r'''\{/);
```

Cover gzip/raw WASM fallback, missing `DecompressionStream`, nonzero WASI exit, malformed stdout JSON, stdout/stderr cap, per-submission WASI instance, and Worker output without expected/passed.

- [ ] **Step 2: Write the six-problem parity RED suite**

For each validated problem, use the checked-in correct Python fixture source and all public+judge inputs. Assert Pyodide and RustPython actual/error classifications are identical and each actual matches expected through the central comparer. A single mismatch returns `broken` and does not enable RustPython.

```ts
const report = await verifyPythonParity(pyodideAdapter, rustPythonAdapter, corpusFixtures);
const expectedCorpusCaseCount = corpusFixtures.reduce((count, fixture) => count + fixture.cases.length, 0);
assert.equal(report.problemCount, 6);
assert.equal(report.caseCount, expectedCorpusCaseCount);
assert.deepEqual(report.mismatches, []);
```

- [ ] **Step 3: Run RustPython tests and verify RED**

Run:

```powershell
npm test -- tests/workers/rustpython-host.test.ts tests/runtime/rustpython-parity.test.ts
```

Expected: missing payload/host/parity exports.

- [ ] **Step 4: Implement reusable bounded WASI IO and RustPython host**

```ts
export interface WasiExecution { stdout: string; stderr: string; exitCode: number; truncated: boolean }
export type AssetFetcher = (url: string) => Promise<ArrayBuffer>;
export interface WasiRunOptions {
  wasm: ArrayBuffer;
  stdin: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  outputBytes: number;
  preopenedFiles?: Readonly<Record<string, Uint8Array>>;
}
export interface PythonCorpusFixture { problemId: number; source: string; cases: readonly ProblemCase[] }
export interface PythonParityReport { problemCount: number; caseCount: number; mismatches: readonly { problemId: number; caseIndex: number; reason: string }[] }
export async function runWasiModule(options: WasiRunOptions): Promise<WasiExecution>;
export function createRustPythonHost(options: { fetchBytes: AssetFetcher; runWasi: typeof runWasiModule }): WorkerRuntime;
export function createRustPythonAdapter(supervisor: RuntimeSupervisor): RuntimeAdapter;
export function verifyPythonParity(pyodide: RuntimeAdapter, rustpython: RuntimeAdapter, fixtures: readonly PythonCorpusFixture[]): Promise<PythonParityReport>;
```

Instantiate a fresh WASI module for every execute/case; send the JSON request via stdin; parse one bounded JSON response. The TypeScript host is under 250 LOC by sharing IO/runner helpers.

- [ ] **Step 5: Remove unsafe source/input interpolation from the Rust runner**

The Rust runner request is `{ mode:"execute"|"judge", source:string, input?:JsonValue }`. Construct the Python namespace by decoding a safely serialized/base64 payload and calling `exec(source, namespace)`; never interpolate raw source/input into triple-quoted literals. Serialize output with strict JSON and `allow_nan=False` semantics; create one interpreter/scope per invocation.

- [ ] **Step 6: Extend optional verification with mandatory corpus parity**

For `python-rustpython`, `OptionalRuntimeVerifier.verify` requires checks `assets`, `handshake`, `smoke`, `judge-contract`, and `pyodide-corpus-parity`. Registry remains disabled after only the first four. CLI exit meanings remain 0 verified, 2 unavailable/unverified, 1 broken.

Register `createRustPythonAdapter(supervisor)` in the existing `AppServices.adapters` and use the already shared `AppServices.optionalRuntimes`; do not create a second verifier. Extend `app-services.test.ts` to prove verification resolves the registered RustPython adapter and that a verified transition makes the same Registry instance selectable, while unavailable/unverified states remain disabled.

- [ ] **Step 7: Make focused tests GREEN and classify actual assets**

Run:

```powershell
node scripts/build-worker-assets.mjs
npm test -- tests/workers/rustpython-host.test.ts tests/runtime/rustpython-parity.test.ts
npm run runtime:manifest
node scripts/verify-optional-runtime.mjs python-rustpython
```

Expected current path: unit/fake parity tests pass; missing `runner.wasm(.gz)` yields exit 2 `UNAVAILABLE`, never pass. If an artifact exists, run the actual six-problem parity in browser; only zero mismatches plus all prior checks yields exit 0/enablement. Build or contract mismatch is exit 1.

- [ ] **Step 8: Verify truthful Python runtime selection in browser**

Current-asset path: Python selector keeps Pyodide enabled and RustPython disabled with exact reason. Asset-present path: run parity verification, then switch between the two runtimes on the same problem and inspect runtime IDs in submissions. Record which path was actually executed.

- [ ] **Step 9: Prepare the review boundary**

Prepare WASI/RustPython source, runner change, fixtures/tests/generated worker and suggest `feat: gate rustpython on pyodide parity`. Do not execute the commit.

### Task 21: Gate Haskell behind its GHC-WASI assets and JSON-string ABI contract

**Files:**
- Create: `src/runtime/adapters/haskell.ts`
- Create: `src/workers/haskell/assets.ts`
- Create: `src/workers/haskell/tar-filesystem.ts`
- Create: `src/workers/haskell/json-string-bridge.ts`
- Create: `src/workers/haskell/ghc-host.ts`
- Create: `src/workers/haskell.worker.ts`
- Create: `tests/runtime/haskell-adapter.test.ts`
- Create: `tests/workers/haskell-bridge.test.ts`
- Create: `tests/workers/haskell-filesystem.test.ts`
- Modify: `src/runtime/optional-verification.ts`
- Modify: `src/runtime/contracts/runtime-contract-cases.ts`
- Modify: `scripts/build-worker-assets.mjs`
- Modify: `scripts/build-runtimes.mjs`
- Modify: `runtimes/haskell-ghc/runner.meta.json`
- Modify: `src/services/app-services.ts`
- Modify: `tests/services/app-services.test.ts`
- Generate/replace: `public/haskell-worker.js`

**Interfaces:**
- Consumes: shared WASI runner, optional verifier, GHC/GHCi/libdir/shim/meta assets when present, and current `String -> String` ABI.
- Produces: `createHaskellAdapter(supervisor)`, `encodeHaskellJsonInput`, `decodeHaskellJsonOutput`, fresh virtual FS per submission, and a gated `haskell-ghc-wasi` runtime.

- [ ] **Step 1: Write ABI bridge and virtual-filesystem RED tests**

```ts
const encoded = encodeHaskellJsonInput({ quote: "\"", slash: "\\", lines: ["a", "b"] });
assert.equal(JSON.parse(encoded).lines[1], "b");
assert.deepEqual(decodeHaskellJsonOutput("{\"ok\":true}\n"), { ok: true });
```

Test tar directories/files/long names, path traversal rejection, read-only libdir, fresh writable `/work`, gzip/raw fallback, special characters, malformed JSON output, compiler/runtime failures, and no Worker-local comparison.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npm test -- tests/runtime/haskell-adapter.test.ts tests/workers/haskell-bridge.test.ts tests/workers/haskell-filesystem.test.ts
```

Expected: missing adapter/bridge/filesystem exports.

- [ ] **Step 3: Split the existing oversized Worker by responsibility**

`assets.ts` fetches/decompresses verified assets; `tar-filesystem.ts` validates/extracts libdir; `json-string-bridge.ts` owns the JSON string ABI; `ghc-host.ts` selects `ghc-e`/`ghc-compile`, builds a fresh root/work directory, compiles/runs, normalizes stdout/stderr, and cleans per-submission state. No production file exceeds the plan's size limits.

- [ ] **Step 4: Keep Haskell-specific string conversion inside the adapter/bridge**

```ts
export function createHaskellAdapter(supervisor: RuntimeSupervisor): RuntimeAdapter;
export function wrapHaskellJudgeSource(source: string): string;
```

The wrapper feeds canonical input JSON as `String`, calls user `solution :: String -> String`, and parses returned JSON. Problem files remain ordinary `json-function-v1`; no Haskell ABI special case leaks into problem definitions or OJ Engine.

- [ ] **Step 5: Require the complete asset and contract set before readiness**

Verification requires concrete GHC WASM, libdir tar, WASI shim, metadata, protocol handshake, compile/run smoke, and judge actual-value contract. GHCi is required only if `runner.meta.json` selects a GHCi mode; metadata/assets must agree. A warning-only build is classified exit 2 unavailable and cannot mark manifest/runtime ready.

Register `createHaskellAdapter(supervisor)` in the existing `AppServices.adapters` and route verification through the same `AppServices.optionalRuntimes` instance created in Task 19. Extend `app-services.test.ts` to prove the adapter is available to verification and OJ selection only after the shared Registry reaches verified/ready; missing or incomplete assets remain represented without composition-root failure.

- [ ] **Step 6: Make unit evidence GREEN and classify actual assets**

Run:

```powershell
node scripts/build-worker-assets.mjs
npm test -- tests/runtime/haskell-adapter.test.ts tests/workers/haskell-bridge.test.ts tests/workers/haskell-filesystem.test.ts
npm run runtime:manifest
node scripts/verify-optional-runtime.mjs haskell-ghc-wasi
```

Expected current path: unit tests pass; absent GHC/libdir/shim yields exit 2 `UNAVAILABLE`, never pass. If complete assets exist, run browser compile/smoke/judge/recovery; only full success yields exit 0/enablement. Partial/stale assets yield exit 1 `BROKEN`.

- [ ] **Step 7: Verify the product gate in browser**

Current-asset path: selectors disable Haskell and runtime details list exact missing artifacts. Asset-present path: verify, run a JSON echo/transform solution, trigger a compile error, then run valid source; inspect fresh `/work` behavior. Record only the actual path.

- [ ] **Step 8: Prepare the review boundary**

Prepare split Haskell worker/adapter/tests/generated worker and suggest `feat: gate haskell ghc wasi runtime`. Do not execute the commit.

### Task 22: Remove legacy execution/storage paths and make docs/CI fail closed

**Files:**
- Create: `scripts/report-runtime-capabilities.mjs`
- Create: `scripts/working-tree-identity.mjs`
- Create: `tests/scripts/runtime-capabilities.test.mjs`
- Create: `tests/scripts/smoke-check.test.mjs`
- Create: `tests/scripts/working-tree-identity.test.mjs`
- Create: `docs/architecture/runtime-kernel.md`
- Create: `docs/operations/runtime-assets.md`
- Create: `docs/qa/localcoder-browser-acceptance.md`
- Modify: `scripts/smoke-check.mjs`
- Modify: `scripts/build-app.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `.github/workflows/deploy-gh-pages.yml`
- Modify: `.github/workflows/build-executors.yml`
- Delete: `src/lib/runtime/worker-manager.ts`
- Delete: `src/hooks/use-code-execution.ts`
- Delete: `src/hooks/use-worker-loader.ts`
- Delete: `src/hooks/use-local-storage.ts`
- Delete: `src/lib/app-config.ts` after Task 14 moves all approved product routes into `src/app/routes.tsx`
- Delete: `scripts/racket-worker.test.mjs`
- Delete: `public/wasi-utils.js` after all WASI workers use generated shared modules
- Delete: `pnpm-lock.yaml` after CI/docs/package metadata consistently use the existing `package-lock.json`

**Interfaces:**
- Consumes: all rebuilt consumers, generated runtime assets/manifest, strict/test/build scripts, static deployment workflows.
- Produces: one execution path, one storage path, truthful docs, fail-closed CI/build/smoke, runtime capability reports, and `working-tree-identity.json`.

- [ ] **Step 1: Write RED tests for dist smoke and identity generation**

In temp fixtures, assert smoke fails for missing required worker/compiler/Pyodide/manifest, stale manifest byte sizes, absent app routes, or missing `404.html` in Pages mode. Optional absent must appear in report as unavailable but not in a passed count. Identity tests assert deterministic SHA-256 across sorted relative paths and a changed source file changes the identity.

```js
assert.equal(report.required.every((entry) => entry.state === "packaged"), true);
assert.equal(report.optional.find((entry) => entry.runtimeId === "racket-wasm").state, "unavailable");
assert.equal(report.verifiedOptionalRuntimeIds.includes("racket-wasm"), false);
```

- [ ] **Step 2: Run script tests and verify RED**

Run:

```powershell
npm test -- tests/scripts/runtime-capabilities.test.mjs tests/scripts/smoke-check.test.mjs tests/scripts/working-tree-identity.test.mjs
```

Expected: current smoke/identity scripts do not expose the required functions/report.

- [ ] **Step 3: Delete legacy paths only after proving no consumers**

Use repository-scoped content searches for these symbols/keys and require zero product-code hits before deletion:

```text
executeWorkerRequest
preloadRuntime
useCodeExecution
useWorkerLoader
useLocalStorageState
localStorageGet
localStorageSet
workerFilenameMap
stableStringify in workers
SelectItem value="javascript" copied lists
```

Allowed remaining legacy-key strings exist only in `legacy-migration.ts` and migration tests/docs. Generated public Workers contain protocol v1, not old preload/success/results messages.

- [ ] **Step 4: Make build and smoke one cross-platform fail-closed sequence**

`build-app.mjs` invokes these local stages through `spawnSync`, stopping on first nonzero code:

```text
setup required assets
build generated Workers
generate/validate manifest
typecheck
lint --max-warnings=0
Node test suite
Vite production build
dist runtime readiness
dist smoke
```

`smoke-check.mjs` exports `checkDist(root, options)` and checks `index.html`, Pages fallback when requested, route chunks, manifest consistency, required worker/compiler/Pyodide assets, and no external runtime CDN URLs. It never requires absent optional artifacts.

- [ ] **Step 5: Update docs to match the trust boundary and operational reality**

README states local single-user practice, required/optional runtime matrix, IndexedDB/fallback, Run vs Submit, static deployment, and browser-inspectable judge cases. Replace “sandboxed execution”, “hidden tests”, unavailable support, pnpm-only setup, and `localStorage` architecture claims. Remove the stale `packageManager: pnpm@10.0.0` field from `package.json`; the existing `package-lock.json` and npm commands become authoritative. `runtime-kernel.md` documents module boundaries/protocol/verdict ownership; `runtime-assets.md` documents generator, required failure, and optional verified/unavailable/broken states; browser acceptance doc contains all Task 23 scenarios.

- [ ] **Step 6: Replace install-heavy optional workflow with capability classification**

`report-runtime-capabilities.mjs` exports one deterministic function:

```js
export function buildCapabilityReport({ manifest, receipts }) {
  return {
    required: manifest.runtimes.filter((entry) => entry.required).map(classifyRequiredAssetState),
    optional: manifest.runtimes.filter((entry) => !entry.required).map((entry) => classifyOptionalWithMatchingReceipt(entry, receipts)),
    verifiedOptionalRuntimeIds: matchingVerifiedIds,
    brokenRuntimeIds,
  };
}
```

A receipt counts only when runtime ID, protocol version, check list, and asset digest match the current manifest/files. Packaged optional assets without such a receipt are `loadable-unverified`, not verified.

`.github/workflows/build-executors.yml` stops cloning toolchains or installing Rust/Racket/Haskell system software. It checks out, sets up Node, runs `npm ci` for existing lockfile dependencies, builds checked-in/generated Workers, and calls `node scripts/report-runtime-capabilities.mjs`. The job summary labels each optional runtime `VERIFIED`, `LOADABLE_UNVERIFIED (contract not passed)`, `UNAVAILABLE (contract not passed)`, or `BROKEN`; unavailable/unverified is an acceptable disabled product state but never a passing runtime test. A packaged-broken runtime fails the workflow.

`.github/workflows/deploy-gh-pages.yml` uses `npm ci`, then `npm run typecheck`, `npm run lint`, `npm test`, and Pages build. No `cp`, shell environment export, apt install, curl-pipe, or package-manager switching remains. Required runtime failure blocks deployment.

- [ ] **Step 7: Implement current-worktree identity without a Git write**

```js
export async function computeWorkingTreeIdentity(root) {
  const files = await collectProjectFiles(root, {
    excludeDirectories: ["dist", ".test-dist", "node_modules", ".git", "artifacts"],
  });
  return { algorithm: "sha256", digest: hashRelativePathsAndBytes(files), files: files.length };
}
```

`collectProjectFiles` recursively includes every regular file below the project root—including `DESIGN.md`, all root HTML harness inputs, TypeScript/ESLint/Vite/Tailwind configs, lockfiles, source, tests, docs, workflows, runtime sources, and packaged runtime assets—while excluding only the five generated/vendor/identity directories above. It rejects symlinks that escape the root and sorts normalized relative paths before hashing. Identity fixture tests mutate at least one file in each category (design, HTML entry, test config, source, test, workflow, runtime asset, docs) and assert every mutation changes the digest. The CLI writes `artifacts/qa/working-tree-identity.json` itself using Node APIs, creating only that exact directory. It records timestamp, digest, and file count; no Git command or filesystem-wide scan outside the project is used.

- [ ] **Step 8: Make cleanup/script/docs checks GREEN**

Run:

```powershell
npm test -- tests/scripts/runtime-capabilities.test.mjs tests/scripts/smoke-check.test.mjs tests/scripts/working-tree-identity.test.mjs
npm run typecheck
npm run lint
npm test
npm run build
node scripts/report-runtime-capabilities.mjs
```

Expected: strict/lint/tests/build/smoke all pass; required runtime assets are packaged and their automated contract suites pass; each optional is either verified, loadable-unverified, or explicitly unavailable; no skipped-runtime success appears. Actual required-browser contract receipts remain Task 23 acceptance evidence.

- [ ] **Step 9: Prepare the review boundary**

Prepare legacy deletions, docs, scripts, package/CI changes and suggest `chore: remove legacy runtime paths and harden delivery`. Do not execute the commit.

### Task 23: Run complete browser acceptance and bind final review to the tested tree

**Files:**
- Create: `docs/qa/2026-08-24-localcoder-rebuild-results.md`
- Generate (not committed unless separately authorized): `artifacts/qa/working-tree-identity.json`
- Modify only if a verified defect is found: the smallest owning source/test/doc file from Tasks 1–22, followed by all affected regressions

**Interfaces:**
- Consumes: the complete current plan/spec, Task 22 acceptance checklist, all quality commands, browser MCP, and requesting-code-review workflow.
- Produces: command evidence, browser acceptance evidence, one current-tree identity, and unconditional final implementation review for that exact identity.

- [ ] **Step 1: Run the final automated matrix from a clean process state**

Run each command separately in PowerShell and record command, exit code, test count, and concise output in the QA results document:

```powershell
npm run typecheck
npm run lint
npm test
npm run runtime:manifest
npm run runtime:check
npm run build
npm run smoke
node scripts/report-runtime-capabilities.mjs
```

Expected: typecheck/lint/tests/build/smoke exit 0; lint has zero warnings; required runtime asset/contract checks have no skips. Optional entries are recorded as actually observed (`VERIFIED`, `UNAVAILABLE`, or `BROKEN`); `BROKEN` is a blocker and `UNAVAILABLE` is not called a pass.

- [ ] **Step 2: Build the GitHub Pages variant with PowerShell environment syntax**

Run in a dedicated PowerShell process so variables do not leak:

```powershell
$env:GITHUB_PAGES = "true"
$env:VITE_GITHUB_PAGES = "true"
npm run build
npm run smoke
```

Expected: build/smoke exit 0, relative assets and `404.html` are present, HashRouter routes load directly, and required manifest URLs resolve. Clear the process by closing that terminal; do not use Bash export syntax.

- [ ] **Step 3: Run required-runtime cross-language acceptance**

Start `npm run dev -- --host 127.0.0.1 --port 4173` in a dedicated terminal. With browser MCP, execute the same problem contract on JavaScript, TypeScript, and Pyodide Python for:

1. correct source → AC;
2. wrong source → WA;
3. syntax failure → CE where applicable;
4. thrown/runtime failure → RE;
5. infinite loop → TLE and terminated Worker;
6. valid source immediately after each failure/TLE → success.

Record route, runtime/build identity, visible verdict, network/console errors, and recovery result. No required runtime may be skipped.

- [ ] **Step 4: Run Run/Submit/persistence acceptance**

In a fresh browser profile/context:

1. seed all legacy key families and boot;
2. verify one-time migration and retained old keys;
3. edit drafts for multiple runtime IDs, add custom cases, change theme/layout;
4. Run and prove solved/progress unchanged;
5. Submit AC and prove one atomic submission/progress update;
6. create non-AC history, inspect/filter source records;
7. reload and verify drafts, custom cases, settings, progress, and history;
8. create >200 submissions through `storage-harness.html` repository calls and verify oldest pruning;
9. force IDB/quota failure and verify session work plus persistent `未保存`.

Record IndexedDB store observations and UI evidence without exposing judge-case values beyond counts.

- [ ] **Step 5: Verify optional runtime truthfulness**

For each Racket, RustPython, and Haskell runtime, follow exactly one real branch:

- `VERIFIED`: assets, handshake, smoke, judge contract (plus RustPython six-problem Pyodide parity) all succeed, selector becomes enabled, and a user flow succeeds.
- `LOADABLE_UNVERIFIED`: packaged assets exist but at least one required contract receipt is absent; selector stays disabled and Runtime details says which check has not passed.
- `UNAVAILABLE`: selector stays disabled and Runtime details gives the concrete asset/unverified reason; no runtime test is reported as passing.
- `BROKEN`: stop release acceptance and return to the owning task; do not relabel it unavailable.

The QA results table has columns `runtimeId`, `assets`, `handshake`, `smoke`, `judge`, `parity`, `product state`, and `evidence`, so a missing check cannot disappear inside a summary.

- [ ] **Step 6: Run responsive, keyboard, accessibility, and state QA**

For Home, Problems, Problem Workspace, Executor, Submissions, and Runtime Details in both themes:

- inspect 375px, 768px, and 1280px; assert `document.documentElement.scrollWidth === document.documentElement.clientWidth`;
- traverse all actions with keyboard, verify visible focus, dialog focus trap/restoration, row activation, resizer alternatives, and CodeMirror focus escape;
- emulate `prefers-reduced-motion: reduce` and verify no essential state is lost;
- verify loading/error/empty/populated/unsaved/unavailable/cancelled states keep stable dimensions;
- inspect contrast and accessibility tree for WCAG 2.2 AA blockers;
- verify runtime/verdict changes use scoped live regions without repeated-log spam.

Any unapproved accessibility exception is a blocker, not accepted debt.

- [ ] **Step 7: Prove the static/no-application-API trust boundary**

After app and selected runtime assets load, execute again with the browser context offline without reloading. Confirm the current session needs no application API. Inspect copy/docs/UI for forbidden claims: secure sandbox, hidden/secret tests, authoritative timing/memory, MLE, trusted contest, or unavailable support. Confirm user JavaScript Worker access and inspectable judge assets are documented honestly.

- [ ] **Step 8: Fix only observed defects and rerun affected evidence**

For each failure, add or strengthen the smallest owning automated regression first, reproduce RED, make the minimal implementation GREEN, rerun that task's focused suite and every downstream affected command/surface. Do not broaden scope or install tooling. Repeat Steps 1–7 only where inputs changed; a changed production file invalidates prior identity/review evidence.

- [ ] **Step 9: Write the QA result artifact with no ambiguous claims**

`docs/qa/2026-08-24-localcoder-rebuild-results.md` records environment/browser, exact commands/exits, required runtime scenarios, optional three-state table, persistence observations, viewport/accessibility results, screenshots/console evidence references, known unavailable capabilities, and zero unresolved release blockers. It never describes unavailable as passed or omitted.

- [ ] **Step 10: Compute the identity after all QA documentation and fixes are final**

Run:

```powershell
node scripts/working-tree-identity.mjs
```

Expected: `artifacts/qa/working-tree-identity.json` contains SHA-256 digest and file count. Rerun final automated commands only if files included by the identity changed after their last green run.

- [ ] **Step 11: Request final independent implementation review for the exact identity**

Use the requesting-code-review workflow once all implementation tasks and QA are complete. Provide the approved spec, this plan, QA results path, exact identity digest, runtime capability table, and final command outputs. Acceptance requires unconditional approval for that current identity; conditional approval, stale identity, partial response, timeout, or unresolved finding is not completion. Any code/doc change after review requires a new identity and fresh final review.

- [ ] **Step 12: Prepare the final commit/review boundary without Git writes**

Prepare a complete intended-change list grouped by the suggested semantic boundaries from Tasks 1–22 plus QA documentation. Report that actual commits require separate user authorization. Do not run `git add`, `git commit`, `git push`, `git tag`, or any other Git write.

## Final verification command matrix

All developer-invoked commands are PowerShell-safe and use repository-local tools:

```powershell
npm run typecheck
npm run lint
npm test
npm run runtime:manifest
npm run runtime:check
npm run build
npm run smoke
node scripts/report-runtime-capabilities.mjs
node scripts/working-tree-identity.mjs
```

Focused tests use `npm test -- <one-or-more tests/... paths>`. Real-browser QA uses `npm run dev -- --host 127.0.0.1 --port 4173` plus browser MCP; no Playwright/Vitest installation or implicit `npx` download is permitted.

## Spec coverage map

| Approved design section | Implementing tasks | Acceptance evidence |
|---|---:|---|
| §1 Goal, §3 Scope, §4 Architecture | 1–23 | File boundaries, static build, final QA/review |
| §2 Current Baseline | 1, 4, 22 | strict zero-warning baseline; no skips/legacy paths |
| §5 Language and Runtime Model | 3, 6, 8–10, 19–21 | exact LanguageId/RuntimeId and capability-derived selectors |
| §6 Runtime Manifest and Registry | 3, 4, 6 | artifact-derived manifest; guarded Registry transitions |
| §7 Worker Protocol | 3, 8–10, 19–21 | v1 parser/endpoint tests; unknown versions fail closed |
| §8 Runtime Supervisor | 7 | FIFO, timeout, cancel, cleanup, late-message, restart tests |
| §9 Runtime Adapters | 8–10, 19–21 | JS/TS/Pyodide required contracts; optional gated bridges |
| §10 OJ Engine and Verdicts | 2, 11, 13, 16 | comparer/verdict matrix; Run vs Submit; atomic accepted update |
| §11 Problem Schema | 5 | v2 parser, XSS boundary, all six migrated files |
| §12 Persistence | 12, 13, 16–18 | six stores, 200 cap, legacy idempotency, fallback, restore loop |
| §13 Product Surfaces | 14–18 | shell, Home, Problems, Workspace, Executor, Submissions, Runtime details |
| §14 Security and Trust Boundary | 8, 11, 14, 22, 23 | bounded output, no MLE/sandbox claims, static/no-API QA |
| §15 Error Handling | 3, 6, 7, 12–14, 16–18 | structured failures, cancellation, storage warning, LocalCoder recovery |
| §16 Test and Verification Strategy | every task; especially 1, 7, 11–13, 19–23 | Node TDD, fake Worker/clock/storage, real-browser matrix, no skipped runtime pass |
| §17 Migration Sequence | 1–23 in order | plan task order matches approved dependency order |
| §18 Completion Criteria | 22–23 | full gates, capability truth table, QA document, identity-bound unconditional review |
| `/DESIGN.md` §§1–8 | 14–18, 23 | semantic tokens, runtime rail, responsive layouts, motion/focus/WCAG checks |

## Plan self-review

- **Spec coverage:** all approved design sections and every named product/runtime/storage/QA surface map to at least one task above; excluded scope is repeated in Global Constraints and introduced nowhere.
- **Verticality:** setup is folded into the first consumer; behavior tasks end in separately rejectable deliverables (runtime contract, judge flow, persistence flow, or product surface), not isolated type/implementation layers.
- **TDD completeness:** every behavior task names its failing test, expected failure, implementation interface, passing command, and real-surface evidence where unit tests are insufficient.
- **Interface consistency:** IDs, protocol envelopes, Registry states, adapter signatures, `JudgeCommand`, `SubmissionResult`, storage keys, and optional gating states (`verified`, `loadable-unverified`, `unavailable`, `broken`) are consumed consistently.
- **Placeholder/vagueness scan:** no unresolved implementation placeholders remain; optional runtime branches have explicit mutually exclusive evidence and missing assets are never treated as passing.
- **Platform/dependency scan:** commands are PowerShell-safe; no Bash chaining, Playwright/Vitest addition, new dependency/software installation, or implicit tool download is planned. CI may restore the already-locked dependency set with `npm ci`.
- **Size/scope scan:** large Worker/UI responsibilities are split into focused files; accounts, backend, rankings, PWA, anti-cheat, secret tests, and authoritative resource claims remain out of scope.
- **Git safety:** every boundary is a prepared list/suggested message only; no Git write is authorized by this plan.

## Execution handoff

Implementation order is Tasks 1 through 23 with a fresh implementation worker per task and integration verification after each returned task. Planner receipt status: **waiting for receipt**; this planner role does not dispatch `plan-critic`. The user has delegated design/plan approval, but that delegation does not authorize Git writes. Current known non-blocking conditions are the truthful unavailable state of Racket/RustPython/Haskell assets; any required runtime failure, optional `broken` state, accessibility debt, or missing final review is a real blocker.
