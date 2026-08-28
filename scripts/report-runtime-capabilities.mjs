import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkRuntimeAssets } from "./check-runtime-assets.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");
const OPTIONAL_CHECKS = Object.freeze(["assets", "handshake", "smoke", "judge-contract"]);
const RUSTPYTHON_OPTIONAL_CHECKS = Object.freeze([...OPTIONAL_CHECKS, "pyodide-corpus-parity"]);

export function reportRuntimeCapabilities({
  root = defaultRoot,
  target = "public",
  receiptDirectory = "artifacts/runtime-verification",
} = {}) {
  const projectRoot = path.resolve(root);
  const targetRoot = resolveContainedPath(projectRoot, target, "Runtime asset target");
  const manifestPath = path.join(targetRoot, "runtime-manifest.json");
  const manifestText = fs.readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  if (!isRecord(manifest) || !Array.isArray(manifest.runtimes)) {
    throw new TypeError("Runtime manifest must contain a runtimes array");
  }

  const assetReport = checkRuntimeAssets({ root: projectRoot, manifest, target });
  const assetStates = new Map([...assetReport.required, ...assetReport.optional].map((entry) => [entry.runtimeId, entry]));
  const receiptRoot = resolveContainedPath(projectRoot, receiptDirectory, "Runtime receipt directory");
  const receiptStates = new Map();

  for (const runtime of manifest.runtimes) {
    if (!isRecord(runtime) || typeof runtime.runtimeId !== "string") {
      throw new TypeError("Runtime manifest contains an entry without a runtimeId");
    }
    if (runtime.required !== true) receiptStates.set(runtime.runtimeId, readReceiptState(runtime, manifestText, targetRoot, receiptRoot));
  }

  return buildCapabilityReport({ manifest, receipts: receiptStates, assetStates });
}

export function buildCapabilityReport({ manifest, receipts = {}, assetStates = {} } = {}) {
  if (!isRecord(manifest) || !Array.isArray(manifest.runtimes)) {
    throw new TypeError("Capability report requires a manifest with a runtimes array");
  }
  const required = [];
  const optional = [];
  for (const runtime of manifest.runtimes) {
    if (!isRecord(runtime) || typeof runtime.runtimeId !== "string") {
      throw new TypeError("Runtime manifest contains an entry without a runtimeId");
    }
    const assetState = stateFor(assetStates, runtime.runtimeId);
    if (runtime.required === true) {
      required.push(requiredCapability(runtime, assetState));
    } else {
      optional.push(optionalCapability(runtime, assetState, stateFor(receipts, runtime.runtimeId)));
    }
  }
  const sortedRequired = required.sort(compareRuntimeId);
  const sortedOptional = optional.sort(compareRuntimeId);
  const blockers = [...sortedRequired, ...sortedOptional].filter((entry) => entry.state === "blocker" || entry.state === "broken");
  return {
    ready: blockers.length === 0,
    required: sortedRequired,
    optional: sortedOptional,
    verifiedOptionalRuntimeIds: sortedOptional.filter((entry) => entry.state === "verified").map((entry) => entry.runtimeId),
    brokenRuntimeIds: blockers.map((entry) => entry.runtimeId),
    blockers,
  };
}

export function validateRuntimeReceipt({ receipt, runtime, manifestText, assetRoot }) {
  if (!isRecord(receipt) || receipt.suite !== "optional-v1" || receipt.runtimeId !== runtime.runtimeId) {
    throw new Error("Receipt has an invalid suite or runtime id");
  }
  if (receipt.protocolVersion !== runtime.protocolVersion) {
    throw new Error("Receipt protocolVersion does not match the current runtime protocol");
  }
  if (receipt.manifestSha256 !== sha256(manifestText)) {
    throw new Error("Receipt manifest SHA-256 does not match the current manifest");
  }
  if (!isRecord(receipt.verification) || receipt.verification.state !== "verified" || receipt.verification.runtimeId !== runtime.runtimeId) {
    throw new Error("Receipt does not contain a verified runtime result");
  }
  if (!sameStrings(receipt.verification.checks, verificationChecks(runtime.runtimeId))) {
    const detail = runtime.runtimeId === "python-rustpython" ? " or missing RustPython parity" : "";
    throw new Error(`Receipt verification checks are incomplete or out of order${detail}`);
  }
  if (!Array.isArray(receipt.assets) || receipt.assets.length !== runtime.assets.length) {
    throw new Error("Receipt asset list does not match the current manifest");
  }

  for (const [index, asset] of runtime.assets.entries()) {
    const received = receipt.assets[index];
    const currentDigest = sha256(fs.readFileSync(resolveAssetPath(assetRoot, asset.url)));
    if (!isRecord(received) || received.url !== asset.url || received.sha256 !== currentDigest) {
      throw new Error(`Receipt asset SHA-256 mismatch at index ${index}`);
    }
  }
}

