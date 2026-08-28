import { assertJsonValue, type JsonValue } from "../../domain/json-value.js";

export interface RustPythonPayload {
  readonly mode: "execute" | "judge";
  readonly source: string;
  readonly input?: JsonValue;
}

export function makeRustPythonPayload(payload: RustPythonPayload): string {
  if (typeof payload.source !== "string") throw new TypeError("RustPython source must be a string");
  if (payload.mode !== "execute" && payload.mode !== "judge") throw new TypeError("RustPython mode must be execute or judge");
  const input = payload.input === undefined ? undefined : assertJsonValue(payload.input, "RustPython input");
  return JSON.stringify({
    mode: payload.mode,
    source: payload.source,
    ...(input === undefined ? {} : { input }),
  });
}
