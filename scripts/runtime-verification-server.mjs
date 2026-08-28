import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateRuntimeReceipt } from "./report-runtime-capabilities.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");
const MAX_RECEIPT_BYTES = 1_048_576;
export const DEFAULT_HARNESS_ORIGIN = "http://127.0.0.1:5173";
const DEFAULT_RECEIPT_TIMEOUT_MS = 120_000;

export async function startRuntimeVerificationServer({
  root = defaultRoot,
  runtimeId,
  port = 0,
  origin = DEFAULT_HARNESS_ORIGIN,
  timeoutMs = DEFAULT_RECEIPT_TIMEOUT_MS,
} = {}) {
  if (typeof runtimeId !== "string" || runtimeId.trim().length === 0) {
    throw new TypeError("runtimeId is required to start the verification receipt server");
  }
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError("receipt server port must be an integer from 0 through 65535");
  }
  if (!isExactOrigin(origin)) throw new TypeError("receipt server origin must be an absolute origin without a path");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RangeError("receipt timeout must be a positive integer");
  const projectRoot = path.resolve(root);
  const expected = expectedReceipt(projectRoot, runtimeId);
  const settlement = createReceiptSettlement(timeoutMs);
  const server = http.createServer((request, response) => {
    void handleRequest(request, response, expected, projectRoot, origin, settlement);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("receipt server did not bind a TCP port");
  }
  return {
    port: address.port,
    receipt: settlement.promise,
    close: () => {
      settlement.reject(new Error("Receipt server closed before receiving a receipt"));
      return new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    },
  };
}

async function handleRequest(request, response, expected, projectRoot, origin, settlement) {
  if (request.url !== "/receipt") {
    response.writeHead(404).end();
    return;
  }
  if (settlement.settled()) {
    response.writeHead(409).end();
    return;
  }
  if (request.method === "OPTIONS") {
    if (!validPreflight(request, origin)) {
      rejectReceipt(response, 403, "Receipt preflight origin, method, or headers are not allowed", settlement);
      return;
    }
    response.writeHead(204, corsHeaders(origin)).end();
    return;
  }
  if (request.method !== "POST") {
    response.writeHead(405, { allow: "POST, OPTIONS" }).end();
    return;
  }
  if (request.headers.origin !== origin) {
    rejectReceipt(response, 403, "Receipt origin is not allowed", settlement);
    return;
  }
  try {
    const body = await readBody(request);
    const receipt = validateReceipt(JSON.parse(body), expected);
    const artifactPath = writeArtifact(projectRoot, expected.runtimeId, receipt);
    response.writeHead(204, corsHeaders(origin)).end();
    settlement.resolve({ receipt, artifactPath });
  } catch (error) {
    rejectReceipt(
      response,
      400,
      error instanceof Error ? error.message : "Invalid verification receipt",
      settlement,
      origin,
    );
  }
}

function expectedReceipt(root, runtimeId) {
  const publicRoot = path.join(root, "public");
  const manifestPath = path.join(publicRoot, "runtime-manifest.json");
  const manifestText = fs.readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  const runtime = Array.isArray(manifest.runtimes)
    ? manifest.runtimes.find((entry) => entry?.runtimeId === runtimeId)
    : undefined;
  if (!runtime || runtime.packaged !== true || !Array.isArray(runtime.assets)) {
    throw new Error(`Runtime ${runtimeId} is not packaged for browser verification`);
  }
  return { runtimeId, runtime, manifestText, publicRoot };
}

function validateReceipt(value, expected) {
  validateRuntimeReceipt({ receipt: value, runtime: expected.runtime, manifestText: expected.manifestText, assetRoot: expected.publicRoot });
  return value;
}

function writeArtifact(root, runtimeId, receipt) {
  const outputDir = path.join(root, "artifacts", "runtime-verification");
  const outputPath = path.join(outputDir, `${runtimeId}.json`);
  const temporaryPath = path.join(outputDir, `.${runtimeId}-${process.pid}.tmp`);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "w" });
  fs.renameSync(temporaryPath, outputPath);
  return outputPath;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_RECEIPT_BYTES) {
        reject(new Error("Receipt exceeds the maximum size"));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.once("end", () => resolve(body));
    request.once("error", reject);
  });
}

function createReceiptSettlement(timeoutMs) {
  let resolvePromise;
  let rejectPromise;
  let settled = false;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const timer = setTimeout(() => {
    complete(rejectPromise, new Error(`Runtime verification receipt timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  const complete = (callback, value) => {
    if (settled) return false;
    settled = true;
    clearTimeout(timer);
    callback(value);
    return true;
  };
  return {
    promise,
    settled: () => settled,
    resolve: (value) => complete(resolvePromise, value),
    reject: (error) => complete(rejectPromise, error),
  };
}

function validPreflight(request, origin) {
  if (request.headers.origin !== origin || request.headers["access-control-request-method"] !== "POST") return false;
  const requested = typeof request.headers["access-control-request-headers"] === "string"
    ? request.headers["access-control-request-headers"].split(",").map((header) => header.trim().toLowerCase()).filter(Boolean)
    : [];
  return requested.length === 1 && requested[0] === "content-type";
}

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST",
    "access-control-allow-headers": "content-type",
    vary: "Origin",
  };
}

function rejectReceipt(response, status, reason, settlement, origin) {
  response.writeHead(status, {
    "content-type": "application/json",
    ...(origin === undefined ? {} : corsHeaders(origin)),
  }).end(JSON.stringify({ status: "BROKEN", reason }));
  settlement.reject(new Error(reason));
}

function isExactOrigin(value) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.origin === value;
  } catch {
    return false;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  console.error("runtime-verification-server.mjs is a library for verify-optional-runtime.mjs");
  process.exitCode = 1;
}
