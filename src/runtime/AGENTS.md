# Runtime Knowledge Base

## OVERVIEW

`src/runtime/` owns the main-thread runtime kernel: manifest parsing, capability
state, Worker supervision, protocol validation, and runtime-facing adapters.
Start with `docs/architecture/runtime-kernel.md`; consult
`docs/operations/runtime-assets.md` for packaging and verification evidence.
`manifest.ts` parses the generated manifest as the current packaging authority.
`registry.ts` turns its entries into immutable capability snapshots and state
transitions. `isRuntimeExecutionEligible` is the one execution gate: an
optional runtime is ineligible until its verification state is `verified`.

## WHERE TO LOOK

| Concern | Location |
|---|---|
| Manifest schema and strict parser | `manifest.ts` |
| Runtime capability state and eligibility | `registry.ts` |
| Queueing, lifecycle, and Worker recovery | `supervisor.ts`, `supervisor-*.ts` |
| Versioned request and response contracts | `protocol.ts` |
| Runtime-specific execution contracts | `adapters/`, especially `adapters/registry.ts` and `adapters/types.ts` |
| Optional runtime verification flow | `optional-verification.ts` |
| Browser Worker construction | `browser-worker-factory.ts`, `worker-port.ts` |

## CONVENTIONS

- Treat manifest capability state and verification state as orthogonal. Packaged
  optional assets begin unverified, not executable.
- Keep `RuntimeRegistry` snapshots frozen and use its transition rules. UI and
  callers must derive choices from Registry snapshots, never copied ID lists.
- `OptionalRuntimeVerifier` alone obtains the Supervisor's opaque, bounded
  verification authority. Normal operations cannot supply or forge that authority.
- Require a successful protocol handshake before execution. Carry that Worker
  generation's `runtimeVersion` and `buildId` with completions; identity is a
  build-correlation value, not authentication, and is never inferred later.
- Preserve one active operation per runtime and FIFO queue order. A timeout,
  cancellation, malformed message, Worker error, or fatal failure ends that
  generation, clears listeners and timers, and allows a later fresh handshake.
- Parse manifest and protocol input as strict plain records with exact fields,
  known discriminants, canonical JSON values, and UTF-8 byte bounds. Keep source,
  case-count, identifier, failure-text, and combined-output limits enforced.
- Adapters translate the canonical execute and judge contracts for a runtime;
  register new adapters through `adapters/registry.ts` and keep their identities
  aligned with the Supervisor invocation contract.

## ANTI-PATTERNS

- Don't enable a packaged optional because files exist, or bypass
  `isRuntimeExecutionEligible` for direct execution.
- Don't expose, persist, compare, or construct verification authorities outside
  the opaque Supervisor session.
- Don't reuse a Worker after terminal failure, accept late messages from a prior
  generation, or weaken FIFO, timeout, cancellation, or recovery handling.
- Don't trust a manifest refresh as the identity of an already completed call.
- Don't accept permissive envelopes, unknown fields, unbounded output, or
  malformed JSON-shaped values at either manifest or protocol boundaries.

## TESTS

- Cover manifest parsing and generated-manifest assumptions in
  `tests/runtime/manifest.test.ts` and `tests/runtime/generated-manifest.test.ts`.
- Cover Registry transitions, verification eligibility, and snapshots in
  `tests/runtime/registry.test.ts`; cover verification authority and contracts in
  `tests/runtime/optional-verification.test.ts`.
- Cover handshake identity, FIFO scheduling, generations, timeouts, cancellation,
  and recovery in `tests/runtime/supervisor.test.ts`.
- Cover strict protocol envelopes and bounded payloads in
  `tests/runtime/protocol.test.ts`. Adapter behavior belongs in the matching
  `tests/runtime/*-adapter.test.ts` file.
