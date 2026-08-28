import { type JsonValue } from "../../domain/json-value.js";
import { type LanguageId, type RuntimeId } from "../../domain/language.js";
import {
  type ExecutePayload,
  type JudgePayload,
} from "../protocol.js";
import {
  type RuntimeInvocation,
  type RuntimeOperationOptions,
} from "../supervisor.js";

export interface RuntimeAdapter {
  readonly runtimeId: RuntimeId;
  readonly languageId: LanguageId;
  execute(
    source: string,
    options?: RuntimeOperationOptions,
  ): Promise<RuntimeInvocation<ExecutePayload>>;
  judge(
    source: string,
    inputs: readonly JsonValue[],
    options?: RuntimeOperationOptions,
  ): Promise<RuntimeInvocation<JudgePayload>>;
}
