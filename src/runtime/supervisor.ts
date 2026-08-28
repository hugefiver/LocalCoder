import { type RuntimeId } from "../domain/language.js";
import { type ExecutePayload, type InitializePayload, type JudgeCaseRequest, type JudgePayload, type RuntimeFailure } from "./protocol.js";
import { type RuntimeRegistry } from "./registry.js";
import { cancelledFailure, cloneRuntimeFailure, infrastructureFailure } from "./supervisor-faults.js";
import { RuntimeOperationLifecycle } from "./supervisor-lifecycle.js";
import { releaseRuntimeWorker } from "./supervisor-worker-state.js";
import {
  type OperationKind,
  type QueuedOperation,
  type RuntimeOperationInput,
  type RuntimeSlot,
} from "./supervisor-types.js";
import { validateRuntimeOperation } from "./supervisor-validation.js";
import { systemClock, type Clock, type WorkerFactory } from "./worker-port.js";

export type {
  RuntimeIdentity,
  RuntimeInvocation,
  RuntimeOperationOptions,
} from "./supervisor-types.js";

import type { RuntimeInvocation, RuntimeOperationOptions } from "./supervisor-types.js";

export interface RuntimeVerificationSession {
  operationOptions(): RuntimeOperationOptions;
  complete(): void;
  close(): void;
}

export class RuntimeSupervisor {
  readonly #registry: RuntimeRegistry;
  readonly #workerFactory: WorkerFactory;
  readonly #clock: Clock;
  readonly #slots = new Map<RuntimeId, RuntimeSlot>();
  readonly #verificationAuthorities = new Map<RuntimeId, object>();
  #requestSequence = 0;

  constructor(options: { registry: RuntimeRegistry; workerFactory: WorkerFactory; clock?: Clock }) {
    this.#registry = options.registry;
    this.#workerFactory = options.workerFactory;
    this.#clock = options.clock ?? systemClock;
  }

