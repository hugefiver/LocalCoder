import assert from "node:assert/strict";
import test from "node:test";
import { createPythonAdapter, createRacketAdapter, createRustPythonAdapter, RuntimeAdapterRegistry } from "../../src/runtime/adapters/registry.js";
import { OptionalRuntimeVerifier } from "../../src/runtime/optional-verification.js";
import { PYTHON_CORPUS_SOURCES, type PythonCorpusFixture } from "../../src/runtime/python-parity.js";
import { parseRuntimeManifest } from "../../src/runtime/manifest.js";
import { type JudgeCaseRequest } from "../../src/runtime/protocol.js";
import { RuntimeRegistry } from "../../src/runtime/registry.js";
import { type RuntimeSupervisor } from "../../src/runtime/supervisor.js";
import { type RuntimeAdapter } from "../../src/runtime/adapters/types.js";
import { RuntimeSupervisor as Supervisor } from "../../src/runtime/supervisor.js";
import { FakeWorker, FakeWorkerFactory } from "../helpers/fake-worker.js";
import { ManualClock } from "../helpers/manual-clock.js";

function manifest(racketPackaged: boolean) {
  const entry = (runtimeId: string, languageId: string, required: boolean, packaged = true): Record<string, unknown> => ({
    runtimeId,
    languageId,
    protocolVersion: 1,
    runtimeVersion: "fixture-version",
    worker: { url: `workers/${runtimeId}.js`, type: "classic" },
    assets: [],
    required,
    packaged,
    ...(packaged ? {} : { unavailableReason: "Missing asset groups: racket/racket.js; one of racket/racket.wasm.gz or racket/racket.wasm" }),
    reuse: "session",
    capabilities: { execute: packaged, judge: packaged },
    timeouts: { initializeMs: 1_000, executeMs: 5_000 },
    limits: { sourceBytes: 262_144, caseCount: 100, outputBytes: 65_536 },
  });
  return parseRuntimeManifest({
    schemaVersion: 1,
    runtimes: [
      entry("javascript-worker", "javascript", true),
      entry("typescript-official", "typescript", true),
      entry("python-pyodide", "python", true),
      entry("python-rustpython", "python", false, false),
      entry("racket-wasm", "racket", false, racketPackaged),
      entry("haskell-ghc-wasi", "haskell", false, false),
    ],
  });
}

test("an optional runtime with missing assets is UNAVAILABLE without initializing or enabling its registry entry", async () => {
  const registry = RuntimeRegistry.fromManifest(manifest(false));
  const adapters = new RuntimeAdapterRegistry();
  const supervisor = verificationSupervisor(registry, {
    initialize: async () => assert.fail("missing assets must not initialize"),
  }) as unknown as RuntimeSupervisor;
  adapters.register(createRacketAdapter(supervisor));

  const verification = await new OptionalRuntimeVerifier({ registry, supervisor, adapters }).verify("racket-wasm");

  assert.deepEqual(verification, {
    state: "unavailable",
    runtimeId: "racket-wasm",
    reason: "Missing asset groups: racket/racket.js; one of racket/racket.wasm.gz or racket/racket.wasm",
  });
  assert.equal(registry.get("racket-wasm").state.kind, "not-packaged");
});

