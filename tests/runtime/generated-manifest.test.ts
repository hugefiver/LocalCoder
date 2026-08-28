import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseRuntimeManifest } from "../../src/runtime/manifest.js";

const emittedOrProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const root = path.basename(emittedOrProjectRoot) === ".test-dist"
  ? path.resolve(emittedOrProjectRoot, "..")
  : emittedOrProjectRoot;
const expectedRuntimeIds = [
  "javascript-worker",
  "typescript-official",
  "python-pyodide",
  "python-rustpython",
  "racket-wasm",
  "haskell-ghc-wasi",
];

test("the generated public manifest satisfies the runtime contract and matches artifacts", () => {
  const raw = JSON.parse(readFileSync(path.join(root, "public", "runtime-manifest.json"), "utf8"));
  const manifest = parseRuntimeManifest(raw);

  assert.deepEqual(
    manifest.runtimes.map((runtime) => runtime.runtimeId).sort(),
    expectedRuntimeIds.slice().sort(),
  );

  for (const runtime of manifest.runtimes) {
    for (const asset of runtime.assets) {
      const assetPath = path.join(root, "public", ...asset.url.split("/"));
      assert.equal(statSync(assetPath).size, asset.bytes, `${runtime.runtimeId}: ${asset.url}`);
    }
  }
});
