import assert from "node:assert/strict";
import test from "node:test";
import { createHaskellAdapter, type RuntimeAdapter } from "../../src/runtime/adapters/registry.js";
import { runtimeContractCases } from "../../src/runtime/contracts/runtime-contract-cases.js";
import { type RuntimeOperationOptions, type RuntimeSupervisor } from "../../src/runtime/supervisor.js";

const identity = { runtimeVersion: "ghc-wasi-fake", buildId: "0123456789abcdef" };

test("the Haskell adapter preserves identity, indexes canonical inputs, and never compares results", async () => {
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
  const adapter = createHaskellAdapter(supervisor);
  const options: RuntimeOperationOptions = { timeoutMs: 123, signal: new AbortController().signal };
  const source = "solution :: String -> String\nsolution = id";

  assert.equal(adapter.runtimeId, "haskell-ghc-wasi");
  assert.equal(adapter.languageId, "haskell");
  assert.equal(await adapter.execute(source, options), executeInvocation);
  assert.equal(await adapter.judge(source, [{ text: "雪" }, [true], null], options), judgeInvocation);
  assert.deepEqual(calls, [
    ["execute", "haskell-ghc-wasi", source, options],
    ["judge", "haskell-ghc-wasi", source, [
      { index: 0, input: { text: "雪" } },
      { index: 1, input: [true] },
      { index: 2, input: null },
    ], options],
  ]);
  assert.doesNotMatch(JSON.stringify(calls), /expected|passed|verdict|comparer/i);
});

test("the Haskell adapter rejects non-canonical inputs without changing its runtime identity", () => {
  const adapter: RuntimeAdapter = createHaskellAdapter({
    execute: async () => ({ identity, payload: { stdout: bounded(), stderr: bounded(), value: null } }),
    judge: async () => ({ identity, payload: { cases: [] } }),
  } as unknown as RuntimeSupervisor);

  assert.equal(adapter.runtimeId, "haskell-ghc-wasi");
  assert.throws(() => adapter.judge("solution = id", [Number.NaN] as never), /canonical JSON/i);
});

test("the Haskell optional-runtime contract runs a real main smoke and JSON-string identity cases", () => {
  const contract = runtimeContractCases("haskell-ghc-wasi");

  assert.match(contract.smokeSource, /main :: IO \(\)/);
  assert.match(contract.judgeSource, /solution :: String -> String/);
  assert.deepEqual(contract.judgeCases, [
    { input: null, expected: null },
    { input: { greeting: "こんにちは", nested: [true, { café: null }] }, expected: { greeting: "こんにちは", nested: [true, { café: null }] } },
  ]);
});

function bounded(text = "") {
  return { text, bytes: new TextEncoder().encode(text).byteLength, truncated: false };
}
