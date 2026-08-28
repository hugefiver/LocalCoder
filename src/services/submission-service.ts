import type { LanguageId, RuntimeId } from "../domain/language.js";
import type { JudgeCommand, SubmissionResult, VisibleCaseResult } from "../domain/submission.js";
import { OjEngine } from "../oj/engine.js";
import type { LocalCoderRepository } from "../storage/repository.js";
import type { CaseCountSummary, ProgressUpdate, SubmissionRecord } from "../storage/schema.js";

const RUNTIME_LANGUAGES: Readonly<Record<RuntimeId, LanguageId>> = {
  "javascript-worker": "javascript",
  "typescript-official": "typescript",
  "python-pyodide": "python",
  "python-rustpython": "python",
  "racket-wasm": "racket",
  "haskell-ghc-wasi": "haskell",
};

const PERSISTENCE_MESSAGE_LIMIT = 192;

export interface SubmissionOutcome {
  result: SubmissionResult;
  persistence: {
    state: "not-requested" | "saved" | "memory-only" | "failed";
    message?: string;
  };
}

export class SubmissionService {
  readonly #engine: OjEngine;
  readonly #repository: LocalCoderRepository;
  readonly #now: () => number;
  readonly #savedListeners = new Set<() => void>();

  constructor(options: { engine: OjEngine; repository: LocalCoderRepository; now: () => number }) {
    this.#engine = options.engine;
    this.#repository = options.repository;
    this.#now = options.now;
  }

  async run(command: Omit<JudgeCommand, "mode">): Promise<SubmissionOutcome> {
    const result = await this.#engine.run({ ...command, mode: "run" });
    return { result, persistence: { state: "not-requested" } };
  }

  subscribeSaved(listener: () => void): () => void {
    this.#savedListeners.add(listener);
    return () => {
      this.#savedListeners.delete(listener);
    };
  }

  async submit(command: Omit<JudgeCommand, "mode">): Promise<SubmissionOutcome> {
    const result = await this.#engine.run({ ...command, mode: "submit" });
    const runtime = result.runtime;
    if (result.verdict === "cancelled" || runtime === undefined) {
      return { result, persistence: { state: "not-requested" } };
    }

    try {
      const createdAt = this.#now();
      await this.#repository.recordSubmission({
        submission: submissionRecord(command, result, runtime, createdAt),
        progressUpdate: progressUpdate(command, result, createdAt),
      });
      const state = this.#repository.storageState;
      this.#notifySaved();
      if (state.kind === "memory") {
        return {
          result,
          persistence: { state: "memory-only", message: `未保存：${bounded(state.reason)}` },
        };
      }
      return { result, persistence: { state: "saved" } };
    } catch (error) {
      return {
        result,
        persistence: {
          state: "failed",
          message: `提交结果未保存：请检查浏览器存储后重试（${bounded(errorMessage(error))}）`,
        },
      };
    }
  }

  #notifySaved(): void {
    for (const listener of [...this.#savedListeners]) {
      if (!this.#savedListeners.has(listener)) continue;
      try {
        listener();
      } catch {
        // Saved observers must not change a successful submission outcome.
      }
    }
  }
}

function submissionRecord(
  command: Omit<JudgeCommand, "mode">,
  result: SubmissionResult,
  runtime: NonNullable<SubmissionResult["runtime"]>,
  createdAt: number,
): Omit<SubmissionRecord, "id"> {
  return {
    problemId: command.problem.id,
    languageId: RUNTIME_LANGUAGES[command.runtimeId],
    runtimeId: command.runtimeId,
    runtimeVersion: runtime.runtimeVersion,
    buildId: runtime.buildId,
    source: command.source,
    verdict: result.verdict,
    elapsedMs: result.elapsedMs,
    caseSummary: {
      public: caseSummary(result.publicCases),
      custom: caseSummary(result.customCases),
      judge: { ...result.judgeSummary },
    },
    output: { ...result.output },
    createdAt,
  };
}

function progressUpdate(
  command: Omit<JudgeCommand, "mode">,
  result: SubmissionResult,
  timestamp: number,
): ProgressUpdate {
  return {
    problemId: command.problem.id,
    attemptedAt: timestamp,
    ...(result.verdict === "accepted"
      ? {
        accepted: {
          acceptedLanguageId: RUNTIME_LANGUAGES[command.runtimeId],
          acceptedRuntimeId: command.runtimeId,
          acceptedAt: timestamp,
        },
      }
      : {}),
  };
}

function caseSummary(cases: readonly VisibleCaseResult[]): CaseCountSummary {
  const passed = cases.filter((testCase) => testCase.comparison?.equal === true).length;
  return { total: cases.length, passed, failed: cases.length - passed };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error;
  return "存储事务被拒绝";
}

function bounded(message: string): string {
  return message.length <= PERSISTENCE_MESSAGE_LIMIT
    ? message
    : `${message.slice(0, PERSISTENCE_MESSAGE_LIMIT - 1)}…`;
}
