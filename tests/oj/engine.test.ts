import assert from "node:assert/strict";
import test from "node:test";
import type { Problem, ProblemCase } from "../../src/domain/problem.js";
import type { JsonValue } from "../../src/domain/json-value.js";
import type { JudgeCommand } from "../../src/domain/submission.js";
import { OjEngine } from "../../src/oj/engine.js";
import { RuntimeAdapterRegistry } from "../../src/runtime/adapters/registry.js";
import { parseRuntimeManifest } from "../../src/runtime/manifest.js";
import type { JudgeCasePayload, RuntimeFailure } from "../../src/runtime/protocol.js";
import { RuntimeRegistry } from "../../src/runtime/registry.js";
import { bindRuntimeFailureIdentity } from "../../src/runtime/supervisor-faults.js";
import { FakeRuntimeAdapter } from "../helpers/fake-runtime-adapter.js";

const identity = { runtimeVersion: "handshake-version", buildId: "handshake-build" };

function bounded(text = "", truncated = false) {
  return { text, bytes: new TextEncoder().encode(text).byteLength, truncated };
}

function passed(index: number, actual: JsonValue, stdout = "", stderr = "", truncated = false): JudgeCasePayload {
  return { index, ok: true, actual, stdout: bounded(stdout, truncated), stderr: bounded(stderr) };
}

function failed(index: number, failure: RuntimeFailure, stdout = "", stderr = ""): JudgeCasePayload {
  return { index, ok: false, failure, stdout: bounded(stdout), stderr: bounded(stderr) };
}

function invocation(cases: readonly JudgeCasePayload[]) {
  return { identity, payload: { cases } };
}

function problem(overrides: Partial<Problem> = {}): Problem {
  return {
    schemaVersion: 2,
    id: 1,
    slug: "fixture",
    title: "Fixture",
    difficulty: "Easy",
    summary: "Fixture problem",
    tags: [],
    examples: [],
    constraints: [],
    entrypoint: "solution",
    contract: "json-function-v1",
    templates: { javascript: "function solution(input) { return input; }" },
    tests: {
      public: [{ input: { public: true }, expected: { answer: [1, 2] } }],
      judge: [{ input: { judge: true }, expected: { answer: 3 } }],
    },
    markdown: "",
    safeHtml: "",
    ...overrides,
  };
}

function createRegistry(options: {
  packaged?: boolean;
  judge?: boolean;
  sourceBytes?: number;
  caseCount?: number;
  outputBytes?: number;
  executeMs?: number;
} = {}): RuntimeRegistry {
  const packaged = options.packaged ?? true;
  return RuntimeRegistry.fromManifest(parseRuntimeManifest({
    schemaVersion: 1,
    runtimes: [{
      runtimeId: "javascript-worker",
      languageId: "javascript",
      protocolVersion: 1,
      runtimeVersion: "manifest-version-must-not-leak",
      worker: { url: "workers/javascript-worker.js", type: "module" },
      assets: [],
      required: true,
      packaged,
      ...(packaged ? {} : { unavailableReason: "not packaged for this fixture" }),
      reuse: "per-submission",
      capabilities: { execute: packaged, judge: options.judge ?? packaged },
      timeouts: { initializeMs: 10, executeMs: options.executeMs ?? 50 },
      limits: {
        sourceBytes: options.sourceBytes ?? 262_144,
        caseCount: options.caseCount ?? 100,
        outputBytes: options.outputBytes ?? 65_536,
      },
    }],
  }));
}

function setup(options: Parameters<typeof createRegistry>[0] = {}, now?: () => number) {
  const registry = createRegistry(options);
  const adapters = new RuntimeAdapterRegistry();
  const adapter = new FakeRuntimeAdapter();
  adapters.register(adapter);
  const ticks = [100, 109];
  const engine = new OjEngine({ registry, adapters, now: now ?? (() => ticks.shift() ?? 109) });
  return { adapter, engine, registry };
}

function command(overrides: Partial<JudgeCommand> = {}): JudgeCommand {
  return {
    mode: "submit",
    problem: problem(),
    runtimeId: "javascript-worker",
    source: "function solution(input) { return input; }",
    customCases: [],
    ...overrides,
  };
}

