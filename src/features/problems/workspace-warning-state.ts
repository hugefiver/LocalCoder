import type { PersistenceIssue, PersistenceWarningKind } from "./workspace-context.js";
import { errorMessage } from "./workspace-model.js";

export class WorkspaceWarningState {
  readonly #isPersistent: () => boolean;
  #kind: PersistenceWarningKind | undefined;
  #message: string | undefined;

  constructor(isPersistent: () => boolean) {
    this.#isPersistent = isPersistent;
  }

  get message(): string | undefined {
    return this.#message;
  }

  apply(issue: PersistenceIssue | undefined): void {
    if (issue !== undefined) this.setFailure(issue.kind, issue.label, issue.error);
  }

  set(kind: PersistenceWarningKind, message: string): void {
    this.#kind = kind;
    this.#message = message;
  }

  setFailure(kind: PersistenceWarningKind, label: string, error: unknown): void {
    this.set(kind, `未保存：${label}。请检查浏览器存储后重试（${errorMessage(error)}）`);
  }

  clear(kind: PersistenceWarningKind): void {
    if (!this.#isPersistent() || this.#kind !== kind) return;
    this.#kind = undefined;
    this.#message = undefined;
  }
}
