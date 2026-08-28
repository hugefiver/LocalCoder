import { LANGUAGE_IDS, type LanguageId, type RuntimeId } from "../../domain/language.js";
import type { RuntimeCapability, RuntimeRegistry } from "../../runtime/registry.js";
import type { Clock } from "../../runtime/worker-port.js";
import { defaultSettings } from "../../storage/record-validation.js";
import type { LocalCoderRepository } from "../../storage/repository.js";
import type { SettingsRecord } from "../../storage/schema.js";
import { initialExecutorRuntime } from "./executor-model.js";
import { EXECUTOR_PRESETS } from "./executor-presets.js";

export interface ExecutorPersistenceIssue {
  kind: "read" | "settings";
  label: string;
  error: unknown;
}

export interface ExecutorLoadResult {
  settings: SettingsRecord;
  capability?: RuntimeCapability;
  source: string;
  issues: readonly ExecutorPersistenceIssue[];
}

export interface ExecutorDraftRestore {
  source: string;
  issue?: ExecutorPersistenceIssue;
}

export interface ExecutorPreferenceSave {
  settings: SettingsRecord;
  saved: boolean;
  issue?: ExecutorPersistenceIssue;
}

export class ExecutorContext {
  readonly #registry: RuntimeRegistry;
  readonly #storage: LocalCoderRepository;
  readonly #clock: Clock;

  constructor(deps: { registry: RuntimeRegistry; storage: LocalCoderRepository; clock: Clock }) {
    this.#registry = deps.registry;
    this.#storage = deps.storage;
    this.#clock = deps.clock;
  }

  async load(): Promise<ExecutorLoadResult> {
    const issues: ExecutorPersistenceIssue[] = [];
    let settings: SettingsRecord;
    try {
      settings = await this.#storage.getSettings();
    } catch (error) {
      settings = defaultSettings(this.#clock.now());
      issues.push({ kind: "read", label: "本地设置读取失败", error });
    }
    const capability = initialExecutorRuntime(this.#registry, settings, LANGUAGE_IDS);
    if (capability === undefined) return { settings, source: "", issues };
    const restored = await this.restoreDraft(capability.languageId, capability.runtimeId);
    if (restored.issue !== undefined) issues.push(restored.issue);
    return { settings, capability, source: restored.source, issues };
  }

  async restoreDraft(languageId: LanguageId, runtimeId: RuntimeId): Promise<ExecutorDraftRestore> {
    try {
      const draft = await this.#storage.getDraft(["executor", languageId, runtimeId]);
      return { source: draft?.source ?? EXECUTOR_PRESETS[languageId] };
    } catch (error) {
      return {
        source: EXECUTOR_PRESETS[languageId],
        issue: { kind: "read", label: "草稿读取失败，将使用预设", error },
      };
    }
  }

  async savePreference(
    fallback: SettingsRecord,
    languageId: LanguageId,
    runtimeId: RuntimeId,
  ): Promise<ExecutorPreferenceSave> {
    let latest = fallback;
    try {
      latest = await this.#storage.getSettings();
    } catch {
      // Saving the merged fallback below determines the actionable outcome.
    }
    const settings: SettingsRecord = {
      ...latest,
      preferredRuntimeByLanguage: { ...latest.preferredRuntimeByLanguage, [languageId]: runtimeId },
      layout: { ...latest.layout },
      updatedAt: this.#clock.now(),
    };
    try {
      await this.#storage.saveSettings(settings);
      return { settings, saved: true };
    } catch (error) {
      return {
        settings,
        saved: false,
        issue: { kind: "settings", label: "运行时偏好未保存", error },
      };
    }
  }
}
