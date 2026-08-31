# RustPython Runtime Implementation Plan

> **For agentic workers:** Use the subagent-driven-development skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and package the existing `python-rustpython` WASI runner, prove the complete five-check optional-runtime contract in a real browser, and reach `VERIFIED`; if the current RustPython dependency is genuinely incompatible, stop with a minimal pinned migration attempt and reproducible evidence instead of overstating support.

**Architecture:** Keep the existing boundary intact: `runtimes/rustpython-runner` owns the stdin/stdout JSON bridge, `src/workers/rustpython/host.ts` owns WASI asset loading and envelope normalization, and `OptionalRuntimeVerifier` remains the only authority that can move the Registry from packaged-but-disabled to verified/ready. First reproduce the locked Rust build, conditionally migrate only the runner dependency/API when the failure is inside RustPython 0.4, then stage the WASM through `scripts/build-runtimes.mjs`, validate `LOADABLE_UNVERIFIED`, and finally use the checked-in browser harness and receipt server to prove assets, handshake, smoke, judge contract, and six-problem Pyodide parity.

**Tech Stack:** PowerShell 7, Node.js 26.8.1, pnpm 12, Vite 7, TypeScript 5.9, Rust/Cargo 1.95.0, `wasm32-wasip1`, RustPython, Web Workers, WASI, Node test runner, browser runtime harness.

**Spec:** inline/chat design

**Global Constraints:**
- Work only in `C:\Users\hugefiver\source\LocalCoder`; do not install or update system software, Rust toolchains, Rust targets, Node packages, browsers, or browser drivers.
- Use PowerShell syntax only. Never use Bash `export`, inline `VAR=value command`, `&&`, `/dev/null`, or `source` syntax.
- Every invocation of `scripts/build-runtimes.mjs` must set `$env:RUNTIME_TARGETS = "rustpython"` and remove `Env:RUNTIME_TARGETS` in `finally`; never allow the filter to leak into a later command.
- Do not run `git commit`, `git push`, `git tag`, `git add`, `git restore`, or any other Git write command. End each task at a review boundary instead of a commit boundary.
- Do not add a language, change the Worker protocol, move expected values or verdicts into a Worker, or weaken `OptionalRuntimeVerifier`, receipt validation, output bounds, identity checks, judge comparison, or six-problem parity.
- Do not assume `rustpython-vm` 0.4 compiles on rustc 1.95.0. The locked build is the RED/feasibility gate; dependency/API changes are allowed only after that gate fails with evidence.
- `UNAVAILABLE` and `LOADABLE_UNVERIFIED` are disabled states, not success. Only a current browser receipt with checks in the exact order `assets`, `handshake`, `smoke`, `judge-contract`, `pyodide-corpus-parity` may support a `VERIFIED` claim.
- Browser evidence must be machine-validated by `scripts/verify-optional-runtime.mjs` and `scripts/runtime-verification-server.mjs`. A human statement that the page “looks normal” is never acceptance evidence.
- `public/rustpython/runner.wasm`, `public/rustpython/runner.wasm.gz.bin`, and Cargo `target/` output are generated artifacts. The `.bin` suffix prevents static servers from applying HTTP `Content-Encoding` to an already gzip-compressed artifact. Inspect their hashes and Git status, but do not stage or blindly preserve them as release inputs.
- Do not patch generated Worker/WASM/manifest output as the source fix. Regenerate it from the runner, Worker sources, runtime catalog, and build scripts.
- Never run two `pnpm test` commands concurrently because both own `.test-dist`.

---

## File Map

### Source files that may change only on the proven compatibility branch

- `runtimes/rustpython-runner/Cargo.toml` — owns the pinned RustPython dependency and feature selection; change only after the locked 0.4 build fails inside RustPython.
- `runtimes/rustpython-runner/Cargo.lock` — records the exact resolved Rust dependency graph; change only as the consequence of the approved pinned dependency migration.
- `runtimes/rustpython-runner/src/main.rs` — owns request parsing, frozen-stdlib interpreter startup, and the single JSON response envelope; change only for the matching RustPython API migration or a browser-reproduced runner defect.
- `src/workers/rustpython/host.ts` — owns gzip/raw asset loading, WASI invocation, exact bridge parsing, and failure normalization; change only if the real browser failure is demonstrably in this boundary.
- `tests/workers/rustpython-host.test.ts` — nearest regression suite for host-side bridge/asset/error behavior.
- `tests/runtime/rustpython-parity.test.ts` — owns the exact six-problem/eighteen-case corpus and mismatch classification assertions.

### Existing files to execute and inspect, not weaken

- `scripts/build-runtimes.mjs` — builds `wasm32-wasip1` first, copies/gzips the runner, rebuilds Workers, and regenerates the manifest.
- `src/runtime/optional-verification.ts` — requires assets, identity-matched handshake/smoke/judge, and exact six-problem Pyodide parity before `session.complete()`.
- `scripts/verify-optional-runtime.mjs` — reports exit `2` for `UNAVAILABLE`/`LOADABLE_UNVERIFIED` and exit `0` only after the browser receipt.
- `scripts/runtime-verification-server.mjs` — validates receipt origin, manifest digest, ordered checks, and every declared asset digest, then writes the receipt atomically.
- `src/harness/runtime-contract-harness.ts` and `runtime-harness.html` — run the real optional verifier in a browser and POST the receipt.
- `scripts/report-runtime-capabilities.mjs` — independently revalidates the current receipt and classifies `python-rustpython`.
- `scripts/lib/runtime-catalog.mjs` and `scripts/generate-runtime-manifest.mjs` — derive packaging from `rustpython-worker.js` plus at least one non-empty runner WASM variant.

### Generated and evidence files

- `public/rustpython/runner.wasm` — generated raw WASI module; ignored by Git.
- `public/rustpython/runner.wasm.gz.bin` — generated gzip bytes under an HTTP-stable suffix; ignored by Git.
- `public/rustpython-worker.js` — regenerated Worker with an artifact-derived build ID.
- `public/runtime-manifest.json` — regenerated packaging truth; expected to change from `packaged: false` to `packaged: true` only when the runner asset is present.
- `artifacts/runtime-verification/python-rustpython.json` — current machine-validated browser receipt.
- `artifacts/qa/rustpython-runtime/` — command transcripts, hashes, capability output, and compatibility-blocker evidence.

