import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { makeRustPythonPayload } from "../../src/workers/rustpython/payload.js";
import { createRustPythonHost } from "../../src/workers/rustpython/host.js";
import { RuntimeFailureError } from "../../src/workers/shared/runtime-errors.js";
import type { WasiExecution, WasiRunOptions } from "../../src/workers/wasi/runner.js";

const encoder = new TextEncoder();

function response(value: unknown, stdout = "", stderr = ""): WasiExecution {
  return {
    stdout: JSON.stringify({ ok: true, value, stdout, stderr }),
    stderr: "",
    exitCode: 0,
    truncated: false,
  };
}

function hostFor(options: {
  readonly fetchBytes?: (url: string) => Promise<ArrayBuffer>;
  readonly runWasi?: (options: WasiRunOptions) => Promise<WasiExecution>;
  readonly outputBytes?: number;
} = {}) {
  return createRustPythonHost({
    fetchBytes: options.fetchBytes ?? (async () => new ArrayBuffer(8)),
    runWasi: options.runWasi ?? (async (run) => response(run.stdin.includes('"mode":"judge"') ? null : null)),
    ...(options.outputBytes === undefined ? {} : { outputBytes: options.outputBytes }),
    buildId: "feedfacefeedface",
  });
}

test("RustPython payload serializes source and Unicode judge input without raw interpolation", () => {
  const source = "print(\"'''\")";
  const input = { text: "'''\n雪" };

  assert.deepEqual(JSON.parse(makeRustPythonPayload({ mode: "judge", source, input })), { mode: "judge", source, input });
  assert.deepEqual(JSON.parse(makeRustPythonPayload({ mode: "execute", source })), { mode: "execute", source });
  assert.throws(() => makeRustPythonPayload({ mode: "judge", source, input: Number.NaN }), /canonical JSON/i);
});

test("the Rust runner source has no triple-quoted raw input carrier", () => {
  const source = readFileSync(path.resolve("runtimes/rustpython-runner/src/main.rs"), "utf8");
  assert.doesNotMatch(source, /r'''\{/);
});

test("RustPython host falls back from missing gzip and missing DecompressionStream to raw WASM", async () => {
  const fetched: string[] = [];
  const host = hostFor({
    fetchBytes: async (url) => {
      fetched.push(url);
      if (url.endsWith(".gz")) throw new Error("missing gzip");
      return new ArrayBuffer(8);
    },
  });

  await host.initialize();
  assert.deepEqual(fetched, ["rustpython/runner.wasm.gz", "rustpython/runner.wasm"]);

  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "DecompressionStream");
  Object.defineProperty(globalThis, "DecompressionStream", { configurable: true, value: undefined });
  try {
    const rawFetched: string[] = [];
    const rawHost = hostFor({
      fetchBytes: async (url) => {
        rawFetched.push(url);
        return new ArrayBuffer(8);
      },
    });
    await rawHost.initialize();
    assert.deepEqual(rawFetched, ["rustpython/runner.wasm.gz", "rustpython/runner.wasm"]);
  } finally {
    if (descriptor === undefined) delete (globalThis as { DecompressionStream?: unknown }).DecompressionStream;
    else Object.defineProperty(globalThis, "DecompressionStream", descriptor);
  }
});

test("RustPython host normalizes nonzero exits, malformed output, and bounded Python failure details", async () => {
  const nonzero = hostFor({ runWasi: async () => ({ stdout: "", stderr: "runner failed", exitCode: 2, truncated: false }) });
  await assert.rejects(nonzero.execute("print('x')"), failure("rustpython-nonzero-exit", "runtime"));

  const malformed = hostFor({ runWasi: async () => ({ stdout: "not-json", stderr: "", exitCode: 0, truncated: false }) });
  await assert.rejects(malformed.execute("print('x')"), failure("json-bridge-error", "runtime"));

  const details = "雪".repeat(5_000);
  const compile = hostFor({
    runWasi: async () => ({
      stdout: JSON.stringify({ ok: false, kind: "python-compile-error", details, stdout: "", stderr: "" }),
      stderr: "",
      exitCode: 0,
      truncated: false,
    }),
  });
  const judged = await compile.judge("def solution(", [{ index: 0, input: null }]);
  const result = judged.cases[0];
  assert.equal(result?.ok, false);
  if (result?.ok === false) {
    assert.equal(result.failure.kind, "compile");
    assert.equal(result.failure.code, "python-compile-error");
    assert.ok(encoder.encode(result.failure.details ?? "").byteLength <= 8_192);
  }
});

test("RustPython host applies one shared UTF-8 output budget and starts a fresh WASI run per operation", async () => {
  const calls: WasiRunOptions[] = [];
  const host = hostFor({
    outputBytes: 6,
    runWasi: async (run) => {
      calls.push(run);
      return response(run.stdin.includes('"mode":"judge"') ? { ok: true } : null, "😀", "abc");
    },
  });

  const execute = await host.execute("print('executor')");
  const judged = await host.judge("def solution(value): return value", [
    { index: 2, input: { hello: "world" } },
    { index: 4, input: [true] },
  ]);

  assert.deepEqual(execute, {
    value: null,
    stdout: { text: "😀", bytes: 4, truncated: false },
    stderr: { text: "ab", bytes: 2, truncated: true },
  });
  assert.equal(calls.length, 3);
  assert.notStrictEqual(calls[0], calls[1]);
  assert.notStrictEqual(calls[1], calls[2]);
  assert.deepEqual(judged.cases.map((item: { readonly index: number }) => item.index), [2, 4]);
  assert.doesNotMatch(JSON.stringify(judged), /expected|passed|verdict|comparer/i);
});

function failure(code: string, kind: "compile" | "runtime") {
  return (error: unknown): boolean => error instanceof RuntimeFailureError
    && error.failure.code === code
    && error.failure.kind === kind
    && error.failure.fatal === false;
}
