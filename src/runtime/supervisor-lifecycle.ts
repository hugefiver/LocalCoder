import { type RuntimeId } from "../domain/language.js";
import { type RuntimeManifestEntry } from "./manifest.js";
import { type RuntimeFailure, type WorkerRequest } from "./protocol.js";
import { type RuntimeRegistry } from "./registry.js";
import { RuntimeCompletionHandler } from "./supervisor-completion.js";
import { bindRuntimeFailureIdentity, infrastructureFailure, protocolFailure } from "./supervisor-faults.js";
import {
  WorkerTransport,
  type WorkerStatusResponse,
  type WorkerTerminalResponse,
} from "./supervisor-transport.js";
import {
  type QueuedOperation,
  type RuntimeLifecycleOptions,
  type RuntimeSlot,
  type WorkerLease,
} from "./supervisor-types.js";
import { releaseRuntimeWorker } from "./supervisor-worker-state.js";
import { type Clock, type WorkerFactory } from "./worker-port.js";

export class RuntimeOperationLifecycle {
  readonly #runtimeId: RuntimeId;
  readonly #slot: RuntimeSlot;
  readonly #operation: QueuedOperation;
  readonly #onSuccess: RuntimeLifecycleOptions["onSuccess"];
  readonly #onNonfatalFailure: RuntimeLifecycleOptions["onNonfatalFailure"];
  readonly #onTerminalFailure: RuntimeLifecycleOptions["onTerminalFailure"];
  readonly #completion: RuntimeCompletionHandler;

