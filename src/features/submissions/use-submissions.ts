import { useCallback, useEffect, useState } from "react";

import type { Problem } from "../../domain/problem.js";
import { useAppServices } from "../../hooks/use-app-services.js";
import type { SubmissionRecord } from "../../storage/schema.js";

export type SubmissionsState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | {
    readonly kind: "ready";
    readonly problems: readonly Problem[];
    readonly records: readonly SubmissionRecord[];
  };

export interface UseSubmissionsResult {
  readonly state: SubmissionsState;
  readonly retry: () => void;
}

export function useSubmissions(): UseSubmissionsResult {
  const services = useAppServices();
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [state, setState] = useState<SubmissionsState>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    let loadGeneration = 0;

    const load = (showLoading: boolean): void => {
      const requestedGeneration = ++loadGeneration;
      if (showLoading) setState({ kind: "loading" });
      void Promise.all([
        services.problems.list(),
        services.storage.listSubmissions(),
      ]).then(([problems, records]) => {
        if (active && requestedGeneration === loadGeneration) {
          setState({ kind: "ready", problems, records });
        }
      }).catch((error: unknown) => {
        if (active && requestedGeneration === loadGeneration) {
          setState({ kind: "error", message: errorMessage(error) });
        }
      });
    };

    load(true);
    const unsubscribeSaved = services.submissions.subscribeSaved(() => load(false));
    return () => {
      active = false;
      loadGeneration += 1;
      unsubscribeSaved();
    };
  }, [retryGeneration, services]);

  const retry = useCallback(() => {
    setRetryGeneration((generation) => generation + 1);
  }, []);
  return { state, retry };
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= 500 ? message : `${message.slice(0, 497)}…`;
}
