const BRIDGE_HEADROOM_BYTES = 16_384;
const encoder = new TextEncoder();

export class CapturedEmscriptenStreams {
  #stdout = "";
  #stderr = "";
  #bytes = 0;
  readonly #limit: number;

  constructor(outputBytes: number) {
    this.#limit = outputBytes * 4 + BRIDGE_HEADROOM_BYTES;
  }

  append(stream: "stdout" | "stderr", text: string): void {
    if (this.#bytes >= this.#limit) return;
    const retained = truncateUtf8(text, this.#limit - this.#bytes);
    this.#bytes += encoder.encode(retained).byteLength;
    if (stream === "stdout") this.#stdout += retained;
    else this.#stderr += retained;
  }

  stdout(): string {
    return this.#stdout;
  }

  stderr(): string {
    return this.#stderr;
  }
}

function truncateUtf8(text: string, limit: number): string {
  let result = "";
  let bytes = 0;
  for (const codePoint of text) {
    const size = encoder.encode(codePoint).byteLength;
    if (bytes + size > limit) break;
    result += codePoint;
    bytes += size;
  }
  return result;
}
