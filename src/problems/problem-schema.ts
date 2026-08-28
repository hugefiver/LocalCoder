import matter from "gray-matter";
import { marked, Renderer, type Tokens } from "marked";
import { z } from "zod";
import { validateJsonValue } from "../domain/json-value.js";
import { LANGUAGE_IDS, type LanguageId } from "../domain/language.js";
import type { Problem, ProblemCase, ProblemExample } from "../domain/problem.js";

export const MAX_PROBLEM_TIMEOUT_MS = 120_000;

const MAX_CASE_VALUE_BYTES = 32 * 1024;
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REQUIRED_TEMPLATE_LANGUAGES = ["javascript", "typescript", "python"] as const;
const yamlEngine = (matter as typeof matter & {
  readonly engines: { readonly yaml: { readonly parse: (source: string) => unknown } };
}).engines.yaml;

const nonBlank = (maximum: number) => z.string().trim().min(1).max(maximum);
const exampleSchema = z.object({
  input: nonBlank(500),
  output: nonBlank(500),
  explanation: nonBlank(1_000).optional(),
}).strict();
const caseSchema = z.object({
  input: z.unknown(),
  expected: z.unknown(),
}).strict();
const frontmatterSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.number().int().positive(),
  slug: nonBlank(80).regex(KEBAB_CASE),
  title: nonBlank(160),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  summary: nonBlank(500),
  tags: z.array(nonBlank(48)).min(1).max(12),
  examples: z.array(exampleSchema).min(1).max(12),
  constraints: z.array(nonBlank(300)).min(1).max(12),
  entrypoint: z.literal("solution"),
  contract: z.literal("json-function-v1"),
  templates: z.record(z.string(), nonBlank(16_000)),
  tests: z.object({
    public: z.array(caseSchema).min(1).max(20),
    judge: z.array(caseSchema).min(1).max(100),
  }).strict(),
  timeoutMs: z.number().int().positive().max(MAX_PROBLEM_TIMEOUT_MS).optional(),
}).strict();

function boundedText(value: string, maximum = 160): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}…`;
}

function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "frontmatter";
  return `frontmatter.${path.map((part) => (
    typeof part === "number" ? `[${part}]` : String(part)
  )).join(".").replace(/\.\[/g, "[")}`;
}

function schemaError(filePath: string, path: string, message: string): never {
  throw new TypeError(`${boundedText(filePath)}: ${path}: ${boundedText(message, 320)}`);
}

function throwFirstZodIssue(filePath: string, error: z.ZodError): never {
  const issue = error.issues[0];
  if (issue === undefined) schemaError(filePath, "frontmatter", "Invalid frontmatter");

  if (issue.code === "unrecognized_keys") {
    const key = issue.keys[0] ?? "unknown";
    schemaError(filePath, `frontmatter.${boundedText(key, 80)}`, "Unknown field");
  }
  schemaError(filePath, formatPath(issue.path), issue.message);
}

function validateCase(filePath: string, path: string, value: { input: unknown; expected: unknown }): ProblemCase {
  const input = validateJsonValue(value.input, { maxBytes: MAX_CASE_VALUE_BYTES });
  if (!input.ok) {
    const issue = input.issues[0];
    schemaError(filePath, `${path}.input${issue === undefined ? "" : issue.path.slice(1)}`, issue?.message ?? "Invalid JSON value");
  }

  const expected = validateJsonValue(value.expected, { maxBytes: MAX_CASE_VALUE_BYTES });
  if (!expected.ok) {
    const issue = expected.issues[0];
    schemaError(filePath, `${path}.expected${issue === undefined ? "" : issue.path.slice(1)}`, issue?.message ?? "Invalid JSON value");
  }

  return { input: input.value, expected: expected.value };
}

function includesSolutionEntrypoint(language: LanguageId, template: string): boolean {
  switch (language) {
    case "javascript":
    case "typescript":
      return /\bfunction\s+solution\s*\(|\b(?:const|let|var)\s+solution\s*=/.test(template);
    case "python":
      return /^\s*(?:async\s+)?def\s+solution\s*\(/m.test(template);
    case "racket":
      return /\(\s*define\s+\(?\s*solution(?:\s|\))/.test(template);
    case "haskell":
      return /^\s*solution\s*(?:::\s*.+|[^=]*=)/m.test(template);
  }
}

function validateTemplates(
  filePath: string,
  templates: Record<string, string>,
): Readonly<Partial<Record<LanguageId, string>>> {
  const keys = Object.keys(templates);
  if (keys.length === 0) schemaError(filePath, "frontmatter.templates", "At least one template is required");

  for (const key of keys) {
    if (!LANGUAGE_IDS.includes(key as LanguageId)) {
      schemaError(filePath, `frontmatter.templates.${boundedText(key, 80)}`, "Unsupported template language");
    }
    const language = key as LanguageId;
    const template = templates[key];
    if (template === undefined || !includesSolutionEntrypoint(language, template)) {
      schemaError(filePath, `frontmatter.templates.${language}`, "Template must define the solution entrypoint");
    }
  }

  for (const language of REQUIRED_TEMPLATE_LANGUAGES) {
    const template = templates[language];
    if (template === undefined || template.trim().length === 0) {
      schemaError(filePath, `frontmatter.templates.${language}`, "Required template is missing or blank");
    }
  }

  return templates as Partial<Record<LanguageId, string>>;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&colon;/gi, ":")
    .replace(/&#x([0-9a-f]+);?/gi, (match, hex: string) => htmlCodePoint(match, Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (match, decimal: string) => htmlCodePoint(match, Number.parseInt(decimal, 10)));
}

function htmlCodePoint(source: string, code: number): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : source;
}

function containsUnsafeUrlWhitespace(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code !== undefined && (code <= 0x20 || (code >= 0x7f && code <= 0x9f))) return true;
  }
  return false;
}

function normalizedUrl(value: string): string | undefined {
  if (value.length === 0 || value.length > 2_048 || containsUnsafeUrlWhitespace(value)) return undefined;

  let decoded = decodeHtmlEntities(value).trim();
  if (containsUnsafeUrlWhitespace(decoded)) return undefined;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
      if (containsUnsafeUrlWhitespace(decoded)) return undefined;
    } catch {
      return undefined;
    }
  }
  return decoded;
}

function isSafeUrl(value: string, allowMailto: boolean): boolean {
  const decoded = normalizedUrl(value);
  if (decoded === undefined || decoded.startsWith("//") || decoded.includes("\\")) return false;

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(decoded)?.[1]?.toLowerCase();
  if (scheme === undefined) return true;
  return scheme === "http" || scheme === "https" || (allowMailto && scheme === "mailto");
}

function renderSafeMarkdown(markdown: string): string {
  const renderer = new Renderer();
  renderer.html = ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text);
  renderer.link = function renderLink({ href, title, tokens }: Tokens.Link): string {
    const content = this.parser.parseInline(tokens);
    if (!isSafeUrl(href, true)) return content;

    const safeTitle = title === null || title === undefined ? "" : ` title="${escapeHtml(title)}"`;
    return `<a href="${escapeHtml(href)}"${safeTitle}>${content}</a>`;
  };
  renderer.image = function renderImage({ href, title, text }: Tokens.Image): string {
    if (!isSafeUrl(href, false)) return escapeHtml(text);

    const safeTitle = title === null ? "" : ` title="${escapeHtml(title)}"`;
    return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${safeTitle}>`;
  };

  return marked.parse(markdown, { async: false, renderer }) as string;
}

