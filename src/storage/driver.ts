import type { StoreName } from "./schema.js";

export type TransactionMode = "readonly" | "readwrite";

export interface TransactionView {
  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined>;
  getAll<T>(store: StoreName): Promise<readonly T[]>;
  put<T>(store: StoreName, value: T, key?: IDBValidKey): Promise<IDBValidKey>;
  add<T>(store: StoreName, value: T): Promise<IDBValidKey>;
  delete(store: StoreName, key: IDBValidKey): Promise<void>;
  count(store: StoreName): Promise<number>;
}

export interface DatabaseDriver {
  transaction<T>(
    stores: readonly StoreName[],
    mode: TransactionMode,
    work: (transaction: TransactionView) => Promise<T>,
  ): Promise<T>;
  close(): void;
}
