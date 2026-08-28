import type { JudgeCommand } from "../../domain/submission.js";
import type { SubmissionService, SubmissionOutcome } from "../../services/submission-service.js";

export type WorkspaceExecutionCompletion =
  | { kind: "outcome"; outcome: SubmissionOutcome }
  | { kind: "cancelled" }
  | { kind: "failure"; error: unknown };

export class WorkspaceExecution {
  readonly #submissions: SubmissionService;
  #active: AbortController | undefined;

  constructor(submissions: SubmissionService) {
    this.#submissions = submissions;
  }

  get active(): boolean {
    return this.#active !== undefined;
  }

  async execute(
    mode: "run" | "submit",
    command: Omit<JudgeCommand, "mode" | "signal">,
  ): Promise<WorkspaceExecutionCompletion> {
    if (this.#active !== undefined) throw new Error("已有执行任务正在进行");
    const abortController = new AbortController();
    this.#active = abortController;
    try {
      const input = { ...command, signal: abortController.signal };
      const outcome = mode === "run"
        ? await this.#submissions.run(input)
        : await this.#submissions.submit(input);
      return { kind: "outcome", outcome };
    } catch (error) {
      return abortController.signal.aborted || isAbortError(error)
        ? { kind: "cancelled" }
        : { kind: "failure", error };
    } finally {
      if (this.#active === abortController) this.#active = undefined;
    }
  }

  cancel(): boolean {
    if (this.#active === undefined) return false;
    this.#active.abort();
    return true;
  }

  invalidate(): void {
    this.#active?.abort();
    this.#active = undefined;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
