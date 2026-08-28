import { assertJsonValue } from "../../domain/json-value.js";
import type { LanguageId, RuntimeId } from "../../domain/language.js";
import type { Problem, ProblemCase } from "../../domain/problem.js";
import { MAX_CASE_COUNT } from "../../runtime/manifest.js";
import { defaultSettings } from "../../storage/record-validation.js";
import type { SettingsRecord } from "../../storage/schema.js";
import {
  type PersistenceWarningKind,
  WorkspaceContext,
} from "./workspace-context.js";
import { WorkspaceDraftPersistence } from "./workspace-draft-persistence.js";
import { WorkspaceExecution } from "./workspace-execution.js";
import {
  cancelledResult,
  canAttemptJudge,
  emptyWorkspaceSnapshot,
  errorMessage,
  immutableCases,
  immutableResult,
  immutableStorageState,
  runtimeOptions,
  workspaceSnapshot,
} from "./workspace-model.js";
import type {
  ProblemWorkspaceSnapshot,
  WorkspaceDependencies,
  WorkspaceSnapshotPatch,
} from "./workspace-types.js";
import { WorkspaceWarningState } from "./workspace-warning-state.js";

export type {
  ProblemWorkspaceSnapshot,
  WorkspaceDependencies,
  WorkspacePhase,
} from "./workspace-types.js";

export class ProblemWorkspaceController {
  readonly #deps: WorkspaceDependencies;
  readonly #context: WorkspaceContext;
  readonly #drafts: WorkspaceDraftPersistence;
  readonly #execution: WorkspaceExecution;
  readonly #warnings: WorkspaceWarningState;
  readonly #listeners = new Set<() => void>();
  readonly #unsubscribeRegistry: () => void;
  readonly #unsubscribeStorage: () => void;
  #current: ProblemWorkspaceSnapshot;
  #settings: SettingsRecord;
  #contextGeneration = 0;
  #operationGeneration = 0;
  #customSaveGeneration = 0;
  #disposed = false;

