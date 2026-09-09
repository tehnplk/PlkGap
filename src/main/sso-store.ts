import { safeStorage } from 'electron'
import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { SsoSession, SsoStore } from './sso'

export function createSsoStore(directory: string): SsoStore {
  const path = join(directory, 'sso-session.bin')
  let pending: Promise<unknown> = Promise.resolve()
  const serialize = <T>(action: () => Promise<T>): Promise<T> => {
    const next = pending.then(action, action)
    pending = next.catch(() => {})
    return next
  }
  const available = () => safeStorage.isEncryptionAvailable()
    && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
  return {
    read: () => serialize(async () => {
      if (!available()) return null
      try { return JSON.parse(safeStorage.decryptString(await readFile(path))) as SsoSession }
      catch { return null }
    }),
    write: (session) => serialize(async () => {
      if (!available()) return // Memory-only login if the OS cannot protect credentials.
      await writeFile(`${path}.tmp`, safeStorage.encryptString(JSON.stringify(session)), { mode: 0o600 })
      await rename(`${path}.tmp`, path)
    }),
    clear: () => serialize(async () => {
      await rm(path, { force: true })
      await rm(`${path}.tmp`, { force: true })
    }),
  }
}
