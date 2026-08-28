import assert from "node:assert/strict";
import test from "node:test";
import { CapturedEmscriptenStreams } from "../../src/workers/racket/captured-streams.js";
import { createEmscriptenRacketHost, type EmscriptenRacketLike } from "../../src/workers/racket/emscripten-host.js";
import { createLocalRacketLoader } from "../../src/workers/racket.worker.js";
import { createRacketBridgeProgram } from "../../src/workers/racket/json-bridge.js";

test("the Racket bridge crosses nested canonical JSON through string->jsexpr and jsexpr->string", () => {
  const source = "#lang racket\n(define (solution input) input)";
  const input = { greeting: "こんにちは😀", nested: [true, { café: null, quote: "\\\"" }] };
  const program = createRacketBridgeProgram({ source, input, mode: "judge" });

  assert.match(program, /string->jsexpr/);
  assert.match(program, /jsexpr->string/);
  assert.match(program, /\(solution __lc_input\)/);
  assert.match(program, /こんにちは😀/);
  assert.match(program, /café/);
  assert.doesNotMatch(program, /jsToRacketExpr|stableStringify|expected|passed|verdict|comparer/i);
});

test("the Racket bridge keeps free execution separate from solution invocation", () => {
  const program = createRacketBridgeProgram({
    source: "#lang racket\n(displayln \"free\")",
    input: null,
    mode: "execute",
  });

  assert.doesNotMatch(program, /\(solution __lc_input\)/);
  assert.match(program, /'value 'null/);
});

test("the Emscripten host writes fresh bridge files, parses one JSON payload, and removes every file", async () => {
  const runtime = new FakeRacket();
  runtime.responses = [
    JSON.stringify({ ok: true, value: { greeting: "こんにちは", nested: [true, null] }, stdout: "first\n", stderr: "" }),
    JSON.stringify({ ok: true, value: null, stdout: "free\n", stderr: "" }),
  ];
  const host = createEmscriptenRacketHost({ load: async () => runtime, outputBytes: 64, buildId: "racket-build" });

  const initialized = await host.initialize();
  const judged = await host.judge("#lang racket\n(define (solution input) input)", [{ index: 3, input: { greeting: "こんにちは", nested: [true, null] } }]);
  const executed = await host.execute("#lang racket\n(displayln \"free\")");

  assert.deepEqual(initialized, {
    runtimeVersion: "racket-fake",
    buildId: "racket-build",
    capabilities: { execute: true, judge: true },
  });
  assert.deepEqual(judged.cases[0], {
    index: 3,
    ok: true,
    actual: { greeting: "こんにちは", nested: [true, null] },
    stdout: bounded("first\n"),
    stderr: bounded(),
  });
  assert.deepEqual(executed, { value: null, stdout: bounded("free\n"), stderr: bounded() });
  assert.equal(runtime.files.size, 0);
  assert.equal(runtime.written.length, 2);
  assert.notEqual(runtime.written[0], runtime.written[1]);
  assert.ok(runtime.programs.every((program) => program.includes("string->jsexpr") && program.includes("jsexpr->string")));
  assert.ok(runtime.programs.every((program) => !/expected|passed|verdict|comparer/i.test(program)));
});

test("the Emscripten host reports malformed bridge output as a structured nonfatal failure", async () => {
  const runtime = new FakeRacket();
  runtime.responses = ["not json"];
  const host = createEmscriptenRacketHost({ load: async () => runtime, outputBytes: 64, buildId: "racket-build" });

  const result = await host.judge("#lang racket\n(define (solution input) input)", [{ index: 0, input: null }]);

  const testCase = result.cases[0];
  assert.equal(testCase?.ok, false);
  if (testCase?.ok === false) assert.equal(testCase.failure.code, "json-bridge-error");
  assert.equal(runtime.files.size, 0);
});

test("the Emscripten capture retains whole UTF-8 code points within bridge headroom", () => {
  const capture = new CapturedEmscriptenStreams(0);
  capture.append("stdout", `${"a".repeat(16_383)}😀`);
  capture.append("stderr", "discarded");

  assert.equal(capture.stdout(), "a".repeat(16_383));
  assert.equal(capture.stderr(), "d");
});

