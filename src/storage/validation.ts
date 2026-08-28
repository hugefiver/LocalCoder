import { validateJsonValue, type JsonValue } from "../domain/json-value.js";
import { LANGUAGE_IDS, RUNTIME_IDS, type LanguageId, type RuntimeId } from "../domain/language.js";
import type { Verdict } from "../domain/submission.js";

export const MAX_IDENTIFIER_BYTES = 256;
export const MAX_CASE_VALUE_BYTES = 65_536;

const RUNTIME_LANGUAGE: Readonly<Record<RuntimeId, LanguageId>> = {
  "javascript-worker": "javascript",
  "typescript-official": "typescript",
  "python-pyodide": "python",
  "python-rustpython": "python",
  "racket-wasm": "racket",
  "haskell-ghc-wasi": "haskell",
};
const VERDICTS: readonly Verdict[] = [
  "accepted",
  "wrong-answer",
  "compile-error",
  "runtime-error",
  "time-limit-exceeded",
  "cancelled",
  "internal-error",
  "runtime-unavailable",
];
const encoder = new TextEncoder();

export function parseRecord(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  const record = parsePlainRecord(value, path);
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string" || !allowed.has(key)) throw new TypeError(`${path}: contains an unknown field`);
    field(record, key, path);
  }
  for (const key of required) field(record, key, path);
  return record;
}

export function parsePlainRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new TypeError(`${path}: must be a plain object`);
  return value;
}

export function field(record: Record<string, unknown>, key: string, path: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) throw new TypeError(`${path}.${key}: is required`);
  if (!("value" in descriptor)) throw new TypeError(`${path}.${key}: must be a data property`);
  return descriptor.value;
}

export function hasField(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function parseArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value) || !isDenseDataArray(value)) throw new TypeError(`${path}: must be a dense data array`);
  return value;
}

export function parseJson(value: unknown, path: string): JsonValue {
  const validation = validateJsonValue(value, { maxBytes: MAX_CASE_VALUE_BYTES });
  if (!validation.ok) {
    const issue = validation.issues[0];
    throw new TypeError(`${path}: must be canonical JSON (${issue?.code ?? "invalid"})`);
  }
  return validation.value;
}

export function parseText(value: unknown, path: string, maximumBytes: number, nonBlank = false): string {
  if (typeof value !== "string") throw new TypeError(`${path}: must be a string`);
  if (encoder.encode(value).byteLength > maximumBytes) {
    throw new TypeError(`${path}: must not exceed ${maximumBytes} UTF-8 bytes`);
  }
  if (nonBlank && value.trim().length === 0) throw new TypeError(`${path}: must be non-blank`);
  return value;
}

export function parseFiniteNonnegative(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${path}: must be a finite non-negative number`);
  }
  return value;
}

export function parseNonnegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${path}: must be a non-negative safe integer`);
  }
  return value;
}

export function parsePositiveInteger(value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${path}: must be a positive safe integer no greater than ${maximum}`);
  }
  return value;
}

export function parseProblemId(value: unknown, path: string): number {
  return parsePositiveInteger(value, path);
}

export function parseLanguageId(value: unknown, path: string): LanguageId {
  for (const languageId of LANGUAGE_IDS) {
    if (value === languageId) return languageId;
  }
  throw new TypeError(`${path}: must be a known languageId`);
}

export function parseRuntimeId(value: unknown, path: string): RuntimeId {
  for (const runtimeId of RUNTIME_IDS) {
    if (value === runtimeId) return runtimeId;
  }
  throw new TypeError(`${path}: must be a known runtimeId`);
}

export function parseVerdict(value: unknown, path: string): Verdict {
  for (const verdict of VERDICTS) {
    if (value === verdict) return verdict;
  }
  throw new TypeError(`${path}: must be a known verdict`);
}

export function assertRuntimeLanguage(languageId: LanguageId, runtimeId: RuntimeId, path: string): void {
  if (RUNTIME_LANGUAGE[runtimeId] !== languageId) {
    throw new TypeError(`${path}.runtimeId: ${runtimeId} does not support ${languageId}`);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isDenseDataArray(value: readonly unknown[]): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => key !== "length" && (typeof key !== "string" || !isArrayIndex(key, value.length)))) {
    return false;
  }
  if (Object.keys(value).length !== value.length) return false;
  return Object.keys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor;
  });
}

function isArrayIndex(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}
