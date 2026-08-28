import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeFailureError } from "../../src/workers/shared/runtime-errors.js";
import {
  PYODIDE_BRIDGE_GLOBALS,
  PYODIDE_BRIDGE_PROGRAM,
  createPyodideHost,
  type PyodideLike,
} from "../../src/workers/python/pyodide-host.js";
import { createLocalPyodideLoader, type PyodideAssetScope } from "../../src/workers/pyodide.worker.js";

interface BridgeRequest {
  readonly source: string;
  readonly input: unknown;
  readonly mode: "execute" | "judge";
}

class FakeProxy {
  #destroyed = false;

  constructor(private readonly fake: FakePyodide) {
    this.fake.liveProxyCount += 1;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.fake.liveProxyCount -= 1;
  }
}

class FakePyodide implements PyodideLike {
  readonly version = "0.29.1-fake";
  readonly values = new Map<string, unknown>();
  readonly calls: Array<{ readonly code: string; readonly request: BridgeRequest }> = [];
  liveProxyCount = 0;
  loadCount = 0;
  response: (request: BridgeRequest) => unknown = (request) => success(request.mode === "judge" ? request.input : null);
  readonly globals = {
    set: (name: string, value: unknown): void => {
      this.values.set(name, value);
    },
    delete: (name: string): boolean => this.values.delete(name),
  };

  async runPythonAsync(code: string): Promise<unknown> {
    const source = JSON.parse(jsonText(this.values.get(PYODIDE_BRIDGE_GLOBALS.source)));
    const input = JSON.parse(jsonText(this.values.get(PYODIDE_BRIDGE_GLOBALS.input)));
    const mode = JSON.parse(jsonText(this.values.get(PYODIDE_BRIDGE_GLOBALS.mode)));
    if (typeof source !== "string") throw new Error("bridge source was not a string");
    if (mode !== "execute" && mode !== "judge") throw new Error("invalid bridge mode");
    const request = { source, input, mode } as const;
    this.calls.push({ code, request });
    return this.response(request);
  }

  proxy(): FakeProxy {
    return new FakeProxy(this);
  }
}

function jsonText(value: unknown): string {
  if (typeof value !== "string") throw new Error("bridge global was not a JSON string");
  return value;
}

function success(value: unknown, stdout = "", stderr = ""): string {
  return JSON.stringify({ ok: true, value, stdout, stderr });
}

function failure(
  kind: "python-compile-error" | "python-runtime-error" | "json-bridge-error",
  details: string,
  stdout = "",
  stderr = "",
): string {
  return JSON.stringify({ ok: false, kind, details, stdout, stderr });
}

function hostFor(fake: FakePyodide, outputBytes = 65_536) {
  return createPyodideHost({
    load: async () => {
      fake.loadCount += 1;
      return fake;
    },
    outputBytes,
    buildId: "feedfacefeedface",
  });
}

test("the Pyodide host uses a constant JSON-string bridge for Unicode nested inputs and cleans globals", async () => {
  const fake = new FakePyodide();
  const host = hostFor(fake);
  const input = { greeting: "こんにちは😀", nested: [true, { café: null }] };

  const initialized = await host.initialize();
  const result = await host.judge("def solution(value):\n    return value", [{ index: 4, input }]);

  assert.deepEqual(initialized, {
    runtimeVersion: "0.29.1-fake",
    buildId: "feedfacefeedface",
    capabilities: { execute: true, judge: true },
  });
  assert.equal(fake.loadCount, 1);
  assert.equal(fake.calls[0]?.code, PYODIDE_BRIDGE_PROGRAM);
  assert.equal(fake.calls[0]?.request.source, "def solution(value):\n    return value");
  assert.deepEqual(fake.calls[0]?.request.input, input);
  assert.doesNotMatch(fake.calls[0]?.code ?? "", /こんにちは|solution\(value\)/);
  assert.deepEqual(result.cases[0], {
    index: 4,
    ok: true,
    actual: input,
    stdout: bounded(),
    stderr: bounded(),
  });
  assert.equal(fake.values.size, 0);
  assert.equal(fake.liveProxyCount, 0);
});

test("the Pyodide host uses a fresh namespace for every submission and reuses only the interpreter", async () => {
  const fake = new FakePyodide();
  fake.response = ({ source }) => success(source.includes("counter =") ? 1 : 0);
  const host = hostFor(fake);

  const first = await host.judge("counter = globals().get('counter', 0) + 1\ndef solution(value): return counter", [{ index: 0, input: { n: 1 } }]);
  const second = await host.judge("def solution(value): return globals().get('counter', 0)", [{ index: 0, input: { n: 1 } }]);
  const firstCase = first.cases[0];
  const secondCase = second.cases[0];

  if (firstCase?.ok !== true || secondCase?.ok !== true) assert.fail("Pyodide case did not complete");
  assert.equal(firstCase.actual, 1);
  assert.equal(secondCase.actual, 0);
  assert.equal(fake.loadCount, 1);
  assert.equal(fake.liveProxyCount, 0);
  assert.ok(fake.calls.every((call) => call.code.includes("__localcoder_namespace = {'__name__': '__main__'}")));
});

