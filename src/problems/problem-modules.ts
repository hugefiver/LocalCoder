import type { Problem } from "../domain/problem.js";
import { createProblemRepository } from "./problem-repository.js";

const modules = import.meta.glob("./*.md", {
  query: "?raw",
  import: "default",
});

const repository = createProblemRepository(
  modules as Record<string, () => Promise<string>>,
);

export const languageInfo = {
  javascript: {
    name: "JavaScript",
    description: "Run JavaScript code directly in the browser",
  },
  typescript: {
    name: "TypeScript",
    description: "TypeScript transpiled in-browser using the official compiler (no type checking)",
  },
  python: {
    name: "Python",
    description: "CPython via Pyodide WebAssembly",
  },
  rustpython: {
    name: "RustPython",
    description: "Python via RustPython (WASI WebAssembly)",
  },
  racket: {
    name: "Racket",
    description: "Racket Scheme via official interpreter (WASM)",
  },
  haskell: {
    name: "Haskell",
    description: "Haskell via GHC/GHCi WebAssembly runtime",
  },
} as const;

export function loadProblems(): Promise<readonly Problem[]> {
  return repository.list();
}

export function getProblemById(problemId: number): Promise<Problem | undefined> {
  return repository.getById(problemId);
}
