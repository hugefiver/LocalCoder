# RustPython runtime (WASI)

This directory contains the RustPython WASI runtime used by `public/rustpython-worker.js`.

## Required file

- `runner.wasm`

`pnpm run build:runtimes` produces this file.

## Protocol

The runner reads one JSON request from stdin:

- Execute: `{ "mode": "execute", "source": "..." }`
- Judge: `{ "mode": "judge", "source": "...", "input": <JSON> }`

stdout contains exactly one JSON bridge envelope. Its fields and error kinds are defined by
`runtimes/rustpython-runner/src/main.rs`: successful requests contain `ok`, `value`,
`stdout`, and `stderr`; failed requests contain `ok: false`, `kind`, `details`, `stdout`,
and `stderr`.

If `runner.wasm` has not been packaged, RustPython remains `UNAVAILABLE`. That state does
not indicate that execution has passed.
