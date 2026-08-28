import { type RuntimeId } from "../domain/language.js";
import { MAX_TIMEOUT_MS } from "./manifest.js";
import { parseWorkerRequest, type JudgeCaseRequest, type WorkerRequest } from "./protocol.js";
import { isRuntimeExecutionEligible, type RuntimeCapability } from "./registry.js";
import { infrastructureFailure } from "./supervisor-faults.js";
import { type OperationKind } from "./supervisor-types.js";

const textEncoder = new TextEncoder();

export function validateRuntimeOperation(
  capability: RuntimeCapability,
  runtimeId: RuntimeId,
  kind: OperationKind,
  source: string | undefined,
  cases: readonly JudgeCaseRequest[] | undefined,
  timeoutOverride: number | undefined,
  verificationAuthorized: boolean,
): number | undefined {
  validateCapability(capability, kind, verificationAuthorized);
  if (kind === "initialize") return undefined;
  if (source === undefined) throw new TypeError("Runtime operation source is required");
  if (textEncoder.encode(source).byteLength > capability.limits.sourceBytes) {
    throw new RangeError(`Runtime source exceeds the ${capability.limits.sourceBytes}-byte limit`);
  }
  if (kind === "judge" && (cases === undefined || cases.length > capability.limits.caseCount)) {
    throw new RangeError(`Runtime case count exceeds the ${capability.limits.caseCount}-case limit`);
  }

  const request: WorkerRequest = kind === "execute"
    ? { protocolVersion: 1, requestId: "supervisor-validation", runtimeId, type: "execute", source }
    : {
      protocolVersion: 1,
      requestId: "supervisor-validation",
      runtimeId,
      type: "judge",
      source,
      cases: cases ?? [],
    };
  parseWorkerRequest(request);
  return effectiveExecutionTimeout(capability, timeoutOverride);
}

export function hasValidExecuteOutput(
  payload: { readonly stdout: { readonly bytes: number }; readonly stderr: { readonly bytes: number } },
  outputLimit: number,
): boolean {
  return payload.stdout.bytes + payload.stderr.bytes <= outputLimit;
}

export function hasValidJudgeOutput(
  payload: { readonly cases: readonly { readonly stdout: { readonly bytes: number }; readonly stderr: { readonly bytes: number } }[] },
  outputLimit: number,
): boolean {
  return payload.cases.reduce((total, item) => total + item.stdout.bytes + item.stderr.bytes, 0) <= outputLimit;
}

function validateCapability(capability: RuntimeCapability, kind: OperationKind, verificationAuthorized: boolean): void {
  if (!capability.packaged || capability.state.kind === "not-packaged") {
    throw new Error(capability.unavailableReason ?? `Runtime ${capability.runtimeId} is not packaged`);
  }
  if (capability.state.kind === "incompatible") {
    throw infrastructureFailure("protocol-incompatible", "Runtime protocol is incompatible");
  }
  if (!verificationAuthorized && !isRuntimeExecutionEligible(capability, { allowFailed: true })) {
    throw new Error(`Runtime ${capability.runtimeId} must complete optional verification before execution`);
  }
  if (kind === "execute" && !capability.capabilities.execute) {
    throw new Error(`Runtime ${capability.runtimeId} cannot execute source`);
  }
  if (kind === "judge" && !capability.capabilities.judge) {
    throw new Error(`Runtime ${capability.runtimeId} cannot judge cases`);
  }
}

function effectiveExecutionTimeout(capability: RuntimeCapability, override: number | undefined): number {
  if (override === undefined) return capability.timeouts.executeMs;
  if (typeof override !== "number" || !Number.isFinite(override) || override <= 0) {
    throw new RangeError("Runtime operation timeout must be a finite positive number");
  }
  return Math.min(override, capability.timeouts.executeMs, MAX_TIMEOUT_MS);
}
