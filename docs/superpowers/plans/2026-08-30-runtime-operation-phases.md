# Runtime Operation Phases Implementation Plan

> **For agentic workers:** Use the subagent-driven-development skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate runtime initialization from user execution so timeout/cancellation recovery preserves a selectable verified capability and Executor/OJ elapsed time measures only the user-execution phase.

**Architecture:** Add an observer-only `RuntimeOperationPhase` callback to existing Supervisor operation options, copy it into each queued operation, and emit it at the existing lifecycle boundaries without changing Worker protocol envelopes or adapter signatures. Classify only ordinary execute/judge timeout and cancellation as recoverable terminal outcomes (`loadable` with the Worker generation destroyed); keep initialization, infrastructure, fatal, protocol, and optional-verification failures fail-closed. Executor and OJ derive phase presentation and an optional `executionStartedAt` from the first `executing` callback, while existing Registry snapshots remain the authority for capability and verification eligibility.

**Tech Stack:** PowerShell 7, Node.js, pnpm 12, TypeScript 5.9 strict mode, React 19 controller/model workflow, Web Workers, Node built-in test runner, Vite 7, real Chromium/Edge browser through loopback CDP.

**Spec:** `docs/superpowers/specs/2026-08-30-runtime-operation-phases-design.md`

**Global Constraints:**
- Do not install software.
- Do not execute Git writes without explicit user permission.
- Do not change Worker protocol, receipt schema, runtime build identity inputs, or unrelated runtime behavior.
- Preserve FIFO queueing, generation isolation, output bounds, optional verification authority, and OJ ownership of verdict comparison.
- Use PowerShell syntax only; do not use Bash `export`, inline `VAR=value command`, `&&`, `/dev/null`, or `source` syntax.
- Do not run `git add`, `git commit`, `git push`, `git tag`, `git restore`, `git reset`, `git checkout`, `git clean`, `git stash`, or any other Git write command. End each task at a review boundary.
- The worktree is intentionally dirty with in-progress RustPython work and `.debug-journal.md`. Do not edit, regenerate as a source fix, restore, delete, rename, or overwrite those pre-existing paths while implementing this plan.
- Never run two `pnpm test` invocations concurrently because both own and delete `.test-dist`.
- Do not automatically replay timed-out, cancelled, active, or queued user code. Every promise must retain the existing exactly-once settlement rule.
- `LOADABLE_UNVERIFIED` and `UNAVAILABLE` remain disabled. Only a current optional-v1 browser receipt may support a `VERIFIED` RustPython claim.
- Browser, Vite, and receipt-verifier processes must be launched detached with `Start-Process -PassThru`, separate redirected stdout/stderr logs, readiness checks, and exact PID/command-line cleanup. Never launch a foreground browser or use the default browser profile.
- Browser timing is device-local reference evidence, not an authoritative timing claim. Do not add memory-limit or secure-sandbox claims.

---

## Current Worktree Baseline and Protected RustPython Work

At plan-writing time, `git status --short` reports the following pre-existing RustPython work. It belongs to `docs/superpowers/plans/2026-08-28-rustpython-runtime.md`, not to this plan:

```text
 M .gitignore
 M README.md
 M docs/operations/runtime-assets.md
 M public/runtime-manifest.json
 M public/rustpython-worker.js
 M public/rustpython/README.md
 M runtimes/rustpython-runner/Cargo.lock
 M runtimes/rustpython-runner/Cargo.toml
 M runtimes/rustpython-runner/src/main.rs
 M scripts/build-runtimes.mjs
 M scripts/lib/runtime-catalog.mjs
 M scripts/lib/worker-build-identity.mjs
 M src/workers/rustpython/host.ts
 M tests/integration/build-worker-assets.test.ts
 M tests/scripts/runtime-manifest-generation.test.mjs
 M tests/workers/rustpython-host.test.ts
?? .debug-journal.md
?? artifacts/qa/rustpython-runtime/
?? docs/superpowers/plans/2026-08-28-rustpython-runtime.md
?? docs/superpowers/specs/2026-08-30-runtime-operation-phases-design.md
```

The new plan itself, `docs/superpowers/plans/2026-08-30-runtime-operation-phases.md`, is also expected to be untracked until the user decides what to version. Before editing, record SHA-256 hashes for the protected tracked/untracked files listed above (excluding directories), and compare those hashes again at final review. If an implementation step would require changing one of them, stop and return the defect to the RustPython plan instead of broadening this plan.

Current browser evidence is not acceptance evidence: `artifacts/runtime-verification/python-rustpython.json` does not exist, while `artifacts/qa/rustpython-runtime/browser-playwright.json` records a stale failed receipt (`python-runtime-error`, `_io.FileIO` import failure) against asset sizes that differ from the current manifest. Task 3 must issue a fresh receipt from the exact current manifest/assets or report that RustPython prerequisite as a blocker.

## File Map

### Production files to modify

- `src/runtime/supervisor-types.ts` — declares `RuntimeOperationPhase`, adds `onPhase` to public options and internal queued/input records.
- `src/runtime/supervisor.ts` — re-exports the phase type and copies `onPhase` into the immutable logical queued operation.
- `src/runtime/supervisor-lifecycle.ts` — emits isolated phase notifications and chooses `loadable` only for recoverable ordinary-operation termination.
- `src/runtime/registry.ts` — permits `initializing -> loadable` and `running -> loadable` while preserving all other transition guards.
- `src/features/executor/executor-execution.ts` — forwards the controller's phase observer with the existing AbortSignal.
- `src/features/executor/executor-controller.ts` — derives live phase and execution-only elapsed time from callbacks, including failure/cancellation outcomes.
- `src/features/executor/executor-model.ts` — removes the Registry-state phase heuristic; eligibility and immutable snapshot helpers remain unchanged.
- `src/oj/engine.ts` — owns optional `executionStartedAt` and uses it for every returned `SubmissionResult`.
- `src/oj/judge-validation.ts` — constructs operation options with `onPhase` and returns zero elapsed time when execution never started.

### Test files to modify or execute

- `tests/runtime/registry.test.ts` — legal recoverable transitions and retained illegal-transition coverage.
- `tests/runtime/supervisor.test.ts` — cold/warm phase emission, callback isolation, recoverable timeout/cancellation, fresh generation, late-message and queue exactly-once behavior, and fail-closed infrastructure faults.
- `tests/runtime/optional-verification.test.ts` — optional verification timeout remains broken/failed/unverified and cannot yield a verified result.
- `tests/ui/executor-controller.test.ts` — callback-driven phase, 80 ms cold initialization exclusion, 12 ms warm/cold execution, and pre/post-executing failure/cancellation timing.
- `tests/helpers/fake-runtime-adapter.ts` — makes the OJ fake invoke the supplied `executing` observer before producing or rejecting its queued outcome.
- `tests/oj/engine.test.ts` — cold/warm execution-only timing, zero before execution, timeout/runtime/cancellation timing, and operation-option forwarding.
- `tests/services/submission-service.test.ts` — existing `elapsedMs: 12` persistence assertion is a required downstream regression; no production timing source moves into this service.
- `tests/ui/problem-workspace-controller.test.ts` — existing TLE/retry and cancellation result rendering are downstream regressions; no workspace timing source is introduced.

### Browser/evidence surfaces to execute, not modify

- `runtime-harness.html` and `src/harness/runtime-contract-harness.ts` — real Supervisor/adapters/optional verifier surface; its existing `RuntimeOperationOptions` argument can observe phases without a protocol change.
- `scripts/verify-optional-runtime.mjs` and `scripts/runtime-verification-server.mjs` — bounded optional-v1 receipt server and authoritative result.
- `scripts/report-runtime-capabilities.mjs` — independently revalidates current receipt, manifest digest, ordered checks, and asset digests.
- `src/features/runtimes/RuntimeDetailsDialog.tsx` and `src/features/executor/ExecutorWorkspace.tsx` — product verification, selector, timeout, elapsed, and recovery surfaces.
- `artifacts/runtime-verification/python-rustpython.json` — fresh current receipt created only by the receipt server.
- `artifacts/qa/runtime-operation-phases/` — new command logs, PID records, screenshots, browser JSON, baseline hashes, final identity, and final status for this plan.

## Spec-to-Task Traceability

