import path from "node:path";

export const IDENTITY_ANALYSIS_BUILD_ID = "__localcoder_worker_identity_analysis__";

const BUILD_ID_DEFINE = "__LOCALCODER_BUILD_ID__";
const workerDefinitions = Object.freeze([
  { workerKey: "javascript", identityKey: "buildId", entryPoint: "src/workers/javascript.worker.ts", logicalOutput: "public/js-worker.js", format: "iife" },
  { workerKey: "python", identityKey: "pythonBuildId", entryPoint: "src/workers/pyodide.worker.ts", logicalOutput: "public/python-worker.js", format: "iife" },
  { workerKey: "racket", identityKey: "racketBuildId", entryPoint: "src/workers/racket.worker.ts", logicalOutput: "public/racket-worker.js", format: "iife" },
  { workerKey: "rustpython", identityKey: "rustPythonBuildId", entryPoint: "src/workers/rustpython.worker.ts", logicalOutput: "public/rustpython-worker.js", format: "iife" },
  { workerKey: "haskell", identityKey: "haskellBuildId", entryPoint: "src/workers/haskell.worker.ts", logicalOutput: "public/haskell-worker.js", format: "esm" },
]);

function normalizeName(value) {
  return value.replaceAll("\\", "/");
}

function normalizedProjectPath(projectRoot, value, field) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Worker build plan ${field} must be a non-empty path`);
  const absolutePath = path.resolve(projectRoot, value);
  const relativePath = path.relative(projectRoot, absolutePath);
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error(`Worker build plan ${field} escapes the project root: ${value}`);
  }
  return normalizeName(relativePath);
}

function requiredText(value, field) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Worker build plan ${field} must be a non-empty string`);
  return value;
}

function expectedDefinition(candidate) {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Worker build plan must be a plain object");
  }
  const workerKey = candidate.workerKey;
  if (typeof workerKey !== "string") throw new Error("Worker build plan workerKey must be a string");
  const definition = workerDefinitions.find((item) => item.workerKey === workerKey);
  if (definition === undefined) throw new Error(`Worker build plan has an unsupported workerKey: ${workerKey}`);
  if (candidate.identityKey !== definition.identityKey) throw new Error(`Worker build plan identityKey does not match ${workerKey}`);
  return definition;
}

function canonicalPlan(projectRoot, candidate) {
  const definition = expectedDefinition(candidate);
  const entryPoint = normalizedProjectPath(projectRoot, candidate.entryPoint, "entryPoint");
  const logicalOutput = normalizedProjectPath(projectRoot, candidate.logicalOutput, "logicalOutput");
  if (!logicalOutput.startsWith("public/")) throw new Error("Worker build plan logicalOutput must be inside public/");
  if (candidate.bundle !== true) throw new Error("Worker build plan bundle must be true");
  if (!Array.isArray(candidate.nodePaths)) throw new Error("Worker build plan nodePaths must be an array");
  const nodePaths = candidate.nodePaths.map((nodePath) => normalizedProjectPath(projectRoot, nodePath, "nodePaths"));
  return Object.freeze({
    workerKey: definition.workerKey,
    identityKey: definition.identityKey,
    entryPoint,
    logicalOutput,
    bundle: true,
    format: requiredText(candidate.format, "format"),
    platform: requiredText(candidate.platform, "platform"),
    target: requiredText(candidate.target, "target"),
    legalComments: requiredText(candidate.legalComments, "legalComments"),
    nodePaths: Object.freeze(nodePaths),
    projectRoot,
  });
}

export function workerBuildPlans({ root } = {}) {
  const projectRoot = path.resolve(root);
  return workerDefinitions.map((definition) => canonicalPlan(projectRoot, {
    ...definition,
    bundle: true,
    platform: "browser",
    target: "es2020",
    legalComments: "none",
    nodePaths: ["node_modules"],
  }));
}

export function canonicalWorkerBuildPlans(root, plans) {
  const projectRoot = path.resolve(root);
  if (!Array.isArray(plans) || plans.length !== workerDefinitions.length) {
    throw new Error(`Worker build plan must contain exactly ${workerDefinitions.length} workers`);
  }
  const byWorkerKey = new Map();
  for (const plan of plans) {
    const canonical = canonicalPlan(projectRoot, plan);
    if (byWorkerKey.has(canonical.workerKey)) throw new Error(`Worker build plan is duplicated: ${canonical.workerKey}`);
    byWorkerKey.set(canonical.workerKey, canonical);
  }
  return workerDefinitions.map((definition) => {
    const plan = byWorkerKey.get(definition.workerKey);
    if (plan === undefined) throw new Error(`Worker build plan is missing: ${definition.workerKey}`);
    return plan;
  });
}

export function buildOptions(plan, buildId, analysis = false) {
  const options = {
    absWorkingDir: plan.projectRoot,
    entryPoints: [plan.entryPoint],
    outfile: path.join(plan.projectRoot, ...plan.logicalOutput.split("/")),
    bundle: plan.bundle,
    format: plan.format,
    platform: plan.platform,
    target: plan.target,
    legalComments: plan.legalComments,
    nodePaths: plan.nodePaths.map((nodePath) => path.join(plan.projectRoot, ...nodePath.split("/"))),
    define: { [BUILD_ID_DEFINE]: JSON.stringify(buildId) },
  };
  return analysis ? { ...options, write: false, metafile: true } : options;
}

export function buildPlanIdentityRecords(plan) {
  const record = (name, value) => ({ tag: "build-plan", name, bytes: Buffer.from(value) });
  return [
    record("absWorkingDir", "."),
    record("bundle", String(plan.bundle)),
    record("entryPoint", plan.entryPoint),
    record("format", plan.format),
    record("legalComments", plan.legalComments),
    record("logicalOutput", plan.logicalOutput),
    ...plan.nodePaths.map((nodePath, index) => record(`nodePaths/${index}`, nodePath)),
    record("platform", plan.platform),
    { tag: "build-plan/define", name: BUILD_ID_DEFINE, bytes: Buffer.from(JSON.stringify(IDENTITY_ANALYSIS_BUILD_ID)) },
    record("target", plan.target),
  ];
}

export function outputPathForWorkerPlan(plan) {
  return path.join(plan.projectRoot, ...plan.logicalOutput.split("/"));
}
