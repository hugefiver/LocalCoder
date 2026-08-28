import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupPyodide } from "../../scripts/setup-pyodide.js";

const PYODIDE_ASSETS = [
  "pyodide.js",
  "pyodide.asm.js",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
];

test("setupPyodide copies only the declared browser assets and removes stale console HTML", async () => {
  await withPyodideFixture(async (fixture) => {
    writeAsset(fixture.source, "console.html", "console CDN entry");
    writeAsset(fixture.source, "console-v2.html", "console v2 CDN entry");
    writeAsset(fixture.target, "console.html", "stale console entry");
    writeAsset(fixture.target, "console-v2.html", "stale console v2 entry");

    await setupPyodide({ root: fixture.root, copyTypeScript: false });

    assert.deepEqual(fs.readdirSync(fixture.target).sort(), [...PYODIDE_ASSETS].sort());
    for (const asset of PYODIDE_ASSETS) {
      assert.equal(fs.readFileSync(path.join(fixture.target, asset), "utf8"), `source ${asset}`);
    }
  });
});

for (const missingAsset of PYODIDE_ASSETS) {
  test(`setupPyodide fails closed when ${missingAsset} is missing from the source`, async () => {
    await withPyodideFixture(async (fixture) => {
      writeAsset(fixture.target, "stale.txt", "must remain when source is invalid");
      fs.rmSync(path.join(fixture.source, missingAsset));

      await assert.rejects(
        setupPyodide({ root: fixture.root, copyTypeScript: false }),
        /Missing required Pyodide asset/,
      );
      assert.equal(fs.readFileSync(path.join(fixture.target, "stale.txt"), "utf8"), "must remain when source is invalid");
    });
  });
}

async function withPyodideFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "localcoder-setup-pyodide-"));
  const source = path.join(root, "node_modules", "pyodide");
  const target = path.join(root, "public", "pyodide");
  const typescriptPackage = path.join(root, "node_modules", "typescript", "package.json");
  try {
    fs.mkdirSync(path.dirname(typescriptPackage), { recursive: true });
    fs.writeFileSync(typescriptPackage, JSON.stringify({ version: "fixture" }));
    for (const asset of PYODIDE_ASSETS) writeAsset(source, asset, `source ${asset}`);
    await run({ root, source, target });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeAsset(root, name, contents) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, name), contents);
}
