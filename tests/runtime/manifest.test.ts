import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CASE_COUNT,
  MAX_OUTPUT_BYTES,
  MAX_SOURCE_BYTES,
  MAX_TIMEOUT_MS,
  parseRuntimeManifest,
} from "../../src/runtime/manifest.js";

function runtime(
  runtimeId: string,
  languageId: string,
  required: boolean,
  packaged = true,
) {
  return {
    runtimeId,
    languageId,
    protocolVersion: 1,
    runtimeVersion: "1.0.0",
    worker: { url: `workers/${runtimeId}.js`, type: "module" },
    assets: [{ url: `assets/${runtimeId}.wasm`, bytes: 1 }],
    required,
    packaged,
    ...(packaged ? {} : { unavailableReason: "not included in this build" }),
    reuse: "per-submission",
    capabilities: { execute: packaged, judge: packaged },
    timeouts: { initializeMs: 1_000, executeMs: 5_000 },
    limits: { sourceBytes: MAX_SOURCE_BYTES, caseCount: MAX_CASE_COUNT, outputBytes: MAX_OUTPUT_BYTES },
  };
}

function validManifest() {
  return {
    schemaVersion: 1,
    runtimes: [
      runtime("javascript-worker", "javascript", true),
      runtime("typescript-official", "typescript", true),
      runtime("python-pyodide", "python", true),
      runtime("python-rustpython", "python", false, false),
      runtime("racket-wasm", "racket", false, false),
      runtime("haskell-ghc-wasi", "haskell", false, false),
    ],
  };
}

test("runtime manifest accepts exact runtime IDs, limits, and capabilities", () => {
  const parsed = parseRuntimeManifest(validManifest());

  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.runtimes[0]?.runtimeId, "javascript-worker");
  assert.deepEqual(parsed.runtimes[0]?.capabilities, { execute: true, judge: true });
  assert.equal(parsed.runtimes[3]?.packaged, false);
  assert.equal(parsed.runtimes[3]?.unavailableReason, "not included in this build");
});

test("runtime manifest rejects duplicate IDs, mapping mismatches, and wrong versions", () => {
  const duplicate = validManifest();
  duplicate.runtimes[1]!.runtimeId = "javascript-worker";
  duplicate.runtimes[1]!.languageId = "javascript";
  assert.throws(() => parseRuntimeManifest(duplicate), /javascript-worker.*duplicate runtime id/);

  const mismatch = validManifest();
  mismatch.runtimes[3]!.languageId = "racket";
  assert.throws(() => parseRuntimeManifest(mismatch), /python-rustpython.*languageId/);

  const protocolVersion = validManifest();
  protocolVersion.runtimes[0]!.protocolVersion = 2;
  assert.throws(() => parseRuntimeManifest(protocolVersion), /javascript-worker.*protocolVersion/);

  const schemaVersion = validManifest();
  schemaVersion.schemaVersion = 2;
  assert.throws(() => parseRuntimeManifest(schemaVersion), /schemaVersion/);
});

test("runtime manifest rejects unsafe assets, unavailable state, and over-limit settings", () => {
  const negativeAsset = validManifest();
  negativeAsset.runtimes[0]!.assets[0]!.bytes = -1;
  assert.throws(() => parseRuntimeManifest(negativeAsset), /javascript-worker.*assets\[0\]\.bytes/);

  const emptyReason = validManifest();
  emptyReason.runtimes[3]!.unavailableReason = "   ";
  assert.throws(() => parseRuntimeManifest(emptyReason), /python-rustpython.*unavailableReason/);

  const invalidWorkerUrl = validManifest();
  invalidWorkerUrl.runtimes[0]!.worker.url = "https://attacker.example/worker.js";
  assert.throws(() => parseRuntimeManifest(invalidWorkerUrl), /javascript-worker.*worker\.url/);

  const absoluteWorkerUrl = validManifest();
  absoluteWorkerUrl.runtimes[0]!.worker.url = "/workers/javascript-worker.js";
  assert.throws(() => parseRuntimeManifest(absoluteWorkerUrl), /javascript-worker.*worker\.url/);

  const traversalAssetUrl = validManifest();
  traversalAssetUrl.runtimes[0]!.assets[0]!.url = "../secret.wasm";
  assert.throws(() => parseRuntimeManifest(traversalAssetUrl), /javascript-worker.*assets\[0\]\.url/);

  const aboveSourceLimit = validManifest();
  aboveSourceLimit.runtimes[0]!.limits.sourceBytes = MAX_SOURCE_BYTES + 1;
  assert.throws(() => parseRuntimeManifest(aboveSourceLimit), /javascript-worker.*sourceBytes/);

  const aboveCaseLimit = validManifest();
  aboveCaseLimit.runtimes[0]!.limits.caseCount = MAX_CASE_COUNT + 1;
  assert.throws(() => parseRuntimeManifest(aboveCaseLimit), /javascript-worker.*caseCount/);

  const aboveOutputLimit = validManifest();
  aboveOutputLimit.runtimes[0]!.limits.outputBytes = MAX_OUTPUT_BYTES + 1;
  assert.throws(() => parseRuntimeManifest(aboveOutputLimit), /javascript-worker.*outputBytes/);

  const aboveTimeoutLimit = validManifest();
  aboveTimeoutLimit.runtimes[0]!.timeouts.executeMs = MAX_TIMEOUT_MS + 1;
  assert.throws(() => parseRuntimeManifest(aboveTimeoutLimit), /javascript-worker.*executeMs/);
});

test("runtime manifest keeps unavailable runtimes unavailable and diagnoses hostile data without echoing it", () => {
  const unreadyCapabilities = validManifest();
  unreadyCapabilities.runtimes[3]!.capabilities.execute = true;
  assert.throws(() => parseRuntimeManifest(unreadyCapabilities), /python-rustpython.*capabilities/);

  const hostile = validManifest() as Record<string, unknown>;
  hostile["x".repeat(20_000)] = true;
  assert.throws(
    () => parseRuntimeManifest(hostile),
    (error: unknown) => {
      assert.ok(error instanceof TypeError);
      assert.ok(error.message.length < 300);
      assert.doesNotMatch(error.message, /x{100}/);
      return true;
    },
  );
});
