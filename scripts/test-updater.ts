import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createUpdater } from '../src/main/updater'

class Backend extends EventEmitter {
  autoDownload = false
  autoInstallOnAppQuit = true
  allowPrerelease = true
  allowDowngrade = true
  checks = 0
  installs = 0
  fail = false
  async checkForUpdates() {
    this.checks++
    this.emit('checking-for-update')
    if (this.fail) throw new Error('offline')
    this.emit('update-available', { version: '1.0.2' })
  }
  quitAndInstall(silent: boolean, restart: boolean) {
    assert.equal(silent, true); assert.equal(restart, true)
    this.installs++
  }
}

async function main() {
  const backend = new Backend()
  const updater = createUpdater(backend, true, () => {})
  assert.equal(backend.autoInstallOnAppQuit, false)
  assert.equal(backend.autoDownload, true)
  assert.equal(backend.allowDowngrade, false)
  await Promise.all([updater.check(), updater.check()])
  assert.equal(backend.checks, 1)
  assert.equal(updater.getState().status, 'downloading')
  await updater.install(async () => true)
  assert.equal(backend.installs, 0, 'Cannot install before download completes')
  backend.emit('download-progress', { percent: 37.8 })
  assert.equal(updater.getState().percent, 38)
  backend.emit('update-downloaded', { version: '1.0.2' })
  await updater.check()
  assert.equal(backend.checks, 1, 'Keep the downloaded update ready')
  await updater.install(async () => false)
  assert.equal(updater.getState().status, 'ready', 'Cancel or active import defers installation')
  assert.equal(backend.installs, 0)
  let release!: (result: boolean) => void
  const installing = updater.install(() => new Promise(resolve => { release = resolve }))
  await updater.install(async () => true)
  assert.equal(backend.installs, 0, 'No installer runs before shutdown completes')
  release(true)
  await installing
  assert.equal(backend.installs, 1, 'Repeated clicks only install once')
  updater.stop()
  const disabledBackend = new Backend()
  const disabled = createUpdater(disabledBackend, false, () => {})
  await disabled.check(); await disabled.install(async () => true)
  assert.equal(disabledBackend.checks + disabledBackend.installs, 0)
  const retryBackend = new Backend()
  const retry = createUpdater(retryBackend, true, () => {})
  retryBackend.fail = true
  await retry.check()
  assert.equal(retry.getState().status, 'error')
  retryBackend.fail = false
  await retry.check()
  assert.equal(retry.getState().status, 'downloading')
  retryBackend.emit('update-downloaded', { version: '1.0.2' })
  await retry.install(async () => { throw new Error('Database close failed') })
  assert.equal(retryBackend.installs, 0, 'Shutdown failure blocks installation')
  assert.equal(retry.getState().status, 'ready')
  console.log('PASS: updater download, concurrency, deferral, shutdown ordering, disabled mode and retry')
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
