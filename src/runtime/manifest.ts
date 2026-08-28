import {
  LANGUAGE_IDS,
  RUNTIME_IDS,
  type LanguageId,
  type RuntimeId,
} from "../domain/language.js";

export interface RuntimeManifestEntry {
  runtimeId: RuntimeId;
  languageId: LanguageId;
  protocolVersion: 1;
  runtimeVersion: string;
  worker: { url: string; type: "classic" | "module" };
  assets: Array<{ url: string; bytes: number }>;
  required: boolean;
  packaged: boolean;
  unavailableReason?: string;
  reuse: "per-submission" | "session";
  capabilities: { execute: boolean; judge: boolean };
  timeouts: { initializeMs: number; executeMs: number };
  limits: { sourceBytes: number; caseCount: number; outputBytes: number };
}

export interface RuntimeManifestDocument {
  schemaVersion: 1;
  runtimes: RuntimeManifestEntry[];
}

export const MAX_SOURCE_BYTES = 262_144;
export const MAX_CASE_COUNT = 100;
export const MAX_OUTPUT_BYTES = 65_536;
export const MAX_TIMEOUT_MS = 120_000;

type PlainRecord = Record<string, unknown>;

const textEncoder = new TextEncoder();
const MAX_RUNTIME_VERSION_BYTES = 256;
const MAX_URL_BYTES = 2_048;
const RUNTIME_LANGUAGE_IDS: Readonly<Record<RuntimeId, LanguageId>> = {
  "javascript-worker": "javascript",
  "typescript-official": "typescript",
  "python-pyodide": "python",
  "python-rustpython": "python",
  "racket-wasm": "racket",
  "haskell-ghc-wasi": "haskell",
};
const REQUIRED_RUNTIME_IDS = new Set<RuntimeId>([
  "javascript-worker",
  "typescript-official",
  "python-pyodide",
]);

function isPlainRecord(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function manifestError(runtimeId: string, path: string, message: string): never {
  throw new TypeError(`Runtime manifest ${runtimeId} at ${path}: ${message}`);
}

function documentError(path: string, message: string): never {
  throw new TypeError(`Runtime manifest at ${path}: ${message}`);
}

function hasOwn(record: PlainRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function propertyValue(
  record: PlainRecord,
  key: string,
  fail: (message: string) => never,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) fail("is missing a required field");
  if (!("value" in descriptor)) fail("must be a data property");
  return descriptor.value;
}

function assertExactFields(
  record: PlainRecord,
  allowed: readonly string[],
  required: readonly string[],
  fail: (message: string) => never,
): void {
  const allowedFields = new Set(allowed);
  const ownKeys = Reflect.ownKeys(record);
  if (ownKeys.some((key) => typeof key !== "string" || !allowedFields.has(key))) {
    fail("contains an unknown field");
  }
  for (const key of required) {
    if (!hasOwn(record, key)) fail(`is missing required field ${key}`);
  }
  for (const key of ownKeys) {
    if (typeof key !== "string") continue;
    propertyValue(record, key, (message) => fail(`field ${key} ${message}`));
  }
}

function assertNonBlankText(
  value: unknown,
  path: string,
  runtimeId: string,
  maxBytes: number,
): string {
  if (typeof value !== "string") manifestError(runtimeId, path, "must be a string");
  if (value.trim().length === 0 || textEncoder.encode(value).byteLength > maxBytes) {
    manifestError(runtimeId, path, `must be non-blank text within ${maxBytes} UTF-8 bytes`);
  }
  return value;
}

function assertBoolean(value: unknown, path: string, runtimeId: string): boolean {
  if (typeof value !== "boolean") manifestError(runtimeId, path, "must be a boolean");
  return value;
}

function assertPositiveInteger(
  value: unknown,
  path: string,
  runtimeId: string,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    manifestError(runtimeId, path, `must be a positive integer no greater than ${maximum}`);
  }
  return value;
}

function assertNonNegativeInteger(value: unknown, path: string, runtimeId: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    manifestError(runtimeId, path, "must be a non-negative integer");
  }
  return value;
}

