import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflows = new Map([
  [
    ".github/workflows/build-executors.yml",
    [
      "actions/checkout@v7.0.1",
      "actions/setup-node@v7.0.0",
    ],
  ],
  [
    ".github/workflows/deploy-gh-pages.yml",
    [
      "actions/checkout@v7.0.1",
      "actions/setup-node@v7.0.0",
      "actions/configure-pages@v6.0.0",
      "actions/upload-pages-artifact@v5.0.0",
      "actions/deploy-pages@v5.0.0",
    ],
  ],
]);

const orderedSteps = [
  "run: npm ci",
  "run: node scripts/copy-typescript-asset.mjs",
  "run: node scripts/setup-pyodide.js --skip-typescript",
  "run: node scripts/build-worker-assets.mjs",
  "run: node scripts/generate-runtime-manifest.mjs",
  "run: node scripts/report-runtime-capabilities.mjs --github-summary",
];

function runSteps(source) {
  return [...source.matchAll(/^\s{8}run:\s+(.+)$/gm)].map((match) => match[1]);
}

function actionUses(source) {
  return [...source.matchAll(/^\s{8}uses:\s+(\S+)\s*$/gm)].map((match) => match[1]);
}

for (const [workflow, expectedActions] of workflows) {
  test(`${workflow} prepares runtime inputs before building workers`, () => {
    const source = readFileSync(workflow, "utf8");
    const commands = runSteps(source);
    let previous = -1;

    for (const step of orderedSteps) {
      const command = step.slice("run: ".length);
      const position = commands.indexOf(command);
      assert.notEqual(position, -1, `${workflow} is missing ${command}`);
      assert.ok(position > previous, `${step} is out of order in ${workflow}`);
      previous = position;
    }
  });

  test(`${workflow} pins every GitHub Action to the current stable release`, () => {
    const source = readFileSync(workflow, "utf8");
    assert.deepEqual(actionUses(source), expectedActions);
    assert.match(source, /^\s{10}node-version:\s+24\s*$/m);
  });
}
