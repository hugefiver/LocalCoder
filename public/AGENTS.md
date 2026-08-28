# Public Runtime Artifacts

## OVERVIEW

`public/` is the delivery directory for static runtime artifacts. Treat runtime
files here as build output or staged third-party bytes, not as implementation
source. The sole intended hand-written exception is a runtime-adjacent
`README.md` that explains how to obtain or build an external runtime.

`runtime-manifest.json` is the authority for the **current packaging**: its
asset URLs, byte counts, and runtime entries describe what this checkout ships.
It does not, by itself, prove an optional runtime is eligible to execute.

## OWNERSHIP TABLE

| Artifact | Ownership and edit rule |
|---|---|
| `*-worker.js` | Generated Workers. Fix `src/workers/` or the Worker build code in `scripts/`, then regenerate. |
| `runtime-manifest.json` | Generated manifest. Fix the runtime catalog or manifest generator in `scripts/`, then regenerate. |
| `typescript/typescript.js` | Staged official TypeScript compiler. Repair its staging source in `scripts/`; never patch the copied file. |
| `pyodide/*` | Staged Pyodide distribution. Its required group is exactly five files: `pyodide.js`, `pyodide.asm.js`, `pyodide.asm.wasm`, `python_stdlib.zip`, and `pyodide-lock.json`. |
| `rustpython/*`, `racket/*`, `haskell/*` | External WASM, WASI, support archives, and metadata. Repair the relevant `runtimes/` input or staging/build path in `scripts/`. |
| `*/runner.meta.json` | Generated runtime metadata, owned by the runtime build or staging path, not by `public/`. |
| `README.md` | May be hand-written only as operator instructions. It must not claim that copied assets are verified. |

## REGENERATION

Make source fixes in `src/workers/`, `scripts/`, or `runtimes/`, according to
the ownership table. Rebuild or stage the assets through the declared runtime
pipeline so Workers are produced before the manifest. Never hand-edit a Worker,
the manifest, compiler bytes, Pyodide files, WASM, WASI support files, archives,
or generated metadata.

Haskell assets require a Git LFS checkout before validation. An LFS pointer is
not a usable non-empty asset and must fail the byte and readiness checks.

## ONE-OF/RECEIPT RULES

Some optional groups permit gzip or raw variants. One present variant is enough
to package a group, but if more than one loadable variant exists, declare every
present variant in catalog order. Hash every declared variant into the Worker
identity, byte-check every one, and bind every one to the browser receipt digest.

The receipt must match the current manifest, runtime ID, protocol version,
named checks, and asset SHA-256 digests. A stale or partial receipt cannot make
an optional runtime executable.

## ANTI-PATTERNS

- Don't patch generated runtime files to test a theory. Change their owner and regenerate them.
- Don't omit a present raw or gzip alternative from the manifest, identity, byte check, or receipt.
- Don't treat packaged Haskell bytes as verified after LFS checkout alone.
- Don't enable an optional runtime because the manifest lists it. Optional verification is a separate current browser-session gate.
- Don't describe `LOADABLE_UNVERIFIED` or `UNAVAILABLE` as a passing runtime state.

*Author's note: Written for a maintainer changing runtime packaging, so they repair the producer and preserve the verification gate.*
