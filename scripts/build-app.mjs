import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const typescriptAssetEntrypoint = path.join(root, "scripts", "copy-typescript-asset.mjs");
const pyodideSetupEntrypoint = path.join(root, "scripts", "setup-pyodide.js");
const workerBuildEntrypoint = path.join(root, "scripts", "build-worker-assets.mjs");
const manifestEntrypoint = path.join(root, "scripts", "generate-runtime-manifest.mjs");
const capabilityReportEntrypoint = path.join(root, "scripts", "report-runtime-capabilities.mjs");
const tscEntrypoint = path.join(root, "node_modules", "typescript", "bin", "tsc");
const eslintEntrypoint = path.join(root, "node_modules", "eslint", "bin", "eslint.js");
const testEntrypoint = path.join(root, "scripts", "run-tests.mjs");
const viteEntrypoint = path.join(root, "node_modules", "vite", "bin", "vite.js");
const runtimeCheckEntrypoint = path.join(root, "scripts", "check-runtime-assets.mjs");
const smokeEntrypoint = path.join(root, "scripts", "smoke-check.mjs");

function run(entrypoint, args) {
  const result = spawnSync(process.execPath, [entrypoint, ...args], {
    cwd: root,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  return result.status ?? 1;
}

function main() {
  const steps = [
    [typescriptAssetEntrypoint, []],
    [pyodideSetupEntrypoint, ["--skip-typescript"]],
    [workerBuildEntrypoint, []],
    [manifestEntrypoint, []],
    [capabilityReportEntrypoint, []],
    [tscEntrypoint, ["--noEmit"]],
    [eslintEntrypoint, [".", "--max-warnings=0"]],
    [testEntrypoint, []],
    [viteEntrypoint, ["build"]],
    [runtimeCheckEntrypoint, ["dist"]],
    [smokeEntrypoint, []],
  ];

  for (const [entrypoint, args] of steps) {
    const status = run(entrypoint, args);
    if (status !== 0) {
      process.exitCode = status;
      return;
    }
  }
}

main();
