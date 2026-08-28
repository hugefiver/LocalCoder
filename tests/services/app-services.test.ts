import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Problem, ProblemCase } from "../../src/domain/problem.js";
import type { ProblemRepository } from "../../src/problems/problem-repository.js";
import { PYTHON_CORPUS_SOURCES } from "../../src/runtime/python-parity.js";
import type { WorkerRequest } from "../../src/runtime/protocol.js";
import { createAppServices, resolveBrowserAssetUrl } from "../../src/services/app-services.js";
import type { Clock, WorkerFactory } from "../../src/runtime/worker-port.js";
import { FakeWorker } from "../helpers/fake-worker.js";
import { MemoryLegacyStorage } from "../helpers/memory-legacy-storage.js";

const NOW = 1_700_000_000_000;

test("browser assets use the Vite deployment base instead of a deep route", () => {
  assert.equal(
    resolveBrowserAssetUrl("runtime-manifest.json", "/", "https://local.test/problems/1"),
    "/runtime-manifest.json",
  );
  assert.equal(
    resolveBrowserAssetUrl("runtime-manifest.json", "./", "https://local.test/localcoder/#/problems/1"),
    "/localcoder/runtime-manifest.json",
  );
});

function runtime(runtimeId: string, languageId: string, required: boolean, packaged = true): Record<string, unknown> {
  return {
    runtimeId,
    languageId,
    protocolVersion: 1,
    runtimeVersion: "fixture-version",
    worker: { url: `workers/${runtimeId}.js`, type: "module" },
    assets: [],
    required,
    packaged,
    ...(packaged ? {} : { unavailableReason: "not packaged for this fixture" }),
    reuse: "per-submission",
    capabilities: { execute: packaged, judge: packaged },
    timeouts: { initializeMs: 1_000, executeMs: 5_000 },
    limits: { sourceBytes: 262_144, caseCount: 100, outputBytes: 65_536 },
  };
}

function manifest(options: { unavailableRequired?: boolean; rustPythonPackaged?: boolean; haskellPackaged?: boolean } = {}): unknown {
  return {
    schemaVersion: 1,
    runtimes: [
      runtime("javascript-worker", "javascript", true, !options.unavailableRequired),
      runtime("typescript-official", "typescript", true),
      runtime("python-pyodide", "python", true),
      runtime("python-rustpython", "python", false, options.rustPythonPackaged ?? false),
      runtime("racket-wasm", "racket", false, false),
      runtime("haskell-ghc-wasi", "haskell", false, options.haskellPackaged ?? false),
    ],
  };
}

function dependencies(fetchJson: (url: string) => Promise<unknown>) {
  const problems: ProblemRepository = {
    list: async () => [],
    getById: async () => undefined,
  };
  const workerFactory: WorkerFactory = () => {
    throw new Error("Worker creation is not expected during composition");
  };
  const clock: Clock = {
    now: () => NOW,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  };
  return {
    problems,
    manifestUrl: "runtime-manifest.json",
    fetchJson,
    workerFactory,
    indexedDB: failingIndexedDbFactory(),
    clock,
    now: () => NOW,
  };
}

function failingIndexedDbFactory(): IDBFactory {
  return {
    open(): IDBOpenDBRequest {
      throw new Error("injected IndexedDB is unavailable");
    },
    deleteDatabase(): IDBOpenDBRequest {
      throw new Error("injected IndexedDB is unavailable");
    },
    cmp: () => 0,
    databases: async () => [],
  };
}