  initialize(runtimeId: RuntimeId, signal?: AbortSignal, options?: RuntimeOperationOptions): Promise<InitializePayload> {
    return this.#enqueue<InitializePayload>(runtimeId, "initialize", {
      ...options,
      ...(signal === undefined ? {} : { signal }),
    });
  }

  execute(
    runtimeId: RuntimeId,
    source: string,
    options?: RuntimeOperationOptions,
  ): Promise<RuntimeInvocation<ExecutePayload>> {
    return this.#enqueue<RuntimeInvocation<ExecutePayload>>(runtimeId, "execute", { source, ...options });
  }

  judge(
    runtimeId: RuntimeId,
    source: string,
    cases: readonly JudgeCaseRequest[],
    options?: RuntimeOperationOptions,
  ): Promise<RuntimeInvocation<JudgePayload>> {
    return this.#enqueue<RuntimeInvocation<JudgePayload>>(runtimeId, "judge", {
      source,
      cases,
      ...options,
    });
  }

  cancel(runtimeId: RuntimeId, requestId: string): void {
    const slot = this.#slots.get(runtimeId);
    if (slot === undefined) return;
    if (slot.active?.requestId === requestId) {
      this.#failActive(runtimeId, slot, cancelledFailure());
      return;
    }

    const queueIndex = slot.queue.findIndex((operation) => operation.requestId === requestId);
    if (queueIndex < 0) return;
    const [operation] = slot.queue.splice(queueIndex, 1);
    if (operation === undefined) return;
    this.#removeAbortListener(operation);
    operation.reject(cancelledFailure());
  }

  async dispose(runtimeId?: RuntimeId): Promise<void> {
    const runtimeIds = runtimeId === undefined ? [...this.#slots.keys()] : [runtimeId];
    for (const id of runtimeIds) {
      const slot = this.#slots.get(id);
      if (slot === undefined) continue;
      if (slot.active !== undefined) {
        this.#failActive(id, slot, cancelledFailure());
      } else if (slot.worker !== undefined) {
        releaseRuntimeWorker(slot, slot.worker);
      }
    }
  }

  beginOptionalVerification(runtimeId: RuntimeId): RuntimeVerificationSession {
    const runtime = this.#registry.get(runtimeId);
    if (!runtime.packaged || runtime.required || runtime.verification !== "unverified") {
      throw new RangeError(`Runtime ${runtimeId} cannot begin optional verification`);
    }
    if (runtime.state.kind === "not-packaged" || runtime.state.kind === "incompatible") {
      throw new RangeError(`Runtime ${runtimeId} cannot begin optional verification`);
    }
    if (this.#verificationAuthorities.has(runtimeId)) {
      throw new Error(`Runtime ${runtimeId} already has an active optional verification session`);
    }

    const authority = Object.freeze({});
    this.#verificationAuthorities.set(runtimeId, authority);
    const assertOpen = () => {
      if (this.#verificationAuthorities.get(runtimeId) !== authority) {
        throw new Error(`Optional verification session for ${runtimeId} is closed`);
      }
    };
    return Object.freeze({
      operationOptions: (): RuntimeOperationOptions => {
        assertOpen();
        return Object.freeze({ verificationAuthority: authority }) as RuntimeOperationOptions;
      },
      complete: () => {
        assertOpen();
        this.#registry.completeOptionalVerification(runtimeId);
        this.#verificationAuthorities.delete(runtimeId);
      },
      close: () => {
        if (this.#verificationAuthorities.get(runtimeId) === authority) {
          this.#verificationAuthorities.delete(runtimeId);
        }
      },
    });
  }

  #enqueue<T>(runtimeId: RuntimeId, kind: OperationKind, input: RuntimeOperationInput): Promise<T> {
    let timeoutMs: number | undefined;
    const verificationAuthority = this.#activeVerificationAuthority(runtimeId, input.verificationAuthority);
    try {
      timeoutMs = validateRuntimeOperation(
        this.#registry.get(runtimeId),
        runtimeId,
        kind,
        input.source,
        input.cases,
        input.timeoutMs,
        verificationAuthority !== undefined,
      );
    } catch (error) {
      return Promise.reject(error);
    }
    if (input.signal?.aborted) return Promise.reject(cancelledFailure());

    return new Promise<T>((resolve, reject) => {
      const slot = this.#slot(runtimeId);
      const operation: QueuedOperation = {
        kind,
        requestId: this.#nextRequestId(runtimeId),
        ...(input.source === undefined ? {} : { source: input.source }),
        ...(input.cases === undefined ? {} : { cases: input.cases }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        ...(verificationAuthority === undefined ? {} : { verificationAuthority }),
        resolve: (value) => resolve(value as T),
        reject,
      };
      if (operation.signal !== undefined) {
        const abortListener = () => this.#abortOperation(runtimeId, slot, operation);
        operation.abortListener = abortListener;
        operation.signal.addEventListener("abort", abortListener, { once: true });
      }

      slot.queue.push(operation);
      this.#drain(runtimeId, slot);
    });
  }

  #slot(runtimeId: RuntimeId): RuntimeSlot {
    let slot = this.#slots.get(runtimeId);
    if (slot === undefined) {
      slot = { generation: 0, initialized: false, queue: [] };
      this.#slots.set(runtimeId, slot);
    }
    return slot;
  }

  #nextRequestId(runtimeId: RuntimeId): string {
    this.#requestSequence += 1;
    return `${runtimeId}:${this.#requestSequence}`;
  }

  #activeVerificationAuthority(runtimeId: RuntimeId, authority: object | undefined): object | undefined {
    return authority !== undefined && this.#verificationAuthorities.get(runtimeId) === authority
      ? authority
      : undefined;
  }

  #drain(runtimeId: RuntimeId, slot: RuntimeSlot): void {
    if (slot.active !== undefined) return;
    const operation = slot.queue.shift();
    if (operation === undefined) return;
    if (operation.signal?.aborted) {
      this.#removeAbortListener(operation);
      operation.reject(cancelledFailure());
      this.#drain(runtimeId, slot);
      return;
    }
    if (operation.verificationAuthority !== undefined
      && this.#activeVerificationAuthority(runtimeId, operation.verificationAuthority) === undefined) {
      this.#removeAbortListener(operation);
      operation.reject(new Error(`Optional verification session for ${runtimeId} is closed`));
      this.#drain(runtimeId, slot);
      return;
    }

    slot.active = operation;
    const lifecycle = new RuntimeOperationLifecycle(
      {
        runtimeId,
        slot,
        operation,
        onSuccess: (value) => this.#settleActive(runtimeId, slot, operation, () => operation.resolve(value)),
        onNonfatalFailure: (error) => this.#settleActive(runtimeId, slot, operation, () => operation.reject(error)),
        onTerminalFailure: (error) => this.#rejectRuntime(slot, error),
      },
      this.#registry,
      this.#workerFactory,
      this.#clock,
    );
    slot.lifecycle = lifecycle;
    try {
      lifecycle.start();
    } catch {
      lifecycle.fail(infrastructureFailure("supervisor-error", "Runtime supervisor could not start the operation"));
    }
  }

  #settleActive(
    runtimeId: RuntimeId,
    slot: RuntimeSlot,
    operation: QueuedOperation,
    settle: () => void,
  ): void {
    if (slot.active !== operation) return;
    this.#removeAbortListener(operation);
    delete slot.lifecycle;
    delete slot.active;
    settle();
    this.#drain(runtimeId, slot);
  }

  #failActive(runtimeId: RuntimeId, slot: RuntimeSlot, error: RuntimeFailure): void {
    if (slot.lifecycle !== undefined) {
      slot.lifecycle.fail(error);
    } else {
      this.#rejectRuntime(slot, error);
    }
  }

  #rejectRuntime(slot: RuntimeSlot, error: RuntimeFailure): void {
    const active = slot.active;
    if (active !== undefined) {
      this.#removeAbortListener(active);
      delete slot.lifecycle;
      delete slot.active;
      active.reject(error);
    }
    const queued = slot.queue.splice(0);
    for (const operation of queued) {
      this.#removeAbortListener(operation);
      operation.reject(cloneRuntimeFailure(error));
    }
  }

  #abortOperation(runtimeId: RuntimeId, slot: RuntimeSlot, operation: QueuedOperation): void {
    if (slot.active === operation) {
      this.#failActive(runtimeId, slot, cancelledFailure());
      return;
    }
    const queueIndex = slot.queue.indexOf(operation);
    if (queueIndex < 0) return;
    slot.queue.splice(queueIndex, 1);
    this.#removeAbortListener(operation);
    operation.reject(cancelledFailure());
  }

  #removeAbortListener(operation: QueuedOperation): void {
    if (operation.signal !== undefined && operation.abortListener !== undefined) {
      operation.signal.removeEventListener("abort", operation.abortListener);
      delete operation.abortListener;
    }
  }
}
