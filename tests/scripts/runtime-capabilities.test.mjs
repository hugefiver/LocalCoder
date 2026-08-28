import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appendGithubSummary,
  buildCapabilityReport,
  formatRuntimeCapabilities,
  reportRuntimeCapabilities,
  validateRuntimeReceipt,
} from "../../scripts/report-runtime-capabilities.mjs";
import { buildManifest } from "../../scripts/generate-runtime-manifest.mjs";

const OPTIONAL_CHECKS = ["assets", "handshake", "smoke", "judge-contract"];

test("capability report classifies required and optional runtimes deterministically", () => {
  withFixture((fixture) => {
    fixture.writeAsset("js-worker.js", "required javascript");
    fixture.writeAsset("racket-worker.js", "verified optional");
    fixture.writeAsset("rustpython-worker.js", "loadable optional");
    fixture.writeManifest([
      fixture.runtime("racket-wasm", { assets: ["racket-worker.js"] }),
      fixture.runtime("javascript-worker", { required: true, assets: ["js-worker.js"] }),
      fixture.runtime("haskell-ghc-wasi", { packaged: false, reason: "not bundled" }),
      fixture.runtime("python-rustpython", { assets: ["rustpython-worker.js"] }),
    ]);
    fixture.writeReceipt("racket-wasm");

    const report = reportRuntimeCapabilities({ root: fixture.root });

    assert.deepEqual(report.required, [{ runtimeId: "javascript-worker", state: "packaged" }]);
    assert.deepEqual(report.optional, [
      { runtimeId: "haskell-ghc-wasi", state: "unavailable", reason: "not bundled" },
      { runtimeId: "python-rustpython", state: "loadable-unverified", reason: "No verification receipt" },
      { runtimeId: "racket-wasm", state: "verified" },
    ]);
    assert.deepEqual(report.verifiedOptionalRuntimeIds, ["racket-wasm"]);
    assert.deepEqual(report.brokenRuntimeIds, []);
    assert.deepEqual(report.blockers, []);
    assert.equal(report.ready, true);
    assert.equal(formatRuntimeCapabilities(report), formatRuntimeCapabilities(report));

    const summaryPath = path.join(fixture.root, "summary.md");
    assert.equal(appendGithubSummary(report, { summaryPath }), true);
    assert.match(fs.readFileSync(summaryPath, "utf8"), /racket-wasm.*verified/i);
  });
});

test("buildCapabilityReport derives deterministic states and id lists from a manifest and normalized receipts", () => {
  const report = buildCapabilityReport({
    manifest: {
      runtimes: [
        { runtimeId: "racket-wasm", required: false, packaged: true },
        { runtimeId: "typescript-official", required: true, packaged: true },
        { runtimeId: "haskell-ghc-wasi", required: false, packaged: false, unavailableReason: "not bundled" },
        { runtimeId: "javascript-worker", required: true, packaged: true },
        { runtimeId: "python-rustpython", required: false, packaged: true },
      ],
    },
    receipts: {
      "racket-wasm": { state: "verified" },
      "python-rustpython": { state: "broken", reason: "receipt invalid" },
    },
    assetStates: {
      "javascript-worker": { status: "broken", reason: "missing" },
    },
  });

  assert.deepEqual(report.required, [
    { runtimeId: "javascript-worker", state: "blocker", reason: "missing" },
    { runtimeId: "typescript-official", state: "packaged" },
  ]);
  assert.deepEqual(report.optional, [
    { runtimeId: "haskell-ghc-wasi", state: "unavailable", reason: "not bundled" },
    { runtimeId: "python-rustpython", state: "broken", reason: "receipt invalid" },
    { runtimeId: "racket-wasm", state: "verified" },
  ]);
  assert.deepEqual(report.verifiedOptionalRuntimeIds, ["racket-wasm"]);
  assert.deepEqual(report.brokenRuntimeIds, ["javascript-worker", "python-rustpython"]);
  assert.deepEqual(report.blockers.map((entry) => entry.runtimeId), ["javascript-worker", "python-rustpython"]);
  assert.equal(report.ready, false);
});

