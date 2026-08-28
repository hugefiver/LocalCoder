import { validateJsonValue } from "../domain/json-value.js";
import type { SelectedCase } from "../domain/submission.js";
import {
  MAX_OUTPUT_BYTES,
  type BoundedText,
  type JudgeCasePayload,
  type RuntimeFailure,
} from "../runtime/protocol.js";
import type { RuntimeIdentity } from "../runtime/supervisor.js";

const textEncoder = new TextEncoder();

export type ParsedJudgeInvocation =
  | { readonly ok: true; readonly identity: RuntimeIdentity; readonly responses: readonly JudgeCasePayload[] }
  | { readonly ok: false; readonly kind: "invalid-runtime-invocation" }
  | { readonly ok: false; readonly kind: "invalid-judge-response"; readonly identity: RuntimeIdentity };

function byteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && ownKeys.every((key) => typeof key === "string" && keys.includes(key));
}

function validText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && byteLength(value) <= maximum;
}

function parseBoundedText(value: unknown): BoundedText | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["text", "bytes", "truncated"])) return undefined;
  const text = value.text;
  const bytes = value.bytes;
  const truncated = value.truncated;
  if (!validText(text, MAX_OUTPUT_BYTES) || typeof bytes !== "number" || !Number.isSafeInteger(bytes)) return undefined;
  if (bytes < 0 || bytes !== byteLength(text) || typeof truncated !== "boolean") return undefined;
  return { text, bytes, truncated };
}

export function parseRuntimeFailure(value: unknown): RuntimeFailure | undefined {
  if (!isRecord(value)) return undefined;
  const basic = hasExactKeys(value, ["kind", "code", "message", "fatal"]);
  const detailed = hasExactKeys(value, ["kind", "code", "message", "details", "fatal"]);
  if (!basic && !detailed) return undefined;
  const kind = value.kind;
  const code = value.code;
  const message = value.message;
  const fatal = value.fatal;
  if (kind !== "compile" && kind !== "runtime" && kind !== "infrastructure" && kind !== "protocol" && kind !== "cancelled") {
    return undefined;
  }
  if (!validText(code, 128) || code.trim().length === 0 || !validText(message, 4_096) || message.trim().length === 0 || typeof fatal !== "boolean") {
    return undefined;
  }
  if (!detailed) return { kind, code, message, fatal };
  const details = value.details;
  return validText(details, 8_192) ? { kind, code, message, details, fatal } : undefined;
}

function parseCase(value: unknown): JudgeCasePayload | undefined {
  if (!isRecord(value)) return undefined;
  const index = value.index;
  if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) return undefined;
  const stdout = parseBoundedText(value.stdout);
  const stderr = parseBoundedText(value.stderr);
  if (stdout === undefined || stderr === undefined) return undefined;
  if (value.ok === true && hasExactKeys(value, ["index", "ok", "actual", "stdout", "stderr"])) {
    const actual = validateJsonValue(value.actual);
    return actual.ok ? { index, ok: true, actual: actual.value, stdout, stderr } : undefined;
  }
  if (value.ok === false && hasExactKeys(value, ["index", "ok", "failure", "stdout", "stderr"])) {
    const failure = parseRuntimeFailure(value.failure);
    return failure === undefined ? undefined : { index, ok: false, failure, stdout, stderr };
  }
  return undefined;
}

function parseResponses(
  value: unknown,
  selected: readonly SelectedCase[],
  outputLimit: number,
): readonly JudgeCasePayload[] | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["cases"]) || !Array.isArray(value.cases) || value.cases.length !== selected.length) {
    return undefined;
  }
  const byIndex = new Map<number, JudgeCasePayload>();
  let outputBytes = 0;
  for (const item of value.cases) {
    const response = parseCase(item);
    if (response === undefined || byIndex.has(response.index)) return undefined;
    outputBytes += response.stdout.bytes + response.stderr.bytes;
    if (outputBytes > outputLimit) return undefined;
    byIndex.set(response.index, response);
  }
  const ordered: JudgeCasePayload[] = [];
  for (const testCase of selected) {
    const response = byIndex.get(testCase.index);
    if (response === undefined) return undefined;
    ordered.push(response);
  }
  return ordered;
}

function parseIdentity(value: unknown): RuntimeIdentity | undefined {
  if (!isRecord(value)) return undefined;
  const runtimeVersion = value.runtimeVersion;
  const buildId = value.buildId;
  if (!validText(runtimeVersion, 256) || runtimeVersion.trim().length === 0 || !validText(buildId, 256) || buildId.trim().length === 0) {
    return undefined;
  }
  return { runtimeVersion, buildId };
}

export function parseJudgeInvocation(
  value: unknown,
  selected: readonly SelectedCase[],
  outputLimit: number,
): ParsedJudgeInvocation {
  if (!isRecord(value)) return { ok: false, kind: "invalid-runtime-invocation" };
  const identity = parseIdentity(value.identity);
  if (identity === undefined) return { ok: false, kind: "invalid-runtime-invocation" };
  const responses = parseResponses(value.payload, selected, outputLimit);
  return responses === undefined
    ? { ok: false, kind: "invalid-judge-response", identity }
    : { ok: true, identity, responses };
}
