import { type LanguageId, type RuntimeId } from "../domain/language.js";
import {
  type RuntimeManifestDocument,
  type RuntimeManifestEntry,
} from "./manifest.js";

const textEncoder = new TextEncoder();
const MAX_REQUEST_ID_BYTES = 256;
const MAX_FAILURE_CODE_BYTES = 128;
const MAX_MESSAGE_BYTES = 4_096;

export type RuntimeCapabilityState =
  | { readonly kind: "not-packaged"; readonly reason: string }
  | { readonly kind: "loadable" }
  | { readonly kind: "initializing"; readonly message?: string }
  | { readonly kind: "verifying" }
  | { readonly kind: "ready" }
  | { readonly kind: "running"; readonly requestId: string }
  | { readonly kind: "failed"; readonly code: string; readonly message: string }
  | { readonly kind: "incompatible"; readonly expected: 1; readonly received: number };

export type RuntimeVerificationState = "not-required" | "unverified" | "verified";

export interface RuntimeCapability extends RuntimeManifestEntry {
  readonly state: RuntimeCapabilityState;
  readonly verification: RuntimeVerificationState;
}

export type RuntimeRegistryListener = (snapshot: readonly RuntimeCapability[]) => void;

type StateRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is StateRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stateError(message: string): never {
  throw new TypeError(`Runtime capability state ${message}`);
}

function assertExactFields(record: StateRecord, allowed: readonly string[], required: readonly string[]): void {
  const allowedFields = new Set(allowed);
  const ownKeys = Reflect.ownKeys(record);
  if (ownKeys.some((key) => typeof key !== "string" || !allowedFields.has(key))) {
    stateError("contains an unknown field");
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      stateError(`is missing required field ${key}`);
    }
  }
  for (const key of ownKeys) {
    if (typeof key !== "string") continue;
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      stateError(`field ${key} must be a data property`);
    }
  }
}

function stateProperty(record: StateRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    stateError(`field ${key} must be a data property`);
  }
  return descriptor.value;
}

function assertNonBlankText(value: unknown, field: string, maximumBytes: number): string {
  if (typeof value !== "string") stateError(`${field} must be a string`);
  if (value.trim().length === 0 || textEncoder.encode(value).byteLength > maximumBytes) {
    stateError(`${field} must be non-blank text within ${maximumBytes} UTF-8 bytes`);
  }
  return value;
}

function parseState(value: RuntimeCapabilityState): RuntimeCapabilityState {
  if (!isPlainRecord(value)) stateError("must be an object");
  const kind = stateProperty(value, "kind");
  if (typeof kind !== "string") stateError("kind must be a string");

  switch (kind) {
    case "not-packaged": {
      assertExactFields(value, ["kind", "reason"], ["kind", "reason"]);
      return Object.freeze({
        kind,
        reason: assertNonBlankText(stateProperty(value, "reason"), "reason", MAX_MESSAGE_BYTES),
      });
    }
    case "loadable": {
      assertExactFields(value, ["kind"], ["kind"]);
      return Object.freeze({ kind });
    }
    case "initializing": {
      assertExactFields(value, ["kind", "message"], ["kind"]);
      const message = Object.prototype.hasOwnProperty.call(value, "message")
        ? assertNonBlankText(stateProperty(value, "message"), "message", MAX_MESSAGE_BYTES)
        : undefined;
      return Object.freeze({ kind, ...(message === undefined ? {} : { message }) });
    }
    case "verifying": {
      assertExactFields(value, ["kind"], ["kind"]);
      return Object.freeze({ kind });
    }
    case "ready": {
      assertExactFields(value, ["kind"], ["kind"]);
      return Object.freeze({ kind });
    }
    case "running": {
      assertExactFields(value, ["kind", "requestId"], ["kind", "requestId"]);
      return Object.freeze({
        kind,
        requestId: assertNonBlankText(stateProperty(value, "requestId"), "requestId", MAX_REQUEST_ID_BYTES),
      });
    }
    case "failed": {
      assertExactFields(value, ["kind", "code", "message"], ["kind", "code", "message"]);
      return Object.freeze({
        kind,
        code: assertNonBlankText(stateProperty(value, "code"), "code", MAX_FAILURE_CODE_BYTES),
        message: assertNonBlankText(stateProperty(value, "message"), "message", MAX_MESSAGE_BYTES),
      });
    }
    case "incompatible": {
      assertExactFields(value, ["kind", "expected", "received"], ["kind", "expected", "received"]);
      const expected = stateProperty(value, "expected");
      if (expected !== 1) stateError("expected must be protocol version 1");
      const received = stateProperty(value, "received");
      if (typeof received !== "number" || !Number.isSafeInteger(received) || received <= 0 || received === 1) {
        stateError("received must be a positive integer other than 1");
      }
      return Object.freeze({ kind, expected: 1, received });
    }
    default:
      stateError("kind is unknown");
  }
}

