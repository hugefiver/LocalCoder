import type { LanguageId, RuntimeId } from "../domain/language.js";
import type { ProblemCase } from "../domain/problem.js";
import { MAX_CASE_COUNT, MAX_OUTPUT_BYTES, MAX_SOURCE_BYTES } from "../runtime/protocol.js";
import type {
  AtomicSubmissionWrite,
  CaseCountSummary,
  CustomCasesRecord,
  DraftRecord,
  LegacyImportBatch,
  LegacyMigrationMarker,
  ProgressRecord,
  ProgressUpdate,
  SettingsRecord,
  SubmissionQuery,
  SubmissionRecord,
} from "./schema.js";
import {
  assertRuntimeLanguage,
  field,
  hasField,
  MAX_IDENTIFIER_BYTES,
  parseArray,
  parseFiniteNonnegative,
  parseJson,
  parseLanguageId,
  parseNonnegativeInteger,
  parsePlainRecord,
  parsePositiveInteger,
  parseProblemId,
  parseRecord,
  parseRuntimeId,
  parseText,
  parseVerdict,
} from "./validation.js";

export const SUBMISSION_HISTORY_LIMIT = 200;
const encoder = new TextEncoder();

export function parseDraft(value: unknown, path: string): DraftRecord {
  const record = parseRecord(value, path, ["workspaceId", "languageId", "runtimeId", "source", "updatedAt"]);
  const languageId = parseLanguageId(field(record, "languageId", path), `${path}.languageId`);
  const runtimeId = parseRuntimeId(field(record, "runtimeId", path), `${path}.runtimeId`);
  assertRuntimeLanguage(languageId, runtimeId, path);
  return {
    workspaceId: parseText(field(record, "workspaceId", path), `${path}.workspaceId`, MAX_IDENTIFIER_BYTES, true),
    languageId,
    runtimeId,
    source: parseText(field(record, "source", path), `${path}.source`, MAX_SOURCE_BYTES),
    updatedAt: parseFiniteNonnegative(field(record, "updatedAt", path), `${path}.updatedAt`),
  };
}

export function parseCustomCasesRecord(value: unknown, path: string): CustomCasesRecord {
  const record = parseRecord(value, path, ["problemId", "cases", "updatedAt"]);
  return {
    problemId: parseProblemId(field(record, "problemId", path), `${path}.problemId`),
    cases: parseCustomCases(field(record, "cases", path), `${path}.cases`),
    updatedAt: parseFiniteNonnegative(field(record, "updatedAt", path), `${path}.updatedAt`),
  };
}

export function parseSettings(value: unknown, path: string): SettingsRecord {
  const record = parseRecord(value, path, ["key", "theme", "preferredRuntimeByLanguage", "layout", "updatedAt"]);
  if (field(record, "key", path) !== "app") throw new TypeError(`${path}.key: must be app`);
  const theme = field(record, "theme", path);
  if (theme !== "light" && theme !== "dark" && theme !== "system") {
    throw new TypeError(`${path}.theme: must be light, dark, or system`);
  }
  const layoutRecord = parseRecord(field(record, "layout", path), `${path}.layout`, ["desktopProblemPercent", "tabletTab"]);
  const desktopProblemPercent = parseFiniteNonnegative(
    field(layoutRecord, "desktopProblemPercent", `${path}.layout`),
    `${path}.layout.desktopProblemPercent`,
  );
  if (desktopProblemPercent > 100) throw new TypeError(`${path}.layout.desktopProblemPercent: must not exceed 100`);
  const tabletTab = field(layoutRecord, "tabletTab", `${path}.layout`);
  if (tabletTab !== "problem" && tabletTab !== "code") throw new TypeError(`${path}.layout.tabletTab: must be problem or code`);
  return {
    key: "app",
    theme,
    preferredRuntimeByLanguage: parseRuntimePreferences(field(record, "preferredRuntimeByLanguage", path), `${path}.preferredRuntimeByLanguage`),
    layout: { desktopProblemPercent, tabletTab },
    updatedAt: parseFiniteNonnegative(field(record, "updatedAt", path), `${path}.updatedAt`),
  };
}

export function parseProgress(value: unknown, path: string): ProgressRecord {
  const record = parseRecord(value, path, ["problemId", "attempts", "lastAttemptAt"], ["acceptedAt", "acceptedLanguageId", "acceptedRuntimeId"]);
  const result: ProgressRecord = {
    problemId: parseProblemId(field(record, "problemId", path), `${path}.problemId`),
    attempts: parseNonnegativeInteger(field(record, "attempts", path), `${path}.attempts`),
    lastAttemptAt: parseFiniteNonnegative(field(record, "lastAttemptAt", path), `${path}.lastAttemptAt`),
  };
  if (hasField(record, "acceptedAt")) result.acceptedAt = parseFiniteNonnegative(field(record, "acceptedAt", path), `${path}.acceptedAt`);
  if (hasField(record, "acceptedLanguageId")) result.acceptedLanguageId = parseLanguageId(field(record, "acceptedLanguageId", path), `${path}.acceptedLanguageId`);
  if (hasField(record, "acceptedRuntimeId")) result.acceptedRuntimeId = parseRuntimeId(field(record, "acceptedRuntimeId", path), `${path}.acceptedRuntimeId`);
  if (result.acceptedLanguageId !== undefined && result.acceptedRuntimeId !== undefined) {
    assertRuntimeLanguage(result.acceptedLanguageId, result.acceptedRuntimeId, path);
  }
  return result;
}

