import { type JsonValue, validateJsonValue } from "../domain/json-value.js";
import { RUNTIME_IDS, type RuntimeId } from "../domain/language.js";

export interface Envelope {
  readonly protocolVersion: 1;
  readonly requestId: string;
  readonly runtimeId: RuntimeId;
}

export interface JudgeCaseRequest {
  readonly index: number;
  readonly input: JsonValue;
}

export type WorkerRequest = Envelope & (
  | { readonly type: "initialize" }
  | { readonly type: "execute"; readonly source: string }
  | { readonly type: "judge"; readonly source: string; readonly cases: readonly JudgeCaseRequest[] }
  | { readonly type: "dispose" }
);

export interface RuntimeFailure {
  readonly kind: "compile" | "runtime" | "infrastructure" | "protocol" | "cancelled";
  readonly code: string;
  readonly message: string;
  readonly details?: string;
  readonly fatal: boolean;
}

export interface InitializePayload {
  readonly runtimeVersion: string;
  readonly buildId: string;
  readonly capabilities: { readonly execute: boolean; readonly judge: boolean };
}

export interface BoundedText {
  readonly text: string;
  readonly bytes: number;
  readonly truncated: boolean;
}

export interface ExecutePayload {
  readonly stdout: BoundedText;
  readonly stderr: BoundedText;
  readonly value: JsonValue | null;
}

export type JudgeCasePayload =
  | {
    readonly index: number;
    readonly ok: true;
    readonly actual: JsonValue;
    readonly stdout: BoundedText;
    readonly stderr: BoundedText;
  }
  | {
    readonly index: number;
    readonly ok: false;
    readonly failure: RuntimeFailure;
    readonly stdout: BoundedText;
    readonly stderr: BoundedText;
  };

export interface JudgePayload {
  readonly cases: readonly JudgeCasePayload[];
}

export type WorkerResponse = Envelope & (
  | { readonly type: "status"; readonly phase: "initializing" | "executing"; readonly message: string }
  | { readonly type: "complete"; readonly operation: "initialize"; readonly payload: InitializePayload }
  | { readonly type: "complete"; readonly operation: "execute"; readonly payload: ExecutePayload }
  | { readonly type: "complete"; readonly operation: "judge"; readonly payload: JudgePayload }
  | { readonly type: "complete"; readonly operation: "dispose"; readonly payload: { readonly disposed: true } }
  | { readonly type: "failure"; readonly error: RuntimeFailure }
);

export const MAX_SOURCE_BYTES = 262_144;
export const MAX_CASE_COUNT = 100;
export const MAX_OUTPUT_BYTES = 65_536;

type PlainRecord = Record<string, unknown>;

const textEncoder = new TextEncoder();
const MAX_REQUEST_ID_BYTES = 256;
const MAX_IDENTIFIER_BYTES = 256;
const MAX_FAILURE_CODE_BYTES = 128;
const MAX_MESSAGE_BYTES = 4_096;
const MAX_DETAILS_BYTES = 8_192;
const MAX_CASE_VALUE_BYTES = 65_536;

function protocolError(path: string, message: string): never {
  throw new TypeError(`Worker protocol at ${path}: ${message}`);
}

function isPlainRecord(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(record: PlainRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function propertyValue(record: PlainRecord, key: string, path: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) protocolError(path, "is missing a required field");
  if (!("value" in descriptor)) protocolError(path, "must be a data property");
  return descriptor.value;
}

function assertExactFields(
  record: PlainRecord,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  const allowedFields = new Set(allowed);
  const ownKeys = Reflect.ownKeys(record);
  if (ownKeys.some((key) => typeof key !== "string" || !allowedFields.has(key))) {
    protocolError(path, "contains an unknown field");
  }
  for (const key of required) {
    if (!hasOwn(record, key)) protocolError(`${path}.${key}`, "is missing a required field");
  }
  for (const key of ownKeys) {
    if (typeof key !== "string") continue;
    propertyValue(record, key, `${path}.${key}`);
  }
}

function assertString(value: unknown, path: string, maxBytes: number, nonBlank = false): string {
  if (typeof value !== "string") protocolError(path, "must be a string");
  const byteLength = textEncoder.encode(value).byteLength;
  if (byteLength > maxBytes) protocolError(path, `must not exceed ${maxBytes} UTF-8 bytes`);
  if (nonBlank && value.trim().length === 0) protocolError(path, "must be non-blank");
  return value;
}

function assertNonNegativeInteger(value: unknown, path: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
    protocolError(path, `must be a non-negative integer no greater than ${maximum}`);
  }
  return value;
}

