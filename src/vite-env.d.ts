/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GITHUB_PAGES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __LOCALCODER_BUILD_ID__: string;
