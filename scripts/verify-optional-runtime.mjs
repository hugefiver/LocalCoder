import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkRuntimeAssets } from "./check-runtime-assets.mjs";
import { startRuntimeVerificationServer } from "./runtime-verification-server.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const HARNESS_ORIGIN = "http://127.0.0.1:5173";

async function main(arguments_) {
  const options = parseArguments(arguments_);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "public", "runtime-manifest.json"), "utf8"));
  const runtime = Array.isArray(manifest.runtimes)
    ? manifest.runtimes.find((entry) => entry?.runtimeId === options.runtimeId)
    : undefined;
  if (runtime === undefined) return report(1, { status: "BROKEN", runtimeId: options.runtimeId, reason: "Runtime is absent from the manifest" });

  const assetReport = checkRuntimeAssets({ root, manifest, target: "public" });
  const assetState = [...assetReport.required, ...assetReport.optional].find((entry) => entry.runtimeId === options.runtimeId);
  if (assetState?.status === "broken") {
    return report(1, { status: "BROKEN", runtimeId: options.runtimeId, reason: assetState.reason });
  }
  if (runtime.packaged !== true || assetState?.status === "unavailable") {
    return report(2, {
      status: "UNAVAILABLE",
      runtimeId: options.runtimeId,
      reason: runtime.unavailableReason ?? assetState?.reason ?? "Runtime is not packaged",
    });
  }
  if (!options.browser) {
    return report(2, { status: "LOADABLE_UNVERIFIED", runtimeId: options.runtimeId, reason: "Browser receipt was not requested" });
  }

  const server = await startRuntimeVerificationServer({ root, runtimeId: options.runtimeId, port: options.port });
  const query = new URLSearchParams({ runtimeId: options.runtimeId, receiptPort: String(server.port), suite: "optional-v1" });
  console.log(`HARNESS_URL ${HARNESS_ORIGIN}/runtime-harness.html?${query.toString()}`);
  try {
    const { artifactPath } = await server.receipt;
    return report(0, { status: "VERIFIED", runtimeId: options.runtimeId, artifact: path.relative(root, artifactPath) });
  } finally {
    await server.close();
  }
}

function parseArguments(arguments_) {
  const [runtimeId, ...flags] = arguments_;
  if (typeof runtimeId !== "string" || runtimeId.startsWith("-")) {
    throw new Error("Usage: node scripts/verify-optional-runtime.mjs <runtimeId> [--browser --port <port>]");
  }
  let browser = false;
  let port = 0;
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (flag === "--browser") {
      browser = true;
      continue;
    }
    if (flag === "--port") {
      const value = flags[index + 1];
      if (value === undefined || !/^\d+$/.test(value)) throw new Error("--port requires an integer from 0 through 65535");
      port = Number(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${flag}`);
  }
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error("--port must be an integer from 0 through 65535");
  return { runtimeId, browser, port };
}

function report(exitCode, payload) {
  console.log(JSON.stringify(payload));
  process.exitCode = exitCode;
}

main(process.argv.slice(2)).catch((error) => {
  console.error(JSON.stringify({ status: "BROKEN", reason: error instanceof Error ? error.message : "Verification command failed" }));
  process.exitCode = 1;
});
