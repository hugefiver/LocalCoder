import { assertJsonValue, type JsonValue } from "../../domain/json-value.js";
import {
  MAX_OUTPUT_BYTES,
  type ExecutePayload,
  type InitializePayload,
  type JudgeCasePayload,
  type JudgeCaseRequest,
  type JudgePayload,
} from "../../runtime/protocol.js";
import { OutputBuffer, OutputBudget } from "../shared/output-buffer.js";
import { RuntimeFailureError, compileFailure, runtimeFailure } from "../shared/runtime-errors.js";
import { type AssetFetcher, runWasiModule } from "../wasi/runner.js";
import { type WorkerRuntime } from "../shared/endpoint.js";
import { makeRustPythonPayload } from "./payload.js";

export interface RustPythonHostOptions {
  readonly fetchBytes: AssetFetcher;
  readonly runWasi: typeof runWasiModule;
  readonly outputBytes?: number;
  readonly buildId?: string;
}

type BridgeResult =
  | { readonly ok: true; readonly value: JsonValue; readonly stdout: string; readonly stderr: string }
  | {
    readonly ok: false;
    readonly kind: "python-compile-error" | "python-runtime-error" | "json-bridge-error";
    readonly details: string;
    readonly stdout: string;
    readonly stderr: string;
  };

interface InvocationResult {
  readonly bridge: BridgeResult;
  readonly wasiStderr: string;
}

const RUSTPYTHON_VERSION = "rustpython-wasi";

export function createRustPythonHost(options: RustPythonHostOptions): WorkerRuntime {
  const outputBytes = options.outputBytes ?? MAX_OUTPUT_BYTES;
  const buildId = options.buildId ?? injectedBuildId();
  let wasm: Promise<ArrayBuffer> | undefined;

  const getWasm = (): Promise<ArrayBuffer> => {
    if (wasm === undefined) wasm = loadWasm(options.fetchBytes);
    return wasm;
  };
  const invoke = async (mode: "execute" | "judge", source: string, input?: JsonValue): Promise<InvocationResult> => {
    const execution = await options.runWasi({
      wasm: await getWasm(),
      stdin: makeRustPythonPayload({ mode, source, ...(input === undefined ? {} : { input }) }),
      args: [],
      env: {},
      outputBytes,
    });
    if (execution.exitCode !== 0) {
      throw new RuntimeFailureError(runtimeFailure(
        "rustpython-nonzero-exit",
        "RustPython runner exited unsuccessfully",
        execution.stderr,
      ));
    }
    if (execution.truncated) throw bridgeError("RustPython runner output exceeded the allowed size");
    return { bridge: parseBridgeResult(execution.stdout), wasiStderr: execution.stderr };
  };

  return {
    initialize: async (): Promise<InitializePayload> => {
      await getWasm();
      return { runtimeVersion: RUSTPYTHON_VERSION, buildId, capabilities: { execute: true, judge: true } };
    },
    execute: async (source): Promise<ExecutePayload> => {
      const result = await invoke("execute", source);
      const output = outputFor(result, outputBytes);
      if (!result.bridge.ok) throw bridgeFailure(result.bridge);
      return { stdout: output.stdout(), stderr: output.stderr(), value: null };
    },
    judge: async (source, cases): Promise<JudgePayload> => {
      const budget = new OutputBudget(outputBytes);
      const results: JudgeCasePayload[] = [];
      for (const testCase of cases) results.push(await judgeCase(invoke, source, testCase, budget));
      return { cases: results };
    },
    dispose: async (): Promise<void> => {
      wasm = undefined;
    },
  };
}

async function judgeCase(
  invoke: (mode: "execute" | "judge", source: string, input?: JsonValue) => Promise<InvocationResult>,
  source: string,
  testCase: JudgeCaseRequest,
  budget: OutputBudget,
): Promise<JudgeCasePayload> {
  const output = new OutputBuffer(budget);
  try {
    const result = await invoke("judge", source, testCase.input);
    appendOutput(output, result);
    if (!result.bridge.ok) throw bridgeFailure(result.bridge);
    return { index: testCase.index, ok: true, actual: result.bridge.value, stdout: output.stdout(), stderr: output.stderr() };
  } catch (error) {
    return { index: testCase.index, ok: false, failure: operationFailure(error).failure, stdout: output.stdout(), stderr: output.stderr() };
  }
}

function outputFor(result: InvocationResult, outputBytes: number): OutputBuffer {
  const output = new OutputBuffer(outputBytes);
  appendOutput(output, result);
  return output;
}

function appendOutput(output: OutputBuffer, result: InvocationResult): void {
  output.append("stdout", result.bridge.stdout);
  output.append("stderr", result.bridge.stderr);
  output.append("stderr", result.wasiStderr);
}

async function loadWasm(fetchBytes: AssetFetcher): Promise<ArrayBuffer> {
  try {
    const gzip = await fetchBytes("rustpython/runner.wasm.gz");
    return await decompressGzip(gzip);
  } catch {
    try {
      return await fetchBytes("rustpython/runner.wasm");
    } catch {
      throw infrastructureError("rustpython-asset-missing", "Local RustPython WASI asset could not be loaded");
    }
  }
}

async function decompressGzip(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  if (typeof DecompressionStream !== "function") throw new Error("DecompressionStream is unavailable");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

function parseBridgeResult(value: string): BridgeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw bridgeError("RustPython runner returned invalid JSON");
  }
  if (!isPlainRecord(parsed) || typeof parsed.ok !== "boolean") throw bridgeError("RustPython runner returned an invalid result envelope");
  if (parsed.ok) {
    if (!hasExactKeys(parsed, ["ok", "value", "stdout", "stderr"]) || !hasTextStreams(parsed)) {
      throw bridgeError("RustPython runner returned an invalid success envelope");
    }
    try {
      return { ok: true, value: assertJsonValue(parsed.value, "RustPython result"), stdout: parsed.stdout, stderr: parsed.stderr };
    } catch (error) {
      throw bridgeError(errorMessage(error) ?? "RustPython result is not canonical JSON");
    }
  }
  if (
    !hasExactKeys(parsed, ["ok", "kind", "details", "stdout", "stderr"])
    || !hasTextStreams(parsed)
    || (parsed.kind !== "python-compile-error" && parsed.kind !== "python-runtime-error" && parsed.kind !== "json-bridge-error")
    || typeof parsed.details !== "string"
  ) {
    throw bridgeError("RustPython runner returned an invalid failure envelope");
  }
  return { ok: false, kind: parsed.kind, details: parsed.details, stdout: parsed.stdout, stderr: parsed.stderr };
}

function bridgeFailure(result: Extract<BridgeResult, { ok: false }>): RuntimeFailureError {
  if (result.kind === "python-compile-error") {
    return new RuntimeFailureError(compileFailure(result.kind, "Python source could not be compiled", result.details));
  }
  const message = result.kind === "json-bridge-error" ? "Python result is not JSON serializable" : "Python execution failed";
  return new RuntimeFailureError(runtimeFailure(result.kind, message, result.details));
}

function operationFailure(error: unknown): RuntimeFailureError {
  if (error instanceof RuntimeFailureError) return error;
  return new RuntimeFailureError(runtimeFailure("python-runtime-error", "Python execution failed", errorMessage(error)));
}

function bridgeError(details: string): RuntimeFailureError {
  return new RuntimeFailureError(runtimeFailure("json-bridge-error", "Python bridge could not produce canonical JSON", details));
}

function infrastructureError(code: string, message: string): RuntimeFailureError {
  return new RuntimeFailureError({ kind: "infrastructure", code, message, fatal: true });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(record, key));
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
