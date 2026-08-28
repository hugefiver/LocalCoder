import assert from "node:assert/strict";
import test from "node:test";
import { createRacketAdapter, type RuntimeAdapter } from "../../src/runtime/adapters/registry.js";
import { type RuntimeOperationOptions, type RuntimeSupervisor } from "../../src/runtime/supervisor.js";

const identity = { runtimeVersion: "racket-fake", buildId: "0123456789abcdef" };

test("the Racket adapter preserves identity, canonicalizes inputs, and never compares results", async () => {
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
  const adapter = createRacketAdapter(supervisor);
  const options: RuntimeOperationOptions = { timeoutMs: 123, signal: new AbortController().signal };
  const source = "#lang racket\n(define (solution input) input)";

  assert.equal(adapter.runtimeId, "racket-wasm");
  assert.equal(adapter.languageId, "racket");
  assert.equal(await adapter.execute(source, options), executeInvocation);
  assert.equal(await adapter.judge(source, [{ n: 1 }, [true], null], options), judgeInvocation);
  assert.deepEqual(calls, [
    ["execute", "racket-wasm", source, options],
    ["judge", "racket-wasm", source, [
      { index: 0, input: { n: 1 } },
      { index: 1, input: [true] },
      { index: 2, input: null },
    ], options],
  ]);
  assert.doesNotMatch(JSON.stringify(calls), /expected|passed|verdict|comparer/i);
});

test("the Racket adapter rejects non-canonical inputs without changing its runtime identity", () => {
  const adapter: RuntimeAdapter = createRacketAdapter({
    execute: async () => ({ identity, payload: { stdout: bounded(), stderr: bounded(), value: null } }),
    judge: async () => ({ identity, payload: { cases: [] } }),
  } as unknown as RuntimeSupervisor);

  assert.equal(adapter.runtimeId, "racket-wasm");
  assert.throws(
    () => adapter.judge("#lang racket", [Number.NaN] as never),
    /canonical JSON/i,
  );
});

function bounded(text = "") {
  return { text, bytes: new TextEncoder().encode(text).byteLength, truncated: false };
}
