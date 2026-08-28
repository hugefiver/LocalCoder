import { compareJson } from "../oj/comparer.js";
import { type RuntimeId } from "../domain/language.js";
import { RuntimeAdapterRegistry } from "./adapters/registry.js";
import { runtimeContractCases, type RuntimeContractCase } from "./contracts/runtime-contract-cases.js";
import { verifyPythonParity, type PythonCorpusFixture } from "./python-parity.js";
import { RuntimeRegistry } from "./registry.js";
import { RuntimeSupervisor } from "./supervisor.js";

export type RuntimeVerificationCheck = "assets" | "handshake" | "smoke" | "judge-contract" | "pyodide-corpus-parity";

export type RuntimeVerification =
  | {
    readonly state: "verified";
    readonly runtimeId: RuntimeId;
    readonly runtimeVersion: string;
    readonly checks: readonly RuntimeVerificationCheck[];
  }
  | { readonly state: "unavailable"; readonly runtimeId: RuntimeId; readonly reason: string }
  | { readonly state: "broken"; readonly runtimeId: RuntimeId; readonly code: string; readonly message: string };

const MAX_FAILURE_CODE_BYTES = 128;
const MAX_FAILURE_MESSAGE_BYTES = 4_096;
const textEncoder = new TextEncoder();

export class OptionalRuntimeVerifier {
  readonly #registry: RuntimeRegistry;
  readonly #supervisor: RuntimeSupervisor;
  readonly #adapters: RuntimeAdapterRegistry;
  readonly #pythonCorpus: (() => Promise<readonly PythonCorpusFixture[]>) | undefined;
  readonly #inFlight = new Map<RuntimeId, Promise<RuntimeVerification>>();

  constructor(options: {
    readonly registry: RuntimeRegistry;
    readonly supervisor: RuntimeSupervisor;
    readonly adapters: RuntimeAdapterRegistry;
    readonly pythonCorpus?: () => Promise<readonly PythonCorpusFixture[]>;
  }) {
    this.#registry = options.registry;
    this.#supervisor = options.supervisor;
    this.#adapters = options.adapters;
    this.#pythonCorpus = options.pythonCorpus;
  }

  verify(runtimeId: RuntimeId): Promise<RuntimeVerification> {
    const runtime = this.#registry.get(runtimeId);
    if (!runtime.packaged || runtime.state.kind === "not-packaged") {
      const reason = runtime.unavailableReason
        ?? (runtime.state.kind === "not-packaged" ? runtime.state.reason : "Runtime assets are not packaged");
      return Promise.resolve({ state: "unavailable", runtimeId, reason });
    }
    if (runtime.verification === "verified") {
      return Promise.resolve({ state: "verified", runtimeId, runtimeVersion: runtime.runtimeVersion, checks: Object.freeze([]) });
    }
    const existing = this.#inFlight.get(runtimeId);
    if (existing !== undefined) return existing;

    const flight = this.verifyPackaged(runtimeId, runtime.capabilities);
    this.#inFlight.set(runtimeId, flight);
    void flight.then(
      () => this.clearFlight(runtimeId, flight),
      () => this.clearFlight(runtimeId, flight),
    );
    return flight;
  }