## Outcome Gates

- **Success branch:** Tasks 1, 3, 4, 5, and 6 pass; Task 2 is either skipped because RustPython 0.4 builds or passes via the pinned 0.5.0 migration. The final capability report says `verified` for `python-rustpython`.
- **Compatibility-blocked branch:** Task 1 proves a RustPython-owned compile failure, Task 2 performs the one bounded pinned migration and still cannot produce a `wasm32-wasip1` module, and Task 6 records the exact command, first actionable diagnostic, dependency graph, changed-file diff, and remaining smallest repair path. Tasks 3–5 are marked blocked, assets remain absent, and the runtime remains truthfully `UNAVAILABLE`.
- **Environment-blocked branch:** Missing tools/target, registry/network failure, port conflict, or absent browser launch capability is not RustPython compatibility evidence. Record it separately and do not claim either `VERIFIED` or a compatibility conclusion.

### Task 1: Record the baseline and reproduce the locked RustPython build

**Files:**
- Inspect: `package.json`
- Inspect: `scripts/build-runtimes.mjs`
- Inspect: `runtimes/rustpython-runner/Cargo.toml`
- Inspect: `runtimes/rustpython-runner/Cargo.lock`
- Inspect: `runtimes/rustpython-runner/src/main.rs`
- Inspect: `public/runtime-manifest.json`
- Create: `artifacts/qa/rustpython-runtime/environment.txt`
- Create: `artifacts/qa/rustpython-runtime/baseline-verifier.log`
- Create: `artifacts/qa/rustpython-runtime/cargo-build-0.4.log`

**Interfaces:**
- Consumes: current clean worktree; Node 26.8.1; pnpm 12; cargo/rustc 1.95.0; installed `wasm32-wasip1`; manifest entry `python-rustpython`.
- Produces: an objective build exit code and one of `buildable-0.4`, `rustpython-owned-failure`, or `environment-failure`, plus the baseline `UNAVAILABLE` evidence.

**Recommended executor:** `complex`

- [ ] **Step 1: Assert the worktree and toolchain baseline before creating build output**

Run each command from the repository root:

```powershell
$baselineStatus = @(git status --short)
$baselineStatus
$unexpectedBaseline = @($baselineStatus | Where-Object {
  $_ -notmatch '^\?\? (?:docs/superpowers/plans/2026-08-28-rustpython-runtime\.md|(?:.+/)?AGENTS\.md)$'
})
if ($unexpectedBaseline.Count -ne 0) {
  throw "Unexpected pre-existing worktree changes: $($unexpectedBaseline -join '; ')"
}
node --version
pnpm --version
cargo --version
rustc --version
rustup --version
rustup target list --installed
```

Expected: Git reports no product/source change; the just-written plan and environment-provided hierarchical `AGENTS.md` files are the only allowed untracked baseline entries. Node prints `v26.8.1`; pnpm prints `12.0.0`; cargo/rustc print `1.95.0`; rustup prints `1.29.0`; and the target list contains `wasm32-wasip1`. If any other path is dirty, stop rather than overwriting user work. If a tool or target is absent, record an environment blocker and do not install it.

- [ ] **Step 2: Create the bounded evidence directory and capture labeled version evidence**

```powershell
New-Item -ItemType Directory -Path "artifacts/qa/rustpython-runtime" -Force | Out-Null
@(
  "node=$(& node --version)"
  "pnpm=$(& pnpm --version)"
  "cargo=$(& cargo --version)"
  "rustc=$(& rustc --version)"
  "rustup=$(& rustup --version)"
  "targets=$((& rustup target list --installed) -join ',')"
) | Tee-Object -FilePath "artifacts/qa/rustpython-runtime/environment.txt"
```

Expected: the file contains the versions from Step 1 and `targets=wasm32-wasip1` (additional already-installed targets are allowed).

- [ ] **Step 3: Lock the truthful pre-build state as a failing optional-runtime check**

