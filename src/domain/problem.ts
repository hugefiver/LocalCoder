import type { JsonValue } from "./json-value.js";
import type { LanguageId } from "./language.js";

export type ProblemDifficulty = "Easy" | "Medium" | "Hard";

export interface ProblemCase {
  input: JsonValue;
  expected: JsonValue;
}

export interface ProblemExample {
  input: string;
  output: string;
  explanation?: string;
}

export interface Problem {
  schemaVersion: 2;
  id: number;
  slug: string;
  title: string;
  difficulty: ProblemDifficulty;
  summary: string;
  tags: readonly string[];
  examples: readonly ProblemExample[];
  constraints: readonly string[];
  entrypoint: "solution";
  contract: "json-function-v1";
  templates: Readonly<Partial<Record<LanguageId, string>>>;
  tests: {
    public: readonly ProblemCase[];
    judge: readonly ProblemCase[];
  };
  timeoutMs?: number;
  markdown: string;
  safeHtml: string;
}