test("a packaged optional runtime verifies assets, handshake, free smoke, then judge actual values", async () => {
  const registry = RuntimeRegistry.fromManifest(manifest(true));
  const calls: string[] = [];
  const supervisor = verificationSupervisor(registry, {
    initialize: async () => {
      calls.push("handshake");
      registry.transition("racket-wasm", { kind: "initializing" });
      registry.transition("racket-wasm", { kind: "verifying" });
      return { runtimeVersion: "racket-fake", buildId: "build-id", capabilities: { execute: true, judge: true } };
    },
    execute: async () => {
      calls.push("smoke");
      return { identity: { runtimeVersion: "racket-fake", buildId: "build-id" }, payload: { stdout: bounded(), stderr: bounded(), value: null } };
    },
    judge: async (_runtimeId: string, _source: string, cases: readonly { readonly index: number; readonly input: unknown }[]) => {
      calls.push("judge-contract");
      return {
        identity: { runtimeVersion: "racket-fake", buildId: "build-id" },
        payload: { cases: cases.map((testCase) => ({ index: testCase.index, ok: true as const, actual: testCase.input, stdout: bounded(), stderr: bounded() })) },
      };
    },
  }) as unknown as RuntimeSupervisor;
  const adapters = new RuntimeAdapterRegistry();
  adapters.register(createRacketAdapter(supervisor));

  const verification = await new OptionalRuntimeVerifier({ registry, supervisor, adapters }).verify("racket-wasm");

  assert.deepEqual(calls, ["handshake", "smoke", "judge-contract"]);
  assert.equal(verification.state, "verified");
  if (verification.state === "verified") {
    assert.deepEqual(verification.checks, ["assets", "handshake", "smoke", "judge-contract"]);
    assert.equal(verification.runtimeVersion, "racket-fake");
  }
  assert.equal(registry.get("racket-wasm").state.kind, "ready");
  assert.equal(registry.get("racket-wasm").verification, "verified");
});

test("a packaged optional runtime rejects direct operations before verification without creating a Worker", async () => {
  const registry = RuntimeRegistry.fromManifest(manifest(true));
  const factory = new FakeWorkerFactory();
  const supervisor = new Supervisor({ registry, workerFactory: factory.create, clock: new ManualClock() });
  const adapters = new RuntimeAdapterRegistry();
  adapters.register(createRacketAdapter(supervisor));

  assert.equal(registry.get("racket-wasm").verification, "unverified");

  const initialization = supervisor.initialize("racket-wasm");
  assert.equal(factory.workers.length, 0);
  await assert.rejects(initialization, /verification/i);
  await assert.rejects(supervisor.execute("racket-wasm", "(display 1)"), /verification/i);
  await assert.rejects(supervisor.judge("racket-wasm", "(define (solution input) input)", []), /verification/i);
  await assert.rejects(adapters.get("racket-wasm").execute("(display 1)"), /verification/i);
  await assert.rejects(adapters.get("racket-wasm").judge("(define (solution input) input)", []), /verification/i);
  assert.equal(factory.workers.length, 0);
});

test("a closed verification session cannot authorize a retained options object", async () => {
  const registry = RuntimeRegistry.fromManifest(manifest(true));
  const factory = new FakeWorkerFactory();
  const supervisor = new Supervisor({ registry, workerFactory: factory.create, clock: new ManualClock() });
  const session = supervisor.beginOptionalVerification("racket-wasm");
  const options = session.operationOptions();

  session.close();

  await assert.rejects(supervisor.initialize("racket-wasm", undefined, options), /verification/i);
  assert.throws(() => session.operationOptions(), /closed/i);
  assert.equal(factory.workers.length, 0);
});

test("a real supervisor keeps an optional runtime verifying and unselectable until the judge contract completes", async () => {
  const registry = RuntimeRegistry.fromManifest(manifest(true));
  const factory = new FakeWorkerFactory();
  const supervisor = new Supervisor({ registry, workerFactory: factory.create, clock: new ManualClock() });
  const adapters = new RuntimeAdapterRegistry();
  adapters.register(createRacketAdapter(supervisor));
  const verification = new OptionalRuntimeVerifier({ registry, supervisor, adapters }).verify("racket-wasm");
  const worker = factory.workers[0];
  if (worker === undefined) throw new Error("expected worker");

  completeInitialize(worker);
  assert.equal(registry.get("racket-wasm").state.kind, "verifying");
  await flush();
  completeExecute(worker);
  assert.equal(registry.get("racket-wasm").state.kind, "verifying");
  await flush();
  completeJudge(worker);

  assert.equal((await verification).state, "verified");
  assert.equal(registry.get("racket-wasm").state.kind, "ready");
  assert.equal(registry.get("racket-wasm").verification, "verified");
});

