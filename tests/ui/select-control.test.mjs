import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);

const selectors = [
  {
    file: "src/features/problems/WorkspaceToolbar.tsx",
    controlledValue: 'value={snapshot.runtimeId ?? ""}',
    conditionalValue: /\{\.\.\.\(snapshot\.runtimeId === undefined \? \{\} : \{ value: snapshot\.runtimeId \}\)\}/u,
  },
  {
    file: "src/features/executor/ExecutorWorkspace.tsx",
    controlledValue: 'value={snapshot.runtimeId ?? ""}',
    conditionalValue: /\{\.\.\.\(snapshot\.runtimeId === undefined \? \{\} : \{ value: snapshot\.runtimeId \}\)\}/u,
  },
  {
    file: "src/features/runtimes/RuntimeSelector.tsx",
    controlledValue: 'value={value ?? ""}',
    conditionalValue: /\{\.\.\.\(value === undefined \? \{\} : \{ value \}\)\}/u,
  },
];

test("runtime selectors remain controlled before a runtime is selected", async () => {
  for (const { file, controlledValue, conditionalValue } of selectors) {
    const contents = await readFile(new URL(file, rootUrl), "utf8");

    assert.match(contents, new RegExp(controlledValue.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"), file);
    assert.doesNotMatch(contents, conditionalValue, file);
    assert.doesNotMatch(contents, /<SelectItem[^>]*\bvalue=""/u, file);
  }
});
