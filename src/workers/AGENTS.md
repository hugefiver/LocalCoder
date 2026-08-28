# Worker Implementation Notes

## STRUCTURE

- `javascript/` contains the JavaScript evaluator and the official TypeScript asset host.
- `python/` contains the Pyodide host and its JSON bridge.
- `racket/` contains the Emscripten host, bridge, and captured streams.
- `rustpython/` contains the RustPython host and request payload builder.
- `haskell/` contains GHC WASI asset loading, filesystem setup, execution, and bridge code.
- `wasi/` contains the shared WASI runner and I/O support.
- `shared/` contains the endpoint, structured runtime errors, and bounded output buffer.
- The five bundled entrypoints are `javascript.worker.ts`, `pyodide.worker.ts`,
  `racket.worker.ts`, `rustpython.worker.ts`, and `haskell.worker.ts`.
- JavaScript and official TypeScript share `javascript.worker.ts`; its first request selects
  `javascript-worker` or `typescript-official` and fixes that endpoint for the Worker lifetime.

## WHERE TO LOOK

- Start protocol work in `shared/endpoint.ts` and `src/runtime/protocol.ts`.
- Put byte-bounded stdout and stderr capture behind `shared/output-buffer.ts`.
- Keep language-specific execution and JSON conversion inside that language directory.
- Use `wasi/runner.ts` for RustPython WASI runs, and the Haskell WASI helpers for GHC execution.
- Check `scripts/lib/worker-build-plan.mjs` for entrypoint-to-output mappings.
- `scripts/build-worker-assets.mjs` computes identities and emits the generated files in `public/`.
- Relevant tests live in `tests/workers/`, `tests/runtime/browser-worker-factory.test.ts`,
  and `tests/integration/build-worker-assets.test.ts`.

## CONVENTIONS

- Implement the `WorkerRuntime` interface and expose it through `createWorkerEndpoint`.
- Accept only protocol requests for the entrypoint's runtime ID; return structured failures for
  a runtime mismatch or an operation error.
- Return actual values and structured execution failures only. Comparison and verdict ownership
  remain on the main-thread OJ.
- Give every judge case a fresh evaluator or runtime namespace. Do not retain user definitions
  between cases.
- Create a fresh virtual filesystem for each Haskell operation, including its work directory.
- Run each WASI invocation with the operation's own execution state and bounded output.
- Resolve runtime scripts, modules, and fetched assets from local same-origin URLs. Reject a
  Haskell WASI shim outside the worker's local origin and path.
- Share one `OutputBudget` across all judge-case stdout and stderr for an operation.
- Validate bridge output as canonical JSON before returning it through the endpoint.

## ANTI-PATTERNS

- Do not put expected values, pass flags, comparisons, or final verdicts in a Worker request or response.
- Do not treat a Worker as a security boundary or a source of authoritative timing.
- Do not reuse a JavaScript evaluator, Python globals, Racket source filename, Haskell filesystem,
  or WASI invocation state across independent cases.
- Do not bypass `OutputBuffer` or create separate per-stream limits when an operation needs one budget.
- Do not fetch runtime assets from a remote origin or accept an arbitrary dynamic WASI shim URL.
- Do not edit generated Worker bundles under `public/`; change source or build inputs, then use
  the scripts that construct those outputs.

## TESTS

- Add focused coverage beside the affected boundary in `tests/workers/` when changing a host,
  bridge, endpoint, output limit, or language entrypoint.
- Update `tests/integration/build-worker-assets.test.ts` when worker plans, generated outputs,
  identity inputs, or entrypoints change.
- Preserve coverage that JavaScript and TypeScript select their shared entrypoint correctly.
- Test failure envelopes, output truncation, fresh per-case state, same-origin asset rejection,
  and canonical JSON conversion when changing the corresponding behavior.
