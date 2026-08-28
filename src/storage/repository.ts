import type { LanguageId, RuntimeId } from "../domain/language.js";
import type { ProblemCase } from "../domain/problem.js";
import type { DatabaseDriver } from "./driver.js";
import { openIndexedDbDriver } from "./indexeddb-driver.js";
import { MemoryDriver } from "./memory-driver.js";
import {
  defaultSettings,
  parseAtomicSubmissionWrite,
  parseCustomCasesRecord,
  parseDraft,
  parseLegacyImportBatch,
  parseLegacyMigrationMarker,
  parseProgress,
  parseSettings,
  parseSubmission,
  parseSubmissionQuery,
  SUBMISSION_HISTORY_LIMIT,
} from "./record-validation.js";
import {
  type AtomicSubmissionWrite,
  type DraftRecord,
  type LegacyImportBatch,
  type LegacyMigrationMarker,
  type ProgressRecord,
  type ProgressUpdate,
  type SettingsRecord,
  type StorageState,
  type SubmissionQuery,
  type SubmissionRecord,
} from "./schema.js";
import {
  assertRuntimeLanguage,
  MAX_IDENTIFIER_BYTES,
  parseLanguageId,
  parseProblemId,
  parseRuntimeId,
  parseText,
} from "./validation.js";

export type { StorageState } from "./schema.js";

export interface LocalCoderRepositoryOptions {
  driver: DatabaseDriver;
  storageState: StorageState;
  now?: () => number;
  createMemoryDriver?: () => MemoryDriver;
}

export class LocalCoderRepository {
  private driver: DatabaseDriver;
  private state: StorageState;
  private readonly now: () => number;
  private readonly createMemoryDriver: () => MemoryDriver;
  private readonly listeners = new Set<(state: StorageState) => void>();
  private closed = false;

  constructor(options: LocalCoderRepositoryOptions) {
    this.driver = options.driver;
    this.state = cloneState(options.storageState);
    this.now = options.now ?? Date.now;
    this.createMemoryDriver = options.createMemoryDriver ?? (() => new MemoryDriver());
  }

  get storageState(): StorageState {
    return cloneState(this.state);
  }

  subscribeStorageState(listener: (state: StorageState) => void): () => void {
    this.listeners.add(listener);
    notify(listener, this.state);
    return () => this.listeners.delete(listener);
  }

  async getDraft(key: readonly [string, LanguageId, RuntimeId]): Promise<DraftRecord | undefined> {
    const workspaceId = parseText(key[0], "draft.workspaceId", MAX_IDENTIFIER_BYTES, true);
    const languageId = parseLanguageId(key[1], "draft.languageId");
    const runtimeId = parseRuntimeId(key[2], "draft.runtimeId");
    assertRuntimeLanguage(languageId, runtimeId, "draft");
    return this.withDriver((driver) => driver.transaction(["drafts"], "readonly", async (transaction) => {
      const value = await transaction.get<unknown>("drafts", [workspaceId, languageId, runtimeId]);
      return value === undefined ? undefined : parseDraft(value, "draft");
    }));
  }

  async listDrafts(): Promise<readonly DraftRecord[]> {
    return this.withDriver(async (driver) => driver.transaction(["drafts"], "readonly", async (transaction) => (
      (await transaction.getAll<unknown>("drafts")).map((value) => parseDraft(value, "draft")).sort(compareDrafts)
    )));
  }

  async saveDraft(record: DraftRecord): Promise<void> {
    const draft = parseDraft(record, "draft");
    await this.withDriver((driver) => driver.transaction(["drafts"], "readwrite", async (transaction) => {
      await transaction.put("drafts", draft);
    }));
  }

  async getCustomCases(problemId: number): Promise<readonly ProblemCase[]> {
    const validProblemId = parseProblemId(problemId, "customCases.problemId");
    return this.withDriver((driver) => driver.transaction(["customCases"], "readonly", async (transaction) => {
      const value = await transaction.get<unknown>("customCases", validProblemId);
      return value === undefined ? [] : parseCustomCasesRecord(value, "customCases").cases;
    }));
  }

  async saveCustomCases(problemId: number, cases: readonly ProblemCase[]): Promise<void> {
    const record = parseCustomCasesRecord({ problemId, cases, updatedAt: this.now() }, "customCases");
    await this.withDriver((driver) => driver.transaction(["customCases"], "readwrite", async (transaction) => {
      await transaction.put("customCases", record);
    }));
  }

