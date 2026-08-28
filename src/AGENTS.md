# SOURCE LAYER KNOWLEDGE BASE

## OVERVIEW

- `src/` contains the browser application, its React presentation layer, and framework-free execution/judging/persistence cores.
- `main.tsx` boots React; `App.tsx` enters providers and routes, which keep the application shell mounted.
- `app/`, `pages/`, `features/`, and `components/` are React-facing.
- `runtime/`, `workers/`, `oj/`, `storage/`, and `problems/` are non-React product cores.
- `services/app-services.ts` is the composition root; `createAppServices` constructs and connects core services.
- `domain/` owns shared business types. Keep them declarative, framework-free, and free of browser storage or Worker mechanics.

## STRUCTURE

- `app/`: providers, app mode, route definitions.
- `pages/`: route-level React composition; keep pages lazy-loaded through `PageRoute`.
- `features/`: problem-workspace and executor workflows.
- `components/`: reusable React UI; `components/app/` is shell-specific, `components/ui/` is primitive UI.
- `hooks/`: React bindings to app services, registry snapshots, theme, storage state, and responsive state.
- `services/`: application orchestration outside React; consumes domain and core services.
- `runtime/`: manifest, registry, protocol, supervisor, optional-runtime verification.
- `workers/`: Worker entry points and Worker-only hosts; communicate only through the runtime protocol.
- `oj/`: main-thread case selection, adapter judging, comparison, and verdict aggregation.
- `storage/`: validated repository facade, IndexedDB driver, memory fallback, schema and migrations.
- `problems/`: static problem modules, schema, and repository.
- `domain/`: shared types such as problems, languages, submissions, and JSON values.
- `harness/`: browser-facing contract harnesses, not production application wiring.
- `styles/`: global foundations, layout, and semantic design tokens.

## WHERE TO LOOK

- Startup and routing: `main.tsx`, `App.tsx`, `app/AppProviders.tsx`, `app/routes.tsx`.
- Service construction: `services/app-services.ts`; add cross-core wiring here, not in components.
- Problem Run/Submit flow: `features/problems/`, `services/submission-service.ts`, `oj/`.
- Free execution: `features/executor/`; call adapter execution only, never produce OJ verdicts or submissions.
- Runtime lifecycle and availability: `runtime/registry.ts`, `runtime/supervisor.ts`, `runtime/optional-verification.ts`.
- Worker protocol boundary: `runtime/protocol.ts`, `workers/shared/endpoint.ts`.
- Shared types: `domain/`; use existing contracts instead of duplicating structural types.
- React integration: `hooks/`; don't make core modules import React.
- Visual rules and tokens: `styles/` and root `DESIGN.md`.
- Read the nearest child `AGENTS.md` before changing `features/`, `runtime/`, `workers/`, `oj/`, `storage/`, or `problems/`.

## DEPENDENCY RULES

- Direction: React shell (`app/`, `pages/`, `features/`, `components/`, `hooks/`) -> services/core -> domain.
- Core modules may depend on `domain/` and narrow peer contracts, never on React pages, components, hooks, or feature workflows.
- `services/` orchestrates `problems/`, `runtime/`, `oj/`, and `storage/`; UI reads services through providers and hooks.
- `runtime/` owns Worker transport and capabilities; Workers return actual values or structured failures only.
- `oj/` owns expected values, comparisons, and AC/WA verdicts on the main thread.
- `storage/` owns persistence validation and fallback semantics; callers use its repository facade.
- Use ESM relative imports with `.js` specifiers where the source pattern requires them.
- `@/` resolves to `src/`; prefer the established import style in the local subtree.

## ANTI-PATTERNS

- Don't import React or browser UI state into `runtime/`, `workers/`, `oj/`, `storage/`, `problems/`, or `domain/`.
- Don't bypass `createAppServices` with ad hoc service construction in pages or components.
- Don't send expected outputs, pass flags, or verdicts to a Worker.
- Don't compare results or persist submissions in the free executor flow.
- Don't duplicate runtime IDs in UI. Derive selectable runtimes from Registry snapshots.
- Don't treat packaged optional assets as enabled. Verification controls execution eligibility.
- Don't place subtree-specific protocol, persistence, UI, or runtime rules here; maintain them in the nearest child `AGENTS.md`.
