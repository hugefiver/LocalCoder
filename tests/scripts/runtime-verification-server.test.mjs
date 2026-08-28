import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startRuntimeVerificationServer } from "../../scripts/runtime-verification-server.mjs";

const ORIGIN = "http://127.0.0.1:5173";
// Request scenarios test CORS and receipt validation; timeout behavior has its own 10 ms case.
const REQUEST_SCENARIO_TIMEOUT_MS = 10_000;

test("receipt server accepts the exact CORS origin and atomically records a valid receipt", async () => {
  await withFixture(async (fixture) => {
    const server = await startRuntimeVerificationServer({ root: fixture.root, runtimeId: "racket-wasm", origin: ORIGIN, timeoutMs: REQUEST_SCENARIO_TIMEOUT_MS });
    try {
      const preflight = await request(server.port, {
        method: "OPTIONS",
        headers: {
          Origin: ORIGIN,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get("access-control-allow-origin"), ORIGIN);

      const posted = await request(server.port, { method: "POST", headers: { Origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(fixture.receipt()) });
      assert.equal(posted.status, 204);
      assert.equal(posted.headers.get("access-control-allow-origin"), ORIGIN);
      const settled = await server.receipt;
      assert.equal(settled.receipt.verification.state, "verified");
      assert.deepEqual(JSON.parse(fs.readFileSync(settled.artifactPath, "utf8")), fixture.receipt());
    } finally {
      await server.close();
    }
  });
});

test("receipt server rejects a wrong origin without producing an artifact", async () => {
  await withFixture(async (fixture) => {
    const server = await startRuntimeVerificationServer({ root: fixture.root, runtimeId: "racket-wasm", origin: ORIGIN, timeoutMs: REQUEST_SCENARIO_TIMEOUT_MS });
    const completion = rejectedReceipt(server.receipt);
    try {
      const response = await request(server.port, { method: "POST", headers: { Origin: "http://evil.test", "content-type": "application/json" }, body: JSON.stringify(fixture.receipt()) });
      assert.equal(response.status, 403);
      assert.match((await completion).message, /origin/i);
      assert.equal(fs.existsSync(fixture.artifactPath), false);
    } finally {
      await server.close();
    }
  });
});

test("receipt server rejects a broken verification and leaves no artifact", async () => {
  await withFixture(async (fixture) => {
    const server = await startRuntimeVerificationServer({ root: fixture.root, runtimeId: "racket-wasm", origin: ORIGIN, timeoutMs: REQUEST_SCENARIO_TIMEOUT_MS });
    const completion = rejectedReceipt(server.receipt);
    try {
      const receipt = fixture.receipt();
      receipt.verification = { state: "broken", runtimeId: "racket-wasm", code: "smoke-failed", message: "Smoke failed" };
      const response = await request(server.port, { method: "POST", headers: { Origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(receipt) });
      assert.equal(response.status, 400);
      assert.match((await completion).message, /verified/i);
      assert.equal(fs.existsSync(fixture.artifactPath), false);
    } finally {
      await server.close();
    }
  });
});

test("RustPython receipts require the mandatory Pyodide corpus parity check", async () => {
  await withFixture(async (fixture) => {
    const server = await startRuntimeVerificationServer({ root: fixture.root, runtimeId: "python-rustpython", origin: ORIGIN, timeoutMs: REQUEST_SCENARIO_TIMEOUT_MS });
    const completion = rejectedReceipt(server.receipt);
    try {
      const receipt = fixture.receipt();
      receipt.verification.checks = ["assets", "handshake", "smoke", "judge-contract"];
      const response = await request(server.port, { method: "POST", headers: { Origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(receipt) });
      assert.equal(response.status, 400);
      assert.match((await completion).message, /checks/i);
      assert.equal(fs.existsSync(fixture.artifactPath), false);
    } finally {
      await server.close();
    }
  }, {
    runtimeId: "python-rustpython",
    assets: ["rustpython-worker.js", "rustpython/runner.wasm"],
    checks: ["assets", "handshake", "smoke", "judge-contract", "pyodide-corpus-parity"],
  });
});

test("receipt server rejects when no receipt arrives before its bounded timeout", async () => {
  await withFixture(async (fixture) => {
    const server = await startRuntimeVerificationServer({ root: fixture.root, runtimeId: "racket-wasm", origin: ORIGIN, timeoutMs: 10 });
    const completion = rejectedReceipt(server.receipt);
    try {
      assert.match((await completion).message, /timed out/i);
      assert.equal(fs.existsSync(fixture.artifactPath), false);
    } finally {
      await server.close();
    }
  });
});

async function withFixture(run, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "localcoder-receipt-"));
  const publicRoot = path.join(root, "public");
  const runtimeId = options.runtimeId ?? "racket-wasm";
  const assets = options.assets ?? ["racket-worker.js", "racket/racket.js", "racket/racket.wasm"];
  const checks = options.checks ?? ["assets", "handshake", "smoke", "judge-contract"];
  try {
    for (const asset of assets) {
      const assetPath = path.join(publicRoot, asset);
      fs.mkdirSync(path.dirname(assetPath), { recursive: true });
      fs.writeFileSync(assetPath, `fixture:${asset}`);
    }
    const manifest = {
      schemaVersion: 1,
      runtimes: [{
        runtimeId,
        protocolVersion: 1,
        packaged: true,
        assets: assets.map((url) => ({ url, bytes: fs.statSync(path.join(publicRoot, url)).size })),
      }],
    };
    const manifestText = `${JSON.stringify(manifest)}\n`;
    fs.writeFileSync(path.join(publicRoot, "runtime-manifest.json"), manifestText);
    const fixture = {
      root,
      artifactPath: path.join(root, "artifacts", "runtime-verification", `${runtimeId}.json`),
      receipt: () => ({
        suite: "optional-v1",
        runtimeId,
        protocolVersion: 1,
        verification: {
          state: "verified",
          runtimeId,
          runtimeVersion: "fixture-runtime",
          checks,
        },
        manifestSha256: sha256(manifestText),
        assets: assets.map((url) => ({ url, sha256: sha256(fs.readFileSync(path.join(publicRoot, url))) })),
      }),
    };
    await run(fixture);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function request(port, options) {
  return fetch(`http://127.0.0.1:${port}/receipt`, options);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function rejectedReceipt(receipt) {
  return receipt.then(
    () => assert.fail("receipt unexpectedly resolved"),
    (error) => error instanceof Error ? error : new Error("receipt rejected without an Error"),
  );
}
