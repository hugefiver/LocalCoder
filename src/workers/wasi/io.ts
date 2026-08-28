import { ConsoleStdout, File, OpenFile, PreopenDirectory, type Fd } from "@bjorn3/browser_wasi_shim";
import { OutputBuffer } from "../shared/output-buffer.js";

export interface WasiIo {
  readonly fds: readonly Fd[];
  finish(): { readonly stdout: string; readonly stderr: string; readonly truncated: boolean };
}

export function createWasiIo(options: {
  readonly stdin: string;
  readonly outputBytes: number;
  readonly preopenedFiles?: Readonly<Record<string, Uint8Array>>;
}): WasiIo {
  const output = new OutputBuffer(options.outputBytes);
  const stdoutDecoder = new TextDecoder();
  const stderrDecoder = new TextDecoder();
  const append = (stream: "stdout" | "stderr", decoder: TextDecoder) => (bytes: Uint8Array): void => {
    output.append(stream, decoder.decode(bytes, { stream: true }));
  };
  const preopened = new Map<string, File>(Object.entries(options.preopenedFiles ?? {}).map(([name, bytes]) => [name, new File(bytes)]));
  const fds: readonly Fd[] = [
    new OpenFile(new File(new TextEncoder().encode(options.stdin))),
    new ConsoleStdout(append("stdout", stdoutDecoder)),
    new ConsoleStdout(append("stderr", stderrDecoder)),
    new PreopenDirectory("/", preopened),
  ];

  return {
    fds,
    finish: () => {
      output.append("stdout", stdoutDecoder.decode());
      output.append("stderr", stderrDecoder.decode());
      const stdout = output.stdout();
      const stderr = output.stderr();
      return { stdout: stdout.text, stderr: stderr.text, truncated: stdout.truncated || stderr.truncated };
    },
  };
}
