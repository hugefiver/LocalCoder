import { type RuntimeId } from "../domain/language.js";
import {
  parseWorkerResponse,
  type WorkerRequest,
  type WorkerResponse,
} from "./protocol.js";
import { type OperationKind, type WorkerLease } from "./supervisor-types.js";
import { type Clock, type WorkerErrorListener, type WorkerMessageListener } from "./worker-port.js";

export type WorkerTerminalResponse = Exclude<WorkerResponse, { readonly type: "status" }>;
export type WorkerStatusResponse = Extract<
  WorkerResponse,
  { readonly type: "status"; readonly phase: "initializing" | "executing" }
>;

export interface WorkerTransportCallbacks {
  onStatus(response: WorkerStatusResponse): void;
  onTerminal(response: WorkerTerminalResponse): void;
  onProtocolError(): void;
  onWorkerError(): void;
  onTimeout(): void;
  onPostMessageError(): void;
}

export class WorkerTransport {
  readonly #messageListener: WorkerMessageListener;
  readonly #errorListener: WorkerErrorListener;
  #timer: unknown;
  #active = false;

  constructor(
    readonly lease: WorkerLease,
    readonly runtimeId: RuntimeId,
    readonly requestId: string,
    readonly operation: OperationKind,
    readonly timeoutMs: number,
    readonly clock: Clock,
    readonly callbacks: WorkerTransportCallbacks,
  ) {
    this.#messageListener = (event) => this.#handleMessage(event.data);
    this.#errorListener = () => {
      if (!this.#active) return;
      this.stop();
      this.callbacks.onWorkerError();
    };
  }

  start(message: WorkerRequest): void {
    this.#active = true;
    this.lease.worker.addEventListener("message", this.#messageListener);
    this.lease.worker.addEventListener("error", this.#errorListener);
    this.#timer = this.clock.setTimeout(() => {
      if (!this.#active) return;
      this.stop();
      this.callbacks.onTimeout();
    }, this.timeoutMs);

    try {
      this.lease.worker.postMessage(message);
    } catch {
      this.stop();
      this.callbacks.onPostMessageError();
    }
  }

  stop(): void {
    if (!this.#active) return;
    this.#active = false;
    this.lease.worker.removeEventListener("message", this.#messageListener);
    this.lease.worker.removeEventListener("error", this.#errorListener);
    this.clock.clearTimeout(this.#timer);
  }

  #handleMessage(message: unknown): void {
    if (!this.#active) return;

    let response: WorkerResponse;
    try {
      response = parseWorkerResponse(message, this.runtimeId);
    } catch {
      this.stop();
      this.callbacks.onProtocolError();
      return;
    }
    if (response.requestId !== this.requestId) {
      this.stop();
      this.callbacks.onProtocolError();
      return;
    }
    if (response.type === "status") {
      this.callbacks.onStatus(response);
      return;
    }

    this.stop();
    this.callbacks.onTerminal(response);
  }
}
