import assert from "node:assert/strict";
import test from "node:test";
import { type RuntimeManifestDocument, parseRuntimeManifest } from "../../src/runtime/manifest.js";
import { RuntimeRegistry, type RuntimeCapability } from "../../src/runtime/registry.js";

function runtime(
  runtimeId: string,
  languageId: string,
  required: boolean,
  packaged = true,
): object {
  return {
    runtimeId,
    languageId,
    protocolVersion: 1,
    runtimeVersion: "1.0.0",
    worker: { url: `workers/${runtimeId}.js`, type: "module" },
    assets: [{ url: `assets/${runtimeId}.wasm`, bytes: 1 }],
    required,
    packaged,
    ...(packaged ? {} : { unavailableReason: "runner.wasm is not included in this build" }),
    reuse: "per-submission",
    capabilities: { execute: packaged, judge: packaged },
    timeouts: { initializeMs: 1_000, executeMs: 5_000 },
    limits: { sourceBytes: 1_000, caseCount: 10, outputBytes: 1_000 },
  };
}

function manifestWithMissingOptionals(): RuntimeManifestDocument {
  return parseRuntimeManifest({
    schemaVersion: 1,
    runtimes: [
      runtime("javascript-worker", "javascript", true),
      runtime("typescript-official", "typescript", true),
      runtime("python-pyodide", "python", true),
      runtime("python-rustpython", "python", false, false),
      runtime("racket-wasm", "racket", false, false),
      runtime("haskell-ghc-wasi", "haskell", false, false),
    ],
  });
}

test("derives required and unavailable optional runtime states from the manifest", () => {
  const registry = RuntimeRegistry.fromManifest(manifestWithMissingOptionals());
  const rustPython = registry.get("python-rustpython");

  assert.equal(registry.get("javascript-worker").state.kind, "loadable");
  assert.equal(registry.get("javascript-worker").verification, "not-required");
  assert.equal(rustPython.state.kind, "not-packaged");
  assert.equal(rustPython.verification, "unverified");
  if (rustPython.state.kind !== "not-packaged") throw new Error("expected unavailable RustPython");
  assert.match(rustPython.state.reason, /runner\.wasm/);
  assert.deepEqual(
    registry.forLanguage("python").map(({ runtimeId }) => runtimeId),
    ["python-pyodide", "python-rustpython"],
  );
  assert.deepEqual(
    registry.forLanguage("python", "judge").map(({ runtimeId }) => runtimeId),
    ["python-pyodide"],
  );
  assert.equal(registry.resolveDefault("python", "judge")?.runtimeId, "python-pyodide");
  for (const next of [
    { kind: "initializing" },
    { kind: "ready" },
    { kind: "running", requestId: "request-1" },
  ] as const) {
    assert.throws(() => registry.transition("racket-wasm", next), /not packaged/);
  }
});

test("uses only manifest entries and stable manifest order", () => {
  const manifest = parseRuntimeManifest({
    schemaVersion: 1,
    runtimes: [
      runtime("python-rustpython", "python", false, false),
      runtime("python-pyodide", "python", true),
    ],
  });
  const registry = RuntimeRegistry.fromManifest(manifest);

  assert.deepEqual(registry.list().map(({ runtimeId }) => runtimeId), ["python-rustpython", "python-pyodide"]);
  assert.deepEqual(registry.forLanguage("javascript"), []);
  assert.equal(registry.get("python-pyodide").runtimeId, "python-pyodide");
  assert.equal(registry.resolveDefault("python", "execute")?.runtimeId, "python-pyodide");
});

