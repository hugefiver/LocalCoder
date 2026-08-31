import type { RuntimeId } from "../../domain/language.js";
import type { RuntimeAdapterRegistry } from "../../runtime/adapters/registry.js";
import type { ExecutePayload } from "../../runtime/protocol.js";
import type { RuntimeInvocation, RuntimeOperationPhase } from "../../runtime/supervisor.js";
import { isCancellation } from "./executor-model.js";

export type ExecutorCompletion =
  | { kind: "success"; invocation: RuntimeInvocation<ExecutePayload> }
  | { kind: "cancelled" }
  | { kind: "failure"; error: unknown };

export class ExecutorExecution {
  readonly #adapters: RuntimeAdapterRegistry;
  #abortController: AbortController | undefined;

  constructor(adapters: RuntimeAdapterRegistry) {
    this.#adapters = adapters;
  }

  get active(): boolean {
    return this.#abortController !== undefined;
  }

  async execute(
    runtimeId: RuntimeId,
    source: string,
    onPhase: (phase: RuntimeOperationPhase) => void,
  ): Promise<ExecutorCompletion> {
    if (this.#abortController !== undefined) throw new Error("已有执行任务正在进行");
    const abortController = new AbortController();
    this.#abortController = abortController;
    try {
      const invocation = await this.#adapters.get(runtimeId).execute(source, {
        signal: abortController.signal,
        onPhase,
      });
      return { kind: "success", invocation };
    } catch (error) {
      return abortController.signal.aborted || isCancellation(error)
        ? { kind: "cancelled" }
        : { kind: "failure", error };
    } finally {
      if (this.#abortController === abortController) this.#abortController = undefined;
    }
  }

  cancel(): boolean {
    if (this.#abortController === undefined || this.#abortController.signal.aborted) return false;
    this.#abortController.abort();
    return true;
  }

  invalidate(): void {
    this.#abortController?.abort();
    this.#abortController = undefined;
  }
}