  constructor(deps: WorkspaceDependencies) {
    this.#deps = deps;
    this.#context = new WorkspaceContext(deps);
    this.#execution = new WorkspaceExecution(deps.submissions);
    this.#warnings = new WorkspaceWarningState(() => deps.storage.storageState.kind === "persistent");
    this.#settings = defaultSettings(deps.clock.now());
    this.#current = emptyWorkspaceSnapshot(deps.registry, deps.storage.storageState, "loading");
    this.#drafts = new WorkspaceDraftPersistence({
      clock: deps.clock,
      storage: deps.storage,
      onSaved: () => this.#updateWarning("draft"),
      onFailure: (error) => this.#updateWarning("draft", "草稿未保存", error),
    });
    this.#unsubscribeRegistry = deps.registry.subscribe(() => {
      this.#replace({ runtimeOptions: runtimeOptions(deps.registry, this.#current.problem) });
    });
    this.#unsubscribeStorage = deps.storage.subscribeStorageState((storageState) => {
      this.#replace({ storageState: immutableStorageState(storageState) });
    });
  }

  get snapshot(): ProblemWorkspaceSnapshot {
    return this.#current;
  }

  async load(problemId: number): Promise<void> {
    this.#assertUsable();
    const generation = this.#beginContextChange();
    await this.#drafts.flush();
    if (!this.#isCurrentContext(generation)) return;
    this.#publish(emptyWorkspaceSnapshot(this.#deps.registry, this.#deps.storage.storageState, "loading"));
    const loaded = await this.#context.load(problemId);
    if (!this.#isCurrentContext(generation)) return;
    if (loaded.kind === "not-found" || loaded.kind === "failure") {
      this.#publish(emptyWorkspaceSnapshot(this.#deps.registry, this.#deps.storage.storageState, "error", loaded.error));
      return;
    }
    if (loaded.kind === "no-runtime") {
      this.#publish(workspaceSnapshot({
        phase: "error",
        problem: loaded.problem,
        runtimeOptions: runtimeOptions(this.#deps.registry, loaded.problem),
        source: "",
        customCases: loaded.customCases,
        recentSubmissions: loaded.recentSubmissions,
        storageState: immutableStorageState(this.#deps.storage.storageState),
        error: loaded.error,
      }));
      return;
    }
    this.#settings = loaded.settings;
    this.#warnings.apply(loaded.issue);
    this.#publish(workspaceSnapshot({
      phase: "ready",
      problem: loaded.problem,
      runtimeId: loaded.runtime.runtimeId,
      languageId: loaded.runtime.languageId,
      runtimeOptions: runtimeOptions(this.#deps.registry, loaded.problem),
      source: loaded.source,
      customCases: loaded.customCases,
      recentSubmissions: loaded.recentSubmissions,
      storageState: immutableStorageState(this.#deps.storage.storageState),
      ...(this.#warnings.message === undefined ? {} : { error: this.#warnings.message }),
    }));
  }

  async selectRuntime(runtimeId: RuntimeId): Promise<void> {
    this.#assertUsable();
    const problem = this.#requireProblem();
    const runtime = this.#context.resolveRuntime(problem, runtimeId);
    if (runtimeId === this.#current.runtimeId) return;
    const generation = this.#beginContextChange();
    this.#replace({ phase: "loading", error: this.#warnings.message });
    await this.#drafts.flush();
    if (!this.#isCurrentContext(generation)) return;
    const restored = await this.#context.restoreDraft(problem, runtime.languageId, runtimeId);
    if (!this.#isCurrentContext(generation)) return;
    this.#warnings.apply(restored.issue);
    const preference = await this.#context.persistRuntimePreference(this.#settings, runtime.languageId, runtimeId);
    if (!this.#isCurrentContext(generation)) return;
    this.#settings = preference.settings;
    if (preference.saved) this.#warnings.clear("settings");
    else this.#warnings.apply(preference.issue);
    this.#publish(workspaceSnapshot({
      phase: "ready",
      problem,
      runtimeId,
      languageId: runtime.languageId,
      runtimeOptions: runtimeOptions(this.#deps.registry, problem),
      source: restored.source,
      customCases: this.#current.customCases,
      recentSubmissions: this.#current.recentSubmissions,
      storageState: immutableStorageState(this.#deps.storage.storageState),
      ...(this.#warnings.message === undefined ? {} : { error: this.#warnings.message }),
    }));
  }

  edit(source: string): void {
    this.#assertUsable();
    const problem = this.#requireProblem();
    const languageId = this.#requireLanguageId();
    const runtimeId = this.#requireRuntimeId();
    this.#replace({ source });
    this.#drafts.schedule({
      workspaceId: `problem:${problem.id}`,
      languageId,
      runtimeId,
      source,
      updatedAt: this.#deps.clock.now(),
    });
  }

  async replaceCustomCases(cases: readonly ProblemCase[]): Promise<void> {
    this.#assertUsable();
    const problem = this.#requireProblem();
    if (cases.length > MAX_CASE_COUNT) throw new RangeError(`自定义用例最多 ${MAX_CASE_COUNT} 条`);
    const canonical = immutableCases(cases.map((testCase, index) => ({
      input: assertJsonValue(testCase.input, `customCases[${index}].input`),
      expected: assertJsonValue(testCase.expected, `customCases[${index}].expected`),
    })));
    const contextGeneration = this.#contextGeneration;
    const saveGeneration = ++this.#customSaveGeneration;
    this.#replace({ customCases: canonical });
    try {
      await this.#context.saveCustomCases(problem.id, canonical);
      if (this.#isCurrentSave(contextGeneration, saveGeneration)) this.#updateWarning("custom");
    } catch (error) {
      if (this.#isCurrentSave(contextGeneration, saveGeneration)) {
        this.#updateWarning("custom", "自定义用例未保存", error);
      }
      throw error;
    }
  }

  async run(): Promise<void> {
    await this.#execute("run");
  }

  async submit(): Promise<void> {
    await this.#execute("submit");
  }

  cancel(): void {
    if (!this.#disposed && this.#execution.cancel()) this.#replace({ phase: "cancelling" });
  }

  subscribe(listener: () => void): () => void {
    if (this.#disposed) return () => undefined;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getSnapshot(): ProblemWorkspaceSnapshot {
    return this.#current;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#drafts.dispose();
    this.#disposed = true;
    this.#contextGeneration += 1;
    this.#operationGeneration += 1;
    this.#execution.invalidate();
    this.#unsubscribeRegistry();
    this.#unsubscribeStorage();
    this.#listeners.clear();
  }

  async #execute(mode: "run" | "submit"): Promise<void> {
    this.#assertUsable();
    if (this.#execution.active) throw new Error("已有执行任务正在进行");
    const problem = this.#requireProblem();
    const runtimeId = this.#requireRuntimeId();
    if (!canAttemptJudge(this.#deps.registry.get(runtimeId))) throw new Error("当前运行时不可用于判题");
    const contextGeneration = this.#contextGeneration;
    const operationGeneration = ++this.#operationGeneration;
    this.#replace({ phase: mode === "run" ? "running" : "submitting" });
    const completion = await this.#execution.execute(mode, {
      problem,
      runtimeId,
      source: this.#current.source,
      customCases: this.#current.customCases,
    });
    if (!this.#isCurrentOperation(contextGeneration, operationGeneration)) return;
    if (completion.kind === "failure") {
      this.#replace({ phase: "error", error: `执行失败：${errorMessage(completion.error)}` });
      return;
    }
    if (completion.kind === "cancelled") {
      this.#replace({ phase: "ready", result: cancelledResult(), error: this.#warnings.message });
      return;
    }
    const result = immutableResult(completion.outcome.result);
    if (completion.outcome.persistence.message !== undefined) {
      this.#warnings.set("submission", completion.outcome.persistence.message);
    } else if (mode === "submit" && completion.outcome.persistence.state === "saved") {
      this.#warnings.clear("submission");
    }
    const refresh = mode === "submit"
      ? await this.#context.refreshAfterSubmit(problem.id, result, completion.outcome.persistence.state)
      : {};
    if (!this.#isCurrentOperation(contextGeneration, operationGeneration)) return;
    this.#warnings.apply(refresh.issue);
    if (refresh.records !== undefined) this.#replace({ recentSubmissions: refresh.records });
    this.#replace({ phase: "ready", result, error: this.#warnings.message });
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

  #isCurrentSave(contextGeneration: number, saveGeneration: number): boolean {
    return this.#isCurrentContext(contextGeneration) && saveGeneration === this.#customSaveGeneration;
  }

  #updateWarning(kind: PersistenceWarningKind, label?: string, error?: unknown): void {
    if (label === undefined) this.#warnings.clear(kind);
    else this.#warnings.setFailure(kind, label, error);
    this.#replace({ error: this.#warnings.message });
  }

  #requireProblem(): Problem {
    if (this.#current.problem === undefined) throw new Error("题目尚未加载");
    return this.#current.problem;
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
    if (this.#disposed) throw new Error("Problem workspace controller is disposed");
  }

  #replace(patch: WorkspaceSnapshotPatch): void {
    if (!this.#disposed) this.#publish(workspaceSnapshot({ ...this.#current, ...patch }));
  }

  #publish(snapshot: ProblemWorkspaceSnapshot): void {
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
