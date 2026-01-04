import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

function copyRecursive(src, dest) {
  if (!existsSync(src)) {
    console.warn(`Source does not exist: ${src}`);
    return;
  }
  
  const stat = statSync(src);
  if (stat.isDirectory()) {
    if (!existsSync(dest)) {
      mkdirSync(dest, { recursive: true });
    }
    const entries = readdirSync(src);
    for (const entry of entries) {
      copyRecursive(join(src, entry), join(dest, entry));
    }
  } else {
    const destDir = dirname(dest);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }
    copyFileSync(src, dest);
  }
}

console.log('Setting up Pyodide...');

const pyodideDir = resolve(projectRoot, 'node_modules', 'pyodide');
const targetDir = resolve(projectRoot, 'public', 'pyodide');

if (!existsSync(pyodideDir)) {
  console.error('Pyodide not found in node_modules. Please run: npm install pyodide');
  process.exit(1);
}

console.log(`Copying from: ${pyodideDir}`);
console.log(`Copying to: ${targetDir}`);

copyRecursive(pyodideDir, targetDir);

console.log('Pyodide setup complete!');
