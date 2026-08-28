import { createWorkerEndpoint } from "./shared/endpoint.js";
import { createJavaScriptRuntime } from "./javascript/evaluator.js";
import { createTypeScriptAssetRuntime, type TypeScriptAssetScope } from "./javascript/typescript-compiler.js";

type WorkerEndpoint = ReturnType<typeof createWorkerEndpoint>;

const workerScope = globalThis as unknown as TypeScriptAssetScope & {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
};

let endpoint: WorkerEndpoint | undefined;

workerScope.addEventListener("message", (event) => {
  void selectedEndpoint(event)(event);
});

function selectedEndpoint(event: MessageEvent<unknown>): WorkerEndpoint {
  if (endpoint !== undefined) return endpoint;
  endpoint = runtimeIdOf(event.data) === "typescript-official"
    ? createWorkerEndpoint({
      runtimeId: "typescript-official",
      runtime: createTypeScriptAssetRuntime(workerScope),
      post: (message) => workerScope.postMessage(message),
    })
    : createWorkerEndpoint({
      runtimeId: "javascript-worker",
      runtime: createJavaScriptRuntime(),
      post: (message) => workerScope.postMessage(message),
    });
  return endpoint;
}

function runtimeIdOf(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const runtimeId = (value as Record<string, unknown>).runtimeId;
  return typeof runtimeId === "string" ? runtimeId : undefined;
}
