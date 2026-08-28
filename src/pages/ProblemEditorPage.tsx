import { useMemo } from "react";
import { useParams } from "react-router-dom";

import { ProblemWorkspace } from "../features/problems/ProblemWorkspace.js";

export function ProblemEditorPage() {
  const params = useParams();

  const problemId = useMemo(() => {
    const n = Number(params.id);
    return Number.isFinite(n) ? n : 0;
  }, [params.id]);

  return <ProblemWorkspace problemId={problemId} />;
}