| Spec requirement | Owning task and evidence |
|---|---|
| `initializing` only for a real cold handshake; `executing` immediately before execute/judge; warm skips initialization | Task 1 Supervisor phase tests; Task 3 harness phase arrays |
| Throwing phase observer cannot alter completion | Task 1 callback-isolation test |
| Execution timeout/cancellation destroys the generation and returns ordinary operations to `loadable` | Task 1 timeout/cancellation state and termination tests |
| Initialization timeout, Worker error, protocol fault (including request/runtime mismatch), and fatal runtime failure remain `failed` | Task 1 retained/strengthened infrastructure matrix |
| Optional verification timeout/fault remains failed and unverified, with no verified result/receipt | Task 1 optional-verification RED/GREEN test; Task 3 receipt gate |
| Verification survives ordinary recovery; verified optional runtime stays eligible/selectable | Task 1 verified optional recovery assertions; Task 3 harness and product selector checks |
| FIFO, generation isolation, late-message rejection, active/queued exactly-once settlement, no replay | Task 1 combined recoverable-timeout queue/generation test |
| Executor and OJ cold 80 ms + execute 12 ms report 12 ms; warm execute reports 12 ms | Task 2 deterministic clock tests |
| Timeout/runtime error/cancellation after `executing` report execution time; availability, already-aborted, and other result-producing failures before it report zero; command validation retains its existing pre-result exception contract | Task 2 Executor/OJ error and cancellation matrix |
| Executor phase text is callback-driven, not a Registry snapshot heuristic | Task 2 controller test and removal of `executionPhase`/active Registry phase patching |
| Submission persistence receives OJ elapsed unchanged and OJ retains verdict ownership/secrecy | Task 2 service and workspace regressions |
| Real RustPython receipt, timeout recovery, retained selector, fresh handshake, succeeding operation | Task 3 optional-v1 receipt, harness recovery JSON, and product QA JSON/screenshot |
| Full regression, exact identity, cleanup, and review without Git writes | Task 4 logs, hash comparison, identity artifact, cleanup assertions, and requesting-code-review receipt |

## Outcome Gates

- **Implementation success:** Tasks 1 and 2 are GREEN, ordinary execute/judge timeout/cancellation recover to `loadable`, fail-closed faults remain `failed`, callback observers are isolated, and deterministic clocks prove cold/warm execution-only timing.
- **Browser success:** A fresh current `python-rustpython` optional-v1 receipt is `VERIFIED`; the harness times out a warm operation, then reports `initializing -> executing` on a succeeding fresh-generation operation; the product selector remains enabled after a real timeout and a later product execution succeeds.
- **RustPython prerequisite blocked:** If the current RustPython smoke/parity still fails before the phase/recovery scenario, preserve all evidence, leave the runtime truthfully `BROKEN` or `LOADABLE_UNVERIFIED`, do not edit RustPython-owned files in this plan, and return to `docs/superpowers/plans/2026-08-28-rustpython-runtime.md`. Tasks 3 browser acceptance and Task 4 final `VERIFIED` status remain blocked.
- **Environment blocked:** Missing already-installed browser/CDP capability, occupied required ports, or unavailable packaged assets is not a phase implementation failure and is not permission to install software. Record the exact blocker and keep acceptance incomplete.

### Task 1: Add Supervisor phase notifications and recoverable lifecycle state

**Files:**
- Modify: `src/runtime/supervisor-types.ts:22-25,40-52,65-71`
- Modify: `src/runtime/supervisor.ts:16-22,138-177`
- Modify: `src/runtime/supervisor-lifecycle.ts:21-90,135-181`
- Modify: `src/runtime/registry.ts:163-180`
- Test: `tests/runtime/registry.test.ts:87-143`
- Test: `tests/runtime/supervisor.test.ts:133-565`
- Test: `tests/runtime/optional-verification.test.ts:132-230,437-516`
- Create: `artifacts/qa/runtime-operation-phases/baseline-status.txt`
- Create: `artifacts/qa/runtime-operation-phases/protected-baseline-hashes.json`
- Create: `artifacts/qa/runtime-operation-phases/task1-red.log`
- Create: `artifacts/qa/runtime-operation-phases/task1-green.log`

**Interfaces:**
- Consumes: existing `RuntimeSupervisor.initialize/execute/judge`, `RuntimeRegistry.transition`, one-active/FIFO `RuntimeSlot`, `RuntimeOperationLifecycle.#beginInitialization/#beginExecution`, opaque `verificationAuthority`, `RuntimeFailure`, `ManualClock`, and `FakeWorkerFactory`.
- Produces: `export type RuntimeOperationPhase = "initializing" | "executing"`; `RuntimeOperationOptions.onPhase?: (phase: RuntimeOperationPhase) => void`; matching `QueuedOperation.onPhase` and `RuntimeOperationInput.onPhase`; legal Registry transitions `initializing -> loadable` and `running -> loadable`; ordinary execute/judge `execution-timeout`/`cancelled` recovery with the terminated generation never reused.

**Recommended executor:** `complex`

- [ ] **Step 1: Record the dirty baseline and fail closed around protected RustPython work**

Run from the repository root before editing:

```powershell
$evidenceRoot = "artifacts/qa/runtime-operation-phases"
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
$baseline = @(git status --short)
$baseline | Tee-Object -FilePath "$evidenceRoot/baseline-status.txt"
if ($baseline -notcontains "?? .debug-journal.md") {
  throw "Expected protected .debug-journal.md is absent; stop and inspect the changed baseline"
}
$protectedPaths = @(
  ".gitignore",
  "README.md",
  "docs/operations/runtime-assets.md",
  "public/runtime-manifest.json",
  "public/rustpython-worker.js",
  "public/rustpython/README.md",
  "runtimes/rustpython-runner/Cargo.lock",
  "runtimes/rustpython-runner/Cargo.toml",
  "runtimes/rustpython-runner/src/main.rs",
  "scripts/build-runtimes.mjs",
  "scripts/lib/runtime-catalog.mjs",
  "scripts/lib/worker-build-identity.mjs",
  "src/workers/rustpython/host.ts",
  "tests/integration/build-worker-assets.test.ts",
  "tests/scripts/runtime-manifest-generation.test.mjs",
  "tests/workers/rustpython-host.test.ts",
  ".debug-journal.md",
  "docs/superpowers/plans/2026-08-28-rustpython-runtime.md",
  "docs/superpowers/specs/2026-08-30-runtime-operation-phases-design.md"
)
$missing = @($protectedPaths | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) })
if ($missing.Count -ne 0) { throw "Protected baseline paths are missing: $($missing -join ', ')" }
$hashes = @($protectedPaths | ForEach-Object {
  $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $_
  [ordered]@{ path = $_; sha256 = $hash.Hash.ToLowerInvariant() }
})
$hashes | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath "$evidenceRoot/protected-baseline-hashes.json" -Encoding utf8
```

Expected: the status log preserves the pre-existing RustPython paths and `.debug-journal.md`; the JSON contains one non-empty SHA-256 per protected file. Do not open the journal for editing, and do not make a clean-worktree assumption.

- [ ] **Step 2: Write RED tests for callback boundaries, observer isolation, recovery classification, and exactly-once generation behavior**

In `tests/runtime/registry.test.ts`, extend the lifecycle test with two independent legal recovery paths before continuing through the existing failed/incompatible assertions:

```ts
registry.transition("javascript-worker", { kind: "initializing" });
registry.transition("javascript-worker", { kind: "loadable" });
registry.transition("javascript-worker", { kind: "initializing" });
registry.transition("javascript-worker", { kind: "ready" });
registry.transition("javascript-worker", { kind: "running", requestId: "recoverable-request" });
registry.transition("javascript-worker", { kind: "loadable" });
assert.equal(registry.get("javascript-worker").state.kind, "loadable");
```

In `tests/runtime/supervisor.test.ts`, add these named contracts using the existing `setup`, `request`, `completeInitialize`, `completeExecute`, `readySession`, `ManualClock`, and `FakeWorkerFactory` helpers:

```ts
test("emits initializing and executing only at cold operation boundaries and skips initializing when warm", async () => {
  const { supervisor, factory } = setup();
  const coldPhases: string[] = [];
  const cold = supervisor.execute(runtimeId, "cold", { onPhase: (phase) => coldPhases.push(phase) });
  const worker = factory.workers[0];
  if (worker === undefined) throw new Error("expected cold worker");
  assert.deepEqual(coldPhases, ["initializing"]);
  completeInitialize(worker);
  assert.deepEqual(coldPhases, ["initializing", "executing"]);
  completeExecute(worker, "cold-result");
  await cold;

  const warmPhases: string[] = [];
  const warm = supervisor.execute(runtimeId, "warm", { onPhase: (phase) => warmPhases.push(phase) });
  assert.deepEqual(warmPhases, ["executing"]);
  completeExecute(worker, "warm-result");
  await warm;
});

test("isolates a throwing phase callback from successful operation completion", async () => {
  const { supervisor, factory, registry } = setup();
  const operation = supervisor.execute(runtimeId, "code", {
    onPhase: () => { throw new Error("observer failed"); },
  });
  const worker = factory.workers[0];
  if (worker === undefined) throw new Error("expected worker");
  completeInitialize(worker);
  completeExecute(worker, 42);
  assert.equal((await operation).payload.value, 42);
  assert.equal(registry.get(runtimeId).state.kind, "ready");
});
```

Strengthen the existing execution-timeout and cancellation cases and add a recoverable queue/generation case so they assert all of the following concrete observations:

```ts
assert.equal(registry.get(runtimeId).state.kind, "loadable");
assert.equal(timedOutWorker.terminated, 1);
assert.equal(timedOutWorker.listenerCount(), 0);
assert.equal(clock.pendingCount(), 0);

const recoveryPhases: string[] = [];
const recovered = supervisor.execute(runtimeId, "fresh", { onPhase: (phase) => recoveryPhases.push(phase) });
const replacement = factory.workers[1];
if (replacement === undefined) throw new Error("expected a fresh Worker generation");
assert.notStrictEqual(replacement, timedOutWorker);
assert.deepEqual(recoveryPhases, ["initializing"]);
completeInitialize(replacement, "replacement-version", "replacement-build");
assert.deepEqual(recoveryPhases, ["initializing", "executing"]);
completeExecute(replacement, "fresh-result");
assert.equal((await recovered).payload.value, "fresh-result");
```