  constructor(
    options: RuntimeLifecycleOptions,
    readonly registry: RuntimeRegistry,
    readonly workerFactory: WorkerFactory,
    readonly clock: Clock,
  ) {
    this.#runtimeId = options.runtimeId;
    this.#slot = options.slot;
    this.#operation = options.operation;
    this.#onSuccess = options.onSuccess;
    this.#onNonfatalFailure = options.onNonfatalFailure;
    this.#onTerminalFailure = options.onTerminalFailure;
    this.#completion = new RuntimeCompletionHandler({
      registry,
      runtimeId: this.#runtimeId,
      slot: this.#slot,
      operation: this.#operation,
      beginExecution: () => this.#beginExecution(),
      onSuccess: this.#onSuccess,
      onNonfatalFailure: this.#onNonfatalFailure,
      onTerminalFailure: (error) => this.fail(error),
    });
  }

  start(): void {
    const capability = this.registry.get(this.#runtimeId);
    if (this.#operation.kind === "initialize" && capability.reuse === "session" && this.#slot.initialized && this.#slot.worker !== undefined) {
      const payload = this.#slot.initializePayload;
      if (payload === undefined) {
        this.fail(infrastructureFailure("missing-identity", "Runtime handshake state is missing"));
      } else {
        this.#onSuccess(payload);
      }
      return;
    }

    if (this.#operation.kind !== "initialize" && capability.reuse === "session" && this.#slot.initialized && this.#slot.worker !== undefined) {
      this.#beginExecution();
      return;
    }

    const lease = this.#createWorker(capability);
    if (lease !== undefined) this.#beginInitialization(lease);
  }

  fail(error: RuntimeFailure): void {
    const identity = this.#terminalFailureIdentity();
    const transport = this.#operation.transport;
    if (transport !== undefined) this.#clearTransport(transport);
    if (this.#slot.worker !== undefined) releaseRuntimeWorker(this.#slot, this.#slot.worker);
    this.#slot.initialized = false;
    delete this.#slot.identity;
    delete this.#slot.initializePayload;
    if (identity !== undefined) bindRuntimeFailureIdentity(error, identity);

    const state = this.registry.get(this.#runtimeId).state.kind;
    if (state === "loadable" || state === "initializing" || state === "verifying" || state === "ready" || state === "running") {
      this.registry.transition(this.#runtimeId, { kind: "failed", code: error.code, message: error.message });
    }
    this.#onTerminalFailure(error);
  }

  #terminalFailureIdentity() {
    const identity = this.#slot.identity;
    const worker = this.#slot.worker;
    if (
      (this.#operation.kind !== "execute" && this.#operation.kind !== "judge")
      || this.#slot.active !== this.#operation
      || !this.#slot.initialized
      || identity === undefined
      || worker === undefined
      || worker.generation !== this.#slot.generation
      || worker.terminated
      || this.registry.get(this.#runtimeId).state.kind !== "running"
    ) {
      return undefined;
    }
    return { ...identity };
  }

  #createWorker(capability: RuntimeManifestEntry): WorkerLease | undefined {
    const state = this.registry.get(this.#runtimeId).state.kind;
    if (state === "failed") this.registry.transition(this.#runtimeId, { kind: "loadable" });
    if (this.registry.get(this.#runtimeId).state.kind === "loadable") {
      this.registry.transition(this.#runtimeId, { kind: "initializing" });
    }

    try {
      const lease: WorkerLease = {
        worker: this.workerFactory(capability),
        generation: this.#slot.generation + 1,
        terminated: false,
      };
      this.#slot.generation = lease.generation;
      this.#slot.worker = lease;
      this.#slot.initialized = false;
      delete this.#slot.identity;
      delete this.#slot.initializePayload;
      return lease;
    } catch {
      this.fail(infrastructureFailure("worker-create-failed", "Runtime Worker could not be created"));
      return undefined;
    }
  }

  #beginInitialization(lease: WorkerLease): void {
    this.#startTransport(
      lease,
      { protocolVersion: 1, requestId: this.#operation.requestId, runtimeId: this.#runtimeId, type: "initialize" },
      this.registry.get(this.#runtimeId).timeouts.initializeMs,
    );
  }

  #beginExecution(): void {
    const lease = this.#slot.worker;
    if (lease === undefined || this.#slot.identity === undefined || !this.#slot.initialized) {
      this.fail(infrastructureFailure("missing-identity", "Runtime handshake state is missing"));
      return;
    }
    const state = this.registry.get(this.#runtimeId).state.kind;
    if (state !== "ready" && state !== "verifying") {
      this.fail(infrastructureFailure("invalid-state", "Runtime is not ready to execute"));
      return;
    }
    if (state === "verifying" && this.#operation.verificationAuthority === undefined) {
      this.fail(infrastructureFailure("optional-verification-required", "Runtime is still undergoing optional verification"));
      return;
    }
    this.registry.transition(this.#runtimeId, { kind: "running", requestId: this.#operation.requestId });

    const message: WorkerRequest = this.#operation.kind === "execute"
      ? {
        protocolVersion: 1,
        requestId: this.#operation.requestId,
        runtimeId: this.#runtimeId,
        type: "execute",
        source: this.#operation.source ?? "",
      }
      : {
        protocolVersion: 1,
        requestId: this.#operation.requestId,
        runtimeId: this.#runtimeId,
        type: "judge",
        source: this.#operation.source ?? "",
        cases: this.#operation.cases ?? [],
      };
    this.#startTransport(
      lease,
      message,
      this.#operation.timeoutMs ?? this.registry.get(this.#runtimeId).timeouts.executeMs,
    );
  }

  #startTransport(lease: WorkerLease, message: WorkerRequest, timeoutMs: number): void {
    if (message.type === "dispose") {
      this.fail(protocolFailure());
      return;
    }
    const transport = new WorkerTransport(
      lease,
      this.#runtimeId,
      message.requestId,
      message.type,
      timeoutMs,
      this.clock,
      {
        onStatus: (response) => this.#handleStatus(transport, response),
        onTerminal: (response) => this.#handleTerminal(transport, response),
        onProtocolError: () => this.#handleFault(transport, protocolFailure()),
        onWorkerError: () => this.#handleFault(
          transport,
          infrastructureFailure("worker-error", "Runtime Worker raised an error"),
        ),
        onTimeout: () => this.#handleFault(
          transport,
          infrastructureFailure(
            message.type === "initialize" ? "initialization-timeout" : "execution-timeout",
            message.type === "initialize" ? "Runtime initialization timed out" : "Runtime execution timed out",
          ),
        ),
        onPostMessageError: () => this.#handleFault(
          transport,
          infrastructureFailure("post-message-failed", "Runtime Worker could not receive the operation"),
        ),
      },
    );
    this.#operation.transport = transport;
    transport.start(message);
  }

  #handleStatus(transport: WorkerTransport, response: WorkerStatusResponse): void {
    if (!this.#isCurrent(transport)) return;
    const expectedPhase = transport.operation === "initialize" ? "initializing" : "executing";
    if (response.phase !== expectedPhase) {
      this.fail(protocolFailure());
      return;
    }
    if (
      transport.operation === "initialize"
      && response.message.trim().length > 0
      && this.registry.get(this.#runtimeId).state.kind === "initializing"
    ) {
      this.registry.transition(this.#runtimeId, { kind: "initializing", message: response.message });
    }
  }

  #handleTerminal(transport: WorkerTransport, response: WorkerTerminalResponse): void {
    if (!this.#isCurrent(transport)) return;
    this.#clearTransport(transport);
    if (response.type === "failure") {
      if (transport.operation === "initialize" || response.error.fatal) {
        this.fail(response.error);
      } else {
        this.#completion.settleNonfatalFailure(response.error);
      }
      return;
    }
    if (response.operation !== transport.operation) {
      this.fail(protocolFailure());
      return;
    }

    switch (response.operation) {
      case "initialize":
        this.#completion.completeInitialization(transport.lease, response.payload);
        return;
      case "execute":
        this.#completion.completeExecution(transport.lease, response.payload);
        return;
      case "judge":
        this.#completion.completeJudge(transport.lease, response.payload);
        return;
    }
  }

  #handleFault(transport: WorkerTransport, error: RuntimeFailure): void {
    if (!this.#isCurrent(transport)) return;
    this.#clearTransport(transport);
    this.fail(error);
  }

  #clearTransport(transport: WorkerTransport): void {
    if (this.#operation.transport !== transport) return;
    transport.stop();
    delete this.#operation.transport;
  }

  #isCurrent(transport: WorkerTransport): boolean {
    return this.#slot.active === this.#operation
      && this.#operation.transport === transport
      && this.#slot.worker === transport.lease
      && this.#slot.generation === transport.lease.generation
      && !transport.lease.terminated;
  }

}