test("a failed optional verification releases its Worker and a single later verify uses a fresh generation", async () => {
  const registry = RuntimeRegistry.fromManifest(manifest(true));
  const factory = new FakeWorkerFactory();
  const supervisor = new Supervisor({ registry, workerFactory: factory.create, clock: new ManualClock() });
  const adapters = new RuntimeAdapterRegistry();
  adapters.register(createRacketAdapter(supervisor));
  const verifier = new OptionalRuntimeVerifier({ registry, supervisor, adapters });
  const firstVerification = verifier.verify("racket-wasm");
  const firstWorker = factory.workers[0];
  if (firstWorker === undefined) throw new Error("expected first verification worker");

  completeInitialize(firstWorker);
  await flush();
  completeSmokeFailure(firstWorker);

  const firstResult = await firstVerification;
  assert.equal(firstResult.state, "broken");
  assert.equal(firstWorker.terminated, 1);
  assert.equal(registry.get("racket-wasm").state.kind, "failed");
  assert.equal(registry.get("racket-wasm").verification, "unverified");
  assert.equal(factory.workers.length, 1);

  const secondVerification = verifier.verify("racket-wasm");
  const secondWorker = factory.workers[1];
  if (secondWorker === undefined) throw new Error("expected fresh verification worker");
  assert.notStrictEqual(secondWorker, firstWorker);
  assert.equal(factory.workers.length, 2);
  completeInitialize(secondWorker);
  await flush();
  completeExecute(secondWorker);
  await flush();
  completeJudge(secondWorker);

  assert.equal((await secondVerification).state, "verified");
  assert.equal(registry.get("racket-wasm").state.kind, "ready");
  assert.equal(registry.get("racket-wasm").verification, "verified");
});

test("optional verification execution timeout remains broken, failed, and unverified", async () => {
  const registry = RuntimeRegistry.fromManifest(manifest(true));
  const factory = new FakeWorkerFactory();
  const clock = new ManualClock();
  const supervisor = new Supervisor({ registry, workerFactory: factory.create, clock });
  const adapters = new RuntimeAdapterRegistry();
  adapters.register(createRacketAdapter(supervisor));
  const verification = new OptionalRuntimeVerifier({ registry, supervisor, adapters }).verify("racket-wasm");
  const worker = factory.workers[0];
  if (worker === undefined) throw new Error("expected verification worker");

  completeInitialize(worker);
  await flush();
  clock.tick(5_000);

  const result = await verification;
  assert.equal(result.state, "broken");
  if (result.state === "broken") assert.equal(result.code, "execution-timeout");
  assert.equal(registry.get("racket-wasm").state.kind, "failed");
  assert.equal(registry.get("racket-wasm").verification, "unverified");
});

test("optional verification cancellation remains broken, failed, and unverified", async () => {
  const registry = RuntimeRegistry.fromManifest(manifest(true));
  const factory = new FakeWorkerFactory();
  const supervisor = new Supervisor({ registry, workerFactory: factory.create, clock: new ManualClock() });
  const adapters = new RuntimeAdapterRegistry();
  adapters.register(createRacketAdapter(supervisor));
  const verification = new OptionalRuntimeVerifier({ registry, supervisor, adapters }).verify("racket-wasm");
  const worker = factory.workers[0];
  if (worker === undefined) throw new Error("expected verification worker");

  completeInitialize(worker);
  await flush();
  const smokeRequest = worker.posted[worker.posted.length - 1];
  if (smokeRequest === undefined || smokeRequest.type !== "execute") throw new Error("expected smoke request");
  supervisor.cancel("racket-wasm", smokeRequest.requestId);

  const result = await verification;
  assert.equal(result.state, "broken");
  if (result.state === "broken") assert.equal(result.code, "cancelled");
  assert.equal(registry.get("racket-wasm").state.kind, "failed");
  assert.equal(registry.get("racket-wasm").verification, "unverified");
});

