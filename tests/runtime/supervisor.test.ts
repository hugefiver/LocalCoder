import assert from "node:assert/strict";
import test from "node:test";
import { parseRuntimeFailure } from "../../src/oj/judge-response.js";
import { parseRuntimeManifest } from "../../src/runtime/manifest.js";
import { type JudgeCaseRequest, type WorkerRequest } from "../../src/runtime/protocol.js";
import { RuntimeRegistry } from "../../src/runtime/registry.js";
import { RuntimeSupervisor } from "../../src/runtime/supervisor.js";
import { runtimeFailureIdentity } from "../../src/runtime/supervisor-faults.js";
import { FakeWorker, FakeWorkerFactory } from "../helpers/fake-worker.js";
import { ManualClock } from "../helpers/manual-clock.js";

const runtimeId = "python-pyodide" as const;
const perSubmissionRuntimeId = "javascript-worker" as const;

function manifest() {
  return parseRuntimeManifest({
    schemaVersion: 1,
    runtimes: [
      {
        runtimeId: perSubmissionRuntimeId,
        languageId: "javascript",
        protocolVersion: 1,
        runtimeVersion: "manifest-js-version",
        worker: { url: "workers/javascript-worker.js", type: "module" },
        assets: [],
        required: true,
        packaged: true,
        reuse: "per-submission",
        capabilities: { execute: true, judge: true },
        timeouts: { initializeMs: 10, executeMs: 25 },
        limits: { sourceBytes: 8, caseCount: 2, outputBytes: 8 },
      },
      {
        runtimeId,
        languageId: "python",
        protocolVersion: 1,
        runtimeVersion: "manifest-python-version",
        worker: { url: "workers/python-worker.js", type: "module" },
        assets: [],
        required: true,
        packaged: true,
        reuse: "session",
        capabilities: { execute: true, judge: true },
        timeouts: { initializeMs: 10, executeMs: 25 },
        limits: { sourceBytes: 8, caseCount: 2, outputBytes: 8 },
      },
    ],
  });
}

function setup() {
  const registry = RuntimeRegistry.fromManifest(manifest());
  const factory = new FakeWorkerFactory();
  const clock = new ManualClock();
  const supervisor = new RuntimeSupervisor({ registry, workerFactory: factory.create, clock });
  return { registry, factory, clock, supervisor };
}

function request(worker: FakeWorker, index = worker.posted.length - 1): WorkerRequest {
  const message = worker.posted[index];
  if (message === undefined) throw new Error("expected worker request");
  return message;
}

function bounded(text = "") {
  return { text, bytes: new TextEncoder().encode(text).byteLength, truncated: false };
}

function completeInitialize(worker: FakeWorker, version = "worker-version", buildId = "worker-build"): void {
  const message = request(worker);
  assert.equal(message.type, "initialize");
  worker.emit({
    protocolVersion: 1,
    requestId: message.requestId,
    runtimeId: message.runtimeId,
    type: "complete",
    operation: "initialize",
    payload: { runtimeVersion: version, buildId, capabilities: { execute: true, judge: true } },
  });
}

function completeExecute(worker: FakeWorker, value: unknown = null): void {
  const message = request(worker);
  assert.equal(message.type, "execute");
  worker.emit({
    protocolVersion: 1,
    requestId: message.requestId,
    runtimeId: message.runtimeId,
    type: "complete",
    operation: "execute",
    payload: { stdout: bounded(), stderr: bounded(), value },
  });
}

function fatalFailure(worker: FakeWorker): void {
  const message = request(worker);
  worker.emit({
    protocolVersion: 1,
    requestId: message.requestId,
    runtimeId: message.runtimeId,
    type: "failure",
    error: { kind: "runtime", code: "FATAL", message: "worker is unusable", fatal: true },
  });
}

async function readySession(supervisor: RuntimeSupervisor, factory: FakeWorkerFactory): Promise<FakeWorker> {
  const initializing = supervisor.initialize(runtimeId);
  const worker = factory.workers[0];
  if (worker === undefined) throw new Error("expected session worker");
  completeInitialize(worker);
  await initializing;
  return worker;
}

async function executingSession(supervisor: RuntimeSupervisor, factory: FakeWorkerFactory) {
  const operation = supervisor.execute(runtimeId, "code");
  const worker = factory.workers[0];
  if (worker === undefined) throw new Error("expected worker");
  completeInitialize(worker);
  assert.equal(request(worker).type, "execute");
  return { operation, worker };
}

