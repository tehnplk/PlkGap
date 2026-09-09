import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, access } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import XLSX from 'xlsx'
import { startSsoTestServer } from './sso-test-server.mjs'

const directory = await mkdtemp(join(tmpdir(), 'plkgap-indicator-ui-'))
const server = await startSsoTestServer()
let application
try {
  execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/test-indicators.ts'], {
    env: { ...process.env, PLKGAP_INDICATOR_FIXTURE_DIR: directory }, stdio: 'inherit', windowsHide: true,
  })
  const env = { ...process.env, PLKGAP_TEST_DATA_DIR: directory, PLKGAP_TEST_SSO_ISSUER: server.issuer, PLKGAP_API_PORT: '9991' }
  delete env.ELECTRON_RUN_AS_NODE
  application = await electron.launch({ args: ['.'], env, timeout: 60000 })
  let page
  for (let attempt = 0; attempt < 120 && !page; attempt++) {
    page = application.windows().find(window => !window.url().startsWith('data:') && window.url() !== 'about:blank')
    if (!page) await new Promise(resolve => setTimeout(resolve, 500))
  }
  assert.ok(page, 'main window opened')
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await application.evaluate(({ shell, dialog }) => {
    globalThis.indicatorLoginUrl = ''
    shell.openExternal = async url => { globalThis.indicatorLoginUrl = url }
    dialog.showMessageBox = async () => ({ response: 0 })
  })
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
  await expect.poll(() => application.evaluate(() => globalThis.indicatorLoginUrl)).not.toBe('')
  assert.equal((await fetch(await application.evaluate(() => globalThis.indicatorLoginUrl))).status, 200)
  await expect(page.getByRole('button', { name: 'สมชาย ทดสอบระบบ', exact: true })).toBeVisible()
  await page.getByRole('navigation', { name: 'Sidebar navigation' }).getByRole('button', { name: 'เทมเพลตตัวชี้วัด', exact: true }).click()
  await page.locator('#kpi-period').selectOption('2569-Q4')
  await expect(page.getByRole('button', { name: 'ส่งออก Excel', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'ประมวลผลตัวชี้วัด', exact: true }).click()
  const table = page.getByRole('table', { name: 'ตารางตัวชี้วัด', exact: true })
  await expect(table.locator('tbody tr')).toHaveCount(6)
  await expect(table.locator('tbody tr').filter({ hasText: 'KPI-03' })).toContainText('33.3%')
  await expect(table.locator('tbody tr').filter({ hasText: 'KPI-06' })).toContainText('ยังคำนวณไม่ได้')
  await table.locator('tbody tr').filter({ hasText: 'KPI-03' }).getByRole('button').click()
  const modal = page.getByRole('dialog', { name: 'แสดงส่วนขาด', exact: true })
  await expect(modal.getByRole('table').locator('tbody tr')).toHaveCount(2)
  await expect(modal).toContainText('Other Facility')
  await expect(modal).not.toContainText('First Patient')
  await mkdir('artifacts', { recursive: true })
  await page.screenshot({ path: 'artifacts/plkgap-indicator-gaps.png', fullPage: true })
  await modal.getByRole('button', { name: 'ปิด', exact: true }).click()
  await page.getByRole('checkbox', { name: 'แสดงเฉพาะที่ต่ำกว่าเป้า' }).check()
  await expect(table.locator('tbody tr')).toHaveCount(3)
  await page.getByRole('checkbox', { name: 'แสดงเฉพาะที่ต่ำกว่าเป้า' }).uncheck()
  const output = join(directory, 'indicators-2569-Q4.xlsx')
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, output)
  await page.getByRole('button', { name: 'ส่งออก Excel', exact: true }).click()
  await expect.poll(async () => { try { await access(output); return true } catch { return false } }).toBe(true)
  const workbook = XLSX.readFile(output)
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]])
  assert.equal(rows.length, 6); assert.equal(rows[2].A, 1); assert.equal(rows[2].B, 3)
  await page.screenshot({ path: 'artifacts/plkgap-indicators-real-data.png', fullPage: true })
  await page.locator('#kpi-period').selectOption('2569-Q1')
  await expect(table).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'ส่งออก Excel', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'ประมวลผลตัวชี้วัด', exact: true }).click()
  await expect(table.locator('tbody tr').filter({ hasText: 'KPI-01' })).toContainText('ไม่มีข้อมูลในงวด')
  assert.deepEqual(errors, [])
  console.log('PASS: Electron real IPC, processing, unavailable/empty states, gap modal, filter, period reset and Excel values')
} finally {
  if (application) { await application.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }) }).catch(() => {}); await application.close() }
  await server.close()
  await rm(directory, { recursive: true, force: true })
}
