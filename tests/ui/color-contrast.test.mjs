import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MINIMUM_CONTRAST = 4.5;
const rootUrl = new URL("../../", import.meta.url);

function parseOklchTokens(cssBlock) {
  const tokens = new Map();
  const tokenPattern = /--([\w-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/[^)]*)?\s*\);/gu;

  for (const match of cssBlock.matchAll(tokenPattern)) {
    tokens.set(match[1], match.slice(2, 5).map(Number));
  }

  return tokens;
}

function themeTokens(css, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`${escapedSelector}\\s*\\{(?<body>[\\s\\S]*?)\\}`, "u").exec(css);
  assert.ok(match?.groups?.body, `Missing ${selector} token block`);
  return parseOklchTokens(match.groups.body);
}

function oklchToLinearSrgb([lightness, chroma, hue]) {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const m = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const s = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l ** 3;
  const m3 = m ** 3;
  const s3 = s ** 3;

  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ].map((channel) => Math.min(1, Math.max(0, channel)));
}

function relativeLuminance(oklch) {
  const [red, green, blue] = oklchToLinearSrgb(oklch);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground, background) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

const css = await readFile(new URL("src/styles/tokens.css", rootUrl), "utf8");
const themes = {
  light: themeTokens(css, ":root"),
  dark: themeTokens(css, ".dark"),
};
const cases = [
  ["light", "accent-primary", "surface-raised"],
  ["light", "accent-primary", "surface-inset"],
  ["light", "status-warning", "surface-inset"],
  ["dark", "accent-primary", "surface-raised"],
  ["dark", "accent-primary", "surface-inset"],
  ["dark", "status-warning", "surface-inset"],
];

for (const [theme, foregroundName, backgroundName] of cases) {
  test(`${theme} ${foregroundName} contrasts with ${backgroundName}`, (context) => {
    const foreground = themes[theme].get(foregroundName);
    const background = themes[theme].get(backgroundName);
    assert.ok(foreground, `Missing --${foregroundName} in ${theme} tokens`);
    assert.ok(background, `Missing --${backgroundName} in ${theme} tokens`);

    const ratio = contrastRatio(foreground, background);
    context.diagnostic(`WCAG contrast ratio: ${ratio.toFixed(4)}:1`);
    assert.ok(
      ratio >= MINIMUM_CONTRAST,
      `${theme} --${foregroundName} vs --${backgroundName} is ${ratio.toFixed(4)}:1; expected at least ${MINIMUM_CONTRAST}:1`,
    );
  });
}
