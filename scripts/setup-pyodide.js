import { copyFileSync, mkdirSync, existsSync, rmSync, statSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { copyTypeScriptAsset } from "./copy-typescript-asset.mjs";
import { writeRuntimeManifest } from "./generate-runtime-manifest.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");
const requiredPyodideAssets = [
  "pyodide.js",
  "pyodide.asm.js",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
];

export function assertRequiredPyodideAssets(directory) {
  for (const asset of requiredPyodideAssets) {
    const assetPath = join(directory, asset);
    if (!existsSync(assetPath) || !statSync(assetPath).isFile() || statSync(assetPath).size === 0) {
      throw new Error(`Missing required Pyodide asset: ${assetPath}`);
    }
  }
}

function assertSafePyodideTarget(root, targetDir) {
  const publicDir = resolve(root, "public");
  const expectedTarget = resolve(publicDir, "pyodide");
  if (
    targetDir !== expectedTarget
    || dirname(targetDir) !== publicDir
    || relative(publicDir, targetDir) !== "pyodide"
  ) {
    throw new Error(`Refusing to reset unexpected Pyodide target: ${targetDir}`);
  }
}

export async function setupPyodide({ root = projectRoot, copyTypeScript = true } = {}) {
  console.log("Setting up Pyodide...");

  const pyodideDir = resolve(root, "node_modules", "pyodide");
  const targetDir = resolve(root, "public", "pyodide");

  if (!existsSync(pyodideDir)) {
    throw new Error("Pyodide not found in node_modules. Please run: npm install pyodide");
  }
  assertRequiredPyodideAssets(pyodideDir);
  assertSafePyodideTarget(root, targetDir);

  console.log(`Copying from: ${pyodideDir}`);
  console.log(`Copying to: ${targetDir}`);

  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  for (const asset of requiredPyodideAssets) {
    copyFileSync(join(pyodideDir, asset), join(targetDir, asset));
  }
  assertRequiredPyodideAssets(targetDir);
  if (copyTypeScript) {
    await copyTypeScriptAsset({ root, regenerate: false });
  }
  await writeRuntimeManifest({ root });
  console.log("Pyodide setup complete and runtime manifest regenerated.");
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  setupPyodide({ copyTypeScript: !process.argv.includes("--skip-typescript") }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
