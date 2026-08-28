/// <reference types="vite/client" />

import { OjEngine } from "../oj/engine.js";
import type { ProblemRepository } from "../problems/problem-repository.js";
import {
  createJavascriptAdapter,
  createHaskellAdapter,
  createPythonAdapter,
  createRacketAdapter,
  createRustPythonAdapter,
  createTypescriptAdapter,
  RuntimeAdapterRegistry,
} from "../runtime/adapters/registry.js";
import { createBrowserWorkerFactory } from "../runtime/browser-worker-factory.js";
import { parseRuntimeManifest, type RuntimeManifestDocument } from "../runtime/manifest.js";
import { OptionalRuntimeVerifier } from "../runtime/optional-verification.js";
import { createPythonCorpusFixtures } from "../runtime/python-parity.js";
import { RuntimeRegistry } from "../runtime/registry.js";
import { RuntimeSupervisor } from "../runtime/supervisor.js";
import type { Clock, WorkerFactory } from "../runtime/worker-port.js";
import { runLegacyMigration } from "../storage/legacy-migration.js";
import { LocalCoderRepository, openLocalCoderRepository } from "../storage/repository.js";
import { SubmissionService } from "./submission-service.js";

const REQUIRED_RUNTIME_IDS = [
  "javascript-worker",
  "typescript-official",
  "python-pyodide",
] as const;

export interface AppServices {
  problems: ProblemRepository;
  registry: RuntimeRegistry;
  supervisor: RuntimeSupervisor;
  adapters: RuntimeAdapterRegistry;
  optionalRuntimes: OptionalRuntimeVerifier;
  engine: OjEngine;
  storage: LocalCoderRepository;
  submissions: SubmissionService;
}

export interface AppServiceDependencies {
  problems?: ProblemRepository;
  manifestUrl?: string;
  fetchJson?: (url: string) => Promise<unknown>;
  workerFactory?: WorkerFactory;
  indexedDB?: IDBFactory;
  legacyStorage?: Storage;
  clock?: Clock;
  now?: () => number;
}

export async function createAppServices(deps: AppServiceDependencies = {}): Promise<AppServices> {
  const problems = deps.problems ?? await loadProblemRepository();
  const manifestUrl = deps.manifestUrl ?? browserManifestUrl();
  const fetchJson = deps.fetchJson ?? fetchJsonFromBrowser;
  const manifest = parseRuntimeManifest(await fetchJson(manifestUrl));
  assertRequiredRuntimes(manifest);

  const registry = RuntimeRegistry.fromManifest(manifest);
  const workerFactory = deps.workerFactory ?? createBrowserWorkerFactory(browserBaseUrl());
  const supervisor = new RuntimeSupervisor({
    registry,
    workerFactory,
    ...(deps.clock === undefined ? {} : { clock: deps.clock }),
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
    pythonCorpus: async () => createPythonCorpusFixtures(await problems.list()),
  });
  const now = deps.now ?? Date.now;
  const engine = new OjEngine({ registry, adapters, now });
  const indexedDB = injectedOrBrowserIndexedDb(deps);
  const storage = await openLocalCoderRepository({
    now,
    ...(indexedDB === undefined ? {} : { indexedDB }),
  });
  const legacyStorage = injectedOrBrowserLegacyStorage(deps);
  if (legacyStorage !== undefined) await runLegacyMigration({ repository: storage, legacy: legacyStorage, now });

  const submissions = new SubmissionService({ engine, repository: storage, now });
  return { problems, registry, supervisor, adapters, optionalRuntimes, engine, storage, submissions };
}

async function loadProblemRepository(): Promise<ProblemRepository> {
  const modules = await import("../problems/problem-modules.js");
  return { list: modules.loadProblems, getById: modules.getProblemById };
}

async function fetchJsonFromBrowser(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Runtime manifest request failed with ${response.status}`);
  return response.json();
}

function assertRequiredRuntimes(manifest: RuntimeManifestDocument): void {
  for (const runtimeId of REQUIRED_RUNTIME_IDS) {
    const runtime = manifest.runtimes.find((entry) => entry.runtimeId === runtimeId);
    if (runtime === undefined || !runtime.packaged || !runtime.capabilities.execute || !runtime.capabilities.judge) {
      throw new Error(`Required runtime ${runtimeId} is unavailable`);
    }
  }
}

function browserManifestUrl(): string {
  if (typeof document === "undefined") throw new Error("Browser document is unavailable");
  return resolveBrowserAssetUrl("runtime-manifest.json", import.meta.env.BASE_URL, document.baseURI);
}

function browserBaseUrl(): string {
  if (typeof document === "undefined") throw new Error("Browser document is unavailable");
  return resolveBrowserBaseUrl(import.meta.env.BASE_URL, document.baseURI);
}

export function resolveBrowserAssetUrl(asset: string, baseUrl: unknown, documentBaseUri: string): string {
  const resolved = new URL(asset, resolveBrowserBaseUrl(baseUrl, documentBaseUri));
  return `${resolved.pathname}${resolved.search}`;
}

function resolveBrowserBaseUrl(baseUrl: unknown, documentBaseUri: string): string {
  const deploymentBaseUrl = validateDeploymentBaseUrl(baseUrl) ?? "/";
  return new URL(deploymentBaseUrl, documentBaseUri).toString();
}

function validateDeploymentBaseUrl(baseUrl: unknown): string | undefined {
  if (baseUrl === undefined || baseUrl === "") return undefined;
  if (typeof baseUrl !== "string" || (!baseUrl.startsWith("/") && !baseUrl.startsWith("./"))) {
    throw new Error("Vite base URL must be deployment-relative");
  }
  return baseUrl;
}

function injectedOrBrowserIndexedDb(deps: AppServiceDependencies): IDBFactory | undefined {
  if (Object.prototype.hasOwnProperty.call(deps, "indexedDB")) return deps.indexedDB;
  return globalThis.indexedDB;
}

function injectedOrBrowserLegacyStorage(deps: AppServiceDependencies): Storage | undefined {
  if (Object.prototype.hasOwnProperty.call(deps, "legacyStorage")) return deps.legacyStorage;
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