test("a verified optional runtime preserves trust across fatal, timeout, and cancellation fresh-worker recovery", async () => {
  const registry = RuntimeRegistry.fromManifest(manifest(true));
  const factory = new FakeWorkerFactory();
  const clock = new ManualClock();
  const supervisor = new Supervisor({ registry, workerFactory: factory.create, clock });
  const adapters = new RuntimeAdapterRegistry();
  adapters.register(createRacketAdapter(supervisor));

  const verification = new OptionalRuntimeVerifier({ registry, supervisor, adapters }).verify("racket-wasm");
  const verifiedWorker = factory.workers[0];
  if (verifiedWorker === undefined) throw new Error("expected verification worker");
  completeInitialize(verifiedWorker);
  await flush();
  completeExecute(verifiedWorker);
  await flush();
  completeJudge(verifiedWorker);
  await verification;

  const fatal = supervisor.execute("racket-wasm", "(display 1)");
  completeFatal(verifiedWorker);
  await assert.rejects(fatal, (error: { readonly code?: string }) => error.code === "FATAL");
  assert.equal(registry.get("racket-wasm").verification, "verified");

  const recoveredAfterFatal = supervisor.execute("racket-wasm", "(display 2)");
  const fatalRecoveryWorker = factory.workers[1];
  if (fatalRecoveryWorker === undefined) throw new Error("expected fatal recovery worker");
  completeInitialize(fatalRecoveryWorker);
  completeExecute(fatalRecoveryWorker);
  await recoveredAfterFatal;

  const timedOut = supervisor.execute("racket-wasm", "(display 3)");
  clock.tick(5_000);
  await assert.rejects(timedOut, (error: { readonly code?: string }) => error.code === "execution-timeout");
  assert.equal(registry.get("racket-wasm").state.kind, "loadable");
  assert.equal(registry.get("racket-wasm").verification, "verified");

  const recoveredAfterTimeout = supervisor.execute("racket-wasm", "(display 4)");
  const timeoutRecoveryWorker = factory.workers[2];
  if (timeoutRecoveryWorker === undefined) throw new Error("expected timeout recovery worker");
  completeInitialize(timeoutRecoveryWorker);
  completeExecute(timeoutRecoveryWorker);
  await recoveredAfterTimeout;

  const controller = new AbortController();
  const cancelled = supervisor.execute("racket-wasm", "(display 5)", { signal: controller.signal });
  controller.abort();
  await assert.rejects(cancelled, (error: { readonly kind?: string }) => error.kind === "cancelled");
  assert.equal(registry.get("racket-wasm").state.kind, "loadable");
  assert.equal(registry.get("racket-wasm").verification, "verified");

  const recoveredAfterCancellation = supervisor.execute("racket-wasm", "(display 6)");
  const cancellationRecoveryWorker = factory.workers[3];
  if (cancellationRecoveryWorker === undefined) throw new Error("expected cancellation recovery worker");
  completeInitialize(cancellationRecoveryWorker);
  completeExecute(cancellationRecoveryWorker);
  await recoveredAfterCancellation;
  assert.equal(registry.get("racket-wasm").verification, "verified");
});

