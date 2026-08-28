import { assertJsonValue, type JsonValue } from "../../domain/json-value.js";
import {
  MAX_OUTPUT_BYTES,
  type ExecutePayload,
  type JudgeCasePayload,
  type JudgeCaseRequest,
  type JudgePayload,
} from "../../runtime/protocol.js";
import { type WorkerRuntime } from "../shared/endpoint.js";
import { OutputBuffer, OutputBudget } from "../shared/output-buffer.js";
import {
  RuntimeFailureError,
  compileFailure,
  evaluationFailure,
  runtimeFailure,
} from "../shared/runtime-errors.js";

declare const __LOCALCODER_BUILD_ID__: string;

export interface JavaScriptRuntimeOptions {
  readonly buildId?: string;
  readonly outputBytes?: number;
  readonly runtimeVersion?: string;
}

const missingSolution = Symbol("missing-solution");

export function createJavaScriptRuntime(options: JavaScriptRuntimeOptions = {}): WorkerRuntime {
  const buildId = options.buildId ?? injectedBuildId();
  const outputBytes = options.outputBytes ?? MAX_OUTPUT_BYTES;
  const runtimeVersion = options.runtimeVersion ?? "javascript-es2020";

  return {
    initialize: async () => ({
      runtimeVersion,
      buildId,
      capabilities: { execute: true, judge: true },
    }),
    execute: async (source) => execute(source, outputBytes),
    judge: async (source, cases) => judge(source, cases, outputBytes),
    dispose: async () => undefined,
  };
}

async function execute(source: string, outputBytes: number): Promise<ExecutePayload> {
  const output = new OutputBuffer(outputBytes);
  try {
    const value = await captureConsole(output, async () => {
      const evaluator = compileFreeSource(source);
      const result = await evaluator();
      return result === undefined ? null : canonicalResult(result);
    });
    return { stdout: output.stdout(), stderr: output.stderr(), value };
  } catch (error) {
    throw new RuntimeFailureError(evaluationFailure(error));
  }
}

async function judge(
  source: string,
  cases: readonly JudgeCaseRequest[],
  outputBytes: number,
): Promise<JudgePayload> {
  const budget = new OutputBudget(outputBytes);
  const results: JudgeCasePayload[] = [];
  for (const testCase of cases) {
    results.push(await judgeCase(source, testCase, budget));
  }
  return { cases: results };
}

async function judgeCase(
  source: string,
  testCase: JudgeCaseRequest,
  budget: OutputBudget,
): Promise<JudgeCasePayload> {
  const output = new OutputBuffer(budget);
  try {
    const actual = await captureConsole(output, async () => {
      const evaluator = compileJudgeSource(source);
      const value = await evaluator(testCase.input, missingSolution);
      if (value === missingSolution) {
        throw new RuntimeFailureError(compileFailure(
          "javascript-entrypoint-missing",
          "JavaScript source must define solution(input)",
        ));
      }
      return canonicalResult(value);
    });
    return {
      index: testCase.index,
      ok: true,
      actual,
      stdout: output.stdout(),
      stderr: output.stderr(),
    };
  } catch (error) {
    return {
      index: testCase.index,
      ok: false,
      failure: evaluationFailure(error),
      stdout: output.stdout(),
      stderr: output.stderr(),
    };
  }
}

function compileFreeSource(source: string): () => unknown {
  try {
    return new Function(`"use strict";\n${source}`) as () => unknown;
  } catch (error) {
    throw new RuntimeFailureError(compileFailure(
      "javascript-compile-error",
      "JavaScript source could not be compiled",
      errorMessage(error),
    ));
  }
}

function compileJudgeSource(source: string): (input: JsonValue, missing: symbol) => unknown {
  try {
    return new Function(
      "input",
      "missing",
      `"use strict";\n${source}\nreturn typeof solution === "function" ? solution(input) : missing;`,
    ) as (input: JsonValue, missing: symbol) => unknown;
  } catch (error) {
    throw new RuntimeFailureError(compileFailure(
      "javascript-compile-error",
      "JavaScript source could not be compiled",
      errorMessage(error),
    ));
  }
}

function canonicalResult(value: unknown): JsonValue {
  try {
    return assertJsonValue(value, "JavaScript result");
  } catch (error) {
    throw new RuntimeFailureError(runtimeFailure(
      "javascript-non-json-result",
      "JavaScript result is not a canonical JSON value",
      errorMessage(error),
    ));
  }
}

async function captureConsole<T>(output: OutputBuffer, operation: () => T | Promise<T>): Promise<T> {
  const consoleObject = globalThis.console;
  const original = {
    log: consoleObject.log,
    info: consoleObject.info,
    debug: consoleObject.debug,
    warn: consoleObject.warn,
    error: consoleObject.error,
  };
  const write = (stream: "stdout" | "stderr", values: unknown[]) => {
    output.append(stream, `${values.map(formatConsoleValue).join(" ")}\n`);
  };
  consoleObject.log = (...values: unknown[]) => write("stdout", values);
  consoleObject.info = (...values: unknown[]) => write("stdout", values);
  consoleObject.debug = (...values: unknown[]) => write("stdout", values);
  consoleObject.warn = (...values: unknown[]) => write("stderr", values);
  consoleObject.error = (...values: unknown[]) => write("stderr", values);
  try {
    return await operation();
  } finally {
    consoleObject.log = original.log;
    consoleObject.info = original.info;
    consoleObject.debug = original.debug;
    consoleObject.warn = original.warn;
    consoleObject.error = original.error;
  }
}

function formatConsoleValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return "[unprintable]";
  }
}

function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : typeof error === "string" ? error : undefined;
}

function injectedBuildId(): string {
  return typeof __LOCALCODER_BUILD_ID__ === "string" ? __LOCALCODER_BUILD_ID__ : "development";
}
