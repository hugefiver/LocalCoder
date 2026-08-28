# LocalCoder Copilot Instructions

## Product boundary

LocalCoder is a static, single-user local-practice OJ. It has no accounts, backend, cloud sync, rankings, remote execution API, or trusted-contest guarantee. Browser Workers provide local execution isolation and a termination boundary. They are not a secure sandbox, and browser-shipped judge cases are inspectable rather than secret.

The main thread owns expected values, comparison, and verdict mapping. Workers return actual values or structured failures. TLE is based on local main-thread timeout and termination. Timing is not authoritative, and the product does not claim a memory limit or emit MLE.

## Runtime model

Use `LanguageId` and `RuntimeId` separately. Required runtime IDs are `javascript-worker`, `typescript-official`, and `python-pyodide`. Optional IDs are `python-rustpython`, `racket-wasm`, and `haskell-ghc-wasi`.

`public/runtime-manifest.json` is generated from packaged assets and is the only availability source. An optional runtime stays disabled until a current matching receipt proves handshake, smoke, and judge contract. RustPython also needs six-problem parity with Pyodide. Packaged assets alone do not prove support.

Every Worker protocol message includes `protocolVersion`, `requestId`, and `runtimeId`. Fail closed on malformed messages, unknown protocol versions, or identity mismatches. Preserve the runtime version and build ID returned by the exact Worker generation that completed an operation.

The Supervisor serializes session runtimes FIFO, terminates on timeout, cancellation, malformed response, Worker error, and fatal runtime failure, then rebuilds before the next operation. Late messages from an old generation are ignored.

## Storage and user flows

Persist user data through the IndexedDB repository with stores `drafts`, `customCases`, `submissions`, `progress`, `settings`, and `meta`. `localStorage` exists only as an idempotent legacy-migration input. If IndexedDB fails, retain session data in memory and visibly show `未保存`.

Run covers public and custom cases and never changes progress. Submit includes judge cases. An accepted submission and progress update must be one transaction, with language, runtime, and runtime/build identity recorded. Cap local submission history at 200 records inside the insertion transaction.

## Development and delivery

Use npm with the committed `package-lock.json`:

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run runtime:manifest
npm run runtime:check
npm run build
npm run smoke
node scripts/report-runtime-capabilities.mjs
```

Do not treat a skipped or unavailable optional runtime as a passing test. `verify-optional-runtime.mjs` exits `0` only for `VERIFIED`, `2` for `UNAVAILABLE` or `LOADABLE_UNVERIFIED`, and `1` for `BROKEN`.

GitHub Pages uses `./` asset paths, HashRouter, and a `404.html` fallback. CI runs `npm ci` against the lockfile and must not install external Rust, Racket, or Haskell toolchains.

*Author's note: Written for contributors changing LocalCoder so they preserve the runtime, storage, and trust boundaries rather than restoring legacy assumptions.*
