import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { version } from './package.json'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    // package.json is the only place the version lives; it is injected at build time so the
    // sandboxed renderer never has to read a file to know it.
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [react(), {
      name: 'development-csp',
      apply: 'serve',
      transformIndexHtml: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
    }],
  },
})
