# RustPython runtime (WASI)

This directory contains the RustPython WASI runtime used by `public/rustpython-worker.js`.

## Required files

- `runner.wasm.gz.bin` (preferred gzip transport bytes)
- `runner.wasm` (raw fallback)

`pnpm run build:runtimes` produces both files. The `.gz.bin` suffix prevents HTTP servers from
automatically applying `Content-Encoding: gzip` and decoding the response before the Worker
explicitly decompresses it. The Worker falls back to the raw file when the gzip-bin asset or
`DecompressionStream` is unavailable.

Release copies are tracked through Git LFS. A checkout must materialize the real bytes before
Worker and manifest generation; an unresolved LFS pointer is not a runtime asset.

## Protocol

The runner reads one JSON request from stdin:

- Execute: `{ "mode": "execute", "source": "..." }`
- Judge: `{ "mode": "judge", "source": "...", "input": <JSON> }`

stdout contains exactly one JSON bridge envelope. Its fields and error kinds are defined by
`runtimes/rustpython-runner/src/main.rs`: successful requests contain `ok`, `value`,
`stdout`, and `stderr`; failed requests contain `ok: false`, `kind`, `details`, `stdout`,
and `stderr`.

If neither runner file has been packaged, RustPython remains `UNAVAILABLE`. If both are packaged
without a current browser receipt, it remains `LOADABLE_UNVERIFIED`. Neither disabled state
indicates that execution has passed.
