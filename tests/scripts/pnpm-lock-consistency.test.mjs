import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

test("pnpm lock and package manager metadata retain exact worker build records", () => {
  const packageJson = readJson("package.json");
  const lock = fs.readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");
  const workspace = fs.readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");

  assert.equal(packageJson.packageManager, "pnpm@12.0.0");
  assert.equal(packageJson.pnpm, undefined);
  assert.equal(fs.existsSync(path.join(root, "package-lock.json")), false);
  assert.match(workspace, /^allowBuilds:\r?\n\s+'@swc\/core': true\r?\n\s+esbuild: true\r?\n?$/);
  assert.match(lock, /'@bjorn3\/browser_wasi_shim':\r?\n\s+specifier: \^0\.4\.2\r?\n\s+version: 0\.4\.2/);
  assert.match(lock, /esbuild:\r?\n\s+specifier: \^0\.27\.2\r?\n\s+version: 0\.27\.2/);
});
