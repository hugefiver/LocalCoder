import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvedImportClosureRecords } from "./lib/worker-build-closure.mjs";
import {
  buildOptions,
  buildPlanIdentityRecords,
  canonicalWorkerBuildPlans,
  outputPathForWorkerPlan,
  workerBuildPlans as createWorkerBuildPlans,
} from "./lib/worker-build-plan.mjs";
import {
  esbuildIdentityRecords,
  haskellRuntimeIdentityRecords,
  javascriptRuntimeIdentityRecords,
  pyodideRuntimeIdentityRecords,
  racketRuntimeIdentityRecords,
  resolvedEsbuild,
  rustPythonRuntimeIdentityRecords,
  wasiShimIdentityRecords,
  workerBuildIdentity,
} from "./lib/worker-build-identity.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");

function plansForRoot(root, plans) {
  const projectRoot = path.resolve(root);
  return canonicalWorkerBuildPlans(projectRoot, plans ?? createWorkerBuildPlans({ root: projectRoot }));
}

function runtimeIdentityRecords(root, identityKey) {
  switch (identityKey) {
    case "buildId": return javascriptRuntimeIdentityRecords(root);
    case "pythonBuildId": return pyodideRuntimeIdentityRecords(root);
    case "racketBuildId": return racketRuntimeIdentityRecords(root);
    case "rustPythonBuildId": return rustPythonRuntimeIdentityRecords(root);
    case "haskellBuildId": return haskellRuntimeIdentityRecords(root);
    default: throw new Error(`Unsupported worker identity key: ${identityKey}`);
  }
}

function usesWasiShim(identityKey) {
  return identityKey === "rustPythonBuildId" || identityKey === "haskellBuildId";
}

async function analyzeWorkerBuildIds(projectRoot, plans, esbuild) {
  const builderRecords = esbuildIdentityRecords(projectRoot);
  const wasiRecords = wasiShimIdentityRecords(projectRoot);
  const buildIds = {};
  for (const plan of plans) {
    const records = [
      ...buildPlanIdentityRecords(plan),
      ...await resolvedImportClosureRecords(esbuild, plan),
      ...builderRecords,
      ...(usesWasiShim(plan.identityKey) ? wasiRecords : []),
      ...runtimeIdentityRecords(projectRoot, plan.identityKey),
    ];
    buildIds[plan.identityKey] = workerBuildIdentity(records);
  }
  return buildIds;
}

function workerPlanByIdentityKey(plans, identityKey) {
  const plan = plans.find((candidate) => candidate.identityKey === identityKey);
  if (plan === undefined) throw new Error(`Worker build plan is missing identity key: ${identityKey}`);
  return plan;
}

async function buildWorker(esbuild, plan, buildId) {
  fs.mkdirSync(path.dirname(outputPathForWorkerPlan(plan)), { recursive: true });
  await esbuild.build(buildOptions(plan, buildId));
}

export function workerBuildPlans({ root = defaultRoot } = {}) {
  return createWorkerBuildPlans({ root: path.resolve(root) });
}

export async function workerBuildIds({ root = defaultRoot, plans } = {}) {
  const projectRoot = path.resolve(root);
  const canonicalPlans = plansForRoot(projectRoot, plans);
  const esbuild = resolvedEsbuild(projectRoot);
  try {
    return await analyzeWorkerBuildIds(projectRoot, canonicalPlans, esbuild);
  } finally {
    esbuild.stop();
  }
}

export async function buildWorkerAssets({ root = defaultRoot, plans } = {}) {
  const projectRoot = path.resolve(root);
  const canonicalPlans = plansForRoot(projectRoot, plans);
  const esbuild = resolvedEsbuild(projectRoot);
  try {
    const buildIds = await analyzeWorkerBuildIds(projectRoot, canonicalPlans, esbuild);
    for (const plan of canonicalPlans) await buildWorker(esbuild, plan, buildIds[plan.identityKey]);
    const javascriptPlan = workerPlanByIdentityKey(canonicalPlans, "buildId");
    const pythonPlan = workerPlanByIdentityKey(canonicalPlans, "pythonBuildId");
    const racketPlan = workerPlanByIdentityKey(canonicalPlans, "racketBuildId");
    const rustPythonPlan = workerPlanByIdentityKey(canonicalPlans, "rustPythonBuildId");
    const haskellPlan = workerPlanByIdentityKey(canonicalPlans, "haskellBuildId");
    return {
      buildId: buildIds.buildId,
      outputPath: outputPathForWorkerPlan(javascriptPlan),
      pythonBuildId: buildIds.pythonBuildId,
      pythonOutputPath: outputPathForWorkerPlan(pythonPlan),
      racketBuildId: buildIds.racketBuildId,
      racketOutputPath: outputPathForWorkerPlan(racketPlan),
      rustPythonBuildId: buildIds.rustPythonBuildId,
      rustPythonOutputPath: outputPathForWorkerPlan(rustPythonPlan),
      haskellBuildId: buildIds.haskellBuildId,
      haskellOutputPath: outputPathForWorkerPlan(haskellPlan),
    };
  } finally {
    esbuild.stop();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const {
    buildId,
    outputPath,
    pythonBuildId,
    pythonOutputPath,
    racketBuildId,
    racketOutputPath,
    rustPythonBuildId,
    rustPythonOutputPath,
    haskellBuildId,
    haskellOutputPath,
  } = await buildWorkerAssets();
  console.log(`Built ${path.relative(defaultRoot, outputPath)} (${buildId})`);
  console.log(`Built ${path.relative(defaultRoot, pythonOutputPath)} (${pythonBuildId})`);
  console.log(`Built ${path.relative(defaultRoot, racketOutputPath)} (${racketBuildId})`);
  console.log(`Built ${path.relative(defaultRoot, rustPythonOutputPath)} (${rustPythonBuildId})`);
  console.log(`Built ${path.relative(defaultRoot, haskellOutputPath)} (${haskellBuildId})`);
}
