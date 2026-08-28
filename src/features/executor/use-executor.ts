import { useEffect, useMemo, useSyncExternalStore } from "react";

import { useAppServices } from "../../hooks/use-app-services.js";
import { systemClock } from "../../runtime/worker-port.js";
import { ExecutorController, type ExecutorSnapshot } from "./executor-controller.js";

export interface ExecutorBinding {
  controller: ExecutorController;
  snapshot: ExecutorSnapshot;
}

export function useExecutor(): ExecutorBinding {
  const services = useAppServices();
  const controller = useMemo(() => new ExecutorController({
    registry: services.registry,
    adapters: services.adapters,
    storage: services.storage,
    clock: systemClock,
  }), [services]);
  const snapshot = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getSnapshot(),
    () => controller.getSnapshot(),
  );

  useEffect(() => {
    void controller.load();
  }, [controller]);

  useEffect(() => () => controller.dispose(), [controller]);

  return { controller, snapshot };
}
