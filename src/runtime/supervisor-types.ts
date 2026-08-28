import { type RuntimeId } from "../domain/language.js";
import {
  type ExecutePayload,
  type InitializePayload,
  type JudgeCaseRequest,
  type JudgePayload,
} from "./protocol.js";
import { type RuntimeOperationLifecycle } from "./supervisor-lifecycle.js";
import { type WorkerTransport } from "./supervisor-transport.js";
import { type WorkerPort } from "./worker-port.js";

export interface RuntimeIdentity {
  runtimeVersion: string;
  buildId: string;
}

export interface RuntimeInvocation<T> {
  identity: RuntimeIdentity;
  payload: T;
}

export interface RuntimeOperationOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type OperationKind = "initialize" | "execute" | "judge";

export type RuntimeOperationResult =
  | InitializePayload
  | RuntimeInvocation<ExecutePayload>
  | RuntimeInvocation<JudgePayload>;

export interface WorkerLease {
  readonly worker: WorkerPort;
  readonly generation: number;
  terminated: boolean;
}

export interface QueuedOperation {
  readonly kind: OperationKind;
  readonly requestId: string;
  readonly source?: string;
  readonly cases?: readonly JudgeCaseRequest[];
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly verificationAuthority?: object;
  readonly resolve: (value: RuntimeOperationResult) => void;
  readonly reject: (reason: unknown) => void;
  abortListener?: () => void;
  transport?: WorkerTransport;
}

export interface RuntimeSlot {
  generation: number;
  worker?: WorkerLease;
  identity?: RuntimeIdentity;
  initializePayload?: InitializePayload;
  initialized: boolean;
  active?: QueuedOperation;
  lifecycle?: RuntimeOperationLifecycle;
  readonly queue: QueuedOperation[];
}

export interface RuntimeOperationInput {
  source?: string;
  cases?: readonly JudgeCaseRequest[];
  signal?: AbortSignal;
  timeoutMs?: number;
  verificationAuthority?: object;
}

export interface RuntimeLifecycleOptions {
  readonly runtimeId: RuntimeId;
  readonly slot: RuntimeSlot;
  readonly operation: QueuedOperation;
  readonly onSuccess: (value: RuntimeOperationResult) => void;
  readonly onNonfatalFailure: (error: import("./protocol.js").RuntimeFailure) => void;
  readonly onTerminalFailure: (error: import("./protocol.js").RuntimeFailure) => void;
}
