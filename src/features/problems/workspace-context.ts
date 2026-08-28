import type { LanguageId, RuntimeId } from "../../domain/language.js";
import type { Problem, ProblemCase } from "../../domain/problem.js";
import type { SubmissionResult } from "../../domain/submission.js";
import type { RuntimeCapability } from "../../runtime/registry.js";
import { defaultSettings } from "../../storage/record-validation.js";
import type { SettingsRecord, SubmissionRecord } from "../../storage/schema.js";
import {
  errorMessage,
  immutableCases,
  immutableProblem,
  immutableSubmissions,
  initialRuntime,
  isSelectable,
  runtimeOptions,
} from "./workspace-model.js";
import type { WorkspaceDependencies } from "./workspace-types.js";

const RECENT_SUBMISSION_LIMIT = 12;
export type PersistenceWarningKind = "read" | "draft" | "custom" | "settings" | "submission" | "history";

export interface PersistenceIssue {
  kind: PersistenceWarningKind;
  label: string;
  error: unknown;
}

export type WorkspaceLoadResult =
  | { kind: "not-found"; error: string }
  | { kind: "failure"; error: string }
  | {
    kind: "no-runtime";
    problem: Problem;
    customCases: readonly ProblemCase[];
    recentSubmissions: readonly SubmissionRecord[];
    error: string;
  }
  | {
    kind: "ready";
    problem: Problem;
    runtime: RuntimeCapability;
    source: string;
    customCases: readonly ProblemCase[];
    recentSubmissions: readonly SubmissionRecord[];
    settings: SettingsRecord;
    issue?: PersistenceIssue;
  };

export class WorkspaceContext {
  readonly #deps: Pick<WorkspaceDependencies, "problems" | "registry" | "storage" | "clock">;

  constructor(deps: Pick<WorkspaceDependencies, "problems" | "registry" | "storage" | "clock">) {
    this.#deps = deps;
  }

  async load(problemId: number): Promise<WorkspaceLoadResult> {
    try {
      const loaded = await this.#deps.problems.getById(problemId);
      if (loaded === undefined) return { kind: "not-found", error: `未找到题目 ${problemId}：该题目不存在或已移除。` };
      const problem = immutableProblem(loaded);
      const [casesRead, settingsRead, submissionsRead] = await Promise.allSettled([
        this.#deps.storage.getCustomCases(problemId),
        this.#deps.storage.getSettings(),
        this.#deps.storage.listSubmissions({ problemId, limit: RECENT_SUBMISSION_LIMIT }),
      ]);
      const customCases = casesRead.status === "fulfilled" ? immutableCases(casesRead.value) : immutableCases([]);
      const settings = settingsRead.status === "fulfilled" ? settingsRead.value : defaultSettings(this.#deps.clock.now());
      const recentSubmissions = submissionsRead.status === "fulfilled"
        ? immutableSubmissions(submissionsRead.value)
        : immutableSubmissions([]);
      let issue = firstReadIssue([casesRead, settingsRead, submissionsRead]);
      const runtime = initialRuntime(this.#deps.registry, problem, settings);
      if (runtime === undefined) {
        return {
          kind: "no-runtime",
          problem,
          customCases,
          recentSubmissions,
          error: "此题没有可用于本地判题的运行时。请检查运行时资源与题目模板。",
        };
      }
      const restored = await this.restoreDraft(problem, runtime.languageId, runtime.runtimeId);
      if (restored.issue !== undefined) issue = restored.issue;
      return {
        kind: "ready",
        problem,
        runtime,
        source: restored.source,
        customCases,
        recentSubmissions,
        settings,
        ...(issue === undefined ? {} : { issue }),
      };
    } catch (error) {
      return { kind: "failure", error: `题目工作区加载失败：${errorMessage(error)}` };
    }
  }

  resolveRuntime(problem: Problem, runtimeId: RuntimeId): RuntimeCapability {
    const capability = this.#deps.registry.get(runtimeId);
    if (problem.templates[capability.languageId] === undefined) {
      throw new RangeError(`此题没有 ${capability.languageId} 模板`);
    }
    if (!isSelectable(capability)) {
      const option = runtimeOptions(this.#deps.registry, problem).find(({ value }) => value === runtimeId);
      throw new RangeError(`运行时不可用：${option?.reason ?? option?.statusLabel ?? runtimeId}`);
    }
    return capability;
  }

  async restoreDraft(problem: Problem, languageId: LanguageId, runtimeId: RuntimeId): Promise<{
    source: string;
    issue?: PersistenceIssue;
  }> {
    const template = problem.templates[languageId];
    if (template === undefined) throw new RangeError(`此题没有 ${languageId} 模板`);
    try {
      const draft = await this.#deps.storage.getDraft([`problem:${problem.id}`, languageId, runtimeId]);
      return { source: draft?.source ?? template };
    } catch (error) {
      return { source: template, issue: { kind: "read", label: "草稿读取失败，将使用题目模板", error } };
    }
  }

  async persistRuntimePreference(
    fallback: SettingsRecord,
    languageId: LanguageId,
    runtimeId: RuntimeId,
  ): Promise<{ settings: SettingsRecord; saved: boolean; issue?: PersistenceIssue }> {
    let latest = fallback;
    try {
      latest = await this.#deps.storage.getSettings();
    } catch {
      // Saving the merged fallback below determines the actionable outcome.
    }
    const settings: SettingsRecord = {
      ...latest,
      preferredRuntimeByLanguage: { ...latest.preferredRuntimeByLanguage, [languageId]: runtimeId },
      layout: { ...latest.layout },
      updatedAt: this.#deps.clock.now(),
    };
    try {
      await this.#deps.storage.saveSettings(settings);
      return { settings, saved: true };
    } catch (error) {
      return {
        settings,
        saved: false,
        issue: { kind: "settings", label: "运行时偏好未保存", error },
      };
    }
  }

  saveCustomCases(problemId: number, cases: readonly ProblemCase[]): Promise<void> {
    return this.#deps.storage.saveCustomCases(problemId, cases);
  }

  async refreshAfterSubmit(
    problemId: number,
    result: SubmissionResult,
    persistence: "not-requested" | "saved" | "memory-only" | "failed",
  ): Promise<{ records?: readonly SubmissionRecord[]; issue?: PersistenceIssue }> {
    if (persistence !== "saved" && persistence !== "memory-only") return {};
    try {
      if (result.verdict === "accepted") await this.#deps.storage.getProgress(problemId);
      const records = await this.#deps.storage.listSubmissions({ problemId, limit: RECENT_SUBMISSION_LIMIT });
      return { records: immutableSubmissions(records) };
    } catch (error) {
      return { issue: { kind: "history", label: "提交历史刷新失败", error } };
    }
  }
}

function firstReadIssue(results: readonly PromiseSettledResult<unknown>[]): PersistenceIssue | undefined {
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  return rejected === undefined
    ? undefined
    : { kind: "read", label: "工作区本地状态读取失败", error: rejected.reason };
}
