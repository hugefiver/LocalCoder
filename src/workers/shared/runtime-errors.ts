import { type RuntimeFailure } from "../../runtime/protocol.js";

const encoder = new TextEncoder();
const MAX_DETAILS_BYTES = 8_192;

export class RuntimeFailureError extends Error {
  constructor(readonly failure: RuntimeFailure) {
    super(failure.message);
    this.name = "RuntimeFailureError";
  }
}

export function compileFailure(code: string, message: string, details?: string): RuntimeFailure {
  return failure("compile", code, message, false, details);
}

export function runtimeFailure(code: string, message: string, details?: string): RuntimeFailure {
  return failure("runtime", code, message, false, details);
}

export function endpointFailure(error: unknown): RuntimeFailure {
  if (error instanceof RuntimeFailureError) return error.failure;
  return failure("infrastructure", "runtime-endpoint-failure", "Runtime endpoint operation failed", true, errorDetails(error));
}

export function evaluationFailure(error: unknown): RuntimeFailure {
  if (error instanceof RuntimeFailureError) return error.failure;
  return runtimeFailure("javascript-runtime-error", "JavaScript execution failed", errorDetails(error));
}

function failure(
  kind: RuntimeFailure["kind"],
  code: string,
  message: string,
  fatal: boolean,
  details?: string,
): RuntimeFailure {
  return {
    kind,
    code,
    message,
    fatal,
    ...(details === undefined || details.length === 0 ? {} : { details: truncateUtf8(details, MAX_DETAILS_BYTES) }),
  };
}

function errorDetails(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return undefined;
}

function truncateUtf8(text: string, limit: number): string {
  let bytes = 0;
  let result = "";
  for (const codePoint of text) {
    const codePointBytes = encoder.encode(codePoint).byteLength;
    if (bytes + codePointBytes > limit) break;
    result += codePoint;
    bytes += codePointBytes;
  }
  return result;
}
