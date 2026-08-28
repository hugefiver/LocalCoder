import { useEffect, useMemo, useSyncExternalStore } from "react";

import { useAppServices } from "../../hooks/use-app-services.js";
import { systemClock } from "../../runtime/worker-port.js";
import {
  ProblemWorkspaceController,
  type ProblemWorkspaceSnapshot,
} from "./workspace-controller.js";

export interface ProblemWorkspaceBinding {
  controller: ProblemWorkspaceController;
  snapshot: ProblemWorkspaceSnapshot;
}

export function useProblemWorkspace(problemId: number): ProblemWorkspaceBinding {
  const services = useAppServices();
  const controller = useMemo(() => new ProblemWorkspaceController({
    problems: services.problems,
    registry: services.registry,
    submissions: services.submissions,
    storage: services.storage,
    clock: systemClock,
  }), [services]);
  const snapshot = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getSnapshot(),
    () => controller.getSnapshot(),
  );

  useEffect(() => {
    void controller.load(problemId);
  }, [controller, problemId]);

  useEffect(() => () => controller.dispose(), [controller]);

  return { controller, snapshot };
}