For cancellation before execution, abort a cold `execute` after its `initializing` notification but before `completeInitialize`; require rejection code `cancelled`, state `loadable`, one termination, no `executing` notification, and a later operation on `factory.workers[1]`. For cancellation during execution, update the existing AbortSignal and explicit-cancel cases to require `loadable` instead of `failed` and then prove a fresh handshake succeeds.

For exactly-once behavior, adapt the existing settlement counters to use an active warm execute plus two queued operations, expire the active execute with `clock.tick(25)`, await all three rejections, emit the old request's late completion, and assert counters remain `[1, 1, 1]`. Start a fourth operation and require `factory.workers[1]`, `initializing -> executing`, and one successful settlement; never expect an automatically replayed queued request.

Retain and strengthen the existing fail-closed matrix so initialization timeout, Worker error, malformed response, request mismatch, runtime mismatch, and fatal failure each assert `registry.get(runtimeId).state.kind === "failed"`.

In `tests/runtime/optional-verification.test.ts`, add a real-Supervisor timeout during the smoke execute:

```ts
test("optional verification execution timeout remains failed and unverified", async () => {
  const registry = RuntimeRegistry.fromManifest(manifest(true));
  const factory = new FakeWorkerFactory();
  const clock = new ManualClock();
  const supervisor = new Supervisor({ registry, workerFactory: factory.create, clock });
  const adapters = new RuntimeAdapterRegistry();
  adapters.register(createRacketAdapter(supervisor));
  const verification = new OptionalRuntimeVerifier({ registry, supervisor, adapters }).verify("racket-wasm");
  const worker = factory.workers[0];
  if (worker === undefined) throw new Error("expected verification worker");
  completeInitialize(worker);
  await flush();
  clock.tick(5_000);

  const result = await verification;
  assert.equal(result.state, "broken");
  if (result.state === "broken") assert.equal(result.code, "execution-timeout");
  assert.equal(registry.get("racket-wasm").state.kind, "failed");
  assert.equal(registry.get("racket-wasm").verification, "unverified");
  assert.equal(worker.terminated, 1);
});
```

This `broken` result is the unit-level proof that the browser receipt server cannot receive a verified verification payload from a timed-out optional verification.

Also strengthen `a verified optional runtime preserves trust across fatal, timeout, and cancellation fresh-worker recovery`: fatal failure must remain `failed` while preserving `verification === "verified"`; ordinary execution timeout and cancellation must now be `loadable`, preserve `verification === "verified"`, and remain eligible for the existing fresh-Worker recovery calls. This distinguishes retained verification trust from capability health and prevents the verifier-only fail-closed rule from leaking into ordinary verified execution.

- [ ] **Step 3: Run the focused RED suite and record the expected failures**

```powershell
pnpm test tests/runtime/registry.test.ts tests/runtime/supervisor.test.ts tests/runtime/optional-verification.test.ts 2>&1 | Tee-Object -FilePath "artifacts/qa/runtime-operation-phases/task1-red.log"
$task1RedExit = $LASTEXITCODE
if ($task1RedExit -eq 0) { throw "Task 1 RED suite unexpectedly passed before implementation" }
```

Expected: nonzero exit. The TypeScript graph should reject missing `RuntimeOperationOptions.onPhase`, and/or behavioral assertions should show timeout/cancellation still transition to `failed` and the Registry rejects `initializing/running -> loadable`. A failure caused by the pre-existing RustPython files or unrelated baseline is a blocker, not acceptable RED evidence.

- [ ] **Step 4: Implement the narrow phase interface and callback propagation**

In `src/runtime/supervisor-types.ts`, add the public phase type and copy it through all internal operation records:

```ts
export type RuntimeOperationPhase = "initializing" | "executing";

export interface RuntimeOperationOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onPhase?: (phase: RuntimeOperationPhase) => void;
}
```

Add `readonly onPhase?: (phase: RuntimeOperationPhase) => void` to `QueuedOperation`, and `onPhase?: (phase: RuntimeOperationPhase) => void` to `RuntimeOperationInput`. In `src/runtime/supervisor.ts`, include `RuntimeOperationPhase` in the existing type re-export and copy the callback while creating the queued operation:

```ts
...(input.onPhase === undefined ? {} : { onPhase: input.onPhase }),
```

Do not place the callback in a `WorkerRequest`, validate it as protocol input, invoke it while merely waiting in FIFO, or let a closed verification session acquire new authority through it.

- [ ] **Step 5: Emit phases at lifecycle boundaries and isolate observer exceptions**

In `src/runtime/supervisor-lifecycle.ts`, add this private observer boundary:

```ts
#emitPhase(phase: import("./supervisor-types.js").RuntimeOperationPhase): void {
  try {
    this.#operation.onPhase?.(phase);
  } catch {
    // Operation observers must not alter runtime execution.
  }
}
```

Call `this.#emitPhase("initializing")` in `#beginInitialization` immediately before creating/starting the initialize transport. In `#beginExecution`, retain all identity/state/verification checks, transition to `running`, build the execute/judge request, then call `this.#emitPhase("executing")` immediately before `#startTransport`. A warm session reaches only `#beginExecution`; a cold operation emits both in order. Do not emit from Worker status messages, Registry subscribers, queue insertion, or retries.

- [ ] **Step 6: Implement recoverable ordinary-operation terminal classification without weakening verification**

Add a private predicate in `RuntimeOperationLifecycle`:

```ts
#isRecoverableUserTermination(error: RuntimeFailure): boolean {
  return this.#operation.verificationAuthority === undefined
    && (this.#operation.kind === "execute" || this.#operation.kind === "judge")
    && (
      (error.kind === "infrastructure" && error.code === "execution-timeout")
      || error.kind === "cancelled"
    );
}
```

In `fail`, preserve the existing order: capture any valid post-handshake identity, stop transport, release/terminate the current lease, clear initialized identity/payload, and bind identity only to the active post-handshake error. Then choose the Registry terminal state:

```ts
const state = this.registry.get(this.#runtimeId).state.kind;
if (state === "loadable" || state === "initializing" || state === "verifying" || state === "ready" || state === "running") {
  if (this.#isRecoverableUserTermination(error) && (state === "initializing" || state === "running")) {
    this.registry.transition(this.#runtimeId, { kind: "loadable" });
  } else {
    this.registry.transition(this.#runtimeId, { kind: "failed", code: error.code, message: error.message });
  }
}
```

In `src/runtime/registry.ts`, change only these transition sets:

```ts
case "initializing":
  return next === "loadable" || next === "initializing" || next === "ready" || next === "verifying" || next === "failed" || next === "incompatible";
case "running":
  return next === "loadable" || next === "ready" || next === "verifying" || next === "failed" || next === "incompatible";
```

Do not allow `verifying -> loadable`, `ready -> loadable`, `failed -> ready`, or any transition out of `not-packaged`/`incompatible`. Do not modify `#rejectRuntime`: active and queued operations still receive exactly one terminal rejection and the queue is not drained into a replay.

- [ ] **Step 7: Run the focused GREEN suite and inspect the exact phase/recovery diff**

```powershell
pnpm test tests/runtime/registry.test.ts tests/runtime/supervisor.test.ts tests/runtime/optional-verification.test.ts 2>&1 | Tee-Object -FilePath "artifacts/qa/runtime-operation-phases/task1-green.log"
if ($LASTEXITCODE -ne 0) { throw "Task 1 focused suite failed" }
git diff --check
if ($LASTEXITCODE -ne 0) { throw "Task 1 diff has whitespace errors" }
git diff -- "src/runtime/supervisor-types.ts" "src/runtime/supervisor.ts" "src/runtime/supervisor-lifecycle.ts" "src/runtime/registry.ts" "tests/runtime/registry.test.ts" "tests/runtime/supervisor.test.ts" "tests/runtime/optional-verification.test.ts"
```

Expected: all selected tests pass; cold phases are exactly `initializing, executing`; warm is exactly `executing`; a throwing callback still resolves normally; ordinary timeout/cancellation leaves `loadable`; optional verification timeout and all infrastructure faults leave `failed`; recovery uses a new Worker and handshake; late old-generation messages and queued operations settle no more than once.

### Task 2: Propagate execution-only timing through Executor and OJ

**Files:**
- Modify: `src/features/executor/executor-execution.ts:1-38`
- Modify: `src/features/executor/executor-controller.ts:13-21,172-218,267-277`
- Modify: `src/features/executor/executor-model.ts:65-71`
- Modify: `src/oj/engine.ts:27-89`
- Modify: `src/oj/judge-validation.ts:7,79-88`
- Modify: `tests/ui/executor-controller.test.ts:20-43,253-349`
- Modify: `tests/helpers/fake-runtime-adapter.ts:6-34`
- Modify: `tests/oj/engine.test.ts:89-96,110-270`
- Test without production edit: `tests/services/submission-service.test.ts:118-173`
- Test without production edit: `tests/ui/problem-workspace-controller.test.ts`
- Create: `artifacts/qa/runtime-operation-phases/task2-red.log`
- Create: `artifacts/qa/runtime-operation-phases/task2-green.log`

