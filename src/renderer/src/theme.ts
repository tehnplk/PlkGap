export type Theme = 'light' | 'dark'
const key = 'plkgap.theme'

export function readTheme(): Theme {
  try { return localStorage.getItem(key) === 'dark' ? 'dark' : 'light' }
  catch { return 'light' }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
}

export function saveTheme(theme: Theme) {
  applyTheme(theme)
  try { localStorage.setItem(key, theme) } catch { /* Keep the selection for this window. */ }
}