function assertDeploymentRelativeUrl(value: unknown, path: string, runtimeId: string): string {
  const url = assertNonBlankText(value, path, runtimeId, MAX_URL_BYTES);
  const isSafePath = /^[A-Za-z0-9._/-]+$/.test(url)
    && !url.startsWith("/")
    && url === url.trim()
    && url.split("/").every((segment) => segment !== "" && segment !== "..");
  if (!isSafePath) {
    manifestError(runtimeId, path, "must be a deployment-relative static asset URL without traversal");
  }
  return url;
}

function assertRuntimeId(value: unknown, path: string, runtimeId: string): RuntimeId {
  if (typeof value !== "string" || !RUNTIME_IDS.includes(value as RuntimeId)) {
    manifestError(runtimeId, path, "must be a known runtime id");
  }
  return value as RuntimeId;
}

function runtimeDiagnosticId(value: PlainRecord): string {
  const descriptor = Object.getOwnPropertyDescriptor(value, "runtimeId");
  if (descriptor === undefined || !("value" in descriptor)) return "<unknown>";
  return typeof descriptor.value === "string" && RUNTIME_IDS.includes(descriptor.value as RuntimeId)
    ? descriptor.value
    : "<unknown>";
}

function assertLanguageId(value: unknown, path: string, runtimeId: string): LanguageId {
  if (typeof value !== "string" || !LANGUAGE_IDS.includes(value as LanguageId)) {
    manifestError(runtimeId, path, "must be a known language id");
  }
  return value as LanguageId;
}

function parseWorker(value: unknown, path: string, runtimeId: string): { url: string; type: "classic" | "module" } {
  if (!isPlainRecord(value)) manifestError(runtimeId, path, "must be an object");
  assertExactFields(value, ["url", "type"], ["url", "type"], (message) => (
    manifestError(runtimeId, path, message)
  ));
  const url = assertDeploymentRelativeUrl(
    propertyValue(value, "url", (message) => manifestError(runtimeId, `${path}.url`, message)),
    `${path}.url`,
    runtimeId,
  );
  const type = propertyValue(value, "type", (message) => manifestError(runtimeId, `${path}.type`, message));
  if (type !== "classic" && type !== "module") {
    manifestError(runtimeId, `${path}.type`, "must be classic or module");
  }
  return { url, type };
}

function parseAssets(value: unknown, path: string, runtimeId: string): Array<{ url: string; bytes: number }> {
  if (!Array.isArray(value)) manifestError(runtimeId, path, "must be an array");
  return value.map((asset, index) => {
    const assetPath = `${path}[${index}]`;
    if (!isPlainRecord(asset)) manifestError(runtimeId, assetPath, "must be an object");
    assertExactFields(asset, ["url", "bytes"], ["url", "bytes"], (message) => (
      manifestError(runtimeId, assetPath, message)
    ));
    return {
      url: assertDeploymentRelativeUrl(
        propertyValue(asset, "url", (message) => manifestError(runtimeId, `${assetPath}.url`, message)),
        `${assetPath}.url`,
        runtimeId,
      ),
      bytes: assertNonNegativeInteger(
        propertyValue(asset, "bytes", (message) => manifestError(runtimeId, `${assetPath}.bytes`, message)),
        `${assetPath}.bytes`,
        runtimeId,
      ),
    };
  });
}

function parseCapabilities(value: unknown, path: string, runtimeId: string): { execute: boolean; judge: boolean } {
  if (!isPlainRecord(value)) manifestError(runtimeId, path, "must be an object");
  assertExactFields(value, ["execute", "judge"], ["execute", "judge"], (message) => (
    manifestError(runtimeId, path, message)
  ));
  return {
    execute: assertBoolean(
      propertyValue(value, "execute", (message) => manifestError(runtimeId, `${path}.execute`, message)),
      `${path}.execute`,
      runtimeId,
    ),
    judge: assertBoolean(
      propertyValue(value, "judge", (message) => manifestError(runtimeId, `${path}.judge`, message)),
      `${path}.judge`,
      runtimeId,
    ),
  };
}

