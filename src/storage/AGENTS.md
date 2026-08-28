# Storage Knowledge Base

## OVERVIEW

- `storage/` owns browser persistence, record validation, fallback behavior, and legacy import.
- Callers use `LocalCoderRepository` in `repository.ts`, not IndexedDB APIs or a driver directly.
- `schema.ts` is the record and store-name authority. The six stores are `drafts`, `customCases`, `submissions`, `progress`, `settings`, and `meta`.
- `driver.ts` defines the small `DatabaseDriver` and `TransactionView` abstraction shared by IndexedDB and memory implementations.
- `indexeddb-driver.ts` maps that abstraction to the versioned browser database. `memory-driver.ts` provides the compatible in-process fallback and test double.

## WHERE TO LOOK

- Repository operations, storage-state subscriptions, fallback transition, and submission history retention: `repository.ts`.
- Store names, keys, record contracts, migration marker, and `StorageState`: `schema.ts`.
- Transaction contract: `driver.ts`; IndexedDB lifecycle and object-store setup: `indexeddb-driver.ts`.
- Memory queueing, snapshots, rollback, key handling, and injected failures: `memory-driver.ts`.
- Strict record parsers and submission-history limit: `record-validation.ts`; primitive validators: `validation.ts`.
- Legacy local-storage reader and import orchestration: `legacy-migration.ts`.

## TRANSACTION RULES

- Use repository methods so reads and writes pass through the validated facade.
- Keep dependent work in one readwrite transaction. Submission recording must read current progress, merge it, add the submission, put merged progress, and trim old submissions before commit.
- Do not split that sequence across transactions or derive attempts from a stale read.
- Drivers expose only `get`, `getAll`, `put`, `add`, `delete`, and `count`; preserve this boundary when adding storage behavior.
- The memory driver queues overlapping transactions, snapshots all stores, and commits its snapshot only after successful readwrite work. A thrown operation or injected post-work failure rolls back the snapshot.
- Submission IDs in memory are auto-assigned like IndexedDB, persisted onto submission values, and advanced past explicit valid IDs.

## FALLBACK/MIGRATION

- Open with IndexedDB when available. If opening fails, start in memory with storage state `{ kind: "memory", message: "未保存", ... }`.
- If a persistent operation fails, close the durable driver, switch once to a new memory driver, publish the unsaved state, and replay that failed operation against memory.
- Memory data is session-only. Never represent it as saved or silently attempt to copy it back to IndexedDB.
- Legacy import reads known old local-storage keys defensively, skips unreadable or malformed entries, and retains the old keys.
- Import writes the validated batch and `meta.legacyMigrationVersion` in one transaction. A valid existing marker makes later imports return `already-migrated` without rewriting records.

## ANTI-PATTERNS

- Do not bypass `LocalCoderRepository`, duplicate its fallback logic, or couple callers to a particular driver.
- Do not change store keys, DB version, record fields, or migration versions without updating schema, IndexedDB setup, validation, migration, and tests together.
- Do not accept loosely shaped persisted data. Parsers require plain records, known fields, data properties, dense arrays, bounded text and JSON, valid IDs, and compatible language/runtime pairs.
- Do not let a failed migration write its marker, remove legacy keys, or report imported records as durable after fallback.
- Do not make memory behavior weaker than IndexedDB transaction behavior, especially for readonly writes, store access, auto IDs, or rollback.

## TESTS

- Storage coverage lives in `tests/storage/repository.test.ts`, `tests/storage/indexeddb-driver.test.ts`, `tests/storage/fallback.test.ts`, and `tests/storage/legacy-migration.test.ts`.
- Test atomic submission/progress updates, history trimming, validation failures, queue ordering, rollback, and memory auto-ID behavior when changing repository or driver logic.
- Test unavailable and failed IndexedDB startup, persistent-operation replay into the `未保存` memory state, and storage-state notifications when changing fallback code.
- Test legacy key parsing, malformed input skipping, marker idempotence, and retry behavior after a failed durable migration.
