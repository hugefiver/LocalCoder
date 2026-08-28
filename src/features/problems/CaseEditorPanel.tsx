import { useEffect, useId, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";

import { Button } from "../../components/ui/button.js";
import { Textarea } from "../../components/ui/textarea.js";
import { assertJsonValue, type JsonValue } from "../../domain/json-value.js";
import type { ProblemCase } from "../../domain/problem.js";

const MAX_CUSTOM_CASES = 100;

interface CaseEditorPanelProps {
  publicCases: readonly ProblemCase[];
  customCases: readonly ProblemCase[];
  onReplaceCustomCases: (cases: readonly ProblemCase[]) => Promise<void>;
}

interface EditableCase {
  input: string;
  expected: string;
}

export function CaseEditorPanel({
  publicCases,
  customCases,
  onReplaceCustomCases,
}: CaseEditorPanelProps) {
  const idPrefix = useId();
  const [drafts, setDrafts] = useState<readonly EditableCase[]>(() => editableCases(customCases));
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [saveError, setSaveError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDrafts(editableCases(customCases));
  }, [customCases]);

  const persist = async (nextDrafts: readonly EditableCase[]): Promise<void> => {
    const parsed = parseCases(nextDrafts);
    setFieldErrors(parsed.errors);
    if (parsed.cases === undefined) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      await onReplaceCustomCases(parsed.cases);
    } catch (error) {
      setSaveError(`未保存：${messageFor(error)}。请检查浏览器存储后重试。`);
    } finally {
      setSaving(false);
    }
  };

  const updateField = (index: number, field: keyof EditableCase, value: string): void => {
    setDrafts((current) => current.map((draft, draftIndex) => (
      draftIndex === index ? { ...draft, [field]: value } : draft
    )));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[fieldKey(index, field)];
      return next;
    });
  };

  const addCase = (): void => {
    if (drafts.length >= MAX_CUSTOM_CASES) return;
    const next = [...drafts, { input: "null", expected: "null" }];
    setDrafts(next);
    void persist(next);
  };

  const removeCase = (index: number): void => {
    const next = drafts.filter((_, draftIndex) => draftIndex !== index);
    setDrafts(next);
    void persist(next);
  };

  return (
    <section className="grid min-w-0 gap-5" aria-labelledby={`${idPrefix}-cases-title`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold" id={`${idPrefix}-cases-title`}>测试用例</h3>
          <p className="mt-1 text-sm text-muted-foreground">公开用例只读；自定义输入与预期值必须是规范 JSON。</p>
        </div>
        <Button
          disabled={saving || drafts.length >= MAX_CUSTOM_CASES}
          onClick={addCase}
          size="sm"
          type="button"
          variant="outline"
        >
          <Plus aria-hidden="true" />
          添加用例
        </Button>
      </header>

      {publicCases.length === 0 ? null : (
        <div className="grid gap-3">
          <h4 className="font-mono text-xs font-semibold text-muted-foreground">公开用例 · {publicCases.length}</h4>
          {publicCases.map((testCase, index) => (
            <div className="grid gap-3 rounded-lg border border-border bg-secondary p-3 sm:grid-cols-2" key={`public-${index}`}>
              <JsonReadOnly label={`输入 ${index + 1}`} value={testCase.input} />
              <JsonReadOnly label="预期" value={testCase.expected} />
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-mono text-xs font-semibold text-muted-foreground">自定义用例 · {drafts.length}/{MAX_CUSTOM_CASES}</h4>
          {drafts.length >= MAX_CUSTOM_CASES ? <span className="text-xs text-[var(--status-warning)]">已达上限</span> : null}
        </div>

        {drafts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-secondary p-4 text-sm text-muted-foreground">
            还没有自定义用例。添加后会立即保存在当前题目的本地工作区。
          </div>
        ) : drafts.map((draft, index) => {
          const inputError = fieldErrors[fieldKey(index, "input")];
          const expectedError = fieldErrors[fieldKey(index, "expected")];
          const inputId = `${idPrefix}-custom-${index}-input`;
          const expectedId = `${idPrefix}-custom-${index}-expected`;
          return (
            <fieldset className="grid min-w-0 gap-3 rounded-lg border border-border bg-card p-3" key={`custom-${index}`}>
              <legend className="px-1 font-mono text-xs font-semibold text-muted-foreground">自定义 #{index + 1}</legend>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <JsonEditor
                  error={inputError}
                  id={inputId}
                  label="输入 JSON"
                  onChange={(value) => updateField(index, "input", value)}
                  value={draft.input}
                />
                <JsonEditor
                  error={expectedError}
                  id={expectedId}
                  label="预期 JSON"
                  onChange={(value) => updateField(index, "expected", value)}
                  value={draft.expected}
                />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button disabled={saving} onClick={() => removeCase(index)} size="sm" type="button" variant="ghost">
                  <Trash2 aria-hidden="true" />
                  删除
                </Button>
                <Button disabled={saving} onClick={() => void persist(drafts)} size="sm" type="button" variant="outline">
                  <Save aria-hidden="true" />
                  {saving ? "保存中" : "保存更改"}
                </Button>
              </div>
            </fieldset>
          );
        })}
      </div>

      {saveError === undefined ? null : (
        <p className="rounded-lg border border-[var(--status-error)] bg-card p-3 text-sm text-[var(--status-error)]" role="alert">
          {saveError}
        </p>
      )}
    </section>
  );
}

function JsonEditor({
  id,
  label,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const errorId = `${id}-error`;
  return (
    <label className="grid min-w-0 gap-2" htmlFor={id}>
      <span className="font-mono text-xs font-semibold text-muted-foreground">{label}</span>
      <Textarea
        aria-describedby={error === undefined ? undefined : errorId}
        aria-invalid={error === undefined ? undefined : true}
        className="min-h-24 resize-y bg-[var(--surface-inset)] font-mono text-sm"
        id={id}
        onChange={(event) => onChange(event.currentTarget.value)}
        spellCheck={false}
        value={value}
      />
      {error === undefined ? null : <span className="text-xs text-[var(--status-error)]" id={errorId}>{error}</span>}
    </label>
  );
}

function JsonReadOnly({ label, value }: { label: string; value: JsonValue }) {
  return (
    <div className="min-w-0">
      <span className="font-mono text-xs font-semibold text-muted-foreground">{label}</span>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-sm">{formatJson(value)}</pre>
    </div>
  );
}

function editableCases(cases: readonly ProblemCase[]): readonly EditableCase[] {
  return cases.map((testCase) => ({
    input: formatJson(testCase.input),
    expected: formatJson(testCase.expected),
  }));
}

function parseCases(drafts: readonly EditableCase[]): {
  cases: readonly ProblemCase[] | undefined;
  errors: Readonly<Record<string, string>>;
} {
  const errors: Record<string, string> = {};
  const cases: ProblemCase[] = [];
  drafts.forEach((draft, index) => {
    const input = parseField(draft.input, `自定义用例 ${index + 1} 输入`, fieldKey(index, "input"), errors);
    const expected = parseField(draft.expected, `自定义用例 ${index + 1} 预期`, fieldKey(index, "expected"), errors);
    if (input !== undefined && expected !== undefined) cases.push({ input, expected });
  });
  return { cases: Object.keys(errors).length === 0 ? cases : undefined, errors };
}

function parseField(
  source: string,
  label: string,
  key: string,
  errors: Record<string, string>,
): JsonValue | undefined {
  try {
    return assertJsonValue(JSON.parse(source) as unknown, label);
  } catch (error) {
    errors[key] = messageFor(error);
    return undefined;
  }
}

function fieldKey(index: number, field: keyof EditableCase): string {
  return `${index}:${field}`;
}

function formatJson(value: JsonValue): string {
  return JSON.stringify(value, null, 2);
}

function messageFor(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : "未知错误";
}
