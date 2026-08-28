import fs from "node:fs";
import path from "node:path";
import { IDENTITY_ANALYSIS_BUILD_ID, buildOptions } from "./worker-build-plan.mjs";

function compareText(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function resolvedInputRecord(projectRoot, realProjectRoot, inputPath, details, seen) {
  if (typeof inputPath !== "string" || inputPath.length === 0 || inputPath.startsWith("<") || inputPath.includes("\0")) {
    throw new Error(`Worker build metafile has an unsupported input path: ${String(inputPath)}`);
  }
  if (!isPlainRecord(details)) throw new Error(`Worker build metafile has an unsupported input type: ${inputPath}`);
  const candidatePath = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(projectRoot, inputPath);
  let realInputPath;
  try {
    realInputPath = fs.realpathSync(candidatePath);
  } catch (error) {
    throw new Error(`Worker build metafile input is missing or unreadable: ${inputPath}`, { cause: error });
  }
  const relativePath = path.relative(realProjectRoot, realInputPath);
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error(`Worker build metafile input escapes the project root: ${inputPath}`);
  }
  const normalizedPath = relativePath.replaceAll("\\", "/");
  if (seen.has(normalizedPath)) throw new Error(`Worker build metafile has a duplicate normalized input: ${normalizedPath}`);
  seen.add(normalizedPath);
  let stat;
  try {
    stat = fs.statSync(realInputPath);
  } catch (error) {
    throw new Error(`Worker build metafile input is missing or unreadable: ${inputPath}`, { cause: error });
  }
  if (!stat.isFile()) throw new Error(`Worker build metafile has an unsupported input type: ${inputPath}`);
  try {
    return { tag: "resolved-import", name: normalizedPath, bytes: fs.readFileSync(realInputPath) };
  } catch (error) {
    throw new Error(`Worker build metafile input is missing or unreadable: ${inputPath}`, { cause: error });
  }
}

export async function resolvedImportClosureRecords(esbuild, plan) {
  let result;
  try {
    result = await esbuild.build(buildOptions(plan, IDENTITY_ANALYSIS_BUILD_ID, true));
  } catch (error) {
    throw new Error(`Worker build identity analysis failed for ${plan.workerKey}`, { cause: error });
  }
  if (!isPlainRecord(result) || !isPlainRecord(result.metafile) || !isPlainRecord(result.metafile.inputs)) {
    throw new Error(`Worker build identity analysis produced an unstable or missing metafile for ${plan.workerKey}`);
  }
  let realProjectRoot;
  try {
    realProjectRoot = fs.realpathSync(plan.projectRoot);
  } catch (error) {
    throw new Error(`Worker build identity project root is unreadable: ${plan.projectRoot}`, { cause: error });
  }
  const seen = new Set();
  const records = Object.entries(result.metafile.inputs)
    .map(([inputPath, details]) => resolvedInputRecord(plan.projectRoot, realProjectRoot, inputPath, details, seen))
    .sort((left, right) => compareText(left.name, right.name));
  if (records.length === 0) throw new Error(`Worker build identity analysis produced no inputs for ${plan.workerKey}`);
  return records;
}