export function parseProgressUpdate(value: unknown, path: string): ProgressUpdate {
  const record = parseRecord(value, path, ["problemId", "attemptedAt"], ["accepted"]);
  const result: ProgressUpdate = {
    problemId: parseProblemId(field(record, "problemId", path), `${path}.problemId`),
    attemptedAt: parseFiniteNonnegative(field(record, "attemptedAt", path), `${path}.attemptedAt`),
  };
  if (hasField(record, "accepted")) {
    result.accepted = parseAcceptedMetadata(field(record, "accepted", path), `${path}.accepted`);
  }
  return result;
}

export function parseAtomicSubmissionWrite(value: unknown): AtomicSubmissionWrite {
  const record = parseRecord(value, "submission write", ["submission"], ["progressUpdate"]);
  const result: AtomicSubmissionWrite = {
    submission: parseSubmission(field(record, "submission", "submission write"), "submission", false),
  };
  if (hasField(record, "progressUpdate")) {
    result.progressUpdate = parseProgressUpdate(field(record, "progressUpdate", "submission write"), "progressUpdate");
  }
  return result;
}

export function parseSubmission(value: unknown, path: string, allowId: boolean): SubmissionRecord {
  const record = parseRecord(value, path, ["problemId", "languageId", "runtimeId", "runtimeVersion", "buildId", "source", "verdict", "elapsedMs", "caseSummary", "output", "createdAt"], allowId ? ["id"] : []);
  const languageId = parseLanguageId(field(record, "languageId", path), `${path}.languageId`);
  const runtimeId = parseRuntimeId(field(record, "runtimeId", path), `${path}.runtimeId`);
  assertRuntimeLanguage(languageId, runtimeId, path);
  const result: SubmissionRecord = {
    problemId: parseProblemId(field(record, "problemId", path), `${path}.problemId`),
    languageId,
    runtimeId,
    runtimeVersion: parseText(field(record, "runtimeVersion", path), `${path}.runtimeVersion`, MAX_IDENTIFIER_BYTES, true),
    buildId: parseText(field(record, "buildId", path), `${path}.buildId`, MAX_IDENTIFIER_BYTES, true),
    source: parseText(field(record, "source", path), `${path}.source`, MAX_SOURCE_BYTES),
    verdict: parseVerdict(field(record, "verdict", path), `${path}.verdict`),
    elapsedMs: parseFiniteNonnegative(field(record, "elapsedMs", path), `${path}.elapsedMs`),
    caseSummary: parseCaseSummary(field(record, "caseSummary", path), `${path}.caseSummary`),
    output: parseOutput(field(record, "output", path), `${path}.output`),
    createdAt: parseFiniteNonnegative(field(record, "createdAt", path), `${path}.createdAt`),
  };
  if (hasField(record, "id")) result.id = parsePositiveInteger(field(record, "id", path), `${path}.id`);
  return result;
}

export function parseSubmissionQuery(value: unknown): SubmissionQuery {
  if (value === undefined) return {};
  const record = parseRecord(value, "query", [], ["problemId", "runtimeId", "verdicts", "limit"]);
  const result: SubmissionQuery = {};
  if (hasField(record, "problemId")) result.problemId = parseProblemId(field(record, "problemId", "query"), "query.problemId");
  if (hasField(record, "runtimeId")) result.runtimeId = parseRuntimeId(field(record, "runtimeId", "query"), "query.runtimeId");
  if (hasField(record, "verdicts")) {
    result.verdicts = parseArray(field(record, "verdicts", "query"), "query.verdicts")
      .map((verdict, index) => parseVerdict(verdict, `query.verdicts[${index}]`));
  }
  if (hasField(record, "limit")) result.limit = parsePositiveInteger(field(record, "limit", "query"), "query.limit", SUBMISSION_HISTORY_LIMIT);
  return result;
}

export function parseLegacyImportBatch(value: unknown): LegacyImportBatch {
  const record = parseRecord(value, "legacy import", ["drafts", "customCases", "progress", "migrationVersion"], ["settings"]);
  if (field(record, "migrationVersion", "legacy import") !== 1) throw new TypeError("legacy import.migrationVersion: must be 1");
  const drafts = parseArray(field(record, "drafts", "legacy import"), "legacy import.drafts").map((item, index) => parseDraft(item, `legacy import.drafts[${index}]`));
  const customCases = parseArray(field(record, "customCases", "legacy import"), "legacy import.customCases").map((item, index) => parseCustomCasesRecord(item, `legacy import.customCases[${index}]`));
  const progress = parseArray(field(record, "progress", "legacy import"), "legacy import.progress").map((item, index) => parseProgress(item, `legacy import.progress[${index}]`));
  const result: LegacyImportBatch = { drafts, customCases, progress, migrationVersion: 1 };
  if (hasField(record, "settings")) result.settings = parseSettings(field(record, "settings", "legacy import"), "legacy import.settings");
  return result;
}