function parseEnvelope(record: PlainRecord, path: string): Envelope {
  const protocolVersion = propertyValue(record, "protocolVersion", `${path}.protocolVersion`);
  if (protocolVersion !== 1) {
    if (typeof protocolVersion === "number" && Number.isSafeInteger(protocolVersion)) {
      protocolError(`${path}.protocolVersion`, `unsupported protocolVersion ${protocolVersion}`);
    }
    protocolError(`${path}.protocolVersion`, "unsupported protocolVersion");
  }
  const requestId = assertString(
    propertyValue(record, "requestId", `${path}.requestId`),
    `${path}.requestId`,
    MAX_REQUEST_ID_BYTES,
    true,
  );
  const runtimeIdValue = propertyValue(record, "runtimeId", `${path}.runtimeId`);
  if (typeof runtimeIdValue !== "string" || !RUNTIME_IDS.includes(runtimeIdValue as RuntimeId)) {
    protocolError(`${path}.runtimeId`, "must be a known runtimeId");
  }
  return { protocolVersion: 1, requestId, runtimeId: runtimeIdValue as RuntimeId };
}

function parseJsonValue(value: unknown, path: string): JsonValue {
  const validation = validateJsonValue(value, { maxBytes: MAX_CASE_VALUE_BYTES });
  if (!validation.ok) protocolError(path, "must be a canonical JSON value within 65536 UTF-8 bytes");
  return validation.value;
}

function parseBoundedText(value: unknown, path: string): BoundedText {
  if (!isPlainRecord(value)) protocolError(path, "must be an object");
  assertExactFields(value, ["text", "bytes", "truncated"], ["text", "bytes", "truncated"], path);
  const text = assertString(propertyValue(value, "text", `${path}.text`), `${path}.text`, MAX_OUTPUT_BYTES);
  const bytes = assertNonNegativeInteger(
    propertyValue(value, "bytes", `${path}.bytes`),
    `${path}.bytes`,
    MAX_OUTPUT_BYTES,
  );
  if (textEncoder.encode(text).byteLength !== bytes) {
    protocolError(`${path}.bytes`, "must match the UTF-8 byte length of text");
  }
  const truncated = propertyValue(value, "truncated", `${path}.truncated`);
  if (typeof truncated !== "boolean") protocolError(`${path}.truncated`, "must be a boolean");
  return { text, bytes, truncated };
}

function assertCombinedOutput(stdout: BoundedText, stderr: BoundedText, path: string): void {
  if (stdout.bytes + stderr.bytes > MAX_OUTPUT_BYTES) {
    protocolError(path, `combined stdout and stderr must not exceed ${MAX_OUTPUT_BYTES} UTF-8 bytes`);
  }
}

