import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CASE_COUNT,
  MAX_SOURCE_BYTES,
  parseWorkerRequest,
  parseWorkerResponse,
} from "../../src/runtime/protocol.js";

function envelope() {
  return { protocolVersion: 1, requestId: "request-1", runtimeId: "javascript-worker" };
}

function bounded(text = "") {
  return { text, bytes: new TextEncoder().encode(text).byteLength, truncated: false };
}

function failure() {
  return { kind: "runtime", code: "RUNTIME_ERROR", message: "boom", fatal: false };
}

test("worker protocol accepts all request operations", () => {
  const requests = [
    { ...envelope(), type: "initialize" },
    { ...envelope(), type: "execute", source: "console.log(1)" },
    { ...envelope(), type: "judge", source: "solve", cases: [{ index: 0, input: { value: true } }] },
    { ...envelope(), type: "dispose" },
  ];

  for (const request of requests) {
    assert.equal(parseWorkerRequest(request).protocolVersion, 1);
  }
});

test("worker protocol accepts status, failure, and every complete response", () => {
  const responses = [
    { ...envelope(), type: "status", phase: "initializing", message: "loading" },
    { ...envelope(), type: "failure", error: failure() },
    {
      ...envelope(),
      type: "complete",
      operation: "initialize",
      payload: { runtimeVersion: "1.0", buildId: "build-1", capabilities: { execute: true, judge: true } },
    },
    {
      ...envelope(),
      type: "complete",
      operation: "execute",
      payload: { stdout: bounded("ok"), stderr: bounded(), value: { answer: 1 } },
    },
    {
      ...envelope(),
      type: "complete",
      operation: "judge",
      payload: {
        cases: [
          { index: 0, ok: true, actual: { answer: 1 }, stdout: bounded(), stderr: bounded() },
          { index: 1, ok: false, failure: failure(), stdout: bounded(), stderr: bounded("bad") },
        ],
      },
    },
    { ...envelope(), type: "complete", operation: "dispose", payload: { disposed: true } },
  ];

  for (const response of responses) {
    assert.equal(parseWorkerResponse(response, "javascript-worker").runtimeId, "javascript-worker");
  }
});

test("worker protocol fails closed for versions, runtime identity, and hostile envelopes", () => {
  const complete = {
    ...envelope(),
    type: "complete",
    operation: "dispose",
    payload: { disposed: true },
  };
  assert.throws(
    () => parseWorkerResponse({ ...complete, protocolVersion: 2 }, "javascript-worker"),
    /unsupported protocolVersion 2/,
  );
  assert.throws(
    () => parseWorkerResponse({ ...complete, runtimeId: "python-pyodide" }, "javascript-worker"),
    /runtimeId mismatch/,
  );
  assert.throws(() => parseWorkerRequest({ ...envelope(), type: "unknown" }), /unknown request type/);
  assert.throws(
    () => parseWorkerResponse({ ...envelope(), type: "unknown" }, "javascript-worker"),
    /unknown response type/,
  );
  assert.throws(() => parseWorkerRequest({ ...envelope(), requestId: "  ", type: "dispose" }), /requestId/);
  assert.throws(() => parseWorkerResponse({ ...complete, payload: { disposed: false } }, "javascript-worker"), /disposed/);

  const hostile = { ...envelope(), type: "dispose", ["x".repeat(20_000)]: true };
  assert.throws(
    () => parseWorkerRequest(hostile),
    (error: unknown) => {
      assert.ok(error instanceof TypeError);
      assert.ok(error.message.length < 300);
      assert.doesNotMatch(error.message, /x{100}/);
      return true;
    },
  );
});

test("worker protocol rejects malformed sources, judge cases, and non-JSON values", () => {
  assert.throws(
    () => parseWorkerRequest({ ...envelope(), type: "execute", source: "x".repeat(MAX_SOURCE_BYTES + 1) }),
    /source/,
  );
  assert.throws(
    () => parseWorkerRequest({
      ...envelope(),
      type: "judge",
      source: "solve",
      cases: [{ index: 0, input: undefined }],
    }),
    /cases\[0\]\.input/,
  );
  assert.throws(
    () => parseWorkerRequest({
      ...envelope(),
      type: "judge",
      source: "solve",
      cases: [{ index: 0, input: null }, { index: 0, input: null }],
    }),
    /unique/,
  );
  assert.throws(
    () => parseWorkerRequest({
      ...envelope(),
      type: "judge",
      source: "solve",
      cases: Array.from({ length: MAX_CASE_COUNT + 1 }, (_, index) => ({ index, input: null })),
    }),
    /at most 100 cases/,
  );

  const invalidValue = {
    ...envelope(),
    type: "complete",
    operation: "execute",
    payload: { stdout: bounded(), stderr: bounded(), value: Number.NaN },
  };
  assert.throws(() => parseWorkerResponse(invalidValue, "javascript-worker"), /payload\.value/);
});

test("worker protocol validates bounded text and strict judge payloads", () => {
  const mismatchedBytes = {
    ...envelope(),
    type: "complete",
    operation: "execute",
    payload: { stdout: { text: "é", bytes: 1, truncated: false }, stderr: bounded(), value: null },
  };
  assert.throws(() => parseWorkerResponse(mismatchedBytes, "javascript-worker"), /stdout\.bytes/);

  const oversizedDetails = {
    ...envelope(),
    type: "failure",
    error: { ...failure(), details: "x".repeat(8_193) },
  };
  assert.throws(() => parseWorkerResponse(oversizedDetails, "javascript-worker"), /details/);

  const oversizedOutput = {
    ...envelope(),
    type: "complete",
    operation: "execute",
    payload: { stdout: bounded("x".repeat(65_537)), stderr: bounded(), value: null },
  };
  assert.throws(() => parseWorkerResponse(oversizedOutput, "javascript-worker"), /stdout\.text/);

  const expectedLeak = {
    ...envelope(),
    type: "complete",
    operation: "judge",
    payload: {
      cases: [{ index: 0, ok: true, actual: 1, expected: 1, stdout: bounded(), stderr: bounded() }],
    },
  };
  assert.throws(() => parseWorkerResponse(expectedLeak, "javascript-worker"), /unknown field/);

  const malformedCompletion = {
    ...envelope(),
    type: "complete",
    operation: "judge",
    payload: { cases: [{ index: 0, ok: false, failure: failure(), actual: 1, stdout: bounded(), stderr: bounded() }] },
  };
  assert.throws(() => parseWorkerResponse(malformedCompletion, "javascript-worker"), /unknown field/);
});
