import { useMemo, useSyncExternalStore } from "react";

import type { LocalCoderRepository } from "../storage/repository.js";
import type { StorageState } from "../storage/schema.js";
import { useAppServices } from "./use-app-services.js";

interface StorageExternalStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => StorageState;
}

const storageStores = new WeakMap<LocalCoderRepository, StorageExternalStore>();

export function useStorageState(): StorageState {
  const { storage } = useAppServices();
  const store = useMemo(() => externalStoreFor(storage), [storage]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

function externalStoreFor(storage: LocalCoderRepository): StorageExternalStore {
  const existing = storageStores.get(storage);
  if (existing !== undefined) return existing;

  let snapshot = storage.storageState;
  const listeners = new Set<() => void>();
  let unsubscribeStorage: (() => void) | null = null;

  const store: StorageExternalStore = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      if (unsubscribeStorage === null) {
        unsubscribeStorage = storage.subscribeStorageState((nextSnapshot) => {
          snapshot = nextSnapshot;
          for (const notify of [...listeners]) notify();
        });
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && unsubscribeStorage !== null) {
          unsubscribeStorage();
          unsubscribeStorage = null;
        }
      };
    },
  };
  storageStores.set(storage, store);
  return store;
}