test("returns AC from handshake identity, key-order-insensitive comparisons, and concealed judge data", async () => {
  const { adapter, engine } = setup();
  adapter.outcomes.push(invocation([
    passed(0, { beta: [1, 2], alpha: 1 }, "public output"),
    passed(1, { answer: 3 }, "judge output"),
  ]));

  const result = await engine.run(command({ problem: problem({
    tests: {
      public: [{ input: { public: true }, expected: { alpha: 1, beta: [1, 2] } }],
      judge: [{ input: { judge: true }, expected: { answer: 3 } }],
    },
  }) }));

  assert.equal(result.verdict, "accepted");
  assert.equal(result.elapsedMs, 9);
  assert.deepEqual(result.runtime, { runtimeId: "javascript-worker", ...identity });
  assert.deepEqual(result.publicCases[0]?.comparison, { equal: true });
  assert.deepEqual(result.judgeSummary, { total: 1, passed: 1, failed: 0 });
  assert.equal(result.output.stdout, "public output");
  assert.doesNotMatch(JSON.stringify(result), /judge output|"judge"|answer":3/);
  assert.deepEqual(adapter.judgeCalls[0]?.inputs, [{ public: true }, { judge: true }]);
});

test("returns WA with the main-thread array comparison path and stable first-case precedence", async () => {
  const { adapter, engine } = setup();
  adapter.outcomes.push(invocation([
    passed(1, { answer: 3 }),
    passed(0, { answer: [2, 1] }),
  ]));

  const result = await engine.run(command());

  assert.equal(result.verdict, "wrong-answer");
  assert.deepEqual(result.publicCases[0]?.comparison, {
    equal: false,
    path: "$.answer[0]",
    reason: "value-mismatch",
    actual: 2,
    expected: 1,
  });
});

test("maps per-case compile, runtime, timeout, cancelled, and infrastructure failures", async () => {
  const cases: readonly [string, RuntimeFailure, JudgeCommand["mode"]][] = [
    ["compile-error", { kind: "compile", code: "SYNTAX", message: "bad source", fatal: false }, "run"],
    ["runtime-error", { kind: "runtime", code: "THREW", message: "bad execution", fatal: false }, "run"],
    ["time-limit-exceeded", { kind: "infrastructure", code: "execution-timeout", message: "late", fatal: true }, "run"],
    ["cancelled", { kind: "cancelled", code: "cancelled", message: "stopped", fatal: true }, "run"],
    ["internal-error", { kind: "protocol", code: "protocol-error", message: "broken", fatal: true }, "run"],
  ];

  for (const [verdict, failure, mode] of cases) {
    const { adapter, engine } = setup();
    adapter.outcomes.push(invocation([failed(0, failure)]));
    const result = await engine.run(command({ mode }));
    assert.equal(result.verdict, verdict);
    assert.deepEqual(result.publicCases[0]?.failure, { code: failure.code, message: failure.message });
  }
});

test("maps rejected Supervisor failures and remains usable after timeout and fatal failure", async () => {
  const { adapter, engine } = setup();
  adapter.outcomes.push(
    { rejection: { kind: "infrastructure", code: "execution-timeout", message: "late", fatal: true } },
    { rejection: { kind: "infrastructure", code: "worker-error", message: "fatal", fatal: true } },
    invocation([passed(0, { answer: [1, 2] })]),
  );

  assert.equal((await engine.run(command({ mode: "run" }))).verdict, "time-limit-exceeded");
  assert.equal((await engine.run(command({ mode: "run" }))).verdict, "internal-error");
  assert.equal((await engine.run(command({ mode: "run" }))).verdict, "accepted");
  assert.equal(adapter.judgeCalls.length, 3);
});

test("uses only bound handshake identity for rejected terminal failures", async () => {
  const { adapter, engine } = setup();
  const boundTimeout = bindRuntimeFailureIdentity(
    { kind: "infrastructure", code: "execution-timeout", message: "late", fatal: true },
    identity,
  );
  adapter.outcomes.push(
    { rejection: boundTimeout },
    { rejection: { kind: "infrastructure", code: "execution-timeout", message: "late", fatal: true } },
  );

  const bound = await engine.run(command({ mode: "run" }));
  const unbound = await engine.run(command({ mode: "run" }));

  assert.equal(bound.verdict, "time-limit-exceeded");
  assert.deepEqual(bound.runtime, { runtimeId: "javascript-worker", ...identity });
  assert.equal(unbound.verdict, "time-limit-exceeded");
  assert.equal(unbound.runtime, undefined);
});

test("returns runtime-unavailable without manifest identity for disabled, incompatible, unpackaged, and missing adapters", async () => {
  const disabled = setup({ judge: false });
  assert.equal((await disabled.engine.run(command())).verdict, "runtime-unavailable");
  assert.equal(disabled.adapter.judgeCalls.length, 0);

  const incompatible = setup();
  incompatible.registry.transition("javascript-worker", { kind: "incompatible", expected: 1, received: 2 });
  assert.equal((await incompatible.engine.run(command())).verdict, "runtime-unavailable");

  const unpackaged = setup({ packaged: false, judge: false });
  assert.equal((await unpackaged.engine.run(command())).verdict, "runtime-unavailable");

  const registry = createRegistry();
  const engine = new OjEngine({ registry, adapters: new RuntimeAdapterRegistry(), now: () => 1 });
  const result = await engine.run(command());
  assert.equal(result.verdict, "runtime-unavailable");
  assert.equal(result.runtime, undefined);
});

test("validates source, combined cases, canonical custom JSON, and problem timeout before invoking", async () => {
  const cases: readonly ProblemCase[] = Array.from({ length: 100 }, (_, index) => ({ input: index, expected: index }));
  const { adapter, engine } = setup();

  await assert.rejects(engine.run(command({ source: "x".repeat(262_145) })), /source/i);
  await assert.rejects(engine.run(command({ mode: "run", customCases: cases })), /case/i);
  const nonFiniteCase = JSON.parse('[{"input":null,"expected":null}]');
  nonFiniteCase[0].input = Number.NaN;
  await assert.rejects(engine.run(command({ mode: "run", customCases: nonFiniteCase })), /canonical JSON/i);
  const nonCanonicalCase = JSON.parse('[{"input":null,"expected":null}]');
  nonCanonicalCase[0].input = new Date();
  await assert.rejects(engine.run(command({ mode: "run", customCases: nonCanonicalCase })), /canonical JSON/i);
  await assert.rejects(engine.run(command({ problem: problem({ timeoutMs: 0 }) })), /timeout/i);
  await assert.rejects(engine.run(command({ problem: problem({ timeoutMs: 51 }) })), /timeout/i);
  assert.equal(adapter.judgeCalls.length, 0);
});

test("uses one invocation with the exact command signal, timeout, and phase callback", async () => {
  const { adapter, engine } = setup();
  const controller = new AbortController();
  adapter.outcomes.push(invocation([passed(0, { answer: [1, 2] })]));

  await engine.run(command({ mode: "run", signal: controller.signal, problem: problem({ timeoutMs: 25 }) }));

  assert.equal(adapter.judgeCalls.length, 1);
  assert.equal(adapter.judgeCalls[0]?.options?.signal, controller.signal);
  assert.equal(adapter.judgeCalls[0]?.options?.timeoutMs, 25);
  assert.equal(typeof adapter.judgeCalls[0]?.options?.onPhase, "function");
});

test("includes the phase callback when optional adapter options are absent", async () => {
  const { adapter, engine } = setup();
  adapter.outcomes.push(invocation([passed(0, { answer: [1, 2] })]));

  await engine.run(command({ mode: "run" }));

  assert.deepEqual(Object.keys(adapter.judgeCalls[0]?.options ?? {}).sort(), ["onPhase"]);
  assert.equal(typeof adapter.judgeCalls[0]?.options?.onPhase, "function");
});

test("measures only 12ms of execution after cold initialization and for warm operations", async () => {
  const scenarios: readonly [string, readonly ("initializing" | "executing")[], number][] = [
    ["cold initialization", ["initializing", "executing"], 80],
    ["warm execution", ["executing"], 0],
  ];

  for (const [, phases, initializationMs] of scenarios) {
    let now = 0;
    const { adapter, engine } = setup({}, () => now);
    adapter.phasePlans.push(phases);
    adapter.afterPhase = (phase) => {
      now += phase === "initializing" ? initializationMs : 12;
    };
    adapter.outcomes.push(invocation([passed(0, { answer: [1, 2] })]));

    const result = await engine.run(command({ mode: "run" }));

    assert.equal(result.elapsedMs, 12);
  }
});

test("returns zero elapsed time when initialization fails or cancellation happens before execution", async () => {
  let now = 0;
  const initializationFailure = setup({}, () => now);
  initializationFailure.adapter.phasePlans.push(["initializing"]);
  initializationFailure.adapter.afterPhase = () => {
    now += 80;
  };
  initializationFailure.adapter.outcomes.push({
    rejection: { kind: "runtime", code: "INIT_FAILED", message: "initialization failed", fatal: true },
  });

  const failed = await initializationFailure.engine.run(command({ mode: "run" }));
  assert.equal(failed.elapsedMs, 0);

  let reads = 0;
  const cancelled = setup({}, () => reads++ * 80);
  const controller = new AbortController();
  controller.abort();
  const cancelledResult = await cancelled.engine.run(command({ mode: "run", signal: controller.signal }));
  assert.equal(cancelledResult.elapsedMs, 0);
  assert.equal(cancelled.adapter.judgeCalls.length, 0);
});

test("timeout, runtime failure, and cancellation after execution each retain 12ms", async () => {
  const cases: readonly [RuntimeFailure, string][] = [
    [{ kind: "infrastructure", code: "execution-timeout", message: "late", fatal: true }, "time-limit-exceeded"],
    [{ kind: "runtime", code: "THREW", message: "bad execution", fatal: false }, "runtime-error"],
    [{ kind: "cancelled", code: "cancelled", message: "stopped", fatal: true }, "cancelled"],
  ];

  for (const [failure, verdict] of cases) {
    let now = 0;
    const { adapter, engine } = setup({}, () => now);
    adapter.phasePlans.push(["executing"]);
    adapter.afterPhase = () => {
      now += 12;
    };
    adapter.outcomes.push({ rejection: failure });

    const result = await engine.run(command({ mode: "run" }));

    assert.equal(result.verdict, verdict);
    assert.equal(result.elapsedMs, 12);
  }
});

test("returns cancelled without invoking an already-aborted command", async () => {
  const { adapter, engine } = setup();
  const controller = new AbortController();
  controller.abort();

  const result = await engine.run(command({ mode: "run", signal: controller.signal }));

  assert.equal(result.verdict, "cancelled");
  assert.equal(adapter.judgeCalls.length, 0);
});

test("rejects malformed response indexes as internal errors without exposing judge values", async () => {
  const malformed = [
    [passed(0, { answer: [1, 2] })],
    [passed(0, { answer: [1, 2] }), passed(0, { answer: 3 })],
    [passed(0, { answer: [1, 2] }), passed(1, { answer: 3 }), passed(2, "extra")],
    [passed(0, { answer: [1, 2] }), passed(9, { answer: 3 })],
  ];

  for (const response of malformed) {
    const { adapter, engine } = setup();
    adapter.outcomes.push(invocation(response));
    const result = await engine.run(command());
    assert.equal(result.verdict, "internal-error");
    assert.equal(result.failure?.code, "invalid-judge-response");
    assert.deepEqual(result.runtime, { runtimeId: "javascript-worker", ...identity });
    assert.doesNotMatch(JSON.stringify(result), /"judge"|answer":3/);
  }
});

test("aggregates visible logs in selected order, preserves truncation, and excludes judge logs and details", async () => {
  const { adapter, engine } = setup();
  adapter.outcomes.push(invocation([
    passed(2, { answer: 3 }, "judge stdout", "judge stderr"),
    passed(1, "custom expected", "custom stdout", "custom stderr", true),
    passed(0, { answer: [1, 2] }, "public stdout", "public stderr"),
  ]));

  const result = await engine.run(command({ customCases: [{ input: "custom", expected: "custom expected" }] }));

  assert.deepEqual(result.output, {
    stdout: "public stdoutcustom stdout",
    stderr: "public stderrcustom stderr",
    truncated: true,
  });
  assert.doesNotMatch(JSON.stringify(result), /judge stdout|judge stderr|answer":3/);
});
