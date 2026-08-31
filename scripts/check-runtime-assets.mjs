import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");
const gitLfsPointerPrefix = "version https://git-lfs.github.com/spec/v1";

function resolveTargetRoot(root, target) {
  const projectRoot = path.resolve(root);
  const targetRoot = path.resolve(projectRoot, target);
  const relativeTarget = path.relative(projectRoot, targetRoot);
  if (relativeTarget === "" || relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
    throw new Error(`Runtime asset target must be a child of the project root: ${target}`);
  }
  return targetRoot;
}

function assetProblems(targetRoot, assets) {
  const problems = [];
  for (const asset of assets) {
    const assetPath = path.resolve(targetRoot, ...asset.url.split("/"));
    const relativeAsset = path.relative(targetRoot, assetPath);
    if (relativeAsset === "" || relativeAsset.startsWith("..") || path.isAbsolute(relativeAsset)) {
      problems.push(`${asset.url}: URL escapes target`);
      continue;
    }

    try {
      const stat = fs.statSync(assetPath);
      if (!stat.isFile()) {
        problems.push(`${asset.url}: not a file`);
      } else if (stat.size === 0) {
        problems.push(`${asset.url}: empty`);
      } else if (stat.size <= 1024 && fs.readFileSync(assetPath, "utf8").startsWith(gitLfsPointerPrefix)) {
        problems.push(`${asset.url}: unresolved Git LFS pointer`);
      } else if (stat.size !== asset.bytes) {
        problems.push(`${asset.url}: expected ${asset.bytes} bytes, found ${stat.size}`);
      }
    } catch (error) {
      if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
        problems.push(`${asset.url}: missing`);
      } else {
        throw error;
      }
    }
  }
  return problems;
}

function classifyRuntime(targetRoot, runtime) {
  const problems = assetProblems(targetRoot, runtime.assets);
  if (problems.length > 0) {
    return { runtimeId: runtime.runtimeId, status: "broken", reason: problems.join("; ") };
  }
  if (!runtime.packaged) {
    return {
      runtimeId: runtime.runtimeId,
      status: "unavailable",
      reason: runtime.unavailableReason ?? "Manifest marks this runtime unavailable",
    };
  }
  return { runtimeId: runtime.runtimeId, status: "packaged" };
}

export function checkRuntimeAssets({ root = defaultRoot, manifest, target = "public" } = {}) {
  if (!manifest || !Array.isArray(manifest.runtimes)) {
    throw new TypeError("checkRuntimeAssets requires a manifest with a runtimes array");
  }

  const targetRoot = resolveTargetRoot(root, target);
  const classified = manifest.runtimes.map((runtime) => classifyRuntime(targetRoot, runtime));
  const required = classified.filter((entry, index) => manifest.runtimes[index].required);
  const optional = classified.filter((entry, index) => !manifest.runtimes[index].required);

  for (const entry of required) {
    if (entry.status === "unavailable") {
      entry.status = "broken";
      entry.reason = `Required runtime is unavailable: ${entry.reason}`;
    }
  }

  const requiredFailures = required.filter((entry) => entry.status === "broken");
  return {
    ready: requiredFailures.length === 0,
    required,
    optional,
    requiredFailures,
  };
}

function readManifest(targetRoot) {
  const manifestPath = path.join(targetRoot, "runtime-manifest.json");
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function printReport(report) {
  for (const entry of report.required) {
    const details = entry.reason ? `: ${entry.reason}` : "";
    console.log(`${entry.status.toUpperCase()} ${entry.runtimeId}${details}`);
  }
  for (const entry of report.optional) {
    const details = entry.reason ? `: ${entry.reason}` : "";
    console.log(`${entry.status.toUpperCase()} ${entry.runtimeId}${details}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const target = process.argv[2] ?? "public";
  const targetRoot = resolveTargetRoot(defaultRoot, target);
  const report = checkRuntimeAssets({ root: defaultRoot, manifest: readManifest(targetRoot), target });
  printReport(report);

  if (!report.ready || report.optional.some((entry) => entry.status === "broken")) {
    process.exitCode = 1;
  }
}
