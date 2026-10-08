/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Overrides content.json's statsApi while developing, e.g. http://localhost:8787 */
  readonly VITE_STATS_API?: string;
}