function parseTimeouts(value: unknown, path: string, runtimeId: string): { initializeMs: number; executeMs: number } {
  if (!isPlainRecord(value)) manifestError(runtimeId, path, "must be an object");
  assertExactFields(value, ["initializeMs", "executeMs"], ["initializeMs", "executeMs"], (message) => (
    manifestError(runtimeId, path, message)
  ));
  return {
    initializeMs: assertPositiveInteger(
      propertyValue(value, "initializeMs", (message) => manifestError(runtimeId, `${path}.initializeMs`, message)),
      `${path}.initializeMs`,
      runtimeId,
      MAX_TIMEOUT_MS,
    ),
    executeMs: assertPositiveInteger(
      propertyValue(value, "executeMs", (message) => manifestError(runtimeId, `${path}.executeMs`, message)),
      `${path}.executeMs`,
      runtimeId,
      MAX_TIMEOUT_MS,
    ),
  };
}

function parseLimits(value: unknown, path: string, runtimeId: string): { sourceBytes: number; caseCount: number; outputBytes: number } {
  if (!isPlainRecord(value)) manifestError(runtimeId, path, "must be an object");
  assertExactFields(value, ["sourceBytes", "caseCount", "outputBytes"], ["sourceBytes", "caseCount", "outputBytes"], (message) => (
    manifestError(runtimeId, path, message)
  ));
  return {
    sourceBytes: assertPositiveInteger(
      propertyValue(value, "sourceBytes", (message) => manifestError(runtimeId, `${path}.sourceBytes`, message)),
      `${path}.sourceBytes`,
      runtimeId,
      MAX_SOURCE_BYTES,
    ),
    caseCount: assertPositiveInteger(
      propertyValue(value, "caseCount", (message) => manifestError(runtimeId, `${path}.caseCount`, message)),
      `${path}.caseCount`,
      runtimeId,
      MAX_CASE_COUNT,
    ),
    outputBytes: assertPositiveInteger(
      propertyValue(value, "outputBytes", (message) => manifestError(runtimeId, `${path}.outputBytes`, message)),
      `${path}.outputBytes`,
      runtimeId,
      MAX_OUTPUT_BYTES,
    ),
  };
}