```powershell
$baselineOutput = & node scripts/verify-optional-runtime.mjs python-rustpython 2>&1
$baselineExit = $LASTEXITCODE
$baselineOutput | Tee-Object -FilePath "artifacts/qa/rustpython-runtime/baseline-verifier.log"
if ($baselineExit -ne 2) { throw "Expected baseline verifier exit 2, received $baselineExit" }
if (($baselineOutput -join "`n") -notmatch '"status":"UNAVAILABLE"') { throw "Expected baseline UNAVAILABLE status" }
if (($baselineOutput -join "`n") -notmatch 'rustpython/runner\.wasm') { throw "Expected the concrete missing runner.wasm reason" }
```

Expected: exit `2`, JSON status `UNAVAILABLE`, and a reason naming the missing `rustpython/runner.wasm.gz.bin` or `rustpython/runner.wasm`. This is RED evidence, not a pass.

- [ ] **Step 4: Run the locked RustPython 0.4 build directly so the wrapper cannot hide the compiler exit**

```powershell
cargo build --manifest-path "runtimes/rustpython-runner/Cargo.toml" --release --target wasm32-wasip1 --locked 2>&1 | Tee-Object -FilePath "artifacts/qa/rustpython-runtime/cargo-build-0.4.log"
$cargo04Exit = $LASTEXITCODE
```

Expected branch:

- Exit `0`: classify `buildable-0.4`, verify that `runtimes/rustpython-runner/target/wasm32-wasip1/release/rustpython_runner.wasm` is non-empty, skip Task 2, and continue to Task 3.
- Nonzero with the first actionable error under a Cargo registry RustPython crate (for example `rustpython-vm-0.4.0`): classify `rustpython-owned-failure` and continue to Task 2.
- Nonzero because the target/tool is missing, crates cannot be fetched, disk access fails, or the failure is outside RustPython/this runner: classify `environment-failure`, retain the transcript, and stop without editing dependencies.

- [ ] **Step 5: Record the review boundary without changing source**

```powershell
git status --short
git diff --check
```

Expected: no new source diff beyond the plan/baseline instruction files. Cargo build output may appear as generated/untracked output depending on local ignore configuration; it must not be staged. `git diff --check` exits `0`.

### Task 2: Apply one evidence-gated RustPython compatibility migration

**Files:**
- Modify only on `rustpython-owned-failure`: `runtimes/rustpython-runner/Cargo.toml`
- Modify only on `rustpython-owned-failure`: `runtimes/rustpython-runner/Cargo.lock`
- Modify only on `rustpython-owned-failure`: `runtimes/rustpython-runner/src/main.rs`
- Create: `artifacts/qa/rustpython-runtime/cargo-tree-0.4.txt`
- Create: `artifacts/qa/rustpython-runtime/cargo-build-0.5.log`
- Create only if still blocked: `artifacts/qa/rustpython-runtime/compatibility-blocker.md`

**Interfaces:**
- Consumes: Task 1 classification `rustpython-owned-failure`; existing request shape `{ mode, source, input? }`; existing bridge success/failure envelope; rustc 1.95.0.
- Produces: either a locked non-empty `rustpython_runner.wasm` built from exactly RustPython 0.5.0, or a bounded blocker package that proves why no verified runtime can be claimed.

**Recommended executor:** `complex`

- [ ] **Step 1: Skip this task unless the locked 0.4 build failed inside RustPython**

Do not edit any file if Task 1 exited `0`. Do not treat a missing target, network error, filesystem error, or unrelated crate failure as authorization to migrate RustPython.

- [ ] **Step 2: Capture the locked dependency graph before editing**

```powershell
cargo tree --manifest-path "runtimes/rustpython-runner/Cargo.toml" --target wasm32-wasip1 --locked 2>&1 | Tee-Object -FilePath "artifacts/qa/rustpython-runtime/cargo-tree-0.4.txt"
if ($LASTEXITCODE -ne 0) { throw "Unable to record the locked RustPython 0.4 dependency graph" }
```

Expected: the tree contains `rustpython-vm v0.4.0`. Preserve Task 1’s compiler transcript beside it. RustPython issue `https://github.com/RustPython/RustPython/issues/7236` is supporting context for the known crates.io 0.4 WASIp1 failure, not a substitute for the local transcript.

- [ ] **Step 3: Replace only the direct RustPython dependency with the pinned frozen-stdlib 0.5.0 facade**

Replace the current `rustpython-vm` dependency in `runtimes/rustpython-runner/Cargo.toml` with exactly:

```toml
rustpython = { version = "=0.5.0", default-features = false, features = ["freeze-stdlib", "stdio"] }
```

Keep `serde` and `serde_json` unchanged. The top-level facade is required because RustPython 0.5 initializes native and frozen standard-library modules through `InterpreterBuilderExt::init_stdlib`; adding unrelated features such as SSL, threading, host environment access, or a Git dependency is outside scope.

- [ ] **Step 4: Adapt only interpreter construction and source execution to the 0.5.0 API**

Add this import to `runtimes/rustpython-runner/src/main.rs`:

```rust
use rustpython::{InterpreterBuilder, InterpreterBuilderExt};
```

Replace the existing `rustpython_vm::Interpreter::default()` block with exactly:

```rust
let interpreter = InterpreterBuilder::new().init_stdlib().interpreter();
interpreter.run(|vm| {
    let scope = vm.new_scope_with_builtins();
    if let Err(error) = vm.run_string(scope, &program, "<localcoder-runner>".to_owned()) {
        let mut details = String::new();
        vm.write_exception(&mut details, &error)
            .expect("formatting into String cannot fail");
        failure("python-runtime-error", details);
    }
});
```

Do not change `Mode`, `Request`, `bridge_program`, base64 transport, error kinds, JSON keys, `allow_nan=False`, stdout/stderr capture, or the one-request/one-response process contract.

- [ ] **Step 5: Run the unlocked build once to resolve the pinned dependency and verify the migration goes GREEN**

```powershell
cargo build --manifest-path "runtimes/rustpython-runner/Cargo.toml" --release --target wasm32-wasip1 2>&1 | Tee-Object -FilePath "artifacts/qa/rustpython-runtime/cargo-build-0.5.log"
$cargo05Exit = $LASTEXITCODE
```

Expected success: exit `0`, `Cargo.lock` resolves `rustpython`/`rustpython-vm` exactly `0.5.0`, and `runtimes/rustpython-runner/target/wasm32-wasip1/release/rustpython_runner.wasm` exists and is non-empty.

Failure branches:

- Registry/network fetch failure is an environment blocker; do not call it compatibility proof.
- A compile error still inside pinned RustPython 0.5.0 or its required transitive graph is a genuine compatibility blocker for this bounded attempt. Do not patch Cargo registry sources, add `[patch.crates-io]`, move to an unpinned Git revision, downgrade rustc, or install a different target.
- A compile error in the exact new `main.rs` block may be corrected only to match the compiler-reported 0.5.0 signature while preserving all bridge semantics; rerun this same build once. A second owned-API failure ends the bounded attempt.

- [ ] **Step 6: Prove the resolved graph is locked and the generated module is reproducible**

Run only after the unlocked migration build succeeds:

```powershell
cargo build --manifest-path "runtimes/rustpython-runner/Cargo.toml" --release --target wasm32-wasip1 --locked
if ($LASTEXITCODE -ne 0) { throw "Pinned RustPython build is not reproducible with --locked" }
cargo tree --manifest-path "runtimes/rustpython-runner/Cargo.toml" --target wasm32-wasip1 --locked -p rustpython-runner
Get-Item -LiteralPath "runtimes/rustpython-runner/target/wasm32-wasip1/release/rustpython_runner.wasm" | Select-Object FullName, Length
Get-FileHash -Algorithm SHA256 -LiteralPath "runtimes/rustpython-runner/target/wasm32-wasip1/release/rustpython_runner.wasm"
```

Expected: both commands exit `0`; the tree contains only the pinned RustPython `0.5.0` family for this direct dependency; the WASM length is greater than zero; and SHA-256 is printed.

