import { assertJsonValue } from "../domain/json-value.js";
import type { JudgeCommand, SelectedCase } from "../domain/submission.js";
import { RuntimeAdapterRegistry } from "../runtime/adapters/registry.js";
import type { RuntimeAdapter } from "../runtime/adapters/types.js";
import { MAX_CASE_COUNT, MAX_SOURCE_BYTES } from "../runtime/protocol.js";
import { isRuntimeExecutionEligible, RuntimeRegistry, type RuntimeCapability } from "../runtime/registry.js";
import type { RuntimeOperationOptions } from "../runtime/supervisor.js";

const textEncoder = new TextEncoder();

export type JudgeRuntimeResolution =
  | { readonly available: true; readonly capability: RuntimeCapability; readonly adapter: RuntimeAdapter }
  | { readonly available: false };

function byteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function validateJudgeCommand(command: JudgeCommand): void {
  if (command.mode !== "run" && command.mode !== "submit") throw new TypeError("Judge mode must be run or submit");
  if (typeof command.source !== "string") throw new TypeError("Judge source must be a string");
  if (!Array.isArray(command.customCases)) throw new TypeError("Custom cases must be an array");
  for (const [index, testCase] of command.customCases.entries()) {
    if (!isRecord(testCase)) throw new TypeError(`Custom case ${index} must be an object`);
    assertJsonValue(testCase.input, `Custom case ${index} input`);
    assertJsonValue(testCase.expected, `Custom case ${index} expected`);
  }
}

export function validateJudgeSubmission(
  command: JudgeCommand,
  selected: readonly SelectedCase[],
  capability: RuntimeCapability,
): void {
  if (byteLength(command.source) > MAX_SOURCE_BYTES || byteLength(command.source) > capability.limits.sourceBytes) {
    throw new RangeError("Judge source exceeds the runtime source limit");
  }
  if (selected.length > MAX_CASE_COUNT || selected.length > capability.limits.caseCount) {
    throw new RangeError("Judge case count exceeds the runtime case limit");
  }
  for (const testCase of selected) {
    assertJsonValue(testCase.input, `Judge case ${testCase.index} input`);
    assertJsonValue(testCase.expected, `Judge case ${testCase.index} expected`);
  }
  const timeoutMs = command.problem.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > capability.timeouts.executeMs)) {
    throw new RangeError("Problem timeout must be finite, positive, and within the runtime execution timeout");
  }
}

export function resolveJudgeRuntime(
  registry: RuntimeRegistry,
  adapters: RuntimeAdapterRegistry,
  runtimeId: JudgeCommand["runtimeId"],
): JudgeRuntimeResolution {
  let capability: RuntimeCapability;
  try {
    capability = registry.get(runtimeId);
  } catch (error) {
    if (error instanceof RangeError) return { available: false };
    throw error;
  }
  if (!isRuntimeExecutionEligible(capability, { allowFailed: true }) || !capability.capabilities.judge) {
    return { available: false };
  }
  try {
    return { available: true, capability, adapter: adapters.get(runtimeId) };
  } catch (error) {
    if (error instanceof RangeError) return { available: false };
    throw error;
  }
}

export function judgeOperationOptions(signal: AbortSignal | undefined, timeoutMs: number | undefined): RuntimeOperationOptions {
  return {
    ...(signal === undefined ? {} : { signal }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

export function elapsedMs(now: () => number, startedAt: number): number {
  return Math.max(0, now() - startedAt);
}