function parseRuntimeEntry(value: unknown, index: number): RuntimeManifestEntry {
  const path = `$.runtimes[${index}]`;
  if (!isPlainRecord(value)) manifestError("<unknown>", path, "must be an object");
  const candidateRuntimeId = runtimeDiagnosticId(value);
  assertExactFields(
    value,
    [
      "runtimeId",
      "languageId",
      "protocolVersion",
      "runtimeVersion",
      "worker",
      "assets",
      "required",
      "packaged",
      "unavailableReason",
      "reuse",
      "capabilities",
      "timeouts",
      "limits",
    ],
    [
      "runtimeId",
      "languageId",
      "protocolVersion",
      "runtimeVersion",
      "worker",
      "assets",
      "required",
      "packaged",
      "reuse",
      "capabilities",
      "timeouts",
      "limits",
    ],
    (message) => manifestError(candidateRuntimeId, path, message),
  );

  const runtimeId = assertRuntimeId(
    propertyValue(value, "runtimeId", (message) => manifestError(candidateRuntimeId, `${path}.runtimeId`, message)),
    `${path}.runtimeId`,
    candidateRuntimeId,
  );
  const languageId = assertLanguageId(
    propertyValue(value, "languageId", (message) => manifestError(runtimeId, `${path}.languageId`, message)),
    `${path}.languageId`,
    runtimeId,
  );
  if (languageId !== RUNTIME_LANGUAGE_IDS[runtimeId]) {
    manifestError(runtimeId, `${path}.languageId`, "does not match the runtime language");
  }
  const protocolVersion = propertyValue(
    value,
    "protocolVersion",
    (message) => manifestError(runtimeId, `${path}.protocolVersion`, message),
  );
  if (protocolVersion !== 1) {
    manifestError(runtimeId, `${path}.protocolVersion`, "must be protocol version 1");
  }
  const required = assertBoolean(
    propertyValue(value, "required", (message) => manifestError(runtimeId, `${path}.required`, message)),
    `${path}.required`,
    runtimeId,
  );
  if (required !== REQUIRED_RUNTIME_IDS.has(runtimeId)) {
    manifestError(runtimeId, `${path}.required`, "does not match the runtime requirement policy");
  }
  const packaged = assertBoolean(
    propertyValue(value, "packaged", (message) => manifestError(runtimeId, `${path}.packaged`, message)),
    `${path}.packaged`,
    runtimeId,
  );
  const capabilities = parseCapabilities(
    propertyValue(value, "capabilities", (message) => manifestError(runtimeId, `${path}.capabilities`, message)),
    `${path}.capabilities`,
    runtimeId,
  );
  const hasUnavailableReason = hasOwn(value, "unavailableReason");
  let unavailableReason: string | undefined;
  if (packaged && hasUnavailableReason) {
    manifestError(runtimeId, `${path}.unavailableReason`, "must be omitted when packaged is true");
  }
  if (!packaged) {
    if (!hasUnavailableReason) {
      manifestError(runtimeId, `${path}.unavailableReason`, "is required when packaged is false");
    }
    unavailableReason = assertNonBlankText(
      propertyValue(value, "unavailableReason", (message) => manifestError(runtimeId, `${path}.unavailableReason`, message)),
      `${path}.unavailableReason`,
      runtimeId,
      MAX_RUNTIME_VERSION_BYTES,
    );
    if (capabilities.execute || capabilities.judge) {
      manifestError(runtimeId, `${path}.capabilities`, "must be disabled when packaged is false");
    }
  }
  const reuse = propertyValue(value, "reuse", (message) => manifestError(runtimeId, `${path}.reuse`, message));
  if (reuse !== "per-submission" && reuse !== "session") {
    manifestError(runtimeId, `${path}.reuse`, "must be per-submission or session");
  }

  const entry: RuntimeManifestEntry = {
    runtimeId,
    languageId,
    protocolVersion: 1,
    runtimeVersion: assertNonBlankText(
      propertyValue(value, "runtimeVersion", (message) => manifestError(runtimeId, `${path}.runtimeVersion`, message)),
      `${path}.runtimeVersion`,
      runtimeId,
      MAX_RUNTIME_VERSION_BYTES,
    ),
    worker: parseWorker(
      propertyValue(value, "worker", (message) => manifestError(runtimeId, `${path}.worker`, message)),
      `${path}.worker`,
      runtimeId,
    ),
    assets: parseAssets(
      propertyValue(value, "assets", (message) => manifestError(runtimeId, `${path}.assets`, message)),
      `${path}.assets`,
      runtimeId,
    ),
    required,
    packaged,
    reuse,
    capabilities,
    timeouts: parseTimeouts(
      propertyValue(value, "timeouts", (message) => manifestError(runtimeId, `${path}.timeouts`, message)),
      `${path}.timeouts`,
      runtimeId,
    ),
    limits: parseLimits(
      propertyValue(value, "limits", (message) => manifestError(runtimeId, `${path}.limits`, message)),
      `${path}.limits`,
      runtimeId,
    ),
  };
  if (unavailableReason !== undefined) entry.unavailableReason = unavailableReason;
  return entry;
}

export function parseRuntimeManifest(input: unknown): RuntimeManifestDocument {
  if (!isPlainRecord(input)) documentError("$", "must be an object");
  assertExactFields(input, ["schemaVersion", "runtimes"], ["schemaVersion", "runtimes"], (message) => (
    documentError("$", message)
  ));
  const schemaVersion = propertyValue(input, "schemaVersion", (message) => documentError("$.schemaVersion", message));
  if (schemaVersion !== 1) documentError("$.schemaVersion", "must be schema version 1");
  const runtimesInput = propertyValue(input, "runtimes", (message) => documentError("$.runtimes", message));
  if (!Array.isArray(runtimesInput) || runtimesInput.length === 0) {
    documentError("$.runtimes", "must be a non-empty array");
  }
  const runtimes = runtimesInput.map((runtime, index) => parseRuntimeEntry(runtime, index));
  const runtimeIds = new Set<RuntimeId>();
  for (const runtime of runtimes) {
    if (runtimeIds.has(runtime.runtimeId)) {
      manifestError(runtime.runtimeId, "$.runtimes", "contains a duplicate runtime id");
    }
    runtimeIds.add(runtime.runtimeId);
  }
  return { schemaVersion: 1, runtimes };
}