- [ ] **Step 7: If still blocked, write the bounded blocker record and stop before packaging**

Create `artifacts/qa/rustpython-runtime/compatibility-blocker.md` with these concrete sections filled from the captured evidence: `Environment` (exact versions), `Failing command`, `First actionable diagnostic` (crate, version, source path, error code/message), `0.5.0 migration attempted` (yes/no and why), `Changed files`, `Runtime state` (`UNAVAILABLE`), and `Smallest next repair` (the single owning upstream crate/API and the next command that would validate it). Link the 0.4 and 0.5 logs and the dependency tree. Do not create fake/public runner assets, do not regenerate a packaged manifest, and proceed only to Task 6’s blocker review steps.

- [ ] **Step 8: Inspect the compatibility diff before packaging**

```powershell
cargo fmt --manifest-path "runtimes/rustpython-runner/Cargo.toml" -- --check
git diff --check
git diff -- "runtimes/rustpython-runner/Cargo.toml" "runtimes/rustpython-runner/Cargo.lock" "runtimes/rustpython-runner/src/main.rs"
```

Expected: formatting and whitespace checks exit `0`; the diff contains only the pinned dependency/lock migration and interpreter construction/API adaptation described above.

### Task 3: Stage assets and prove `LOADABLE_UNVERIFIED`

**Files:**
- Modify: `.gitignore` — ignore the HTTP-stable gzip artifact `public/rustpython/runner.wasm.gz.bin`.
- Modify: `runtimes/rustpython-runner/Cargo.toml` — enable the independent RustPython `stdio` feature required by the JSON envelope `print`.
- Modify: `runtimes/rustpython-runner/src/main.rs` — format embedded Python failures with `vm.write_exception` instead of the intentionally opaque `Debug` implementation.
- Modify: `scripts/build-runtimes.mjs` — emit gzip bytes as `runner.wasm.gz.bin`.
- Modify: `scripts/lib/runtime-catalog.mjs` — declare `runner.wasm.gz.bin` before raw WASM in the one-of group.
- Modify: `scripts/lib/worker-build-identity.mjs` — hash `runner.wasm.gz.bin` as the compressed RustPython identity input.
- Modify: `src/workers/rustpython/host.ts` — fetch and explicitly decompress `runner.wasm.gz.bin`.
- Modify: `tests/workers/rustpython-host.test.ts` — lock `stdio`, diagnostic formatting, and gzip-bin/raw fallback.
- Modify: `tests/scripts/runtime-manifest-generation.test.mjs` — lock the gzip-bin manifest URL and byte size.
- Modify: `tests/integration/build-worker-assets.test.ts` — lock gzip-bin identity invalidation.
- Modify: `README.md`, `docs/operations/runtime-assets.md`, `public/rustpython/README.md` — document the current compressed asset name and why `.bin` is intentional.
- Execute: `scripts/build-runtimes.mjs`
- Generate: `public/rustpython/runner.wasm`
- Generate: `public/rustpython/runner.wasm.gz.bin`
- Generate/replace: `public/rustpython-worker.js`
- Generate/replace: `public/runtime-manifest.json`
- Create: `artifacts/qa/rustpython-runtime/build-runtimes.log`
- Create: `artifacts/qa/rustpython-runtime/loadable-verifier.log`
- Create: `artifacts/qa/rustpython-runtime/loadable-capabilities.log`

**Interfaces:**
- Consumes: a successful locked `wasm32-wasip1` build from Task 1 or Task 2; `buildWorkerAssets({ root })`; `writeRuntimeManifest({ root })`; runtime catalog one-of asset group.
- Produces: non-empty raw/gzip runner assets and a manifest entry with `packaged: true`, execute/judge capabilities enabled, but no `VERIFIED` claim before the browser receipt.

**Recommended executor:** `coding`

- [ ] **Correction Step A: Write RED regressions for the two real-browser failures**

In `tests/workers/rustpython-host.test.ts`, update gzip fetch expectations to `rustpython/runner.wasm.gz.bin` and extend the existing runner-source inspection to require both `features = ["freeze-stdlib", "stdio"]` in `Cargo.toml` and `vm.write_exception` in `main.rs`. Update the manifest-generation and worker-identity fixtures to use `runner.wasm.gz.bin`.

Run:

```powershell
pnpm test tests/workers/rustpython-host.test.ts tests/scripts/runtime-manifest-generation.test.mjs tests/integration/build-worker-assets.test.ts
```

Expected: FAIL before production changes because the loader/catalog/build/identity paths still use `.wasm.gz`, the runner lacks `stdio`, and its error path still formats `PyBaseException` with opaque `Debug`.

- [ ] **Correction Step B: Implement the minimum runtime and asset-contract fix**

Apply exactly these contract changes:

```toml
rustpython = { version = "=0.5.0", default-features = false, features = ["freeze-stdlib", "stdio"] }
```

```rust
if let Err(error) = vm.run_string(scope, &program, "<localcoder-runner>".to_owned()) {
    let mut details = String::new();
    vm.write_exception(&mut details, &error)
        .expect("formatting into String cannot fail");
    failure("python-runtime-error", details);
}
```

Use `rustpython/runner.wasm.gz.bin` consistently in the build output, catalog, Worker identity, loader, tests, and current docs. Replace the old `.gitignore` entry rather than keeping both generated names as supported inputs. The raw `runner.wasm` fallback remains unchanged.

- [ ] **Correction Step C: Run the correction tests GREEN and rebuild the locked runner**

```powershell
pnpm test tests/workers/rustpython-host.test.ts tests/scripts/runtime-manifest-generation.test.mjs tests/integration/build-worker-assets.test.ts
if ($LASTEXITCODE -ne 0) { throw "RustPython browser-correction tests failed" }
cargo fmt --manifest-path "runtimes/rustpython-runner/Cargo.toml" -- --check
cargo build --manifest-path "runtimes/rustpython-runner/Cargo.toml" --release --target wasm32-wasip1 --locked
if ($LASTEXITCODE -ne 0) { throw "stdio-enabled locked runner build failed" }
```