function parseRuntimeFailure(value: unknown, path: string): RuntimeFailure {
  if (!isPlainRecord(value)) protocolError(path, "must be an object");
  assertExactFields(value, ["kind", "code", "message", "details", "fatal"], ["kind", "code", "message", "fatal"], path);
  const kind = propertyValue(value, "kind", `${path}.kind`);
  if (
    kind !== "compile"
    && kind !== "runtime"
    && kind !== "infrastructure"
    && kind !== "protocol"
    && kind !== "cancelled"
  ) {
    protocolError(`${path}.kind`, "must be a known failure kind");
  }
  const fatal = propertyValue(value, "fatal", `${path}.fatal`);
  if (typeof fatal !== "boolean") protocolError(`${path}.fatal`, "must be a boolean");
  const failure: RuntimeFailure = {
    kind,
    code: assertString(propertyValue(value, "code", `${path}.code`), `${path}.code`, MAX_FAILURE_CODE_BYTES, true),
    message: assertString(propertyValue(value, "message", `${path}.message`), `${path}.message`, MAX_MESSAGE_BYTES, true),
    fatal,
  };
  if (hasOwn(value, "details")) {
    return {
      ...failure,
      details: assertString(
        propertyValue(value, "details", `${path}.details`),
        `${path}.details`,
        MAX_DETAILS_BYTES,
      ),
    };
  }
  return failure;
}

function parseCapabilities(value: unknown, path: string): { readonly execute: boolean; readonly judge: boolean } {
  if (!isPlainRecord(value)) protocolError(path, "must be an object");
  assertExactFields(value, ["execute", "judge"], ["execute", "judge"], path);
  const execute = propertyValue(value, "execute", `${path}.execute`);
  const judge = propertyValue(value, "judge", `${path}.judge`);
  if (typeof execute !== "boolean") protocolError(`${path}.execute`, "must be a boolean");
  if (typeof judge !== "boolean") protocolError(`${path}.judge`, "must be a boolean");
  return { execute, judge };
}

function parseInitializePayload(value: unknown, path: string): InitializePayload {
  if (!isPlainRecord(value)) protocolError(path, "must be an object");
  assertExactFields(value, ["runtimeVersion", "buildId", "capabilities"], ["runtimeVersion", "buildId", "capabilities"], path);
  return {
    runtimeVersion: assertString(
      propertyValue(value, "runtimeVersion", `${path}.runtimeVersion`),
      `${path}.runtimeVersion`,
      MAX_IDENTIFIER_BYTES,
      true,
    ),
    buildId: assertString(
      propertyValue(value, "buildId", `${path}.buildId`),
      `${path}.buildId`,
      MAX_IDENTIFIER_BYTES,
      true,
    ),
    capabilities: parseCapabilities(propertyValue(value, "capabilities", `${path}.capabilities`), `${path}.capabilities`),
  };
}

function parseExecutePayload(value: unknown, path: string): ExecutePayload {
  if (!isPlainRecord(value)) protocolError(path, "must be an object");
  assertExactFields(value, ["stdout", "stderr", "value"], ["stdout", "stderr", "value"], path);
  const stdout = parseBoundedText(propertyValue(value, "stdout", `${path}.stdout`), `${path}.stdout`);
  const stderr = parseBoundedText(propertyValue(value, "stderr", `${path}.stderr`), `${path}.stderr`);
  assertCombinedOutput(stdout, stderr, path);
  return {
    stdout,
    stderr,
    value: parseJsonValue(propertyValue(value, "value", `${path}.value`), `${path}.value`),
  };
}

function parseJudgeCaseRequest(value: unknown, path: string): JudgeCaseRequest {
  if (!isPlainRecord(value)) protocolError(path, "must be an object");
  assertExactFields(value, ["index", "input"], ["index", "input"], path);
  return {
    index: assertNonNegativeInteger(propertyValue(value, "index", `${path}.index`), `${path}.index`, Number.MAX_SAFE_INTEGER),
    input: parseJsonValue(propertyValue(value, "input", `${path}.input`), `${path}.input`),
  };
}

function parseJudgeCases(value: unknown, path: string): readonly JudgeCaseRequest[] {
  if (!Array.isArray(value) || value.length > MAX_CASE_COUNT) {
    protocolError(path, `must be an array with at most ${MAX_CASE_COUNT} cases`);
  }
  const indexes = new Set<number>();
  const cases = value.map((item, index) => {
    const parsed = parseJudgeCaseRequest(item, `${path}[${index}]`);
    if (indexes.has(parsed.index)) protocolError(`${path}[${index}].index`, "must be unique");
    indexes.add(parsed.index);
    return parsed;
  });
  return cases;
}

