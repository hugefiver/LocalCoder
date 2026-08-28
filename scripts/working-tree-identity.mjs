import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");
const EXCLUDED_TOP_LEVEL_DIRECTORIES = new Set(["dist", ".test-dist", "node_modules", ".git", "artifacts"]);

export function computeWorkingTreeIdentity(rootOrOptions = defaultRoot) {
  const projectRoot = path.resolve(rootFrom(rootOrOptions));
  const physicalRoot = fs.realpathSync(projectRoot);
  const files = [];
  collectFiles(projectRoot, physicalRoot, "", new Set(), files);
  files.sort((left, right) => compareText(left.relativePath, right.relativePath));

  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath, "utf8");
    hash.update("\0", "utf8");
    hash.update(file.bytes);
  }
  return { schemaVersion: 1, algorithm: "sha256", digest: hash.digest("hex"), files: files.length };
}

export function writeWorkingTreeIdentity({ root = defaultRoot, now } = {}) {
  const projectRoot = path.resolve(root);
  const identity = computeWorkingTreeIdentity(projectRoot);
  const generatedAt = timestamp(now);
  const outputDirectory = path.join(projectRoot, "artifacts", "qa");
  const outputPath = path.join(outputDirectory, "working-tree-identity.json");
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify({ ...identity, generatedAt }, null, 2)}\n`, "utf8");
  return { identity, outputPath };
}

function rootFrom(rootOrOptions) {
  if (typeof rootOrOptions === "string") return rootOrOptions;
  if (rootOrOptions === undefined) return defaultRoot;
  if (rootOrOptions !== null && typeof rootOrOptions === "object") {
    if (rootOrOptions.root === undefined) return defaultRoot;
    if (typeof rootOrOptions.root === "string") return rootOrOptions.root;
  }
  throw new TypeError("Working-tree identity root must be a path string or an options object with root");
}

function timestamp(now) {
  const value = typeof now === "function" ? now() : new Date();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError("Working-tree identity now must return a valid Date");
  return value.toISOString();
}

function collectFiles(directory, physicalRoot, relativeDirectory, activeDirectories, files) {
  const physicalDirectory = fs.realpathSync(directory);
  if (activeDirectories.has(physicalDirectory)) throw new Error(`Symlink cycle detected at ${normalizePath(relativeDirectory)}`);
  activeDirectories.add(physicalDirectory);
  try {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))) {
      if (relativeDirectory === "" && EXCLUDED_TOP_LEVEL_DIRECTORIES.has(entry.name)) continue;
      const relativePath = relativeDirectory === "" ? entry.name : path.join(relativeDirectory, entry.name);
      const entryPath = path.join(directory, entry.name);
      const metadata = entry.isSymbolicLink()
        ? resolveSymlinkMetadata(entryPath, physicalRoot, relativePath)
        : fs.statSync(entryPath);
      if (metadata.isDirectory()) {
        collectFiles(entryPath, physicalRoot, relativePath, activeDirectories, files);
      } else if (metadata.isFile()) {
        files.push({ relativePath: normalizePath(relativePath), bytes: fs.readFileSync(entryPath) });
      }
    }
  } finally {
    activeDirectories.delete(physicalDirectory);
  }
}

function resolveSymlinkMetadata(entryPath, physicalRoot, relativePath) {
  const resolved = fs.realpathSync(entryPath);
  const relative = path.relative(physicalRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Symlink escapes the project root: ${normalizePath(relativePath)}`);
  }
  return fs.statSync(entryPath);
}

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const { identity, outputPath } = writeWorkingTreeIdentity();
    process.stdout.write(`${JSON.stringify({ ...identity, outputPath: path.relative(defaultRoot, outputPath) })}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unable to write working-tree identity");
    process.exitCode = 1;
  }
}
