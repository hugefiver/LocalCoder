import { useEffect, useState } from "react";
import type { Problem } from "@/domain/problem";
import { loadProblems } from "@/problems/problem-modules";

export function useProblems() {
  const [problems, setProblems] = useState<readonly Problem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await loadProblems();
        if (cancelled) return;
        setProblems(data);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  return { problems, isLoading, error };
}