  private async verifyPackaged(
    runtimeId: RuntimeId,
    capabilities: { readonly execute: boolean; readonly judge: boolean },
  ): Promise<RuntimeVerification> {
    if (!capabilities.execute || !capabilities.judge) {
      return this.fail(runtimeId, "runtime-capabilities-disabled", "Packaged runtime does not provide execute and judge capabilities");
    }
    if (this.#registry.get(runtimeId).state.kind === "failed") this.#registry.transition(runtimeId, { kind: "loadable" });

    let session: import("./supervisor.js").RuntimeVerificationSession | undefined;
    try {
      session = this.#supervisor.beginOptionalVerification(runtimeId);
      const checks: RuntimeVerificationCheck[] = ["assets"];
      const handshake = await this.#supervisor.initialize(runtimeId, undefined, session.operationOptions());
      if (!handshake.capabilities.execute || !handshake.capabilities.judge) {
        throw verificationError("runtime-capabilities-disabled", "Runtime handshake did not enable execute and judge capabilities");
      }
      checks.push("handshake");

      const contract = runtimeContractCases(runtimeId);
      const smoke = await this.#adapters.get(runtimeId).execute(contract.smokeSource, session.operationOptions());
      if (smoke.identity.runtimeVersion !== handshake.runtimeVersion || smoke.identity.buildId !== handshake.buildId) {
        throw verificationError("runtime-identity-mismatch", "Runtime smoke invocation did not match the handshake identity");
      }
      checks.push("smoke");

      const judge = await this.#adapters.get(runtimeId).judge(
        contract.judgeSource,
        contract.judgeCases.map(({ input }) => input),
        session.operationOptions(),
      );
      if (judge.identity.runtimeVersion !== handshake.runtimeVersion || judge.identity.buildId !== handshake.buildId) {
        throw verificationError("runtime-identity-mismatch", "Runtime judge invocation did not match the handshake identity");
      }
      verifyJudgeCases(contract.judgeCases, judge.payload.cases);
      checks.push("judge-contract");

      if (runtimeId === "python-rustpython") {
        if (this.#pythonCorpus === undefined) {
          throw verificationError("python-parity-corpus-unavailable", "RustPython verification has no Pyodide parity corpus");
        }
        const report = await verifyPythonParity(
          this.#adapters.get("python-pyodide"),
          this.#adapters.get("python-rustpython"),
          await this.#pythonCorpus(),
          session.operationOptions(),
        );
        if (report.problemCount !== 6) {
          throw verificationError("python-parity-corpus-invalid", "RustPython parity corpus must contain exactly six problems");
        }
        const mismatch = report.mismatches[0];
        if (mismatch !== undefined) {
          throw verificationError(
            "pyodide-corpus-parity-failed",
            `RustPython parity mismatch for problem ${mismatch.problemId}, case ${mismatch.caseIndex}: ${mismatch.reason}`,
          );
        }
        checks.push("pyodide-corpus-parity");
      }

      if (this.#registry.get(runtimeId).state.kind !== "verifying") {
        throw verificationError("runtime-verification-state", "Runtime did not remain disabled throughout verification");
      }
      session.complete();
      return { state: "verified", runtimeId, runtimeVersion: handshake.runtimeVersion, checks: Object.freeze(checks) };
    } catch (error) {
      return this.fail(runtimeId, errorCode(error), errorMessage(error));
    } finally {
      session?.close();
    }
  }

  private fail(runtimeId: RuntimeId, code: string, message: string): RuntimeVerification {
    const boundedCode = boundedText(code, "optional-verification-failed", MAX_FAILURE_CODE_BYTES);
    const boundedMessage = boundedText(message, "Optional runtime verification failed", MAX_FAILURE_MESSAGE_BYTES);
    const state = this.#registry.get(runtimeId).state;
    if (state.kind === "loadable" || state.kind === "initializing" || state.kind === "verifying" || state.kind === "ready" || state.kind === "running") {
      this.#registry.transition(runtimeId, { kind: "failed", code: boundedCode, message: boundedMessage });
    }
    return { state: "broken", runtimeId, code: boundedCode, message: boundedMessage };
  }

  private clearFlight(runtimeId: RuntimeId, flight: Promise<RuntimeVerification>): void {
    if (this.#inFlight.get(runtimeId) === flight) this.#inFlight.delete(runtimeId);
  }
}

function verifyJudgeCases(
  expected: readonly RuntimeContractCase[],
  received: readonly {
    readonly index: number;
    readonly ok: boolean;
    readonly actual?: import("../domain/json-value.js").JsonValue;
  }[],
): void {
  if (received.length !== expected.length) {
    throw verificationError("judge-case-count-mismatch", "Runtime judge did not return every contract case");
  }
  for (const [index, contractCase] of expected.entries()) {
    const result = received[index];
    if (result === undefined || result.index !== index || result.ok !== true || result.actual === undefined) {
      throw verificationError("judge-contract-failed", `Runtime judge did not return successful actual output for contract case ${index}`);
    }
    const comparison = compareJson(result.actual, contractCase.expected);
    if (!comparison.equal) {
      throw verificationError("judge-actual-mismatch", `Runtime judge actual output differs at ${comparison.path}`);
    }
  }
}

function verificationError(code: string, message: string): Error & { readonly code: string } {
  return Object.assign(new Error(message), { code });
}

function errorCode(error: unknown): string {
  if (error !== null && typeof error === "object" && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  return "optional-verification-failed";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "Optional runtime verification failed";
}

function boundedText(value: string, fallback: string, maximumBytes: number): string {
  const source = value.trim().length === 0 ? fallback : value;
  let result = "";
  let bytes = 0;
  for (const codePoint of source) {
    const size = textEncoder.encode(codePoint).byteLength;
    if (bytes + size > maximumBytes) break;
    result += codePoint;
    bytes += size;
  }
  return result.length === 0 ? fallback : result;
}
