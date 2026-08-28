import assert from "node:assert/strict";
import test from "node:test";
import { compareJson } from "../../src/oj/comparer.js";

test("json-deep-equal ignores object key order but preserves array order", () => {
  assert.deepEqual(compareJson({ a: 1, b: [2, 3] }, { b: [2, 3], a: 1 }), {
    equal: true,
  });
  assert.deepEqual(compareJson([1, 2], [2, 1]), {
    equal: false,
    path: "$[0]",
    reason: "value-mismatch",
    actual: 1,
    expected: 2,
  });
  assert.deepEqual(compareJson({}, { missing: null }), {
    equal: false,
    path: "$.missing",
    reason: "missing-key",
    expected: null,
  });
});

test("json-deep-equal reports type, length, and extra-key mismatches", () => {
  assert.deepEqual(compareJson(1, "1"), {
    equal: false,
    path: "$",
    reason: "type-mismatch",
    actual: 1,
    expected: "1",
  });
  assert.deepEqual(compareJson([1], [1, 2]), {
    equal: false,
    path: "$",
    reason: "length-mismatch",
    actual: [1],
    expected: [1, 2],
  });
  assert.deepEqual(compareJson({ extra: false }, {}), {
    equal: false,
    path: "$.extra",
    reason: "extra-key",
    actual: false,
  });
});

test("json-deep-equal reports the first nested mismatch at its JSON path", () => {
  assert.deepEqual(
    compareJson(
      { items: [{ value: 1 }, { value: 2 }, { value: "actual" }] },
      { items: [{ value: 1 }, { value: 2 }, { value: "expected" }] },
    ),
    {
      equal: false,
      path: "$.items[2].value",
      reason: "value-mismatch",
      actual: "actual",
      expected: "expected",
    },
  );
});

test("json-deep-equal terminates for equivalent cyclic object pairs", () => {
  const actual: Record<string, unknown> = {};
  actual.self = actual;
  const expected: Record<string, unknown> = {};
  expected.self = expected;

  assert.deepEqual(
    compareJson(actual as never, expected as never),
    { equal: true },
  );
});