Expected: all selected tests pass; the locked WASIp1 runner rebuild succeeds. Then continue with the existing packaging Step 1 and regenerate every Worker/manifest/receipt input because both source and asset URLs changed.

- [ ] **Step 1: Run the repository packaging path with a scoped PowerShell environment variable**

```powershell
$env:RUNTIME_TARGETS = "rustpython"
try {
  pnpm run build:runtimes 2>&1 | Tee-Object -FilePath "artifacts/qa/rustpython-runtime/build-runtimes.log"
  $runtimeBuildExit = $LASTEXITCODE
} finally {
  Remove-Item Env:RUNTIME_TARGETS -ErrorAction SilentlyContinue
}
if (Test-Path Env:RUNTIME_TARGETS) { throw "RUNTIME_TARGETS leaked after runtime build" }
if ($runtimeBuildExit -ne 0) { throw "build:runtimes exited $runtimeBuildExit" }
```

Expected: output contains `Building RustPython runtime...` and `✓ public/rustpython/runner.wasm(.gz)`. A top-level exit `0` without that checkmark is not success because `build-runtimes.mjs` catches optional runtime failures; the next step must reject missing assets.

- [ ] **Step 2: Assert both generated assets are non-empty and record their hashes**

```powershell
$runnerAssets = Get-Item -LiteralPath @(
  "public/rustpython/runner.wasm",
  "public/rustpython/runner.wasm.gz.bin"
)
if ($runnerAssets.Count -ne 2 -or ($runnerAssets | Where-Object Length -LE 0).Count -ne 0) {
  throw "RustPython raw/gzip assets are missing or empty"
}
$runnerAssets | Select-Object FullName, Length
Get-FileHash -Algorithm SHA256 -LiteralPath @(
  "public/rustpython/runner.wasm",
  "public/rustpython/runner.wasm.gz.bin"
) | Format-Table -AutoSize
```

Expected: two files, both non-empty, with distinct paths and recorded SHA-256 digests.

- [ ] **Step 3: Assert the generated manifest truth directly**

```powershell
node --input-type=module -e 'import fs from "node:fs"; const manifest=JSON.parse(fs.readFileSync("public/runtime-manifest.json","utf8")); const runtime=manifest.runtimes.find((entry)=>entry.runtimeId==="python-rustpython"); if(!runtime) throw new Error("missing python-rustpython"); const urls=runtime.assets.map((asset)=>asset.url); if(runtime.packaged!==true||runtime.capabilities?.execute!==true||runtime.capabilities?.judge!==true||!urls.includes("rustpython-worker.js")||!urls.includes("rustpython/runner.wasm")||!urls.includes("rustpython/runner.wasm.gz.bin")) throw new Error(JSON.stringify(runtime)); console.log(JSON.stringify(runtime,null,2));'
if ($LASTEXITCODE -ne 0) { throw "Generated RustPython manifest entry is not packaged correctly" }
```

Expected: `packaged: true`, execute/judge both `true`, no `unavailableReason`, and assets include the Worker plus raw/gzip runner variants with nonzero byte counts.

- [ ] **Step 4: Run manifest/readiness package scripts**

```powershell
pnpm run runtime:manifest
if ($LASTEXITCODE -ne 0) { throw "runtime:manifest failed" }
pnpm run runtime:check
if ($LASTEXITCODE -ne 0) { throw "runtime:check failed" }
```

Expected: manifest generation succeeds; runtime check prints `PACKAGED python-rustpython`; required runtimes remain packaged; no optional runtime is `BROKEN`.

- [ ] **Step 5: Prove that packaged assets alone remain `LOADABLE_UNVERIFIED`**