  async getSettings(): Promise<SettingsRecord> {
    return this.withDriver((driver) => driver.transaction(["settings"], "readonly", async (transaction) => {
      const value = await transaction.get<unknown>("settings", "app");
      return value === undefined ? defaultSettings(this.now()) : parseSettings(value, "settings");
    }));
  }

  async saveSettings(settings: SettingsRecord): Promise<void> {
    const record = parseSettings(settings, "settings");
    await this.withDriver((driver) => driver.transaction(["settings"], "readwrite", async (transaction) => {
      await transaction.put("settings", record);
    }));
  }

  async getProgress(problemId: number): Promise<ProgressRecord | undefined> {
    const validProblemId = parseProblemId(problemId, "progress.problemId");
    return this.withDriver((driver) => driver.transaction(["progress"], "readonly", async (transaction) => {
      const value = await transaction.get<unknown>("progress", validProblemId);
      return value === undefined ? undefined : parseProgress(value, "progress");
    }));
  }

  async listProgress(): Promise<readonly ProgressRecord[]> {
    return this.withDriver(async (driver) => driver.transaction(["progress"], "readonly", async (transaction) => (
      (await transaction.getAll<unknown>("progress")).map((value) => parseProgress(value, "progress"))
        .sort((left, right) => left.problemId - right.problemId)
    )));
  }

  async listSubmissions(query?: SubmissionQuery): Promise<readonly SubmissionRecord[]> {
    const validQuery = parseSubmissionQuery(query);
    return this.withDriver((driver) => driver.transaction(["submissions"], "readonly", async (transaction) => {
      const records = (await transaction.getAll<unknown>("submissions"))
        .map((value) => parseSubmission(value, "submission", true))
        .filter((record) => matchesQuery(record, validQuery))
        .sort(compareNewestFirst);
      return validQuery.limit === undefined ? records : records.slice(0, validQuery.limit);
    }));
  }

  async recordSubmission(input: AtomicSubmissionWrite): Promise<number> {
    const write = parseAtomicSubmissionWrite(input);
    const submission = write.submission;
    const progressUpdate = write.progressUpdate;
    if (progressUpdate !== undefined && progressUpdate.problemId !== submission.problemId) {
      throw new TypeError("progressUpdate.problemId: must match submission.problemId");
    }
    if (progressUpdate?.accepted !== undefined && submission.verdict !== "accepted") {
      throw new TypeError("progressUpdate.accepted: may only accompany an accepted submission");
    }
    return this.withDriver((driver) => driver.transaction(["submissions", "progress"], "readwrite", async (transaction) => {
      const currentValue = progressUpdate === undefined
        ? undefined
        : await transaction.get<unknown>("progress", progressUpdate.problemId);
      const currentProgress = currentValue === undefined ? undefined : parseProgress(currentValue, "progress");
      const mergedProgress = progressUpdate === undefined ? undefined : mergeProgress(currentProgress, progressUpdate);
      const insertedKey = await transaction.add("submissions", submission);
      if (typeof insertedKey !== "number" || !Number.isSafeInteger(insertedKey) || insertedKey < 1) {
        throw new TypeError("submission.id: database returned an invalid auto-increment key");
      }
      if (mergedProgress !== undefined) await transaction.put("progress", mergedProgress);
      const count = await transaction.count("submissions");
      if (count > SUBMISSION_HISTORY_LIMIT) {
        const oldestFirst = (await transaction.getAll<unknown>("submissions"))
          .map((value) => parseSubmission(value, "submission", true))
          .sort(compareOldestFirst);
        for (const record of oldestFirst.slice(0, count - SUBMISSION_HISTORY_LIMIT)) {
          if (record.id === undefined) throw new TypeError("submission.id: stored submission is missing its key");
          await transaction.delete("submissions", record.id);
        }
      }
      return insertedKey;
    }));
  }

  async importLegacyState(batch: LegacyImportBatch): Promise<"migrated" | "already-migrated"> {
    const importBatch = parseLegacyImportBatch(batch);
    return this.withDriver((driver) => driver.transaction(
      ["drafts", "customCases", "settings", "progress", "meta"],
      "readwrite",
      async (transaction) => {
        const marker = await transaction.get<unknown>("meta", "legacyMigrationVersion");
        if (marker !== undefined) {
          parseLegacyMigrationMarker(marker);
          return "already-migrated";
        }
        for (const draft of importBatch.drafts) await transaction.put("drafts", draft);
        for (const cases of importBatch.customCases) await transaction.put("customCases", cases);
        if (importBatch.settings !== undefined) await transaction.put("settings", importBatch.settings);
        for (const progress of importBatch.progress) await transaction.put("progress", progress);
        const migrationMarker: LegacyMigrationMarker = { key: "legacyMigrationVersion", value: 1 };
        await transaction.put("meta", migrationMarker);
        return "migrated";
      },
    ));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    this.driver.close();
  }

