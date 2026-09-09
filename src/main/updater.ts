import type { UpdateState } from '../shared/api'

/** A small adapter keeps update policy testable without downloading or installing software. */
export interface UpdaterBackend {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  on(event: string, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void
}

export function createUpdater(backend: UpdaterBackend, enabled: boolean, publish: (state: UpdateState) => void) {
  let state: UpdateState = enabled ? { status: 'idle' } : { status: 'disabled', message: 'อัปเดตอัตโนมัติใช้ได้ในแอปที่ติดตั้งบน Windows' }
  let checking = false
  let stopped = false
  let timer: ReturnType<typeof setInterval> | undefined
  let initial: ReturnType<typeof setTimeout> | undefined
  const set = (next: UpdateState) => { state = next; publish({ ...state }) }
  backend.autoDownload = true
  // Installation must go through our database shutdown, never the library's quit hook.
  backend.autoInstallOnAppQuit = false
  backend.allowPrerelease = false
  backend.allowDowngrade = false
  backend.on('checking-for-update', () => set({ status: 'checking' }))
  backend.on('update-available', (info: { version: string }) => set({ status: 'downloading', version: info.version, percent: 0 }))
  backend.on('download-progress', (progress: { percent: number }) => set({ ...state, status: 'downloading', percent: Math.min(100, Math.max(0, Math.round(progress.percent))) }))
  backend.on('update-not-available', () => set({ status: 'idle', message: 'เป็นเวอร์ชันล่าสุดแล้ว' }))
  backend.on('update-downloaded', (info: { version: string }) => set({ status: 'ready', version: info.version, percent: 100 }))
  backend.on('error', (error: Error) => { console.error('Update failed:', error); set({ status: 'error', message: 'อัปเดตไม่สำเร็จ กรุณาลองใหม่' }) })
  async function check() {
    if (!enabled || stopped || checking || ['downloading', 'ready', 'installing'].includes(state.status)) return { ...state }
    checking = true
    try { await backend.checkForUpdates() }
    catch (error) { console.error('Update check failed:', error); set({ status: 'error', message: 'ตรวจสอบอัปเดตไม่สำเร็จ กรุณาลองใหม่' }) }
    finally { checking = false }
    return { ...state }
  }
  return {
    getState: () => ({ ...state }),
    check,
    start() {
      if (!enabled || timer || stopped) return
      initial = setTimeout(() => void check(), 15_000)
      timer = setInterval(() => void check(), 4 * 60 * 60 * 1000)
      initial.unref(); timer.unref()
    },
    stop() { stopped = true; clearTimeout(initial); clearInterval(timer) },
    async install(prepare: () => Promise<boolean>) {
      if (!enabled || state.status !== 'ready') return
      const ready = { ...state }
      set({ ...state, status: 'installing' })
      try {
        if (!await prepare()) { set(ready); return }
        backend.quitAndInstall(true, true)
      } catch (error) {
        console.error('Update installation failed:', error)
        set({ ...ready, message: 'ติดตั้งไม่สำเร็จ กรุณาลองใหม่' })
      }
    },
  }
}
