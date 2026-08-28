import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkDist } from "../../scripts/smoke-check.mjs";

const ROUTE_CHUNKS = ["HomePage", "ExecutorPage"];

test("checkDist validates required runtime assets, declared bytes, route chunks, and unavailable optionals", () => {
  withDistFixture((fixture) => {
    const report = checkDist(fixture.dist, { routeChunks: ROUTE_CHUNKS });
    assert.equal(report.ok, true);
    assert.deepEqual(report.required, [
      { runtimeId: "javascript-worker", state: "packaged" },
      { runtimeId: "typescript-official", state: "packaged" },
      { runtimeId: "python-pyodide", state: "packaged" },
    ]);
    assert.deepEqual(report.optional, [
      { runtimeId: "python-rustpython", state: "loadable-unverified" },
      { runtimeId: "racket-wasm", state: "unavailable", reason: "not bundled" },
    ]);
    assert.equal("verifiedOptionalRuntimeIds" in report, false);
  });
});

test("checkDist rejects external runtime URLs after validating declared bytes", () => {
  withDistFixture((fixture) => {
    const source = "import('https://cdn.example.test/runtime.js');";
    fs.writeFileSync(path.join(fixture.dist, "rustpython-worker.js"), source);
    fixture.manifest.runtimes[4].assets[0].bytes = Buffer.byteLength(source);
    fixture.writeManifest();
    assert.throws(() => checkDist(fixture.dist, { routeChunks: ROUTE_CHUNKS }), /external CDN or API/i);
  });
});

test("checkDist permits harmless URL literals in compiler-like runtime assets", () => {
  withDistFixture((fixture) => {
    const source = "// Documentation: https://www.typescriptlang.org/docs/\nexport const version = 'fixture';";
    fs.writeFileSync(path.join(fixture.dist, "typescript", "typescript.js"), source);
    fixture.manifest.runtimes[1].assets[1].bytes = Buffer.byteLength(source);
    fixture.writeManifest();
    assert.doesNotThrow(() => checkDist(fixture.dist, { routeChunks: ROUTE_CHUNKS }));
  });
});

test("checkDist rejects a missing or invalid runtime manifest", () => {
  withDistFixture((fixture) => {
    const manifestPath = path.join(fixture.dist, "runtime-manifest.json");
    fs.rmSync(manifestPath);
    assert.throws(() => checkDist(fixture.dist, { routeChunks: ROUTE_CHUNKS }), /runtime-manifest\.json/i);
    fs.writeFileSync(manifestPath, "not json");
    assert.throws(() => checkDist(fixture.dist, { routeChunks: ROUTE_CHUNKS }), /Invalid runtime manifest/i);
  });
});

test("checkDist rejects a missing required runtime asset", () => {
  withDistFixture((fixture) => {
    fs.rmSync(path.join(fixture.dist, "pyodide", "python_stdlib.zip"));
    assert.throws(() => checkDist(fixture.dist, { routeChunks: ROUTE_CHUNKS }), /python_stdlib\.zip.*missing/i);
  });
});

test("checkDist rejects undeclared Pyodide regular files, including HTML", () => {
  withDistFixture((fixture) => {
    fs.writeFileSync(path.join(fixture.dist, "pyodide", "console.html"), "console CDN entry");
    assert.throws(() => checkDist(fixture.dist, { routeChunks: ROUTE_CHUNKS }), /undeclared asset.*console\.html/i);
  });
});

test("checkDist rejects stale manifest byte counts", () => {
  withDistFixture((fixture) => {
    fixture.manifest.runtimes[0].assets[0].bytes += 1;
    fixture.writeManifest();
    assert.throws(() => checkDist(fixture.dist, { routeChunks: ROUTE_CHUNKS }), /expected .* bytes/i);
  });
});

test("checkDist rejects missing lazy route chunks", () => {
  withDistFixture((fixture) => {
    fs.rmSync(path.join(fixture.dist, "assets", "ExecutorPage-fixture.js"));
    assert.throws(() => checkDist(fixture.dist, { routeChunks: ROUTE_CHUNKS }), /ExecutorPage.*route chunk/i);
  });
});

test("checkDist requires the Pages fallback only for a Pages build", () => {
  withDistFixture((fixture) => {
    assert.doesNotThrow(() => checkDist(fixture.dist, { routeChunks: ROUTE_CHUNKS }));
    assert.throws(() => checkDist(fixture.dist, { pages: true, routeChunks: ROUTE_CHUNKS }), /404\.html/i);
    fs.copyFileSync(path.join(fixture.dist, "index.html"), path.join(fixture.dist, "404.html"));
    assert.doesNotThrow(() => checkDist(fixture.dist, { pages: true, routeChunks: ROUTE_CHUNKS }));
  });
});

function withDistFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "localcoder-smoke-"));
  const dist = path.join(root, "dist");
  const fixture = { root, dist, manifest: { schemaVersion: 1, runtimes: [] } };
  const writeAsset = (url, contents) => {
    const filePath = path.join(dist, ...url.split("/"));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
    return { url, bytes: Buffer.byteLength(contents) };
  };
  try {
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, "index.html"), '<!doctype html><script type="module" src="/assets/main-fixture.js"></script>');
    writeAsset("assets/main-fixture.js", "console.log('main')");
    for (const chunk of ROUTE_CHUNKS) writeAsset(`assets/${chunk}-fixture.js`, `export default ${JSON.stringify(chunk)}`);

    const javascript = writeAsset("js-worker.js", "self.onmessage = () => {};");
    const typescript = writeAsset("typescript/typescript.js", "export const version = 'fixture';");
    const pythonWorker = writeAsset("python-worker.js", "self.onmessage = () => {};");
    const pyodideJs = writeAsset("pyodide/pyodide.js", "export const loadPyodide = () => {};");
    const pyodideAsmJs = writeAsset("pyodide/pyodide.asm.js", "export const wasmModule = {};");
    const pyodideWasm = writeAsset("pyodide/pyodide.asm.wasm", "wasm bytes");
    const pyodideStdlib = writeAsset("pyodide/python_stdlib.zip", "stdlib bytes");
    const pyodideLock = writeAsset("pyodide/pyodide-lock.json", "{}");
    const rustpythonWorker = writeAsset("rustpython-worker.js", "self.onmessage = () => {};");
    fixture.manifest.runtimes = [
      runtime("javascript-worker", true, [javascript]),
      runtime("typescript-official", true, [javascript, typescript]),
      runtime("python-pyodide", true, [pythonWorker, pyodideJs, pyodideAsmJs, pyodideWasm, pyodideStdlib, pyodideLock]),
      { runtimeId: "racket-wasm", required: false, packaged: false, unavailableReason: "not bundled", assets: [] },
      runtime("python-rustpython", false, [rustpythonWorker]),
    ];
    fixture.writeManifest = () => fs.writeFileSync(path.join(dist, "runtime-manifest.json"), `${JSON.stringify(fixture.manifest, null, 2)}\n`);
    fixture.writeManifest();
    run(fixture);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runtime(runtimeId, required, assets) {
  return { runtimeId, required, packaged: true, assets };
}
