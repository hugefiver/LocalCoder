import { runLegacyMigration } from "../storage/legacy-migration.js";
import { openLocalCoderRepository } from "../storage/repository.js";
import type { DraftRecord, ProgressRecord, SettingsRecord, StorageState, SubmissionRecord } from "../storage/schema.js";

export interface StorageHarnessApi {
  state(): StorageState;
  seedLegacy(entries: Readonly<Record<string, string>>): Promise<void>;
  migrate(): Promise<{ state: "migrated" | "already-migrated"; imported: number }>;
  snapshot(): Promise<{
    drafts: readonly DraftRecord[];
    progress: readonly ProgressRecord[];
    submissions: readonly SubmissionRecord[];
    settings: SettingsRecord;
  }>;
  recordSubmissions(records: readonly Omit<SubmissionRecord, "id">[]): Promise<void>;
  close(): void;
}

declare global {
  interface Window {
    localCoderStorageHarness: StorageHarnessApi;
  }
}

const resultElement = document.querySelector<HTMLPreElement>('[data-testid="storage-harness-result"]');
const useMemory = new URL(window.location.href).searchParams.get("storage") === "memory";
let currentState: StorageState = useMemory
  ? { kind: "memory", message: "未保存", reason: "IndexedDB is unavailable" }
  : { kind: "persistent" };
const repository = openLocalCoderRepository(
  useMemory ? {} : { indexedDB: window.indexedDB },
).then((value) => {
  value.subscribeStorageState((state) => {
    currentState = state;
  });
  currentState = value.storageState;
  return value;
});

window.localCoderStorageHarness = {
  state: () => {
    const state: StorageState = currentState.kind === "persistent"
      ? { kind: "persistent" }
      : { ...currentState };
    writeResult(state);
    return state;
  },
  seedLegacy: (entries) => report(repository.then(() => {
    for (const [key, value] of Object.entries(entries)) window.localStorage.setItem(key, value);
  })),
  migrate: () => report(repository.then((value) => runLegacyMigration({
    repository: value,
    legacy: window.localStorage,
    now: Date.now,
  }))),
  snapshot: () => report(repository.then(async (value) => ({
    drafts: await value.listDrafts(),
    progress: await value.listProgress(),
    submissions: await value.listSubmissions(),
    settings: await value.getSettings(),
  }))),
  recordSubmissions: (records) => report(repository.then(async (value) => {
    for (const submission of records) await value.recordSubmission({ submission });
  })),
  close: () => {
    void repository.then((value) => {
      value.close();
      writeResult({ closed: true });
    });
  },
};

async function report<T>(operation: Promise<T>): Promise<T> {
  try {
    const result = await operation;
    writeResult(result);
    return result;
  } catch (error) {
    writeResult(error instanceof Error ? { name: error.name, message: error.message } : error);
    throw error;
  }
}

function writeResult(value: unknown): void {
  if (resultElement !== null) resultElement.textContent = JSON.stringify(value, null, 2);
}
