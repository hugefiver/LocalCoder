import assert from "node:assert/strict";
import test from "node:test";
import { IndexedDbDriver } from "../../src/storage/indexeddb-driver.js";

test("omits the optional key argument when writing an inline-key store", async () => {
  let putArgumentCount = 0;
  const transaction: {
    error: DOMException | null;
    oncomplete: ((event: Event) => unknown) | null;
    onerror: ((event: Event) => unknown) | null;
    onabort: ((event: Event) => unknown) | null;
    objectStore(): IDBObjectStore;
    abort(): void;
  } = {
    error: null,
    oncomplete: null,
    onerror: null,
    onabort: null,
    objectStore(): IDBObjectStore {
      return store as unknown as IDBObjectStore;
    },
    abort(): void {
      transaction.onabort?.(new Event("abort"));
    },
  };
  const store = {
    put(...arguments_: unknown[]): IDBRequest<IDBValidKey> {
      putArgumentCount = arguments_.length;
      const request: {
        result: IDBValidKey;
        error: DOMException | null;
        onsuccess: ((event: Event) => unknown) | null;
        onerror: ((event: Event) => unknown) | null;
      } = { result: "app", error: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        request.onsuccess?.(new Event("success"));
        setTimeout(() => transaction.oncomplete?.(new Event("complete")), 0);
      });
      return request as unknown as IDBRequest<IDBValidKey>;
    },
  };
  const database = {
    transaction(): IDBTransaction {
      return transaction as unknown as IDBTransaction;
    },
    close(): void {},
  };
  const driver = new IndexedDbDriver(database as unknown as IDBDatabase);

  await driver.transaction(["settings"], "readwrite", async (view) => {
    await view.put("settings", { key: "app", value: "fixture" });
  });

  assert.equal(putArgumentCount, 1);
});
