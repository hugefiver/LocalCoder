import type { LanguageId } from "../../domain/language.js";
import { isRuntimeExecutionEligible, type RuntimeCapability, type RuntimeRegistry } from "../../runtime/registry.js";
import type { RuntimeFailure } from "../../runtime/protocol.js";
import type { SettingsRecord, StorageState } from "../../storage/schema.js";
import { toRuntimeOption, type RuntimeOptionModel } from "../runtimes/runtime-view-model.js";
import type { ExecutorSnapshot } from "./executor-controller.js";

export interface ExecutorSnapshotInput {
  phase: ExecutorSnapshot["phase"];
  runtimeId?: ExecutorSnapshot["runtimeId"] | undefined;
  languageId?: ExecutorSnapshot["languageId"] | undefined;
  runtimeOptions: readonly RuntimeOptionModel[];
  source: string;
  output?: ExecutorSnapshot["output"] | undefined;
  elapsedMs?: number | undefined;
  storageState: StorageState;
  error?: string | undefined;
}

export type ExecutorSnapshotPatch = Partial<Omit<ExecutorSnapshotInput, "runtimeOptions" | "storageState">> & {
  runtimeOptions?: readonly RuntimeOptionModel[];
  storageState?: StorageState;
};

export function createExecutorSnapshot(input: ExecutorSnapshotInput): ExecutorSnapshot {
  return Object.freeze({
    phase: input.phase,
    ...(input.runtimeId === undefined ? {} : { runtimeId: input.runtimeId }),
    ...(input.languageId === undefined ? {} : { languageId: input.languageId }),
    runtimeOptions: input.runtimeOptions,
    source: input.source,
    ...(input.output === undefined ? {} : { output: input.output }),
    ...(input.elapsedMs === undefined ? {} : { elapsedMs: input.elapsedMs }),
    storageState: input.storageState,
    ...(input.error === undefined ? {} : { error: boundedText(input.error) }),
  });
}

export function executorRuntimeOptions(registry: RuntimeRegistry): readonly RuntimeOptionModel[] {
  return Object.freeze(registry.list().map((capability) => Object.freeze(toRuntimeOption(capability, "execute"))));
}

export function initialExecutorRuntime(
  registry: RuntimeRegistry,
  settings: SettingsRecord,
  languageIds: readonly LanguageId[],
): RuntimeCapability | undefined {
  for (const languageId of languageIds) {
    const preferred = settings.preferredRuntimeByLanguage[languageId];
    if (preferred === undefined) continue;
    const exact = registry.list().find((capability) => capability.runtimeId === preferred);
    if (exact !== undefined && exact.languageId === languageId && !toRuntimeOption(exact, "execute").disabled) {
      return exact;
    }
    const fallback = registry.resolveDefault(languageId, "execute");
    if (fallback !== undefined) return fallback;
  }
  for (const capability of registry.list()) {
    const fallback = registry.resolveDefault(capability.languageId, "execute");
    if (fallback !== undefined) return fallback;
  }
  return undefined;
}

export function canAttemptExecute(capability: RuntimeCapability): boolean {
  return capability.capabilities.execute && isRuntimeExecutionEligible(capability, { allowFailed: true });
}

export function executionPhase(capability: RuntimeCapability): "initializing" | "running" {
  return capability.state.kind === "ready" || capability.state.kind === "running" ? "running" : "initializing";
}

export function immutableExecutorValue<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

export function isCancellation(error: unknown): boolean {
  return (error instanceof DOMException && error.name === "AbortError")
    || (isRuntimeFailure(error) && error.kind === "cancelled");
}

export function executorErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return boundedText(error.message);
  if (isRuntimeFailure(error) && error.message.trim().length > 0) return boundedText(error.message);
  if (typeof error === "string" && error.trim().length > 0) return boundedText(error);
  return "未知错误";
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) deepFreeze(descriptor.value);
  }
  return Object.freeze(value);
}

function isRuntimeFailure(error: unknown): error is RuntimeFailure {
  return error !== null
    && typeof error === "object"
    && "kind" in error
    && typeof error.kind === "string"
    && "message" in error
    && typeof error.message === "string";
}

function boundedText(value: string): string {
  const normalized = value.trim();
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 239)}…`;
}
