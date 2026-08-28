import {
  type ExecutePayload,
  type InitializePayload,
  type JudgeCasePayload,
  type JudgeCaseRequest,
  type JudgePayload,
  MAX_OUTPUT_BYTES,
} from "../../runtime/protocol.js";
import { type WorkerRuntime } from "../shared/endpoint.js";
import { OutputBuffer, OutputBudget } from "../shared/output-buffer.js";
import { type HaskellLoadedAssets, type HaskellRunnerMetadata } from "./assets.js";
import {
  type HaskellResult,
  infrastructureError,
  jsonBridgeFailure,
  operationError,
  outputLimitFailure,
  retainTruncation,
  resultFromWasi,
  sourceConflictFailure,
  wasiFailure,
} from "./host-failures.js";
import { type JsonValue } from "../../domain/json-value.js";
import { decodeHaskellJsonOutput, encodeHaskellJsonInput, wrapHaskellJudgeSource } from "./json-string-bridge.js";
import {
  createHaskellOperationFilesystem,
  parseHaskellLibdirTar,
  type HaskellTarEntry,
  type HaskellWasiDirectory,
  type HaskellWasiFile,
} from "./tar-filesystem.js";
import { assertHaskellWasiShim, runHaskellWasi, type HaskellWasiShim } from "./wasi-execution.js";

export type { HaskellWasiShim } from "./wasi-execution.js";

export interface HaskellHostOptions {
  readonly loadAssets: () => Promise<HaskellLoadedAssets>;
  readonly loadWasiShim: (url: string) => Promise<HaskellWasiShim>;
  readonly outputBytes?: number;
  readonly buildId?: string;
}

interface PreparedHaskellRuntime {
  readonly metadata: HaskellRunnerMetadata;
  readonly shim: HaskellWasiShim;
  readonly ghcModule: WebAssembly.Module;
  readonly libdirEntries: readonly HaskellTarEntry[];
}

const HASKELL_RUNTIME_VERSION = "ghc-wasi-v1";

export function createHaskellHost(options: HaskellHostOptions): WorkerRuntime {
  const outputBytes = options.outputBytes ?? MAX_OUTPUT_BYTES;
  const buildId = options.buildId ?? injectedBuildId();
  let prepared: Promise<PreparedHaskellRuntime> | undefined;

  const runtime = (): Promise<PreparedHaskellRuntime> => {
    if (prepared === undefined) prepared = prepareRuntime(options);
    return prepared;
  };
  const invoke = async (source: string, input: string | undefined, judge: boolean): Promise<HaskellResult> => {
    try {
      return await runHaskell(await runtime(), source, input, judge, outputBytes);
    } catch (error) {
      throw operationError(error);
    }
  };

  return {
    initialize: async (): Promise<InitializePayload> => {
      try {
        await runtime();
      } catch {
        throw infrastructureError("haskell-initialization-failed", "Local Haskell runtime could not initialize");
      }
      return { runtimeVersion: HASKELL_RUNTIME_VERSION, buildId, capabilities: { execute: true, judge: true } };
    },
    execute: async (source): Promise<ExecutePayload> => {
      const result = await invoke(source, undefined, false);
      return { stdout: result.stdout, stderr: result.stderr, value: null };
    },
    judge: async (source, cases): Promise<JudgePayload> => {
      const budget = new OutputBudget(outputBytes);
      const results: JudgeCasePayload[] = [];
      for (const testCase of cases) results.push(await judgeCase(invoke, source, testCase, budget));
      return { cases: results };
    },
    dispose: async (): Promise<void> => {
      prepared = undefined;
    },
  };
}

async function prepareRuntime(options: HaskellHostOptions): Promise<PreparedHaskellRuntime> {
  const assets = await options.loadAssets();
  if (assets.metadata.executorMode === "ghci" || assets.metadata.testMode === "ghci") {
    throw new TypeError("Haskell metadata selects unsupported GHCi mode");
  }
  const shim = await options.loadWasiShim(assets.wasiShimUrl);
  assertHaskellWasiShim(shim);
  return {
    metadata: assets.metadata,
    shim,
    ghcModule: await WebAssembly.compile(assets.ghcWasm),
    libdirEntries: parseHaskellLibdirTar(new Uint8Array(assets.libdirTar)),
  };
}