```powershell
$loadableOutput = & node scripts/verify-optional-runtime.mjs python-rustpython 2>&1
$loadableExit = $LASTEXITCODE
$loadableOutput | Tee-Object -FilePath "artifacts/qa/rustpython-runtime/loadable-verifier.log"
if ($loadableExit -ne 2) { throw "Expected LOADABLE_UNVERIFIED exit 2, received $loadableExit" }
if (($loadableOutput -join "`n") -notmatch '"status":"LOADABLE_UNVERIFIED"') { throw "Packaged runtime was not classified LOADABLE_UNVERIFIED" }
```

Expected: exit `2` and status `LOADABLE_UNVERIFIED`. Do not mark this step as runtime support.

- [ ] **Step 6: Prove the capability report is loadable but not verified before receipt**

```powershell
pnpm run runtime:report 2>&1 | Tee-Object -FilePath "artifacts/qa/rustpython-runtime/loadable-capabilities.log"
$loadableReportExit = $LASTEXITCODE
if ($loadableReportExit -ne 0) { throw "Capability report found a blocker before browser verification" }
if ((Get-Content -LiteralPath "artifacts/qa/rustpython-runtime/loadable-capabilities.log" -Raw) -notmatch '"runtimeId": "python-rustpython"[\s\S]*?"state": "loadable-unverified"') {
  throw "Capability report did not preserve loadable-unverified"
}
```

Expected: report readiness remains true because a disabled optional is not a release blocker, but `python-rustpython` is exactly `loadable-unverified` and absent from `verifiedOptionalRuntimeIds`.

- [ ] **Step 7: End at a generated-output review boundary**

```powershell
git check-ignore -v "public/rustpython/runner.wasm" "public/rustpython/runner.wasm.gz.bin"
git status --short
git diff --check
git diff --stat
```

Expected: both WASM paths are ignored; tracked generated Worker/manifest changes are visible if their bytes changed; whitespace check passes. Do not stage any output.

### Task 4: Run targeted regressions and the complete quality/build gates

**Files:**
- Test: `tests/workers/rustpython-host.test.ts`
- Test: `tests/runtime/rustpython-parity.test.ts`
- Test: `tests/runtime/optional-verification.test.ts`
- Test: `tests/services/app-services.test.ts`
- Test: `tests/scripts/runtime-manifest-generation.test.mjs`
- Test: `tests/scripts/runtime-capabilities.test.mjs`
- Test: `tests/scripts/runtime-verification-server.test.mjs`
- Test: `tests/integration/build-worker-assets.test.ts`
- Test: `tests/runtime/generated-manifest.test.ts`
- Test: `tests/scripts/smoke-check.test.mjs`
- Create: `artifacts/qa/rustpython-runtime/targeted-tests.log`
- Create: `artifacts/qa/rustpython-runtime/typecheck.log`
- Create: `artifacts/qa/rustpython-runtime/lint.log`
- Create: `artifacts/qa/rustpython-runtime/full-test.log`
- Create: `artifacts/qa/rustpython-runtime/build.log`
- Create: `artifacts/qa/rustpython-runtime/smoke.log`

**Interfaces:**
- Consumes: Task 3 packaged assets and current source/manifest; exact `verifyPythonParity` corpus; Worker identity generation; receipt validation tests.
- Produces: passing focused and full suites, a deployable build whose smoke report still truthfully labels the packaged optional runtime `loadable-unverified`, and no regression in required runtimes.

**Recommended executor:** `coding`

- [ ] **Step 1: Run Rust formatting and the locked target build**

```powershell
cargo fmt --manifest-path "runtimes/rustpython-runner/Cargo.toml" -- --check
if ($LASTEXITCODE -ne 0) { throw "cargo fmt --check failed" }
cargo build --manifest-path "runtimes/rustpython-runner/Cargo.toml" --release --target wasm32-wasip1 --locked
if ($LASTEXITCODE -ne 0) { throw "locked RustPython target build regressed" }
```

Expected: both exit `0`. Do not install clippy/rustfmt if unavailable; rustfmt absence is an environment blocker to record, not permission to install.

- [ ] **Step 2: Run all RustPython/runtime targeted tests in one serial test invocation**

```powershell
pnpm test tests/workers/rustpython-host.test.ts tests/runtime/rustpython-parity.test.ts tests/runtime/optional-verification.test.ts tests/services/app-services.test.ts tests/scripts/runtime-manifest-generation.test.mjs tests/scripts/runtime-capabilities.test.mjs tests/scripts/runtime-verification-server.test.mjs tests/integration/build-worker-assets.test.ts tests/runtime/generated-manifest.test.ts tests/scripts/smoke-check.test.mjs 2>&1 | Tee-Object -FilePath "artifacts/qa/rustpython-runtime/targeted-tests.log"
if ($LASTEXITCODE -ne 0) { throw "Targeted RustPython/runtime tests failed" }
```

Expected: all selected tests pass. Evidence must include the exact six problems `[1,2,3,4,5,6]`, eighteen corpus cases, zero fake-adapter mismatches, seven RustPython judge calls in optional verification (one contract plus six parity calls), raw/gzip fallback, and rejection of receipts missing `pyodide-corpus-parity`.

- [ ] **Step 3: If the browser or target build later exposes a host/bridge defect, add the nearest RED regression before editing**

Use `tests/workers/rustpython-host.test.ts` for gzip/raw loading, WASI exit/truncation, envelope keys/types, or failure mapping. Use `tests/runtime/rustpython-parity.test.ts` only for corpus/mismatch policy. Keep actual Rust interpreter semantics in the real target build/browser gate; do not fake a passing real-runtime result in Node tests. Run the selected test file and capture the expected failure before modifying `src/workers/rustpython/host.ts` or `main.rs`, then rerun the same file to GREEN and restart from Task 3 because Worker/asset identity may have changed.

- [ ] **Step 4: Run full typecheck and lint separately**

```powershell
pnpm run typecheck 2>&1 | Tee-Object -FilePath "artifacts/qa/rustpython-runtime/typecheck.log"
if ($LASTEXITCODE -ne 0) { throw "typecheck failed" }
pnpm run lint 2>&1 | Tee-Object -FilePath "artifacts/qa/rustpython-runtime/lint.log"
if ($LASTEXITCODE -ne 0) { throw "lint failed" }
```

Expected: both exit `0`; lint reports zero warnings.

- [ ] **Step 5: Run the complete test suite by itself**

```powershell
pnpm test 2>&1 | Tee-Object -FilePath "artifacts/qa/rustpython-runtime/full-test.log"
if ($LASTEXITCODE -ne 0) { throw "full test suite failed" }
```

Expected: exit `0`, all discovered `.test.ts`/`.test.mjs` files pass, and `.test-dist` is cleaned by `scripts/run-tests.mjs`.

- [ ] **Step 6: Run the full app build and smoke check separately**

```powershell
pnpm run build 2>&1 | Tee-Object -FilePath "artifacts/qa/rustpython-runtime/build.log"
if ($LASTEXITCODE -ne 0) { throw "full build failed" }
pnpm run smoke 2>&1 | Tee-Object -FilePath "artifacts/qa/rustpython-runtime/smoke.log"
if ($LASTEXITCODE -ne 0) { throw "smoke check failed" }
```

Expected: both exit `0`; required runtime checks have no skips; `dist/runtime-manifest.json` declares and contains RustPython assets; smoke may report the optional runtime as `loadable-unverified` because smoke does not consume a browser receipt.

- [ ] **Step 7: Recheck current public assets after all generators have run**

```powershell
pnpm run runtime:check
if ($LASTEXITCODE -ne 0) { throw "runtime:check failed after full build" }
node scripts/verify-optional-runtime.mjs python-rustpython
if ($LASTEXITCODE -ne 2) { throw "Expected pre-browser verifier exit 2 after full build" }
```

Expected: assets are packaged and not broken; the second command remains `LOADABLE_UNVERIFIED` with exit `2`. This locks the exact public manifest/assets that Task 5’s receipt must bind.

### Task 5: Produce the real-browser five-check receipt and reach `VERIFIED`

**Files:**
- Execute: `runtime-harness.html`
- Execute: `src/harness/runtime-contract-harness.ts`
- Execute: `scripts/verify-optional-runtime.mjs`
- Execute: `scripts/runtime-verification-server.mjs`
- Create: `artifacts/runtime-verification/python-rustpython.json`
- Create: `artifacts/qa/rustpython-runtime/dev-server.log`
- Create: `artifacts/qa/rustpython-runtime/browser-verifier.log`
- Create when browser automation supports it: `artifacts/qa/rustpython-runtime/browser-harness.png`

**Interfaces:**
- Consumes: Task 4’s final public manifest and assets; `OptionalRuntimeVerifier.verify("python-rustpython")`; Pyodide and RustPython adapters; six real corpus problems/eighteen cases; loopback origin `http://127.0.0.1:5173`.
- Produces: exit `0` JSON status `VERIFIED`, an atomic receipt whose checks and asset digests match the current tree, and a browser-proven Registry transition to ready.

