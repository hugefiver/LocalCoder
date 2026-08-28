export type JsonPrimitive = null | boolean | number | string;

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;

export type JsonIssueCode =
  | "unsupported-type"
  | "non-finite-number"
  | "cyclic-value"
  | "byte-limit";

export interface JsonIssue {
  code: JsonIssueCode;
  path: string;
  message: string;
}

export type JsonValidation =
  | { ok: true; value: JsonValue; bytes: number }
  | { ok: false; issues: readonly JsonIssue[] };

type ValidationTask =
  | { kind: "visit"; value: unknown; path: string }
  | { kind: "leave"; value: object };

type SerializationTask =
  | { kind: "text"; value: string }
  | { kind: "value"; value: JsonValue };

const MAX_ISSUES = 8;
const IDENTIFIER_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function addIssue(
  issues: JsonIssue[],
  code: JsonIssueCode,
  path: string,
  message: string,
): void {
  if (issues.length < MAX_ISSUES) issues.push({ code, path, message });
}

function propertyPath(path: string, key: string): string {
  return IDENTIFIER_KEY.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isArrayIndex(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}

function enqueueArray(
  value: unknown[],
  path: string,
  tasks: ValidationTask[],
  ancestors: WeakSet<object>,
  issues: JsonIssue[],
): void {
  const ownKeys = Reflect.ownKeys(value);
  const keys = Object.keys(value);
  const hasOnlyIndexes = ownKeys.every((key) => (
    key === "length" || (typeof key === "string" && isArrayIndex(key, value.length))
  ));

  if (!hasOnlyIndexes || keys.length !== value.length) {
    addIssue(issues, "unsupported-type", path, "JSON arrays must be dense enumerable values");
    return;
  }
  if (keys.some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor === undefined || !("value" in descriptor);
  })) {
    addIssue(issues, "unsupported-type", path, "JSON array entries must be data values");
    return;
  }

  ancestors.add(value);
  tasks.push({ kind: "leave", value });
  for (let index = value.length - 1; index >= 0; index -= 1) {
    tasks.push({ kind: "visit", value: value[index], path: `${path}[${index}]` });
  }
}

function enqueueObject(
  value: Record<string, unknown>,
  path: string,
  tasks: ValidationTask[],
  ancestors: WeakSet<object>,
  issues: JsonIssue[],
): void {
  const ownKeys = Reflect.ownKeys(value);
  const keys = Object.keys(value);
  if (ownKeys.length !== keys.length) {
    addIssue(issues, "unsupported-type", path, "JSON objects require enumerable string properties");
    return;
  }
  if (keys.some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor === undefined || !("value" in descriptor);
  })) {
    addIssue(issues, "unsupported-type", path, "JSON object properties must be data values");
    return;
  }

  ancestors.add(value);
  tasks.push({ kind: "leave", value });
  for (const key of [...keys].reverse()) {
    tasks.push({ kind: "visit", value: value[key], path: propertyPath(path, key) });
  }
}

function visitValue(
  value: unknown,
  path: string,
  tasks: ValidationTask[],
  ancestors: WeakSet<object>,
  issues: JsonIssue[],
): void {
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) addIssue(issues, "non-finite-number", path, "JSON numbers must be finite");
    return;
  }
  if (typeof value !== "object") {
    addIssue(issues, "unsupported-type", path, `Unsupported JSON value type: ${typeof value}`);
    return;
  }
  if (ancestors.has(value)) {
    addIssue(issues, "cyclic-value", path, "JSON values cannot contain cycles");
    return;
  }
  if (Array.isArray(value)) {
    enqueueArray(value, path, tasks, ancestors, issues);
    return;
  }
  if (!isPlainObject(value)) {
    addIssue(issues, "unsupported-type", path, "JSON objects must use a plain object prototype");
    return;
  }
  enqueueObject(value, path, tasks, ancestors, issues);
}

function validateTree(value: unknown): JsonIssue[] {
  const ancestors = new WeakSet<object>();
  const issues: JsonIssue[] = [];
  const tasks: ValidationTask[] = [{ kind: "visit", value, path: "$" }];

  while (tasks.length > 0 && issues.length < MAX_ISSUES) {
    const task = tasks.pop();
    if (task === undefined) break;
    if (task.kind === "leave") ancestors.delete(task.value);
    else visitValue(task.value, task.path, tasks, ancestors, issues);
  }
  return issues;
}

function jsonByteLength(value: JsonValue): number {
  const chunks: string[] = [];
  const tasks: SerializationTask[] = [{ kind: "value", value }];

  while (tasks.length > 0) {
    const task = tasks.pop();
    if (task === undefined) break;
    if (task.kind === "text") {
      chunks.push(task.value);
    } else if (task.value === null) {
      chunks.push("null");
    } else if (typeof task.value === "string") {
      chunks.push(JSON.stringify(task.value));
    } else if (typeof task.value === "number" || typeof task.value === "boolean") {
      chunks.push(String(task.value));
    } else if (Array.isArray(task.value)) {
      tasks.push({ kind: "text", value: "]" });
      for (let index = task.value.length - 1; index >= 0; index -= 1) {
        tasks.push({ kind: "value", value: task.value[index] as JsonValue });
        if (index > 0) tasks.push({ kind: "text", value: "," });
      }
      tasks.push({ kind: "text", value: "[" });
    } else {
      const keys = Object.keys(task.value);
      tasks.push({ kind: "text", value: "}" });
      for (const key of [...keys].reverse()) {
        tasks.push({ kind: "value", value: task.value[key] as JsonValue });
        tasks.push({ kind: "text", value: ":" });
        tasks.push({ kind: "text", value: JSON.stringify(key) });
        if (key !== keys[0]) tasks.push({ kind: "text", value: "," });
      }
      tasks.push({ kind: "text", value: "{" });
    }
  }

  return new TextEncoder().encode(chunks.join("")).byteLength;
}

export function validateJsonValue(
  value: unknown,
  limits?: { maxBytes?: number },
): JsonValidation {
  const issues = validateTree(value);
  if (issues.length > 0) return { ok: false, issues };

  const canonical = value as JsonValue;
  const bytes = jsonByteLength(canonical);
  if (limits?.maxBytes !== undefined && bytes > limits.maxBytes) {
    return {
      ok: false,
      issues: [{
        code: "byte-limit",
        path: "$",
        message: `JSON value is ${bytes} UTF-8 bytes, exceeding limit of ${limits.maxBytes} bytes`,
      }],
    };
  }
  return { ok: true, value: canonical, bytes };
}

export function assertJsonValue(
  value: unknown,
  label: string,
  limits?: { maxBytes?: number },
): JsonValue {
  const validation = validateJsonValue(value, limits);
  if (validation.ok) return validation.value;

  const diagnostic = validation.issues
    .map((issue) => `${issue.path} [${issue.code}] ${issue.message}`)
    .join("; ");
  throw new TypeError(`${label}: invalid canonical JSON value: ${diagnostic}`);
}