test("the Pyodide host returns structured nonfatal Python and JSON bridge failures without leaked proxies", async () => {
  const fake = new FakePyodide();
  const host = hostFor(fake);
  fake.response = ({ source }) => {
    if (source === "def solution(") return failure("python-compile-error", "SyntaxError: invalid syntax");
    if (source.includes("raise")) return failure("python-runtime-error", "RuntimeError: boom", "before\n", "problem\n");
    if (source.includes("nan") || source.includes("set(") || source.includes("class Result")) {
      return failure("json-bridge-error", "TypeError: not JSON serializable");
    }
    return fake.proxy();
  };

  const syntax = await host.judge("def solution(", [{ index: 0, input: null }]);
  const syntaxCase = syntax.cases[0];
  assert.equal(syntaxCase?.ok, false);
  if (syntaxCase?.ok === false) {
    assert.deepEqual(syntaxCase.failure, {
      kind: "compile",
      code: "python-compile-error",
      message: "Python source could not be compiled",
      details: "SyntaxError: invalid syntax",
      fatal: false,
    });
  }

  const exception = await host.judge("def solution(value):\n    raise RuntimeError('boom')", [{ index: 0, input: null }]);
  const exceptionCase = exception.cases[0];
  assert.equal(exceptionCase?.ok, false);
  if (exceptionCase?.ok === false) {
    assert.deepEqual(exceptionCase.failure, {
      kind: "runtime",
      code: "python-runtime-error",
      message: "Python execution failed",
      details: "RuntimeError: boom",
      fatal: false,
    });
    assert.deepEqual(exceptionCase.stdout, bounded("before\n"));
    assert.deepEqual(exceptionCase.stderr, bounded("problem\n"));
  }

  for (const source of [
    "def solution(value): return float('nan')",
    "def solution(value): return set([1])",
    "class Result: pass\ndef solution(value): return Result()",
  ]) {
    const result = await host.judge(source, [{ index: 1, input: null }]);
    const testCase = result.cases[0];
    assert.equal(testCase?.ok, false);
    if (testCase?.ok === false) assert.equal(testCase.failure.code, "json-bridge-error");
  }

  await assert.rejects(
    host.execute("print('executor')"),
    (error: unknown) => error instanceof RuntimeFailureError
      && error.failure.code === "json-bridge-error"
      && error.failure.fatal === false,
  );
  assert.equal(fake.liveProxyCount, 0);
  assert.equal(fake.values.size, 0);
});

test("the Pyodide host bounds shared stdout and stderr and returns free executor output", async () => {
  const fake = new FakePyodide();
  fake.response = ({ mode }) => success(null, "😀", mode === "execute" ? "abc" : "");
  const host = hostFor(fake, 6);

  const output = await host.execute("print('executor')");

  assert.deepEqual(output, {
    value: null,
    stdout: { text: "😀", bytes: 4, truncated: false },
    stderr: { text: "ab", bytes: 2, truncated: true },
  });
  assert.equal(fake.calls[0]?.request.mode, "execute");
  assert.equal(fake.calls[0]?.request.input, null);
});

test("the local Pyodide loader uses same-origin assets and makes missing or incompatible assets fatal", async () => {
  const imported: string[] = [];
  const scope: PyodideAssetScope = {
    location: { href: "https://example.test/localcoder/python-worker.js" },
    importScripts: (...urls) => imported.push(...urls),
    loadPyodide: async (options) => {
      assert.equal(options.indexURL, "https://example.test/localcoder/pyodide/");
      return new FakePyodide();
    },
  };
  const loader = createLocalPyodideLoader(scope);
  const loaded = await loader();
  assert.equal(loaded.version, "0.29.1-fake");
  assert.deepEqual(imported, ["https://example.test/localcoder/pyodide/pyodide.js"]);

  const missing = createLocalPyodideLoader({
    ...scope,
    importScripts: () => { throw new Error("not found"); },
  });
  await assert.rejects(missing(), fatalFailure("pyodide-asset-missing"));

  const incompatible = createLocalPyodideLoader({
    ...scope,
    importScripts: () => undefined,
    loadPyodide: async () => ({ globals: { set: () => undefined, delete: () => true } }),
  });
  await assert.rejects(incompatible(), fatalFailure("pyodide-api-incompatible"));
});

function fatalFailure(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof RuntimeFailureError
    && error.failure.kind === "infrastructure"
    && error.failure.code === code
    && error.failure.fatal;
}

function bounded(text = "") {
  return { text, bytes: new TextEncoder().encode(text).byteLength, truncated: false };
}
