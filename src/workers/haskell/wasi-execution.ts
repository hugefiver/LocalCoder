import { OutputBuffer } from "../shared/output-buffer.js";
import { type HaskellRunnerMetadata } from "./assets.js";
import {
  type HaskellWasiDirectory,
  type HaskellWasiFile,
  type HaskellWasiFilesystemShim,
} from "./tar-filesystem.js";

interface HaskellWasiInstance {
  readonly wasiImport: WebAssembly.ModuleImports;
  start(instance: WebAssembly.Instance): number;
}

export interface HaskellWasiShim extends HaskellWasiFilesystemShim {
  readonly WASI: new (args: string[], env: string[], fds: unknown[]) => HaskellWasiInstance;
  readonly OpenFile: new (file: HaskellWasiFile) => unknown;
  readonly ConsoleStdout: new (write: (bytes: Uint8Array) => void) => unknown;
  readonly PreopenDirectory: new (name: string, contents: Map<string, HaskellWasiFile | HaskellWasiDirectory>) => unknown;
}

export interface WasiResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly truncated: boolean;
}

export async function runHaskellWasi(options: {
  readonly shim: HaskellWasiShim;
  readonly wasm: BufferSource | WebAssembly.Module;
  readonly args: string[];
  readonly stdin: string;
  readonly root: HaskellWasiDirectory;
  readonly metadata: HaskellRunnerMetadata;
  readonly outputBytes: number;
}): Promise<WasiResult> {
  const output = new OutputBuffer(options.outputBytes);
  const stdoutDecoder = new TextDecoder();
  const stderrDecoder = new TextDecoder();
  const append = (stream: "stdout" | "stderr", decoder: TextDecoder) => (bytes: Uint8Array): void => {
    output.append(stream, decoder.decode(bytes, { stream: true }));
  };
  const wasi = new options.shim.WASI(
    options.args,
    [
      `PWD=${options.metadata.workDir}`,
      `GHC_PACKAGE_PATH=${options.metadata.libdirPath}/package.conf.d`,
    ],
    [
      new options.shim.OpenFile(new options.shim.File(new TextEncoder().encode(options.stdin))),
      new options.shim.ConsoleStdout(append("stdout", stdoutDecoder)),
      new options.shim.ConsoleStdout(append("stderr", stderrDecoder)),
      new options.shim.PreopenDirectory("/", options.root.contents),
    ],
  );
  const module = options.wasm instanceof WebAssembly.Module ? options.wasm : await WebAssembly.compile(options.wasm);
  const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport });
  let exitCode: number;
  try {
    exitCode = wasi.start(instance);
  } catch (error) {
    if (hasExitCode(error)) exitCode = error.code;
    else throw error;
  }
  output.append("stdout", stdoutDecoder.decode());
  output.append("stderr", stderrDecoder.decode());
  const stdout = output.stdout();
  const stderr = output.stderr();
  return { stdout: stdout.text, stderr: stderr.text, exitCode, truncated: stdout.truncated || stderr.truncated };
}

export function assertHaskellWasiShim(shim: HaskellWasiShim): void {
  if (
    typeof shim.WASI !== "function" || typeof shim.File !== "function" || typeof shim.Directory !== "function"
    || typeof shim.OpenFile !== "function" || typeof shim.ConsoleStdout !== "function" || typeof shim.PreopenDirectory !== "function"
  ) {
    throw new TypeError("Local Haskell WASI shim has an incompatible API");
  }
}

function hasExitCode(value: unknown): value is { readonly code: number } {
  return value !== null && typeof value === "object" && typeof (value as { code?: unknown }).code === "number";
}
