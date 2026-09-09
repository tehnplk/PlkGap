import assert from 'node:assert/strict'
import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startSsoTestServer } from './sso-test-server.mjs'

const directory = await mkdtemp(join(tmpdir(), 'plkgap-account-'))
const server = await startSsoTestServer()
server.behavior.expiresIn = 0.05
const env = { ...process.env, PLKGAP_TEST_DATA_DIR: directory,
  PLKGAP_API_PORT: '9991', PLKGAP_TEST_SSO_ISSUER: server.issuer }
delete env.ELECTRON_RUN_AS_NODE
let application
async function launch() {
  application = await electron.launch({ args: ['.'], env, timeout: 60000 })
  await expect.poll(() => application.windows().some(page => page.url().includes('/renderer/index.html')),
    { timeout: 60000 }).toBe(true)
  const page = application.windows().find(page => page.url().includes('/renderer/index.html'))
  await application.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 })
  })
  return page
}
try {
  let page = await launch()
  await application.evaluate(({ shell }) => {
    shell.openExternal = async (url) => { globalThis.testAuthorizationUrl = url }
  })
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
  await expect.poll(() => application.evaluate(() => globalThis.testAuthorizationUrl)).toBeTruthy()
  const response = await fetch(await application.evaluate(() => globalThis.testAuthorizationUrl))
  assert.equal(response.status, 200)
  await expect.poll(() => page.evaluate(() => window.api.ssoState().then(s => s.status))).toBe('signed-in')
  const encrypted = await readFile(join(directory, 'sso-session.bin'))
  assert.equal(encrypted.includes(Buffer.from('test-provider')), false)
  await page.locator('.account-trigger').click()
  const themeSwitch = page.getByRole('switch', { name: 'Dark theme' })
  await expect(themeSwitch).not.toBeChecked()
  await themeSwitch.click()
  await expect(themeSwitch).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: 'artifacts/plkgap-theme-dark.png', fullPage: true })
  const gateway = page.getByRole('switch', { name: 'API Gateway', exact: true })
  await expect(gateway).toBeEnabled()
  await expect(gateway).toBeChecked()
  const gatewayUrl = 'http://127.0.0.1:9991/help'
  assert.equal((await fetch(gatewayUrl)).status, 200)
  await gateway.click()
  await expect(gateway).not.toBeChecked()
  await assert.rejects(fetch(gatewayUrl), 'disabled Gateway must stop accepting HTTP requests')
  await application.close()
  application = undefined
  await server.close()
  page = await launch()
  await expect.poll(() => page.evaluate(() => window.api.ssoState().then(s => s.status))).toBe('signed-in')
  await page.locator('.account-trigger').click()
  await expect(page.getByRole('dialog', { name: 'บัญชีผู้ใช้', exact: true })).toContainText('สมชาย ทดสอบระบบ')
  const restoredGateway = page.getByRole('switch', { name: 'API Gateway', exact: true })
  await expect(restoredGateway).toBeEnabled()
  await expect(restoredGateway).not.toBeChecked()
  await assert.rejects(fetch(gatewayUrl), 'disabled preference survives restart')
  await restoredGateway.click()
  await expect(restoredGateway).toBeChecked()
  assert.equal((await fetch(gatewayUrl)).status, 200)
  await expect(page.getByRole('switch', { name: 'Dark theme' })).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('switch', { name: 'Dark theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  assert.equal((await page.evaluate(() => window.api.gatewayState())).listening, true)
  await page.screenshot({ path: 'artifacts/plkgap-theme-light.png', fullPage: true })
  await page.getByRole('button', { name: 'Logout', exact: true }).click()
  await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true })).toBeVisible()
  await application.close()
  application = undefined
  page = await launch()
  await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true })).toBeVisible()
  assert.equal((await page.evaluate(() => window.api.ssoState())).status, 'signed-out')
  assert.equal((await page.evaluate(() => window.api.gatewayState())).listening, true)
  assert.equal((await fetch(gatewayUrl)).status, 200, 'enabled preference survives restart and Logout')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  console.log('PASS: Electron encrypted account survives expired token and offline restart; Logout persists across restart')
} finally {
  if (application) await application.close()
  await server.close()
  await rm(directory, { recursive: true, force: true })
}
