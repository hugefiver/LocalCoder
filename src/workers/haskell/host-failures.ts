import { type BoundedText, type RuntimeFailure } from "../../runtime/protocol.js";
import { OutputBuffer } from "../shared/output-buffer.js";
import { RuntimeFailureError, compileFailure, runtimeFailure } from "../shared/runtime-errors.js";
import { type WasiResult } from "./wasi-execution.js";

export interface HaskellResult {
  readonly stdout: BoundedText;
  readonly stderr: BoundedText;
  readonly judgeOutput: string;
  readonly truncated: boolean;
}

export class HaskellOperationError extends RuntimeFailureError {
  constructor(
    failure: RuntimeFailure,
    readonly stdout: BoundedText,
    readonly stderr: BoundedText,
  ) {
    super(failure);
  }
}

export function resultFromWasi(
  outputBytes: number,
  compiler: WasiResult,
  judgeOutput: string,
  program?: WasiResult,
): HaskellResult {
  const output = new OutputBuffer(outputBytes);
  output.append("stdout", compiler.stdout);
  output.append("stderr", compiler.stderr);
  if (program !== undefined) {
    output.append("stdout", program.stdout);
    output.append("stderr", program.stderr);
  }
  const stdout = output.stdout();
  const stderr = output.stderr();
  return { stdout, stderr, judgeOutput, truncated: compiler.truncated || program?.truncated === true || stdout.truncated || stderr.truncated };
}

export function wasiFailure(
  kind: "compile" | "runtime",
  code: string,
  message: string,
  result: WasiResult,
  outputBytes: number,
): HaskellOperationError {
  const output = new OutputBuffer(outputBytes);
  output.append("stdout", result.stdout);
  output.append("stderr", result.stderr);
  const details = [result.stderr, result.stdout].filter((text) => text.length > 0).join("\n");
  const failure = kind === "compile" ? compileFailure(code, message, details) : runtimeFailure(code, message, details);
  return new HaskellOperationError(failure, output.stdout(), output.stderr());
}

export function jsonBridgeFailure(error: unknown, stdout: BoundedText, stderr: BoundedText): HaskellOperationError {
  const details = error instanceof Error ? error.message : undefined;
  return new HaskellOperationError(
    runtimeFailure("json-bridge-error", "Haskell bridge could not produce canonical JSON", details),
    stdout,
    stderr,
  );
}

export function outputLimitFailure(stdout: BoundedText, stderr: BoundedText): HaskellOperationError {
  return new HaskellOperationError(
    runtimeFailure("json-bridge-error", "Haskell output exceeded the allowed size"),
    stdout,
    stderr,
  );
}

export function sourceConflictFailure(error: unknown): HaskellOperationError {
  const details = error instanceof Error ? error.message : undefined;
  return new HaskellOperationError(
    compileFailure("haskell-source-conflict", "Haskell judge source is unsupported", details),
    emptyBoundedText(),
    emptyBoundedText(),
  );
}

export function operationError(error: unknown): HaskellOperationError {
  if (error instanceof HaskellOperationError) return error;
  if (error instanceof RuntimeFailureError) return new HaskellOperationError(error.failure, emptyBoundedText(), emptyBoundedText());
  const details = error instanceof Error ? error.message : typeof error === "string" ? error : undefined;
  return new HaskellOperationError(runtimeFailure("haskell-runtime-error", "Haskell execution failed", details), emptyBoundedText(), emptyBoundedText());
}

export function infrastructureError(code: string, message: string): RuntimeFailureError {
  return new RuntimeFailureError({ kind: "infrastructure", code, message, fatal: true });
}

export function retainTruncation(output: BoundedText, source: BoundedText): BoundedText {
  return { ...output, truncated: output.truncated || source.truncated };
}

export function emptyBoundedText(): BoundedText {
  return { text: "", bytes: 0, truncated: false };
}
