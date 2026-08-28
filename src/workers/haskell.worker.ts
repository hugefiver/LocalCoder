import { MAX_OUTPUT_BYTES } from "../runtime/protocol.js";
import { createHaskellAssetLoader, type HaskellAssetScope } from "./haskell/assets.js";
import { createHaskellHost, type HaskellWasiShim } from "./haskell/ghc-host.js";
import { createWorkerEndpoint } from "./shared/endpoint.js";

export interface HaskellWorkerScope extends HaskellAssetScope {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
}

export function createLocalHaskellWasiShimLoader(scope: HaskellAssetScope): (url: string) => Promise<HaskellWasiShim> {
  return async (url: string): Promise<HaskellWasiShim> => {
    const target = new URL(url);
    const base = new URL("./", scope.location.href);
    if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) {
      throw new TypeError("Haskell WASI shim must be same-origin and local");
    }
    return import(/* @vite-ignore */ target.href) as Promise<HaskellWasiShim>;
  };
}

export function installHaskellWorker(scope: HaskellWorkerScope): void {
  const endpoint = createWorkerEndpoint({
    runtimeId: "haskell-ghc-wasi",
    runtime: createHaskellHost({
      loadAssets: createHaskellAssetLoader(scope),
      loadWasiShim: createLocalHaskellWasiShimLoader(scope),
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
if (isHaskellWorkerScope(workerScope)) installHaskellWorker(workerScope);

function isHaskellWorkerScope(scope: object): scope is typeof globalThis & HaskellWorkerScope {
  const location = Reflect.get(scope, "location");
  return typeof Reflect.get(scope, "addEventListener") === "function"
    && typeof Reflect.get(scope, "postMessage") === "function"
    && typeof Reflect.get(scope, "fetch") === "function"
    && location !== null
    && typeof location === "object"
    && typeof Reflect.get(location, "href") === "string";
}