**Recommended executor:** `frontend`

- [ ] **Step 1: Start the Vite server on the verifier’s exact allowed origin**

In dedicated PowerShell terminal A:

```powershell
pnpm run dev -- --host 127.0.0.1 --port 5173 --strictPort 2>&1 | Tee-Object -FilePath "artifacts/qa/rustpython-runtime/dev-server.log"
```

Expected: Vite serves `http://127.0.0.1:5173/` without choosing another port. A port conflict must be resolved before continuing because the receipt server allows this exact origin.

- [ ] **Step 2: Start the bounded receipt verifier and keep it waiting**

In dedicated PowerShell terminal B:

```powershell
node scripts/verify-optional-runtime.mjs python-rustpython --browser --port 4181 2>&1 | Tee-Object -FilePath "artifacts/qa/rustpython-runtime/browser-verifier.log"
$browserVerifierExit = $LASTEXITCODE
if ($browserVerifierExit -ne 0) { throw "Browser verifier exited $browserVerifierExit" }
```

Expected before browser navigation: terminal B prints exactly this URL and waits for at most 120 seconds:

```text
http://127.0.0.1:5173/runtime-harness.html?runtimeId=python-rustpython&receiptPort=4181&suite=optional-v1
```

- [ ] **Step 3: Open the exact harness URL in a real browser**

Preferred branch when a configured browser automation/MCP tool is available: navigate that browser to the printed URL, wait for the `/receipt` POST to return `204`, assert no uncaught page/Worker error, and capture the page plus network result as `artifacts/qa/rustpython-runtime/browser-harness.png` and tool evidence.

Fallback branch when no browser automation tool is available: in PowerShell terminal C, launch the checked-in self-running harness in the system browser:

```powershell
Start-Process "http://127.0.0.1:5173/runtime-harness.html?runtimeId=python-rustpython&receiptPort=4181&suite=optional-v1"
```

The fallback is accepted only if terminal B subsequently exits `0` and the receipt passes the next two machine checks. Do not use visual inspection or a manually typed “pass” as evidence. If no real browser can be launched, retain `LOADABLE_UNVERIFIED` and record a browser-environment blocker.

- [ ] **Step 4: Require the verifier’s authoritative result**

Expected in terminal B after browser execution:

```text
{"status":"VERIFIED","runtimeId":"python-rustpython","artifact":"artifacts\\runtime-verification\\python-rustpython.json"}
```

The path separator may be `/` or `\`, but status/runtime ID/exit code must match. Exit `1`, timeout, `BROKEN`, or a rejected receipt returns to the owning failure:

- asset/fetch/decompression/nonzero-WASI/envelope failure → `src/workers/rustpython/host.ts` or `main.rs`, with the RED regression rule in Task 4;
- Rust compile/stdlib/API failure → Task 2;
- parity mismatch → preserve the exact problem/case/reason, do not weaken `verifyPythonParity`, and treat an unsupported RustPython semantic as a compatibility blocker;
- manifest/asset digest mismatch → rerun Tasks 3–4, then issue a fresh receipt.

- [ ] **Step 5: Assert receipt structure, ordered checks, and current asset coverage directly**

```powershell
node --input-type=module -e 'import fs from "node:fs"; const receipt=JSON.parse(fs.readFileSync("artifacts/runtime-verification/python-rustpython.json","utf8")); const expected=["assets","handshake","smoke","judge-contract","pyodide-corpus-parity"]; if(receipt.suite!=="optional-v1"||receipt.runtimeId!=="python-rustpython"||receipt.verification?.state!=="verified"||JSON.stringify(receipt.verification.checks)!==JSON.stringify(expected)) throw new Error(JSON.stringify(receipt)); const urls=receipt.assets.map((asset)=>asset.url); for(const url of ["rustpython-worker.js","rustpython/runner.wasm","rustpython/runner.wasm.gz.bin"]){if(!urls.includes(url)) throw new Error(`receipt missing ${url}`)} console.log(JSON.stringify(receipt,null,2));'
if ($LASTEXITCODE -ne 0) { throw "RustPython receipt is incomplete" }
```

Expected: verification state `verified`; exact five checks in order; Worker, raw WASM, and gzip WASM all digest-bound. `pyodide-corpus-parity` proves that `OptionalRuntimeVerifier` observed exactly six problems and zero mismatches; the targeted suite separately proves the corpus contains eighteen cases.

- [ ] **Step 6: Revalidate the receipt through the capability report**

```powershell
pnpm run runtime:report
if ($LASTEXITCODE -ne 0) { throw "Capability report rejected the current RustPython receipt" }
node --input-type=module -e 'import { reportRuntimeCapabilities } from "./scripts/report-runtime-capabilities.mjs"; const report=reportRuntimeCapabilities(); const runtime=report.optional.find((entry)=>entry.runtimeId==="python-rustpython"); if(runtime?.state!=="verified"||!report.verifiedOptionalRuntimeIds.includes("python-rustpython")) throw new Error(JSON.stringify(report)); console.log(JSON.stringify(runtime));'
if ($LASTEXITCODE -ne 0) { throw "python-rustpython is not VERIFIED in the capability report" }
```

Expected: exit `0`, optional entry state `verified`, and `verifiedOptionalRuntimeIds` contains `python-rustpython`.

- [ ] **Step 7: When browser automation is available, prove the product-facing verification and execution path**

Open `http://127.0.0.1:5173/#/executor` in a fresh browser context. Use the `查看运行时详情` button, find the `python-rustpython` card, click `验证运行时`, wait for `验证完成：rustpython-wasi。`, and assert the card becomes `就绪`. Close the dialog, choose the RustPython option under `语言与本地运行时`, execute the checked-in Python preset, and require stdout containing `本地求和: 29` and `翻倍: [6, 10, 16, 26]`; record Worker/runtime identity and no CDN/application-API request. This product-flow evidence supplements but never replaces the receipt.

