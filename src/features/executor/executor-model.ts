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

export function immutableExecutorValue<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

export function isCancellation(error: unknown): boolean {
  return (error instanceof DOMException && error.name === "AbortError")
    || (isRuntimeFailure(error) && error.kind === "cancelled");
}

export function executorErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.trim().length > 0 ? boundedText(error.message) : "未知错误";
  if (isRuntimeFailure(error)) return boundedText(runtimeFailureMessage(error));
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

const RUNTIME_FAILURE_KINDS: ReadonlySet<string> = new Set([
  "compile",
  "runtime",
  "infrastructure",
  "protocol",
  "cancelled",
]);

function isRuntimeFailure(error: unknown): error is RuntimeFailure {
  if (error === null || typeof error !== "object") return false;
  const candidate = error as {
    readonly kind?: unknown;
    readonly code?: unknown;
    readonly message?: unknown;
    readonly fatal?: unknown;
    readonly details?: unknown;
  };
  return typeof candidate.kind === "string"
    && RUNTIME_FAILURE_KINDS.has(candidate.kind)
    && typeof candidate.code === "string"
    && typeof candidate.message === "string"
    && typeof candidate.fatal === "boolean"
    && (candidate.details === undefined || typeof candidate.details === "string");
}

function runtimeFailureMessage(error: RuntimeFailure): string {
  const message = error.message.trim();
  const details = typeof error.details === "string" ? error.details.trim() : "";
  if (details.length > 0 && details !== message) return message.length > 0 ? `${message}：${details}` : details;
  return message;
}

function boundedText(value: string): string {
  const normalized = value.trim();
  const characters = Array.from(normalized);
  return characters.length <= 240 ? normalized : `${characters.slice(0, 239).join("")}…`;
}
