# Planning Guide

A browser-based code execution platform that mimics LeetCode's interface, allowing users to browse coding problems, write solutions in multiple languages with syntax highlighting and autocomplete, and test their code with resizable panels for optimal workflow.

**Experience Qualities**: 
1. **Focused** - LeetCode-style layout with resizable panels keeps attention on code while providing easy access to problem details and test results
2. **Persistent** - Automatically caches incomplete code solutions so users never lose their progress
3. **Professional** - Features syntax highlighting, code completion, and a polished developer experience that feels like a real coding environment

**Complexity Level**: Complex Application (advanced functionality, likely with multiple views)
This is a complex application because it includes multiple views (problem list and editor), resizable panel management, syntax-highlighted code editing with autocomplete, per-problem code caching, test execution across different languages, and state persistence.

## Essential Features

### Problem List View
- **Functionality**: Browse all available coding problems with difficulty badges and completion status, plus access to Code Executor
- **Purpose**: Allow users to discover and select problems to solve, or run arbitrary code in the executor
- **Trigger**: User opens the application or clicks "Back to Problems"
- **Progression**: View problem list → Filter/sort by difficulty → Click problem → Navigate to editor view OR Click "Code Executor" → Navigate to executor view
- **Success criteria**: Problems display with title, difficulty, and solved status; clicking navigates to the editor; executor button is prominent and accessible

### Resizable Panel Layout
- **Functionality**: LeetCode-style three-panel layout - left (problem description), top-right (code editor), bottom-right (test results)
- **Purpose**: Give users control over workspace organization based on their preferences
- **Trigger**: User drags panel dividers to resize sections
- **Progression**: Hover over divider → Cursor changes → Drag to resize → Panel sizes update → Sizes persist across sessions
- **Success criteria**: All panels resize smoothly, can be collapsed/expanded, and maintain sizes on reload

### Syntax-Highlighted Code Editor
- **Functionality**: Code editor with syntax highlighting, line numbers, and basic autocomplete for multiple languages
- **Purpose**: Provide professional code editing experience that aids readability and reduces errors
- **Trigger**: User types in the code editor
- **Progression**: Type code → Syntax highlights in real-time → Tab key indents → Autocomplete suggests keywords/functions
- **Success criteria**: Syntax highlighting works for JS/TS/Python/Racket, code is readable with proper formatting

### Per-Problem Code Caching
- **Functionality**: Automatically save incomplete code for each problem and language combination
- **Purpose**: Prevent users from losing work when switching problems or closing the browser
- **Trigger**: User types code in the editor
- **Progression**: Type code → Automatically debounced save to cache → Switch problems → Return later → Code restored
- **Success criteria**: Code persists per problem+language, survives page refresh, auto-saves while typing

### Test Execution System
- **Functionality**: Run user code against test cases and display pass/fail results with details
- **Purpose**: Validate solution correctness and provide immediate feedback
- **Trigger**: User clicks "Run Code" button
- **Progression**: Click run → Code executes in worker → Test cases run → Results display in bottom panel → Show which tests passed/failed
- **Success criteria**: Tests execute, show input/expected/actual output, display execution time

### Local Resource Management
- **Functionality**: All runtime dependencies (Pyodide for Python) are bundled locally in the repository
- **Purpose**: Ensure the application works offline and without external CDN dependencies
- **Trigger**: Initial setup via npm postinstall script
- **Progression**: Run npm install → Setup script copies Pyodide from node_modules → Files available in public/pyodide → Workers load local resources
- **Success criteria**: No CDN requests, Python execution works with local Pyodide, setup script runs automatically

### Code Executor View
- **Functionality**: Free-form code execution page where users can write and run arbitrary code in any supported language without test cases
- **Purpose**: Allow users to experiment, prototype, and test code snippets without the constraints of problem-solving structure
- **Trigger**: User clicks "Code Executor" button from the problem list
- **Progression**: Click executor button → Navigate to executor view → Write code → Click "Execute" → View stdout/stderr output → See execution results and logs
- **Success criteria**: Code executes in selected language, displays all console output (stdout), shows errors clearly, persists code per language, displays execution time

## Edge Case Handling

- **Panel Collapse**: Allow panels to be fully collapsed to minimum size and restore to previous dimensions
- **Long Code**: Handle very long code files (1000+ lines) with virtual scrolling for performance
- **Runtime Errors**: Catch and display errors with line numbers and helpful messages in the results panel
- **Empty Code**: Prevent execution of empty/whitespace-only code with validation message
- **Rapid Language Switching**: Properly save and restore code when user quickly changes languages
- **Small Screens**: Stack panels vertically on mobile with swipe gestures to switch between panels
- **Executor Mode Timeout**: Set longer timeout (10s) for executor mode compared to test mode (5s) to allow for more complex experiments
- **Console Output Overflow**: Handle large amounts of stdout/stderr gracefully with scrollable output area and clear button

## Design Direction

The design should evoke focus, efficiency, and precision - a clean coding environment inspired by LeetCode's layout. The interface emphasizes the code editor as the primary workspace while keeping problem descriptions and test results easily accessible through resizable panels. Colors are purposeful, highlighting status (passed/failed), while maintaining a professional aesthetic that reduces eye strain during extended coding sessions.

