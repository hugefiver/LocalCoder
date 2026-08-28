import type { Problem } from "../domain/problem.js";
import { parseProblemDocument, validateProblemCorpus } from "./problem-schema.js";

export type ProblemLoader = () => Promise<string>;

export interface ProblemRepository {
  list(): Promise<readonly Problem[]>;
  getById(problemId: number): Promise<Problem | undefined>;
}

export function createProblemRepository(loaders: Record<string, ProblemLoader>): ProblemRepository {
  let successfulCorpus: readonly Problem[] | undefined;
  let pendingLoad: Promise<readonly Problem[]> | undefined;

  const list = async (): Promise<readonly Problem[]> => {
    if (successfulCorpus !== undefined) return successfulCorpus;
    if (pendingLoad !== undefined) return pendingLoad;

    const load = Promise.all(
      Object.entries(loaders)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(async ([filePath, loader]) => parseProblemDocument(filePath, await loader())),
    ).then(validateProblemCorpus);
    pendingLoad = load;

    try {
      successfulCorpus = await load;
      return successfulCorpus;
    } finally {
      pendingLoad = undefined;
    }
  };

  return {
    list,
    async getById(problemId: number): Promise<Problem | undefined> {
      return (await list()).find((problem) => problem.id === problemId);
    },
  };
}
