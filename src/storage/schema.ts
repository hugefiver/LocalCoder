import type { LanguageId, RuntimeId } from "../domain/language.js";
import type { ProblemCase } from "../domain/problem.js";
import type { Verdict } from "../domain/submission.js";

export const DB_NAME = "localcoder";
export const DB_VERSION = 1;

export const STORE_NAMES = [
  "drafts",
  "customCases",
  "submissions",
  "progress",
  "settings",
  "meta",
] as const;

export type StoreName = (typeof STORE_NAMES)[number];

export interface DraftRecord {
  workspaceId: string;
  languageId: LanguageId;
  runtimeId: RuntimeId;
  source: string;
  updatedAt: number;
}

export interface CustomCasesRecord {
  problemId: number;
  cases: readonly ProblemCase[];
  updatedAt: number;
}

export interface SettingsRecord {
  key: "app";
  theme: "light" | "dark" | "system";
  preferredRuntimeByLanguage: Partial<Record<LanguageId, RuntimeId>>;
  layout: { desktopProblemPercent: number; tabletTab: "problem" | "code" };
  updatedAt: number;
}

export interface ProgressRecord {
  problemId: number;
  attempts: number;
  lastAttemptAt: number;
  acceptedAt?: number;
  acceptedLanguageId?: LanguageId;
  acceptedRuntimeId?: RuntimeId;
}

export interface AcceptedProgressMetadata {
  acceptedAt: number;
  acceptedLanguageId: LanguageId;
  acceptedRuntimeId: RuntimeId;
}

export interface ProgressUpdate {
  problemId: number;
  attemptedAt: number;
  accepted?: AcceptedProgressMetadata;
}

export interface CaseCountSummary {
  total: number;
  passed: number;
  failed: number;
}

export interface SubmissionRecord {
  id?: number;
  problemId: number;
  languageId: LanguageId;
  runtimeId: RuntimeId;
  runtimeVersion: string;
  buildId: string;
  source: string;
  verdict: Verdict;
  elapsedMs: number;
  caseSummary: {
    public: CaseCountSummary;
    custom: CaseCountSummary;
    judge: CaseCountSummary;
  };
  output: { stdout: string; stderr: string; truncated: boolean };
  createdAt: number;
}

export interface SubmissionQuery {
  problemId?: number;
  runtimeId?: RuntimeId;
  verdicts?: readonly Verdict[];
  limit?: number;
}

export interface AtomicSubmissionWrite {
  submission: Omit<SubmissionRecord, "id">;
  progressUpdate?: ProgressUpdate;
}

export interface LegacyImportBatch {
  drafts: readonly DraftRecord[];
  customCases: readonly CustomCasesRecord[];
  settings?: SettingsRecord;
  progress: readonly ProgressRecord[];
  migrationVersion: 1;
}

export interface LegacyMigrationMarker {
  key: "legacyMigrationVersion";
  value: 1;
}

export type StorageState =
  | { kind: "persistent" }
  | { kind: "memory"; message: "未保存"; reason: string };