test("simultaneous verification calls share one handshake, smoke, and judge sequence", async () => {
  const registry = RuntimeRegistry.fromManifest(manifest(true));
  const calls: string[] = [];
  const supervisor = verificationSupervisor(registry, {
    initialize: async () => {
      calls.push("handshake");
      if (registry.get("racket-wasm").state.kind === "loadable") {
        registry.transition("racket-wasm", { kind: "initializing" });
        registry.transition("racket-wasm", { kind: "verifying" });
      }
      return { runtimeVersion: "racket-fake", buildId: "build-id", capabilities: { execute: true, judge: true } };
    },
    execute: async () => {
      calls.push("smoke");
      return { identity: { runtimeVersion: "racket-fake", buildId: "build-id" }, payload: { stdout: bounded(), stderr: bounded(), value: null } };
    },
    judge: async (_runtimeId: string, _source: string, cases: readonly { readonly index: number; readonly input: unknown }[]) => {
      calls.push("judge-contract");
      return {
        identity: { runtimeVersion: "racket-fake", buildId: "build-id" },
        payload: { cases: cases.map((testCase) => ({ index: testCase.index, ok: true as const, actual: testCase.input, stdout: bounded(), stderr: bounded() })) },
      };
    },
  }) as unknown as RuntimeSupervisor;
  const adapters = new RuntimeAdapterRegistry();
  adapters.register(createRacketAdapter(supervisor));
  const verifier = new OptionalRuntimeVerifier({ registry, supervisor, adapters });

  const [first, second] = await Promise.all([verifier.verify("racket-wasm"), verifier.verify("racket-wasm")]);

  assert.deepEqual(calls, ["handshake", "smoke", "judge-contract"]);
  assert.equal(first.state, "verified");
  assert.equal(second.state, "verified");
  assert.equal(registry.get("racket-wasm").state.kind, "ready");
});

test("an oversized adapter error is bounded before verifier failure state is recorded", async () => {
  const registry = RuntimeRegistry.fromManifest(manifest(true));
  const supervisor = verificationSupervisor(registry, {
    initialize: async () => {
      registry.transition("racket-wasm", { kind: "initializing" });
      registry.transition("racket-wasm", { kind: "verifying" });
      return { runtimeVersion: "racket-fake", buildId: "build-id", capabilities: { execute: true, judge: true } };
    },
    execute: async () => {
      throw Object.assign(new Error("m".repeat(5_000)), { code: "c".repeat(200) });
    },
    judge: async () => assert.fail("smoke failure must not judge"),
  }) as unknown as RuntimeSupervisor;
  const adapters = new RuntimeAdapterRegistry();
  adapters.register(createRacketAdapter(supervisor));

  const result = await new OptionalRuntimeVerifier({ registry, supervisor, adapters }).verify("racket-wasm");

  assert.equal(result.state, "broken");
  if (result.state === "broken") {
    assert.ok(new TextEncoder().encode(result.code).byteLength <= 128);
    assert.ok(new TextEncoder().encode(result.message).byteLength <= 4_096);
  }
  assert.equal(registry.get("racket-wasm").state.kind, "failed");
});

