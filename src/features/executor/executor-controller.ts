import type { JsonValue } from "../../domain/json-value.js";
import type { LanguageId, RuntimeId } from "../../domain/language.js";
import type { RuntimeAdapterRegistry } from "../../runtime/adapters/registry.js";
import type { RuntimeRegistry } from "../../runtime/registry.js";
import type { Clock } from "../../runtime/worker-port.js";
import { defaultSettings } from "../../storage/record-validation.js";
import type { LocalCoderRepository } from "../../storage/repository.js";
import type { SettingsRecord, StorageState } from "../../storage/schema.js";
import { toRuntimeOption, type RuntimeOptionModel } from "../runtimes/runtime-view-model.js";
import { ExecutorContext } from "./executor-context.js";
import { ExecutorDraftPersistence } from "./executor-draft-persistence.js";
import { ExecutorExecution } from "./executor-execution.js";
import {
  canAttemptExecute,
  createExecutorSnapshot,
  executorErrorMessage,
  executorRuntimeOptions,
  immutableExecutorValue,
  type ExecutorSnapshotPatch,
} from "./executor-model.js";

export interface ExecutorDependencies {
  registry: RuntimeRegistry;
  adapters: RuntimeAdapterRegistry;
  storage: LocalCoderRepository;
  clock: Clock;
}

export interface ExecutorSnapshot {
  phase: "loading" | "ready" | "initializing" | "running" | "cancelling" | "cancelled" | "error";
  runtimeId?: RuntimeId;
  languageId?: LanguageId;
  runtimeOptions: readonly RuntimeOptionModel[];
  source: string;
  output?: { stdout: string; stderr: string; value: JsonValue | null; truncated: boolean };
  elapsedMs?: number;
  storageState: StorageState;
  error?: string;
}

type WarningKind = "read" | "draft" | "settings";

export class ExecutorController {
  readonly #deps: ExecutorDependencies;
  readonly #context: ExecutorContext;
  readonly #drafts: ExecutorDraftPersistence;
  readonly #execution: ExecutorExecution;
  readonly #listeners = new Set<() => void>();
  readonly #unsubscribeRegistry: () => void;
  readonly #unsubscribeStorage: () => void;
  #current: ExecutorSnapshot;
  #settings: SettingsRecord;
  #warningKind: WarningKind | undefined;
  #warning: string | undefined;
  #contextGeneration = 0;
  #operationGeneration = 0;
  #disposed = false;