test("the Emscripten host bounds a runtime failure envelope and restores process handlers", async () => {
  const runtime = new FakeRacket();
  const originalPrint = () => undefined;
  const originalPrintErr = () => undefined;
  runtime.print = originalPrint;
  runtime.printErr = originalPrintErr;
  runtime.responses = [JSON.stringify({
    ok: false,
    kind: "racket-runtime-error",
    details: "solution failed",
    stdout: "😀😀😀",
    stderr: "stderr",
  })];
  const host = createEmscriptenRacketHost({ load: async () => runtime, outputBytes: 8, buildId: "racket-build" });

  const result = await host.judge("#lang racket\n(define (solution input) input)", [{ index: 0, input: null }]);

  assert.deepEqual(result.cases[0], {
    index: 0,
    ok: false,
    failure: { kind: "runtime", code: "racket-runtime-error", message: "Racket execution failed", details: "solution failed", fatal: false },
    stdout: bounded("😀😀", true),
    stderr: bounded("", true),
  });
  assert.equal(runtime.files.size, 0);
  assert.strictEqual(runtime.print, originalPrint);
  assert.strictEqual(runtime.printErr, originalPrintErr);
});

test("the Emscripten host classifies read syntax failures as nonfatal compile errors and restores handlers", async () => {
  const runtime = new FakeRacket();
  const originalPrint = () => undefined;
  const originalPrintErr = () => undefined;
  runtime.print = originalPrint;
  runtime.printErr = originalPrintErr;
  runtime.failures = [new Error("read-syntax: expected a closing parenthesis")];
  const host = createEmscriptenRacketHost({ load: async () => runtime, outputBytes: 64, buildId: "racket-build" });

  await assert.rejects(
    host.execute("#lang racket\n(define value 1)"),
    (error: unknown) => {
      assert.equal(typeof error, "object");
      assert.ok(error !== null);
      const failure = (error as { failure?: { code?: unknown; fatal?: unknown } }).failure;
      assert.equal(failure?.code, "racket-compile-error");
      assert.equal(failure?.fatal, false);
      return true;
    },
  );
  assert.equal(runtime.files.size, 0);
  assert.strictEqual(runtime.print, originalPrint);
  assert.strictEqual(runtime.printErr, originalPrintErr);
});

test("the local Racket loader imports same-origin assets and rejects absent official module APIs", async () => {
  const runtime = new FakeRacket();
  const imported: string[] = [];
  const loader = createLocalRacketLoader({
    location: { href: "https://example.test/localcoder/racket-worker.js" },
    importScripts: (...urls) => imported.push(...urls),
    createRacketModule: async (options) => {
      assert.equal(options.locateFile("racket.wasm"), "https://example.test/localcoder/racket/racket.wasm");
      return runtime;
    },
  });

  assert.equal(await loader(), runtime);
  assert.deepEqual(imported, ["https://example.test/localcoder/racket/racket.js"]);
  await assert.rejects(
    createLocalRacketLoader({
      location: { href: "https://example.test/localcoder/racket-worker.js" },
      importScripts: () => undefined,
    })(),
    /did not expose createRacketModule/,
  );
});

class FakeRacket implements EmscriptenRacketLike {
  readonly version = "racket-fake";
  readonly files = new Map<string, string>();
  readonly written: string[] = [];
  readonly programs: string[] = [];
  responses: string[] = [];
  failures: unknown[] = [];
  print?: (text: string) => void;
  printErr?: (text: string) => void;
  readonly FS = {
    writeFile: (path: string, data: string): void => {
      this.files.set(path, data);
      this.written.push(path);
      this.programs.push(data);
    },
    unlink: (path: string): void => {
      this.files.delete(path);
    },
  };

  callMain(args: readonly string[]): void {
    const path = args[0];
    if (path === undefined || !this.files.has(path)) throw new Error("missing bridge program");
    const failure = this.failures.shift();
    if (failure !== undefined) throw failure;
    this.print?.(this.responses.shift() ?? "");
  }
}

function bounded(text = "", truncated = false) {
  return { text, bytes: new TextEncoder().encode(text).byteLength, truncated };
}