async function runHaskell(
  runtime: PreparedHaskellRuntime,
  source: string,
  input: string | undefined,
  judge: boolean,
  outputBytes: number,
): Promise<HaskellResult> {
  const sourceText = judgeSource(source, judge);
  const mode = judge ? runtime.metadata.testMode : runtime.metadata.executorMode;
  if (mode === "ghci") throw new TypeError("Haskell metadata selects unsupported GHCi mode");
  const filesystem = createHaskellOperationFilesystem(runtime.shim, runtime.libdirEntries, runtime.metadata);
  filesystem.work.contents.set("Main.hs", new runtime.shim.File(new TextEncoder().encode(sourceText)));
  filesystem.work.contents.set(".ghc", new runtime.shim.Directory(new Map()));

  const compiler = await runCompiler(runtime, filesystem.root, input ?? "", mode, outputBytes);
  if (compiler.exitCode !== 0) {
    throw wasiFailure("compile", "haskell-compile-error", "Haskell source could not be compiled", compiler, outputBytes);
  }
  if (mode === "ghc-e") return resultFromWasi(outputBytes, compiler, compiler.stdout);
  const program = filesystem.work.contents.get("program.wasm");
  if (!isFile(program)) {
    throw wasiFailure("compile", "haskell-compile-output-missing", "Haskell compiler did not produce a WASI program", compiler, outputBytes);
  }
  const executed = await runHaskellWasi({
    shim: runtime.shim,
    wasm: program.data,
    args: ["program.wasm"],
    stdin: input ?? "",
    root: filesystem.root,
    metadata: runtime.metadata,
    outputBytes,
  });
  if (executed.exitCode !== 0) {
    throw wasiFailure("runtime", "haskell-runtime-error", "Haskell program exited unsuccessfully", executed, outputBytes);
  }
  return resultFromWasi(outputBytes, compiler, executed.stdout, executed);
}

async function runCompiler(
  runtime: PreparedHaskellRuntime,
  root: HaskellWasiDirectory,
  stdin: string,
  mode: "ghc-e" | "ghc-compile",
  outputBytes: number,
) {
  const args = mode === "ghc-e"
    ? ["ghc", "-ignore-dot-ghci", "-v0", "-B", runtime.metadata.libdirPath, "-e", "main", `${runtime.metadata.workDir}/Main.hs`]
    : [
      "ghc", "-ignore-dot-ghci", "-v0", "-B", runtime.metadata.libdirPath,
      "-outputdir", `${runtime.metadata.workDir}/.ghc`, "-o", `${runtime.metadata.workDir}/program.wasm`, `${runtime.metadata.workDir}/Main.hs`,
    ];
  return runHaskellWasi({ shim: runtime.shim, wasm: runtime.ghcModule, args, stdin, root, metadata: runtime.metadata, outputBytes });
}

async function judgeCase(
  invoke: (source: string, input: string | undefined, judge: boolean) => Promise<HaskellResult>,
  source: string,
  testCase: JudgeCaseRequest,
  budget: OutputBudget,
): Promise<JudgeCasePayload> {
  const output = new OutputBuffer(budget);
  try {
    const result = await invoke(source, encodeHaskellJsonInput(testCase.input), true);
    if (result.truncated) throw outputLimitFailure(result.stdout, result.stderr);
    let actual: JsonValue;
    try {
      actual = decodeHaskellJsonOutput(result.judgeOutput);
    } catch (error) {
      throw jsonBridgeFailure(error, result.stdout, result.stderr);
    }
    output.append("stdout", result.stdout.text);
    output.append("stderr", result.stderr.text);
    return { index: testCase.index, ok: true, actual, stdout: output.stdout(), stderr: output.stderr() };
  } catch (error) {
    const failure = operationError(error);
    output.append("stdout", failure.stdout.text);
    output.append("stderr", failure.stderr.text);
    return {
      index: testCase.index,
      ok: false,
      failure: failure.failure,
      stdout: retainTruncation(output.stdout(), failure.stdout),
      stderr: retainTruncation(output.stderr(), failure.stderr),
    };
  }
}

function judgeSource(source: string, judge: boolean): string {
  if (!judge) return source;
  try {
    return wrapHaskellJudgeSource(source);
  } catch (error) {
    throw sourceConflictFailure(error);
  }
}

function isFile(value: HaskellWasiFile | HaskellWasiDirectory | undefined): value is HaskellWasiFile {
  return value !== undefined && "data" in value;
}

function injectedBuildId(): string {
  return typeof __LOCALCODER_BUILD_ID__ === "string" ? __LOCALCODER_BUILD_ID__ : "development";
}

declare const __LOCALCODER_BUILD_ID__: string;
