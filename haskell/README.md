# Haskell WASM runtime

This directory is expected to contain the Haskell WebAssembly runtime used by `public/haskell-worker.js`.

## Required file

- `runner.wasm`

## Protocol (stdin/stdout)

The worker sends a single JSON document to stdin:

- Executor mode: `{ "mode": "executor", "code": "..." }`
- Test mode: `{ "mode": "test", "code": "...", "input": <any> }`

The runtime should print exactly one JSON document to stdout:

`{ "logs": "...", "result": <any> }`

If stdout is not valid JSON, the worker will treat it as plain logs.

## How to build runner.wasm

See the repository README for suggested toolchains and an example runner contract.
