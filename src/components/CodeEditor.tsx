import { useEffect, useId, useRef } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter } from '@codemirror/view';
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state';
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, LanguageSupport, StreamLanguage } from '@codemirror/language';
import { haskell as haskellLegacy } from '@codemirror/legacy-modes/mode/haskell';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { lintKeymap } from '@codemirror/lint';
import { tags } from '@lezer/highlight';
import { cn } from '@/lib/utils';
import type { LanguageId } from '@/domain/language';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: LanguageId;
  className?: string;
}

const racketSupport = (): LanguageSupport => {
  return new LanguageSupport(javascriptLanguage, []);
};

const customHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--accent-primary)' },
  { tag: tags.function(tags.variableName), color: 'var(--status-info)' },
  { tag: tags.variableName, color: 'var(--text-primary)' },
  { tag: tags.string, color: 'var(--status-success)' },
  { tag: tags.number, color: 'var(--status-warning)' },
  { tag: tags.bool, color: 'var(--status-error)' },
  { tag: tags.null, color: 'var(--status-error)' },
  { tag: tags.operator, color: 'var(--accent-hover)' },
  { tag: tags.comment, color: 'var(--text-secondary)', fontStyle: 'italic' },
  { tag: tags.className, color: 'var(--status-warning)' },
  { tag: tags.typeName, color: 'var(--status-warning)' },
  { tag: tags.propertyName, color: 'var(--status-info)' },
  { tag: tags.bracket, color: 'var(--text-secondary)' },
]);

const setEscapeTabArmed = StateEffect.define<boolean>();
const escapeTabState = StateField.define<boolean>({
  create: () => false,
  update: (armed, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setEscapeTabArmed)) return effect.value;
    }
    return armed;
  },
});

const escapeThenTabKeymap = keymap.of([
  {
    key: 'Escape',
    run: (view) => {
      view.dispatch({ effects: setEscapeTabArmed.of(true) });
      return false;
    },
  },
  {
    key: 'Tab',
    run: (view) => {
      if (!view.state.field(escapeTabState)) return false;
      view.dispatch({ effects: setEscapeTabArmed.of(false) });
      focusNextAfterEditor(view);
      return true;
    },
  },
]);

const getLanguageExtension = (language: LanguageId) => {
  switch (language) {
    case 'javascript':
      return javascript();
    case 'typescript':
      return javascript({ typescript: true });
    case 'python':
      return python();
    case 'racket':
      return racketSupport();
    case 'haskell':
      return StreamLanguage.define(haskellLegacy);
  }
};

export function CodeEditor({ value, onChange, language, className }: CodeEditorProps) {
  const instructionsId = useId();
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartment = useRef(new Compartment());
  const initialValueRef = useRef(value);
  const initialLanguageRef = useRef(language);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!editorRef.current) return;

    const startState = EditorState.create({
      doc: initialValueRef.current,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        highlightSelectionMatches(),
        autocompletion(),
        syntaxHighlighting(customHighlightStyle),
        languageCompartment.current.of(getLanguageExtension(initialLanguageRef.current)),
        escapeTabState,
        escapeThenTabKeymap,
        EditorView.contentAttributes.of({
          'aria-label': '代码编辑器',
          'aria-describedby': instructionsId,
        }),
        keymap.of([
          ...defaultKeymap,
          ...closeBracketsKeymap,
          ...searchKeymap,
          ...completionKeymap,
          ...lintKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newValue = update.state.doc.toString();
            onChangeRef.current(newValue);
          }
        }),
        EditorView.theme({
          '&': {
            height: '100%',
            width: '100%',
            backgroundColor: 'var(--surface-inset)',
            color: 'var(--text-primary)',
            fontSize: 'var(--text-code)',
            fontFamily: 'var(--font-mono)',
          },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: 'var(--font-mono)',
          },
          '.cm-content': {
            caretColor: 'var(--accent-primary)',
            fontFamily: 'var(--font-mono)',
          },
          '.cm-cursor': {
            borderLeftColor: 'var(--accent-primary)',
          },
          '&.cm-focused .cm-cursor': {
            borderLeftColor: 'var(--accent-primary)',
          },
          '&.cm-focused .cm-selectionBackground, ::selection': {
            backgroundColor: 'var(--border-strong)',
          },
          '.cm-activeLine': {
            backgroundColor: 'var(--surface-panel)',
          },
          '.cm-activeLineGutter': {
            backgroundColor: 'var(--surface-panel)',
          },
          '.cm-gutters': {
            backgroundColor: 'var(--surface-inset)',
            color: 'var(--text-secondary)',
            borderRight: '1px solid var(--border-default)',
            fontFamily: 'var(--font-mono)',
          },
          '&.cm-focused': {
            outline: '2px solid var(--focus-ring)',
            outlineOffset: '-2px',
          },
        }),
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({
      state: startState,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
    };
  }, [instructionsId]);

  useEffect(() => {
    if (viewRef.current && value !== undefined) {
      const currentValue = viewRef.current.state.doc.toString();
      if (currentValue !== value) {
        viewRef.current.dispatch({
          changes: {
            from: 0,
            to: currentValue.length,
            insert: value,
          },
        });
      }
    }
  }, [value]);

  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: languageCompartment.current.reconfigure(getLanguageExtension(language)),
      });
    }
  }, [language]);

  return (
    <div className={cn('size-full min-h-0 overflow-hidden rounded-lg border border-border bg-[var(--surface-inset)]', className)}>
      <div ref={editorRef} className="size-full" />
      <p className="sr-only" id={instructionsId}>
        Tab 键用于代码缩进。先按 Escape，再按 Tab，可将焦点移出编辑器。
      </p>
    </div>
  );
}

function focusNextAfterEditor(view: EditorView): void {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true');
  const currentIndex = candidates.indexOf(view.contentDOM);
  const next = candidates[currentIndex + 1];
  if (next === undefined) {
    view.contentDOM.blur();
    return;
  }
  next.focus();
}