## Color Selection

A developer-focused dark theme with vibrant accent colors for syntax highlighting and status indicators.

- **Primary Color**: Deep slate blue (oklch(0.25 0.02 250)) - Communicates technical sophistication and focus
- **Secondary Colors**: Dark charcoal backgrounds (oklch(0.15 0.01 250)) for depth, Medium gray (oklch(0.35 0.01 250)) for panels
- **Accent Color**: Electric cyan (oklch(0.75 0.15 195)) - Grabs attention for interactive elements and success states
- **Foreground/Background Pairings**: 
  - Primary background (oklch(0.15 0.01 250)): Light gray text (oklch(0.92 0.01 250)) - Ratio 10.8:1 ✓
  - Code editor background (oklch(0.12 0.01 250)): Editor text (oklch(0.95 0 0)) - Ratio 14.2:1 ✓
  - Accent (oklch(0.75 0.15 195)): Dark background (oklch(0.15 0.01 250)) - Ratio 6.2:1 ✓
  - Success green (oklch(0.65 0.18 145)): Dark background - Ratio 5.1:1 ✓
  - Error red (oklch(0.60 0.22 25)): Dark background - Ratio 4.8:1 ✓

## Font Selection

Typefaces should convey technical precision and readability, with a monospace font for code and a clean sans-serif for UI.

- **Typographic Hierarchy**: 
  - H1 (Page Title): Space Grotesk Bold/32px/tight letter spacing/-0.02em
  - H2 (Section Headers): Space Grotesk SemiBold/20px/normal/-0.01em
  - Body (UI Text): Space Grotesk Regular/14px/1.5 line height
  - Code Editor: JetBrains Mono Regular/14px/1.6 line height/ligatures enabled
  - Console Output: JetBrains Mono Regular/13px/1.5 line height
  - Button Labels: Space Grotesk Medium/14px/uppercase/0.05em letter spacing

## Animations

Animations should provide immediate feedback for interactions while maintaining a professional, understated feel. Use transitions for state changes (200-300ms) with subtle easing. Code execution should show a progress indicator, test results should animate in with a quick fade (150ms), and panel resizing should be smooth. Avoid distracting animations that interrupt the coding flow - every animation serves to communicate state or guide attention.

## Component Selection

- **Components**:
  - **ResizablePanelGroup/ResizablePanel**: Shadcn Resizable components for the three-panel layout (problem, editor, results)
  - **ScrollArea**: Shadcn ScrollArea for problem description and test results with overflow
  - **Button**: Shadcn Button with variant="default" for "Run Code", variant="ghost" for panel collapse controls
  - **Card**: Shadcn Card for problem list items and test result cards
  - **Badge**: Difficulty indicators (Easy/Medium/Hard) and test status badges using Shadcn Badge
  - **Tabs**: Shadcn Tabs for switching between Description and Testcases in problem panel
  - **Select**: Shadcn Select for language selection dropdown
  - **Textarea**: Enhanced textarea for code editor with line numbers
  - **Alert**: Shadcn Alert for runtime errors and validation messages
  - **Separator**: Shadcn Separator between different sections

- **Customizations**: 
  - Custom code editor with syntax highlighting using CSS classes and regex-based tokenization
  - Custom line number gutter with synchronized scroll
  - Custom problem list with hover states and completion indicators
  - Custom panel resize handles with hover states and drag cursors
  - Debounced auto-save functionality for code caching

- **States**:
  - Buttons: Default (bright primary), Hover (lighter + subtle shadow), Active (pressed inset), Disabled (muted opacity), Loading (spinner animation)
  - Code Editor: Default (subtle border), Focus (highlighted border), Error (red accent), After-success (brief green flash)
  - Panels: Normal, Resizing (highlight divider), Collapsed (show expand button), Expanded (show collapse button)
  - Problem Cards: Default, Hover (elevated shadow), Solved (checkmark icon), Selected (highlighted border)
  - Test Results: Pending (neutral), Running (animated pulse), Passed (green background), Failed (red background)

- **Icon Selection**:
  - Play (filled triangle) for "Run Code" and "Execute" buttons
  - CheckCircle (filled) for passed tests and solved problems
  - XCircle (filled) for failed tests
  - ArrowLeft for "Back to Problems" navigation
  - Code for language/editor indicators
  - Terminal for Code Executor button and output panel
  - ListBullets for problem list icon
  - CaretLeft/CaretRight for panel collapse/expand controls
  - Clock for execution time display
  - Trash for clear output button in executor

- **Spacing**: 
  - Page container: p-0 (full screen layout)
  - Problem panel padding: p-6
  - Editor area padding: p-4
  - Results panel padding: p-4
  - Card internal padding: p-4
  - Gap between cards: gap-3
  - Button padding: px-4 py-2
  - Tight code spacing: gap-1

- **Mobile**: 
  - Switch to vertical single-column layout with full-width panels
  - Add tab bar at bottom to switch between Problem/Editor/Results views
  - Editor takes full viewport height when active
  - Larger touch targets for buttons (min 44px height)
  - Disable panel resizing, use fixed reasonable sizes
  - Sticky header with language selector always visible
