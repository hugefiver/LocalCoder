import assert from "node:assert/strict";
import test from "node:test";
import { runLegacyMigration } from "../../src/storage/legacy-migration.js";
import { MemoryDriver } from "../../src/storage/memory-driver.js";
import { LocalCoderRepository, openLocalCoderRepository } from "../../src/storage/repository.js";
import { MemoryLegacyStorage } from "../helpers/memory-legacy-storage.js";

const NOW = 1_700_000_000_000;

test("migrates every recognized legacy family with canonical language/runtime mappings and retains old keys", async () => {
  const legacy = new MemoryLegacyStorage({
    "problem-1-language": JSON.stringify("rustpython"),
    "problem-1-code-rustpython": JSON.stringify("def solution(value): return value"),
    "problem-1-code-python": JSON.stringify("def solution(value): return value + 1"),
    "problem-1-custom-tests": JSON.stringify([{ input: { value: 1 }, expected: 1 }]),
    "executor-language": JSON.stringify("typescript"),
    "executor-code-typescript": JSON.stringify("function solution(value: number) { return value; }"),
    "solved-problems": JSON.stringify([1, 2, 2]),
    "ignored-key": JSON.stringify({ never: "imported" }),
  });
  const repository = await openLocalCoderRepository({ now: () => NOW });

  const result = await runLegacyMigration({ repository, legacy, now: () => NOW });
  assert.deepEqual(result, { state: "migrated", imported: 7 });
  assert.deepEqual(await repository.listDrafts(), [
    {
      workspaceId: "executor",
      languageId: "typescript",
      runtimeId: "typescript-official",
      source: "function solution(value: number) { return value; }",
      updatedAt: NOW,
    },
    {
      workspaceId: "problem:1",
      languageId: "python",
      runtimeId: "python-pyodide",
      source: "def solution(value): return value + 1",
      updatedAt: NOW,
    },
    {
      workspaceId: "problem:1",
      languageId: "python",
      runtimeId: "python-rustpython",
      source: "def solution(value): return value",
      updatedAt: NOW,
    },
  ]);
  assert.deepEqual(await repository.getCustomCases(1), [{ input: { value: 1 }, expected: 1 }]);
  assert.deepEqual(await repository.listProgress(), [
    { problemId: 1, attempts: 1, lastAttemptAt: NOW, acceptedAt: NOW },
    { problemId: 2, attempts: 1, lastAttemptAt: NOW, acceptedAt: NOW },
  ]);
  assert.deepEqual(await repository.getSettings(), {
    key: "app",
    theme: "system",
    preferredRuntimeByLanguage: {
      python: "python-rustpython",
      typescript: "typescript-official",
    },
    layout: { desktopProblemPercent: 50, tabletTab: "problem" },
    updatedAt: NOW,
  });
  assert.equal(legacy.getItem("problem-1-code-rustpython"), JSON.stringify("def solution(value): return value"));
  assert.equal(legacy.getItem("solved-problems"), JSON.stringify([1, 2, 2]));
  repository.close();
});

test("is durably idempotent after reopening a repository and does not inflate attempts", async () => {
  const legacy = new MemoryLegacyStorage({
    "problem-4-code-javascript": JSON.stringify("function solution() { return 4; }"),
    "solved-problems": JSON.stringify([4]),
  });
  const driver = new MemoryDriver();
  const first = new LocalCoderRepository({ driver, storageState: { kind: "persistent" }, now: () => NOW });
  assert.deepEqual(await runLegacyMigration({ repository: first, legacy, now: () => NOW }), {
    state: "migrated",
    imported: 2,
  });
  first.close();

  const reopened = new LocalCoderRepository({ driver, storageState: { kind: "persistent" }, now: () => NOW + 1 });
  assert.deepEqual(await runLegacyMigration({ repository: reopened, legacy, now: () => NOW + 1 }), {
    state: "already-migrated",
    imported: 0,
  });
  assert.deepEqual(await reopened.getProgress(4), {
    problemId: 4,
    attempts: 1,
    lastAttemptAt: NOW,
    acceptedAt: NOW,
  });
  assert.equal((await reopened.listDrafts()).length, 1);
  reopened.close();
});

test("skips malformed legacy values and rolls back a failed migration before a later retry", async () => {
  const legacy = new MemoryLegacyStorage({
    "problem-3-code-python": JSON.stringify("x".repeat(262_145)),
    "problem-3-custom-tests": "{not json",
    "executor-language": JSON.stringify("unknown-language"),
    "solved-problems": JSON.stringify([3, "invalid", -1]),
  });
  const durable = new MemoryDriver({ failure: new Error("durable write failed") });
  const repository = new LocalCoderRepository({
    driver: durable,
    storageState: { kind: "persistent" },
    now: () => NOW,
    createMemoryDriver: () => new MemoryDriver({ failure: new Error("fallback write failed") }),
  });

  await assert.rejects(
    runLegacyMigration({ repository, legacy, now: () => NOW }),
    /fallback write failed/,
  );
  assert.deepEqual(legacy.entries(), {
    "problem-3-code-python": JSON.stringify("x".repeat(262_145)),
    "problem-3-custom-tests": "{not json",
    "executor-language": JSON.stringify("unknown-language"),
    "solved-problems": JSON.stringify([3, "invalid", -1]),
  });
  repository.close();

  const retry = new LocalCoderRepository({ driver: durable, storageState: { kind: "persistent" }, now: () => NOW });
  assert.deepEqual(await runLegacyMigration({ repository: retry, legacy, now: () => NOW }), {
    state: "migrated",
    imported: 1,
  });
  assert.deepEqual(await retry.getProgress(3), {
    problemId: 3,
    attempts: 1,
    lastAttemptAt: NOW,
    acceptedAt: NOW,
  });
  retry.close();
});
