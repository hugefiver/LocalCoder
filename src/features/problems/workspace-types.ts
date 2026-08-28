import type { LanguageId, RuntimeId } from "../../domain/language.js";
import type { Problem, ProblemCase } from "../../domain/problem.js";
import type { SubmissionResult } from "../../domain/submission.js";
import type { ProblemRepository } from "../../problems/problem-repository.js";
import type { RuntimeRegistry } from "../../runtime/registry.js";
import type { Clock } from "../../runtime/worker-port.js";
import type { SubmissionService } from "../../services/submission-service.js";
import type { LocalCoderRepository } from "../../storage/repository.js";
import type { StorageState, SubmissionRecord } from "../../storage/schema.js";
import type { RuntimeOptionModel } from "../runtimes/runtime-view-model.js";

export type WorkspacePhase = "loading" | "ready" | "running" | "submitting" | "cancelling" | "error";

export interface WorkspaceDependencies {
  problems: ProblemRepository;
  registry: RuntimeRegistry;
  submissions: SubmissionService;
  storage: LocalCoderRepository;
  clock: Clock;
}

export interface ProblemWorkspaceSnapshot {
  phase: WorkspacePhase;
  problem?: Problem;
  runtimeId?: RuntimeId;
  languageId?: LanguageId;
  runtimeOptions: readonly RuntimeOptionModel[];
  source: string;
  customCases: readonly ProblemCase[];
  result?: SubmissionResult;
  recentSubmissions: readonly SubmissionRecord[];
  storageState: StorageState;
  error?: string;
}

export type WorkspaceSnapshotPatch = Partial<Omit<
  ProblemWorkspaceSnapshot,
  "problem" | "runtimeId" | "languageId" | "result" | "error"
>> & {
  problem?: Problem | undefined;
  runtimeId?: RuntimeId | undefined;
  languageId?: LanguageId | undefined;
  result?: SubmissionResult | undefined;
  error?: string | undefined;
};