interface FrontmatterSection {
  readonly frontmatter: string;
  readonly content: string;
}

const CLOSING_FRONTMATTER_DELIMITER = /^([\s\S]*?)^---(?:\r?\n|$)/m;

function extractFrontmatter(raw: string): FrontmatterSection | undefined {
  const openingLength = raw.startsWith("---\r\n") ? 5 : raw.startsWith("---\n") ? 4 : undefined;
  if (openingLength === undefined) return undefined;
  const remainder = raw.slice(openingLength);
  const match = CLOSING_FRONTMATTER_DELIMITER.exec(remainder);
  if (match === null) return undefined;
  const frontmatter = match[1];
  if (frontmatter === undefined) return undefined;
  return { frontmatter, content: remainder.slice(match[0].length) };
}

export function parseProblemDocument(filePath: string, raw: string): Problem {
  const section = extractFrontmatter(raw);
  if (section === undefined) schemaError(filePath, "frontmatter", "YAML frontmatter is required");

  let parsedFrontmatter: unknown;
  try {
    parsedFrontmatter = yamlEngine.parse(section.frontmatter);
  } catch {
    schemaError(filePath, "frontmatter", "Invalid YAML frontmatter");
  }

  const validation = frontmatterSchema.safeParse(parsedFrontmatter);
  if (!validation.success) throwFirstZodIssue(filePath, validation.error);
  if (section.content.trim().length === 0) schemaError(filePath, "markdown", "Markdown body must not be empty");

  const data = validation.data;
  const templates = validateTemplates(filePath, data.templates);
  const publicCases = data.tests.public.map((value, index) => (
    validateCase(filePath, `frontmatter.tests.public[${index}]`, value)
  ));
  const judgeCases = data.tests.judge.map((value, index) => (
    validateCase(filePath, `frontmatter.tests.judge[${index}]`, value)
  ));

  const examples: readonly ProblemExample[] = data.examples.map((example) => ({
    input: example.input,
    output: example.output,
    ...(example.explanation === undefined ? {} : { explanation: example.explanation }),
  }));

  return {
    schemaVersion: 2,
    id: data.id,
    slug: data.slug,
    title: data.title,
    difficulty: data.difficulty,
    summary: data.summary,
    tags: data.tags,
    examples,
    constraints: data.constraints,
    entrypoint: "solution",
    contract: "json-function-v1",
    templates,
    tests: { public: publicCases, judge: judgeCases },
    ...(data.timeoutMs === undefined ? {} : { timeoutMs: data.timeoutMs }),
    markdown: section.content,
    safeHtml: renderSafeMarkdown(section.content),
  };
}

export function validateProblemCorpus(documents: readonly Problem[]): readonly Problem[] {
  const ids = new Set<number>();
  const slugs = new Set<string>();
  for (const [index, document] of documents.entries()) {
    if (ids.has(document.id)) {
      throw new TypeError(`problem corpus: documents[${index}].id: duplicate id ${document.id}`);
    }
    if (slugs.has(document.slug)) {
      throw new TypeError(`problem corpus: documents[${index}].slug: duplicate slug ${document.slug}`);
    }
    ids.add(document.id);
    slugs.add(document.slug);
  }

  return [...documents].sort((left, right) => left.id - right.id);
}
