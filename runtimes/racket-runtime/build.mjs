import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const srcDir = path.join(root, "racket-src");
const distDir = path.join(root, "dist");

function exec(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...(opts.env ?? {}) },
    shell: process.platform === "win32",
  });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${res.status})`);
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

if (!fs.existsSync(srcDir)) {
  throw new Error(
    "Missing racket-src. Clone official Racket sources into runtimes/racket-runtime/racket-src before building.",
  );
}

ensureDir(distDir);

// Configure & build Racket with Emscripten (interpreter mode)
exec("./configure", [
  "--disable-jit",
  "--disable-pthread",
  "--disable-futures",
  "--disable-places",
], { cwd: srcDir });

exec("emmake", ["make"], { cwd: srcDir });

const candidateBinaries = [
  process.env.RACKET_EMCC_INPUT,
  path.join(srcDir, "src", "racketcgc"),
  path.join(srcDir, "src", "racket3m"),
  path.join(srcDir, "src", "racket"),
].filter(Boolean);

const inputBinary = candidateBinaries.find((p) => fs.existsSync(p));
if (!inputBinary) {
  throw new Error(
    "Unable to find Racket binary for emcc. Set RACKET_EMCC_INPUT to the built binary path.",
  );
}

const outJs = path.join(distDir, "racket.js");

exec("emcc", [
  "-O2",
  "-s", "WASM=1",
  "-s", "MODULARIZE=0",
  "-s", "ENVIRONMENT=web,worker",
  "-s", "ALLOW_MEMORY_GROWTH=1",
  "-o", outJs,
  inputBinary,
], { cwd: srcDir });

if (!fs.existsSync(outJs)) {
  throw new Error("Racket emcc output missing: dist/racket.js");
}

const outWasm = path.join(distDir, "racket.wasm");
if (!fs.existsSync(outWasm)) {
  throw new Error("Racket emcc output missing: dist/racket.wasm");
}
