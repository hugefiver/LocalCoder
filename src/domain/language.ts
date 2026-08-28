export const LANGUAGE_IDS = [
  "javascript",
  "typescript",
  "python",
  "racket",
  "haskell",
] as const;

export type LanguageId = (typeof LANGUAGE_IDS)[number];

export const RUNTIME_IDS = [
  "javascript-worker",
  "typescript-official",
  "python-pyodide",
  "python-rustpython",
  "racket-wasm",
  "haskell-ghc-wasi",
] as const;

export type RuntimeId = (typeof RUNTIME_IDS)[number];
