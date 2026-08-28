import { LANGUAGE_IDS, type LanguageId, type RuntimeId } from "../../domain/language.js";
import type { Problem, ProblemCase } from "../../domain/problem.js";
import type { SubmissionResult } from "../../domain/submission.js";
import type { RuntimeOptionModel } from "../runtimes/runtime-view-model.js";
import { toRuntimeOption } from "../runtimes/runtime-view-model.js";
import { isRuntimeExecutionEligible, type RuntimeCapability, type RuntimeRegistry } from "../../runtime/registry.js";
import type { SettingsRecord, StorageState, SubmissionRecord } from "../../storage/schema.js";
import type { ProblemWorkspaceSnapshot, WorkspacePhase } from "./workspace-types.js";

export function runtimeOptions(
  registry: RuntimeRegistry,
  problem: Problem | undefined,
): readonly RuntimeOptionModel[] {
  return Object.freeze(registry.list().map((capability) => {
    const option = toRuntimeOption(capability, "judge");
    if (problem === undefined || problem.templates[capability.languageId] !== undefined || option.disabled) {
      return Object.freeze({ ...option });
    }
    return Object.freeze({
      ...option,
      statusLabel: "无模板",
      disabled: true,
      reason: `此题没有 ${option.label} 模板`,
    });
  }));
}

export function initialRuntime(
  registry: RuntimeRegistry,
  problem: Problem,
  settings: SettingsRecord,
): RuntimeCapability | undefined {
  for (const languageId of LANGUAGE_IDS) {
    const preferred = settings.preferredRuntimeByLanguage[languageId];
    if (preferred === undefined || problem.templates[languageId] === undefined) continue;
    const exact = registry.list().find((capability) => capability.runtimeId === preferred);
    if (exact !== undefined && exact.languageId === languageId && isSelectable(exact)) return exact;
    const fallback = registry.resolveDefault(languageId, "judge");
    if (fallback !== undefined) return fallback;
  }

  for (const capability of registry.list()) {
    if (problem.templates[capability.languageId] === undefined) continue;
    const fallback = registry.resolveDefault(capability.languageId, "judge");
    if (fallback !== undefined) return fallback;
  }
  return undefined;
}

export function isSelectable(capability: RuntimeCapability): boolean {
  return !toRuntimeOption(capability, "judge").disabled;
}

export function canAttemptJudge(capability: RuntimeCapability): boolean {
  return capability.capabilities.judge && isRuntimeExecutionEligible(capability, { allowFailed: true });
}

export function immutableProblem(problem: Problem): Problem {
  return freezeClone(problem);
}

export function immutableCases(cases: readonly ProblemCase[]): readonly ProblemCase[] {
  return freezeClone(cases);
}

export function immutableResult(result: SubmissionResult): SubmissionResult {
  return freezeClone(result);
}

export function immutableSubmissions(records: readonly SubmissionRecord[]): readonly SubmissionRecord[] {
  return freezeClone(records);
}

export function immutableStorageState(state: StorageState): StorageState {
  return freezeClone(state);
}

export function cancelledResult(): SubmissionResult {
  return immutableResult({
    verdict: "cancelled",
    elapsedMs: 0,
    publicCases: [],
    customCases: [],
    judgeSummary: { total: 0, passed: 0, failed: 0 },
    output: { stdout: "", stderr: "", truncated: false },
  });
}

export function workspaceSnapshot(input: {
  phase: WorkspacePhase;
  problem?: Problem | undefined;
  runtimeId?: RuntimeId | undefined;
  languageId?: LanguageId | undefined;
  runtimeOptions: readonly RuntimeOptionModel[];
  source: string;
  customCases: readonly ProblemCase[];
  result?: SubmissionResult | undefined;
  recentSubmissions: readonly SubmissionRecord[];
  storageState: StorageState;
  error?: string | undefined;
}): ProblemWorkspaceSnapshot {
  return Object.freeze({
    phase: input.phase,
    ...(input.problem === undefined ? {} : { problem: input.problem }),
    ...(input.runtimeId === undefined ? {} : { runtimeId: input.runtimeId }),
    ...(input.languageId === undefined ? {} : { languageId: input.languageId }),
    runtimeOptions: input.runtimeOptions,
    source: input.source,
    customCases: input.customCases,
    ...(input.result === undefined ? {} : { result: input.result }),
    recentSubmissions: input.recentSubmissions,
    storageState: input.storageState,
    ...(input.error === undefined ? {} : { error: input.error }),
  });
}

export function emptyWorkspaceSnapshot(
  registry: RuntimeRegistry,
  storageState: StorageState,
  phase: "loading" | "error",
  error?: string,
): ProblemWorkspaceSnapshot {
  return workspaceSnapshot({
    phase,
    runtimeOptions: runtimeOptions(registry, undefined),
    source: "",
    customCases: immutableCases([]),
    recentSubmissions: immutableSubmissions([]),
    storageState: immutableStorageState(storageState),
    ...(error === undefined ? {} : { error }),
  });
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error;
  return "未知错误";
}

function freezeClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) deepFreeze(descriptor.value);
  }
  return Object.freeze(value);
}
