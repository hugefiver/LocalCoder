import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { type RuntimeFailure } from "../../src/runtime/protocol.js";
import { type WorkerRuntime } from "../../src/workers/shared/endpoint.js";
import { RuntimeFailureError } from "../../src/workers/shared/runtime-errors.js";
import {
  createTypeScriptAssetRuntime,
  createTypeScriptRuntime,
  transpileTypeScript,
  type TypeScriptCompilerLike,
  type TypeScriptDiagnosticLike,
} from "../../src/workers/javascript/typescript-compiler.js";

const compiler = ts as unknown as TypeScriptCompilerLike;

test("the official compiler transpiles typed source to ES2020 script output", () => {
  const result = transpileTypeScript(
    compiler,
    "function solution(input: { n: number }): number { return input.n + 1; }",
  );

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected TypeScript transpilation to succeed");
  assert.doesNotMatch(result.code, /: number/);
  assert.doesNotMatch(result.code, /export\s/);
  assert.deepEqual(result.diagnostics, []);
});

test("TypeScript syntax diagnostics are compile failures with bounded TS code and location details", () => {
  const result = transpileTypeScript(compiler, "function solution( { return 1 }");

  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected TypeScript transpilation to fail");
  assert.equal(result.failure.kind, "compile");
  assert.equal(result.failure.fatal, false);
  assert.equal(result.failure.code, "typescript-compile-error");
  assert.match(result.failure.message, /TS\d+/);
  assert.match(result.failure.details ?? "", /TS\d+\s+\d+:\d+:/);
  assert.ok(new TextEncoder().encode(result.failure.details ?? "").byteLength <= 8_192);
});

test("TypeScript diagnostics remain deterministic and within the protocol detail limit", () => {
  const diagnostics = Array.from({ length: 100 }, (_, index): TypeScriptDiagnosticLike => ({
    category: 1,
    code: 7000 + index,
    messageText: `diagnostic ${index}: ${"x".repeat(200)}`,
    start: index,
    file: { getLineAndCharacterOfPosition: (position: number) => ({ line: position, character: position + 1 }) },
  }));
  const fakeCompiler = compilerWith(diagnostics);

  const first = transpileTypeScript(fakeCompiler, "return null;");
  const second = transpileTypeScript(fakeCompiler, "return null;");

  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  if (first.ok || second.ok) throw new Error("expected compiler diagnostics to fail transpilation");
  assert.equal(first.failure.details, second.failure.details);
  assert.ok(new TextEncoder().encode(first.failure.details ?? "").byteLength <= 8_192);
  assert.match(first.failure.details ?? "", /TS7000 1:2:/);
});

test("compile errors bypass the JavaScript evaluator while valid emitted code uses its execution path", async () => {
  const calls: string[] = [];
  const evaluator: WorkerRuntime = {
    initialize: async () => {
      calls.push("initialize");
      return { runtimeVersion: "javascript-es2020", buildId: "build", capabilities: { execute: true, judge: true } };
    },
    execute: async (source) => {
      calls.push(`execute:${source}`);
      return { stdout: bounded(), stderr: bounded(), value: 42 };
    },
    judge: async (source) => {
      calls.push(`judge:${source}`);
      return { cases: [] };
    },
    dispose: async () => { calls.push("dispose"); },
  };
  const runtime = createTypeScriptRuntime(compiler, { evaluator });

  await runtime.initialize();
  await assert.rejects(
    runtime.execute("function solution( { return 1 }"),
    (error: unknown) => isFailure(error, "typescript-compile-error"),
  );
  await assert.rejects(
    runtime.judge("function solution( { return 1 }", [{ index: 0, input: null }]),
    (error: unknown) => isFailure(error, "typescript-compile-error"),
  );
  assert.deepEqual(calls, ["initialize"]);

  const executed = await runtime.execute("const answer: number = 42; return answer;");
  assert.deepEqual(executed, { stdout: bounded(), stderr: bounded(), value: 42 });
  assert.match(calls[1] ?? "", /execute:.*const answer = 42;/s);
  assert.doesNotMatch(calls[1] ?? "", /: number/);
});

test("the TypeScript runtime executes valid typed free and judge submissions through the JavaScript evaluator", async () => {
  const runtime = createTypeScriptRuntime(compiler, { buildId: "feedfacefeedface" });

  const initialized = await runtime.initialize();
  const free = await runtime.execute("const answer: number = 41; return answer + 1;");
  const judged = await runtime.judge(
    "function solution(input: { n: number }): number { return input.n + 1; }",
    [{ index: 0, input: { n: 4 } }],
  );

  assert.equal(initialized.runtimeVersion, ts.version);
  assert.deepEqual(free, { stdout: bounded(), stderr: bounded(), value: 42 });
  assert.deepEqual(judged.cases[0], { index: 0, ok: true, actual: 5, stdout: bounded(), stderr: bounded() });
});

test("official compiler asset failures are fatal and a fresh asset runtime can execute afterward", async () => {
  const missing = createTypeScriptAssetRuntime({
    importScripts: () => { throw new Error("missing compiler asset"); },
  });
  const incompatible = createTypeScriptAssetRuntime({
    importScripts: () => undefined,
  });
  const loadedUrls: string[] = [];
  const fresh = createTypeScriptAssetRuntime({
    importScripts: (url: string) => { loadedUrls.push(url); },
    ts: compiler,
  });

  await assert.rejects(
    missing.initialize(),
    (error: unknown) => isFailure(error, "typescript-asset-missing", true, "infrastructure"),
  );
  await assert.rejects(
    incompatible.initialize(),
    (error: unknown) => isFailure(error, "typescript-api-incompatible", true, "infrastructure"),
  );
  const initialized = await fresh.initialize();
  const result = await fresh.execute("const value: number = 2; return value * 3;");

  assert.deepEqual(loadedUrls, ["./typescript/typescript.js"]);
  assert.equal(initialized.runtimeVersion, ts.version);
  assert.deepEqual(result, { stdout: bounded(), stderr: bounded(), value: 6 });
});

function compilerWith(diagnostics: readonly TypeScriptDiagnosticLike[]): TypeScriptCompilerLike {
  return {
    version: "test-compiler",
    DiagnosticCategory: { Error: 1 },
    ModuleKind: { None: 0 },
    ScriptTarget: { ES2020: 7 },
    transpileModule: () => ({ outputText: "return null;", diagnostics }),
    flattenDiagnosticMessageText: (message: unknown) => String(message),
  };
}

function isFailure(
  error: unknown,
  code: string,
  fatal = false,
  kind: RuntimeFailure["kind"] = "compile",
): boolean {
  if (!(error instanceof RuntimeFailureError)) return false;
  const failure: RuntimeFailure = error.failure;
  return failure.code === code && failure.kind === kind && failure.fatal === fatal;
}

function bounded(text = "") {
  return { text, bytes: new TextEncoder().encode(text).byteLength, truncated: false };
}
