# Runtime Kernel

## Purpose and boundary

The runtime kernel gives LocalCoder one local execution and judging path across heterogeneous browser runtimes. It supports local practice only. It does not make browser code a secure sandbox, turn shipped judge cases into secrets, or create a trusted contest environment.

The runtime flow is:

```text
Generated manifest → Runtime Registry → Runtime Supervisor → Runtime Adapter
    → versioned Worker endpoint → OJ Engine → SubmissionService → IndexedDB repository
```

The Registry consumes the generated manifest and exposes only capability-derived choices. The Supervisor owns Worker lifetime. An Adapter translates the canonical contract to one runtime. The Worker endpoint validates protocol envelopes and returns actual values or structured failures. The OJ Engine owns case selection, expected-value comparison, and verdict mapping. SubmissionService makes the accepted submission and progress write atomic through storage.

## Language and runtime identities

`LanguageId` describes source syntax and templates:

```text
javascript | typescript | python | racket | haskell
```

`RuntimeId` describes the executable implementation:

```text
javascript-worker | typescript-official | python-pyodide |
python-rustpython | racket-wasm | haskell-ghc-wasi
```

RustPython is a Python runtime, not a second language. Drafts and submissions include both the language and runtime IDs. A Worker handshake returns the runtime version and build ID for that specific Worker generation. The Supervisor carries that identity with every completed execute or judge operation. It does not infer identity from a later manifest refresh. It is a build correlation value, not an authenticated identity or a cryptographic assurance.

Generated identities are build-specific evidence, not permanent values. Read the identities for the current build from `public/runtime-manifest.json` and `docs/qa/2026-08-24-localcoder-rebuild-results.md`.

## Worker protocol and handshake

Every request, response, and status event contains `protocolVersion`, `requestId`, and `runtimeId`. Protocol version 1 accepts `initialize`, `execute`, `judge`, and `dispose`. The endpoint rejects unknown versions, blank request IDs, malformed payloads, and runtime-ID mismatches.

Initialization is a required handshake. The Worker returns its runtime version, build ID, and capabilities. Until that response matches the requested runtime and protocol, no execute or judge request is accepted. A response whose identity changes after handshake is a protocol failure.

Judge requests contain source and inputs only. Workers never receive expected values and never decide AC or WA. They return per-case actual JSON-compatible values or structured compile, runtime, infrastructure, protocol, or cancellation failures. The main-thread OJ Engine compares actual and expected values with `json-deep-equal`, selects the verdict, and records local elapsed time plus the handshake identity.

Any malformed message, Worker error, fatal failure, timeout, or cancellation ends the active generation. A post-handshake failure result retains the identity that the completed handshake supplied. A failure before handshake has no runtime/build identity and must be reported as infrastructure or protocol failure rather than attributed to an invented build.

## Supervisor lifecycle

The Supervisor permits one active task per runtime. Session-reused runtimes queue requests FIFO. JavaScript and TypeScript use a fresh Worker per submission. Session runtimes may retain loaded assets, but each submission receives a fresh namespace or filesystem context.

On initialization timeout, execution timeout, cancellation, Worker error, malformed message, or fatal runtime failure, the Supervisor clears timers and listeners, settles active and queued work once, terminates the Worker, and moves to a restartable state. Generation numbers prevent a late message from an old Worker from changing a later result. The next operation creates a new Worker and repeats the handshake.

### Optional verification gate

Verification is orthogonal to capability state: the Registry records `not-required`, `unverified`, or `verified`. A packaged optional starts `unverified`, remains disabled in the UI and controller, is rejected by the OJ Engine, and cannot be executed through direct Supervisor validation. These checks apply before and during verification, so regular execution cannot create a Worker for an unverified optional.

`OptionalRuntimeVerifier` obtains the only permitted temporary authority through an opaque, bounded Supervisor verification session. It runs the required checks inside that session and changes the Registry entry to `verified` and `ready` only after success. A Worker failure, timeout, or cancellation after success does not erase `verified`; the next normal operation can recover with a fresh Worker. Current optional runtimes remain `UNAVAILABLE`, so no optional execution result is claimed.

## Submission and persistence semantics

Run sends only public and custom cases to the OJ Engine. It has no persistence side effect and cannot change solved progress. Submit includes judge cases. For applicable AC, WA, CE, RE, TLE, and internal-error outcomes, SubmissionService passes an attempt delta to the repository without reading progress outside the transaction. The repository uses one `readwrite` IndexedDB transaction to read and merge progress, add the submission, put progress, and trim history. Cancelled, unavailable, and pre-invocation failures without an identity create no submission record. AC also sets accepted or solved metadata, while a later non-AC result preserves that prior accepted metadata. The memory driver serializes transactions before taking its snapshot, matching this atomic merge behavior. Consequently, concurrent submits do not lose attempts, submissions, or accepted metadata. Each persisted record includes language, runtime, and runtime/build identity. Judge cases can be concealed from ordinary result UI, yet cases delivered to the browser are inspectable and cannot be called secret.

The repository owns six IndexedDB stores: `drafts`, `customCases`, `submissions`, `progress`, `settings`, and `meta`. It migrates legacy `localStorage` data idempotently. When IndexedDB is unavailable or quota fails, it uses memory for the current session and exposes `未保存` persistently.

## Trust limits

Worker termination improves local responsiveness but does not contain hostile code. Main-thread timeout produces a local TLE reference, not a server-authoritative performance measurement. Memory use cannot be authoritatively bounded per runtime, so no MLE verdict exists. LocalCoder has no application backend, remote judging API, account system, or anti-cheat guarantees.

*Author's note: Written for maintainers tracing a result from a manifest entry to its local submission record, so identity and verdict ownership stay explicit.*
