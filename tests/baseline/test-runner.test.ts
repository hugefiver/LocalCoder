import assert from "node:assert/strict";
import test from "node:test";
import { parseRuntimeManifest } from "../../src/runtime/manifest.js";

test("the Node test runner executes compiled TypeScript tests", () => {
  assert.equal(typeof parseRuntimeManifest, "function");
});