- [ ] **Step 8: Stop only the dev server started by this task**

After receipt/product checks, return to terminal A and stop that Vite process with Ctrl+C. Confirm no verifier process remains listening on port `4181`. Do not batch-kill unrelated Node/browser processes.

### Task 6: Final capability, diagnostics, identity, and review boundary

**Files:**
- Inspect: every changed file reported by Git
- Create/replace: `artifacts/qa/working-tree-identity.json`
- Create: `artifacts/qa/rustpython-runtime/final-capabilities.log`
- Create: `artifacts/qa/rustpython-runtime/final-status.txt`
- Inspect: `artifacts/runtime-verification/python-rustpython.json` on the success branch
- Inspect: `artifacts/qa/rustpython-runtime/compatibility-blocker.md` on the blocked branch

**Interfaces:**
- Consumes: all command transcripts, browser receipt or blocker record, current generated assets/manifest, and the exact final working-tree identity.
- Produces: one unambiguous handoff state (`VERIFIED`, `compatibility-blocked`, or `environment-blocked`), zero unresolved changed-file diagnostics for a success claim, and a final independent review package without any Git write.

**Recommended executor:** `complex`

- [ ] **Step 1: Run the final capability report on the exact current tree**

Success branch:

```powershell
pnpm run runtime:report 2>&1 | Tee-Object -FilePath "artifacts/qa/rustpython-runtime/final-capabilities.log"
if ($LASTEXITCODE -ne 0) { throw "Final capability report failed" }
```

Expected: `python-rustpython` is `verified`, required runtimes are packaged, `ready` is true, and no runtime is broken.

Compatibility-blocked branch: regenerate no fake assets, run `pnpm run runtime:manifest` and `pnpm run runtime:check`, then run `node scripts/verify-optional-runtime.mjs python-rustpython`; require exit `2` with `UNAVAILABLE`. Record that exact disabled state in `final-capabilities.log` and never label it passed.

- [ ] **Step 2: Generate exact working-tree identity after all relevant files settle**

```powershell
pnpm run identity
if ($LASTEXITCODE -ne 0) { throw "Working-tree identity generation failed" }
Get-Content -LiteralPath "artifacts/qa/working-tree-identity.json" -Raw
```

Expected: JSON contains `algorithm: sha256`, a non-empty digest, file count, and generation timestamp. Do not modify source, manifest, Worker, WASM, or receipt after this point without regenerating identity and invalidated evidence.

- [ ] **Step 3: Inspect every changed/generated path and reject accidental scope**

```powershell
git status --short
git diff --name-status
git diff --stat
git diff --check
git diff -- "runtimes/rustpython-runner/Cargo.toml" "runtimes/rustpython-runner/Cargo.lock" "runtimes/rustpython-runner/src/main.rs" "src/workers/rustpython/host.ts" "tests/workers/rustpython-host.test.ts" "tests/runtime/rustpython-parity.test.ts" "public/rustpython-worker.js" "public/runtime-manifest.json"
git status --short --ignored "public/rustpython" "runtimes/rustpython-runner/target" "artifacts/runtime-verification"
```

Expected success scope: optional pinned runner dependency/API change only if Task 2 was needed; a host/test change only if a real browser RED case required it; deterministic Worker/manifest output; ignored runner binaries; current receipt/evidence. Any unrelated source/config/doc change is a blocker. `git diff --check` exits `0`.

- [ ] **Step 4: Run diagnostics on every changed source/test file**

Call `lsp_status`, then `lsp_diagnostics` with severity `all` for each changed `.ts`/`.tsx`/`.rs` file that has an available server. Expected: zero errors and zero warnings. If no Rust language server is configured, record that fact and use the already-green `cargo fmt --check` plus locked target build as Rust diagnostics; do not install a server. Generated `.js`, `.json`, `.wasm`, lockfiles, and evidence artifacts are inspected by their owning generators/checkers rather than LSP.

- [ ] **Step 5: Run one final changed-input-sensitive verification pass**

If no relevant input changed after Tasks 4–5, do not rerun expensive green commands merely for ceremony. If runner Cargo/source, RustPython host/payload/WASI code, Worker build identity inputs, manifest, or any declared asset changed after the receipt, the receipt is stale: rerun Tasks 3–5 and then Steps 1–4 here. If only a test changed, rerun its focused test and `pnpm test`; if build/runtime inputs did not change, the digest-bound receipt remains current.

- [ ] **Step 6: Write the final status evidence**

Write `artifacts/qa/rustpython-runtime/final-status.txt` with exactly one leading status line:

```text
VERIFIED
```

or:

```text
COMPATIBILITY_BLOCKED
```

or:

```text
ENVIRONMENT_BLOCKED
```

Then list the exact final identity digest, relevant command exits, capability state, receipt path/checks or blocker path/diagnostic, and changed files. `VERIFIED` is permitted only when Task 5 and final capability validation both passed on the same identity.

- [ ] **Step 7: Request final review against this plan and the exact evidence package**

Use the `requesting-code-review` workflow after all implementation tasks settle. Provide the reviewer: this plan, `git diff`, final identity, Task 1/2 build logs, targeted/full quality logs, final capability report, and either the current receipt or compatibility blocker. Review must explicitly check protocol preservation, no expected/verdict data in Workers, exact five-check receipt ordering, six-problem parity, generated-asset truth, no unsupported success claim, and no unrelated changes.

Expected: no blocking findings for the selected branch. Any finding that changes runner/Worker/manifest/assets invalidates the current receipt and returns to Task 3. Do not dispatch implementation changes from the review step without returning through the owning RED/GREEN cycle.

- [ ] **Step 8: End without a Git write**

```powershell
git status --short
git log -1 --oneline
```

Expected: all intended source/generated/evidence changes are visible for user inspection, and the latest commit is unchanged from the starting commit. State which files should eventually be considered for version control, but do not stage, commit, push, or tag them; generated WASM requires an explicit asset/distribution decision rather than blind inclusion.
