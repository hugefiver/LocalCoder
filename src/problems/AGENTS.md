# Problem Corpus Guide

## OVERVIEW

This directory holds the Markdown source documents for the built-in problem corpus.
Each document is parsed at runtime, so a malformed file prevents the corpus from loading.
Keep a problem's identity stable after it is introduced.

## FILES

- `NNN-*.md`: one problem document per file, with YAML frontmatter followed by a Markdown body.
- `problem-schema.ts`: parses frontmatter, validates the corpus, and renders safe Markdown.
- `problem-repository.ts`: loads documents and caches only a successfully validated corpus.
- `problem-modules.ts`: discovers `./[0-9][0-9][0-9]-*.md` with Vite's raw-content glob.

## SCHEMA/CORPUS RULES

- Set `schemaVersion: 2`, `entrypoint: solution`, and `contract: json-function-v1`.
- Use a positive, stable numeric `id` and a unique, stable lowercase kebab-case `slug`. Never renumber existing IDs or rename an existing slug.
- Provide non-empty JavaScript, TypeScript, and Python templates. Each must define `solution` for its language.
- Put inputs and expected values in canonical JSON form: JSON primitives, arrays, and objects only. Do not use `undefined`, functions, `NaN`, `Infinity`, dates, maps, sets, or language-specific values.
- Include at least one `tests.public` case and one `tests.judge` case. Public cases are available for the practice flow; judge cases are evaluated by the local browser judge.
- Keep frontmatter fields within the schema's declared names and types. Unknown fields are rejected.

## MARKDOWN SAFETY

- Start with an opening `---` frontmatter delimiter and close it with another `---`; provide a non-empty Markdown body.
- Write ordinary Markdown, not embedded HTML. Raw HTML is escaped before rendering.
- Link only to relative URLs or `http:`, `https:`, and `mailto:` URLs. Images permit only relative, `http:`, and `https:` URLs.
- Do not use protocol-relative URLs, backslashes, encoded unsafe schemes, or URLs containing control characters or whitespace.
- Treat titles and alt text as plain text. Don't rely on HTML attributes or script-like markup.

## ANTI-PATTERNS

- Don't copy test values or expected outputs into templates or problem prose as implementation shortcuts.
- Don't add unsupported template language keys or omit a required JavaScript, TypeScript, or Python template.
- Don't place non-JSON values in test cases, even when a language could represent them.
- Don't assume a failed corpus load is cached. The repository retains a cache only after every document parses and validates successfully.
- Don't replace the Vite raw glob with eager imports or parsed module imports; problem documents are loaded as raw strings.

## TESTS

- Update schema tests when changing validation or Markdown safety behavior.
- Add a corpus-level case for duplicate IDs or slugs, invalid JSON values, missing required templates, and failed-load retry behavior when those rules change.
- Verify the relevant document parses through `parseProblemDocument` and the full corpus through `validateProblemCorpus`.
- Test unsafe links, images, and raw HTML as rendered output, not only as parser input.
