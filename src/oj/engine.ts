import type { JudgeCommand, SubmissionResult } from "../domain/submission.js";
import { RuntimeAdapterRegistry } from "../runtime/adapters/registry.js";
import { RuntimeRegistry } from "../runtime/registry.js";
import { runtimeFailureIdentity } from "../runtime/supervisor-faults.js";
import { selectCases } from "./case-selection.js";
import { parseJudgeInvocation, parseRuntimeFailure } from "./judge-response.js";
import {
  elapsedMs,
  judgeOperationOptions,
  resolveJudgeRuntime,
  validateJudgeCommand,
  validateJudgeSubmission,
} from "./judge-validation.js";
import { aggregateSubmission, failureResult, verdictForFailure } from "./submission-aggregation.js";

export class OjEngine {
  readonly #registry: RuntimeRegistry;
  readonly #adapters: RuntimeAdapterRegistry;
  readonly #now: () => number;

  constructor(options: { registry: RuntimeRegistry; adapters: RuntimeAdapterRegistry; now: () => number }) {
    this.#registry = options.registry;
    this.#adapters = options.adapters;
    this.#now = options.now;
  }

  async run(command: JudgeCommand): Promise<SubmissionResult> {
    validateJudgeCommand(command);
    const selected = selectCases(command.problem, command.mode, command.customCases);
    const resolution = resolveJudgeRuntime(this.#registry, this.#adapters, command.runtimeId);
    const startedAt = this.#now();
    if (!resolution.available) {
      return failureResult("runtime-unavailable", selected, elapsedMs(this.#now, startedAt), {
        code: "runtime-unavailable",
        message: "The selected runtime cannot judge this submission",
      });
    }
    validateJudgeSubmission(command, selected, resolution.capability);
    if (command.signal?.aborted) {
      return failureResult("cancelled", selected, elapsedMs(this.#now, startedAt), {
        code: "cancelled",
        message: "Judge operation was cancelled",
      });
    }

    try {
      const invocation = await resolution.adapter.judge(
        command.source,
        selected.map(({ input }) => input),
        judgeOperationOptions(command.signal, command.problem.timeoutMs),
      );
      const parsed = parseJudgeInvocation(invocation, selected, resolution.capability.limits.outputBytes);
      if (!parsed.ok) {
        const runtime = "identity" in parsed ? {
          runtimeId: command.runtimeId,
          runtimeVersion: parsed.identity.runtimeVersion,
          buildId: parsed.identity.buildId,
        } : undefined;
        return failureResult("internal-error", selected, elapsedMs(this.#now, startedAt), {
          code: parsed.kind,
          message: parsed.kind === "invalid-runtime-invocation"
            ? "Runtime returned an invalid invocation result"
            : "Runtime returned an invalid judge response",
        }, runtime);
      }
      return aggregateSubmission(selected, parsed.responses, elapsedMs(this.#now, startedAt), {
        runtimeId: command.runtimeId,
        runtimeVersion: parsed.identity.runtimeVersion,
        buildId: parsed.identity.buildId,
      });
    } catch (error) {
      const failure = parseRuntimeFailure(error);
      const summary = failure === undefined
        ? { code: "runtime-invocation-failed", message: "Runtime invocation failed" }
        : { code: failure.code, message: failure.message };
      const identity = failure === undefined ? undefined : runtimeFailureIdentity(error);
      const runtime = identity === undefined ? undefined : {
        runtimeId: command.runtimeId,
        runtimeVersion: identity.runtimeVersion,
        buildId: identity.buildId,
      };
      return failureResult(
        failure === undefined ? "internal-error" : verdictForFailure(failure),
        selected,
        elapsedMs(this.#now, startedAt),
        summary,
        runtime,
      );
    }
  }
}
