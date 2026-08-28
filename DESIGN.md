# LocalCoder Design System

## 0. Research Log

LocalCoder is an existing developer tool rather than a greenfield marketing site. The design system is extracted from the current code in `src/index.css`, `src/main.css`, `src/styles/theme.css`, `src/components/EditorView.tsx`, and `src/components/ProblemList.tsx`.

- **Existing direction retained**: dark technical workspace, cyan accent, compact CodeMirror surfaces, resizable panels, and monospace metadata.
- **Alternatives rejected**: generic card-heavy SaaS presentation would waste space; a decorative Awwwards treatment would fight editor density; a LeetCode clone would erase LocalCoder's local-runtime identity.
- **Selected direction**: audit-first redesign with a calm “local workbench” identity. Interaction mechanics are limited to immediate state feedback, panel continuity, and runtime status transitions.
- **Known inconsistencies to remove**: three overlapping token sources, hard-coded status colors, mixed Chinese/English labels, `h-screen` layouts, undeclared shadows, and controls that expose unavailable runtimes.

## 1. Atmosphere & Identity

LocalCoder should feel like a dependable offline workbench: dense enough for serious coding, quiet enough for long sessions, and explicit about what the browser runtime is doing. Its signature is the **runtime rail**—a compact, always-readable line of runtime availability, loading, execution, and verdict states that makes local execution visible instead of magical.

## 2. Color

All implementation colors must map to these semantic tokens. Values use OKLCH to match the existing stack.

| Role | Token | Light | Dark | Usage |
|---|---|---|---|---|
| Surface/base | `--surface-base` | `oklch(0.98 0.006 250)` | `oklch(0.13 0.012 250)` | Application background |
| Surface/panel | `--surface-panel` | `oklch(1 0 0)` | `oklch(0.17 0.012 250)` | Editor and content panels |
| Surface/inset | `--surface-inset` | `oklch(0.95 0.008 250)` | `oklch(0.105 0.01 250)` | Console and code surfaces |
| Surface/raised | `--surface-raised` | `oklch(1 0 0)` | `oklch(0.205 0.014 250)` | Menus, dialogs, active rows |
| Text/primary | `--text-primary` | `oklch(0.2 0.015 250)` | `oklch(0.94 0.008 250)` | Primary copy |
| Text/secondary | `--text-secondary` | `oklch(0.47 0.018 250)` | `oklch(0.7 0.014 250)` | Metadata and hints |
| Text/disabled | `--text-disabled` | `oklch(0.65 0.01 250)` | `oklch(0.48 0.01 250)` | Disabled controls |
| Border/default | `--border-default` | `oklch(0.87 0.012 250)` | `oklch(0.29 0.012 250)` | Panel and control boundaries |
| Border/strong | `--border-strong` | `oklch(0.72 0.02 250)` | `oklch(0.4 0.018 250)` | Active resize handles |
| Accent/primary | `--accent-primary` | `oklch(0.55 0.13 205)` | `oklch(0.76 0.13 195)` | Primary actions and focus |
| Accent/hover | `--accent-hover` | `oklch(0.48 0.14 205)` | `oklch(0.82 0.12 195)` | Accent hover |
| Status/success | `--status-success` | `oklch(0.5 0.15 145)` | `oklch(0.72 0.16 145)` | AC and ready |
| Status/warning | `--status-warning` | `oklch(0.58 0.15 75)` | `oklch(0.78 0.14 75)` | Loading and degraded |
| Status/error | `--status-error` | `oklch(0.55 0.2 25)` | `oklch(0.7 0.19 25)` | CE, RE, TLE, unavailable |
| Status/info | `--status-info` | `oklch(0.53 0.14 250)` | `oklch(0.72 0.13 250)` | Informational state |
| Focus/ring | `--focus-ring` | `oklch(0.55 0.13 205)` | `oklch(0.8 0.12 195)` | Keyboard focus indicator |

Rules:

- Accent color is reserved for actions, selected state, and focus—not decoration.
- Verdict colors always include text or an icon; color is never the only signal.
- Surface hierarchy uses tonal shifts and borders. Gradients are not part of the product language.

## 3. Typography

### Scale