test("RustPython remains verifying through mandatory six-problem Pyodide parity and fails closed on one mismatch", async () => {
  const registry = RuntimeRegistry.fromManifest(rustPythonManifest());
  const calls: string[] = [];
  const supervisor = verificationSupervisor(registry, {
    initialize: async (runtimeId: string) => {
      calls.push(`handshake:${runtimeId}`);
      registry.transition("python-rustpython", { kind: "initializing" });
      registry.transition("python-rustpython", { kind: "verifying" });
      return { runtimeVersion: "rustpython-fake", buildId: "rust-build", capabilities: { execute: true, judge: true } };
    },
    execute: async (runtimeId: string) => {
      calls.push(`smoke:${runtimeId}`);
      return { identity: { runtimeVersion: "rustpython-fake", buildId: "rust-build" }, payload: { stdout: bounded(), stderr: bounded(), value: null } };
    },
    judge: async (runtimeId: string, source: string, cases: readonly { readonly index: number; readonly input: unknown }[]) => {
      calls.push(`judge:${runtimeId}`);
      const corpusIndex = parityFixtures.findIndex((fixture) => fixture.source === source);
      const fixture = parityFixtures[corpusIndex];
      const actuals = fixture === undefined ? cases.map((testCase) => testCase.input) : fixture.cases.map((testCase) => testCase.expected);
      return {
        identity: { runtimeVersion: runtimeId === "python-rustpython" ? "rustpython-fake" : "pyodide-fake", buildId: runtimeId === "python-rustpython" ? "rust-build" : "pyodide-build" },
        payload: { cases: cases.map((testCase, index) => ({ index: testCase.index, ok: true as const, actual: actuals[index], stdout: bounded(), stderr: bounded() })) },
      };
    },
  }) as unknown as RuntimeSupervisor;
  const adapters = new RuntimeAdapterRegistry();
  adapters.register(createPythonAdapter(supervisor, "python-pyodide"));
  adapters.register(createRustPythonAdapter(supervisor));
  const verifier = new OptionalRuntimeVerifier({ registry, supervisor, adapters, pythonCorpus: async () => parityFixtures });

  const verification = await verifier.verify("python-rustpython");

  assert.equal(verification.state, "verified");
  if (verification.state === "verified") {
    assert.deepEqual(verification.checks, ["assets", "handshake", "smoke", "judge-contract", "pyodide-corpus-parity"]);
  }
  assert.deepEqual(calls.slice(0, 3), [
    "handshake:python-rustpython",
    "smoke:python-rustpython",
    "judge:python-rustpython",
  ]);
  assert.equal(calls.filter((call) => call === "judge:python-pyodide").length, 6);
  assert.equal(calls.filter((call) => call === "judge:python-rustpython").length, 7);
  assert.equal(registry.get("python-rustpython").state.kind, "ready");
});

test("one RustPython corpus mismatch marks its existing Registry entry broken instead of selectable", async () => {
  const registry = RuntimeRegistry.fromManifest(rustPythonManifest());
  const supervisor = verificationSupervisor(registry, {
    initialize: async () => {
      registry.transition("python-rustpython", { kind: "initializing" });
      registry.transition("python-rustpython", { kind: "verifying" });
      return { runtimeVersion: "rustpython-fake", buildId: "rust-build", capabilities: { execute: true, judge: true } };
    },
  }) as unknown as RuntimeSupervisor;
  const adapters = new RuntimeAdapterRegistry();
  adapters.register(parityAdapter("python-pyodide", false));
  adapters.register(parityAdapter("python-rustpython", true));

  const verification = await new OptionalRuntimeVerifier({
    registry,
    supervisor,
    adapters,
    pythonCorpus: async () => parityFixtures,
  }).verify("python-rustpython");

  assert.equal(verification.state, "broken");
  if (verification.state === "broken") assert.equal(verification.code, "pyodide-corpus-parity-failed");
  assert.equal(registry.get("python-rustpython").state.kind, "failed");
  assert.equal(registry.resolveDefault("python", "judge")?.runtimeId, "python-pyodide");
});

const parityFixtures: readonly PythonCorpusFixture[] = Object.freeze([1, 2, 3, 4, 5, 6].map((problemId) => ({
  problemId,
  source: PYTHON_CORPUS_SOURCES[problemId as keyof typeof PYTHON_CORPUS_SOURCES],
  cases: Object.freeze([{ input: { problemId }, expected: { problemId } }]),
})));

function rustPythonManifest() {
  const document = manifest(false);
  const runtime = document.runtimes.find((entry) => entry.runtimeId === "python-rustpython");
  if (runtime === undefined) throw new Error("RustPython manifest entry is missing");
  return parseRuntimeManifest({
    schemaVersion: 1,
    runtimes: document.runtimes.map((entry) => {
      if (entry.runtimeId !== "python-rustpython") return entry;
      const packaged = { ...entry, packaged: true, capabilities: { execute: true, judge: true } };
      delete packaged.unavailableReason;
      return packaged;
    }),
  });
}

