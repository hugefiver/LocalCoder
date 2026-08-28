import { type RuntimeFailure } from "../../runtime/protocol.js";
import { type WorkerRuntime } from "../shared/endpoint.js";
import { RuntimeFailureError, compileFailure } from "../shared/runtime-errors.js";
import { createJavaScriptRuntime } from "./evaluator.js";

const MAX_DIAGNOSTIC_BYTES = 8_192;
const encoder = new TextEncoder();

export interface TypeScriptDiagnosticLike {
  readonly category: number;
  readonly code: number;
  readonly messageText: unknown;
  readonly start?: number;
  readonly file?: {
    getLineAndCharacterOfPosition(position: number): { readonly line: number; readonly character: number };
  };
}

export interface TypeScriptCompilerLike {
  readonly version: string;
  readonly DiagnosticCategory: { readonly Error: number };
  readonly ModuleKind: { readonly None: number };
  readonly ScriptTarget: { readonly ES2020: number };
  transpileModule(source: string, options: object): {
    readonly outputText: string;
    readonly diagnostics?: readonly TypeScriptDiagnosticLike[];
  };
  flattenDiagnosticMessageText(message: unknown, newline: string): string;
}

export type TranspileResult =
  | { readonly ok: true; readonly code: string; readonly diagnostics: readonly string[] }
  | { readonly ok: false; readonly failure: RuntimeFailure };

export interface TypeScriptRuntimeOptions {
  readonly buildId?: string;
  readonly outputBytes?: number;
  readonly evaluator?: WorkerRuntime;
}

export interface TypeScriptAssetScope {
  importScripts(...urls: string[]): void;
  readonly ts?: unknown;
}

export function transpileTypeScript(compiler: TypeScriptCompilerLike, source: string): TranspileResult {
  const output = compiler.transpileModule(source, {
    compilerOptions: {
      target: compiler.ScriptTarget.ES2020,
      module: compiler.ModuleKind.None,
    },
    reportDiagnostics: true,
  });
  const diagnostics = output.diagnostics ?? [];
  const errors = diagnostics.filter((diagnostic) => diagnostic.category === compiler.DiagnosticCategory.Error);
  if (errors.length > 0) {
    const first = errors[0];
    if (first === undefined) throw new Error("TypeScript diagnostic list unexpectedly lost its first error");
    return {
      ok: false,
      failure: compileFailure(
        "typescript-compile-error",
        `TypeScript compilation failed (${diagnosticCode(first)})${diagnosticLocation(first)}`,
        diagnosticText(compiler, errors),
      ),
    };
  }

  return {
    ok: true,
    code: output.outputText,
    diagnostics: boundedDiagnostics(diagnostics.map((diagnostic) => formatDiagnostic(compiler, diagnostic))),
  };
}

export function createTypeScriptRuntime(
  compiler: TypeScriptCompilerLike,
  options: TypeScriptRuntimeOptions = {},
): WorkerRuntime {
  const evaluator = options.evaluator ?? createJavaScriptRuntime({
    ...(options.buildId === undefined ? {} : { buildId: options.buildId }),
    ...(options.outputBytes === undefined ? {} : { outputBytes: options.outputBytes }),
  });

  return {
    initialize: async () => {
      const initialized = await evaluator.initialize();
      return { ...initialized, runtimeVersion: compiler.version };
    },
    execute: async (source) => evaluator.execute(emittedFreeCode(compiler, source)),
    judge: async (source, cases) => evaluator.judge(emittedCode(compiler, source), cases),
    dispose: async () => evaluator.dispose(),
  };
}

