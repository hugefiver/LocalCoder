# Runtime Operation Phases Design

**Date:** 2026-08-30
**Status:** Approved by delegated authority
**Product:** LocalCoder

## 1. Goal

Separate runtime initialization from user-code execution so a user operation timeout or cancellation destroys only the current Worker generation, leaves the runtime capability recoverable and selectable, and reports elapsed time for user execution rather than cold initialization.

## 2. Scope

Included:

- Explicit `initializing` and `executing` notifications for one Supervisor operation.
- Recoverable Registry transitions after execution timeout or cancellation.
- Executor and OJ elapsed time beginning when user execution starts.
- Regression coverage for cold/warm execution, recovery, verification preservation, cancellation, callback safety, and infrastructure failures.
- Real-browser proof that RustPython remains selectable and can execute again after a timed-out operation.

Excluded:

- Worker protocol or runtime receipt schema changes.
- Automatic replay of timed-out or queued user code.
- A full two-axis Registry redesign.
- Memory limits, authoritative device timing, or a new monotonic clock abstraction.
- Treating Worker crashes, malformed protocol messages, or initialization timeouts as recoverable user failures.

## 3. Approaches

1. **Operation phase callback plus recoverable capability state — chosen.** Add a narrow callback to existing operation options, emit phases at the Supervisor boundary, and let Executor/OJ time from `executing`. This preserves existing adapter signatures and protocol envelopes.
2. **Timing metadata on every invocation and failure.** More authoritative as a result object, but it changes all invocation fixtures and still needs a separate mechanism for live UI phase text.
3. **Split Registry into capability health and operation activity.** Architecturally broad and unnecessary for this defect; it would reshape every Registry consumer.

## 4. Interfaces

`src/runtime/supervisor-types.ts` defines:

```ts
export type RuntimeOperationPhase = "initializing" | "executing";

export interface RuntimeOperationOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onPhase?: (phase: RuntimeOperationPhase) => void;
}
```

`QueuedOperation` carries the same callback. Adapters already pass `RuntimeOperationOptions` into the Supervisor, so no Worker protocol field is added.

The Supervisor invokes callbacks synchronously at phase boundaries but isolates callback exceptions. A UI observer must never break runtime execution.

## 5. Lifecycle and State

The lifecycle emits `initializing` only when a new Worker generation actually begins handshake. A warm session operation with an initialized Worker skips that notification. Immediately before sending an `execute` or `judge` request, it emits `executing`.

Terminal outcomes are classified by phase and authority:

| Outcome | Worker generation | Registry state | Verification |
|---|---|---|---|
| Initialization success | retained | `ready` / `verifying` | unchanged |
| User execution success or nonfatal language failure | reuse policy | `ready` / `verifying` | unchanged |
| Execution timeout | terminated | `loadable` | unchanged |
| User cancellation before or during execution | terminated | `loadable` | unchanged |
| Initialization timeout | terminated | `failed` | unchanged |
| Worker crash, malformed protocol, or fatal runtime failure | terminated | `failed` | unchanged |
| Optional verification timeout/fault | terminated | `failed` | remains unverified; no receipt |

`initializing -> loadable` and `running -> loadable` become legal Registry transitions. Recovery never reuses the terminated generation; the next explicit operation performs a fresh handshake. Active and queued operations retain the existing exactly-once settlement policy and are not automatically replayed.

## 6. Timing and Presentation

Executor and OJ hold an optional `executionStartedAt`. Their operation callback sets it on the first `executing` notification. Elapsed time is `max(0, now() - executionStartedAt)` when execution started, otherwise `0`.

- Cold initialization is excluded.
- Warm execution measures normally.
- A timeout, runtime error, or cancellation after `executing` reports elapsed user-execution time.
- Availability failure, validation failure, initialization timeout, or cancellation before `executing` reports `0`.

Executor phase text comes from the callback, not from a Registry snapshot heuristic. Existing UI components continue rendering the current phase and `elapsedMs`; no visual redesign is required.

## 7. Error and Verification Boundaries

Only `execution-timeout` and `cancelled` from an ordinary operation recover to `loadable`. Initialization failures and infrastructure faults remain `failed` so the UI does not conceal a broken capability. Optional verification retains fail-closed behavior even when its underlying failure code is timeout or cancellation.

Verification is orthogonal to capability state. A previously verified optional runtime that returns to `loadable` remains eligible and selectable; an unverified optional runtime does not become eligible merely because it is loadable.

## 8. Tests and Acceptance

RED tests must prove:

1. Cold initialization of 80 ms plus execution of 12 ms reports 12 ms in Executor and OJ; warm execution also reports 12 ms.
2. Post-handshake timeout terminates the generation, returns Registry state to `loadable`, preserves verification, leaves runtime options enabled, and succeeds after a fresh Worker/handshake.
3. Initialization timeout, Worker error, protocol fault, and fatal failure remain `failed`.
4. Cancellation before/during execution returns to `loadable`; elapsed is zero before execution and measured during execution.
5. A throwing phase callback does not alter operation completion.
6. Late messages from a terminated generation and queued operations still settle exactly once.
7. Optional verification timeout remains broken and cannot produce a verified receipt.

Final browser acceptance must use detached PowerShell `Start-Process` launches with redirected logs and exact PID cleanup. It must regenerate the current RustPython optional-v1 receipt, show `VERIFIED`, run the product executor, force an execution timeout, confirm the runtime stays selectable/recoverable, and run a succeeding operation afterward.

## 9. Constraints

- Do not install software.
- Do not execute Git writes without explicit user permission.
- Do not change Worker protocol, receipt schema, runtime build identity inputs, or unrelated runtime behavior.
- Preserve FIFO queueing, generation isolation, output bounds, optional verification authority, and OJ ownership of verdict comparison.