function parseJudgeCasePayload(value: unknown, path: string): JudgeCasePayload {
  if (!isPlainRecord(value)) protocolError(path, "must be an object");
  const ok = propertyValue(value, "ok", `${path}.ok`);
  if (ok === true) {
    assertExactFields(value, ["index", "ok", "actual", "stdout", "stderr"], ["index", "ok", "actual", "stdout", "stderr"], path);
    const stdout = parseBoundedText(propertyValue(value, "stdout", `${path}.stdout`), `${path}.stdout`);
    const stderr = parseBoundedText(propertyValue(value, "stderr", `${path}.stderr`), `${path}.stderr`);
    assertCombinedOutput(stdout, stderr, path);
    return {
      index: assertNonNegativeInteger(propertyValue(value, "index", `${path}.index`), `${path}.index`, Number.MAX_SAFE_INTEGER),
      ok: true,
      actual: parseJsonValue(propertyValue(value, "actual", `${path}.actual`), `${path}.actual`),
      stdout,
      stderr,
    };
  }
  if (ok === false) {
    assertExactFields(value, ["index", "ok", "failure", "stdout", "stderr"], ["index", "ok", "failure", "stdout", "stderr"], path);
    const stdout = parseBoundedText(propertyValue(value, "stdout", `${path}.stdout`), `${path}.stdout`);
    const stderr = parseBoundedText(propertyValue(value, "stderr", `${path}.stderr`), `${path}.stderr`);
    assertCombinedOutput(stdout, stderr, path);
    return {
      index: assertNonNegativeInteger(propertyValue(value, "index", `${path}.index`), `${path}.index`, Number.MAX_SAFE_INTEGER),
      ok: false,
      failure: parseRuntimeFailure(propertyValue(value, "failure", `${path}.failure`), `${path}.failure`),
      stdout,
      stderr,
    };
  }
  protocolError(`${path}.ok`, "must be a boolean");
}

function parseJudgePayload(value: unknown, path: string): JudgePayload {
  if (!isPlainRecord(value)) protocolError(path, "must be an object");
  assertExactFields(value, ["cases"], ["cases"], path);
  const casesValue = propertyValue(value, "cases", `${path}.cases`);
  if (!Array.isArray(casesValue) || casesValue.length > MAX_CASE_COUNT) {
    protocolError(`${path}.cases`, `must be an array with at most ${MAX_CASE_COUNT} cases`);
  }
  const indexes = new Set<number>();
  let outputBytes = 0;
  const cases = casesValue.map((item, index) => {
    const parsed = parseJudgeCasePayload(item, `${path}.cases[${index}]`);
    if (indexes.has(parsed.index)) protocolError(`${path}.cases[${index}].index`, "must be unique");
    indexes.add(parsed.index);
    outputBytes += parsed.stdout.bytes + parsed.stderr.bytes;
    if (outputBytes > MAX_OUTPUT_BYTES) {
      protocolError(`${path}.cases`, `combined stdout and stderr must not exceed ${MAX_OUTPUT_BYTES} UTF-8 bytes`);
    }
    return parsed;
  });
  return { cases };
}

function parseDisposePayload(value: unknown, path: string): { readonly disposed: true } {
  if (!isPlainRecord(value)) protocolError(path, "must be an object");
  assertExactFields(value, ["disposed"], ["disposed"], path);
  if (propertyValue(value, "disposed", `${path}.disposed`) !== true) {
    protocolError(`${path}.disposed`, "must be true");
  }
  return { disposed: true };
}