test("enforces lifecycle transitions, retry, and protocol incompatibility", () => {
  const registry = RuntimeRegistry.fromManifest(manifestWithMissingOptionals());
  const initial = registry.get("javascript-worker");
  const initializing = { kind: "initializing" as const, message: "loading runtime" };

  registry.transition("javascript-worker", initializing);
  initializing.message = "mutated after transition";
  const initializingSnapshot = registry.get("javascript-worker");
  assert.notEqual(initializingSnapshot, initial);
  assert.ok(Object.isFrozen(initializingSnapshot));
  assert.deepEqual(initializingSnapshot.state, { kind: "initializing", message: "loading runtime" });
  registry.transition("javascript-worker", { kind: "ready" });
  registry.transition("javascript-worker", { kind: "running", requestId: "request-1" });
  registry.transition("javascript-worker", { kind: "ready" });
  registry.transition("javascript-worker", { kind: "failed", code: "RUNTIME_ERROR", message: "boom" });
  registry.transition("javascript-worker", { kind: "loadable" });
  registry.transition("javascript-worker", { kind: "incompatible", expected: 1, received: 2 });

  assert.equal(registry.get("javascript-worker").state.kind, "incompatible");
  assert.throws(() => registry.transition("javascript-worker", { kind: "ready" }), /javascript-worker.*incompatible.*ready/);
  assert.throws(
    () => registry.transition("javascript-worker", { kind: "incompatible", expected: 1, received: 1 }),
    /received/,
  );
  assert.throws(
    () => registry.transition("typescript-official", { kind: "running", requestId: " " }),
    /requestId/,
  );
  assert.throws(
    () => registry.transition("typescript-official", { kind: "running", requestId: "x".repeat(257) }),
    /requestId/,
  );
  assert.throws(
    () => registry.transition("typescript-official", { kind: "initializing", message: " " }),
    /message/,
  );
  assert.throws(
    () => registry.transition("typescript-official", { kind: "failed", code: " ", message: "boom" }),
    /code/,
  );
  assert.throws(
    () => registry.transition("typescript-official", { kind: "failed", code: "x".repeat(129), message: "boom" }),
    /code/,
  );
  assert.throws(
    () => registry.transition("typescript-official", { kind: "failed", code: "RUNTIME", message: " " }),
    /message/,
  );
  assert.throws(
    () => registry.transition("typescript-official", {
      kind: "failed",
      code: "RUNTIME",
      message: "x".repeat(4_097),
    }),
    /message/,
  );
});

test("returns deeply frozen snapshots without exposing registry state", () => {
  const document = manifestWithMissingOptionals();
  const registry = RuntimeRegistry.fromManifest(document);
  const capability = registry.get("javascript-worker");
  const list = registry.list();
  const languageEntries = registry.forLanguage("javascript");

  assert.ok(Object.isFrozen(capability));
  assert.ok(Object.isFrozen(list));
  assert.ok(Object.isFrozen(languageEntries));
  assert.ok(Object.isFrozen(capability.worker));
  assert.ok(Object.isFrozen(capability.assets));
  assert.ok(Object.isFrozen(capability.assets[0]!));
  assert.ok(Object.isFrozen(capability.capabilities));
  assert.ok(Object.isFrozen(capability.timeouts));
  assert.ok(Object.isFrozen(capability.limits));
  assert.ok(Object.isFrozen(capability.state));
  assert.throws(() => {
    capability.worker.url = "workers/mutated.js";
  });
  assert.throws(() => {
    capability.assets[0]!.bytes = 9;
  });
  assert.throws(() => {
    capability.capabilities.execute = false;
  });
  assert.throws(() => {
    capability.timeouts.initializeMs = 9;
  });
  assert.throws(() => {
    capability.limits.sourceBytes = 9;
  });
  assert.throws(() => {
    (capability as unknown as { state: unknown }).state = { kind: "failed", code: "MUTATED", message: "no" };
  });
  assert.throws(() => {
    (list as RuntimeCapability[]).push(capability);
  });
  document.runtimes[0]!.worker.url = "workers/mutated-source.js";
  document.runtimes[0]!.assets[0]!.bytes = 9;
  document.runtimes[0]!.capabilities.execute = false;
  document.runtimes[0]!.timeouts.initializeMs = 9;
  document.runtimes[0]!.limits.sourceBytes = 9;
  assert.equal(registry.get("javascript-worker").worker.url, "workers/javascript-worker.js");
  assert.equal(registry.get("javascript-worker").assets[0]?.bytes, 1);
  assert.equal(registry.get("javascript-worker").capabilities.execute, true);
  assert.equal(registry.get("javascript-worker").timeouts.initializeMs, 1_000);
  assert.equal(registry.get("javascript-worker").limits.sourceBytes, 1_000);
  assert.equal(registry.get("javascript-worker").state.kind, "loadable");
});

test("notifies subscribers immediately and once per real immutable state change", () => {
  const registry = RuntimeRegistry.fromManifest(manifestWithMissingOptionals());
  const received: string[] = [];
  const throwingListener = () => {
    throw new Error("listener failure");
  };
  const unsubscribeThrowing = registry.subscribe(throwingListener);
  const unsubscribe = registry.subscribe((snapshot) => {
    received.push(snapshot.find(({ runtimeId }) => runtimeId === "javascript-worker")!.state.kind);
    assert.ok(Object.isFrozen(snapshot));
  });

  registry.transition("javascript-worker", { kind: "loadable" });
  registry.transition("javascript-worker", { kind: "initializing" });
  registry.transition("javascript-worker", { kind: "initializing" });
  unsubscribe();
  registry.transition("javascript-worker", { kind: "ready" });
  unsubscribeThrowing();

  assert.deepEqual(received, ["loadable", "initializing"]);
});