  private async withDriver<T>(operation: (driver: DatabaseDriver) => Promise<T>): Promise<T> {
    this.assertOpen();
    try {
      return await operation(this.driver);
    } catch (error) {
      if (this.state.kind === "memory") throw error;
      return operation(this.transitionToMemory(error));
    }
  }

  private transitionToMemory(error: unknown): MemoryDriver {
    if (this.state.kind === "memory") {
      if (this.driver instanceof MemoryDriver) return this.driver;
      throw new Error("Repository storage state is inconsistent");
    }
    this.driver.close();
    const memory = this.createMemoryDriver();
    this.driver = memory;
    this.state = { kind: "memory", message: "未保存", reason: reasonFor(error) };
    this.publishState();
    return memory;
  }

  private publishState(): void {
    for (const listener of this.listeners) notify(listener, this.state);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("LocalCoder repository is closed");
  }
}

export async function openLocalCoderRepository(options: {
  indexedDB?: IDBFactory;
  legacyStorage?: Storage;
  now?: () => number;
} = {}): Promise<LocalCoderRepository> {
  const now = options.now ?? Date.now;
  if (options.indexedDB === undefined) {
    return new LocalCoderRepository({
      driver: new MemoryDriver(),
      storageState: { kind: "memory", message: "未保存", reason: "IndexedDB is unavailable" },
      now,
    });
  }
  try {
    const driver = await openIndexedDbDriver(options.indexedDB);
    return new LocalCoderRepository({ driver, storageState: { kind: "persistent" }, now });
  } catch (error) {
    return new LocalCoderRepository({
      driver: new MemoryDriver(),
      storageState: { kind: "memory", message: "未保存", reason: reasonFor(error) },
      now,
    });
  }
}

function matchesQuery(record: SubmissionRecord, query: SubmissionQuery): boolean {
  return (query.problemId === undefined || record.problemId === query.problemId)
    && (query.runtimeId === undefined || record.runtimeId === query.runtimeId)
    && (query.verdicts === undefined || query.verdicts.includes(record.verdict));
}

function compareNewestFirst(left: SubmissionRecord, right: SubmissionRecord): number {
  return compareOldestFirst(right, left);
}

function compareOldestFirst(left: SubmissionRecord, right: SubmissionRecord): number {
  if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
  return (left.id ?? 0) - (right.id ?? 0);
}

function compareDrafts(left: DraftRecord, right: DraftRecord): number {
  return left.workspaceId.localeCompare(right.workspaceId)
    || left.languageId.localeCompare(right.languageId)
    || left.runtimeId.localeCompare(right.runtimeId);
}

function mergeProgress(current: ProgressRecord | undefined, update: ProgressUpdate): ProgressRecord {
  const currentAttempts = current?.attempts ?? 0;
  if (currentAttempts >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("progress.attempts: cannot increment beyond Number.MAX_SAFE_INTEGER");
  }
  return {
    problemId: update.problemId,
    attempts: currentAttempts + 1,
    lastAttemptAt: update.attemptedAt,
    ...(update.accepted ?? acceptedMetadata(current)),
  };
}

function acceptedMetadata(progress: ProgressRecord | undefined): Pick<ProgressRecord, "acceptedAt" | "acceptedLanguageId" | "acceptedRuntimeId"> {
  return {
    ...(progress?.acceptedAt === undefined ? {} : { acceptedAt: progress.acceptedAt }),
    ...(progress?.acceptedLanguageId === undefined ? {} : { acceptedLanguageId: progress.acceptedLanguageId }),
    ...(progress?.acceptedRuntimeId === undefined ? {} : { acceptedRuntimeId: progress.acceptedRuntimeId }),
  };
}

function cloneState(state: StorageState): StorageState {
  return state.kind === "persistent" ? { kind: "persistent" } : { ...state };
}

function notify(listener: (state: StorageState) => void, state: StorageState): void {
  try {
    listener(cloneState(state));
  } catch {
    // Storage status observers must not interfere with persistence.
  }
}

function reasonFor(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error;
  return "IndexedDB storage failed";
}
