import { type BoundedText, MAX_OUTPUT_BYTES } from "../../runtime/protocol.js";

const encoder = new TextEncoder();

export class OutputBudget {
  #remaining: number;

  constructor(limitBytes = MAX_OUTPUT_BYTES) {
    if (!Number.isSafeInteger(limitBytes) || limitBytes < 0) {
      throw new RangeError("Output limit must be a non-negative safe integer");
    }
    this.#remaining = limitBytes;
  }

  append(text: string): { readonly text: string; readonly truncated: boolean } {
    let bytes = 0;
    let retained = "";
    for (const codePoint of text) {
      const codePointBytes = encoder.encode(codePoint).byteLength;
      if (bytes + codePointBytes > this.#remaining) {
        this.#remaining -= bytes;
        return { text: retained, truncated: true };
      }
      retained += codePoint;
      bytes += codePointBytes;
    }
    this.#remaining -= bytes;
    return { text: retained, truncated: false };
  }
}

export class OutputBuffer {
  readonly #budget: OutputBudget;
  #stdout = "";
  #stderr = "";
  #stdoutTruncated = false;
  #stderrTruncated = false;

  constructor(budget: OutputBudget | number = MAX_OUTPUT_BYTES) {
    this.#budget = typeof budget === "number" ? new OutputBudget(budget) : budget;
  }

  append(stream: "stdout" | "stderr", text: string): void {
    const result = this.#budget.append(text);
    if (stream === "stdout") {
      this.#stdout += result.text;
      this.#stdoutTruncated ||= result.truncated;
      return;
    }
    this.#stderr += result.text;
    this.#stderrTruncated ||= result.truncated;
  }

  stdout(): BoundedText {
    return bounded(this.#stdout, this.#stdoutTruncated);
  }

  stderr(): BoundedText {
    return bounded(this.#stderr, this.#stderrTruncated);
  }
}

function bounded(text: string, truncated: boolean): BoundedText {
  return { text, bytes: encoder.encode(text).byteLength, truncated };
}
