import { assertJsonValue, type JsonValue } from "../../domain/json-value.js";
import {
  MAX_OUTPUT_BYTES,
  type ExecutePayload,
  type InitializePayload,
  type JudgeCasePayload,
  type JudgeCaseRequest,
  type JudgePayload,
} from "../../runtime/protocol.js";
import { type WorkerRuntime } from "../shared/endpoint.js";
import { OutputBuffer, OutputBudget } from "../shared/output-buffer.js";
import { RuntimeFailureError, compileFailure, runtimeFailure } from "../shared/runtime-errors.js";
import { CapturedEmscriptenStreams } from "./captured-streams.js";
import { createRacketBridgeProgram } from "./json-bridge.js";

export interface EmscriptenRacketLike {
  readonly FS: {
    writeFile(path: string, data: string): void;
    unlink(path: string): void;
  };
  callMain(args: readonly string[]): unknown;
  version?: string;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
}

export interface EmscriptenRacketHostOptions {
  readonly load: () => Promise<EmscriptenRacketLike>;
  readonly outputBytes?: number;
  readonly buildId?: string;
}

type BridgeResult =
  | { readonly ok: true; readonly value: JsonValue; readonly stdout: string; readonly stderr: string }
  | {
    readonly ok: false;
    readonly kind: "racket-compile-error" | "racket-runtime-error" | "json-bridge-error";
    readonly details: string;
    readonly stdout: string;
    readonly stderr: string;
  };

export function createEmscriptenRacketHost(options: EmscriptenRacketHostOptions): WorkerRuntime {
  const outputBytes = options.outputBytes ?? MAX_OUTPUT_BYTES;
  const buildId = options.buildId ?? injectedBuildId();
  let loaded: EmscriptenRacketLike | undefined;
  let loading: Promise<EmscriptenRacketLike> | undefined;
  let sequence = 0;

  const getRuntime = async (): Promise<EmscriptenRacketLike> => {
    if (loaded !== undefined) return loaded;
    if (loading === undefined) {
      loading = options.load().then((candidate) => {
        if (!isEmscriptenRacketLike(candidate)) {
          throw infrastructureError("racket-api-incompatible", "Local Racket asset has an incompatible Emscripten API");
        }
        loaded = candidate;
        return candidate;
      }).catch((error: unknown) => {
        loading = undefined;
        if (error instanceof RuntimeFailureError) throw error;
        throw infrastructureError("racket-initialization-failed", "Local Racket runtime could not initialize");
      });
    }
    return loading;
  };

  const run = async (source: string, input: JsonValue, mode: "execute" | "judge"): Promise<BridgeResult> => {
    sequence += 1;
    const runtime = await getRuntime();
    return runBridge(runtime, `/.localcoder-${sequence}.rkt`, source, input, mode, outputBytes);
  };

  return {
    initialize: async (): Promise<InitializePayload> => {
      const runtime = await getRuntime();
      return {
        runtimeVersion: typeof runtime.version === "string" && runtime.version.trim().length > 0 ? runtime.version : "racket-wasm",
        buildId,
        capabilities: { execute: true, judge: true },
      };
    },
    execute: async (source): Promise<ExecutePayload> => {
      const output = new OutputBuffer(outputBytes);
      try {
        const result = await run(source, null, "execute");
        appendOutput(output, result);
        if (!result.ok) throw bridgeFailure(result);
        return { stdout: output.stdout(), stderr: output.stderr(), value: null };
      } catch (error) {
        throw racketOperationFailure(error);
      }
    },
    judge: async (source, cases): Promise<JudgePayload> => {
      const budget = new OutputBudget(outputBytes);
      const results: JudgeCasePayload[] = [];
      for (const testCase of cases) results.push(await judgeCase(run, source, testCase, budget));
      return { cases: results };
    },
    dispose: async (): Promise<void> => undefined,
  };
}

export function isEmscriptenRacketLike(value: unknown): value is EmscriptenRacketLike {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const fs = candidate.FS;
  return typeof candidate.callMain === "function"
    && fs !== null
    && typeof fs === "object"
    && typeof (fs as Record<string, unknown>).writeFile === "function"
    && typeof (fs as Record<string, unknown>).unlink === "function";
}

async function judgeCase(
  run: (source: string, input: JsonValue, mode: "judge") => Promise<BridgeResult>,
  source: string,
  testCase: JudgeCaseRequest,
  budget: OutputBudget,
): Promise<JudgeCasePayload> {
  const output = new OutputBuffer(budget);
  try {
    const result = await run(source, testCase.input, "judge");
    appendOutput(output, result);
    if (!result.ok) throw bridgeFailure(result);
    return { index: testCase.index, ok: true, actual: result.value, stdout: output.stdout(), stderr: output.stderr() };
  } catch (error) {
    return {
      index: testCase.index,
      ok: false,
      failure: racketOperationFailure(error).failure,
      stdout: output.stdout(),
      stderr: output.stderr(),
    };
  }
}

