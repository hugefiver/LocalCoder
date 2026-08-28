import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig, type Plugin } from "vite";
import { existsSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = process.env.PROJECT_ROOT || process.cwd();

/**
 * Plugin to generate SPA fallback HTML files for GitHub Pages.
 * When using HashRouter, only 404.html fallback is needed.
 */
function ghPagesSpaFallback(): Plugin {
  const isGitHubPages = process.env.GITHUB_PAGES === "true";

  return {
    name: "gh-pages-spa-fallback",
    apply: "build",
    closeBundle() {
      if (!isGitHubPages) return;

      const distDir = resolve(projectRoot, "dist");
      const indexHtmlPath = resolve(distDir, "index.html");

      if (!existsSync(indexHtmlPath)) return;

      // 404.html fallback helps when users land on a non-existent path.
      // HashRouter doesn't require per-route HTML files.
      copyFileSync(indexHtmlPath, resolve(distDir, "404.html"));

      console.log("[gh-pages-spa-fallback] Generated SPA fallback HTML files");
    },
  };
}

function manualVendorChunk(id: string): string | undefined {
  const normalizedId = id.replace(/\\/g, "/");
  if (normalizedId.includes("/node_modules/@radix-ui/")) return "radix-vendor";

  const packageMatch = normalizedId.match(/\/node_modules\/(?:@codemirror|@lezer)\/([^/]+)/);
  if (packageMatch === null) return undefined;
  const packageName = packageMatch[1];
  if (packageName === undefined) return undefined;
  const isCodeMirror = normalizedId.includes("/node_modules/@codemirror/");
  const isEditorCore = (isCodeMirror && ["state", "view", "language"].includes(packageName))
    || (!isCodeMirror && ["common", "lr", "highlight"].includes(packageName));
  if (isEditorCore) return "editor-core";

  const isEditorLanguage = (isCodeMirror && (packageName.startsWith("lang-") || packageName === "legacy-modes"))
    || (!isCodeMirror && ["javascript", "python"].includes(packageName));
  if (isEditorLanguage || !isCodeMirror) return "editor-languages";

  return "editor-features";
}

// https://vite.dev/config/
export default defineConfig(() => {
  // GH Pages (HashRouter) needs relative asset URLs.
  const isGitHubPages = process.env.GITHUB_PAGES === "true";
  const base = isGitHubPages ? "./" : (process.env.VITE_BASE ?? "/");

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      ghPagesSpaFallback(),
    ],
    resolve: {
      alias: {
        "@": resolve(projectRoot, "src"),
      },
    },
    worker: {
      format: "es",
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve(projectRoot, "index.html"),
          "runtime-harness": resolve(projectRoot, "runtime-harness.html"),
          "storage-harness": resolve(projectRoot, "storage-harness.html"),
        },
        output: {
          manualChunks: manualVendorChunk,
          assetFileNames: (assetInfo) => {
            if (assetInfo.name?.endsWith(".wasm")) {
              return "pyodide/[name][extname]";
            }
            if (assetInfo.name?.includes("pyodide")) {
              return "pyodide/[name][extname]";
            }
            return "assets/[name]-[hash][extname]";
          },
          chunkFileNames: (chunkInfo) => {
            if (chunkInfo.name?.includes("worker")) {
              return "[name].js";
            }
            return "assets/[name]-[hash].js";
          },
        },
      },
      copyPublicDir: true,
      assetsInlineLimit: 0,
    },
    publicDir: "public",
  };
});