function parityAdapter(runtimeId: "python-pyodide" | "python-rustpython", mismatch: boolean): RuntimeAdapter {
  return {
    runtimeId,
    languageId: "python",
    execute: async () => ({
      identity: { runtimeVersion: "rustpython-fake", buildId: "rust-build" },
      payload: { stdout: bounded(), stderr: bounded(), value: null },
    }),
    judge: async (source, inputs) => {
      const fixture = parityFixtures.find((candidate) => candidate.source === source);
      return {
        identity: { runtimeVersion: "rustpython-fake", buildId: "rust-build" },
        payload: {
          cases: inputs.map((input, index) => {
            let actual = input;
            if (fixture !== undefined) {
              const expected = fixture.cases[index];
              if (expected === undefined) throw new Error("missing parity fixture case");
              actual = mismatch && fixture.problemId === 1 ? null : expected.expected;
            }
            return {
              index,
              ok: true as const,
              actual,
              stdout: bounded(),
              stderr: bounded(),
            };
          }),
        },
      };
    },
  };
}

function bounded(text = "") {
  return { text, bytes: new TextEncoder().encode(text).byteLength, truncated: false };
}

function verificationSupervisor<T extends object>(registry: RuntimeRegistry, supervisor: T): T & Pick<RuntimeSupervisor, "beginOptionalVerification"> {
  return Object.assign(supervisor, {
    async dispose(): Promise<void> {},
    beginOptionalVerification(runtimeId: Parameters<RuntimeSupervisor["beginOptionalVerification"]>[0]) {
      return {
        operationOptions: () => ({}),
        complete: () => registry.completeOptionalVerification(runtimeId),
        close: () => {},
      };
    },
  });
}

function completeInitialize(worker: FakeWorker): void {
  const request = worker.posted[worker.posted.length - 1];
  if (request === undefined || request.type !== "initialize") throw new Error("expected initialize request");
  worker.emit({
    protocolVersion: 1,
    requestId: request.requestId,
    runtimeId: "racket-wasm",
    type: "complete",
    operation: "initialize",
    payload: { runtimeVersion: "racket-fake", buildId: "build-id", capabilities: { execute: true, judge: true } },
  });
}

function completeExecute(worker: FakeWorker): void {
  const request = worker.posted[worker.posted.length - 1];
  if (request === undefined || request.type !== "execute") throw new Error("expected execute request");
  worker.emit({
    protocolVersion: 1,
    requestId: request.requestId,
    runtimeId: "racket-wasm",
    type: "complete",
    operation: "execute",
    payload: { stdout: bounded(), stderr: bounded(), value: null },
  });
}

function completeSmokeFailure(worker: FakeWorker): void {
  const request = worker.posted[worker.posted.length - 1];
  if (request === undefined || request.type !== "execute") throw new Error("expected execute request");
  worker.emit({
    protocolVersion: 1,
    requestId: request.requestId,
    runtimeId: "racket-wasm",
    type: "failure",
    error: {
      kind: "runtime",
      code: "racket-smoke-error",
      message: "Racket smoke failed",
      fatal: false,
    },
  });
}

function completeFatal(worker: FakeWorker): void {
  const request = worker.posted[worker.posted.length - 1];
  if (request === undefined || request.type !== "execute") throw new Error("expected execute request");
  worker.emit({
    protocolVersion: 1,
    requestId: request.requestId,
    runtimeId: "racket-wasm",
    type: "failure",
    error: { kind: "runtime", code: "FATAL", message: "Worker exited", fatal: true },
  });
}

function completeJudge(worker: FakeWorker): void {
  const request = worker.posted[worker.posted.length - 1];
  if (request === undefined || request.type !== "judge") throw new Error("expected judge request");
  worker.emit({
    protocolVersion: 1,
    requestId: request.requestId,
    runtimeId: "racket-wasm",
    type: "complete",
    operation: "judge",
    payload: {
      cases: request.cases.map((testCase: JudgeCaseRequest) => ({
        index: testCase.index,
        ok: true,
        actual: testCase.input,
        stdout: bounded(),
        stderr: bounded(),
      })),
    },
  });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