**Interfaces:**
- Consumes: Task 1 `RuntimeOperationPhase`/`RuntimeOperationOptions.onPhase`, existing adapter signatures, `Clock.now()`, `ExecutorSnapshot.phase/elapsedMs`, `JudgeCommand.signal`, and `SubmissionResult.elapsedMs`.
- Produces: `ExecutorExecution.execute(runtimeId: RuntimeId, source: string, onPhase: (phase: RuntimeOperationPhase) => void): Promise<ExecutorCompletion>`; `judgeOperationOptions(signal, timeoutMs, onPhase): RuntimeOperationOptions`; `elapsedMs(now: () => number, executionStartedAt: number | undefined): number`; callback-driven Executor phase; unchanged OJ verdict, identity, secrecy, and persistence shapes.

**Recommended executor:** `coding`

- [ ] **Step 1: Write deterministic RED tests for cold/warm Executor timing and callback-driven presentation**

Update the Executor fake call record to retain the exact options and continue calling its existing `onExecute` hook:

```ts
readonly calls: Array<{ source: string; options: RuntimeOperationOptions | undefined }> = [];

async execute(source: string, options?: RuntimeOperationOptions): Promise<ExecuteResult> {
  this.calls.push({ source, options });
  this.onExecute?.(options);
  const outcome = this.outcomes.shift();
  if (outcome === undefined) throw new Error(`No execute outcome queued for ${this.runtimeId}`);
  return outcome;
}
```

Replace the Registry-transition-driven execution test with callback-driven cold and warm cases. The cold case must emit `initializing`, advance 80 ms, emit `executing`, advance 12 ms, and assert `elapsedMs === 12`; subscribe to snapshots and require both `initializing` and `running` were published. The warm case emits only `executing`, advances 12 ms, and also asserts `elapsedMs === 12`:

```ts
harness.adapters.javascript.onExecute = (options) => {
  options?.onPhase?.("initializing");
  harness.clock.tick(80);
  options?.onPhase?.("executing");
  harness.clock.tick(12);
};
harness.adapters.javascript.outcomes.push(invocation(output("cold\n", "", null)));
await harness.controller.execute();
assert.equal(harness.controller.snapshot.elapsedMs, 12);

harness.adapters.javascript.onExecute = (options) => {
  options?.onPhase?.("executing");
  harness.clock.tick(12);
};
harness.adapters.javascript.outcomes.push(invocation(output("warm\n", "", null)));
await harness.controller.execute();
assert.equal(harness.controller.snapshot.elapsedMs, 12);
```

Add exact Executor result-path tests:

- `failure before executing reports zero elapsedMs`: do not invoke `onPhase`, reject with a runtime failure, require phase `error`, `elapsedMs === 0`, and no output.
- `timeout and runtime failure after executing retain execution elapsedMs`: invoke `executing`, tick 12, reject once with `execution-timeout` and once with nonfatal runtime failure; require phase `error` and `elapsedMs === 12` for both.
- `cancellation before executing is zero and cancellation during execution is measured`: use deferred outcomes and `controller.cancel()`; first omit `executing` and require `0`, then emit `executing`, tick 12, cancel/reject, and require `12`.

Every call must still contain exactly one AbortSignal, and no test may infer phase from a manual Registry transition.
Update the existing signal assertions from `calls[0]?.signal` to `calls[0]?.options?.signal`, require `typeof calls[0]?.options?.onPhase === "function"`, and retain the assertion that the adapter is called exactly once per controller operation.

- [ ] **Step 2: Write deterministic RED tests for OJ timing and options propagation**

In `tests/helpers/fake-runtime-adapter.ts`, add an optional hook and make the fake model the real Supervisor callback contract before resolving/rejecting:

```ts
onJudge?: (options: RuntimeOperationOptions | undefined) => void;

async judge(source: string, inputs: readonly JsonValue[], options?: RuntimeOperationOptions): Promise<RuntimeInvocation<JudgePayload>> {
  this.judgeCalls.push({ source, inputs, options });
  this.onJudge?.(options);
  options?.onPhase?.("executing");
  const outcome = this.outcomes.shift();
  if (outcome === undefined) throw new Error("FakeRuntimeAdapter has no queued judge outcome");
  if ("rejection" in outcome) throw outcome.rejection;
  return outcome;
}
```

In `tests/oj/engine.test.ts`, add a cold case whose fake calls `onPhase("initializing")` before the fake's automatic `executing`; provide `now()` values `[80, 92]` and assert accepted `elapsedMs === 12`. Add a warm case without `initializing`, again using `[80, 92]`, and assert `12`.

Add a table for rejected `execution-timeout`, runtime error, and cancellation after `executing`; each uses `now()` values `[80, 92]`, preserves its existing verdict mapping, and reports `12`. Strengthen runtime-unavailable and already-aborted cases to assert `elapsedMs === 0` and zero `now()` calls. Command-shape/source/case/timeout validation continues to reject before adapter invocation; it must not be converted into an OJ verdict or fabricate elapsed time.

Update the operation-options assertions to avoid deep equality against a function:

```ts
const options = adapter.judgeCalls[0]?.options;
assert.equal(options?.signal, controller.signal);
assert.equal(options?.timeoutMs, 25);
assert.equal(typeof options?.onPhase, "function");
```

When signal and timeout are absent, require the only own key to be `onPhase` and require that value to be a function.

- [ ] **Step 3: Run the timing RED suite and require the old cold-total/undefined behavior to fail**

```powershell
pnpm test tests/ui/executor-controller.test.ts tests/oj/engine.test.ts tests/services/submission-service.test.ts tests/ui/problem-workspace-controller.test.ts 2>&1 | Tee-Object -FilePath "artifacts/qa/runtime-operation-phases/task2-red.log"
$task2RedExit = $LASTEXITCODE
if ($task2RedExit -eq 0) { throw "Task 2 RED suite unexpectedly passed before timing propagation" }
```

Expected: nonzero exit because Executor does not forward `onPhase`, cold Executor time is still 92 ms, failure/cancellation elapsed is absent, and OJ operation options/timing do not yet use the callback. Existing service/workspace assertions must not be the source of RED.

- [ ] **Step 4: Forward phase notifications through ExecutorExecution without changing adapter interfaces**

In `src/features/executor/executor-execution.ts`, import `RuntimeOperationPhase` and change only the execution wrapper signature/options:

```ts
async execute(
  runtimeId: RuntimeId,
  source: string,
  onPhase: (phase: RuntimeOperationPhase) => void,
): Promise<ExecutorCompletion> {
  if (this.#abortController !== undefined) throw new Error("已有执行任务正在进行");
  const abortController = new AbortController();
  this.#abortController = abortController;
  try {
    const invocation = await this.#adapters.get(runtimeId).execute(source, {
      signal: abortController.signal,
      onPhase,
    });
    return { kind: "success", invocation };
  } catch (error) {
    return abortController.signal.aborted || isCancellation(error)
      ? { kind: "cancelled" }
      : { kind: "failure", error };
  } finally {
    if (this.#abortController === abortController) this.#abortController = undefined;
  }
}
```

Do not add OJ comparison, verdict, persistence, or timeout policy to this wrapper.

- [ ] **Step 5: Make ExecutorController phase and elapsed state callback-driven**

Remove the `executionPhase` import/use and remove `executionPhase` from `executor-model.ts`. At the start of `ExecutorController.execute`, clear prior output/elapsed without guessing `initializing` versus `running`. Hold one local optional timestamp and pass this callback to `ExecutorExecution.execute`:

```ts
let executionStartedAt: number | undefined;
this.#replace({ output: undefined, elapsedMs: undefined, error: this.#warning });

const completion = await this.#execution.execute(runtimeId, this.#current.source, (phase) => {
  if (!this.#isCurrentOperation(contextGeneration, operationGeneration)) return;
  if (phase === "executing" && executionStartedAt === undefined) {
    executionStartedAt = this.#deps.clock.now();
  }
  this.#replace({ phase: phase === "initializing" ? "initializing" : "running" });
});
```

After the current-operation guard, calculate once:

```ts
const elapsedMs = executionStartedAt === undefined
  ? 0
  : Math.max(0, this.#deps.clock.now() - executionStartedAt);
```

Include this `elapsedMs` in success, failure, and cancelled snapshot patches. Keep output absent for failure/cancellation. In `#handleRegistryChange`, update only `runtimeOptions`; delete the active-operation `initializing`/`running` snapshot heuristic so phase text cannot race Registry notifications. Keep generation guards, cancel behavior, immutable snapshots, and listener isolation unchanged.

- [ ] **Step 6: Make OjEngine start elapsed time on the first executing notification**

In `src/oj/judge-validation.ts`, import `RuntimeOperationPhase` and define:

```ts
export function judgeOperationOptions(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
  onPhase: (phase: RuntimeOperationPhase) => void,
): RuntimeOperationOptions {
  return {
    ...(signal === undefined ? {} : { signal }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    onPhase,
  };
}

export function elapsedMs(now: () => number, executionStartedAt: number | undefined): number {
  return executionStartedAt === undefined ? 0 : Math.max(0, now() - executionStartedAt);
}
```

In `OjEngine.run`, replace invocation-start timing with:

```ts
let executionStartedAt: number | undefined;
const onPhase = (phase: import("../runtime/supervisor.js").RuntimeOperationPhase) => {
  if (phase === "executing" && executionStartedAt === undefined) executionStartedAt = this.#now();
};
```

Pass `onPhase` to `judgeOperationOptions`. Every `failureResult` and `aggregateSubmission` call must use `elapsedMs(this.#now, executionStartedAt)`. Availability and already-aborted outcomes therefore report `0` without calling `now`; post-executing malformed responses, Worker/runtime failures, timeout, and cancellation report execution-only elapsed time. Keep source/case/timeout validation as pre-invocation exceptions and preserve existing identity binding, verdict mapping, case ordering, expected-value secrecy, and output bounds.

- [ ] **Step 7: Run the timing GREEN suite and verify downstream persistence/rendering**

```powershell
pnpm test tests/ui/executor-controller.test.ts tests/oj/engine.test.ts tests/services/submission-service.test.ts tests/ui/problem-workspace-controller.test.ts 2>&1 | Tee-Object -FilePath "artifacts/qa/runtime-operation-phases/task2-green.log"
if ($LASTEXITCODE -ne 0) { throw "Task 2 focused timing suite failed" }
git diff --check
if ($LASTEXITCODE -ne 0) { throw "Task 2 diff has whitespace errors" }
git diff -- "src/features/executor/executor-execution.ts" "src/features/executor/executor-controller.ts" "src/features/executor/executor-model.ts" "src/oj/engine.ts" "src/oj/judge-validation.ts" "tests/ui/executor-controller.test.ts" "tests/helpers/fake-runtime-adapter.ts" "tests/oj/engine.test.ts" "tests/services/submission-service.test.ts" "tests/ui/problem-workspace-controller.test.ts"
```

Expected: cold 80 + 12 and warm 12 both report exactly 12 in Executor and OJ; failure/cancellation before `executing` reports zero, after it reports 12; phase snapshots follow callbacks; `SubmissionService` still persists the engine's `elapsedMs: 12` unchanged; problem Run/Submit retains OJ verdict ownership and does not expose judge data.

### Task 3: Prove current RustPython receipt and real-browser timeout recovery

**Files:**
- Execute: `runtime-harness.html`
- Execute: `src/harness/runtime-contract-harness.ts`
- Execute: `scripts/verify-optional-runtime.mjs`
- Execute: `scripts/runtime-verification-server.mjs`
- Execute: `src/features/runtimes/RuntimeDetailsDialog.tsx`
- Execute: `src/features/executor/ExecutorWorkspace.tsx`
- Create: `artifacts/runtime-verification/python-rustpython.json`
- Create: `artifacts/qa/runtime-operation-phases/vite.stdout.log`
- Create: `artifacts/qa/runtime-operation-phases/vite.stderr.log`
- Create: `artifacts/qa/runtime-operation-phases/verifier.stdout.log`
- Create: `artifacts/qa/runtime-operation-phases/verifier.stderr.log`
- Create: `artifacts/qa/runtime-operation-phases/browser.stdout.log`
- Create: `artifacts/qa/runtime-operation-phases/browser.stderr.log`
- Create: `artifacts/qa/runtime-operation-phases/harness-recovery.json`
- Create: `artifacts/qa/runtime-operation-phases/product-recovery.json`
- Create: `artifacts/qa/runtime-operation-phases/runtime-harness.png`
- Create: `artifacts/qa/runtime-operation-phases/product-recovery.png`
- Create: `artifacts/qa/runtime-operation-phases/vite.pid`
- Create: `artifacts/qa/runtime-operation-phases/verifier.pid`
- Create: `artifacts/qa/runtime-operation-phases/browser-session.json`

**Interfaces:**
- Consumes: Tasks 1-2 GREEN behavior; current packaged `python-rustpython` manifest/assets; `OptionalRuntimeVerifier.verify("python-rustpython")`; `window.localCoderHarness.execute(runtimeId, source, options)`; optional-v1 ordered checks `assets`, `handshake`, `smoke`, `judge-contract`, `pyodide-corpus-parity`; product runtime verification and Executor controls.
- Produces: current digest-bound RustPython receipt with `VERIFIED`; harness evidence that warm timeout emits `executing`, terminates, preserves verification eligibility, and the next operation emits `initializing, executing` before success; product evidence that the RustPython selector remains enabled after timeout and a later execution succeeds; exact process cleanup receipt.

**Recommended executor:** `frontend`

- [ ] **Step 1: Gate browser QA on current packaged assets without altering protected RustPython inputs**

Run these commands separately:

```powershell
pnpm run runtime:check
if ($LASTEXITCODE -ne 0) { throw "Current runtime assets are broken; return to the owning RustPython plan" }
```