export function formatRuntimeCapabilities(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function appendGithubSummary(report, { summaryPath = process.env.GITHUB_STEP_SUMMARY } = {}) {
  if (typeof summaryPath !== "string" || summaryPath.length === 0) return false;
  const rows = [...report.required.map((entry) => ({ group: "required", ...entry })), ...report.optional.map((entry) => ({ group: "optional", ...entry }))];
  const markdown = [
    "## Runtime capabilities",
    "",
    "| Group | Runtime | State | Reason |",
    "| --- | --- | --- | --- |",
    ...rows.map((entry) => `| ${entry.group} | ${entry.runtimeId} | ${entry.state} | ${markdownText(entry.reason ?? "")} |`),
    "",
  ].join("\n");
  fs.appendFileSync(summaryPath, markdown, "utf8");
  return true;
}

function requiredCapability(runtime, assetState) {
  if (assetState?.status === "broken") {
    return { runtimeId: runtime.runtimeId, state: "blocker", reason: assetState.reason };
  }
  if (runtime.packaged !== true) {
    return { runtimeId: runtime.runtimeId, state: "blocker", reason: "Required runtime is not packaged" };
  }
  if (!hasExecutionCapabilities(runtime)) {
    return { runtimeId: runtime.runtimeId, state: "blocker", reason: "Required runtime capabilities are disabled" };
  }
  return { runtimeId: runtime.runtimeId, state: "packaged" };
}

function optionalCapability(runtime, assetState, receiptState) {
  if (assetState?.status === "broken") {
    return { runtimeId: runtime.runtimeId, state: "broken", reason: assetState.reason };
  }
  if (runtime.packaged !== true || assetState?.status === "unavailable") {
    return {
      runtimeId: runtime.runtimeId,
      state: "unavailable",
      reason: typeof runtime.unavailableReason === "string" ? runtime.unavailableReason : assetState?.reason ?? "Runtime is not packaged",
    };
  }
  if (!hasExecutionCapabilities(runtime)) {
    return { runtimeId: runtime.runtimeId, state: "broken", reason: "Packaged runtime capabilities are disabled" };
  }

  if (receiptState?.state === "verified") return { runtimeId: runtime.runtimeId, state: "verified" };
  if (receiptState?.state === "broken") {
    return { runtimeId: runtime.runtimeId, state: "broken", reason: normalizedReason(receiptState.reason, "Runtime receipt is broken") };
  }
  return { runtimeId: runtime.runtimeId, state: "loadable-unverified", reason: "No verification receipt" };
}

function readReceiptState(runtime, manifestText, assetRoot, receiptRoot) {
  const receiptPath = path.join(receiptRoot, `${runtime.runtimeId}.json`);
  let receiptText;
  try {
    receiptText = fs.readFileSync(receiptPath, "utf8");
  } catch (error) {
    if (isMissing(error)) return undefined;
    return { state: "broken", reason: errorMessage(error) };
  }

  try {
    validateRuntimeReceipt({ receipt: JSON.parse(receiptText), runtime, manifestText, assetRoot });
    return { state: "verified" };
  } catch (error) {
    return { state: "broken", reason: errorMessage(error) };
  }
}

function stateFor(states, runtimeId) {
  if (states instanceof Map) return states.get(runtimeId);
  return isRecord(states) ? states[runtimeId] : undefined;
}

function normalizedReason(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function hasExecutionCapabilities(runtime) {
  return isRecord(runtime.capabilities)
    ? runtime.capabilities.execute === true && runtime.capabilities.judge === true
    : true;
}

function verificationChecks(runtimeId) {
  return runtimeId === "python-rustpython" ? RUSTPYTHON_OPTIONAL_CHECKS : OPTIONAL_CHECKS;
}

function resolveContainedPath(root, target, description) {
  const projectRoot = path.resolve(root);
  const targetPath = path.resolve(projectRoot, target);
  const relative = path.relative(projectRoot, targetPath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${description} must be a child of the project root: ${target}`);
  }
  return targetPath;
}

function resolveAssetPath(assetRoot, url) {
  if (typeof url !== "string" || !/^[A-Za-z0-9._/-]+$/.test(url)) throw new Error("Manifest has an unsafe asset URL");
  const assetPath = path.resolve(assetRoot, ...url.split("/"));
  const relative = path.relative(assetRoot, assetPath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Manifest asset URL escapes the asset root");
  return assetPath;
}

function compareRuntimeId(left, right) {
  return compareText(left.runtimeId, right.runtimeId);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameStrings(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMissing(error) {
  return error !== null && typeof error === "object" && error.code === "ENOENT";
}

function errorMessage(error) {
  return error instanceof Error && error.message.length > 0 ? error.message : "Runtime capability validation failed";
}

function markdownText(value) {
  return value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function parseCliArguments(arguments_) {
  if (arguments_.length === 0) return { githubSummary: false };
  if (arguments_.length === 1 && arguments_[0] === "--github-summary") return { githubSummary: true };
  throw new Error("Usage: node scripts/report-runtime-capabilities.mjs [--github-summary]");
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const options = parseCliArguments(process.argv.slice(2));
    const report = reportRuntimeCapabilities();
    process.stdout.write(formatRuntimeCapabilities(report));
    if (options.githubSummary && !appendGithubSummary(report)) {
      throw new Error("GITHUB_STEP_SUMMARY is required with --github-summary");
    }
    if (!report.ready) process.exitCode = 1;
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
}
