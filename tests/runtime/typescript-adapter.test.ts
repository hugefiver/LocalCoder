import assert from "node:assert/strict";
import test from "node:test";
import {
  createTypescriptAdapter,
  type RuntimeAdapter,
  RuntimeAdapterRegistry,
} from "../../src/runtime/adapters/registry.js";
import { type RuntimeOperationOptions, type RuntimeSupervisor } from "../../src/runtime/supervisor.js";

const identity = { runtimeVersion: "5.9.3", buildId: "0123456789abcdef" };

test("the TypeScript adapter preserves the TypeScript language while routing to the official runtime", async () => {
  const calls: unknown[][] = [];
  const executeInvocation = { identity, payload: { stdout: bounded(), stderr: bounded(), value: 42 } };
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
  const adapter = createTypescriptAdapter(supervisor);
  const options: RuntimeOperationOptions = { timeoutMs: 123, signal: new AbortController().signal };
  const source = "function solution(input: { n: number }): number { return input.n + 1; }";

  assert.equal(adapter.runtimeId, "typescript-official");
  assert.equal(adapter.languageId, "typescript");
  assert.equal(await adapter.execute(source, options), executeInvocation);
  assert.equal(await adapter.judge(source, [{ n: 1 }], options), judgeInvocation);
  assert.deepEqual(calls, [
    ["execute", "typescript-official", source, options],
    ["judge", "typescript-official", source, [{ index: 0, input: { n: 1 } }], options],
  ]);
  assert.doesNotMatch(JSON.stringify(calls), /expected|passed|verdict|comparer/i);
});

test("the adapter registry exposes the official TypeScript adapter without changing JavaScript identity", () => {
  const adapter: RuntimeAdapter = {
    runtimeId: "typescript-official",
    languageId: "typescript",
    execute: async () => ({ identity, payload: { stdout: bounded(), stderr: bounded(), value: null } }),
    judge: async () => ({ identity, payload: { cases: [] } }),
  };
  const registry = new RuntimeAdapterRegistry();

  registry.register(adapter);

  assert.equal(registry.get("typescript-official"), adapter);
});

function bounded(text = "") {
  return { text, bytes: new TextEncoder().encode(text).byteLength, truncated: false };
}
