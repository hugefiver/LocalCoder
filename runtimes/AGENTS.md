# External Runtime Build Inputs

## OVERVIEW

`runtimes/` holds source trees and inputs for optional browser runtimes.
It is not a pnpm workspace or a directory of application packages.

The normal application build consumes already staged files from `public/`.
Use this directory only when changing an external runtime's source, build input,
or staging contract.

## STRUCTURE

- `haskell-ghc/` contains the current GHC WASM inputs, build helper, and runner
  metadata.
- `rustpython-runner/` is the Rust Cargo crate for the experimental RustPython
  WASI runner.
- `racket-runtime/` contains the Emscripten build script and headers for the
  official Racket interpreter.
- `haskell-runner/` is a legacy runner source. Do not treat it as the current
  Haskell runtime path.
- `haskell-runner-stub/` and its `target/` output are legacy scratch and build
  material, not current runtime inputs or delivery artifacts.

## BUILD INPUTS

Haskell uses official GHC or GHCi WASM binaries plus an uncompressed GHC
`libdir.tar`. Supply them in `haskell-ghc/dist/` or with `GHC_WASM`,
`GHCI_WASM`, and `GHC_LIBDIR_TAR`.

`haskell-ghc/runner.meta.json` selects the protocol and execution modes, then
names the staged GHC, libdir, and WASI shim paths. If it selects GHCi, provide
the matching `ghci.wasm` too.

`haskell-ghc/dist/ghc.wasm` is Git LFS tracked. Check out LFS content before
validating or staging it; a pointer file is not a usable runtime asset.

Build RustPython from `rustpython-runner/Cargo.toml` and `src/main.rs` with a
Rust WASI target. Build Racket from an official source checkout in
`racket-runtime/racket-src` with Emscripten (`emcc` and `emmake`).

Run `pnpm run build:runtimes` when rebuilding these optional assets. It is
separate from the normal app build, stages outputs under `public/`, rebuilds
Workers, and regenerates the runtime manifest.

## CURRENT REALITY

RustPython and Racket are currently unavailable because their required staged
asset groups are absent.

Haskell assets are packaged, including GHC, the libdir archive, the WASI shim,
and runner metadata. The Haskell runtime still remains `LOADABLE_UNVERIFIED`
and disabled until a current browser verification receipt matches its assets.

## ANTI-PATTERNS

- Don't describe `runtimes/` as pnpm packages or assume these toolchains exist
  in ordinary development or CI environments.
- Don't edit staged `public/` runtime files or generated manifest data by hand.
- Don't use the legacy Haskell runner, stub, or `target/` artifacts as evidence
  of the current GHC WASM implementation.
- Don't accept an LFS pointer as a Haskell asset or call packaged Haskell
  verified without its current browser receipt.

*Author's note: Written for maintainers changing an optional runtime input, so
they choose the active producer and preserve the verification gate.*