function rejectionWith(code: string) {
  return (error: unknown): boolean => {
    assert.equal(typeof error, "object");
    assert.ok(error !== null);
    assert.equal((error as { code?: unknown }).code, code);
    return true;
  };
}

test("queues session runtime submissions FIFO without overlap", async () => {
  const { supervisor, factory } = setup();
  const worker = await readySession(supervisor, factory);

  const first = supervisor.execute(runtimeId, "first");
  const second = supervisor.execute(runtimeId, "second");
  assert.equal(worker.posted.filter(({ type }) => type === "execute").length, 1);
  assert.equal(request(worker).type, "execute");

  completeExecute(worker, 1);
  assert.equal(worker.posted.filter(({ type }) => type === "execute").length, 2);
  assert.equal(request(worker).type, "execute");
  completeExecute(worker, 2);

  assert.equal((await first).payload.value, 1);
  assert.equal((await second).payload.value, 2);
  assert.equal(factory.workers.length, 1);
});

test("uses and terminates a fresh per-submission Worker for every execution", async () => {
  const { supervisor, factory } = setup();

  const first = supervisor.execute(perSubmissionRuntimeId, "first");
  const firstWorker = factory.workers[0];
  if (firstWorker === undefined) throw new Error("expected first worker");
  completeInitialize(firstWorker, "first-version", "first-build");
  completeExecute(firstWorker, 1);
  await first;

  const second = supervisor.execute(perSubmissionRuntimeId, "second");
  const secondWorker = factory.workers[1];
  if (secondWorker === undefined) throw new Error("expected second worker");
  completeInitialize(secondWorker, "second-version", "second-build");
  completeExecute(secondWorker, 2);
  await second;

  assert.notEqual(firstWorker, secondWorker);
  assert.equal(firstWorker.terminated, 1);
  assert.equal(secondWorker.terminated, 1);
  assert.equal(firstWorker.listenerCount(), 0);
  assert.equal(secondWorker.listenerCount(), 0);
});

test("updates a first-generation initialization status and completes the handshake", async () => {
  const { supervisor, factory, clock, registry } = setup();
  let settled = false;
  const operation = supervisor.execute(perSubmissionRuntimeId, "first");
  void operation.then(() => { settled = true; }, () => { settled = true; });
  const worker = factory.workers[0];
  if (worker === undefined) throw new Error("expected first-generation worker");
  const initializeRequest = request(worker);
  assert.equal(initializeRequest.type, "initialize");

  assert.doesNotThrow(() => {
    worker.emit({
      protocolVersion: 1,
      requestId: initializeRequest.requestId,
      runtimeId: perSubmissionRuntimeId,
      type: "status",
      phase: "initializing",
      message: "warming first generation",
    });
  });
  const statusSnapshot = registry.get(perSubmissionRuntimeId);
  assert.deepEqual(statusSnapshot.state, { kind: "initializing", message: "warming first generation" });
  worker.emit({
    protocolVersion: 1,
    requestId: initializeRequest.requestId,
    runtimeId: perSubmissionRuntimeId,
    type: "status",
    phase: "initializing",
    message: "warming first generation",
  });
  assert.strictEqual(registry.get(perSubmissionRuntimeId), statusSnapshot);
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(worker.terminated, 0);
  assert.equal(worker.listenerCount(), 2);
  assert.equal(clock.pendingCount(), 1);

  completeInitialize(worker, "first-version", "first-build");
  completeExecute(worker, 1);
  assert.deepEqual((await operation).identity, { runtimeVersion: "first-version", buildId: "first-build" });
  assert.equal(registry.get(perSubmissionRuntimeId).state.kind, "ready");
});

