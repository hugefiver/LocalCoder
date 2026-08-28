import type { DatabaseDriver, TransactionMode, TransactionView } from "./driver.js";
import { STORE_NAMES, type StoreName } from "./schema.js";

interface StoredValue {
  key: IDBValidKey;
  value: unknown;
}

type StoreData = Map<string, StoredValue>;

export interface MemoryDriverOptions {
  /** Causes the next transaction to fail after its work has completed, proving rollback behavior. */
  failure?: Error;
}

export class MemoryDriver implements DatabaseDriver {
  private stores = createStores();
  private nextSubmissionId = 1;
  private nextFailure: Error | undefined;
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(options: MemoryDriverOptions = {}) {
    this.nextFailure = options.failure;
  }

  failNextTransaction(error: Error = new Error("Injected memory transaction failure")): void {
    this.nextFailure = error;
  }

  async transaction<T>(
    stores: readonly StoreName[],
    mode: TransactionMode,
    work: (transaction: TransactionView) => Promise<T>,
  ): Promise<T> {
    assertTransactionStores(stores);
    const failure = this.nextFailure;
    this.nextFailure = undefined;
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.executeTransaction(stores, mode, work, failure);
    } finally {
      release();
    }
  }

  close(): void {
    // Memory data intentionally survives repository close so a test can model reopening the same database.
  }

  private async executeTransaction<T>(
    stores: readonly StoreName[],
    mode: TransactionMode,
    work: (transaction: TransactionView) => Promise<T>,
    failure: Error | undefined,
  ): Promise<T> {
    const workingStores = cloneStores(this.stores);
    let nextSubmissionId = this.nextSubmissionId;
    const ensureStore = (store: StoreName): StoreData => {
      if (!stores.includes(store)) throw new DOMException(`Store ${store} is not in this transaction`, "NotFoundError");
      const data = workingStores.get(store);
      if (data === undefined) throw new DOMException(`Store ${store} does not exist`, "NotFoundError");
      return data;
    };
    const writable = (): void => {
      if (mode !== "readwrite") throw new DOMException("Transaction is readonly", "ReadOnlyError");
    };
    const view: TransactionView = {
      get: async <TValue>(store: StoreName, key: IDBValidKey): Promise<TValue | undefined> => {
        const stored = ensureStore(store).get(keyFingerprint(key));
        return stored === undefined ? undefined : clone(stored.value) as TValue;
      },
      getAll: async <TValue>(store: StoreName): Promise<readonly TValue[]> => (
        [...ensureStore(store).values()].map(({ value }) => clone(value) as TValue)
      ),
      put: async <TValue>(store: StoreName, value: TValue, key?: IDBValidKey): Promise<IDBValidKey> => {
        writable();
        const resolvedKey = key ?? keyFromValue(store, value, () => nextSubmissionId++);
        if (store === "submissions") nextSubmissionId = advanceSubmissionId(nextSubmissionId, resolvedKey);
        ensureStore(store).set(keyFingerprint(resolvedKey), {
          key: clone(resolvedKey),
          value: storedValue(store, value, resolvedKey),
        });
        return clone(resolvedKey);
      },
      add: async <TValue>(store: StoreName, value: TValue): Promise<IDBValidKey> => {
        writable();
        const resolvedKey = keyFromValue(store, value, () => nextSubmissionId++);
        if (store === "submissions") nextSubmissionId = advanceSubmissionId(nextSubmissionId, resolvedKey);
        const data = ensureStore(store);
        const fingerprint = keyFingerprint(resolvedKey);
        if (data.has(fingerprint)) throw new DOMException("Key already exists", "ConstraintError");
        data.set(fingerprint, { key: clone(resolvedKey), value: storedValue(store, value, resolvedKey) });
        return clone(resolvedKey);
      },
      delete: async (store: StoreName, key: IDBValidKey): Promise<void> => {
        writable();
        ensureStore(store).delete(keyFingerprint(key));
      },
      count: async (store: StoreName): Promise<number> => ensureStore(store).size,
    };

    const result = await work(view);
    if (failure !== undefined) throw failure;
    if (mode === "readwrite") {
      this.stores = workingStores;
      this.nextSubmissionId = nextSubmissionId;
    }
    return clone(result);
  }
}

function createStores(): Map<StoreName, StoreData> {
  return new Map(STORE_NAMES.map((store) => [store, new Map<string, StoredValue>()]));
}

function cloneStores(source: Map<StoreName, StoreData>): Map<StoreName, StoreData> {
  const result = createStores();
  for (const store of STORE_NAMES) {
    const target = result.get(store);
    const values = source.get(store);
    if (target === undefined || values === undefined) throw new Error(`Memory store ${store} is missing`);
    for (const [fingerprint, stored] of values) {
      target.set(fingerprint, { key: clone(stored.key), value: clone(stored.value) });
    }
  }
  return result;
}

function assertTransactionStores(stores: readonly StoreName[]): void {
  if (stores.length === 0) throw new DOMException("A transaction needs at least one store", "InvalidAccessError");
  for (const store of stores) {
    if (!STORE_NAMES.includes(store)) throw new DOMException(`Unknown store ${store}`, "NotFoundError");
  }
}

function keyFromValue<T>(store: StoreName, value: T, generateSubmissionId: () => number): IDBValidKey {
  if (!isRecord(value)) throw new DataError("Stored values must be records");
  if (store === "drafts") return [requiredString(value.workspaceId, "workspaceId"), requiredString(value.languageId, "languageId"), requiredString(value.runtimeId, "runtimeId")];
  if (store === "customCases" || store === "progress") return requiredNumber(value.problemId, "problemId");
  if (store === "settings" || store === "meta") return requiredString(value.key, "key");
  const id = value.id;
  return id === undefined ? generateSubmissionId() : requiredNumber(id, "id");
}

function advanceSubmissionId(nextId: number, key: IDBValidKey): number {
  return typeof key === "number" && Number.isSafeInteger(key) && key >= nextId ? key + 1 : nextId;
}

function storedValue<T>(store: StoreName, value: T, key: IDBValidKey): unknown {
  if (store !== "submissions" || !isRecord(value) || typeof key !== "number") return clone(value);
  return { ...clone(value), id: key };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string") throw new DataError(`${name} must be a string key`);
  return value;
}

function requiredNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new DataError(`${name} must be a finite numeric key`);
  return value;
}

function keyFingerprint(key: IDBValidKey): string {
  if (Array.isArray(key)) return `array:[${key.map(keyFingerprint).join(",")}]`;
  if (key instanceof Date) return `date:${key.getTime()}`;
  if (typeof key === "string") return `string:${key}`;
  if (typeof key === "number") return `number:${key}`;
  if (key instanceof ArrayBuffer) return `buffer:${Array.from(new Uint8Array(key)).join(",")}`;
  return `view:${Array.from(new Uint8Array(key.buffer, key.byteOffset, key.byteLength)).join(",")}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataError";
  }
}
