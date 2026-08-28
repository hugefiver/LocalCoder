import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readTypeScriptRuntimeVersion, writeRuntimeManifest } from "./generate-runtime-manifest.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");

export async function copyTypeScriptAsset({ root = projectRoot, regenerate = true } = {}) {
  const src = resolve(root, "node_modules", "typescript", "lib", "typescript.js");
  const dest = resolve(root, "public", "typescript", "typescript.js");
  const version = readTypeScriptRuntimeVersion(root);
  if (!existsSync(src)) {
    throw new Error("Installed TypeScript compiler asset is missing from node_modules");
  }

  const destDir = dirname(dest);
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  console.log(`Copying TypeScript compiler ${version} from: ${src}`);
  console.log(`Copying to: ${dest}`);
  copyFileSync(src, dest);
  if (regenerate) {
    await writeRuntimeManifest({ root, typescriptVersion: version });
    console.log("TypeScript compiler asset copied and runtime manifest regenerated.");
  } else {
    console.log("TypeScript compiler asset copied.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  copyTypeScriptAsset().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
