import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

test("package lock root ranges match the manifest and retain exact worker build records", () => {
  const packageJson = readJson("package.json");
  const packageLock = readJson("package-lock.json");
  const rootPackage = packageLock.packages[""];

  for (const name of ["esbuild", "@bjorn3/browser_wasi_shim"]) {
    assert.equal(rootPackage.devDependencies[name], packageJson.devDependencies[name]);
    assert.ok(packageLock.packages[`node_modules/${name}`], `Missing lock record for ${name}`);
  }

  const esbuild = packageLock.packages["node_modules/esbuild"];
  assert.equal(rootPackage.devDependencies.esbuild, "^0.25.4 || ^0.27.2");
  assert.equal(esbuild.version, "0.27.2");
  assert.equal(esbuild.resolved, "https://registry.npmjs.org/esbuild/-/esbuild-0.27.2.tgz");

  const wasiShim = packageLock.packages["node_modules/@bjorn3/browser_wasi_shim"];
  assert.equal(wasiShim.version, "0.4.2");
  assert.equal(wasiShim.resolved, "https://registry.npmjs.org/@bjorn3/browser_wasi_shim/-/browser_wasi_shim-0.4.2.tgz");
  assert.equal(wasiShim.integrity, "sha512-/iHkCVUG3VbcbmEHn5iIUpIrh7a7WPiwZ3sHy4HZKZzBdSadwdddYDZAII2zBvQYV0Lfi8naZngPCN7WPHI/hA==");
  assert.equal(wasiShim.dev, true);
  assert.equal(wasiShim.license, "MIT OR Apache-2.0");
});
