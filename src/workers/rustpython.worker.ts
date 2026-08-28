import { MAX_OUTPUT_BYTES } from "../runtime/protocol.js";
import { createRustPythonHost } from "./rustpython/host.js";
import { createWorkerEndpoint } from "./shared/endpoint.js";
import { runWasiModule } from "./wasi/runner.js";

export interface RustPythonAssetScope {
  readonly location: { readonly href: string };
  fetch(input: RequestInfo | URL): Promise<Response>;
}

interface RustPythonWorkerScope extends RustPythonAssetScope {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
}

export function createLocalRustPythonFetcher(scope: RustPythonAssetScope): (url: string) => Promise<ArrayBuffer> {
  return async (url: string): Promise<ArrayBuffer> => {
    const response = await scope.fetch(new URL(url, new URL("./", scope.location.href)));
    if (!response.ok) throw new Error(`RustPython asset request failed with ${response.status}`);
    return response.arrayBuffer();
  };
}

export function installRustPythonWorker(scope: RustPythonWorkerScope): void {
  const endpoint = createWorkerEndpoint({
    runtimeId: "python-rustpython",
    runtime: createRustPythonHost({
      fetchBytes: createLocalRustPythonFetcher(scope),
      runWasi: runWasiModule,
      outputBytes: MAX_OUTPUT_BYTES,
      buildId: injectedBuildId(),
    }),
    post: (message) => scope.postMessage(message),
  });
  scope.addEventListener("message", (event) => {
    void endpoint(event);
  });
}

function injectedBuildId(): string {
  return typeof __LOCALCODER_BUILD_ID__ === "string" ? __LOCALCODER_BUILD_ID__ : "development";
}

declare const __LOCALCODER_BUILD_ID__: string;

const workerScope = globalThis;
if (isRustPythonWorkerScope(workerScope)) {
  installRustPythonWorker(workerScope);
}

function isRustPythonWorkerScope(scope: object): scope is typeof globalThis & RustPythonWorkerScope {
  const location = Reflect.get(scope, "location");
  return typeof Reflect.get(scope, "addEventListener") === "function"
    && typeof Reflect.get(scope, "postMessage") === "function"
    && typeof Reflect.get(scope, "fetch") === "function"
    && location !== null
    && typeof location === "object"
    && typeof Reflect.get(location, "href") === "string";
}