export function parseWorkerRequest(input: unknown): WorkerRequest {
  if (!isPlainRecord(input)) protocolError("$", "must be an object");
  const type = propertyValue(input, "type", "$.type");
  if (type === "initialize") {
    assertExactFields(input, ["protocolVersion", "requestId", "runtimeId", "type"], ["protocolVersion", "requestId", "runtimeId", "type"], "$");
    return { ...parseEnvelope(input, "$"), type };
  }
  if (type === "execute") {
    assertExactFields(input, ["protocolVersion", "requestId", "runtimeId", "type", "source"], ["protocolVersion", "requestId", "runtimeId", "type", "source"], "$");
    return {
      ...parseEnvelope(input, "$"),
      type,
      source: assertString(propertyValue(input, "source", "$.source"), "$.source", MAX_SOURCE_BYTES),
    };
  }
  if (type === "judge") {
    assertExactFields(input, ["protocolVersion", "requestId", "runtimeId", "type", "source", "cases"], ["protocolVersion", "requestId", "runtimeId", "type", "source", "cases"], "$");
    return {
      ...parseEnvelope(input, "$"),
      type,
      source: assertString(propertyValue(input, "source", "$.source"), "$.source", MAX_SOURCE_BYTES),
      cases: parseJudgeCases(propertyValue(input, "cases", "$.cases"), "$.cases"),
    };
  }
  if (type === "dispose") {
    assertExactFields(input, ["protocolVersion", "requestId", "runtimeId", "type"], ["protocolVersion", "requestId", "runtimeId", "type"], "$");
    return { ...parseEnvelope(input, "$"), type };
  }
  protocolError("$.type", "unknown request type");
}

export function parseWorkerResponse(input: unknown, expectedRuntimeId: RuntimeId): WorkerResponse {
  if (!isPlainRecord(input)) protocolError("$", "must be an object");
  const type = propertyValue(input, "type", "$.type");
  if (type === "status") {
    assertExactFields(input, ["protocolVersion", "requestId", "runtimeId", "type", "phase", "message"], ["protocolVersion", "requestId", "runtimeId", "type", "phase", "message"], "$");
    const envelope = parseEnvelope(input, "$");
    if (envelope.runtimeId !== expectedRuntimeId) protocolError("$.runtimeId", "runtimeId mismatch");
    const phase = propertyValue(input, "phase", "$.phase");
    if (phase !== "initializing" && phase !== "executing") protocolError("$.phase", "must be initializing or executing");
    return {
      ...envelope,
      type,
      phase,
      message: assertString(propertyValue(input, "message", "$.message"), "$.message", MAX_MESSAGE_BYTES),
    };
  }
  if (type === "failure") {
    assertExactFields(input, ["protocolVersion", "requestId", "runtimeId", "type", "error"], ["protocolVersion", "requestId", "runtimeId", "type", "error"], "$");
    const envelope = parseEnvelope(input, "$");
    if (envelope.runtimeId !== expectedRuntimeId) protocolError("$.runtimeId", "runtimeId mismatch");
    return {
      ...envelope,
      type,
      error: parseRuntimeFailure(propertyValue(input, "error", "$.error"), "$.error"),
    };
  }
  if (type === "complete") {
    assertExactFields(input, ["protocolVersion", "requestId", "runtimeId", "type", "operation", "payload"], ["protocolVersion", "requestId", "runtimeId", "type", "operation", "payload"], "$");
    const envelope = parseEnvelope(input, "$");
    if (envelope.runtimeId !== expectedRuntimeId) protocolError("$.runtimeId", "runtimeId mismatch");
    const operation = propertyValue(input, "operation", "$.operation");
    const payload = propertyValue(input, "payload", "$.payload");
    if (operation === "initialize") {
      return { ...envelope, type, operation, payload: parseInitializePayload(payload, "$.payload") };
    }
    if (operation === "execute") {
      return { ...envelope, type, operation, payload: parseExecutePayload(payload, "$.payload") };
    }
    if (operation === "judge") {
      return { ...envelope, type, operation, payload: parseJudgePayload(payload, "$.payload") };
    }
    if (operation === "dispose") {
      return { ...envelope, type, operation, payload: parseDisposePayload(payload, "$.payload") };
    }
    protocolError("$.operation", "unknown completion operation");
  }
  protocolError("$.type", "unknown response type");
}