test("composes injected services, required adapters, optional registry entries, and legacy migration without React", async () => {
  const requestedUrls: string[] = [];
  const legacyStorage = new MemoryLegacyStorage({
    "problem-2-code-javascript": JSON.stringify("function solution(value) { return value; }"),
    "solved-problems": JSON.stringify([2]),
  });
  const injected = dependencies(async (url) => {
    requestedUrls.push(url);
    return manifest();
  });

  const services = await createAppServices({ ...injected, legacyStorage });

  assert.strictEqual(services.problems, injected.problems);
  assert.deepEqual(requestedUrls, ["runtime-manifest.json"]);
  assert.deepEqual(services.registry.list().map(({ runtimeId }) => runtimeId), [
    "javascript-worker",
    "typescript-official",
    "python-pyodide",
    "python-rustpython",
    "racket-wasm",
    "haskell-ghc-wasi",
  ]);
  assert.equal(services.registry.get("python-rustpython").state.kind, "not-packaged");
  assert.equal(services.adapters.get("javascript-worker").languageId, "javascript");
  assert.equal(services.adapters.get("typescript-official").languageId, "typescript");
  assert.equal(services.adapters.get("python-pyodide").languageId, "python");
  assert.equal(services.adapters.get("python-rustpython").languageId, "python");
  assert.equal(services.adapters.get("racket-wasm").languageId, "racket");
  assert.equal(services.adapters.get("haskell-ghc-wasi").languageId, "haskell");
  assert.equal(services.registry.get("haskell-ghc-wasi").state.kind, "not-packaged");
  assert.strictEqual(services.optionalRuntimes, services.optionalRuntimes);
  assert.deepEqual(await services.optionalRuntimes.verify("racket-wasm"), {
    state: "unavailable",
    runtimeId: "racket-wasm",
    reason: "not packaged for this fixture",
  });
  assert.deepEqual(await services.optionalRuntimes.verify("haskell-ghc-wasi"), {
    state: "unavailable",
    runtimeId: "haskell-ghc-wasi",
    reason: "not packaged for this fixture",
  });
  assert.deepEqual(await services.storage.getProgress(2), {
    problemId: 2,
    attempts: 1,
    lastAttemptAt: NOW,
    acceptedAt: NOW,
  });
  assert.deepEqual(await services.storage.getDraft(["problem:2", "javascript", "javascript-worker"]), {
    workspaceId: "problem:2",
    languageId: "javascript",
    runtimeId: "javascript-worker",
    source: "function solution(value) { return value; }",
    updatedAt: NOW,
  });
  const source = await readFile(new URL("../../src/services/app-services.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from\s+["'][^"']*react(?:-dom)?[^"']*["']/i);

  await services.supervisor.dispose();
  services.storage.close();
});

test("rejects readiness when the manifest fetch, parser, or required runtime availability fails", async () => {
  await assert.rejects(
    createAppServices(dependencies(async () => {
      throw new Error("manifest fetch blocked");
    })),
    /manifest fetch blocked/,
  );
  await assert.rejects(
    createAppServices(dependencies(async () => ({ schemaVersion: 2, runtimes: [] }))),
    /schemaVersion/,
  );
  await assert.rejects(
    createAppServices(dependencies(async () => manifest({ unavailableRequired: true }))),
    /Required runtime javascript-worker/,
  );
});

test("the shared optional verifier enables registered RustPython only after its packaged Pyodide parity sequence", async () => {
  const problems = pythonCorpusProblems();
  const expectedBySource = new Map<string, readonly ProblemCase[]>(problems.map((problem) => [
    PYTHON_CORPUS_SOURCES[problem.id as keyof typeof PYTHON_CORPUS_SOURCES],
    [...problem.tests.public, ...problem.tests.judge],
  ]));
  const workers: VerificationWorker[] = [];
  const workerFactory: WorkerFactory = (entry) => {
    const worker = new VerificationWorker(workers.length + 1, entry.runtimeId, expectedBySource);
    workers.push(worker);
    return worker;
  };
  const repository: ProblemRepository = {
    list: async () => problems,
    getById: async (problemId) => problems.find((problem) => problem.id === problemId),
  };
  const services = await createAppServices({
    ...dependencies(async () => manifest({ rustPythonPackaged: true })),
    problems: repository,
    workerFactory,
  });

  const verification = await services.optionalRuntimes.verify("python-rustpython");

  assert.equal(verification.state, "verified");
  if (verification.state === "verified") {
    assert.deepEqual(verification.checks, ["assets", "handshake", "smoke", "judge-contract", "pyodide-corpus-parity"]);
  }
  assert.equal(services.registry.get("python-rustpython").state.kind, "ready");
  assert.equal(services.adapters.get("python-rustpython").runtimeId, "python-rustpython");
  assert.equal(workers.some((worker) => worker.runtimeId === "python-rustpython"), true);
  await services.supervisor.dispose();
  services.storage.close();
});

test("the shared optional verifier enables Haskell only after its complete generic verification sequence", async () => {
  const workers: VerificationWorker[] = [];
  const workerFactory: WorkerFactory = (entry) => {
    const worker = new VerificationWorker(workers.length + 1, entry.runtimeId, new Map());
    workers.push(worker);
    return worker;
  };
  const services = await createAppServices({
    ...dependencies(async () => manifest({ haskellPackaged: true })),
    workerFactory,
  });

  const verification = await services.optionalRuntimes.verify("haskell-ghc-wasi");

  assert.deepEqual(verification, {
    state: "verified",
    runtimeId: "haskell-ghc-wasi",
    runtimeVersion: "haskell-ghc-wasi-fake",
    checks: ["assets", "handshake", "smoke", "judge-contract"],
  });
  assert.equal(services.registry.get("haskell-ghc-wasi").state.kind, "ready");
  assert.equal(services.registry.resolveDefault("haskell", "judge")?.runtimeId, "haskell-ghc-wasi");
  assert.equal(workers.some((worker) => worker.runtimeId === "haskell-ghc-wasi"), true);
  await services.supervisor.dispose();
  services.storage.close();
});

class VerificationWorker extends FakeWorker {
  constructor(
    generation: number,
    readonly runtimeId: "javascript-worker" | "typescript-official" | "python-pyodide" | "python-rustpython" | "racket-wasm" | "haskell-ghc-wasi",
    private readonly expectedBySource: ReadonlyMap<string, readonly ProblemCase[]>,
  ) {
    super(generation);
  }

  override postMessage(request: WorkerRequest): void {
    super.postMessage(request);
    queueMicrotask(() => this.respond(request));
  }

  private respond(request: WorkerRequest): void {
    const envelope = { protocolVersion: 1 as const, requestId: request.requestId, runtimeId: request.runtimeId };
    if (request.type === "initialize") {
      this.emit({
        ...envelope,
        type: "complete",
        operation: "initialize",
        payload: { runtimeVersion: `${request.runtimeId}-fake`, buildId: `${request.runtimeId}-build`, capabilities: { execute: true, judge: true } },
      });
      return;
    }
    if (request.type === "execute") {
      this.emit({ ...envelope, type: "complete", operation: "execute", payload: { stdout: bounded(), stderr: bounded(), value: null } });
      return;
    }
    if (request.type === "judge") {
      const expected = this.expectedBySource.get(request.source);
      this.emit({
        ...envelope,
        type: "complete",
        operation: "judge",
        payload: {
          cases: request.cases.map((testCase, index) => ({
            index: testCase.index,
            ok: true,
            actual: expected === undefined ? testCase.input : expected[index]?.expected,
            stdout: bounded(),
            stderr: bounded(),
          })),
        },
      });
    }
  }
}

function pythonCorpusProblems(): readonly Problem[] {
  return [1, 2, 3, 4, 5, 6].map((id) => ({
    schemaVersion: 2,
    id,
    slug: `problem-${id}`,
    title: `Problem ${id}`,
    difficulty: "Easy",
    summary: "Parity fixture",
    tags: [],
    examples: [],
    constraints: [],
    entrypoint: "solution",
    contract: "json-function-v1",
    templates: {},
    tests: {
      public: [{ input: { id, phase: "public-one" }, expected: { id, phase: "public-one" } }, { input: { id, phase: "public-two" }, expected: { id, phase: "public-two" } }],
      judge: [{ input: { id, phase: "judge" }, expected: { id, phase: "judge" } }],
    },
    markdown: "",
    safeHtml: "",
  }));
}

function bounded(text = "") {
  return { text, bytes: new TextEncoder().encode(text).byteLength, truncated: false };
}
