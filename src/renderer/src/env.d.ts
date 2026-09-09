/// <reference types="vite/client" />
import type { AppApi } from '../../shared/api'
declare global {
  interface Window { api: AppApi }
  /** `version` from package.json, injected at build time by electron.vite.config.ts. */
  const __APP_VERSION__: string
}