export function createTypeScriptAssetRuntime(
  scope: TypeScriptAssetScope,
  options: TypeScriptRuntimeOptions = {},
): WorkerRuntime {
  let runtime: WorkerRuntime | undefined;

  const initializedRuntime = (): WorkerRuntime => {
    if (runtime !== undefined) return runtime;
    throw new RuntimeFailureError(infrastructureFailure(
      "typescript-not-initialized",
      "TypeScript runtime must initialize before execution",
    ));
  };

  return {
    initialize: async () => {
      runtime = createTypeScriptRuntime(loadTypeScriptCompiler(scope), options);
      return runtime.initialize();
    },
    execute: async (source) => initializedRuntime().execute(source),
    judge: async (source, cases) => initializedRuntime().judge(source, cases),
    dispose: async () => {
      if (runtime !== undefined) await runtime.dispose();
    },
  };
}

export function loadTypeScriptCompiler(scope: TypeScriptAssetScope): TypeScriptCompilerLike {
  try {
    scope.importScripts("./typescript/typescript.js");
  } catch {
    throw new RuntimeFailureError(infrastructureFailure(
      "typescript-asset-missing",
      "Official TypeScript compiler asset could not be loaded",
    ));
  }

  if (!isTypeScriptCompiler(scope.ts)) {
    throw new RuntimeFailureError(infrastructureFailure(
      "typescript-api-incompatible",
      "Official TypeScript compiler asset has an incompatible API",
    ));
  }
  return scope.ts;
}

function emittedCode(compiler: TypeScriptCompilerLike, source: string): string {
  const transpilation = transpileTypeScript(compiler, source);
  if (!transpilation.ok) throw new RuntimeFailureError(transpilation.failure);
  return transpilation.code;
}

function emittedFreeCode(compiler: TypeScriptCompilerLike, source: string): string {
  const wrapperName = "__localcoder_execute__";
  const transpilation = transpileTypeScript(compiler, `function ${wrapperName}() {\n${source}\n}`);
  if (!transpilation.ok) throw new RuntimeFailureError(transpilation.failure);
  return `${transpilation.code}\nreturn ${wrapperName}();`;
}

function diagnosticText(
  compiler: TypeScriptCompilerLike,
  diagnostics: readonly TypeScriptDiagnosticLike[],
): string {
  return boundedDiagnostics(diagnostics.map((diagnostic) => formatDiagnostic(compiler, diagnostic))).join("\n");
}

function formatDiagnostic(compiler: TypeScriptCompilerLike, diagnostic: TypeScriptDiagnosticLike): string {
  const message = compiler.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  return `${diagnosticCode(diagnostic)}${diagnosticLocation(diagnostic)}: ${message}`;
}

function diagnosticCode(diagnostic: TypeScriptDiagnosticLike): string {
  return `TS${diagnostic.code}`;
}

function diagnosticLocation(diagnostic: TypeScriptDiagnosticLike): string {
  if (diagnostic.file === undefined || diagnostic.start === undefined) return "";
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return ` ${position.line + 1}:${position.character + 1}`;
}

function boundedDiagnostics(diagnostics: readonly string[]): readonly string[] {
  const bounded: string[] = [];
  let bytes = 0;
  for (const diagnostic of diagnostics) {
    const delimiterBytes = bounded.length === 0 ? 0 : 1;
    const available = MAX_DIAGNOSTIC_BYTES - bytes - delimiterBytes;
    if (available <= 0) break;
    const text = truncateUtf8(diagnostic, available);
    if (text.length === 0) break;
    bounded.push(text);
    bytes += delimiterBytes + encoder.encode(text).byteLength;
  }
  return bounded;
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

function infrastructureFailure(code: string, message: string): RuntimeFailure {
  return { kind: "infrastructure", code, message, fatal: true };
}

function isTypeScriptCompiler(value: unknown): value is TypeScriptCompilerLike {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.version === "string"
    && candidate.version.trim().length > 0
    && typeof candidate.transpileModule === "function"
    && typeof candidate.flattenDiagnosticMessageText === "function"
    && hasNumber(candidate.DiagnosticCategory, "Error")
    && hasNumber(candidate.ModuleKind, "None")
    && hasNumber(candidate.ScriptTarget, "ES2020");
}

function hasNumber(value: unknown, key: string): boolean {
  return value !== null
    && typeof value === "object"
    && typeof (value as Record<string, unknown>)[key] === "number";
}