async function runBridge(
  runtime: EmscriptenRacketLike,
  fileName: string,
  source: string,
  input: JsonValue,
  mode: "execute" | "judge",
  outputBytes: number,
): Promise<BridgeResult> {
  const captured = new CapturedEmscriptenStreams(outputBytes);
  const previousPrint = runtime.print;
  const previousPrintErr = runtime.printErr;
  runtime.print = (text) => captured.append("stdout", text);
  runtime.printErr = (text) => captured.append("stderr", text);
  try {
    runtime.FS.writeFile(fileName, createRacketBridgeProgram({ source, input, mode }));
    await runtime.callMain([fileName]);
    return parseBridgeResult(captured.stdout());
  } catch (error) {
    if (error instanceof RuntimeFailureError) throw error;
    throw callMainFailure(error, captured.stderr());
  } finally {
    if (previousPrint === undefined) delete runtime.print;
    else runtime.print = previousPrint;
    if (previousPrintErr === undefined) delete runtime.printErr;
    else runtime.printErr = previousPrintErr;
    try {
      runtime.FS.unlink(fileName);
    } catch {
      // A failed write may not create the file. The primary operation failure is more useful.
    }
  }
}

function parseBridgeResult(text: string): BridgeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw bridgeError("Racket bridge did not return one strict JSON payload");
  }
  if (!isPlainRecord(parsed) || typeof parsed.ok !== "boolean") {
    throw bridgeError("Racket bridge returned an invalid result envelope");
  }
  if (parsed.ok) {
    if (!hasExactKeys(parsed, ["ok", "value", "stdout", "stderr"]) || !hasTextStreams(parsed)) {
      throw bridgeError("Racket bridge returned an invalid success envelope");
    }
    try {
      return { ok: true, value: assertJsonValue(parsed.value, "Racket bridge result"), stdout: parsed.stdout, stderr: parsed.stderr };
    } catch (error) {
      throw bridgeError(errorMessage(error) ?? "Racket result is not canonical JSON");
    }
  }
  if (
    !hasExactKeys(parsed, ["ok", "kind", "details", "stdout", "stderr"])
    || !hasTextStreams(parsed)
    || (parsed.kind !== "racket-compile-error" && parsed.kind !== "racket-runtime-error" && parsed.kind !== "json-bridge-error")
    || typeof parsed.details !== "string"
  ) {
    throw bridgeError("Racket bridge returned an invalid failure envelope");
  }
  return { ok: false, kind: parsed.kind, details: parsed.details, stdout: parsed.stdout, stderr: parsed.stderr };
}

function appendOutput(output: OutputBuffer, result: BridgeResult): void {
  output.append("stdout", result.stdout);
  output.append("stderr", result.stderr);
}

function bridgeFailure(result: Extract<BridgeResult, { ok: false }>): RuntimeFailureError {
  if (result.kind === "racket-compile-error") {
    return new RuntimeFailureError(compileFailure(result.kind, "Racket source could not be compiled", result.details));
  }
  const message = result.kind === "json-bridge-error" ? "Racket result is not JSON serializable" : "Racket execution failed";
  return new RuntimeFailureError(runtimeFailure(result.kind, message, result.details));
}

function callMainFailure(error: unknown, stderr: string): RuntimeFailureError {
  const details = errorMessage(error) ?? stderr;
  const compile = /read-syntax|syntax|compile/i.test(details);
  return new RuntimeFailureError(compile
    ? compileFailure("racket-compile-error", "Racket source could not be compiled", details)
    : runtimeFailure("racket-runtime-error", "Racket execution failed", details));
}

function racketOperationFailure(error: unknown): RuntimeFailureError {
  if (error instanceof RuntimeFailureError) return error;
  return new RuntimeFailureError(runtimeFailure("racket-runtime-error", "Racket execution failed", errorMessage(error)));
}

function bridgeError(details: string): RuntimeFailureError {
  return new RuntimeFailureError(runtimeFailure("json-bridge-error", "Racket bridge could not produce canonical JSON", details));
}

function infrastructureError(code: string, message: string): RuntimeFailureError {
  return new RuntimeFailureError({ kind: "infrastructure", code, message, fatal: true });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(record: Record<string, unknown>, required: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === required.length && required.every((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function hasTextStreams(record: Record<string, unknown>): record is Record<string, unknown> & { stdout: string; stderr: string } {
  return typeof record.stdout === "string" && typeof record.stderr === "string";
}

function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : typeof error === "string" ? error : undefined;
}

function injectedBuildId(): string {
  return typeof __LOCALCODER_BUILD_ID__ === "string" ? __LOCALCODER_BUILD_ID__ : "development";
}

declare const __LOCALCODER_BUILD_ID__: string;
