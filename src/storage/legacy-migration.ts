import { validateJsonValue } from "../domain/json-value.js";
import type { LanguageId, RuntimeId } from "../domain/language.js";
import type { ProblemCase } from "../domain/problem.js";
import { MAX_CASE_COUNT } from "../runtime/protocol.js";
import type { DraftRecord, LegacyImportBatch, ProgressRecord, SettingsRecord } from "./schema.js";
import type { LocalCoderRepository } from "./repository.js";

const MAX_CASE_VALUE_BYTES = 65_536;
const MAX_SOURCE_BYTES = 262_144;
const encoder = new TextEncoder();

interface LegacyLanguage {
  languageId: LanguageId;
  runtimeId: RuntimeId;
}

const LEGACY_LANGUAGES: Readonly<Record<string, LegacyLanguage>> = {
  javascript: { languageId: "javascript", runtimeId: "javascript-worker" },
  typescript: { languageId: "typescript", runtimeId: "typescript-official" },
  python: { languageId: "python", runtimeId: "python-pyodide" },
  rustpython: { languageId: "python", runtimeId: "python-rustpython" },
  racket: { languageId: "racket", runtimeId: "racket-wasm" },
  haskell: { languageId: "haskell", runtimeId: "haskell-ghc-wasi" },
};

export async function runLegacyMigration(options: {
  repository: LocalCoderRepository;
  legacy: Pick<Storage, "getItem" | "key" | "length">;
  now: () => number;
}): Promise<{ state: "migrated" | "already-migrated"; imported: number }> {
  const timestamp = options.now();
  const batch = readLegacyBatch(options.legacy, timestamp);
  const state = await options.repository.importLegacyState(batch);
  return { state, imported: state === "migrated" ? countImported(batch) : 0 };
}

function readLegacyBatch(legacy: Pick<Storage, "getItem" | "key" | "length">, timestamp: number): LegacyImportBatch {
  const drafts: DraftRecord[] = [];
  const customCases: Array<LegacyImportBatch["customCases"][number]> = [];
  const progressByProblem = new Map<number, ProgressRecord>();
  const preferences: Partial<Record<LanguageId, RuntimeId>> = {};
  const keys = readKeys(legacy);

  for (const key of keys) {
    const raw = safeGet(legacy, key);
    if (raw === undefined) continue;
    const problemLanguage = /^problem-(\d+)-language$/.exec(key);
    if (problemLanguage !== null) {
      const language = parseLegacyLanguage(parseJson(raw));
      if (language !== undefined) preferences[language.languageId] = language.runtimeId;
      continue;
    }
    const problemCode = /^problem-(\d+)-code-([a-z]+)$/.exec(key);
    if (problemCode !== null) {
      const problemId = parseProblemId(problemCode[1]);
      const language = parseLegacyLanguage(problemCode[2]);
      const source = parseSource(parseJson(raw));
      if (problemId !== undefined && language !== undefined && source !== undefined) {
        drafts.push({ workspaceId: `problem:${problemId}`, ...language, source, updatedAt: timestamp });
      }
      continue;
    }
    const problemCases = /^problem-(\d+)-custom-tests$/.exec(key);
    if (problemCases !== null) {
      const problemId = parseProblemId(problemCases[1]);
      const cases = parseCases(parseJson(raw));
      if (problemId !== undefined && cases !== undefined) {
        customCases.push({ problemId, cases, updatedAt: timestamp });
      }
      continue;
    }
    if (key === "executor-language") {
      const language = parseLegacyLanguage(parseJson(raw));
      if (language !== undefined) preferences[language.languageId] = language.runtimeId;
      continue;
    }
    const executorCode = /^executor-code-([a-z]+)$/.exec(key);
    if (executorCode !== null) {
      const language = parseLegacyLanguage(executorCode[1]);
      const source = parseSource(parseJson(raw));
      if (language !== undefined && source !== undefined) {
        drafts.push({ workspaceId: "executor", ...language, source, updatedAt: timestamp });
      }
      continue;
    }
    if (key === "solved-problems") {
      const solvedProblems = parseSolvedProblems(parseJson(raw));
      for (const problemId of solvedProblems) {
        progressByProblem.set(problemId, {
          problemId,
          attempts: 1,
          lastAttemptAt: timestamp,
          acceptedAt: timestamp,
        });
      }
    }
  }

  const settings = Object.keys(preferences).length === 0 ? undefined : defaultSettings(preferences, timestamp);
  return {
    drafts: dedupeDrafts(drafts),
    customCases: dedupeCustomCases(customCases),
    ...(settings === undefined ? {} : { settings }),
    progress: [...progressByProblem.values()].sort((left, right) => left.problemId - right.problemId),
    migrationVersion: 1,
  };
}

