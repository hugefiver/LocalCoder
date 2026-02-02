# Racket (official interpreter) WASM runtime

This runtime uses the **official Racket interpreter** compiled via **Emscripten**.

## Requirements

- Emscripten SDK (`emcc`, `emmake`)
- Official Racket source code

## Setup

Clone the Racket source into:

```
runtimes/racket-runtime/racket-src
```

Then run:

```
pnpm run build:runtimes
```

The build script will:

1. Configure Racket for interpreter mode (JIT disabled)
2. Run `emmake make`
3. Produce `dist/racket.js` + `dist/racket.wasm`
4. Copy them to `public/racket/`

It also enforces runtime flags so the worker can execute programs:

- `-sFORCE_FILESYSTEM=1`
- `-sEXPORTED_FUNCTIONS=['_main']`
- `-sEXPORTED_RUNTIME_METHODS=['callMain','FS']`

You can append extra flags via:

```
RACKET_EMCC_FLAGS="..."
```

If your binary name differs, set:

```
RACKET_EMCC_INPUT=/path/to/built/binary
```

## Notes

- The worker wraps code to emit JSON (`logs`, `result`, `error`).
- Use `RACKET_WASM_STRICT=1` to fail build if artifacts are missing.
