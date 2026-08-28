import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeAdapter } from "../../src/runtime/adapters/types.js";
import {
  PYTHON_CORPUS_SOURCES,
  verifyPythonParity,
  type PythonCorpusFixture,
} from "../../src/runtime/python-parity.js";
import { PYTHON_CORPUS_FIXTURES, PYTHON_CORPUS_FIXTURE_SOURCES } from "../fixtures/python-corpus-solutions.js";

const fixtures = PYTHON_CORPUS_FIXTURES;

test("the production Python parity corpus contains the exact six problem sources and all public plus judge cases", () => {
  assert.deepEqual(fixtures.map(({ problemId }) => problemId), [1, 2, 3, 4, 5, 6]);
  assert.strictEqual(PYTHON_CORPUS_FIXTURE_SOURCES, PYTHON_CORPUS_SOURCES);
  assert.equal(fixtures.reduce((count, fixture_) => count + fixture_.cases.length, 0), 18);
  assert.ok(fixtures.every(({ source }) => source.includes("def solution")));
});

test("Python parity accepts zero mismatches only when both runtimes return expected actuals", async () => {
  const report = await verifyPythonParity(adapterFor(fixtures), adapterFor(fixtures), fixtures);

  assert.equal(report.problemCount, 6);
  assert.equal(report.caseCount, 18);
  assert.deepEqual(report.mismatches, []);
});

test("Python parity reports classification and actual mismatches", async () => {
  const classification = await verifyPythonParity(adapterFor(fixtures), adapterFor(fixtures, { fail: [1, 1] }), fixtures);
  assert.deepEqual(classification.mismatches, [{ problemId: 2, caseIndex: 1, reason: "classification-mismatch" }]);

  const actual = await verifyPythonParity(adapterFor(fixtures), adapterFor(fixtures, { actual: [4, 2] }), fixtures);
  assert.deepEqual(actual.mismatches, [{ problemId: 5, caseIndex: 2, reason: "actual-mismatch" }]);
});

function adapterFor(
  corpus: readonly PythonCorpusFixture[],
  override: { readonly fail?: readonly [number, number]; readonly actual?: readonly [number, number] } = {},
): RuntimeAdapter {
  return {
    runtimeId: "python-pyodide",
    languageId: "python",
    execute: async () => ({ identity: { runtimeVersion: "fake", buildId: "fake" }, payload: { stdout: bounded(), stderr: bounded(), value: null } }),
    judge: async (source, inputs) => {
      const problemIndex = corpus.findIndex((fixture_) => fixture_.source === source);
      const selected = corpus[problemIndex];
      if (selected === undefined) throw new Error("unknown source");
      return {
        identity: { runtimeVersion: "fake", buildId: "fake" },
        payload: {
          cases: inputs.map((_, index) => {
            if (override.fail?.[0] === problemIndex && override.fail[1] === index) {
              return { index, ok: false as const, failure: { kind: "runtime" as const, code: "fake", message: "fake", fatal: false }, stdout: bounded(), stderr: bounded() };
            }
            const actual = override.actual?.[0] === problemIndex && override.actual[1] === index ? null : selected.cases[index]?.expected;
            if (actual === undefined) throw new Error("unknown case");
            return { index, ok: true as const, actual, stdout: bounded(), stderr: bounded() };
          }),
        },
      };
    },
  };
}

function bounded(text = "") {
  return { text, bytes: new TextEncoder().encode(text).byteLength, truncated: false };
}