function readKeys(legacy: Pick<Storage, "key" | "length">): readonly string[] {
  const keys = new Set<string>();
  for (let index = 0; index < legacy.length; index += 1) {
    try {
      const key = legacy.key(index);
      if (key !== null) keys.add(key);
    } catch {
      // A hostile or unavailable legacy adapter should only skip its unreadable key.
    }
  }
  return [...keys].sort();
}

function safeGet(legacy: Pick<Storage, "getItem">, key: string): string | undefined {
  try {
    return legacy.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function parseJson(raw: string): unknown | undefined {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function parseLegacyLanguage(value: unknown): LegacyLanguage | undefined {
  return typeof value === "string" ? LEGACY_LANGUAGES[value] : undefined;
}

function parseProblemId(value: string | undefined): number | undefined {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return undefined;
  const problemId = Number(value);
  return Number.isSafeInteger(problemId) ? problemId : undefined;
}

function parseSource(value: unknown): string | undefined {
  if (typeof value !== "string" || encoder.encode(value).byteLength > MAX_SOURCE_BYTES) return undefined;
  return value;
}

function parseCases(value: unknown): readonly ProblemCase[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_CASE_COUNT) return undefined;
  const cases: ProblemCase[] = [];
  for (const item of value) {
    const parsed = parseCase(item);
    if (parsed === undefined) return undefined;
    cases.push(parsed);
  }
  return cases;
}

function parseCase(value: unknown): ProblemCase | undefined {
  if (!isPlainRecord(value) || !hasExactFields(value, ["input", "expected"])) return undefined;
  const input = validateJsonValue(value.input, { maxBytes: MAX_CASE_VALUE_BYTES });
  const expected = validateJsonValue(value.expected, { maxBytes: MAX_CASE_VALUE_BYTES });
  if (!input.ok || !expected.ok) return undefined;
  return { input: input.value, expected: expected.value };
}

function parseSolvedProblems(value: unknown): readonly number[] {
  if (!Array.isArray(value)) return [];
  const solved = new Set<number>();
  for (const item of value) {
    if (typeof item === "number" && Number.isSafeInteger(item) && item > 0) solved.add(item);
  }
  return [...solved].sort((left, right) => left - right);
}

function defaultSettings(preferredRuntimeByLanguage: Partial<Record<LanguageId, RuntimeId>>, timestamp: number): SettingsRecord {
  return {
    key: "app",
    theme: "system",
    preferredRuntimeByLanguage,
    layout: { desktopProblemPercent: 50, tabletTab: "problem" },
    updatedAt: timestamp,
  };
}

function dedupeDrafts(drafts: readonly DraftRecord[]): readonly DraftRecord[] {
  const byKey = new Map<string, DraftRecord>();
  for (const draft of drafts) byKey.set(`${draft.workspaceId}\u0000${draft.languageId}\u0000${draft.runtimeId}`, draft);
  return [...byKey.values()].sort((left, right) => (
    left.workspaceId.localeCompare(right.workspaceId)
    || left.languageId.localeCompare(right.languageId)
    || left.runtimeId.localeCompare(right.runtimeId)
  ));
}

function dedupeCustomCases(records: LegacyImportBatch["customCases"]): LegacyImportBatch["customCases"] {
  const byProblem = new Map<number, LegacyImportBatch["customCases"][number]>();
  for (const record of records) byProblem.set(record.problemId, record);
  return [...byProblem.values()].sort((left, right) => left.problemId - right.problemId);
}

function countImported(batch: LegacyImportBatch): number {
  return batch.drafts.length + batch.customCases.length + batch.progress.length + (batch.settings === undefined ? 0 : 1);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactFields(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(record);
  if (keys.length !== expected.length || keys.some((key) => typeof key !== "string" || !expected.includes(key))) return false;
  return expected.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor !== undefined && "value" in descriptor;
  });
}