test("capability report makes a required asset failure a blocker and optional receipt defects broken", () => {
  withFixture((fixture) => {
    fixture.writeAsset("js-worker.js", "required javascript");
    fixture.writeAsset("racket-worker.js", "optional racket");
    fixture.writeManifest([
      fixture.runtime("javascript-worker", { required: true, assets: ["js-worker.js"] }),
      fixture.runtime("racket-wasm", { assets: ["racket-worker.js"] }),
    ]);
    fixture.writeReceipt("racket-wasm", (receipt) => {
      receipt.protocolVersion = 2;
    });

    fs.rmSync(path.join(fixture.root, "public", "js-worker.js"));
    const report = reportRuntimeCapabilities({ root: fixture.root });

    assert.deepEqual(report.required, [{
      runtimeId: "javascript-worker",
      state: "blocker",
      reason: "js-worker.js: missing",
    }]);
    assert.deepEqual(report.optional, [{
      runtimeId: "racket-wasm",
      state: "broken",
      reason: "Receipt protocolVersion does not match the current runtime protocol",
    }]);
    assert.equal(report.ready, false);
    assert.deepEqual(report.verifiedOptionalRuntimeIds, []);
    assert.deepEqual(report.brokenRuntimeIds, ["javascript-worker", "racket-wasm"]);
    assert.deepEqual(report.blockers.map((entry) => entry.runtimeId), ["javascript-worker", "racket-wasm"]);
  });
});

test("capability report requires ordered checks, current digests, and RustPython parity", () => {
  withFixture((fixture) => {
    fixture.writeAsset("racket-worker.js", "optional racket");
    fixture.writeAsset("rustpython-worker.js", "optional rustpython");
    fixture.writeManifest([
      fixture.runtime("racket-wasm", { assets: ["racket-worker.js"] }),
      fixture.runtime("python-rustpython", { assets: ["rustpython-worker.js"] }),
    ]);

    fixture.writeReceipt("racket-wasm", (receipt) => {
      receipt.verification.checks = [...OPTIONAL_CHECKS].reverse();
    });
    fixture.writeReceipt("python-rustpython", (receipt) => {
      receipt.verification.checks = [...OPTIONAL_CHECKS];
    });
    let report = reportRuntimeCapabilities({ root: fixture.root });
    assert.match(byId(report.optional, "racket-wasm").reason, /checks/i);
    assert.match(byId(report.optional, "python-rustpython").reason, /parity/i);

    fixture.writeReceipt("racket-wasm");
    fixture.writeReceipt("python-rustpython", (receipt) => {
      receipt.verification.checks = [...OPTIONAL_CHECKS, "pyodide-corpus-parity"];
    });
    fs.writeFileSync(path.join(fixture.root, "public", "racket-worker.js"), "stale-digest-xx");
    report = reportRuntimeCapabilities({ root: fixture.root });
    assert.match(byId(report.optional, "racket-wasm").reason, /SHA-256/i);
    assert.equal(byId(report.optional, "python-rustpython").state, "verified");
  });
});

