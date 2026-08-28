import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");
const REQUIRED_RUNTIME_IDS = ["javascript-worker", "typescript-official", "python-pyodide"];
const REQUIRED_RUNTIME_ASSETS = {
  "javascript-worker": ["js-worker.js"],
  "typescript-official": ["js-worker.js", "typescript/typescript.js"],
  "python-pyodide": [
    "python-worker.js",
    "pyodide/pyodide.js",
    "pyodide/pyodide.asm.js",
    "pyodide/pyodide.asm.wasm",
    "pyodide/python_stdlib.zip",
    "pyodide/pyodide-lock.json",
  ],
};
const DEFAULT_ROUTE_CHUNKS = ["HomePage", "ExecutorPage", "ProblemsPage", "ProblemEditorPage", "SubmissionsPage", "NotFoundPage"];

export function checkDist(root, { pages = false, routeChunks = DEFAULT_ROUTE_CHUNKS } = {}) {
  const distRoot = path.resolve(root);
  assertFile(distRoot, "index.html");
  if (pages) assertFile(distRoot, "404.html");
  for (const routeChunk of routeChunks) assertRouteChunk(distRoot, routeChunk);

  const manifest = readManifest(distRoot);
  const runtimes = new Map(manifest.runtimes.map((runtime) => [runtime.runtimeId, runtime]));
  const required = [];
  for (const runtimeId of REQUIRED_RUNTIME_IDS) {
    const runtime = runtimes.get(runtimeId);
    if (!runtime || runtime.required !== true || runtime.packaged !== true) {
      throw new Error(`Required runtime is not packaged: ${runtimeId}`);
    }
    assertRequiredRuntimeAssets(runtime, runtimeId);
    assertRuntimeAssets(distRoot, runtime);
    if (runtimeId === "python-pyodide") assertNoUndeclaredPyodideFiles(distRoot, runtime);
    required.push({ runtimeId, state: "packaged" });
  }

  const optional = [];
  for (const runtime of manifest.runtimes) {
    if (runtime.required === true) continue;
    if (runtime.packaged !== true) {
      optional.push({
        runtimeId: runtime.runtimeId,
        state: "unavailable",
        reason: typeof runtime.unavailableReason === "string" ? runtime.unavailableReason : "Runtime is not packaged",
      });
      continue;
    }
    assertRuntimeAssets(distRoot, runtime);
    optional.push({ runtimeId: runtime.runtimeId, state: "loadable-unverified" });
  }
  optional.sort((left, right) => compareText(left.runtimeId, right.runtimeId));
  return { ok: true, required, optional };
}

function readManifest(distRoot) {
  const manifestPath = path.join(distRoot, "runtime-manifest.json");
  assertFile(distRoot, "runtime-manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid runtime manifest: ${error instanceof Error ? error.message : "JSON parse failed"}`);
  }
  if (manifest === null || typeof manifest !== "object" || !Array.isArray(manifest.runtimes)) {
    throw new Error("Runtime manifest must contain a runtimes array");
  }
  return manifest;
}

function assertRuntimeAssets(distRoot, runtime) {
  if (!Array.isArray(runtime.assets)) throw new Error(`Runtime ${runtime.runtimeId} does not declare assets`);
  for (const asset of runtime.assets) {
    if (!asset || typeof asset.url !== "string" || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0) {
      throw new Error(`Runtime ${runtime.runtimeId} has an invalid asset declaration`);
    }
    const assetPath = resolveAssetPath(distRoot, asset.url);
    let stat;
    try {
      stat = fs.statSync(assetPath);
    } catch (error) {
      if (isMissing(error)) throw new Error(`Runtime ${runtime.runtimeId} asset ${asset.url}: missing`);
      throw error;
    }
    if (!stat.isFile()) throw new Error(`Runtime ${runtime.runtimeId} asset ${asset.url}: not a file`);
    if (stat.size !== asset.bytes) {
      throw new Error(`Runtime ${runtime.runtimeId} asset ${asset.url}: expected ${asset.bytes} bytes, found ${stat.size}`);
    }
    assertNoExternalRuntimeUrl(assetPath, asset.url);
  }
}

