import type { JsonObject, JsonValue } from "../domain/json-value.js";

export type JsonComparison =
  | { equal: true }
  | {
    equal: false;
    path: string;
    reason: "type-mismatch" | "missing-key" | "extra-key" | "length-mismatch" | "value-mismatch";
    actual?: JsonValue;
    expected?: JsonValue;
  };

type ComparisonTask =
  | { kind: "compare"; actual: JsonValue; expected: JsonValue; path: string }
  | { kind: "leave"; actual: object };

const IDENTIFIER_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function propertyPath(path: string, key: string): string {
  return IDENTIFIER_KEY.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function isContainer(value: JsonValue): value is JsonValue[] | JsonObject {
  return value !== null && typeof value === "object";
}

function hasOwn(object: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function keyMismatch(
  actual: JsonObject,
  expected: JsonObject,
  path: string,
): JsonComparison | undefined {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  for (const key of expectedKeys) {
    if (!hasOwn(actual, key)) {
      return {
        equal: false,
        path: propertyPath(path, key),
        reason: "missing-key",
        expected: expected[key] as JsonValue,
      };
    }
  }
  for (const key of actualKeys) {
    if (!hasOwn(expected, key)) {
      return {
        equal: false,
        path: propertyPath(path, key),
        reason: "extra-key",
        actual: actual[key] as JsonValue,
      };
    }
  }
  return undefined;
}

function enqueueArray(
  actual: JsonValue[],
  expected: JsonValue[],
  path: string,
  tasks: ComparisonTask[],
): void {
  for (let index = actual.length - 1; index >= 0; index -= 1) {
    tasks.push({
      kind: "compare",
      actual: actual[index] as JsonValue,
      expected: expected[index] as JsonValue,
      path: `${path}[${index}]`,
    });
  }
}

function enqueueObject(
  actual: JsonObject,
  expected: JsonObject,
  path: string,
  tasks: ComparisonTask[],
): void {
  for (const key of Object.keys(actual).sort().reverse()) {
    tasks.push({
      kind: "compare",
      actual: actual[key] as JsonValue,
      expected: expected[key] as JsonValue,
      path: propertyPath(path, key),
    });
  }
}

function compareNode(
  actual: JsonValue,
  expected: JsonValue,
  path: string,
  tasks: ComparisonTask[],
  ancestors: WeakMap<object, object>,
): JsonComparison | undefined {
  if (actual === expected) return undefined;
  if (typeof actual !== typeof expected || !isContainer(actual) !== !isContainer(expected)) {
    return { equal: false, path, reason: "type-mismatch", actual, expected };
  }
  if (!isContainer(actual) || !isContainer(expected)) {
    return { equal: false, path, reason: "value-mismatch", actual, expected };
  }
  if (Array.isArray(actual) !== Array.isArray(expected)) {
    return { equal: false, path, reason: "type-mismatch", actual, expected };
  }

  const pairedExpected = ancestors.get(actual);
  if (pairedExpected !== undefined) {
    return pairedExpected === expected
      ? undefined
      : { equal: false, path, reason: "value-mismatch", actual, expected };
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) {
      return { equal: false, path, reason: "length-mismatch", actual, expected };
    }
    ancestors.set(actual, expected);
    tasks.push({ kind: "leave", actual });
    enqueueArray(actual, expected, path, tasks);
    return undefined;
  }

  const actualObject = actual as JsonObject;
  const expectedObject = expected as JsonObject;
  const mismatch = keyMismatch(actualObject, expectedObject, path);
  if (mismatch !== undefined) return mismatch;
  ancestors.set(actualObject, expectedObject);
  tasks.push({ kind: "leave", actual: actualObject });
  enqueueObject(actualObject, expectedObject, path, tasks);
  return undefined;
}

export function compareJson(actual: JsonValue, expected: JsonValue): JsonComparison {
  const ancestors = new WeakMap<object, object>();
  const tasks: ComparisonTask[] = [{ kind: "compare", actual, expected, path: "$" }];

  while (tasks.length > 0) {
    const task = tasks.pop();
    if (task === undefined) break;
    if (task.kind === "leave") {
      ancestors.delete(task.actual);
      continue;
    }
    const comparison = compareNode(task.actual, task.expected, task.path, tasks, ancestors);
    if (comparison !== undefined) return comparison;
  }
  return { equal: true };
}
