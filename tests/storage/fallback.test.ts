import assert from "node:assert/strict";
import test from "node:test";
import { MemoryDriver } from "../../src/storage/memory-driver.js";
import { LocalCoderRepository, openLocalCoderRepository } from "../../src/storage/repository.js";

const NOW = 1_700_000_000_000;

function failingFactory(message: string): IDBFactory {
  return {
    open(): IDBOpenDBRequest {
      throw new Error(message);
    },
    deleteDatabase(): IDBOpenDBRequest {
      throw new Error(message);
    },
    cmp(): number {
      return 0;
    },
    databases: async () => [],
  };
}

test("uses honest memory state when IndexedDB is omitted or cannot open, with immediate isolated subscriptions", async () => {
  const unavailable = await openLocalCoderRepository({ now: () => NOW });
  const states: string[] = [];
  unavailable.subscribeStorageState(() => {
    throw new Error("listener failure must be isolated");
  });
  const unsubscribe = unavailable.subscribeStorageState((state) => states.push(state.kind));
  assert.deepEqual(unavailable.storageState, {
    kind: "memory",
    message: "未保存",
    reason: "IndexedDB is unavailable",
  });
  await unavailable.saveDraft({
    workspaceId: "executor",
    languageId: "javascript",
    runtimeId: "javascript-worker",
    source: "console.log('session work')",
    updatedAt: NOW,
  });
  assert.equal((await unavailable.listDrafts()).length, 1);
  unsubscribe();
  unavailable.close();

  const failedOpen = await openLocalCoderRepository({ indexedDB: failingFactory("open denied"), now: () => NOW });
  assert.deepEqual(failedOpen.storageState, {
    kind: "memory",
    message: "未保存",
    reason: "open denied",
  });
  assert.deepEqual(states, ["memory"]);
  failedOpen.close();
});

test("falls back once after a later transaction failure and retries the current operation in memory", async () => {
  const persistent = new MemoryDriver();
  const repository = new LocalCoderRepository({
    driver: persistent,
    storageState: { kind: "persistent" },
    now: () => NOW,
  });
  const states: string[] = [];
  repository.subscribeStorageState((state) => states.push(state.kind));
  persistent.failNextTransaction(new Error("quota exceeded"));

  await repository.saveDraft({
    workspaceId: "executor",
    languageId: "typescript",
    runtimeId: "typescript-official",
    source: "const value: number = 1;",
    updatedAt: NOW,
  });

  assert.deepEqual(repository.storageState, {
    kind: "memory",
    message: "未保存",
    reason: "quota exceeded",
  });
  assert.deepEqual(states, ["persistent", "memory"]);
  assert.equal((await repository.getDraft(["executor", "typescript", "typescript-official"]))?.source, "const value: number = 1;");
  repository.close();
  repository.close();
});
