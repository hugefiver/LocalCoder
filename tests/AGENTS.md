# Tests Knowledge Base

## OVERVIEW

`tests/` holds the Node-level regression suites for LocalCoder. The project uses
Node's built-in test runner through the repository test harness, not a separate
test framework. Keep product behavior tests close to the production boundary
they exercise, and make each assertion describe an observable contract.

## STRUCTURE

Directories mirror their owning production areas: `runtime/`, `storage/`,
`oj/`, `problems/`, `services/`, `ui/`, `workers/`, and `scripts/`. Put an
integration test in `integration/` only when it crosses those boundaries.
Shared test doubles belong in `helpers/`; reusable, checked-in data belongs in
`fixtures/`. New test files must end in `.test.ts` or `.test.mjs` so the harness
can discover them.

## RUNNER RULES

The test harness first compiles the configured TypeScript test graph, then asks
the Node test runner to execute the selected files. A focused invocation still
compiles that complete graph, so it can catch cross-test type errors.

`.test-dist` is the harness's single generated output directory. It is deleted
before and after each run, so never place sources, fixtures, or evidence there.
Do not run two test invocations in the same worktree at once: concurrent runs
would both delete and recreate `.test-dist`.

## FIXTURES/HARNESSES

Use `tests/fixtures/` only for small, deterministic inputs shared by tests.
Create one-off files and directories under the operating system temporary area,
give them a unique name, and remove them in test cleanup. Don't write temporary
state into the repository, public assets, or `.test-dist`.

Node doubles cover isolated Worker, clock, runtime-adapter, and legacy-storage
contracts. Browser-facing runtime checks use `runtime-harness.html`; persistence
and migration checks use `storage-harness.html`. These harnesses expose contract
evidence, not an alternate product path or a place to decide OJ verdicts.

## BROWSER QA TRIGGERS

Node tests are insufficient after changes involving Workers or runtime assets,
IndexedDB, CodeMirror, focus management, responsive layouts, Pages base paths,
or offline-session behavior. Obtain real-browser evidence with the appropriate
harness and follow `docs/qa/localcoder-browser-acceptance.md`.

For optional runtimes, `VERIFIED` requires a current browser receipt and enables
selection. `LOADABLE_UNVERIFIED` and `UNAVAILABLE` keep the selector disabled;
the verifier's exit code `2` reports either disabled state and is not a pass.
`BROKEN` is exit code `1` and blocks acceptance.

## ANTI-PATTERNS

Don't treat a focused run as a shortcut around TypeScript compilation. Don't
invent test files outside `tests/`, duplicate fixtures inline when a stable
fixture exists, or make browser-only claims from Node output. Never call an
optional runtime supported because its assets are present, and never label an
unavailable runtime test as passed.

*Author's note: Written for a contributor adding or repairing a LocalCoder test, so they place coverage correctly and collect browser proof when Node cannot provide it.*
