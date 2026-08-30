/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SHOW_AI_SOURCES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