  constructor(deps: ExecutorDependencies) {
    this.#deps = deps;
    this.#context = new ExecutorContext(deps);
    this.#execution = new ExecutorExecution(deps.adapters);
    this.#settings = defaultSettings(deps.clock.now());
    this.#current = createExecutorSnapshot({
      phase: "loading",
      runtimeOptions: executorRuntimeOptions(deps.registry),
      source: "",
      storageState: immutableExecutorValue(deps.storage.storageState),
    });
    this.#drafts = new ExecutorDraftPersistence({
      clock: deps.clock,
      storage: deps.storage,
      onSaved: () => this.#clearWarning("draft"),
      onFailure: (error) => this.#setWarning("draft", "草稿未保存", error),
    });
    this.#unsubscribeRegistry = deps.registry.subscribe(() => this.#handleRegistryChange());
    this.#unsubscribeStorage = deps.storage.subscribeStorageState((storageState) => {
      this.#replace({ storageState: immutableExecutorValue(storageState) });
    });
  }

  get snapshot(): ExecutorSnapshot {
    return this.#current;
  }

  async load(): Promise<void> {
    this.#assertUsable();
    const generation = this.#beginContextChange();
    await this.#drafts.flush();
    if (!this.#isCurrentContext(generation)) return;
    this.#publish(createExecutorSnapshot({
      phase: "loading",
      runtimeOptions: executorRuntimeOptions(this.#deps.registry),
      source: "",
      storageState: immutableExecutorValue(this.#deps.storage.storageState),
      ...(this.#warning === undefined ? {} : { error: this.#warning }),
    }));

    const loaded = await this.#context.load();
    if (!this.#isCurrentContext(generation)) return;
    this.#settings = loaded.settings;
    const issue = loaded.issues[loaded.issues.length - 1];
    if (issue !== undefined) this.#recordWarning(issue.kind, issue.label, issue.error);
    const capability = loaded.capability;
    if (capability === undefined) {
      this.#replace({
        phase: "error",
        source: "",
        error: "没有可用于自由执行的本地运行时。请检查运行时资源。",
      });
      return;
    }
    this.#publish(createExecutorSnapshot({
      phase: "ready",
      runtimeId: capability.runtimeId,
      languageId: capability.languageId,
      runtimeOptions: executorRuntimeOptions(this.#deps.registry),
      source: loaded.source,
      storageState: immutableExecutorValue(this.#deps.storage.storageState),
      ...(this.#warning === undefined ? {} : { error: this.#warning }),
    }));
  }

  async selectRuntime(runtimeId: RuntimeId): Promise<void> {
    this.#assertUsable();
    const capability = this.#deps.registry.get(runtimeId);
    if (runtimeId === this.#current.runtimeId) return;
    const option = toRuntimeOption(capability, "execute");
    if (option.disabled) {
      throw new RangeError(`运行时不可用：${option.reason ?? option.statusLabel}`);
    }
    const generation = this.#beginContextChange();
    this.#replace({ phase: "loading", error: this.#warning });
    await this.#drafts.flush();
    if (!this.#isCurrentContext(generation)) return;
    const restored = await this.#context.restoreDraft(capability.languageId, capability.runtimeId);
    if (!this.#isCurrentContext(generation)) return;
    if (restored.issue !== undefined) this.#recordWarning(restored.issue.kind, restored.issue.label, restored.issue.error);
    const preference = await this.#context.savePreference(this.#settings, capability.languageId, capability.runtimeId);
    if (!this.#isCurrentContext(generation)) return;
    this.#settings = preference.settings;
    if (preference.saved) this.#clearWarning("settings");
    else if (preference.issue !== undefined) {
      this.#recordWarning(preference.issue.kind, preference.issue.label, preference.issue.error);
    }
    this.#publish(createExecutorSnapshot({
      phase: "ready",
      runtimeId: capability.runtimeId,
      languageId: capability.languageId,
      runtimeOptions: executorRuntimeOptions(this.#deps.registry),
      source: restored.source,
      storageState: immutableExecutorValue(this.#deps.storage.storageState),
      ...(this.#warning === undefined ? {} : { error: this.#warning }),
    }));
  }

  edit(source: string): void {
    this.#assertUsable();
    const languageId = this.#requireLanguageId();
    const runtimeId = this.#requireRuntimeId();
    this.#replace({ source });
    this.#drafts.schedule({
      workspaceId: "executor",
      languageId,
      runtimeId,
      source,
      updatedAt: this.#deps.clock.now(),
    });
  }

  async execute(): Promise<void> {
    this.#assertUsable();
    if (this.#execution.active) throw new Error("已有执行任务正在进行");
    const runtimeId = this.#requireRuntimeId();
    const capability = this.#deps.registry.get(runtimeId);
    if (!canAttemptExecute(capability)) throw new Error("当前运行时不可用于自由执行");
    const contextGeneration = this.#contextGeneration;
    const operationGeneration = ++this.#operationGeneration;
    let executionStartedAt: number | undefined;
    this.#replace({
      output: undefined,
      elapsedMs: undefined,
      error: this.#warning,
    });

    const completion = await this.#execution.execute(runtimeId, this.#current.source, (phase) => {
      if (!this.#isCurrentOperation(contextGeneration, operationGeneration)) return;
      if (phase === "initializing") {
        this.#replace({ phase: "initializing" });
        return;
      }
      if (executionStartedAt === undefined) executionStartedAt = this.#deps.clock.now();
      this.#replace({ phase: "running" });
    });
    if (!this.#isCurrentOperation(contextGeneration, operationGeneration)) return;
    const elapsedMs = executionStartedAt === undefined ? 0 : Math.max(0, this.#deps.clock.now() - executionStartedAt);
    if (completion.kind === "cancelled") {
      this.#replace({
        phase: "cancelled",
        output: undefined,
        elapsedMs,
        error: this.#warning,
      });
      return;
    }
    if (completion.kind === "failure") {
      this.#replace({
        phase: "error",
        output: undefined,
        elapsedMs,
        error: `执行失败：${executorErrorMessage(completion.error)}`,
      });
      return;
    }
    this.#replace({
      phase: "ready",
      output: immutableExecutorValue({
        stdout: completion.invocation.payload.stdout.text,
        stderr: completion.invocation.payload.stderr.text,
        value: completion.invocation.payload.value,
        truncated: completion.invocation.payload.stdout.truncated || completion.invocation.payload.stderr.truncated,
      }),
      elapsedMs,
      error: this.#warning,
    });
  }

  cancel(): void {
    if (!this.#disposed && this.#execution.cancel()) this.#replace({ phase: "cancelling" });
  }

  clearOutput(): void {
    this.#assertUsable();
    this.#replace({ output: undefined, elapsedMs: undefined });
  }

  subscribe(listener: () => void): () => void {
    if (this.#disposed) return () => undefined;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getSnapshot(): ExecutorSnapshot {
    return this.#current;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#contextGeneration += 1;
    this.#operationGeneration += 1;
    this.#execution.invalidate();
    this.#drafts.dispose();
    this.#unsubscribeRegistry();
    this.#unsubscribeStorage();
    this.#listeners.clear();
  }

  #beginContextChange(): number {
    this.#contextGeneration += 1;
    this.#operationGeneration += 1;
    this.#execution.invalidate();
    return this.#contextGeneration;
  }

  #isCurrentContext(generation: number): boolean {
    return !this.#disposed && generation === this.#contextGeneration;
  }

  #isCurrentOperation(contextGeneration: number, operationGeneration: number): boolean {
    return this.#isCurrentContext(contextGeneration) && operationGeneration === this.#operationGeneration;
  }

  #handleRegistryChange(): void {
    if (this.#disposed) return;
    this.#replace({ runtimeOptions: executorRuntimeOptions(this.#deps.registry) });
  }

  #setWarning(kind: WarningKind, label: string, error: unknown): void {
    this.#recordWarning(kind, label, error);
    this.#replace({ error: this.#warning });
  }

  #recordWarning(kind: WarningKind, label: string, error: unknown): void {
    this.#warningKind = kind;
    this.#warning = `未保存：${label}。请检查浏览器存储后重试（${executorErrorMessage(error)}）`;
  }

  #clearWarning(kind: WarningKind): void {
    if (this.#deps.storage.storageState.kind !== "persistent" || this.#warningKind !== kind) return;
    const previous = this.#warning;
    this.#warningKind = undefined;
    this.#warning = undefined;
    if (this.#current.error === previous) this.#replace({ error: undefined });
  }

  #requireRuntimeId(): RuntimeId {
    if (this.#current.runtimeId === undefined) throw new Error("尚未选择运行时");
    return this.#current.runtimeId;
  }

  #requireLanguageId(): LanguageId {
    if (this.#current.languageId === undefined) throw new Error("尚未选择语言");
    return this.#current.languageId;
  }

  #assertUsable(): void {
    if (this.#disposed) throw new Error("Executor controller is disposed");
  }

  #replace(patch: ExecutorSnapshotPatch): void {
    if (this.#disposed) return;
    this.#publish(createExecutorSnapshot({ ...this.#current, ...patch }));
  }

  #publish(snapshot: ExecutorSnapshot): void {
    if (this.#disposed) return;
    this.#current = snapshot;
    for (const listener of [...this.#listeners]) {
      if (!this.#listeners.has(listener)) continue;
      try {
        listener();
      } catch {
        continue;
      }
    }
  }
}
