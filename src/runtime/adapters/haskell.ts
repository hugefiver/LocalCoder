import { assertJsonValue, type JsonValue } from "../../domain/json-value.js";
import { type JudgeCaseRequest } from "../protocol.js";
import { RuntimeSupervisor, type RuntimeOperationOptions } from "../supervisor.js";
import { type RuntimeAdapter } from "./types.js";

function judgeCases(inputs: readonly JsonValue[]): readonly JudgeCaseRequest[] {
  return inputs.map((input, index) => ({
    index,
    input: assertJsonValue(input, `Haskell judge input ${index}`),
  }));
}

export function createHaskellAdapter(supervisor: RuntimeSupervisor): RuntimeAdapter {
  const runtimeId = "haskell-ghc-wasi" as const;
  return {
    runtimeId,
    languageId: "haskell",
    execute: (source: string, options?: RuntimeOperationOptions) => supervisor.execute(runtimeId, source, options),
    judge: (source: string, inputs: readonly JsonValue[], options?: RuntimeOperationOptions) => (
      supervisor.judge(runtimeId, source, judgeCases(inputs), options)
    ),
  };
}
