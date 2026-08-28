import { type RuntimeManifestEntry } from "./manifest.js";
import {
  type WorkerErrorListener,
  type WorkerFactory,
  type WorkerMessageListener,
  type WorkerPort,
} from "./worker-port.js";
import { type WorkerRequest } from "./protocol.js";

interface BrowserWorker {
  addEventListener(type: "message", listener: WorkerMessageListener): void;
  addEventListener(type: "error", listener: WorkerErrorListener): void;
  removeEventListener(type: "message", listener: WorkerMessageListener): void;
  removeEventListener(type: "error", listener: WorkerErrorListener): void;
  postMessage(message: WorkerRequest): void;
  terminate(): void;
}

export type BrowserWorkerConstructor = new (url: string | URL, options?: WorkerOptions) => BrowserWorker;

function browserWorkerConstructor(candidate?: BrowserWorkerConstructor): BrowserWorkerConstructor {
  if (candidate !== undefined) return candidate;
  const worker = globalThis.Worker as unknown as BrowserWorkerConstructor | undefined;
  if (worker === undefined) throw new Error("Browser Worker constructor is unavailable");
  return worker;
}

function facade(worker: BrowserWorker): WorkerPort {
  let terminated = false;
  return {
    addEventListener: (type, listener) => {
      if (type === "message") worker.addEventListener(type, listener as WorkerMessageListener);
      else worker.addEventListener(type, listener as WorkerErrorListener);
    },
    removeEventListener: (type, listener) => {
      if (type === "message") worker.removeEventListener(type, listener as WorkerMessageListener);
      else worker.removeEventListener(type, listener as WorkerErrorListener);
    },
    postMessage: (message) => worker.postMessage(message),
    terminate: () => {
      if (terminated) return;
      terminated = true;
      worker.terminate();
    },
  };
}

export function createBrowserWorkerFactory(
  baseUrl: string | URL,
  WorkerCtor?: BrowserWorkerConstructor,
): WorkerFactory {
  const createWorker = browserWorkerConstructor(WorkerCtor);
  return (entry: RuntimeManifestEntry): WorkerPort => {
    const url = new URL(entry.worker.url, baseUrl);
    const worker = new createWorker(url, { type: entry.worker.type });
    return facade(worker);
  };
}