test("keeps a ready per-submission runtime stable through a later generation initialization status", async () => {
  const { supervisor, factory, clock, registry } = setup();

  const first = supervisor.execute(perSubmissionRuntimeId, "first");
  const firstWorker = factory.workers[0];
  if (firstWorker === undefined) throw new Error("expected first worker");
  completeInitialize(firstWorker, "first-version", "first-build");
  completeExecute(firstWorker, 1);
  await first;
  assert.equal(registry.get(perSubmissionRuntimeId).state.kind, "ready");

  let settled = false;
  const second = supervisor.execute(perSubmissionRuntimeId, "second");
  void second.then(() => { settled = true; }, () => { settled = true; });
  const secondWorker = factory.workers[1];
  if (secondWorker === undefined) throw new Error("expected second worker");
  const initializeRequest = request(secondWorker);
  assert.equal(initializeRequest.type, "initialize");

  assert.doesNotThrow(() => {
    secondWorker.emit({
      protocolVersion: 1,
      requestId: initializeRequest.requestId,
      runtimeId: perSubmissionRuntimeId,
      type: "status",
      phase: "initializing",
      message: "warming generation two",
    });
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(secondWorker.terminated, 0);
  assert.equal(secondWorker.listenerCount(), 2);
  assert.equal(clock.pendingCount(), 1);

  completeInitialize(secondWorker, "second-version", "second-build");
  completeExecute(secondWorker, 2);
  assert.deepEqual((await second).identity, { runtimeVersion: "second-version", buildId: "second-build" });
  assert.equal(secondWorker.listenerCount(), 0);
  assert.equal(clock.pendingCount(), 0);
});

test("initialization timeout terminates once, cleans up, and marks the runtime failed", async () => {
  const { supervisor, factory, clock, registry } = setup();
  const initializing = supervisor.initialize(runtimeId);
  const rejected = initializing.then(
    () => assert.fail("expected initialization timeout"),
    (error: unknown) => error,
  );
  const worker = factory.workers[0];
  if (worker === undefined) throw new Error("expected worker");

  clock.tick(10);
  const error = await rejected;

  assert.equal((error as { code?: unknown }).code, "initialization-timeout");
  assert.equal(runtimeFailureIdentity(error), undefined);

  assert.equal(worker.terminated, 1);
  assert.equal(worker.listenerCount(), 0);
  assert.equal(clock.pendingCount(), 0);
  assert.deepEqual(registry.get(runtimeId).state, {
    kind: "failed",
    code: "initialization-timeout",
    message: "Runtime initialization timed out",
  });
});

test("execution timeout uses the authoritative short override and caps excessive overrides", async () => {
  const short = setup();
  const shortOperation = short.supervisor.execute(runtimeId, "code", { timeoutMs: 5 });
  const shortRejected = assert.rejects(shortOperation, rejectionWith("execution-timeout"));
  const shortWorker = short.factory.workers[0];
  if (shortWorker === undefined) throw new Error("expected short-timeout worker");
  completeInitialize(shortWorker);
  short.clock.tick(4);
  assert.equal(shortWorker.terminated, 0);
  short.clock.tick(1);
  await shortRejected;
  assert.equal(shortWorker.terminated, 1);

  const capped = setup();
  const cappedOperation = capped.supervisor.execute(runtimeId, "code", { timeoutMs: 1_000_000 });
  const cappedRejected = assert.rejects(cappedOperation, rejectionWith("execution-timeout"));
  const cappedWorker = capped.factory.workers[0];
  if (cappedWorker === undefined) throw new Error("expected capped-timeout worker");
  completeInitialize(cappedWorker);
  capped.clock.tick(24);
  assert.equal(cappedWorker.terminated, 0);
  capped.clock.tick(1);
  await cappedRejected;
});

test("binds handshake identity to a nonfatal execution failure", async () => {
  const { supervisor, factory } = setup();
  const operation = supervisor.execute(perSubmissionRuntimeId, "x");
  const worker = factory.workers[0];
  if (worker === undefined) throw new Error("expected TypeScript worker");
  completeInitialize(worker, "typescript-worker-version", "typescript-worker-build");

  const message = request(worker);
  assert.equal(message.type, "execute");
  worker.emit({
    protocolVersion: 1,
    requestId: message.requestId,
    runtimeId: message.runtimeId,
    type: "failure",
    error: {
      kind: "compile",
      code: "typescript-compile-error",
      message: "TypeScript source could not be compiled",
      details: "Type 'string' is not assignable to type 'number'.",
      fatal: false,
    },
  });

  const error = await operation.then(
    () => assert.fail("expected nonfatal compile failure"),
    (failure: unknown) => failure,
  );

  assert.deepEqual(Reflect.ownKeys(error as object), ["kind", "code", "message", "fatal", "details"]);
  assert.deepEqual(parseRuntimeFailure(error), {
    kind: "compile",
    code: "typescript-compile-error",
    message: "TypeScript source could not be compiled",
    details: "Type 'string' is not assignable to type 'number'.",
    fatal: false,
  });
  assert.deepEqual(runtimeFailureIdentity(error), {
    runtimeVersion: "typescript-worker-version",
    buildId: "typescript-worker-build",
  });
  assert.equal(worker.terminated, 1);
});

test("does not bind identity to initialization or unexecuted queued failures", async () => {
  const { supervisor, factory } = setup();
  const initializing = supervisor.initialize(perSubmissionRuntimeId);
  const queued = supervisor.execute(perSubmissionRuntimeId, "x");
  const worker = factory.workers[0];
  if (worker === undefined) throw new Error("expected TypeScript worker");
  const message = request(worker);
  assert.equal(message.type, "initialize");

  worker.emit({
    protocolVersion: 1,
    requestId: message.requestId,
    runtimeId: message.runtimeId,
    type: "failure",
    error: { kind: "compile", code: "initialize-failed", message: "Runtime initialization failed", fatal: false },
  });

  const [initializationError, queuedError] = await Promise.all([
    initializing.then(
      () => assert.fail("expected initialization failure"),
      (failure: unknown) => failure,
    ),
    queued.then(
      () => assert.fail("expected queued operation failure"),
      (failure: unknown) => failure,
    ),
  ]);

  assert.equal(runtimeFailureIdentity(initializationError), undefined);
  assert.equal(runtimeFailureIdentity(queuedError), undefined);
  assert.equal(worker.posted.filter(({ type }) => type === "execute").length, 0);
});

test("binds post-handshake terminal identity only to the active operation", async () => {
  const { supervisor, factory, clock } = setup();
  const worker = await readySession(supervisor, factory);
  const active = supervisor.execute(runtimeId, "active");
  const queued = supervisor.judge(runtimeId, "queued", [{ index: 0, input: null }]);

  clock.tick(25);
  const activeError = await active.then(
    () => assert.fail("expected active execution timeout"),
    (error: unknown) => error,
  );
  const queuedError = await queued.then(
    () => assert.fail("expected queued execution timeout"),
    (error: unknown) => error,
  );

  assert.deepEqual(Reflect.ownKeys(activeError as object), ["kind", "code", "message", "fatal"]);
  assert.deepEqual(parseRuntimeFailure(activeError), {
    kind: "infrastructure",
    code: "execution-timeout",
    message: "Runtime execution timed out",
    fatal: true,
  });
  assert.deepEqual(runtimeFailureIdentity(activeError), {
    runtimeVersion: "worker-version",
    buildId: "worker-build",
  });
  assert.equal(runtimeFailureIdentity(queuedError), undefined);
  assert.notStrictEqual(activeError, queuedError);
  assert.equal(worker.terminated, 1);
});

test("AbortSignal cancellation is terminal, cleanup-safe, and recoverable", async () => {
  const { supervisor, factory, clock, registry } = setup();
  const controller = new AbortController();
  const operation = supervisor.execute(runtimeId, "code", { signal: controller.signal });
  const rejected = assert.rejects(operation, rejectionWith("cancelled"));
  const worker = factory.workers[0];
  if (worker === undefined) throw new Error("expected worker");
  completeInitialize(worker);

  controller.abort();
  await rejected;

  assert.equal(worker.terminated, 1);
  assert.equal(worker.listenerCount(), 0);
  assert.equal(clock.pendingCount(), 0);
  assert.equal(registry.get(runtimeId).state.kind, "failed");
});

test("explicit cancel terminates the active request and clears its resources", async () => {
  const { supervisor, factory, clock } = setup();
  const { operation, worker } = await executingSession(supervisor, factory);
  const rejected = assert.rejects(operation, rejectionWith("cancelled"));

  supervisor.cancel(runtimeId, request(worker).requestId);
  await rejected;

  assert.equal(worker.terminated, 1);
  assert.equal(worker.listenerCount(), 0);
  assert.equal(clock.pendingCount(), 0);
});

for (const [name, emit] of [
  ["Worker error", (worker: FakeWorker) => worker.fail(new Error("worker crashed"))],
  ["malformed response", (worker: FakeWorker) => worker.emit({ broken: true })],
  ["request mismatch", (worker: FakeWorker) => {
    const message = request(worker);
    worker.emit({
      protocolVersion: 1,
      requestId: "another-request",
      runtimeId: message.runtimeId,
      type: "complete",
      operation: "execute",
      payload: { stdout: bounded(), stderr: bounded(), value: null },
    });
  }],
  ["runtime mismatch", (worker: FakeWorker) => {
    const message = request(worker);
    worker.emit({
      protocolVersion: 1,
      requestId: message.requestId,
      runtimeId: perSubmissionRuntimeId,
      type: "complete",
      operation: "execute",
      payload: { stdout: bounded(), stderr: bounded(), value: null },
    });
  }],
  ["fatal failure", fatalFailure],
] as const) {
  test(`${name} immediately terminates the active Worker`, async () => {
    const { supervisor, factory, registry, clock } = setup();
    const { operation, worker } = await executingSession(supervisor, factory);
    const rejected = assert.rejects(operation);

    emit(worker);
    await rejected;

    assert.equal(worker.terminated, 1);
    assert.equal(worker.listenerCount(), 0);
    assert.equal(clock.pendingCount(), 0);
    assert.equal(registry.get(runtimeId).state.kind, "failed");
  });
}

test("late messages from an invalidated generation cannot affect a fresh Worker", async () => {
  const { supervisor, factory } = setup();
  const { operation: first, worker: firstWorker } = await executingSession(supervisor, factory);
  const firstRequest = request(firstWorker);
  const firstRejected = assert.rejects(first);
  firstWorker.fail(new Error("first worker crashed"));
  await firstRejected;

  const second = supervisor.execute(runtimeId, "second");
  const secondWorker = factory.workers[1];
  if (secondWorker === undefined) throw new Error("expected replacement worker");
  assert.equal(request(secondWorker).type, "initialize");
  firstWorker.emit({
    protocolVersion: 1,
    requestId: firstRequest.requestId,
    runtimeId,
    type: "complete",
    operation: "execute",
    payload: { stdout: bounded(), stderr: bounded(), value: "stale" },
  });
  assert.equal(secondWorker.terminated, 0);

  completeInitialize(secondWorker, "replacement-version", "replacement-build");
  completeExecute(secondWorker, "fresh");
  assert.equal((await second).payload.value, "fresh");
});

test("a terminal fault settles active and queued promises exactly once", async () => {
  const { supervisor, factory } = setup();
  const worker = await readySession(supervisor, factory);
  const settled = [0, 0, 0];
  const first = supervisor.execute(runtimeId, "one").then(
    () => { settled[0] = (settled[0] ?? 0) + 1; },
    () => { settled[0] = (settled[0] ?? 0) + 1; },
  );
  const second = supervisor.execute(runtimeId, "two").then(
    () => { settled[1] = (settled[1] ?? 0) + 1; },
    () => { settled[1] = (settled[1] ?? 0) + 1; },
  );
  const third = supervisor.judge(runtimeId, "three", [{ index: 0, input: null }]).then(
    () => { settled[2] = (settled[2] ?? 0) + 1; },
    () => { settled[2] = (settled[2] ?? 0) + 1; },
  );

  fatalFailure(worker);
  await Promise.all([first, second, third]);

  assert.deepEqual(settled, [1, 1, 1]);
  assert.equal(worker.terminated, 1);
});

test("a failed runtime creates a fresh Worker, reinitializes, and binds the handshake identity", async () => {
  const { supervisor, factory, registry } = setup();
  const { operation: failed, worker: failedWorker } = await executingSession(supervisor, factory);
  const failedRejection = assert.rejects(failed);
  fatalFailure(failedWorker);
  await failedRejection;

  const initialized = supervisor.initialize(runtimeId);
  const replacement = factory.workers[1];
  if (replacement === undefined) throw new Error("expected recovery worker");
  completeInitialize(replacement, "handshake-version", "handshake-build");
  await initialized;
  assert.equal(registry.get(runtimeId).state.kind, "ready");

  const operation = supervisor.execute(runtimeId, "code");
  completeExecute(replacement, { ok: true });
  assert.deepEqual((await operation).identity, {
    runtimeVersion: "handshake-version",
    buildId: "handshake-build",
  });
  assert.equal(factory.workers.length, 2);
});

test("validates source, cases, and operation timeout before enqueueing", async () => {
  const { supervisor, factory } = setup();
  await assert.rejects(supervisor.execute(runtimeId, "x".repeat(9)), /source/i);
  await assert.rejects(
    supervisor.judge(runtimeId, "code", [
      { index: 0, input: null },
      { index: 1, input: null },
      { index: 2, input: null },
    ] as readonly JudgeCaseRequest[]),
    /case/i,
  );
  await assert.rejects(supervisor.execute(runtimeId, "code", { timeoutMs: 0 }), /timeout/i);
  await assert.rejects(supervisor.execute(runtimeId, "code", { timeoutMs: Number.NaN }), /timeout/i);
  assert.equal(factory.workers.length, 0);
});
