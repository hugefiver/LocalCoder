import { MAX_OUTPUT_BYTES } from "../runtime/protocol.js";
import { createWorkerEndpoint } from "./shared/endpoint.js";
import {
  createPyodideHost,
  isPyodideLike,
  type PyodideLike,
} from "./python/pyodide-host.js";
import { RuntimeFailureError } from "./shared/runtime-errors.js";

export interface PyodideAssetScope {
  readonly location: { readonly href: string };
  importScripts(...urls: string[]): void;
  readonly loadPyodide?: (options: { readonly indexURL: string }) => Promise<unknown>;
}

interface PyodideWorkerScope extends PyodideAssetScope {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
}

export function createLocalPyodideLoader(scope: PyodideAssetScope): () => Promise<PyodideLike> {
  let scriptImported = false;

  return async (): Promise<PyodideLike> => {
    const indexURL = new URL("pyodide/", new URL("./", scope.location.href)).href;
    if (!scriptImported) {
      try {
        scope.importScripts(new URL("pyodide.js", indexURL).href);
        scriptImported = true;
      } catch {
        throw infrastructureError("pyodide-asset-missing", "Local Pyodide asset could not be loaded");
      }
    }
    if (typeof scope.loadPyodide !== "function") {
      throw infrastructureError("pyodide-api-incompatible", "Local Pyodide asset did not expose loadPyodide");
    }
    let pyodide: unknown;
    try {
      pyodide = await scope.loadPyodide({ indexURL });
    } catch (error) {
      if (error instanceof RuntimeFailureError) throw error;
      throw infrastructureError("pyodide-initialization-failed", "Local Pyodide runtime could not initialize");
    }
    if (!isPyodideLike(pyodide) || typeof pyodide.version !== "string" || pyodide.version.trim().length === 0) {
      throw infrastructureError("pyodide-api-incompatible", "Local Pyodide asset has an incompatible API");
    }
    return pyodide;
  };
}

export function installPyodideWorker(scope: PyodideWorkerScope): void {
  const endpoint = createWorkerEndpoint({
    runtimeId: "python-pyodide",
    runtime: createPyodideHost({
      load: createLocalPyodideLoader(scope),
      outputBytes: MAX_OUTPUT_BYTES,
      buildId: injectedBuildId(),
    }),
    post: (message) => scope.postMessage(message),
  });
  scope.addEventListener("message", (event) => {
    void endpoint(event);
  });
}

function infrastructureError(code: string, message: string): RuntimeFailureError {
  return new RuntimeFailureError({ kind: "infrastructure", code, message, fatal: true });
}

function injectedBuildId(): string {
  return typeof __LOCALCODER_BUILD_ID__ === "string" ? __LOCALCODER_BUILD_ID__ : "development";
}

declare const __LOCALCODER_BUILD_ID__: string;

const workerScope = globalThis as unknown as Partial<PyodideWorkerScope>;
if (
  typeof workerScope.addEventListener === "function"
  && typeof workerScope.postMessage === "function"
  && typeof workerScope.importScripts === "function"
  && workerScope.location !== undefined
) {
  installPyodideWorker(workerScope as PyodideWorkerScope);
}
