import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeAdapterRegistry, createJavascriptAdapter, type RuntimeAdapter } from "../../src/runtime/adapters/registry.js";
import { type RuntimeOperationOptions, type RuntimeSupervisor } from "../../src/runtime/supervisor.js";

const identity = { runtimeVersion: "javascript-es2020", buildId: "0123456789abcdef" };

test("the JavaScript adapter numbers canonical inputs in order and forwards options without judging", async () => {
  const calls: unknown[][] = [];
  const invocation = {
    identity,
    payload: {
      cases: [],
    },
  };
  const supervisor = {
    execute: (...args: unknown[]) => {
      calls.push(["execute", ...args]);
      return Promise.resolve({ identity, payload: { stdout: bounded(), stderr: bounded(), value: null } });
    },
    judge: (...args: unknown[]) => {
      calls.push(["judge", ...args]);
      return Promise.resolve(invocation);
    },
  } as unknown as RuntimeSupervisor;
  const adapter = createJavascriptAdapter(supervisor);
  const options: RuntimeOperationOptions = { timeoutMs: 123, signal: new AbortController().signal };

  const result = await adapter.judge("function solution(input) { return input; }", [{ a: 1 }, [true], null], options);

  assert.equal(result, invocation);
  assert.deepEqual(calls, [[
    "judge",
    "javascript-worker",
    "function solution(input) { return input; }",
    [
      { index: 0, input: { a: 1 } },
      { index: 1, input: [true] },
      { index: 2, input: null },
    ],
    options,
  ]]);
  assert.doesNotMatch(JSON.stringify(calls), /expected|passed|verdict|comparer/i);
});

test("the JavaScript adapter validates canonical inputs and preserves execution identity", async () => {
  const executeInvocation = { identity, payload: { stdout: bounded(), stderr: bounded(), value: { answer: 42 } } };
  const supervisor = {
    execute: () => Promise.resolve(executeInvocation),
    judge: () => Promise.resolve({ identity, payload: { cases: [] } }),
  } as unknown as RuntimeSupervisor;
  const adapter = createJavascriptAdapter(supervisor);

  assert.equal(await adapter.execute("return { answer: 42 }"), executeInvocation);
  assert.throws(
    () => adapter.judge("function solution() {}", [Number.NaN] as never),
    /canonical JSON/i,
  );
});

test("the adapter registry rejects duplicate registrations and unknown runtime lookups", () => {
  const registry = new RuntimeAdapterRegistry();
  const adapter: RuntimeAdapter = {
    runtimeId: "javascript-worker",
    languageId: "javascript",
    execute: async () => ({ identity, payload: { stdout: bounded(), stderr: bounded(), value: null } }),
    judge: async () => ({ identity, payload: { cases: [] } }),
  };

  registry.register(adapter);
  assert.equal(registry.get("javascript-worker"), adapter);
  assert.throws(() => registry.register(adapter), /already registered/i);
  assert.throws(() => registry.get("python-pyodide"), /does not contain/i);
});

function bounded(text = "") {
  return { text, bytes: new TextEncoder().encode(text).byteLength, truncated: false };
}
