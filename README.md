# CodeRunner - LeetCode-Style Coding Platform

A browser-based code execution platform that mimics LeetCode's interface, allowing users to browse coding problems, write solutions in multiple languages, and test their code entirely in the browser.

## Features

- **Multiple Language Support**: JavaScript, TypeScript, Python (via Pyodide), and Racket
- **Syntax Highlighting & Autocomplete**: Professional code editing experience with CodeMirror
- **Resizable Panels**: LeetCode-style layout with problem description, code editor, and test results
- **Test Cases**: Default and custom test cases with instant feedback
- **Code Persistence**: Automatically saves your code per problem and language
- **Pure Frontend**: All code execution happens in browser workers - no backend required

## Setup

After installing dependencies, run the setup script to copy Pyodide files to the public directory:

```bash
npm install
npm run setup
```

The `npm run setup` command copies the Pyodide Python interpreter from `node_modules` to `public/pyodide/` so it can be loaded by the Python worker. This is automatically run after `npm install` via the postinstall hook.

## Development

```bash
npm run dev
```

## How It Works

- **Workers**: Each language runs in a dedicated Web Worker for sandboxed execution
- **Pyodide**: Python support via WebAssembly-based CPython interpreter (loaded locally, not from CDN)
- **CodeMirror**: Provides syntax highlighting, autocomplete, and a professional editing experience
- **Persistent Storage**: Uses Spark's KV API to save code per problem and language combination

## Project Structure

```
├── public/
│   ├── pyodide/          # Pyodide files (copied from node_modules)
│   ├── js-worker.js      # JavaScript/TypeScript execution worker
│   ├── python-worker.js  # Python execution worker
│   └── racket-worker.js  # Racket execution worker (placeholder)
├── scripts/
│   └── setup-pyodide.js  # Setup script to copy Pyodide files
├── src/
│   ├── components/       # React components
│   ├── hooks/           # Custom React hooks
│   └── App.tsx          # Main application component
```

## License

The Spark Template files and resources from GitHub are licensed under the terms of the MIT license, Copyright GitHub, Inc.
