/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly MODE: string;
  readonly PROD: boolean;
  readonly SSR: boolean;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_DEV_PROXY_TARGET?: string;
  readonly VITE_SHOW_AI_SOURCES?: string;
  readonly VITE_SHOW_AI_TRACE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
