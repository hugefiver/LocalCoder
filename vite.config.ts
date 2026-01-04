import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig, type Plugin } from "vite";
import { resolve } from 'path'
import { existsSync, mkdirSync, copyFileSync, readdirSync, writeFileSync } from 'fs'

const projectRoot = process.env.PROJECT_ROOT || import.meta.dirname

/**
 * Plugin to generate SPA fallback HTML files for GitHub Pages.
 * Creates copies of index.html for each route so that direct navigation works.
 */
function ghPagesSpaFallback(): Plugin {
  const isGitHubPages = process.env.GITHUB_PAGES === "true";
  
  return {
    name: 'gh-pages-spa-fallback',
    apply: 'build',
    closeBundle() {
      if (!isGitHubPages) return;
      
      const distDir = resolve(projectRoot, 'dist');
      const indexHtml = resolve(distDir, 'index.html');
      
      if (!existsSync(indexHtml)) return;
      
      // Routes that need fallback HTML files
      const routes = [
        'problems',
        'executor',
        '404.html',
      ];
      
      // Create fallback HTML files
      for (const route of routes) {
        if (route.endsWith('.html')) {
          // Direct HTML file (like 404.html)
          copyFileSync(indexHtml, resolve(distDir, route));
        } else {
          // Directory with index.html
          const routeDir = resolve(distDir, route);
          if (!existsSync(routeDir)) {
            mkdirSync(routeDir, { recursive: true });
          }
          copyFileSync(indexHtml, resolve(routeDir, 'index.html'));
        }
      }
      
      // Generate problem pages for each problem ID (1-100 should cover most cases)
      const problemsDir = resolve(distDir, 'problems');
      if (!existsSync(problemsDir)) {
        mkdirSync(problemsDir, { recursive: true });
      }
      
      // Read actual problem files to get IDs
      const srcProblemsDir = resolve(projectRoot, 'src', 'problems');
      if (existsSync(srcProblemsDir)) {
        const problemFiles = readdirSync(srcProblemsDir).filter(f => f.endsWith('.md'));
        for (const file of problemFiles) {
          // Extract ID from filename like "001-two-sum.md"
          const match = file.match(/^(\d+)-/);
          if (match) {
            const id = match[1];
            const problemIdDir = resolve(problemsDir, id);
            if (!existsSync(problemIdDir)) {
              mkdirSync(problemIdDir, { recursive: true });
            }
            copyFileSync(indexHtml, resolve(problemIdDir, 'index.html'));
          }
        }
      }
      
      console.log('[gh-pages-spa-fallback] Generated SPA fallback HTML files');
    }
  };
}

// https://vite.dev/config/
export default defineConfig(() => {
  // For GitHub Pages, the site is usually served from /<repo>/.
  // You can override by setting VITE_BASE (e.g. "/browser-code-runner/").
  const repoName = process.env.GITHUB_REPOSITORY?.split("/")?.[1];
  const base = process.env.VITE_BASE
    ?? (process.env.GITHUB_PAGES === "true" && repoName ? `/${repoName}/` : "/");

  return {
  base,
  plugins: [
    react(),
    tailwindcss(),
    ghPagesSpaFallback(),
  ],
  resolve: {
    alias: {
      '@': resolve(projectRoot, 'src')
    }
  },
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.wasm')) {
            return 'pyodide/[name][extname]';
          }
          if (assetInfo.name?.includes('pyodide')) {
            return 'pyodide/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
        chunkFileNames: (chunkInfo) => {
          if (chunkInfo.name?.includes('worker')) {
            return '[name].js';
          }
          return 'assets/[name]-[hash].js';
        },
      },
    },
    copyPublicDir: true,
    assetsInlineLimit: 0,
  },
  publicDir: 'public',
  };
});
