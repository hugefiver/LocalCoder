import type { JsonValue } from "../../src/domain/json-value.js";
import type { RuntimeAdapter } from "../../src/runtime/adapters/types.js";
import type { JudgePayload } from "../../src/runtime/protocol.js";
import type { RuntimeInvocation, RuntimeOperationOptions } from "../../src/runtime/supervisor.js";

export interface JudgeCall {
  readonly source: string;
  readonly inputs: readonly JsonValue[];
  readonly options: RuntimeOperationOptions | undefined;
}

export type JudgeOutcome = RuntimeInvocation<JudgePayload> | { readonly rejection: unknown };

export class FakeRuntimeAdapter implements RuntimeAdapter {
  readonly runtimeId = "javascript-worker" as const;
  readonly languageId = "javascript" as const;
  readonly judgeCalls: JudgeCall[] = [];
  readonly outcomes: JudgeOutcome[] = [];

  async execute(): Promise<never> {
    throw new Error("FakeRuntimeAdapter does not implement execute");
  }

  async judge(
    source: string,
    inputs: readonly JsonValue[],
    options?: RuntimeOperationOptions,
  ): Promise<RuntimeInvocation<JudgePayload>> {
    this.judgeCalls.push({ source, inputs, options });
    const outcome = this.outcomes.shift();
    if (outcome === undefined) throw new Error("FakeRuntimeAdapter has no queued judge outcome");
    if ("rejection" in outcome) throw outcome.rejection;
    return outcome;
  }
}
