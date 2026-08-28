import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  computeWorkingTreeIdentity,
  writeWorkingTreeIdentity,
} from "../../scripts/working-tree-identity.mjs";

const COVERED_PATHS = [
  "DESIGN.md",
  "index.html",
  "vite.config.ts",
  "src/example.ts",
  "tests/example.test.mjs",
  ".github/workflows/ci.yml",
  "public/js-worker.js",
  "docs/guide.md",
];

test("working-tree identity includes every regular project file category", () => {
  withFixture((root) => {
    const baseline = computeWorkingTreeIdentity(root);
    for (const relativePath of COVERED_PATHS) {
      const filePath = path.join(root, ...relativePath.split("/"));
      const original = fs.readFileSync(filePath, "utf8");
      fs.writeFileSync(filePath, `${original}\nmutation:${relativePath}`);
      assert.notEqual(computeWorkingTreeIdentity(root).digest, baseline.digest, relativePath);
      fs.writeFileSync(filePath, original);
    }
    assert.deepEqual(baseline, {
      schemaVersion: 1,
      algorithm: "sha256",
      digest: baseline.digest,
      files: COVERED_PATHS.length,
    });
    assert.equal(computeWorkingTreeIdentity(root).digest, baseline.digest);
  });
});

test("working-tree identity excludes only generated top-level directories and writes the QA artifact", () => {
  withFixture((root) => {
    for (const directory of ["dist", ".test-dist", "node_modules", ".git", "artifacts"]) {
      const filePath = path.join(root, directory, "ignored.txt");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, "first value");
    }
    const baseline = computeWorkingTreeIdentity(root);
    for (const directory of ["dist", ".test-dist", "node_modules", ".git", "artifacts"]) {
      fs.writeFileSync(path.join(root, directory, "ignored.txt"), "changed value");
    }
    assert.deepEqual(computeWorkingTreeIdentity(root), baseline);

    const result = writeWorkingTreeIdentity({ root, now: () => new Date("2026-08-25T12:34:56.789Z") });
    assert.equal(result.outputPath, path.join(root, "artifacts", "qa", "working-tree-identity.json"));
    assert.deepEqual(JSON.parse(fs.readFileSync(result.outputPath, "utf8")), {
      ...result.identity,
      generatedAt: "2026-08-25T12:34:56.789Z",
    });
  });
});

test("working-tree identity rejects an escaping symlink", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "localcoder-identity-root-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "localcoder-identity-outside-"));
  try {
    fs.writeFileSync(path.join(root, "inside.txt"), "inside");
    const outsideFile = path.join(outside, "outside.txt");
    fs.writeFileSync(outsideFile, "outside");
    try {
      fs.symlinkSync(outsideFile, path.join(root, "escaping-link"), "file");
    } catch (error) {
      if (error && typeof error === "object" && error.code === "EPERM") {
        t.skip("the current Windows account cannot create symlinks");
        return;
      }
      throw error;
    }
    assert.throws(() => computeWorkingTreeIdentity(root), /symlink.*escapes/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "localcoder-identity-"));
  try {
    for (const relativePath of COVERED_PATHS) {
      const filePath = path.join(root, ...relativePath.split("/"));
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, `fixture:${relativePath}`);
    }
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
