import {
  type ExecutePayload,
  type InitializePayload,
  type JudgePayload,
  type RuntimeFailure,
} from "./protocol.js";
import { type RuntimeRegistry } from "./registry.js";
import { bindRuntimeFailureIdentity, infrastructureFailure, protocolFailure } from "./supervisor-faults.js";
import { type QueuedOperation, type RuntimeOperationResult, type RuntimeSlot, type WorkerLease } from "./supervisor-types.js";
import { hasValidExecuteOutput, hasValidJudgeOutput } from "./supervisor-validation.js";
import { releaseRuntimeWorker } from "./supervisor-worker-state.js";

export interface RuntimeCompletionOptions {
  readonly registry: RuntimeRegistry;
  readonly runtimeId: import("../domain/language.js").RuntimeId;
  readonly slot: RuntimeSlot;
  readonly operation: QueuedOperation;
  readonly beginExecution: () => void;
  readonly onSuccess: (value: RuntimeOperationResult) => void;
  readonly onNonfatalFailure: (error: RuntimeFailure) => void;
  readonly onTerminalFailure: (error: RuntimeFailure) => void;
}

export class RuntimeCompletionHandler {
  readonly #registry: RuntimeRegistry;
  readonly #runtimeId: RuntimeCompletionOptions["runtimeId"];
  readonly #slot: RuntimeSlot;
  readonly #operation: QueuedOperation;
  readonly #beginExecution: () => void;
  readonly #onSuccess: RuntimeCompletionOptions["onSuccess"];
  readonly #onNonfatalFailure: RuntimeCompletionOptions["onNonfatalFailure"];
  readonly #onTerminalFailure: RuntimeCompletionOptions["onTerminalFailure"];

  constructor(options: RuntimeCompletionOptions) {
    this.#registry = options.registry;
    this.#runtimeId = options.runtimeId;
    this.#slot = options.slot;
    this.#operation = options.operation;
    this.#beginExecution = options.beginExecution;
    this.#onSuccess = options.onSuccess;
    this.#onNonfatalFailure = options.onNonfatalFailure;
    this.#onTerminalFailure = options.onTerminalFailure;
  }

  completeInitialization(lease: WorkerLease, payload: InitializePayload): void {
    if (!this.#isActiveLease(lease)) return;
    this.#slot.identity = { runtimeVersion: payload.runtimeVersion, buildId: payload.buildId };
    this.#slot.initializePayload = payload;
    this.#slot.initialized = true;
    if (this.#registry.get(this.#runtimeId).state.kind === "initializing") {
      this.#registry.transition(this.#runtimeId, this.#operation.verificationAuthority === undefined ? { kind: "ready" } : { kind: "verifying" });
    }

    if (this.#operation.kind === "initialize") {
      if (this.#registry.get(this.#runtimeId).reuse === "per-submission") releaseRuntimeWorker(this.#slot, lease);
      this.#onSuccess(payload);
      return;
    }
    this.#beginExecution();
  }

  completeExecution(lease: WorkerLease, payload: ExecutePayload): void {
    if (!this.#isActiveLease(lease) || this.#operation.kind !== "execute") {
      this.#onTerminalFailure(protocolFailure());
      return;
    }
    if (!hasValidExecuteOutput(payload, this.#registry.get(this.#runtimeId).limits.outputBytes)) {
      this.#onTerminalFailure(protocolFailure());
      return;
    }
    const identity = this.#slot.identity;
    if (identity === undefined) {
      this.#onTerminalFailure(infrastructureFailure("missing-identity", "Runtime handshake state is missing"));
      return;
    }

    this.#moveRunningToReady();
    if (this.#registry.get(this.#runtimeId).reuse === "per-submission") releaseRuntimeWorker(this.#slot, lease);
    this.#onSuccess({ identity: { ...identity }, payload });
  }

  completeJudge(lease: WorkerLease, payload: JudgePayload): void {
    if (!this.#isActiveLease(lease) || this.#operation.kind !== "judge") {
      this.#onTerminalFailure(protocolFailure());
      return;
    }
    if (!hasValidJudgeOutput(payload, this.#registry.get(this.#runtimeId).limits.outputBytes)) {
      this.#onTerminalFailure(protocolFailure());
      return;
    }
    const identity = this.#slot.identity;
    if (identity === undefined) {
      this.#onTerminalFailure(infrastructureFailure("missing-identity", "Runtime handshake state is missing"));
      return;
    }

    this.#moveRunningToReady();
    if (this.#registry.get(this.#runtimeId).reuse === "per-submission") releaseRuntimeWorker(this.#slot, lease);
    this.#onSuccess({ identity: { ...identity }, payload });
  }

  settleNonfatalFailure(error: RuntimeFailure): void {
    const identity = this.#activeRunningIdentity();
    if (identity !== undefined) bindRuntimeFailureIdentity(error, identity);
    const lease = this.#slot.worker;
    this.#moveRunningToReady();
    if (lease !== undefined && this.#registry.get(this.#runtimeId).reuse === "per-submission") {
      releaseRuntimeWorker(this.#slot, lease);
    }
    this.#onNonfatalFailure(error);
  }

  #activeRunningIdentity() {
    const identity = this.#slot.identity;
    const lease = this.#slot.worker;
    if (
      (this.#operation.kind !== "execute" && this.#operation.kind !== "judge")
      || this.#slot.active !== this.#operation
      || !this.#slot.initialized
      || identity === undefined
      || lease === undefined
      || lease.generation !== this.#slot.generation
      || lease.terminated
      || this.#registry.get(this.#runtimeId).state.kind !== "running"
    ) {
      return undefined;
    }
    return identity;
  }

  #moveRunningToReady(): void {
    if (this.#registry.get(this.#runtimeId).state.kind === "running") {
      this.#registry.transition(this.#runtimeId, this.#operation.verificationAuthority === undefined ? { kind: "ready" } : { kind: "verifying" });
    }
  }

  #isActiveLease(lease: WorkerLease): boolean {
    return this.#slot.active === this.#operation
      && this.#slot.worker === lease
      && this.#slot.generation === lease.generation
      && !lease.terminated;
  }
}
