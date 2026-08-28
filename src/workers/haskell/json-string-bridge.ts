import { assertJsonValue, type JsonValue } from "../../domain/json-value.js";

export function encodeHaskellJsonInput(value: JsonValue): string {
  return JSON.stringify(assertJsonValue(value, "Haskell bridge input"));
}

export function decodeHaskellJsonOutput(text: string): JsonValue {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new TypeError("Haskell bridge did not return strict canonical JSON");
  }
  try {
    return assertJsonValue(value, "Haskell bridge output");
  } catch {
    throw new TypeError("Haskell bridge did not return strict canonical JSON");
  }
}

export function wrapHaskellJudgeSource(source: string): string {
  if (hasTopLevelMain(source)) {
    throw new TypeError("Haskell judge sources defining main are unsupported");
  }
  if (/^\s*module\s+/m.test(source)) {
    throw new TypeError("Haskell judge sources declaring a module are unsupported");
  }
  return `${source}\n\nmain :: IO ()\nmain = do\n  __lc_input <- getContents\n  putStr (solution __lc_input)\n`;
}

function hasTopLevelMain(source: string): boolean {
  return /^main\s*(?:::\s*|=)/m.test(source);
}
