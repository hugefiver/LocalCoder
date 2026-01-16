import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const crypto = globalThis.crypto ?? webcrypto;
const atob = globalThis.atob ?? ((data) => Buffer.from(data, "base64").toString("latin1"));

// Simple WASM module exporting add(a, b) -> a + b.
// WAT:
// (module
//   (func (export "add") (param i32 i32) (result i32)
//     local.get 0
//     local.get 1
//     i32.add))
const WASM_ADD_BASE64 = "AGFzbQEAAAABBwFgAn9/AX8DAgEABwcBA2FkZAAACgkBBwAgACABags=";

// Minimal WASI module that immediately exits with code 0.
// WAT (conceptual equivalent):
// (module
//   (import "wasi_snapshot_preview1" "proc_exit"
//     (func $proc_exit (param i32)))
//   (memory (export "memory") 1)
//   (func (export "_start")
//     i32.const 0
//     call $proc_exit))
// Encoded here as base64 for convenience in tests.
const WASI_STUB_BASE64 =
  "AGFzbQEAAAABCAJgAX8AYAAAAiQBFndhc2lfc25hcHNob3RfcHJldmlldzEJcHJvY19leGl0AAADAgEBBQMBAAEHEwIGbWVtb3J5AgAGX3N0YXJ0AAEKCAEGAEEAEAAL";

function loadWorker() {
  const workerPath = path.join(root, "public", "wasm-worker.js");
  const code = fs.readFileSync(workerPath, "utf8");

  const messages = [];

  const sandbox = {
    self: {
      postMessage: (m) => messages.push(m),
      location: { origin: "http://localhost", pathname: "/wasm-worker.js" },
    },
    importScripts: (...scripts) => {
      for (const script of scripts) {
        const scriptPath = path.resolve(root, "public", script);
        const scriptCode = fs.readFileSync(scriptPath, "utf8");
        vm.runInContext(scriptCode, sandbox, { filename: script });
      }
    },
    performance: {
      now: () => 0,
    },
    crypto,
    fetch: async (url) => {
      throw new Error(`Unexpected fetch in tests: ${url}`);
    },
    TextEncoder,
    TextDecoder,
    WebAssembly,
    atob,
    console,
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "wasm-worker.js" });

  assert.equal(typeof sandbox.self.onmessage, "function", "worker should register self.onmessage");

  return { sandbox, messages };
}

async function runWorkerOnce({ sandbox, messages }, data) {
  messages.length = 0;
  await sandbox.self.onmessage({ data });
  assert.ok(messages.length > 0, "worker should post at least one message");
  return messages[messages.length - 1];
}

async function testWasmExecutorMode() {
  const ctx = loadWorker();
  const res = await runWorkerOnce(ctx, {
    type: "execute",
    requestId: "wasm-exec",
    language: "wasm",
    executorMode: true,
    code: JSON.stringify({
      moduleBase64: WASM_ADD_BASE64,
      entry: "add",
      args: [2, 3],
    }),
  });

  assert.equal(res.success, true);
  assert.equal(res.result, 5);
}

async function testWasmTestMode() {
  const ctx = loadWorker();
  const res = await runWorkerOnce(ctx, {
    type: "execute",
    requestId: "wasm-test",
    language: "wasm",
    executorMode: false,
    code: JSON.stringify({
      moduleBase64: WASM_ADD_BASE64,
      entry: "add",
    }),
    testCases: [{ input: [4, 6], expected: 10 }],
  });

  assert.equal(res.success, true);
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].passed, true);
}

async function testWasiExecutorMode() {
  const ctx = loadWorker();
  const res = await runWorkerOnce(ctx, {
    type: "execute",
    requestId: "wasi-exec",
    language: "wasi",
    executorMode: true,
    code: JSON.stringify({
      runtimeBase64: WASI_STUB_BASE64,
      code: "print(\"hello\")",
    }),
  });

  assert.equal(res.success, true);
  assert.ok(typeof res.logs === "string");
}

async function testWasiTestMode() {
  const ctx = loadWorker();
  const res = await runWorkerOnce(ctx, {
    type: "execute",
    requestId: "wasi-test",
    language: "wasi",
    executorMode: false,
    code: JSON.stringify({
      runtimeBase64: WASI_STUB_BASE64,
      code: "print(\"hello\")",
    }),
    testCases: [{ input: { value: 1 }, expected: "" }],
  });

  assert.equal(res.success, true);
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].passed, true);
  assert.ok(typeof res.results[0].logs === "string");
}

async function testInvalidWasmConfig() {
  const ctx = loadWorker();
  const res = await runWorkerOnce(ctx, {
    type: "execute",
    requestId: "wasm-invalid",
    language: "wasm",
    executorMode: true,
    code: "{ not-json }",
  });

  assert.equal(res.success, false);
  assert.ok(res.error);
}

async function testMissingWasmModule() {
  const ctx = loadWorker();
  const res = await runWorkerOnce(ctx, {
    type: "execute",
    requestId: "wasm-missing",
    language: "wasm",
    executorMode: true,
    code: "{}",
  });

  assert.equal(res.success, false);
  assert.ok(res.error.includes("Missing module"));
}

async function testMissingWasiRuntime() {
  const ctx = loadWorker();
  const res = await runWorkerOnce(ctx, {
    type: "execute",
    requestId: "wasi-missing",
    language: "wasi",
    executorMode: true,
    code: "{}",
  });

  assert.equal(res.success, false);
  assert.ok(res.error.includes("missing module reference"));
}

async function main() {
  await testWasmExecutorMode();
  await testWasmTestMode();
  await testWasiExecutorMode();
  await testWasiTestMode();
  await testInvalidWasmConfig();
  await testMissingWasmModule();
  await testMissingWasiRuntime();
  console.log("WASM/WASI worker tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
