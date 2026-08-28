import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerEndpoint, type WorkerRuntime } from "../../src/workers/shared/endpoint.js";
import { createJavaScriptRuntime } from "../../src/workers/javascript/evaluator.js";
import { type WorkerResponse } from "../../src/runtime/protocol.js";

const envelope = { protocolVersion: 1 as const, requestId: "request-1", runtimeId: "javascript-worker" as const };

function request(data: unknown): MessageEvent<unknown> {
  return { data } as MessageEvent<unknown>;
}

test("worker endpoint strictly parses requests, echoes their envelope, and disposes its runtime", async () => {
  const calls: string[] = [];
  const runtime: WorkerRuntime = {
    initialize: async () => ({ runtimeVersion: "js", buildId: "build", capabilities: { execute: true, judge: true } }),
    execute: async () => ({ stdout: bounded(), stderr: bounded(), value: null }),
    judge: async () => ({ cases: [] }),
    dispose: async () => { calls.push("dispose"); },
  };
  const posted: WorkerResponse[] = [];
  const endpoint = createWorkerEndpoint({ runtimeId: "javascript-worker", runtime, post: (message) => posted.push(message) });

  await endpoint(request({ ...envelope, type: "initialize" }));
  await endpoint(request({ ...envelope, requestId: "request-2", type: "dispose" }));

  assert.deepEqual(calls, ["dispose"]);
  assert.deepEqual(posted, [
    { ...envelope, type: "status", phase: "initializing", message: "Initializing runtime" },
    {
      ...envelope,
      type: "complete",
      operation: "initialize",
      payload: { runtimeVersion: "js", buildId: "build", capabilities: { execute: true, judge: true } },
    },
    { ...envelope, requestId: "request-2", type: "complete", operation: "dispose", payload: { disposed: true } },
  ]);
});

test("worker endpoint drops malformed envelopes and maps unexpected runtime throws to bounded fatal failures", async () => {
  const runtime: WorkerRuntime = {
    initialize: async () => ({ runtimeVersion: "js", buildId: "build", capabilities: { execute: true, judge: true } }),
    execute: async () => { throw new Error("x".repeat(10_000)); },
    judge: async () => ({ cases: [] }),
    dispose: async () => undefined,
  };
  const posted: WorkerResponse[] = [];
  const endpoint = createWorkerEndpoint({ runtimeId: "javascript-worker", runtime, post: (message) => posted.push(message) });

  await endpoint(request({ ...envelope, type: "execute", source: "return null" }));
  await endpoint(request({ protocolVersion: 2, requestId: "bad", runtimeId: "javascript-worker", type: "dispose" }));

  assert.equal(posted.length, 2);
  const failure = posted[1];
  assert.deepEqual(posted[0], { ...envelope, type: "status", phase: "executing", message: "Executing runtime" });
  assert.equal(failure?.type, "failure");
  if (failure?.type !== "failure") throw new Error("expected failure response");
  assert.equal(failure.error.fatal, true);
  assert.equal(failure.error.code, "runtime-endpoint-failure");
  assert.ok(failure.error.message.length < 200);
  assert.doesNotMatch(failure.error.message, /x{100}/);
});

