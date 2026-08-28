import type { DatabaseDriver, TransactionMode, TransactionView } from "./driver.js";
import { DB_NAME, DB_VERSION, type StoreName } from "./schema.js";

export class IndexedDbDriver implements DatabaseDriver {
  private closed = false;

  constructor(private readonly database: IDBDatabase) {}

  transaction<T>(
    stores: readonly StoreName[],
    mode: TransactionMode,
    work: (transaction: TransactionView) => Promise<T>,
  ): Promise<T> {
    if (this.closed) return Promise.reject(new Error("IndexedDB driver is closed"));
    if (stores.length === 0) return Promise.reject(new DOMException("A transaction needs at least one store", "InvalidAccessError"));

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let workFinished = false;
      let result!: T;
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        reject(asError(error, "IndexedDB transaction failed"));
      };
      let transaction: IDBTransaction;
      try {
        transaction = this.database.transaction([...stores], mode);
      } catch (error) {
        fail(error);
        return;
      }
      const view = createTransactionView(transaction);
      transaction.oncomplete = () => {
        if (!workFinished) {
          fail(new Error("IndexedDB transaction completed before repository work finished"));
          return;
        }
        if (settled) return;
        settled = true;
        resolve(clone(result));
      };
      transaction.onerror = () => fail(transaction.error ?? new Error("IndexedDB transaction request failed"));
      transaction.onabort = () => fail(transaction.error ?? new Error("IndexedDB transaction aborted"));

      Promise.resolve()
        .then(() => work(view))
        .then((value) => {
          result = value;
          workFinished = true;
        })
        .catch((error: unknown) => {
          try {
            transaction.abort();
          } catch {
            // An already completed transaction will report its own terminal event.
          }
          fail(error);
        });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }
}

export function openIndexedDbDriver(indexedDB: IDBFactory): Promise<IndexedDbDriver> {
  return new Promise<IndexedDbDriver>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(asError(error, "IndexedDB open failed"));
    };
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      fail(error);
      return;
    }
    request.onupgradeneeded = () => {
      try {
        createSchema(request.result);
      } catch (error) {
        try {
          request.transaction?.abort();
        } catch {
          // The request's error event remains the authoritative failure signal.
        }
        fail(error);
      }
    };
    request.onblocked = () => fail(new Error("IndexedDB open is blocked"));
    request.onerror = () => fail(request.error ?? new Error("IndexedDB open failed"));
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(new IndexedDbDriver(request.result));
    };
  });
}

function createSchema(database: IDBDatabase): void {
  if (!database.objectStoreNames.contains("drafts")) {
    database.createObjectStore("drafts", { keyPath: ["workspaceId", "languageId", "runtimeId"] });
  }
  if (!database.objectStoreNames.contains("customCases")) {
    database.createObjectStore("customCases", { keyPath: "problemId" });
  }
  if (!database.objectStoreNames.contains("submissions")) {
    const submissions = database.createObjectStore("submissions", { keyPath: "id", autoIncrement: true });
    submissions.createIndex("createdAt", "createdAt", { unique: false });
    submissions.createIndex("problemId", "problemId", { unique: false });
    submissions.createIndex("runtimeId", "runtimeId", { unique: false });
    submissions.createIndex("verdict", "verdict", { unique: false });
  }
  if (!database.objectStoreNames.contains("progress")) {
    database.createObjectStore("progress", { keyPath: "problemId" });
  }
  if (!database.objectStoreNames.contains("settings")) {
    database.createObjectStore("settings", { keyPath: "key" });
  }
  if (!database.objectStoreNames.contains("meta")) {
    database.createObjectStore("meta", { keyPath: "key" });
  }
}

function createTransactionView(transaction: IDBTransaction): TransactionView {
  const store = (name: StoreName): IDBObjectStore => transaction.objectStore(name);
  return {
    get: async <T>(name: StoreName, key: IDBValidKey): Promise<T | undefined> => {
      const value = await requestValue<T | undefined>(store(name).get(key));
      return value === undefined ? undefined : clone(value);
    },
    getAll: async <T>(name: StoreName): Promise<readonly T[]> => {
      const values = await requestValue<T[]>(store(name).getAll());
      return values.map(clone);
    },
    put: async <T>(name: StoreName, value: T, key?: IDBValidKey): Promise<IDBValidKey> => {
      const objectStore = store(name);
      return key === undefined
        ? requestValue<IDBValidKey>(objectStore.put(clone(value)))
        : requestValue<IDBValidKey>(objectStore.put(clone(value), key));
    },
    add: async <T>(name: StoreName, value: T): Promise<IDBValidKey> => (
      requestValue<IDBValidKey>(store(name).add(clone(value)))
    ),
    delete: async (name: StoreName, key: IDBValidKey): Promise<void> => {
      await requestValue<undefined>(store(name).delete(key));
    },
    count: (name: StoreName): Promise<number> => requestValue<number>(store(name).count()),
  };
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function asError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string" && error.length > 0) return new Error(error);
  return new Error(fallback);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
