import { MAX_OUTPUT_BYTES } from "../runtime/protocol.js";
import { createEmscriptenRacketHost, isEmscriptenRacketLike, type EmscriptenRacketLike } from "./racket/emscripten-host.js";
import { createWorkerEndpoint } from "./shared/endpoint.js";
import { RuntimeFailureError } from "./shared/runtime-errors.js";

export interface RacketAssetScope {
  readonly location: { readonly href: string };
  importScripts(...urls: string[]): void;
  readonly createRacketModule?: (options: {
    readonly noInitialRun: true;
    readonly locateFile: (file: string) => string;
  }) => Promise<unknown> | unknown;
}

interface RacketWorkerScope extends RacketAssetScope {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
}

export function createLocalRacketLoader(scope: RacketAssetScope): () => Promise<EmscriptenRacketLike> {
  let scriptImported = false;
  return async (): Promise<EmscriptenRacketLike> => {
    const runtimeUrl = new URL("racket/", new URL("./", scope.location.href));
    if (!scriptImported) {
      try {
        scope.importScripts(new URL("racket.js", runtimeUrl).href);
        scriptImported = true;
      } catch {
        throw infrastructureError("racket-asset-missing", "Local Racket asset could not be loaded");
      }
    }
    if (typeof scope.createRacketModule !== "function") {
      throw infrastructureError("racket-api-incompatible", "Local Racket asset did not expose createRacketModule");
    }
    try {
      const runtime = await scope.createRacketModule({
        noInitialRun: true,
        locateFile: (file) => new URL(file, runtimeUrl).href,
      });
      if (!isEmscriptenRacketLike(runtime)) {
        throw infrastructureError("racket-api-incompatible", "Local Racket asset has an incompatible Emscripten API");
      }
      return runtime;
    } catch (error) {
      if (error instanceof RuntimeFailureError) throw error;
      throw infrastructureError("racket-initialization-failed", "Local Racket runtime could not initialize");
    }
  };
}

export function installRacketWorker(scope: RacketWorkerScope): void {
  const endpoint = createWorkerEndpoint({
    runtimeId: "racket-wasm",
    runtime: createEmscriptenRacketHost({
      load: createLocalRacketLoader(scope),
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

const workerScope = globalThis as unknown as Partial<RacketWorkerScope>;
if (
  typeof workerScope.addEventListener === "function"
  && typeof workerScope.postMessage === "function"
  && typeof workerScope.importScripts === "function"
  && workerScope.location !== undefined
) {
  installRacketWorker(workerScope as RacketWorkerScope);
}