test("JavaScript endpoint maps free execute exceptions and rejections to bounded nonfatal runtime failures", async () => {
  const runtime = createJavaScriptRuntime({ buildId: "feedfacefeedface" });
  const posted: WorkerResponse[] = [];
  const endpoint = createWorkerEndpoint({ runtimeId: "javascript-worker", runtime, post: (message) => posted.push(message) });
  const originalConsole = {
    log: console.log,
    info: console.info,
    debug: console.debug,
    warn: console.warn,
    error: console.error,
  };

  await endpoint(request({
    ...envelope,
    type: "execute",
    source: "console.log('before throw'); console.info('info'); console.debug('debug'); console.warn('warning'); console.error('captured error'); throw new Error('x'.repeat(10000));",
  }));
  await endpoint(request({
    ...envelope,
    requestId: "request-2",
    type: "execute",
    source: "return Promise.reject(new Error('rejected promise'));",
  }));
  await endpoint(request({
    ...envelope,
    requestId: "request-3",
    type: "execute",
    source: "function {",
  }));

  assert.deepEqual({
    log: console.log,
    info: console.info,
    debug: console.debug,
    warn: console.warn,
    error: console.error,
  }, originalConsole);
  assert.deepEqual(posted.map((message) => message.type), ["status", "failure", "status", "failure", "status", "failure"]);

  const thrown = posted[1];
  assert.equal(thrown?.type, "failure");
  if (thrown?.type !== "failure") throw new Error("expected thrown failure response");
  assert.equal(thrown.error.kind, "runtime");
  assert.equal(thrown.error.fatal, false);
  assert.equal(thrown.error.code, "javascript-runtime-error");
  assert.ok(new TextEncoder().encode(thrown.error.details ?? "").byteLength <= 8_192);
  assert.doesNotMatch(thrown.error.details ?? "", /x{8_193}/);

  const rejected = posted[3];
  assert.equal(rejected?.type, "failure");
  if (rejected?.type !== "failure") throw new Error("expected rejected failure response");
  assert.equal(rejected.error.kind, "runtime");
  assert.equal(rejected.error.fatal, false);
  assert.equal(rejected.error.code, "javascript-runtime-error");

  const syntax = posted[5];
  assert.equal(syntax?.type, "failure");
  if (syntax?.type !== "failure") throw new Error("expected syntax failure response");
  assert.equal(syntax.error.kind, "compile");
  assert.equal(syntax.error.fatal, false);
  assert.equal(syntax.error.code, "javascript-compile-error");
});

test("JavaScript runtime reports compile/runtime case failures, awaits promises, and isolates cases", async () => {
  const runtime = createJavaScriptRuntime({ buildId: "feedfacefeedface" });
  const syntax = await runtime.judge("function solution( {", [{ index: 0, input: null }]);
  const thrown = await runtime.judge("function solution() { throw new Error('boom'); }", [{ index: 1, input: null }]);
  const promised = await runtime.judge("async function solution(input) { return input + 1; }", [{ index: 2, input: 4 }]);
  const isolated = await runtime.judge("let count = 0; function solution() { count += 1; return count; }", [
    { index: 3, input: null },
    { index: 4, input: null },
  ]);

  assert.equal(syntax.cases[0]?.ok, false);
  assert.equal(thrown.cases[0]?.ok, false);
  if (syntax.cases[0]?.ok === false) assert.equal(syntax.cases[0].failure.kind, "compile");
  if (thrown.cases[0]?.ok === false) assert.equal(thrown.cases[0].failure.kind, "runtime");
  assert.deepEqual(promised.cases[0], { index: 2, ok: true, actual: 5, stdout: bounded(), stderr: bounded() });
  assert.deepEqual(isolated.cases.map((item) => item.ok ? item.actual : null), [1, 1]);
});

test("JavaScript runtime captures and restores console output and returns canonical free execution values", async () => {
  const runtime = createJavaScriptRuntime({ buildId: "feedfacefeedface" });
  const originalLog = console.log;
  const originalError = console.error;
  const free = await runtime.execute("console.log('hello'); console.error('warning'); return { answer: 42 };");
  const judged = await runtime.judge("function solution() { console.log('case'); console.warn('problem'); return null; }", [{ index: 0, input: null }]);

  assert.equal(console.log, originalLog);
  assert.equal(console.error, originalError);
  assert.deepEqual(free, {
    stdout: bounded("hello\n"),
    stderr: bounded("warning\n"),
    value: { answer: 42 },
  });
  assert.deepEqual(judged.cases[0], {
    index: 0,
    ok: true,
    actual: null,
    stdout: bounded("case\n"),
    stderr: bounded("problem\n"),
  });
});

test("JavaScript runtime applies one combined output budget without splitting Unicode code points", async () => {
  const runtime = createJavaScriptRuntime({ buildId: "feedfacefeedface", outputBytes: 65_536 });
  const payload = await runtime.execute("console.log('a'.repeat(65531)); console.error('😀'); return null;");

  assert.equal(payload.stdout.bytes + payload.stderr.bytes, 65_536);
  assert.equal(payload.stdout.bytes, 65_532);
  assert.equal(payload.stderr.text, "😀");
  assert.equal(payload.stderr.bytes, 4);
  assert.equal(payload.stderr.truncated, true);
  assert.equal(new TextEncoder().encode(payload.stderr.text).byteLength, payload.stderr.bytes);
});

function bounded(text = "") {
  return { text, bytes: new TextEncoder().encode(text).byteLength, truncated: false };
}