function sameState(left: RuntimeCapabilityState, right: RuntimeCapabilityState): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "not-packaged":
      return right.kind === "not-packaged" && left.reason === right.reason;
    case "initializing":
      return right.kind === "initializing" && left.message === right.message;
    case "verifying":
      return right.kind === "verifying";
    case "running":
      return right.kind === "running" && left.requestId === right.requestId;
    case "failed":
      return right.kind === "failed" && left.code === right.code && left.message === right.message;
    case "incompatible":
      return right.kind === "incompatible" && left.expected === right.expected && left.received === right.received;
    case "loadable":
    case "ready":
      return true;
  }
}

function canTransition(current: RuntimeCapabilityState["kind"], next: RuntimeCapabilityState["kind"]): boolean {
  switch (current) {
    case "loadable":
      return next === "initializing" || next === "failed" || next === "incompatible";
    case "initializing":
      return next === "initializing" || next === "loadable" || next === "ready" || next === "verifying" || next === "failed" || next === "incompatible";
    case "verifying":
      return next === "running" || next === "ready" || next === "failed" || next === "incompatible";
    case "ready":
      return next === "loadable" || next === "running" || next === "failed" || next === "incompatible";
    case "running":
      return next === "loadable" || next === "ready" || next === "verifying" || next === "failed" || next === "incompatible";
    case "failed":
      return next === "loadable";
    case "not-packaged":
    case "incompatible":
      return false;
  }
}

function frozenCapability(
  entry: RuntimeManifestEntry,
  state: RuntimeCapabilityState,
  verification: RuntimeVerificationState,
): RuntimeCapability {
  const capability: RuntimeCapability = {
    runtimeId: entry.runtimeId,
    languageId: entry.languageId,
    protocolVersion: 1,
    runtimeVersion: entry.runtimeVersion,
    worker: { ...entry.worker },
    assets: entry.assets.map((asset) => ({ ...asset })),
    required: entry.required,
    packaged: entry.packaged,
    ...(entry.unavailableReason === undefined ? {} : { unavailableReason: entry.unavailableReason }),
    reuse: entry.reuse,
    capabilities: { ...entry.capabilities },
    timeouts: { ...entry.timeouts },
    limits: { ...entry.limits },
    state,
    verification,
  };

  Object.freeze(capability.worker);
  for (const asset of capability.assets) Object.freeze(asset);
  Object.freeze(capability.assets);
  Object.freeze(capability.capabilities);
  Object.freeze(capability.timeouts);
  Object.freeze(capability.limits);
  Object.freeze(capability.state);
  return Object.freeze(capability);
}

function initialState(entry: RuntimeManifestEntry): RuntimeCapabilityState {
  if (entry.packaged) return Object.freeze({ kind: "loadable" });
  if (entry.unavailableReason === undefined) {
    throw new TypeError(`Runtime manifest ${entry.runtimeId} is not packaged without an unavailable reason`);
  }
  return parseState({ kind: "not-packaged", reason: entry.unavailableReason });
}