test("capability receipts bind every manifest-declared optional fallback variant", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "localcoder-capabilities-"));
  try {
    const writeAsset = (url, contents) => {
      const assetPath = path.join(root, "public", ...url.split("/"));
      fs.mkdirSync(path.dirname(assetPath), { recursive: true });
      fs.writeFileSync(assetPath, contents);
    };
    const packagePath = path.join(root, "node_modules", "typescript", "package.json");
    fs.mkdirSync(path.dirname(packagePath), { recursive: true });
    fs.writeFileSync(packagePath, JSON.stringify({ version: "fixture" }));
    writeAsset("racket-worker.js", "optional racket worker");
    writeAsset("racket/racket.js", "optional racket javascript");
    writeAsset("racket/racket.wasm.gz", "optional racket gzip");
    writeAsset("racket/racket.wasm", "optional racket raw");

    const manifest = await buildManifest({ root });
    const runtime = byId(manifest.runtimes, "racket-wasm");
    assert.deepEqual(runtime.assets.map((asset) => asset.url), [
      "racket-worker.js",
      "racket/racket.js",
      "racket/racket.wasm.gz",
      "racket/racket.wasm",
    ]);
    const manifestText = JSON.stringify(manifest);
    const receipt = {
      suite: "optional-v1",
      runtimeId: runtime.runtimeId,
      protocolVersion: runtime.protocolVersion,
      verification: { state: "verified", runtimeId: runtime.runtimeId, runtimeVersion: "fixture", checks: [...OPTIONAL_CHECKS] },
      manifestSha256: sha256(manifestText),
      assets: runtime.assets.map((asset) => ({
        url: asset.url,
        sha256: sha256(fs.readFileSync(path.join(root, "public", ...asset.url.split("/")))),
      })),
    };
    assert.throws(
      () => validateRuntimeReceipt({ receipt: { ...receipt, assets: receipt.assets.filter((asset) => asset.url !== "racket/racket.wasm") }, runtime, manifestText, assetRoot: path.join(root, "public") }),
      /asset list/i,
    );
    fs.writeFileSync(path.join(root, "public", "racket", "racket.wasm"), "mutated optional racket raw");
    assert.throws(
      () => validateRuntimeReceipt({ receipt, runtime, manifestText, assetRoot: path.join(root, "public") }),
      /SHA-256/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "localcoder-capabilities-"));
  const fixture = {
    root,
    writeAsset(url, contents) {
      const assetPath = path.join(root, "public", ...url.split("/"));
      fs.mkdirSync(path.dirname(assetPath), { recursive: true });
      fs.writeFileSync(assetPath, contents);
    },
    runtime(runtimeId, options = {}) {
      const assets = options.assets ?? [];
      const packaged = options.packaged ?? true;
      return {
        runtimeId,
        protocolVersion: options.protocolVersion ?? 1,
        required: options.required ?? false,
        packaged,
        ...(packaged ? {} : { unavailableReason: options.reason ?? "not bundled" }),
        assets: assets.map((url) => ({
          url,
          bytes: fs.statSync(path.join(root, "public", ...url.split("/"))).size,
        })),
      };
    },
    writeManifest(runtimes) {
      fs.mkdirSync(path.join(root, "public"), { recursive: true });
      fs.writeFileSync(path.join(root, "public", "runtime-manifest.json"), `${JSON.stringify({ schemaVersion: 1, runtimes }, null, 2)}\n`);
    },
    writeReceipt(runtimeId, mutate = () => {}) {
      const manifestText = fs.readFileSync(path.join(root, "public", "runtime-manifest.json"), "utf8");
      const manifest = JSON.parse(manifestText);
      const runtime = manifest.runtimes.find((entry) => entry.runtimeId === runtimeId);
      assert.ok(runtime, `missing runtime ${runtimeId}`);
      const checks = runtimeId === "python-rustpython"
        ? [...OPTIONAL_CHECKS, "pyodide-corpus-parity"]
        : [...OPTIONAL_CHECKS];
      const receipt = {
        suite: "optional-v1",
        runtimeId,
        protocolVersion: runtime.protocolVersion,
        verification: { state: "verified", runtimeId, runtimeVersion: "fixture", checks },
        manifestSha256: sha256(manifestText),
        assets: runtime.assets.map((asset) => ({
          url: asset.url,
          sha256: sha256(fs.readFileSync(path.join(root, "public", ...asset.url.split("/")))),
        })),
      };
      mutate(receipt);
      const receiptPath = path.join(root, "artifacts", "runtime-verification", `${runtimeId}.json`);
      fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
      fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    },
  };
  try {
    run(fixture);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function byId(entries, runtimeId) {
  const entry = entries.find((candidate) => candidate.runtimeId === runtimeId);
  assert.ok(entry, `missing ${runtimeId}`);
  return entry;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
