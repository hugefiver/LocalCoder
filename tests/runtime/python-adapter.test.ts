import assert from "node:assert/strict";
import test from "node:test";
import { createPythonAdapter, type RuntimeAdapter } from "../../src/runtime/adapters/registry.js";
import { type RuntimeOperationOptions, type RuntimeSupervisor } from "../../src/runtime/supervisor.js";

const identity = { runtimeVersion: "0.29.1", buildId: "0123456789abcdef" };

test("the Python adapter preserves its identity, canonicalizes inputs, and never judges", async () => {
  const calls: unknown[][] = [];
  const executeInvocation = { identity, payload: { stdout: bounded(), stderr: bounded(), value: null } };
  const judgeInvocation = { identity, payload: { cases: [] } };
  const supervisor = {
    execute: (...args: unknown[]) => {
      calls.push(["execute", ...args]);
      return Promise.resolve(executeInvocation);
    },
    judge: (...args: unknown[]) => {
      calls.push(["judge", ...args]);
      return Promise.resolve(judgeInvocation);
    },
  } as unknown as RuntimeSupervisor;
  const adapter = createPythonAdapter(supervisor, "python-pyodide");
  const options: RuntimeOperationOptions = { timeoutMs: 123, signal: new AbortController().signal };
  const source = "def solution(input):\n    return input";

  assert.equal(adapter.runtimeId, "python-pyodide");
  assert.equal(adapter.languageId, "python");
  assert.equal(await adapter.execute(source, options), executeInvocation);
  assert.equal(await adapter.judge(source, [{ n: 1 }, [true], null], options), judgeInvocation);
  assert.deepEqual(calls, [
    ["execute", "python-pyodide", source, options],
    ["judge", "python-pyodide", source, [
      { index: 0, input: { n: 1 } },
      { index: 1, input: [true] },
      { index: 2, input: null },
    ], options],
  ]);
  assert.doesNotMatch(JSON.stringify(calls), /expected|passed|verdict|comparer/i);
});

test("the Python adapter rejects non-canonical inputs without changing its runtime identity", () => {
  const adapter: RuntimeAdapter = createPythonAdapter({
    execute: async () => ({ identity, payload: { stdout: bounded(), stderr: bounded(), value: null } }),
    judge: async () => ({ identity, payload: { cases: [] } }),
  } as unknown as RuntimeSupervisor, "python-pyodide");

  assert.equal(adapter.runtimeId, "python-pyodide");
  assert.throws(
    () => adapter.judge("def solution(input): return input", [Number.NaN] as never),
    /canonical JSON/i,
  );
});

function bounded(text = "") {
  return { text, bytes: new TextEncoder().encode(text).byteLength, truncated: false };
}
