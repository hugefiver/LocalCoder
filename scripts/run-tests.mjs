import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const testsDir = path.resolve(root, "tests");
const testOutputDir = path.resolve(root, ".test-dist");
const expectedTestOutputDir = path.join(root, ".test-dist");
const tscEntrypoint = path.join(root, "node_modules", "typescript", "bin", "tsc");
const testConfig = path.join(root, "tsconfig.test.json");

function isPathInside(parent, candidate) {
  const relativePath = path.relative(parent, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function isTestFile(filePath) {
  return filePath.endsWith(".test.ts") || filePath.endsWith(".test.mjs");
}

function discoverTests(directory) {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return discoverTests(entryPath);
      return entry.isFile() && isTestFile(entryPath) ? [entryPath] : [];
    })
    .sort();
}

function resolveFocusedTest(argument) {
  const testPath = path.resolve(root, argument);
  if (!isPathInside(testsDir, testPath) || !isTestFile(testPath)) {
    throw new Error(`Focused tests must be .test.ts or .test.mjs files under tests/: ${argument}`);
  }
  if (!fs.existsSync(testPath) || !fs.statSync(testPath).isFile()) {
    throw new Error(`Focused test does not exist: ${argument}`);
  }
  return testPath;
}

function compiledTestPath(testPath) {
  const relativePath = path.relative(root, testPath);
  const emittedPath = path.resolve(
    testOutputDir,
    relativePath.replace(/\.test\.ts$/, ".test.js"),
  );

  if (!isPathInside(testOutputDir, emittedPath)) {
    throw new Error(`Compiled test path escapes .test-dist: ${testPath}`);
  }
  return emittedPath;
}

function removeTestOutput() {
  if (testOutputDir !== expectedTestOutputDir || !isPathInside(root, testOutputDir)) {
    throw new Error("Refusing to clean a path other than <root>/.test-dist");
  }
  fs.rmSync(testOutputDir, { recursive: true, force: true });
}

function run(entrypoint, args) {
  const result = spawnSync(process.execPath, [entrypoint, ...args], {
    cwd: root,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  return result.status ?? 1;
}

function main() {
  const selectedTests = process.argv.slice(2).length > 0
    ? process.argv.slice(2).map(resolveFocusedTest)
    : discoverTests(testsDir);

  if (selectedTests.length === 0) {
    throw new Error("No tests found under tests/**/*.test.ts or tests/**/*.test.mjs");
  }

  removeTestOutput();
  try {
    const typecheckStatus = run(tscEntrypoint, ["--project", testConfig]);
    if (typecheckStatus !== 0) {
      process.exitCode = typecheckStatus;
      return;
    }

    const runnableTests = selectedTests.map((testPath) => (
      testPath.endsWith(".test.ts") ? compiledTestPath(testPath) : testPath
    ));
    for (const testPath of runnableTests) {
      if (!fs.existsSync(testPath)) {
        throw new Error(`Compiled test was not emitted: ${path.relative(root, testPath)}`);
      }
    }

    process.exitCode = run("--test", runnableTests);
  } finally {
    removeTestOutput();
  }
}

main();
