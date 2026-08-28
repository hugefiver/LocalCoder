import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeAdapter } from "../../src/runtime/adapters/types.js";
import { RuntimeAdapterRegistry } from "../../src/runtime/adapters/registry.js";
import { canAttemptExecute } from "../../src/features/executor/executor-model.js";
import { canAttemptJudge } from "../../src/features/problems/workspace-model.js";
import { resolveJudgeRuntime } from "../../src/oj/judge-validation.js";
import { parseRuntimeManifest } from "../../src/runtime/manifest.js";
import { RuntimeRegistry } from "../../src/runtime/registry.js";

function registry(): RuntimeRegistry {
  return RuntimeRegistry.fromManifest(parseRuntimeManifest({
    schemaVersion: 1,
    runtimes: [{
      runtimeId: "racket-wasm",
      languageId: "racket",
      protocolVersion: 1,
      runtimeVersion: "test",
      worker: { url: "workers/racket.js", type: "module" },
      assets: [],
      required: false,
      packaged: true,
      reuse: "session",
      capabilities: { execute: true, judge: true },
      timeouts: { initializeMs: 1_000, executeMs: 1_000 },
      limits: { sourceBytes: 1_024, caseCount: 10, outputBytes: 1_024 },
    }],
  }));
}

const adapter: RuntimeAdapter = {
  runtimeId: "racket-wasm",
  languageId: "racket",
  execute: async () => {
    throw new Error("not used");
  },
  judge: async () => {
    throw new Error("not used");
  },
};

test("OJ rejects unverified optional judges but permits verified failed runtimes to recover", () => {
  const runtimes = registry();
  const adapters = new RuntimeAdapterRegistry();
  adapters.register(adapter);

  assert.deepEqual(resolveJudgeRuntime(runtimes, adapters, "racket-wasm"), { available: false });
  assert.equal(canAttemptExecute(runtimes.get("racket-wasm")), false);
  assert.equal(canAttemptJudge(runtimes.get("racket-wasm")), false);

  runtimes.transition("racket-wasm", { kind: "initializing" });
  runtimes.transition("racket-wasm", { kind: "verifying" });
  runtimes.completeOptionalVerification("racket-wasm");
  assert.equal(resolveJudgeRuntime(runtimes, adapters, "racket-wasm").available, true);

  runtimes.transition("racket-wasm", { kind: "failed", code: "worker-error", message: "Worker exited" });
  assert.equal(resolveJudgeRuntime(runtimes, adapters, "racket-wasm").available, true);
  assert.equal(canAttemptExecute(runtimes.get("racket-wasm")), true);
  assert.equal(canAttemptJudge(runtimes.get("racket-wasm")), true);
});
