# Scripts Guide

## OVERVIEW

`scripts/` stages runtime assets, builds Workers and the static application, then
checks the delivered files. Treat these scripts as the source of generation
rules, not as a place for hand-maintained copies of generated output.

Generated outputs include Worker bundles under `public/`, staged TypeScript and
Pyodide assets, `public/runtime-manifest.json`, and the corresponding files in
`dist/`. Change the owning source or builder, then regenerate the output.

## BUILD ORDER

`build-app.mjs` is the delivery sequence. It stages the TypeScript asset,
stages Pyodide, builds Workers, generates the runtime manifest, reports
capabilities, typechecks, lints, tests, builds with Vite, checks `dist`, then
runs the smoke check. Preserve that order.

The runtime catalog must be resolved into the manifest only after Worker and
asset construction. The manifest records the files actually packaged, including
their byte sizes, so it must never be treated as upstream configuration.

## SOURCE OF TRUTH

`lib/runtime-catalog.mjs` defines runtime IDs, required status, asset groups,
reuse, limits, timeouts, and capability intent. A `one-of` group is packaged
when at least one candidate exists; if several variants exist, the manifest
declares every present variant in catalog order.

`setup-pyodide.js` has an exact five-file allowlist: `pyodide.js`,
`pyodide.asm.js`, `pyodide.asm.wasm`, `python_stdlib.zip`, and
`pyodide-lock.json`. Do not broaden it casually. The smoke check rejects an
undeclared Pyodide file in the distribution.

## IDENTITY/RECEIPTS

Worker plans, resolved import closures, the actual esbuild package and selected
platform binary, applicable WASI shim files, and applicable runtime assets form
the Worker identity inputs. Do not derive identity from source prose, a manifest,
or a generated Worker bundle. Missing optional groups contribute stable sentinels.

An optional runtime is `VERIFIED` only with a current browser receipt that
matches its runtime, protocol, checks, and asset digests. `LOADABLE_UNVERIFIED`
and `UNAVAILABLE` remain disabled. Optional verification exits 0 for verified,
2 for either disabled state, and 1 for `BROKEN`.

## SAFETY

Use Node APIs and `path`/`fileURLToPath` rather than shell-specific path,
process, or copy behavior. Scripts must work on supported platforms, including
Windows, and must validate resolved paths stay beneath their intended root.

Keep generated artifacts generated. Do not patch Worker bundles, staged runtime
assets, or the manifest to change availability or identity. Required runtime
asset failures fail closed; optional assets alone do not enable an optional
runtime.

## TESTS

Keep script tests focused on exported functions and failure cases such as empty
assets, unsafe paths, missing one-of groups, and stale byte sizes. Validate the
delivered `dist/` tree, not only `public/`.

The smoke check verifies required route chunks and runtime assets. With the
Pages environment enabled, it also requires `404.html`; retain that Pages smoke
coverage when changing the build or deployment shape.
