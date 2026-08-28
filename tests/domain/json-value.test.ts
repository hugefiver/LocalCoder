import assert from "node:assert/strict";
import test from "node:test";
import {
  assertJsonValue,
  validateJsonValue,
} from "../../src/domain/json-value.js";

test("canonical JSON accepts nested values and shared non-cyclic references", () => {
  const shared = { values: [null, true, 3, "café"] };
  const value = {
    title: "nested",
    items: [{ value: "first" }, { value: false }],
    left: shared,
    right: shared,
  };

  const result = validateJsonValue(value);

  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("nested value unexpectedly failed validation");
  assert.equal(result.value, value);
  assert.equal(result.bytes, new TextEncoder().encode(JSON.stringify(value)).byteLength);
});

test("canonical JSON rejects non-finite and non-JSON values", () => {
  for (const [value, code] of [
    [undefined, "unsupported-type"],
    [1n, "unsupported-type"],
    [Number.NaN, "non-finite-number"],
    [Number.POSITIVE_INFINITY, "non-finite-number"],
    [() => 1, "unsupported-type"],
    [Symbol("x"), "unsupported-type"],
  ] as const) {
    const result = validateJsonValue(value);

    assert.equal(result.ok, false);
    if (result.ok) assert.fail("value unexpectedly passed canonical JSON validation");
    assert.equal(result.issues[0]?.code, code);
    assert.equal(result.issues[0]?.path, "$");
  }
});

test("canonical JSON rejects cycles, class instances, and reports exact value paths", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const cyclicResult = validateJsonValue(cyclic);

  assert.equal(cyclicResult.ok, false);
  if (cyclicResult.ok) assert.fail("cycle unexpectedly passed canonical JSON validation");
  assert.deepEqual(cyclicResult.issues[0], {
    code: "cyclic-value",
    path: "$.self",
    message: "JSON values cannot contain cycles",
  });

  class EnumerableRecord {
    value = 1;
  }
  const classResult = validateJsonValue(new EnumerableRecord());
  assert.equal(classResult.ok, false);
  if (classResult.ok) assert.fail("class instance unexpectedly passed validation");
  assert.equal(classResult.issues[0]?.code, "unsupported-type");
  assert.equal(classResult.issues[0]?.path, "$");

  const nestedResult = validateJsonValue({
    items: [{ value: "valid" }, { value: 2 }, { value: undefined }],
  });
  assert.equal(nestedResult.ok, false);
  if (nestedResult.ok) assert.fail("invalid nested value unexpectedly passed validation");
  assert.equal(nestedResult.issues[0]?.path, "$.items[2].value");
});

test("canonical JSON accounts for UTF-8 bytes and bounds diagnostics", () => {
  const value = { message: "é" };
  const valid = validateJsonValue(value);
  assert.equal(valid.ok, true);
  if (!valid.ok) assert.fail("UTF-8 fixture unexpectedly failed validation");
  assert.equal(valid.bytes, 16);

  const overLimit = validateJsonValue(value, { maxBytes: 15 });
  assert.equal(overLimit.ok, false);
  if (overLimit.ok) assert.fail("over-limit value unexpectedly passed validation");
  assert.deepEqual(overLimit.issues, [{
    code: "byte-limit",
    path: "$",
    message: "JSON value is 16 UTF-8 bytes, exceeding limit of 15 bytes",
  }]);

  const manyInvalid = validateJsonValue(Array.from({ length: 20 }, () => undefined));
  assert.equal(manyInvalid.ok, false);
  if (manyInvalid.ok) assert.fail("invalid array unexpectedly passed validation");
  assert.ok(manyInvalid.issues.length > 0);
  assert.ok(manyInvalid.issues.length < 20);
});

test("assertJsonValue includes its label, issue path, and issue code", () => {
  assert.throws(
    () => assertJsonValue({ items: [{ value: undefined }] }, "case payload"),
    (error: unknown) => {
      assert.ok(error instanceof TypeError);
      assert.match(error.message, /case payload/);
      assert.match(error.message, /\$\.items\[0\]\.value/);
      assert.match(error.message, /unsupported-type/);
      return true;
    },
  );
});