function assertRequiredRuntimeAssets(runtime, runtimeId) {
  if (!Array.isArray(runtime.assets)) throw new Error(`Required runtime ${runtimeId} does not declare assets`);
  const declared = new Set(runtime.assets.map((asset) => asset?.url));
  for (const assetUrl of REQUIRED_RUNTIME_ASSETS[runtimeId]) {
    if (!declared.has(assetUrl)) throw new Error(`Required runtime ${runtimeId} does not declare ${assetUrl}`);
  }
}

function assertNoUndeclaredPyodideFiles(distRoot, runtime) {
  const pyodideRoot = path.join(distRoot, "pyodide");
  const declaredPaths = new Set(
    runtime.assets
      .map((asset) => asset.url)
      .filter((url) => url.startsWith("pyodide/"))
      .map((url) => resolveAssetPath(distRoot, url)),
  );

  for (const filePath of regularFilesIn(pyodideRoot)) {
    if (!declaredPaths.has(filePath)) {
      throw new Error(`Pyodide distribution includes an undeclared asset: ${path.relative(distRoot, filePath)}`);
    }
  }
}

function regularFilesIn(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...regularFilesIn(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function assertRouteChunk(distRoot, routeChunk) {
  const assetsRoot = path.join(distRoot, "assets");
  let entries = [];
  try {
    entries = fs.readdirSync(assetsRoot);
  } catch (error) {
    if (isMissing(error)) throw new Error(`Missing route chunk directory for ${routeChunk}`);
    throw error;
  }
  if (!entries.some((entry) => entry.startsWith(`${routeChunk}-`) && entry.endsWith(".js"))) {
    throw new Error(`Missing ${routeChunk} route chunk`);
  }
}

function assertFile(root, relativePath) {
  const filePath = path.join(root, ...relativePath.split("/"));
  try {
    if (!fs.statSync(filePath).isFile()) throw new Error(`Required distribution file is not a file: ${relativePath}`);
  } catch (error) {
    if (isMissing(error)) throw new Error(`Missing required distribution file: ${relativePath}`);
    throw error;
  }
}

function resolveAssetPath(distRoot, url) {
  if (!/^[A-Za-z0-9._/-]+$/.test(url)) throw new Error(`Runtime asset URL is unsafe: ${url}`);
  const assetPath = path.resolve(distRoot, ...url.split("/"));
  const relative = path.relative(distRoot, assetPath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Runtime asset URL escapes dist: ${url}`);
  return assetPath;
}

function assertNoExternalRuntimeUrl(assetPath, url) {
  if (!/\.(?:js|mjs|cjs|html)$/i.test(url)) return;
  const source = fs.readFileSync(assetPath, "utf8");
  if (EXTERNAL_RUNTIME_LOAD_PATTERNS.some((pattern) => pattern.test(source))) {
    throw new Error(`Runtime asset references an external CDN or API: ${url}`);
  }
}

const EXTERNAL_RUNTIME_LOAD_PATTERNS = [
  /\bimport\s*\(\s*["']https?:\/\//i,
  /\bimportScripts\s*\(\s*["']https?:\/\//i,
  /\bfetch\s*\(\s*["']https?:\/\//i,
  /\bnew\s+(?:Worker|SharedWorker|WebSocket|EventSource)\s*\(\s*["']https?:\/\//i,
  /\b(?:fetch|importScripts|Worker|SharedWorker)\s*\(\s*new\s+URL\s*\(\s*["']https?:\/\//i,
  /\b(?:open|sendBeacon)\s*\(\s*(?:["'][A-Z]+["']\s*,\s*)?["']https?:\/\//i,
];

function isMissing(error) {
  return error !== null && typeof error === "object" && error.code === "ENOENT";
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const report = checkDist(path.join(projectRoot, "dist"), { pages: process.env.GITHUB_PAGES === "true" });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Distribution smoke check failed");
    process.exitCode = 1;
  }
}