function initialVerification(entry: RuntimeManifestEntry): RuntimeVerificationState {
  return entry.required ? "not-required" : "unverified";
}

export function isRuntimeExecutionEligible(
  capability: RuntimeCapability,
  options: { readonly allowFailed?: boolean } = {},
): boolean {
  if (!capability.packaged || capability.state.kind === "not-packaged" || capability.state.kind === "incompatible") {
    return false;
  }
  if (!capability.required && capability.verification !== "verified") return false;
  return options.allowFailed === true || capability.state.kind !== "failed";
}

export class RuntimeRegistry {
  readonly #runtimeIds: readonly RuntimeId[];
  readonly #capabilities: Map<RuntimeId, RuntimeCapability>;
  readonly #listeners = new Set<RuntimeRegistryListener>();

  private constructor(capabilities: readonly RuntimeCapability[]) {
    this.#runtimeIds = Object.freeze(capabilities.map(({ runtimeId }) => runtimeId));
    this.#capabilities = new Map(capabilities.map((capability) => [capability.runtimeId, capability]));
  }

  static fromManifest(document: RuntimeManifestDocument): RuntimeRegistry {
    const capabilities = document.runtimes.map((entry) => (
      frozenCapability(entry, initialState(entry), initialVerification(entry))
    ));
    return new RuntimeRegistry(capabilities);
  }

  list(): readonly RuntimeCapability[] {
    return Object.freeze(this.#runtimeIds.map((runtimeId) => this.#capabilities.get(runtimeId)!));
  }

  forLanguage(languageId: LanguageId, capability?: "execute" | "judge"): readonly RuntimeCapability[] {
    return Object.freeze(this.list().filter((runtime) => (
      runtime.languageId === languageId && (capability === undefined || runtime.capabilities[capability])
    )));
  }

  get(runtimeId: RuntimeId): RuntimeCapability {
    const runtime = this.#capabilities.get(runtimeId);
    if (runtime === undefined) throw new RangeError(`Runtime registry does not contain ${runtimeId}`);
    return runtime;
  }

  resolveDefault(languageId: LanguageId, capability: "execute" | "judge"): RuntimeCapability | undefined {
    const selectable = this.forLanguage(languageId, capability).filter((runtime) => isRuntimeExecutionEligible(runtime));
    return selectable.find((runtime) => runtime.required) ?? selectable[0];
  }

  transition(runtimeId: RuntimeId, next: RuntimeCapabilityState): void {
    const current = this.get(runtimeId);
    const nextState = parseState(next);
    if (sameState(current.state, nextState)) return;
    if (!canTransition(current.state.kind, nextState.kind)) {
      const unavailable = current.state.kind === "not-packaged" ? "; not packaged runtimes cannot be enabled" : "";
      throw new RangeError(
        `Illegal runtime transition for ${runtimeId}: ${current.state.kind} -> ${nextState.kind}${unavailable}`,
      );
    }

    this.#capabilities.set(runtimeId, frozenCapability(current, nextState, current.verification));
    this.#notify();
  }

  completeOptionalVerification(runtimeId: RuntimeId): void {
    const current = this.get(runtimeId);
    if (current.required || !current.packaged || current.verification !== "unverified" || current.state.kind !== "verifying") {
      throw new RangeError(`Runtime ${runtimeId} is not awaiting optional verification completion`);
    }
    this.#capabilities.set(runtimeId, frozenCapability(current, { kind: "ready" }, "verified"));
    this.#notify();
  }

  subscribe(listener: RuntimeRegistryListener): () => void {
    this.#listeners.add(listener);
    this.#notifyListener(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #notify(): void {
    const snapshot = this.list();
    for (const listener of [...this.#listeners]) {
      if (this.#listeners.has(listener)) this.#notifyListener(listener, snapshot);
    }
  }

  #notifyListener(listener: RuntimeRegistryListener, snapshot = this.list()): void {
    try {
      listener(snapshot);
    } catch {
      // Observer failures must not interrupt state updates or other observers.
    }
  }
}
