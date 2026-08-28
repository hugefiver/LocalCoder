import { assertJsonValue, type JsonValue } from "../../domain/json-value.js";
import { type JudgeCaseRequest } from "../protocol.js";
import { RuntimeSupervisor, type RuntimeOperationOptions } from "../supervisor.js";
import { type RuntimeAdapter } from "./types.js";

function judgeCases(inputs: readonly JsonValue[]): readonly JudgeCaseRequest[] {
  return inputs.map((input, index) => ({
    index,
    input: assertJsonValue(input, `Python judge input ${index}`),
  }));
}

export function createPythonAdapter(
  supervisor: RuntimeSupervisor,
  runtimeId: "python-pyodide",
): RuntimeAdapter {
  return {
    runtimeId,
    languageId: "python",
    execute: (source: string, options?: RuntimeOperationOptions) => (
      supervisor.execute(runtimeId, source, options)
    ),
    judge: (source: string, inputs: readonly JsonValue[], options?: RuntimeOperationOptions) => (
      supervisor.judge(runtimeId, source, judgeCases(inputs), options)
    ),
  };
}
