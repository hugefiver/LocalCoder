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
import { PYODIDE_BRIDGE_GLOBALS, PYODIDE_BRIDGE_PROGRAM } from "./python-bridge.js";

export { PYODIDE_BRIDGE_GLOBALS, PYODIDE_BRIDGE_PROGRAM } from "./python-bridge.js";

export interface PyodideLike {
  runPythonAsync(code: string, options?: { globals?: unknown }): Promise<unknown>;
  globals: { set(name: string, value: unknown): void; delete(name: string): boolean };
  readonly version?: string;
}

export interface PyodideHostOptions {
  readonly load: () => Promise<PyodideLike>;
  readonly outputBytes: number;
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

export function createPyodideHost(options: PyodideHostOptions): WorkerRuntime {
  const outputBytes = options.outputBytes ?? MAX_OUTPUT_BYTES;
  const buildId = options.buildId ?? injectedBuildId();
  let loaded: PyodideLike | undefined;
  let loading: Promise<PyodideLike> | undefined;

  const getPyodide = async (): Promise<PyodideLike> => {
    if (loaded !== undefined) return loaded;
    if (loading === undefined) {
      loading = options.load().then((candidate) => {
        if (!isPyodideLike(candidate)) {
          throw infrastructureError("pyodide-api-incompatible", "Local Pyodide asset has an incompatible API");
        }
        loaded = candidate;
        return candidate;
      }).catch((error: unknown) => {
        loading = undefined;
        if (error instanceof RuntimeFailureError) throw error;
        throw infrastructureError("pyodide-initialization-failed", "Local Pyodide runtime could not initialize");
      });
    }
    return loading;
  };

  return {
    initialize: async (): Promise<InitializePayload> => {
      const pyodide = await getPyodide();
      return {
        runtimeVersion: pyodide.version ?? "pyodide",
        buildId,
        capabilities: { execute: true, judge: true },
      };
    },
    execute: async (source): Promise<ExecutePayload> => execute(await getPyodide(), source, outputBytes),
    judge: async (source, cases): Promise<JudgePayload> => judge(await getPyodide(), source, cases, outputBytes),
    dispose: async (): Promise<void> => undefined,
  };
}

export function isPyodideLike(value: unknown): value is PyodideLike {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const globals = candidate.globals;
  return typeof candidate.runPythonAsync === "function"
    && globals !== null
    && typeof globals === "object"
    && typeof (globals as Record<string, unknown>).set === "function"
    && typeof (globals as Record<string, unknown>).delete === "function";
}

async function execute(pyodide: PyodideLike, source: string, outputBytes: number): Promise<ExecutePayload> {
  const output = new OutputBuffer(outputBytes);
  try {
    const result = await runBridge(pyodide, source, null, "execute");
    appendOutput(output, result);
    if (!result.ok) throw bridgeFailure(result);
    return { stdout: output.stdout(), stderr: output.stderr(), value: null };
  } catch (error) {
    throw pythonOperationFailure(error);
  }
}

async function judge(
  pyodide: PyodideLike,
  source: string,
  cases: readonly JudgeCaseRequest[],
  outputBytes: number,
): Promise<JudgePayload> {
  const budget = new OutputBudget(outputBytes);
  const results: JudgeCasePayload[] = [];
  for (const testCase of cases) {
    results.push(await judgeCase(pyodide, source, testCase, budget));
  }
  return { cases: results };
}

async function judgeCase(
  pyodide: PyodideLike,
  source: string,
  testCase: JudgeCaseRequest,
  budget: OutputBudget,
): Promise<JudgeCasePayload> {
  const output = new OutputBuffer(budget);
  try {
    const result = await runBridge(pyodide, source, testCase.input, "judge");
    appendOutput(output, result);
    if (!result.ok) throw bridgeFailure(result);
    return {
      index: testCase.index,
      ok: true,
      actual: result.value,
      stdout: output.stdout(),
      stderr: output.stderr(),
    };
  } catch (error) {
    return {
      index: testCase.index,
      ok: false,
      failure: pythonOperationFailure(error).failure,
      stdout: output.stdout(),
      stderr: output.stderr(),
    };
  }
}

async function runBridge(
  pyodide: PyodideLike,
  source: string,
  input: JsonValue,
  mode: "execute" | "judge",
): Promise<BridgeResult> {
  let rawResult: unknown;
  try {
    pyodide.globals.set(PYODIDE_BRIDGE_GLOBALS.source, JSON.stringify(source));
    pyodide.globals.set(PYODIDE_BRIDGE_GLOBALS.input, JSON.stringify(input));
    pyodide.globals.set(PYODIDE_BRIDGE_GLOBALS.mode, JSON.stringify(mode));
    rawResult = await pyodide.runPythonAsync(PYODIDE_BRIDGE_PROGRAM);
    return parseBridgeResult(rawResult);
  } finally {
    destroyPyProxy(rawResult);
    pyodide.globals.delete(PYODIDE_BRIDGE_GLOBALS.source);
    pyodide.globals.delete(PYODIDE_BRIDGE_GLOBALS.input);
    pyodide.globals.delete(PYODIDE_BRIDGE_GLOBALS.mode);
  }
}

function parseBridgeResult(value: unknown): BridgeResult {
  if (typeof value !== "string") {
    throw bridgeError("Python bridge did not return a JSON string");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw bridgeError("Python bridge returned invalid JSON");
  }
  if (!isPlainRecord(parsed) || typeof parsed.ok !== "boolean") {
    throw bridgeError("Python bridge returned an invalid result envelope");
  }
  if (parsed.ok) {
    if (!hasExactKeys(parsed, ["ok", "value", "stdout", "stderr"]) || !hasTextStreams(parsed)) {
      throw bridgeError("Python bridge returned an invalid success envelope");
    }
    try {
      return {
        ok: true,
        value: assertJsonValue(parsed.value, "Python bridge result"),
        stdout: parsed.stdout,
        stderr: parsed.stderr,
      };
    } catch (error) {
      throw bridgeError(errorMessage(error) ?? "Python result is not canonical JSON");
    }
  }
  if (
    !hasExactKeys(parsed, ["ok", "kind", "details", "stdout", "stderr"])
    || !hasTextStreams(parsed)
    || (
      parsed.kind !== "python-compile-error"
      && parsed.kind !== "python-runtime-error"
      && parsed.kind !== "json-bridge-error"
    )
    || typeof parsed.details !== "string"
  ) {
    throw bridgeError("Python bridge returned an invalid failure envelope");
  }
  return {
    ok: false,
    kind: parsed.kind,
    details: parsed.details,
    stdout: parsed.stdout,
    stderr: parsed.stderr,
  };
}

function appendOutput(output: OutputBuffer, result: BridgeResult): void {
  output.append("stdout", result.stdout);
  output.append("stderr", result.stderr);
}

function bridgeFailure(result: Extract<BridgeResult, { ok: false }>): RuntimeFailureError {
  if (result.kind === "python-compile-error") {
    return new RuntimeFailureError(compileFailure(
      result.kind,
      "Python source could not be compiled",
      result.details,
    ));
  }
  const message = result.kind === "json-bridge-error"
    ? "Python result is not JSON serializable"
    : "Python execution failed";
  return new RuntimeFailureError(runtimeFailure(result.kind, message, result.details));
}

function pythonOperationFailure(error: unknown): RuntimeFailureError {
  if (error instanceof RuntimeFailureError) return error;
  return new RuntimeFailureError(runtimeFailure(
    "python-runtime-error",
    "Python execution failed",
    errorMessage(error),
  ));
}

function bridgeError(details: string): RuntimeFailureError {
  return new RuntimeFailureError(runtimeFailure(
    "json-bridge-error",
    "Python bridge could not produce canonical JSON",
    details,
  ));
}

function infrastructureError(code: string, message: string): RuntimeFailureError {
  return new RuntimeFailureError({ kind: "infrastructure", code, message, fatal: true });
}

function destroyPyProxy(value: unknown): void {
  if (value !== null && typeof value === "object" && typeof (value as { destroy?: unknown }).destroy === "function") {
    (value as { destroy(): void }).destroy();
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(record: Record<string, unknown>, requiredKeys: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === requiredKeys.length && requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(record, key));
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
