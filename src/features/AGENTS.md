# FEATURE WORKFLOWS

## STRUCTURE

- `home/` renders progress summaries from a small view model; keep aggregation and display formatting out of route pages.
- `problems/` owns the problem workspace: statement, editor, custom cases, runtime selection, Run, and Submit.
- `executor/` is the free-execution workspace. It runs source through an executable runtime but has no problem, verdict, or submission history.
- `submissions/` presents stored submission records, filters, and details through its list model and hook.
- `runtimes/` renders Registry-derived runtime options, status, rails, and detail dialogs. It does not decide which runtimes are eligible.
- Feature code reaches product capabilities through `AppServices`, normally via the existing provider hook. Do not construct repositories, registries, supervisors, engines, or services in a feature.

## PATTERN

- Keep controller, model, context, execution, hook, and UI responsibilities separate for interactive workflows that combine execution, cancellation, persistence, and context switching.
- A controller owns the mutable snapshot, lifecycle, commands, subscriptions, and error-to-snapshot transitions. Expose `subscribe()` and `getSnapshot()` with explicit command methods.
- Models build immutable snapshots, options, and display-ready derived data. Context classes restore and persist workflow-specific state without JSX.
- Execution classes call the appropriate service or adapter and return outcomes. They do not render UI or mutate React state.
- Controller-backed hooks create and dispose controllers, then connect snapshots with `useSyncExternalStore`. Simpler read flows such as submission history may use effects with cancellation or generation guards instead of inventing a controller.
- UI components remain declarative and receive narrow props. Extract panels, toolbars, dialogs, and output views before a workspace becomes a second controller.

## PERSISTENCE/ASYNC

- Treat every load, runtime switch, save, and execution completion as asynchronous. Increment a context or operation generation before it starts and ignore a completion whose generation is no longer current.
- Debounce source-draft writes for 300 ms, serialize persistence, flush before changing context, and suppress stale success or failure notices after disposal or a newer save.
- Persist through the storage facade and surface storage fallback or save failure as an honest warning. Never claim that memory fallback is durable.
- `Run` judges the current problem and shows a transient result. `Submit` also uses `SubmissionService` to persist the attempt and refresh submission-derived state; do not merge those paths casually.
- The free executor calls adapter execution only. It must not compare expected values, produce OJ verdicts, or create submission records.
- Cancel and dispose must invalidate active work so late Worker, storage, or service results cannot overwrite the current snapshot.

## UI ACCESSIBILITY

- Use semantic design tokens and existing UI primitives rather than raw palette values. Follow the local responsive layout pattern so wide workspaces collapse into usable tablet and phone flows.
- Preserve keyboard access for every control, including resizable handles, runtime selection, tabs, dialogs, cancel, retry, and destructive actions.
- Pair controls with visible labels or stable accessible names. Use `aria-labelledby`, `aria-describedby`, `aria-busy`, `role="status"`, and `role="alert"` where they describe real state.
- Mark decorative icons `aria-hidden`, communicate unavailable runtime reasons in text, and do not make status or error meaning depend on color alone.
- Keep loading, empty, failure, and unavailable states readable at narrow widths and keep busy actions disabled until their controller permits another command.

## ANTI-PATTERNS

- Do not bypass `AppServices`, duplicate Registry runtime IDs, or make feature UI infer optional-runtime eligibility from packaged assets.
- Do not place OJ comparisons, expected values, pass flags, or verdict ownership in Workers or the free executor.
- Do not update React state from arbitrary promise callbacks when a controller snapshot and `useSyncExternalStore` subscription should own that state.
- Do not let an older problem, runtime, draft, custom-case save, or execution result replace a newer context.
- Do not turn a presentational component into a persistence or Worker coordinator, or duplicate the full visual rulebook from `DESIGN.md` here.
