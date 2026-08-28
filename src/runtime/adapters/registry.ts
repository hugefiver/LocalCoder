import { type RuntimeId } from "../../domain/language.js";
import { type RuntimeAdapter } from "./types.js";

export class RuntimeAdapterRegistry {
  readonly #adapters = new Map<RuntimeId, RuntimeAdapter>();

  register(adapter: RuntimeAdapter): void {
    if (this.#adapters.has(adapter.runtimeId)) {
      throw new RangeError(`Runtime adapter ${adapter.runtimeId} is already registered`);
    }
    this.#adapters.set(adapter.runtimeId, adapter);
  }

  get(runtimeId: RuntimeId): RuntimeAdapter {
    const adapter = this.#adapters.get(runtimeId);
    if (adapter === undefined) throw new RangeError(`Runtime adapter registry does not contain ${runtimeId}`);
    return adapter;
  }
}

export { createJavascriptAdapter } from "./javascript.js";
export { createHaskellAdapter } from "./haskell.js";
export { createPythonAdapter } from "./python.js";
export { createRacketAdapter } from "./racket.js";
export { createRustPythonAdapter } from "./rustpython.js";
export { createTypescriptAdapter } from "./typescript.js";
export type { RuntimeAdapter } from "./types.js";
