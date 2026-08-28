import { type RuntimeManifestEntry } from "./manifest.js";
import { type WorkerRequest } from "./protocol.js";

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type WorkerMessageListener = (event: MessageEvent<unknown>) => void;
export type WorkerErrorListener = (event: ErrorEvent) => void;

export interface WorkerPort {
  addEventListener(type: "message", listener: WorkerMessageListener): void;
  addEventListener(type: "error", listener: WorkerErrorListener): void;
  removeEventListener(type: "message", listener: WorkerMessageListener): void;
  removeEventListener(type: "error", listener: WorkerErrorListener): void;
  postMessage(message: WorkerRequest): void;
  terminate(): void;
}

export type WorkerFactory = (entry: RuntimeManifestEntry) => WorkerPort;

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};
