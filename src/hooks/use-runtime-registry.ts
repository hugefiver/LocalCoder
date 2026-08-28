import { useMemo, useSyncExternalStore } from "react";

import type { RuntimeCapability, RuntimeRegistry } from "../runtime/registry.js";
import { useAppServices } from "./use-app-services.js";

interface RegistryExternalStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => readonly RuntimeCapability[];
}

const registryStores = new WeakMap<RuntimeRegistry, RegistryExternalStore>();

export function useRuntimeRegistry(): readonly RuntimeCapability[] {
  const { registry } = useAppServices();
  const store = useMemo(() => externalStoreFor(registry), [registry]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

function externalStoreFor(registry: RuntimeRegistry): RegistryExternalStore {
  const existing = registryStores.get(registry);
  if (existing !== undefined) return existing;

  let snapshot = registry.list();
  const listeners = new Set<() => void>();
  let unsubscribeRegistry: (() => void) | null = null;

  const store: RegistryExternalStore = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      if (unsubscribeRegistry === null) {
        unsubscribeRegistry = registry.subscribe((nextSnapshot) => {
          snapshot = nextSnapshot;
          for (const notify of [...listeners]) notify();
        });
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && unsubscribeRegistry !== null) {
          unsubscribeRegistry();
          unsubscribeRegistry = null;
        }
      };
    },
  };
  registryStores.set(registry, store);
  return store;
}
