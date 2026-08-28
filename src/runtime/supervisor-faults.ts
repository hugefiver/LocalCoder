import { type RuntimeFailure } from "./protocol.js";
import { type RuntimeIdentity } from "./supervisor-types.js";

const failureIdentities = new WeakMap<RuntimeFailure, RuntimeIdentity>();

export function runtimeFailure(
  kind: RuntimeFailure["kind"],
  code: string,
  message: string,
  fatal: boolean,
): RuntimeFailure {
  return { kind, code, message, fatal };
}

export function cancelledFailure(): RuntimeFailure {
  return runtimeFailure("cancelled", "cancelled", "Runtime operation was cancelled", true);
}

export function infrastructureFailure(code: string, message: string): RuntimeFailure {
  return runtimeFailure("infrastructure", code, message, true);
}

export function protocolFailure(): RuntimeFailure {
  return runtimeFailure("protocol", "protocol-error", "Worker sent an invalid protocol response", true);
}

export function bindRuntimeFailureIdentity(failure: RuntimeFailure, identity: RuntimeIdentity): RuntimeFailure {
  failureIdentities.set(failure, { ...identity });
  return failure;
}

export function runtimeFailureIdentity(value: unknown): RuntimeIdentity | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const identity = failureIdentities.get(value as RuntimeFailure);
  return identity === undefined ? undefined : { ...identity };
}

export function cloneRuntimeFailure(failure: RuntimeFailure): RuntimeFailure {
  return failure.details === undefined
    ? { kind: failure.kind, code: failure.code, message: failure.message, fatal: failure.fatal }
    : { kind: failure.kind, code: failure.code, message: failure.message, details: failure.details, fatal: failure.fatal };
}
