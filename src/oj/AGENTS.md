# Online Judge Core

## OVERVIEW

- `OjEngine` is the main-thread boundary for judging a `JudgeCommand`.
- This directory owns selected cases, expected values, JSON comparison, verdict selection, and the public `SubmissionResult` shape.
- `case-selection.ts` fixes case order as public, then custom, then judge. Run selects public and custom cases; Submit also selects judge cases.
- `engine.ts` validates the command, resolves a judge-capable runtime, invokes its adapter once with inputs only, validates the response, then aggregates it.
- Workers return actual JSON values or structured failures. They never receive expected values, comparison results, pass flags, or verdicts.

## WHERE TO LOOK

- `engine.ts`: orchestration, availability handling, cancellation, elapsed time, and runtime invocation failures.
- `case-selection.ts`: visibility labels and deterministic selected-case indexes.
- `judge-validation.ts`: command, canonical JSON, source/case/timeout limits, and runtime eligibility checks.
- `judge-response.ts`: strict handshake and payload parsing, output bounds, response count, and index validation.
- `comparer.ts`: iterative structural JSON comparison with precise mismatch paths and reasons.
- `submission-aggregation.ts`: visible results, judge-only summaries, output aggregation, and failure-to-verdict mapping.
- `../domain/submission.ts`: the shared command, selected case, result, and verdict contracts.

## INVARIANTS

- Expected values remain in this main-thread core. Compare each successful actual value through `compareJson`; never accept an adapter's claimed pass state.
- Response entries may arrive in any order, but each selected index must appear exactly once. Reorder by selected-case order before aggregation so the first failure and visible logs are deterministic.
- Run exposes only public and custom cases. Submit sends public, custom, and judge inputs to the adapter, but returns judge data as count-only `judgeSummary`.
- Never expose judge inputs, expected values, actual values, stdout, stderr, failure details, or visibility in a `SubmissionResult`.
- Include `runtimeVersion` and `buildId` only after a validated Worker handshake. Manifest metadata is not execution identity; a rejected failure may carry identity only when the Supervisor bound it from a handshake.
- Map failures as follows: compile to `compile-error`, runtime to `runtime-error`, cancelled to `cancelled`, and infrastructure `execution-timeout` to `time-limit-exceeded`. All other protocol, infrastructure, malformed-response, and invocation failures become `internal-error`.
- A disabled, incompatible, unpackaged, non-judge-capable, or unregistered runtime produces `runtime-unavailable` without an adapter call or runtime identity.

## ANTI-PATTERNS

- Don't move expected-value comparison or verdict selection into adapters, Workers, feature code, or services.
- Don't trust Worker response order, allow duplicate or missing indexes, or aggregate by response position before validation.
- Don't add per-judge-case output, diagnostics, or result objects, even for a failing submission.
- Don't derive runtime identity from the manifest, registry capability, adapter configuration, or a caught error that lacks bound handshake identity.
- Don't make this core import React or storage, persist submissions, or decide UI presentation.

## TESTS

- `tests/oj/case-selection.test.ts` covers mode-specific selection, visibility, order, and indexes.
- `tests/oj/comparer.test.ts` covers JSON equality and mismatch paths, types, keys, arrays, and nesting.
- `tests/oj/judge-validation.test.ts` covers command shape, canonical JSON, limits, runtime eligibility, and operation options.
- `tests/oj/engine.test.ts` covers handshake identity, verdict mappings, malformed response indexes, selected-order aggregation, and judge-data secrecy.
- For a behavior change, add the focused OJ test first and ensure any result assertion proves judge values and logs remain absent.