| Level | Size | Weight | Line height | Usage |
|---|---:|---:|---:|---|
| Display | `2.25rem` | 700 | 1.15 | Home title only |
| H1 | `1.75rem` | 700 | 1.2 | Page title |
| H2 | `1.375rem` | 650 | 1.3 | Section title |
| H3 | `1.125rem` | 600 | 1.4 | Panel title |
| Body | `1rem` | 400 | 1.6 | Reading content |
| Body/sm | `0.875rem` | 400 | 1.5 | Controls and secondary copy |
| Caption | `0.75rem` | 500 | 1.4 | Runtime and verdict metadata |
| Code | `0.875rem` | 400 | 1.6 | Editor and console |

Font stacks:

- Sans: `"Space Grotesk", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`.
- Mono: `"JetBrains Mono", "Cascadia Code", Consolas, ui-monospace, monospace`.
- The system fallbacks are first-class; no external font request is required for core use.

## 4. Spacing & Layout

Base unit: **4px**.

| Token | Value | Usage |
|---|---:|---|
| `--space-1` | 4px | Icon gaps |
| `--space-2` | 8px | Inline groups |
| `--space-3` | 12px | Compact control padding |
| `--space-4` | 16px | Panel padding |
| `--space-5` | 20px | Comfortable block spacing |
| `--space-6` | 24px | Page section spacing |
| `--space-8` | 32px | Major group spacing |
| `--space-10` | 40px | Page rhythm |
| `--space-12` | 48px | Large section break |
| `--space-16` | 64px | Home page separation |

- Maximum reading width: 1120px; coding workspace uses the full viewport.
- Breakpoints: 640px, 768px, 1024px, 1280px.
- Desktop problem workspace: description 36%, editor/results 64%; user resize is preserved per session.
- Tablet: two main tabs, “题目” and “代码”; results remain below the editor.
- Mobile: single-column tabbed workspace with a sticky action bar and no horizontal document scroll.
- Full-height surfaces use `min-height: 100dvh`, never `100vh`/`h-screen`.

## 5. Components

### Planned Showcase Primitives

Before composing rebuilt screens, verify applicable states for:

- Buttons: default, hover, focus, active, disabled, loading.
- Language/runtime selector: available, loading, ready, unavailable with reason, failed.
- Runtime rail: idle, initializing, ready, running, cancelled, failed.
- Problem row: default, hover, focus, solved, attempted.
- Verdict badge and summary: AC, WA, CE, RE, TLE, cancelled, internal error.
- Editor shell: loading, restored draft, unsaved fallback, read-only error.
- Test case row: public, custom, judge-only, passed, failed, runtime error.
- Submission list: empty, populated, filtered, storage unavailable.
- Alerts and toasts: informational, success, warning, actionable error.

### Implemented Reusable Patterns

Existing reusable primitives under `src/components/ui/` remain candidates, not guaranteed patterns. A primitive is documented here only after the rebuild uses it at least twice and browser QA verifies its states.

## 6. Motion & Interaction

| Type | Duration | Easing | Usage |
|---|---:|---|---|
| Immediate | 100ms | ease-out | Press and focus feedback |
| Standard | 180ms | ease-in-out | Tab, menu, state-color transition |
| Emphasis | 280ms | cubic-bezier(0.16, 1, 0.3, 1) | Panel/state entrance |

- Animate only `transform`, `opacity`, and state colors; no layout-property animation.
- Runtime execution starts immediately after activation. Animation never delays worker messages.
- Loading, success, and error states keep dimensions stable.
- Keyboard focus is always visible; dialogs and menus restore focus on close.
- `prefers-reduced-motion` removes non-essential transitions while preserving every state change.

## 7. Depth & Surface

Strategy: **borders plus tonal shift**.

- Panels are separated by `--border-default` and surface tone.
- Popovers may use one subtle shadow: `0 8px 28px oklch(0 0 0 / 0.16)`.
- Cards do not lift on hover; they change border and surface tone without layout shift.
- Radius scale: 4px controls, 8px panels/popovers, full radius only for compact status pills.

## 8. Accessibility Constraints & Accepted Debt

- Target: WCAG 2.2 AA for all rebuilt product routes.
- Normal text contrast is at least 4.5:1; large text and non-text controls at least 3:1.
- Every action has a keyboard path and visible `--focus-ring` treatment.
- Runtime and verdict changes use an appropriately scoped `aria-live` region; repeated logs do not spam announcements.
- Resizable layouts have keyboard-accessible alternatives; mobile does not depend on drag handles.
- Code editor keyboard behavior must preserve standard editing shortcuts and expose a documented way to move focus out.
- No accepted accessibility debt is authorized. Any discovered exception remains a release blocker until explicitly approved.
