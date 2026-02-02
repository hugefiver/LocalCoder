import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

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

function tryExec(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...(opts.env ?? {}) },
    shell: process.platform === "win32",
  });
  return res.status === 0;
}

function resolveOnPath(name) {
  const res = spawnSync("which", [name], { encoding: "utf8" });
  if (res.status === 0 && res.stdout) {
    const out = res.stdout.trim();
    return out.length > 0 ? out : null;
  }
  return null;
}

function resolveExecutable(explicit, fallbackName, extraCandidates = []) {
  if (explicit) {
    if (fs.existsSync(explicit)) return explicit;
    const resolved = resolveOnPath(explicit);
    if (resolved) return resolved;
    throw new Error(`Cannot find executable: ${explicit}`);
  }
  for (const candidate of extraCandidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  const onPath = resolveOnPath(fallbackName);
  return onPath;
}

function isGhcSourceRoot(p) {
  return Boolean(p && fs.existsSync(path.join(p, "ghc", "Main.hs")));
}

function findGhcSourceRoot() {
  const candidates = [
    process.env.GHC_WASM_SRC,
    process.env.GHC_SRC,
    process.env.GHC_SOURCE,
    path.resolve(root, "..", "ghc", "ghc"),
    path.resolve(root, "..", "ghc"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (isGhcSourceRoot(candidate)) return candidate;
  }
  return null;
}

function versionCandidates(version) {
  if (!version) return [];
  const parts = version.split(".");
  const major = parts[0] ?? "";
  const minor = parts[1] ?? "";
  const patch = parts[2] ?? "";
  const majorMinor = major && minor ? `${major}.${minor}` : null;
  const majorMinorPatch =
    major && minor && patch ? `${major}.${minor}.${patch}` : null;

  const out = [];
  out.push(`ghc-${version}`);
  if (majorMinorPatch) out.push(`ghc-${majorMinorPatch}`);
  if (majorMinor) out.push(`ghc-${majorMinor}`);
  return out;
}

function cloneGhcSource(
  targetDir,
  { compilerVersion, gitRef, useVersionCandidates },
) {
  const gitBin = resolveOnPath("git");
  if (!gitBin) {
    throw new Error("git not found in PATH; cannot auto-clone GHC source.");
  }

  if (fs.existsSync(targetDir)) {
    throw new Error(
      `Auto-clone target already exists: ${targetDir}. Set GHC_WASM_SRC to an existing repo or remove the directory.`,
    );
  }

  const repoUrl =
    process.env.GHC_WASM_GIT_URL ?? "https://gitlab.haskell.org/ghc/ghc.git";
  const refs = useVersionCandidates ? versionCandidates(compilerVersion) : [];

  ensureDir(path.dirname(targetDir));

  if (gitRef) {
    console.log(`Auto-cloning GHC (${gitRef}) to ${targetDir}...`);
    if (
      tryExec("git", [
        "clone",
        "--depth",
        "1",
        "--filter=blob:none",
        "--branch",
        gitRef,
        repoUrl,
        targetDir,
      ])
    ) {
      return;
    }
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    throw new Error(`Failed to clone GHC ref ${gitRef} from ${repoUrl}`);
  }

  for (const ref of refs) {
    console.log(`Auto-cloning GHC (${ref}) to ${targetDir}...`);
    if (
      tryExec("git", [
        "clone",
        "--depth",
        "1",
        "--filter=blob:none",
        "--branch",
        ref,
        repoUrl,
        targetDir,
      ])
    ) {
      return;
    }
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  }

  console.log(`Auto-cloning GHC (default branch) to ${targetDir}...`);
  if (
    tryExec("git", [
      "clone",
      "--depth",
      "1",
      "--filter=blob:none",
      repoUrl,
      targetDir,
    ])
  ) {
    return;
  }

  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  throw new Error(`Failed to clone GHC source from ${repoUrl}`);
}

function ensureGhcSourceRoot(compilerVersion, options = {}) {
  const existing = findGhcSourceRoot();
  if (existing) return existing;

  const { gitRef, useVersionCandidates } = options;
  const requested = process.env.GHC_WASM_SRC || process.env.GHC_SRC;
  const targetDir =
    requested ??
    process.env.GHC_WASM_CLONE_DIR ??
    path.join(root, ".cache", "ghc");

  cloneGhcSource(targetDir, { compilerVersion, gitRef, useVersionCandidates });

  if (!isGhcSourceRoot(targetDir)) {
    throw new Error(
      `Cloned repo does not contain ghc/Main.hs: ${targetDir}. Set GHC_WASM_SRC to a valid GHC source root.`,
    );
  }
  return targetDir;
}

function getLibdir(wasmGhcExe) {
  const res = spawnSync(wasmGhcExe, ["--print-libdir"], {
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (res.status !== 0 || !res.stdout) return null;
  const out = res.stdout.trim();
  return out.length > 0 ? out : null;
}

function readFileIfExists(p) {
  try {
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  } catch {
    return null;
  }
}

function parseVersionFromConfigureAc(text) {
  if (!text) return null;
  const m = text.match(/AC_INIT\(\[[^\]]+\],\s*\[([^\]]+)\]/);
  return m?.[1] ?? null;
}

function parseVersionFromCabal(text) {
  if (!text) return null;
  const m = text.match(/^Version:\s*([0-9][^\s]*)/m);
  if (!m) return null;
  const v = m[1].trim();
  return v.includes("@") ? null : v;
}

function getSourceVersion(ghcSrc) {
  const configureAc = readFileIfExists(path.join(ghcSrc, "configure.ac"));
  const fromConfigure = parseVersionFromConfigureAc(configureAc);
  if (fromConfigure) return fromConfigure;

  const cabalPath = path.join(ghcSrc, "ghc", "ghc-bin.cabal");
  const cabalInPath = path.join(ghcSrc, "ghc", "ghc-bin.cabal.in");
  return (
    parseVersionFromCabal(readFileIfExists(cabalPath)) ||
    parseVersionFromCabal(readFileIfExists(cabalInPath))
  );
}

function getCompilerNumericVersion(wasmGhcExe) {
  const res = spawnSync(wasmGhcExe, ["--numeric-version"], {
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (res.status !== 0 || !res.stdout) return null;
  const out = res.stdout.trim();
  return out.length > 0 ? out : null;
}

function parseMajorMinor(version) {
  if (!version) return null;
  const parts = version.split(".");
  if (parts.length < 2) return null;
  return `${parts[0]}.${parts[1]}`;
}

function ensureVersionCompatible(ghcSrc, wasmGhcExe) {
  if (process.env.GHC_WASM_SKIP_VERSION_CHECK === "1") return;
  const sourceVersion = getSourceVersion(ghcSrc);
  const compilerVersion = getCompilerNumericVersion(wasmGhcExe);
  if (!sourceVersion || !compilerVersion) return;

  const srcMM = parseMajorMinor(sourceVersion);
  const compMM = parseMajorMinor(compilerVersion);
  if (srcMM && compMM && srcMM !== compMM) {
    throw new Error(
      `GHC source (${sourceVersion}) does not match wasm32-wasi-ghc (${compilerVersion}). ` +
        `Use a matching GHC source checkout (e.g. tag ghc-${compilerVersion}) ` +
        `or set GHC_WASM_SRC to that version. ` +
        `Set GHC_WASM_SKIP_VERSION_CHECK=1 to bypass.`,
    );
  }
}

function main() {
  const gitRef = process.env.GHC_WASM_GIT_REF ?? process.env.GHC_WASM_REF;
  const useVersionCandidates = process.env.GHC_WASM_USE_VERSION === "1";
  const enforceVersion =
    process.env.GHC_WASM_ENFORCE_VERSION === "1" || useVersionCandidates;
  const skipVersionCheck = process.env.GHC_WASM_SKIP_VERSION_CHECK === "1";
  const ghcMetaHome =
    process.env.GHC_WASM_META_HOME ?? path.join(os.homedir(), ".ghc-wasm");
  const ghcMetaExe = path.join(
    ghcMetaHome,
    "wasm32-wasi-ghc",
    "bin",
    "wasm32-wasi-ghc",
  );

  const wasmGhcExe = resolveExecutable(
    process.env.WASM_GHC_EXE,
    "wasm32-wasi-ghc",
    [ghcMetaExe],
  );

  if (!wasmGhcExe) {
    throw new Error(
      "wasm32-wasi-ghc not found. Install the GHC wasm backend via ghc-wasm-meta and ensure it is on PATH.",
    );
  }

  const compilerVersion = getCompilerNumericVersion(wasmGhcExe);
  const ghcSrc = ensureGhcSourceRoot(compilerVersion, {
    gitRef,
    useVersionCandidates,
  });

  if (enforceVersion && !skipVersionCheck) {
    ensureVersionCompatible(ghcSrc, wasmGhcExe);
  }

  const libdir = getLibdir(wasmGhcExe);
  if (!libdir || !fs.existsSync(libdir)) {
    throw new Error(
      `Failed to resolve libdir from ${wasmGhcExe}. Ensure the GHC wasm backend is installed correctly.`,
    );
  }

  const packageDb = path.join(libdir, "package.conf.d");
  if (!fs.existsSync(packageDb)) {
    throw new Error(`Missing package DB: ${packageDb}`);
  }

  const distDir =
    process.env.GHC_WASM_DIST ??
    path.join(root, "runtimes", "haskell-ghc", "dist");
  const outWasm = path.join(distDir, "ghc.wasm");
  const outLibdir = path.join(distDir, "libdir.tar");

  ensureDir(distDir);

  const ghcDir = path.join(ghcSrc, "ghc");
  if (!fs.existsSync(path.join(ghcDir, "Main.hs"))) {
    throw new Error(
      `Missing ghc/Main.hs under ${ghcSrc}. Ensure GHC_WASM_SRC points to the GHC repo root.`,
    );
  }

  console.log("Building ghc.wasm...");

  const ghcArgs = [
    "-i.",
    "-package",
    "ghc",
    "-package",
    "ghc-boot",
    "-package",
    "base",
    "-package",
    "array",
    "-package",
    "bytestring",
    "-package",
    "directory",
    "-package",
    "process",
    "-package",
    "filepath",
    "-package",
    "containers",
    "-package",
    "transformers",
    "-package",
    "unix",
    "-Wall",
    "-Wnoncanonical-monad-instances",
    "-Wnoncanonical-monoid-instances",
    "-rtsopts=all",
    "-with-rtsopts=-K512M -H -I5 -T",
    "-XLambdaCase",
    "-o",
    outWasm,
    "Main.hs",
  ];

  exec(wasmGhcExe, ghcArgs, {
    cwd: ghcDir,
    env: {
      ...process.env,
      GHC_PACKAGE_PATH: packageDb,
    },
  });

  if (!fs.existsSync(outWasm)) {
    throw new Error(`Failed to produce ghc.wasm at ${outWasm}`);
  }

  console.log("Packing libdir.tar...");
  exec("tar", ["-cf", outLibdir, "-C", libdir, "."]);

  if (!fs.existsSync(outLibdir)) {
    throw new Error(`Failed to produce libdir.tar at ${outLibdir}`);
  }

  console.log("Done.");
  console.log(`  ghc.wasm:   ${outWasm}`);
  console.log(`  libdir.tar: ${outLibdir}`);

  if (process.env.GHC_WASM_SKIP_PACK !== "1") {
    console.log("Packing runtime assets into public/haskell...");
    exec("node", ["scripts/build-runtimes.mjs"], {
      cwd: root,
      env: {
        ...process.env,
        RUNTIME_TARGETS: "haskell",
      },
    });
    console.log("Release assets are ready under public/haskell/.");
  } else {
    console.log("Skipped runtime packaging (GHC_WASM_SKIP_PACK=1).");
  }
}

try {
  main();
} catch (err) {
  console.error(err?.message ?? String(err));
  process.exit(1);
}