```powershell
$preReceiptOutput = & node scripts/verify-optional-runtime.mjs python-rustpython 2>&1
$preReceiptExit = $LASTEXITCODE
$preReceiptOutput
if ($preReceiptExit -notin @(0, 2)) { throw "RustPython verifier is BROKEN before browser QA" }
if ($preReceiptExit -eq 2 -and ($preReceiptOutput -join "`n") -notmatch '"status":"LOADABLE_UNVERIFIED"') {
  throw "Expected current packaged RustPython to be LOADABLE_UNVERIFIED before a fresh receipt"
}
```

Expected: `runtime:check` exits `0`; the verifier is either already `VERIFIED` against an existing current receipt or exits `2` with exactly `LOADABLE_UNVERIFIED`. `UNAVAILABLE` or `BROKEN` returns to the RustPython plan. Do not run `build:runtimes`, modify runner/host/manifest sources, or reuse `browser-playwright.json` as current evidence.

- [ ] **Step 2: Start Vite as an exact detached Node process and prove readiness/ownership**

```powershell
$evidenceRoot = (Resolve-Path "artifacts/qa/runtime-operation-phases").Path
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$vitePath = (Resolve-Path "node_modules/vite/bin/vite.js").Path
$viteProcess = Start-Process -FilePath $nodePath -ArgumentList @(
  $vitePath, "--host", "127.0.0.1", "--port", "5173", "--strictPort"
) -PassThru -RedirectStandardOutput "$evidenceRoot/vite.stdout.log" -RedirectStandardError "$evidenceRoot/vite.stderr.log"
$viteProcess.Id | Set-Content -LiteralPath "$evidenceRoot/vite.pid" -Encoding ascii
```

Then run the readiness check:

```powershell
$vitePid = [int](Get-Content -LiteralPath "artifacts/qa/runtime-operation-phases/vite.pid" -Raw)
$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  if (Get-Process -Id $vitePid -ErrorAction SilentlyContinue) {
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:5173/runtime-harness.html" -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
  }
  Start-Sleep -Milliseconds 250
}
if (-not $ready) { throw "Vite did not become ready on 127.0.0.1:5173" }
$listeners = @(Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -ne 1 -or $listeners[0].OwningProcess -ne $vitePid) {
  throw "Port 5173 is not owned by the recorded Vite PID"
}
```

Expected: HTTP `200`, one listener, and exact owner PID. A port conflict is an environment blocker; do not terminate a process that this task did not start.

- [ ] **Step 3: Start the bounded receipt verifier detached and prove its exact listener**

```powershell
$evidenceRoot = (Resolve-Path "artifacts/qa/runtime-operation-phases").Path
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$verifierProcess = Start-Process -FilePath $nodePath -ArgumentList @(
  "scripts/verify-optional-runtime.mjs", "python-rustpython", "--browser", "--port", "4181"
) -PassThru -RedirectStandardOutput "$evidenceRoot/verifier.stdout.log" -RedirectStandardError "$evidenceRoot/verifier.stderr.log"
$verifierProcess.Id | Set-Content -LiteralPath "$evidenceRoot/verifier.pid" -Encoding ascii
```

```powershell
$verifierPid = [int](Get-Content -LiteralPath "artifacts/qa/runtime-operation-phases/verifier.pid" -Raw)
$listening = $false
for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
  $listener = @(Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 4181 -State Listen -ErrorAction SilentlyContinue)
  if ($listener.Count -eq 1 -and $listener[0].OwningProcess -eq $verifierPid) { $listening = $true; break }
  if (-not (Get-Process -Id $verifierPid -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 250
}
if (-not $listening) { throw "Receipt verifier did not own 127.0.0.1:4181" }
```

Expected: the verifier stdout prints the exact optional-v1 harness URL and waits no longer than its bounded 120 seconds.

- [ ] **Step 4: Launch a throwaway real browser detached through loopback CDP**

Use the already-installed browser only. The first candidate reflects the currently observed installed Chromium; Edge/Chrome paths are safe fallbacks, not installation instructions:

```powershell
$evidenceRoot = (Resolve-Path "artifacts/qa/runtime-operation-phases").Path
$existingCdpListeners = @(Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue)
if ($existingCdpListeners.Count -ne 0) {
  throw "Port 9222 is already owned by another process; do not attach to or terminate it"
}
$browserCandidates = @(
  "C:\Users\hugefiver\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$browserPath = $browserCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if ($null -eq $browserPath) { throw "No already-installed Chromium/Edge browser is available; do not install one" }
$profilePath = Join-Path ([IO.Path]::GetTempPath()) "localcoder-runtime-phases-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $profilePath | Out-Null
$browserProcess = Start-Process -FilePath $browserPath -ArgumentList @(
  "--headless=new",
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=9222",
  "--user-data-dir=$profilePath",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-extensions",
  "about:blank"
) -PassThru -RedirectStandardOutput "$evidenceRoot/browser.stdout.log" -RedirectStandardError "$evidenceRoot/browser.stderr.log"
[ordered]@{ pid = $browserProcess.Id; executable = $browserPath; profile = $profilePath; cdpPort = 9222 } |
  ConvertTo-Json | Set-Content -LiteralPath "$evidenceRoot/browser-session.json" -Encoding utf8
```

```powershell
$session = Get-Content -LiteralPath "artifacts/qa/runtime-operation-phases/browser-session.json" -Raw | ConvertFrom-Json
$cdpReady = $false
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  try {
    $version = Invoke-RestMethod -Uri "http://127.0.0.1:9222/json/version" -TimeoutSec 2
    if ($version.webSocketDebuggerUrl -match '^ws://127\.0\.0\.1:9222/') { $cdpReady = $true; break }
  } catch {}
  if (-not (Get-Process -Id ([int]$session.pid) -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 250
}
if (-not $cdpReady) { throw "Browser CDP did not become ready on loopback" }
$cdpListeners = @(Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue)
if ($cdpListeners.Count -ne 1) { throw "Expected exactly one run-owned CDP listener" }
$cdpListenerPid = [int]$cdpListeners[0].OwningProcess
$cdpOwner = Get-CimInstance Win32_Process -Filter "ProcessId = $cdpListenerPid" -ErrorAction Stop
if ($cdpOwner.CommandLine -notmatch 'remote-debugging-port=9222' -or $cdpOwner.CommandLine -notlike "*$([string]$session.profile)*") {
  throw "CDP listener is not bound to the recorded throwaway profile"
}
$session | Add-Member -NotePropertyName listenerPid -NotePropertyValue $cdpListenerPid -Force
$session | ConvertTo-Json | Set-Content -LiteralPath "artifacts/qa/runtime-operation-phases/browser-session.json" -Encoding utf8
```

Expected: port 9222 was free before launch; a fresh temporary profile owns the sole loopback CDP listener; the listener command line contains both the exact port and recorded profile; no foreground process blocks the shell.

- [ ] **Step 5: Drive optional-v1 receipt verification and require current five-check evidence**

Using the configured real-browser/CDP automation attached to `http://127.0.0.1:9222`, navigate to:

```text
http://127.0.0.1:5173/runtime-harness.html?runtimeId=python-rustpython&receiptPort=4181&suite=optional-v1
```

Wait for the receipt POST and verifier completion. Capture `artifacts/qa/runtime-operation-phases/runtime-harness.png`, page console errors, Worker errors, and receipt response. Then validate from PowerShell:

```powershell
$verifierPid = [int](Get-Content -LiteralPath "artifacts/qa/runtime-operation-phases/verifier.pid" -Raw)
for ($attempt = 0; $attempt -lt 240; $attempt += 1) {
  if (-not (Get-Process -Id $verifierPid -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 500
}
if (Get-Process -Id $verifierPid -ErrorAction SilentlyContinue) { throw "Receipt verifier exceeded its bounded wait" }
$verifierLog = Get-Content -LiteralPath "artifacts/qa/runtime-operation-phases/verifier.stdout.log" -Raw
if ($verifierLog -notmatch '"status":"VERIFIED"' -or $verifierLog -notmatch 'python-rustpython') {
  throw "Current browser verification did not produce VERIFIED"
}
node --input-type=module -e 'import { reportRuntimeCapabilities } from "./scripts/report-runtime-capabilities.mjs"; const report=reportRuntimeCapabilities(); const runtime=report.optional.find((entry)=>entry.runtimeId==="python-rustpython"); if(runtime?.state!=="verified"||!report.verifiedOptionalRuntimeIds.includes("python-rustpython")) throw new Error(JSON.stringify(report)); console.log(JSON.stringify(runtime));'
if ($LASTEXITCODE -ne 0) { throw "Fresh RustPython receipt is not current and verified" }
```

Assert the receipt structure and exact ordered checks:

```powershell
node --input-type=module -e 'import fs from "node:fs"; const receipt=JSON.parse(fs.readFileSync("artifacts/runtime-verification/python-rustpython.json","utf8")); const expected=["assets","handshake","smoke","judge-contract","pyodide-corpus-parity"]; if(receipt.suite!=="optional-v1"||receipt.runtimeId!=="python-rustpython"||receipt.verification?.state!=="verified"||JSON.stringify(receipt.verification.checks)!==JSON.stringify(expected)) throw new Error(JSON.stringify(receipt)); const manifest=JSON.parse(fs.readFileSync("public/runtime-manifest.json","utf8")); const runtime=manifest.runtimes.find((entry)=>entry.runtimeId==="python-rustpython"); if(!runtime) throw new Error("missing runtime"); const receiptUrls=receipt.assets.map((asset)=>asset.url).sort(); const manifestUrls=runtime.assets.map((asset)=>asset.url).sort(); if(JSON.stringify(receiptUrls)!==JSON.stringify(manifestUrls)) throw new Error("receipt asset coverage differs from current manifest"); console.log(JSON.stringify({checks:receipt.verification.checks,assets:receipt.assets},null,2));'
if ($LASTEXITCODE -ne 0) { throw "Receipt checks or current asset coverage are incomplete" }
```

If verification is broken by RustPython smoke/parity (including the previously observed `_io.FileIO` import failure), stop after cleanup, retain logs/screenshots, and return to the RustPython plan. Do not change runner/host code here.

- [ ] **Step 6: Use the verified harness session to prove timeout recovery and a fresh handshake**

In the same harness page and browser context, evaluate this exact browser-side sequence and save the returned object to `artifacts/qa/runtime-operation-phases/harness-recovery.json`:

```js
async () => {
  const timeoutPhases = [];
  let timeoutFailure;
  try {
    await window.localCoderHarness.execute(
      "python-rustpython",
      "while True:\n    pass",
      { timeoutMs: 100, onPhase: (phase) => timeoutPhases.push(phase) },
    );
  } catch (error) {
    timeoutFailure = {
      kind: error?.kind,
      code: error?.code,
      message: error?.message,
    };
  }

  const recoveryPhases = [];
  const recovered = await window.localCoderHarness.execute(
    "python-rustpython",
    "print('runtime recovered')",
    { onPhase: (phase) => recoveryPhases.push(phase) },
  );
  return {
    timeoutPhases,
    timeoutFailure,
    recoveryPhases,
    recoveredIdentity: recovered.identity,
    recoveredStdout: recovered.payload.stdout.text,
  };
}
```

Machine assertions on the saved JSON:

```powershell
$evidence = Get-Content -LiteralPath "artifacts/qa/runtime-operation-phases/harness-recovery.json" -Raw | ConvertFrom-Json
if (($evidence.timeoutPhases -join ",") -ne "executing") { throw "Verified warm timeout emitted unexpected phases" }
if ($evidence.timeoutFailure.code -ne "execution-timeout") { throw "Harness did not observe execution-timeout" }
if (($evidence.recoveryPhases -join ",") -ne "initializing,executing") { throw "Recovery did not perform a fresh handshake" }
if ($evidence.recoveredStdout -notmatch "runtime recovered") { throw "Fresh operation did not succeed" }
if ([string]::IsNullOrWhiteSpace($evidence.recoveredIdentity.runtimeVersion) -or [string]::IsNullOrWhiteSpace($evidence.recoveredIdentity.buildId)) {
  throw "Fresh operation lacks handshake identity"
}
```

The first operation is warm after verification, so only `executing` is legal. The second operation succeeding without re-verification proves verification eligibility was preserved; its `initializing, executing` sequence proves the terminated generation was not reused.

- [ ] **Step 7: Prove the same recovery contract through the product Executor**

With CDP automation, navigate to `http://127.0.0.1:5173/#/executor` in the same throwaway browser profile but a fresh page. Produce `artifacts/qa/runtime-operation-phases/product-recovery.json` and `product-recovery.png` with these machine-checked actions:

1. Open `查看运行时详情`, find the `python-rustpython` card, click `验证运行时`, wait for `验证完成：rustpython-wasi。`, and require the card text `就绪`.
2. Close the dialog, select RustPython under `语言与本地运行时`, run the checked-in Python preset, and require stdout containing both `本地求和: 29` and `翻倍: [6, 10, 16, 26]`.
3. Replace the editor source with `while True:\n    pass`, click `执行`, observe `执行中`, and wait up to 35 seconds for `执行失败：Runtime execution timed out`. Parse the displayed local-reference elapsed value and require it to be at least 29,000 ms and at most 35,000 ms.
4. Without reopening verification, require the selected runtime remains `python-rustpython`, its option is not disabled, and the execute control is available again. Record these exact DOM states.
5. Restore the checked-in Python preset and execute again. Record that the UI passes through `正在初始化` and then `执行中`, require the same expected stdout, and require the second operation's displayed elapsed time to be nonnegative and less than 10,000 ms (cold handshake excluded).
6. Record console errors, page errors, Worker target create/destroy observations when exposed by CDP, and all network URLs. Reject any application API or CDN request; loopback Vite/receipt traffic and declared local runtime assets are the only allowed network.

Expected: product verification reaches ready, real timeout does not disable the selector, and the immediate retry performs a new initialization and succeeds. The 30-second timeout is product evidence only; deterministic 80/12 timing remains owned by Task 2 tests.

- [ ] **Step 8: Clean up only recorded PIDs/ports and the exact temporary profile, even on failure**

Run cleanup in a `finally` path. Verify command lines before termination:

```powershell
$evidenceRoot = (Resolve-Path "artifacts/qa/runtime-operation-phases").Path
$sessionPath = "$evidenceRoot/browser-session.json"
if (Test-Path -LiteralPath $sessionPath -PathType Leaf) {
  $session = Get-Content -LiteralPath $sessionPath -Raw | ConvertFrom-Json
  $browserPid = [int]$session.pid
  $browserInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $browserPid" -ErrorAction SilentlyContinue
  if ($null -ne $browserInfo) {
    if ($browserInfo.CommandLine -notmatch 'remote-debugging-port=9222' -or $browserInfo.CommandLine -notlike "*$($session.profile)*") {
      throw "Recorded browser PID no longer matches this QA session"
    }
    Stop-Process -Id $browserPid
    Wait-Process -Id $browserPid -Timeout 15 -ErrorAction SilentlyContinue
  }
  $profileChildren = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*$($session.profile)*" })
  foreach ($child in $profileChildren) { Stop-Process -Id $child.ProcessId; Wait-Process -Id $child.ProcessId -Timeout 10 -ErrorAction SilentlyContinue }

  $profile = [IO.Path]::GetFullPath([string]$session.profile)
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if (-not $profile.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $profile -Leaf) -notmatch '^localcoder-runtime-phases-[0-9a-f]{32}$') {
    throw "Refusing to delete unexpected browser profile path: $profile"
  }
  if (Test-Path -LiteralPath $profile) { Remove-Item -LiteralPath $profile -Recurse -Force }
}

$verifierPidPath = "$evidenceRoot/verifier.pid"
if (Test-Path -LiteralPath $verifierPidPath -PathType Leaf) {
  $verifierPid = [int](Get-Content -LiteralPath $verifierPidPath -Raw)
  $verifierInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $verifierPid" -ErrorAction SilentlyContinue
  if ($null -ne $verifierInfo) {
    if ($verifierInfo.CommandLine -notmatch 'verify-optional-runtime\.mjs.*python-rustpython.*4181') {
      throw "Recorded verifier PID no longer matches this QA session"
    }
    Stop-Process -Id $verifierPid
    Wait-Process -Id $verifierPid -Timeout 10 -ErrorAction SilentlyContinue
  }
}

$vitePidPath = "$evidenceRoot/vite.pid"
if (Test-Path -LiteralPath $vitePidPath -PathType Leaf) {
  $vitePid = [int](Get-Content -LiteralPath $vitePidPath -Raw)
  $viteInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $vitePid" -ErrorAction SilentlyContinue
  if ($null -ne $viteInfo) {
    if ($viteInfo.CommandLine -notmatch 'vite\.js.*127\.0\.0\.1.*5173') {
      throw "Recorded Vite PID no longer matches this QA session"
    }
    Stop-Process -Id $vitePid
    Wait-Process -Id $vitePid -Timeout 10 -ErrorAction SilentlyContinue
  }
}

foreach ($port in @(4181, 5173, 9222)) {
  $listener = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  if ($listener.Count -ne 0) { throw "QA-owned port $port still has a listener; inspect exact PID before any action" }
}
```

Expected: only this task's recorded browser/profile-bound children, verifier, and Vite process are stopped; all three ports are free; the exact throwaway profile is deleted; unrelated browser/Node processes remain untouched.

### Task 4: Run full regression, isolated write-producing gates, current-receipt validation, cleanup, and final review

**Files:**
- Inspect: every changed path from `git status --short` and `git diff --name-status`
- Inspect: `artifacts/runtime-verification/python-rustpython.json`
- Inspect: `artifacts/qa/runtime-operation-phases/protected-baseline-hashes.json`
- Create: `artifacts/qa/runtime-operation-phases/typecheck.log`
- Create: `artifacts/qa/runtime-operation-phases/lint.log`
- Create: `artifacts/qa/runtime-operation-phases/full-test.log`
- Create: `artifacts/qa/runtime-operation-phases/runtime-manifest.log`
- Create: `artifacts/qa/runtime-operation-phases/runtime-check.log`
- Create: `artifacts/qa/runtime-operation-phases/build.log`
- Create: `artifacts/qa/runtime-operation-phases/smoke.log`
- Create: `artifacts/qa/runtime-operation-phases/runtime-report.log`
- Create/replace: `artifacts/qa/working-tree-identity.json`
- Create: `artifacts/qa/runtime-operation-phases/final-status.txt`

**Interfaces:**
- Consumes: all Task 1-3 GREEN logs, fresh current RustPython receipt, browser recovery evidence, the protected baseline hash set, repository quality gates, and working-tree identity generator.
- Produces: zero-warning full regression evidence, current receipt after all generators, unchanged protected RustPython work, no leaked QA process/profile, exact identity, and a requesting-code-review handoff with no Git write.

**Recommended executor:** `complex`

- [ ] **Step 1: Run typecheck and lint separately**

```powershell
pnpm run typecheck 2>&1 | Tee-Object -FilePath "artifacts/qa/runtime-operation-phases/typecheck.log"
if ($LASTEXITCODE -ne 0) { throw "typecheck failed" }
```

```powershell
pnpm run lint 2>&1 | Tee-Object -FilePath "artifacts/qa/runtime-operation-phases/lint.log"
if ($LASTEXITCODE -ne 0) { throw "lint failed" }
```

Expected: both exit `0`; lint has zero warnings.

- [ ] **Step 2: Run the complete Node suite alone**

```powershell
pnpm test 2>&1 | Tee-Object -FilePath "artifacts/qa/runtime-operation-phases/full-test.log"
if ($LASTEXITCODE -ne 0) { throw "full test suite failed" }
```

Expected: every discovered test passes, the new phase/timing/recovery tests are present, and `.test-dist` is removed by the harness. Do not overlap this command with any focused or full `pnpm test` process.

- [ ] **Step 3: Run manifest/readiness/build/smoke gates in an isolated OS-temp copy**

The main worktree's `public/runtime-manifest.json` and `public/rustpython-worker.js` are protected RustPython outputs. Copy the exact dirty source tree, including ignored packaged runtime assets, to a unique OS-temp directory while excluding only non-input state. Then physically mirror the already-installed `node_modules` store beneath that directory while preserving pnpm's relative symbolic links; every resolved dependency path must remain below the isolated root. Run every write-producing gate there. Keep logs under the main worktree evidence root and remove only the exact temp directory in `finally`:

```powershell
$sourceRoot = (Resolve-Path ".").Path
$evidenceRoot = (Resolve-Path "artifacts/qa/runtime-operation-phases").Path
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
if (-not (Test-Path -LiteralPath $tempRoot -PathType Container)) { throw "OS temp root is unavailable" }
$validationRoot = Join-Path $tempRoot "localcoder-phase-validation-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $validationRoot | Out-Null
try {
  $excludedDirectories = @(
    (Join-Path $sourceRoot ".git"),
    (Join-Path $sourceRoot "node_modules"),
    (Join-Path $sourceRoot "dist"),
    (Join-Path $sourceRoot ".test-dist"),
    (Join-Path $sourceRoot "artifacts"),
    (Join-Path $sourceRoot "runtimes/rustpython-runner/target")
  )
  & robocopy.exe $sourceRoot $validationRoot /E /R:1 /W:1 /XD $excludedDirectories /NFL /NDL /NJH /NJS /NP
  if ($LASTEXITCODE -gt 7) { throw "Failed to copy the exact dirty tree for isolated validation" }
  $sourceNodeModules = (Resolve-Path "node_modules").Path
  $validationNodeModules = Join-Path $validationRoot "node_modules"
  New-Item -ItemType Directory -Path $validationNodeModules | Out-Null
  & robocopy.exe $sourceNodeModules $validationNodeModules /E /SL /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
  if ($LASTEXITCODE -gt 7) { throw "Failed to mirror installed dependencies into isolated validation" }
  foreach ($dependency in @("vite", "esbuild", "typescript")) {
    $resolvedDependency = & node -e "console.log(require('node:fs').realpathSync(process.argv[1]))" (Join-Path $validationNodeModules $dependency)
    if ($LASTEXITCODE -ne 0 -or -not ([IO.Path]::GetFullPath($resolvedDependency)).StartsWith([IO.Path]::GetFullPath($validationRoot), [StringComparison]::OrdinalIgnoreCase)) {
      throw "Dependency $dependency resolves outside the isolated validation root"
    }
  }

  Push-Location $validationRoot
  try {
    pnpm run runtime:manifest 2>&1 | Tee-Object -FilePath "$evidenceRoot/runtime-manifest.log"
    if ($LASTEXITCODE -ne 0) { throw "isolated runtime:manifest failed" }
    pnpm run runtime:check 2>&1 | Tee-Object -FilePath "$evidenceRoot/runtime-check.log"
    if ($LASTEXITCODE -ne 0) { throw "isolated runtime:check failed" }
    pnpm run build 2>&1 | Tee-Object -FilePath "$evidenceRoot/build.log"
    if ($LASTEXITCODE -ne 0) { throw "isolated build failed" }
    pnpm run smoke 2>&1 | Tee-Object -FilePath "$evidenceRoot/smoke.log"
    if ($LASTEXITCODE -ne 0) { throw "isolated smoke failed" }
  } finally {
    Pop-Location
  }

  foreach ($protectedGenerated in @("public/runtime-manifest.json", "public/rustpython-worker.js")) {
    $mainHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $sourceRoot $protectedGenerated)).Hash
    $isolatedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $validationRoot $protectedGenerated)).Hash
    if ($mainHash -ne $isolatedHash) { throw "Isolated generator output differs for protected $protectedGenerated; return ownership to the RustPython plan" }
  }
} finally {
  $resolvedValidationRoot = [IO.Path]::GetFullPath($validationRoot)
  if (-not $resolvedValidationRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolvedValidationRoot -Leaf) -notmatch '^localcoder-phase-validation-[0-9a-f]{32}$') {
    throw "Refusing to delete unexpected isolated validation path: $resolvedValidationRoot"
  }
  if (Test-Path -LiteralPath $resolvedValidationRoot) { Remove-Item -LiteralPath $resolvedValidationRoot -Recurse -Force }
}
```

Expected: the physical pnpm store and all sampled package realpaths stay beneath the isolated root; all isolated gates exit `0`; required runtimes have no skip; RustPython assets remain packaged; isolated generated manifest/Worker bytes equal the protected main-worktree bytes; the temporary copy is removed. The main worktree is never a write target for these generators.

- [ ] **Step 4: Revalidate the current receipt and capability report after all generators**

```powershell
pnpm run runtime:report 2>&1 | Tee-Object -FilePath "artifacts/qa/runtime-operation-phases/runtime-report.log"
if ($LASTEXITCODE -ne 0) { throw "runtime capability report failed" }
node --input-type=module -e 'import { reportRuntimeCapabilities } from "./scripts/report-runtime-capabilities.mjs"; const report=reportRuntimeCapabilities(); const runtime=report.optional.find((entry)=>entry.runtimeId==="python-rustpython"); if(runtime?.state!=="verified"||!report.verifiedOptionalRuntimeIds.includes("python-rustpython")) throw new Error(JSON.stringify(report)); console.log(JSON.stringify({runtime,verifiedOptionalRuntimeIds:report.verifiedOptionalRuntimeIds}));'
if ($LASTEXITCODE -ne 0) { throw "RustPython receipt became stale or invalid; rerun Task 3 on the settled tree" }
```

Expected: `python-rustpython` is exactly `verified`, `verifiedOptionalRuntimeIds` contains it, required runtimes remain packaged, and no runtime is `BROKEN`. If Task 3 was prerequisite-blocked, this step must not be marked passed.

- [ ] **Step 5: Prove protected RustPython work was not overwritten**

```powershell
$baseline = Get-Content -LiteralPath "artifacts/qa/runtime-operation-phases/protected-baseline-hashes.json" -Raw | ConvertFrom-Json
$changedProtected = @()
foreach ($entry in $baseline) {
  if (-not (Test-Path -LiteralPath $entry.path -PathType Leaf)) {
    $changedProtected += "$($entry.path): missing"
    continue
  }
  $current = (Get-FileHash -Algorithm SHA256 -LiteralPath $entry.path).Hash.ToLowerInvariant()
  if ($current -ne $entry.sha256) { $changedProtected += "$($entry.path): hash changed" }
}
if ($changedProtected.Count -ne 0) {
  throw "Protected pre-existing work was modified: $($changedProtected -join '; ')"
}
```

Expected: every protected file, including `.debug-journal.md`, retains its baseline hash. If a generator changed a protected generated RustPython file, inspect ownership and return to the RustPython plan; do not silently accept or restore it.

- [ ] **Step 6: Inspect exact scope, whitespace, diagnostics, and remaining processes**

```powershell
git status --short
git diff --name-status
git diff --stat
git diff --check
if ($LASTEXITCODE -ne 0) { throw "final diff has whitespace errors" }
git diff -- "src/runtime/supervisor-types.ts" "src/runtime/supervisor.ts" "src/runtime/supervisor-lifecycle.ts" "src/runtime/registry.ts" "src/features/executor/executor-execution.ts" "src/features/executor/executor-controller.ts" "src/features/executor/executor-model.ts" "src/oj/engine.ts" "src/oj/judge-validation.ts" "tests/runtime/registry.test.ts" "tests/runtime/supervisor.test.ts" "tests/runtime/optional-verification.test.ts" "tests/ui/executor-controller.test.ts" "tests/helpers/fake-runtime-adapter.ts" "tests/oj/engine.test.ts"
```

Expected phase-plan source scope is limited to the exact production/test files above. Pre-existing RustPython modifications and evidence remain visible but byte-identical to Task 1's baseline. No Worker protocol, receipt schema, runtime identity input, generated Worker source, runner, host, or unrelated UI file is part of the phase implementation.

Call `lsp_status`, then `lsp_diagnostics` with severity `all` for every changed TypeScript source/test file in this plan. Expected: zero errors and zero warnings. Generated JSON/evidence is validated by its owning scripts rather than LSP.

Finally, prove no QA listener/profile remains:

```powershell
foreach ($port in @(4181, 5173, 9222)) {
  if (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -ne 0) {
    throw "Unexpected listener remains on QA port $port"
  }
}
$session = Get-Content -LiteralPath "artifacts/qa/runtime-operation-phases/browser-session.json" -Raw | ConvertFrom-Json
if (Test-Path -LiteralPath ([string]$session.profile)) { throw "Throwaway browser profile still exists" }
```

- [ ] **Step 7: Generate the exact final working-tree identity**

```powershell
pnpm run identity
if ($LASTEXITCODE -ne 0) { throw "working-tree identity generation failed" }
$identity = Get-Content -LiteralPath "artifacts/qa/working-tree-identity.json" -Raw | ConvertFrom-Json
if ($identity.algorithm -ne "sha256" -or [string]::IsNullOrWhiteSpace($identity.digest) -or $identity.files -le 0) {
  throw "working-tree identity artifact is incomplete"
}
$identity | ConvertTo-Json -Depth 5
```

Expected: a non-empty SHA-256 digest and positive file count for the exact tested tree. Any later source, test, manifest, Worker, asset, or receipt change invalidates this identity and the affected evidence.

- [ ] **Step 8: Write one unambiguous final status and request final code review**

Write `artifacts/qa/runtime-operation-phases/final-status.txt` with leading line `VERIFIED` only if Tasks 1-4 are all green on the same identity and the current RustPython receipt/product recovery passed. Otherwise use exactly `RUSTPYTHON_PREREQUISITE_BLOCKED` or `ENVIRONMENT_BLOCKED`. Follow the leading line with the identity digest, focused/full command exits, current receipt path/checks, harness/product evidence paths, protected-hash result, changed phase files, and any blocker.

Use the `requesting-code-review` workflow and provide the reviewer:

- approved spec `docs/superpowers/specs/2026-08-30-runtime-operation-phases-design.md`;
- this plan;
- complete `git diff` for the phase files and `git status --short` showing protected pre-existing work;
- Task 1/2 RED and GREEN logs plus full typecheck/lint/test/build/smoke/runtime reports;
- current `artifacts/runtime-verification/python-rustpython.json`;
- `harness-recovery.json`, `product-recovery.json`, screenshots, process cleanup evidence, and final working-tree identity;
- explicit review checks for callback isolation, ordinary-versus-verification failure classification, Registry transition legality, queue/generation exactly-once behavior, cold/warm timing, OJ secrecy/verdict ownership, and absence of Worker protocol/identity-input changes.

Expected: no blocking finding. A finding that changes any production/test input invalidates the current review receipt and requires the owning RED/GREEN tests plus affected browser/current-identity evidence to be rerun.

- [ ] **Step 9: End at a no-write review boundary**

```powershell
git status --short
git diff --name-status
git log -1 --oneline
```

Expected: the latest commit is unchanged from the starting commit; all phase implementation, existing RustPython work, receipts, and QA evidence remain visible for user inspection. Do not stage, commit, push, tag, restore, clean, or stash anything.
