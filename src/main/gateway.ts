import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { GatewayState } from '../shared/api'

interface Listener { listening: boolean; close(): Promise<void> }

/** Owns the listener and preference; shutdown must not overwrite the user's choice. */
export function createGateway(directory: string, port: number, start: () => Promise<Listener>) {
  const path = join(directory, 'api-gateway.json')
  let listener: Listener | undefined
  let enabled = true
  let stopped = false
  let error: string | undefined
  let pending: Promise<unknown> = Promise.resolve()
  const state = (): GatewayState => ({ enabled, listening: Boolean(listener?.listening), port, ...(error ? { error } : {}) })
  const serial = <T>(action: () => Promise<T>) => {
    const next = pending.then(action, action)
    pending = next.catch(() => {})
    return next
  }
  async function sync() {
    error = undefined
    if (!enabled || stopped) {
      await listener?.close()
      listener = undefined
    } else if (!listener?.listening) {
      listener = await start()
      if (!listener.listening) error = `เปิด API Gateway ไม่สำเร็จ กรุณาตรวจสอบพอร์ต ${port}`
    }
    return state()
  }
  return {
    state,
    restore: () => serial(async () => {
      try {
        const saved = JSON.parse(await readFile(path, 'utf8'))
        if (typeof saved.enabled === 'boolean') enabled = saved.enabled
      } catch { /* Preserve existing behavior (enabled) when no valid preference exists. */ }
      return sync()
    }),
    setEnabled: (value: boolean) => serial(async () => {
      if (stopped) throw new Error('API Gateway is stopping')
      if (typeof value !== 'boolean') throw new Error('Invalid API Gateway setting')
      // Persist first: a disk failure leaves the running service and preference unchanged.
      await writeFile(`${path}.tmp`, JSON.stringify({ enabled: value }), { encoding: 'utf8', mode: 0o600 })
      await rename(`${path}.tmp`, path)
      enabled = value
      return sync()
    }),
    close: () => {
      stopped = true
      return serial(sync)
    },
    resume: () => serial(async () => { stopped = false; return sync() }),
  }
}
