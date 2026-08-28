import { WASI } from "@bjorn3/browser_wasi_shim";
import { createWasiIo } from "./io.js";

export interface WasiExecution {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly truncated: boolean;
}

export type AssetFetcher = (url: string) => Promise<ArrayBuffer>;

export interface WasiRunOptions {
  readonly wasm: ArrayBuffer;
  readonly stdin: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly outputBytes: number;
  readonly preopenedFiles?: Readonly<Record<string, Uint8Array>>;
}

interface WasiStartableInstance extends WebAssembly.Instance {
  readonly exports: {
    readonly memory: WebAssembly.Memory;
    _start(): unknown;
  };
}

export async function runWasiModule(options: WasiRunOptions): Promise<WasiExecution> {
  const io = createWasiIo(options);
  const wasi = new WASI(
    ["rustpython-runner", ...options.args],
    Object.entries(options.env).map(([name, value]) => `${name}=${value}`),
    [...io.fds],
  );
  const module = await WebAssembly.compile(options.wasm);
  const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport });
  if (!isWasiStartable(instance)) throw new TypeError("WASI module does not export memory and _start");
  const exitCode = wasi.start(instance);
  return { ...io.finish(), exitCode };
}

function isWasiStartable(instance: WebAssembly.Instance): instance is WasiStartableInstance {
  return instance.exports.memory instanceof WebAssembly.Memory && typeof instance.exports._start === "function";
}
