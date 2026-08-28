import { type JsonValue } from "../domain/json-value.js";
import { type RuntimeId } from "../domain/language.js";
import { type JudgeCommand, type SubmissionResult } from "../domain/submission.js";
import { OjEngine } from "../oj/engine.js";
import { getProblemById, loadProblems } from "../problems/problem-modules.js";
import { createJavascriptAdapter } from "../runtime/adapters/javascript.js";
import { createHaskellAdapter } from "../runtime/adapters/haskell.js";
import { createPythonAdapter } from "../runtime/adapters/python.js";
import { createRacketAdapter } from "../runtime/adapters/racket.js";
import { createRustPythonAdapter } from "../runtime/adapters/rustpython.js";
import { createTypescriptAdapter } from "../runtime/adapters/typescript.js";
import { RuntimeAdapterRegistry } from "../runtime/adapters/registry.js";
import { createBrowserWorkerFactory } from "../runtime/browser-worker-factory.js";
import { parseRuntimeManifest } from "../runtime/manifest.js";
import { OptionalRuntimeVerifier, type RuntimeVerification } from "../runtime/optional-verification.js";
import { createPythonCorpusFixtures } from "../runtime/python-parity.js";
import { type ExecutePayload, type InitializePayload, type JudgePayload } from "../runtime/protocol.js";
import { RuntimeRegistry } from "../runtime/registry.js";
import { RuntimeSupervisor, type RuntimeInvocation, type RuntimeOperationOptions } from "../runtime/supervisor.js";

interface HarnessSurface {
  initialize(runtimeId: RuntimeId): Promise<InitializePayload>;
  execute(
    runtimeId: RuntimeId,
    source: string,
    options?: RuntimeOperationOptions,
  ): Promise<RuntimeInvocation<ExecutePayload>>;
  judge(
    runtimeId: RuntimeId,
    source: string,
    inputs: readonly JsonValue[],
    options?: RuntimeOperationOptions,
  ): Promise<RuntimeInvocation<JudgePayload>>;
  judgeProblem(command: Omit<JudgeCommand, "problem" | "signal"> & { readonly problemId: number }): Promise<SubmissionResult>;
  verifyOptional(runtimeId: RuntimeId): Promise<RuntimeVerification>;
  dispose(runtimeId?: RuntimeId): Promise<void>;
}

declare global {
  interface Window {
    localCoderHarness: HarnessSurface;
  }
}

const resultElement = document.querySelector<HTMLPreElement>('[data-testid="runtime-harness-result"]');
const surface = createSurface();

window.localCoderHarness = {
  initialize: (runtimeId) => report(surface.then(({ supervisor }) => supervisor.initialize(runtimeId))),
  execute: (runtimeId, source, options) => report(surface.then(({ adapters }) => (
    adapters.get(runtimeId).execute(source, options)
  ))),
  judge: (runtimeId, source, inputs, options) => report(surface.then(({ adapters }) => (
    adapters.get(runtimeId).judge(source, inputs, options)
  ))),
  judgeProblem: (command) => report(surface.then(async ({ adapters, registry }) => {
    const problem = await getProblemById(command.problemId);
    if (problem === undefined) throw new RangeError(`Problem ${command.problemId} does not exist`);
    const engine = new OjEngine({ registry, adapters, now: () => performance.now() });
    return engine.run({
      mode: command.mode,
      problem,
      runtimeId: command.runtimeId,
      source: command.source,
      customCases: command.customCases,
    });
  })),
  verifyOptional: (runtimeId) => report(surface.then(({ optionalRuntimes }) => optionalRuntimes.verify(runtimeId))),
  dispose: (runtimeId) => report(surface.then(({ supervisor }) => supervisor.dispose(runtimeId))),
};

void postOptionalVerificationReceipt().catch((error: unknown) => {
  writeResult(error instanceof Error ? { name: error.name, message: error.message } : error);
});

async function createSurface() {
  const response = await fetch(new URL("runtime-manifest.json", document.baseURI));
  if (!response.ok) throw new Error(`Runtime manifest request failed with ${response.status}`);
  const manifestText = await response.text();
  const manifestDocument = parseRuntimeManifest(JSON.parse(manifestText) as unknown);
  const registry = RuntimeRegistry.fromManifest(manifestDocument);
  const supervisor = new RuntimeSupervisor({
    registry,
    workerFactory: createBrowserWorkerFactory(document.baseURI),
  });
  const adapters = new RuntimeAdapterRegistry();
  adapters.register(createJavascriptAdapter(supervisor));
  adapters.register(createTypescriptAdapter(supervisor));
  adapters.register(createPythonAdapter(supervisor, "python-pyodide"));
  adapters.register(createRustPythonAdapter(supervisor));
  adapters.register(createRacketAdapter(supervisor));
  adapters.register(createHaskellAdapter(supervisor));
  const optionalRuntimes = new OptionalRuntimeVerifier({
    registry,
    supervisor,
    adapters,
    pythonCorpus: async () => createPythonCorpusFixtures(await loadProblems()),
  });
  return { adapters, registry, supervisor, optionalRuntimes, manifestDocument, manifestText };
}

async function postOptionalVerificationReceipt(): Promise<void> {
  const query = new URLSearchParams(window.location.search);
  if (query.get("suite") !== "optional-v1") return;
  const runtimeId = query.get("runtimeId");
  const receiptPort = parseReceiptPort(query.get("receiptPort"));
  if (runtimeId === null || receiptPort === undefined) return;

  const prepared = await surface;
  if (!prepared.manifestDocument.runtimes.some((entry) => entry.runtimeId === runtimeId)) return;
  const verification = await prepared.optionalRuntimes.verify(runtimeId as RuntimeId);
  const runtime = prepared.manifestDocument.runtimes.find((entry) => entry.runtimeId === runtimeId);
  if (runtime === undefined) return;
  const assets = await Promise.all(runtime.assets.map(async (asset) => ({
    url: asset.url,
    sha256: await sha256(await readAsset(asset.url)),
  })));
  const receipt = {
    suite: "optional-v1",
    runtimeId,
    protocolVersion: runtime.protocolVersion,
    verification,
    manifestSha256: await sha256(new TextEncoder().encode(prepared.manifestText)),
    assets,
  };
  const response = await fetch(`http://127.0.0.1:${receiptPort}/receipt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(receipt),
  });
  if (!response.ok) throw new Error(`Runtime verification receipt was rejected with ${response.status}`);
}

function parseReceiptPort(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const port = Number(value);
  return Number.isSafeInteger(port) && port > 0 && port <= 65_535 ? port : undefined;
}

async function readAsset(url: string): Promise<ArrayBuffer> {
  const response = await fetch(new URL(url, document.baseURI));
  if (!response.ok) throw new Error(`Runtime asset request failed with ${response.status}`);
  return response.arrayBuffer();
}

async function sha256(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function report<T>(operation: Promise<T>): Promise<T> {
  try {
    const result = await operation;
    writeResult(result);
    return result;
  } catch (error) {
    writeResult(error instanceof Error ? { name: error.name, message: error.message } : error);
    throw error;
  }
}

function writeResult(value: unknown): void {
  if (resultElement !== null) resultElement.textContent = JSON.stringify(value, null, 2);
}