export function parseLegacyMigrationMarker(value: unknown): LegacyMigrationMarker {
  const record = parseRecord(value, "legacy migration marker", ["key", "value"]);
  if (field(record, "key", "legacy migration marker") !== "legacyMigrationVersion") {
    throw new TypeError("legacy migration marker.key: must be legacyMigrationVersion");
  }
  if (field(record, "value", "legacy migration marker") !== 1) throw new TypeError("legacy migration marker.value: must be 1");
  return { key: "legacyMigrationVersion", value: 1 };
}

export function defaultSettings(now: number): SettingsRecord {
  return {
    key: "app",
    theme: "system",
    preferredRuntimeByLanguage: {},
    layout: { desktopProblemPercent: 50, tabletTab: "problem" },
    updatedAt: parseFiniteNonnegative(now, "settings.updatedAt"),
  };
}

function parseCustomCases(value: unknown, path: string): readonly ProblemCase[] {
  const cases = parseArray(value, path);
  if (cases.length > MAX_CASE_COUNT) throw new TypeError(`${path}: must contain at most ${MAX_CASE_COUNT} cases`);
  return cases.map((item, index) => {
    const record = parseRecord(item, `${path}[${index}]`, ["input", "expected"]);
    return { input: parseJson(field(record, "input", path), `${path}[${index}].input`), expected: parseJson(field(record, "expected", path), `${path}[${index}].expected`) };
  });
}

function parseRuntimePreferences(value: unknown, path: string): Partial<Record<LanguageId, RuntimeId>> {
  const record = parsePlainRecord(value, path);
  const result: Partial<Record<LanguageId, RuntimeId>> = {};
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string") throw new TypeError(`${path}: contains a non-string property`);
    const languageId = parseLanguageId(key, `${path}.${key}`);
    const runtimeId = parseRuntimeId(field(record, key, path), `${path}.${key}`);
    assertRuntimeLanguage(languageId, runtimeId, `${path}.${key}`);
    result[languageId] = runtimeId;
  }
  return result;
}

function parseAcceptedMetadata(value: unknown, path: string): NonNullable<ProgressUpdate["accepted"]> {
  const record = parseRecord(value, path, ["acceptedAt", "acceptedLanguageId", "acceptedRuntimeId"]);
  return parseAcceptedMetadataFields(record, path);
}

function parseAcceptedMetadataFields(record: Record<string, unknown>, path: string): NonNullable<ProgressUpdate["accepted"]> {
  const acceptedLanguageId = parseLanguageId(field(record, "acceptedLanguageId", path), `${path}.acceptedLanguageId`);
  const acceptedRuntimeId = parseRuntimeId(field(record, "acceptedRuntimeId", path), `${path}.acceptedRuntimeId`);
  assertRuntimeLanguage(acceptedLanguageId, acceptedRuntimeId, path);
  return {
    acceptedAt: parseFiniteNonnegative(field(record, "acceptedAt", path), `${path}.acceptedAt`),
    acceptedLanguageId,
    acceptedRuntimeId,
  };
}

function parseCaseSummary(value: unknown, path: string): SubmissionRecord["caseSummary"] {
  const record = parseRecord(value, path, ["public", "custom", "judge"]);
  return {
    public: parseCountSummary(field(record, "public", path), `${path}.public`),
    custom: parseCountSummary(field(record, "custom", path), `${path}.custom`),
    judge: parseCountSummary(field(record, "judge", path), `${path}.judge`),
  };
}

function parseCountSummary(value: unknown, path: string): CaseCountSummary {
  const record = parseRecord(value, path, ["total", "passed", "failed"]);
  const total = parseNonnegativeInteger(field(record, "total", path), `${path}.total`);
  const passed = parseNonnegativeInteger(field(record, "passed", path), `${path}.passed`);
  const failed = parseNonnegativeInteger(field(record, "failed", path), `${path}.failed`);
  if (total !== passed + failed) throw new TypeError(`${path}: total must equal passed plus failed`);
  return { total, passed, failed };
}

function parseOutput(value: unknown, path: string): SubmissionRecord["output"] {
  const record = parseRecord(value, path, ["stdout", "stderr", "truncated"]);
  const stdout = parseText(field(record, "stdout", path), `${path}.stdout`, MAX_OUTPUT_BYTES);
  const stderr = parseText(field(record, "stderr", path), `${path}.stderr`, MAX_OUTPUT_BYTES);
  if (encoder.encode(stdout).byteLength + encoder.encode(stderr).byteLength > MAX_OUTPUT_BYTES) {
    throw new TypeError(`${path}: combined stdout and stderr exceed ${MAX_OUTPUT_BYTES} UTF-8 bytes`);
  }
  const truncated = field(record, "truncated", path);
  if (typeof truncated !== "boolean") throw new TypeError(`${path}.truncated: must be a boolean`);
  return { stdout, stderr, truncated };
}
