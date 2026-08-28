import { assertJsonValue, type JsonValue } from "../../domain/json-value.js";
import { type JudgeCaseRequest } from "../protocol.js";
import { RuntimeSupervisor, type RuntimeOperationOptions } from "../supervisor.js";
import { type RuntimeAdapter } from "./types.js";

const runtimeId = "javascript-worker" as const;

function judgeCases(inputs: readonly JsonValue[]): readonly JudgeCaseRequest[] {
  return inputs.map((input, index) => ({
    index,
    input: assertJsonValue(input, `JavaScript judge input ${index}`),
  }));
}

export function createJavascriptAdapter(supervisor: RuntimeSupervisor): RuntimeAdapter {
  return {
    runtimeId,
    languageId: "javascript",
    execute: (source: string, options?: RuntimeOperationOptions) => (
      supervisor.execute(runtimeId, source, options)
    ),
    judge: (source: string, inputs: readonly JsonValue[], options?: RuntimeOperationOptions) => (
      supervisor.judge(runtimeId, source, judgeCases(inputs), options)
    ),
  };
}
