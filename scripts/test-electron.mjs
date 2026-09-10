import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readFile, access, readdir } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import yazl from 'yazl'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import reference from '../src/main/reference/c-tables.json' with { type: 'json' }
import files from '../src/main/reference/f43-tables.json' with { type: 'json' }
import boundaries from '../src/main/reference/boundaries.json' with { type: 'json' }
import structureCodes from '../src/main/reference/structure-codes.json' with { type: 'json' }
import { startSsoTestServer } from './sso-test-server.mjs'
import tablesInUse from '../src/main/reference/tables-in-use.json' with { type: 'json' }

const referenceTables = [...reference.tables.filter((table) => tablesInUse.tables.includes(table.name)), ...structureCodes.tables]
const referenceRows = referenceTables.reduce((sum, table) => sum + table.rows.length, 0)

// Every page follows the same two rules, checked before the app even starts: the file is named
// <Name>Page.tsx, and App names its window "{ชื่อหน้า} - {basename}" through windowTitle().
const pageFiles = (await readdir('src/renderer/src/pages', { recursive: true })).filter((name) => name.endsWith('.tsx'))
assert.ok(pageFiles.length > 10, `pages live in src/renderer/src/pages, found ${pageFiles.length}`)
const appSource = await readFile('src/renderer/src/App.tsx', 'utf8')
for (const file of pageFiles) {
  assert.match(file, /Page\.tsx$/, `${file} must be named <Name>Page.tsx`)
  const name = file.split(/[\\/]/).at(-1).replace(/\.tsx$/, '')
  assert.ok(appSource.includes(`'${name}'`), `App must name ${name} in sources, so its window title shows the file`)
}
assert.ok(appSource.includes('const windowTitle = (id: Kind) => `${titles[id]} - ${sources[id]}`'),
  'window titles are composed in one place, as "{ชื่อหน้า} - {ชื่อไฟล์}"')
// A fresh temp userData is exactly the state of a brand new machine after install.
const directory = await mkdtemp(join(tmpdir(), 'plkgap-ui-test-'))
// A stand-in for the Desktop, so the test never reads the real one.
const importDirectory = await mkdtemp(join(tmpdir(), 'plkgap-import-test-'))
const standardFiles = files.tables.map((table) => table.name)
function writeZip(path, entries) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile()
    // One data row per file, with a hospcode too long for the dictionary's 5 characters.
    const content = ['HOSPCODE', 'GA0014056'].join('\n')
    for (const name of entries) {
      const value = /(^|\/)person\.txt$/i.test(name)
        ? 'HOSPCODE|PID|CID|NATION|PRENAME|SEX|DISCHARGE|DDISCHARGE\nGA0014056|TEST1|123|099|003|2|1|20260901'
        : /(^|\/)service\.txt$/i.test(name)
          ? 'HOSPCODE|PID|SEQ|DATE_SERV\nGA0014056|TEST1|1|20260902'
          : /(^|\/)village\.txt$/i.test(name) ? 'HOSPCODE|VID|WASTEWATER\nGA0014056|01|2' : content
      zip.addBuffer(Buffer.from(value), name)
    }
    zip.outputStream.pipe(createWriteStream(path)).on('close', resolve).on('error', reject)
    zip.end()
  })
}
// A zip nested in a folder, a flat one, and one that is not the 52 files at all.
const validZip = join(importDirectory, 'F43_07494_20260819111824.ZIP')
const flatZip = join(importDirectory, 'F43_FLAT.zip')
const badZip = join(importDirectory, 'F43_BAD.zip')
await writeZip(validZip, standardFiles.map((name) => `F43_07494_20260819111826/${name.toUpperCase()}.txt`))
await writeZip(flatZip, standardFiles.map((name) => `${name}.txt`))
await writeZip(badZip, ['F43_BAD/PERSON.txt', 'F43_BAD/holiday-photo.jpg'])
// A port of its own, so a PlkGap the developer already has open does not collide with the test.
const apiPort = 9989
const api = `http://127.0.0.1:${apiPort}`
const testSso = await startSsoTestServer()
const env = { ...process.env, PLKGAP_TEST_DATA_DIR: directory, PLKGAP_IMPORT_DIR: importDirectory, PLKGAP_API_PORT: String(apiPort), PLKGAP_TEST_SSO_ISSUER: testSso.issuer }
delete env.ELECTRON_RUN_AS_NODE
let application
try {
  application = await electron.launch({ args: ['.'], env, timeout: 60000 })
  // The splash comes up first while the database opens, so the first window is not the app.
  const splash = await application.firstWindow({ timeout: 60000 })
  assert.ok(splash.url().startsWith('data:'), `the splash shows first, got ${splash.url()}`)
  // Name and version share the title line, the same way the app's own title bar reads.
  await expect(splash.locator('h1')).toHaveText(/^PLK GAP version \d+\.\d+\.\d+$/)
  await expect(splash.locator('#status')).not.toBeEmpty()
  await mkdir('artifacts', { recursive: true })
  await splash.screenshot({ path: 'artifacts/plkgap-splash.png' })
  let page = application.windows().find((window) => !window.url().startsWith('data:'))
  while (!page) {
    page = await application.waitForEvent('window', { timeout: 60000 })
    if (page.url().startsWith('data:')) page = undefined
  }
  await expect.poll(() => application.windows().some((window) => window.url().startsWith('data:')),
    { timeout: 30000 }).toBe(false)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('status').filter({ hasText: 'Connected' }).waitFor({ timeout: 60000 })
  // First run on a new machine: the c_* reference data is already usable and the 52 files exist empty.
  const statusBar = page.locator('.status-bar')
  await expect(statusBar).toContainText(`${referenceTables.length} ตารางอ้างอิง`)
  await expect(statusBar).toContainText(`${referenceRows.toLocaleString('en-US')} รายการ`)
  await expect(statusBar).toContainText(`${files.tables.length} แฟ้มพร้อมนำเข้า`)
  await mkdir('artifacts', { recursive: true })
  // Signed out, every menu is a dead end that points at the account button in the sidebar footer.
  const loginModal = page.getByRole('dialog', { name: 'ต้องเข้าสู่ระบบก่อน', exact: true })
  const sidebarNav = page.getByRole('navigation', { name: 'Sidebar navigation' })
  await sidebarNav.getByRole('button', { name: 'นำเข้าข้อมูล', exact: true }).click()
  await expect(loginModal).toBeVisible()
  await expect(loginModal).toContainText('มุมซ้ายล่าง')
  await expect(page.getByRole('region', { name: /window$/ })).toHaveCount(0)
  await page.screenshot({ path: 'artifacts/plkgap-login-required.png', fullPage: true })
  await loginModal.getByRole('button', { name: 'รับทราบ', exact: true }).click()
  await expect(loginModal).toBeHidden()
  // The File and เกี่ยวกับ menus go through the same gate.
  await page.getByRole('menuitem', { name: 'File', exact: true }).click()
  await page.getByRole('menu', { name: 'File' }).getByRole('menuitem', { name: 'นำเข้าข้อมูล', exact: true }).click()
  await expect(loginModal).toBeVisible()
  await loginModal.getByRole('button', { name: 'ปิด', exact: true }).click()
  await page.getByRole('menuitem', { name: 'เกี่ยวกับ', exact: true }).click()
  await page.getByRole('menu', { name: 'เกี่ยวกับ' }).getByRole('menuitem').first().click()
  await expect(loginModal).toBeVisible()
  await loginModal.getByRole('button', { name: 'รับทราบ', exact: true }).click()
  await expect(page.getByRole('region', { name: /window$/ })).toHaveCount(0)
  // The API switch lives in the account panel, which does not exist without an account.
  await expect(page.getByRole('switch', { name: 'API Gateway', exact: true })).toHaveCount(0)

  await application.evaluate(({ shell }) => {
    globalThis.testSsoBrowserUrl = ''
    shell.openExternal = async (url) => { globalThis.testSsoBrowserUrl = url }
  })
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
  await expect.poll(() => application.evaluate(() => globalThis.testSsoBrowserUrl)).not.toBe('')
  const authorizationUrl = await application.evaluate(() => globalThis.testSsoBrowserUrl)
  assert.equal(new URL(authorizationUrl).origin, testSso.issuer, 'login uses the system-browser entry point')
  assert.equal((await fetch(authorizationUrl)).status, 200)
  const account = page.getByRole('button', { name: 'สมชาย ทดสอบระบบ', exact: true })
  await expect(account).toBeVisible()
  await account.click()
  const accountPopup = page.getByRole('dialog', { name: 'บัญชีผู้ใช้', exact: true })
  await expect(accountPopup).toBeVisible()
  assert.deepEqual(await accountPopup.locator('dt').allTextContents(), ['ชื่อ นามสกุล', 'ตำแหน่ง', 'หน่วยงาน'])
  await expect(accountPopup).toContainText('นักวิชาการสาธารณสุข')
  await expect(accountPopup).toContainText('สำนักงานสาธารณสุขจังหวัดพิษณุโลก')
  await expect(accountPopup.getByRole('button', { name: 'Logout', exact: true })).toBeVisible()
  const accountBounds = await account.boundingBox()
  const popupBounds = await accountPopup.boundingBox()
  assert.ok(popupBounds.y + popupBounds.height <= accountBounds.y, 'account panel opens upwards')
  const sidebarBounds = await page.locator('.sidebar').boundingBox()
  const statusBoundsAfterLogin = await statusBar.boundingBox()
  assert.equal(statusBoundsAfterLogin.x, sidebarBounds.x + sidebarBounds.width, 'status bar starts after the sidebar')
  assert.equal(statusBoundsAfterLogin.x, (await page.locator('.workspace').boundingBox()).x)
  await page.screenshot({ path: 'artifacts/plkgap-sso-account.png', fullPage: true })
  await page.keyboard.press('Escape')
  await expect(accountPopup).toBeHidden()
  await expect(account).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(accountPopup.getByRole('switch', { name: 'Dark theme' })).toBeFocused()
  await page.keyboard.press('Escape')
  const encryptedSession = await readFile(join(directory, 'sso-session.bin'))
  const protectedSession = await application.evaluate(({ safeStorage }, bytes) => {
    const encrypted = Buffer.from(bytes)
    const value = JSON.parse(safeStorage.decryptString(encrypted))
    return value.subject === 'test-provider' && !encrypted.includes(Buffer.from(value.accessToken))
  }, [...encryptedSession])
  assert.equal(protectedSession, true, 'session is encrypted with OS-backed safeStorage')
  assert.deepEqual(Object.keys(await page.evaluate(() => window.api.ssoState())).sort(), ['profile', 'status'])
  await page.screenshot({ path: 'artifacts/plkgap-main-ui.png', fullPage: true })
  const navigation = page.getByRole('navigation', { name: 'Sidebar navigation' })
  await expect(page.getByRole('toolbar')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Restore application' })).toBeVisible()
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()), true, 'Main window opens maximized')
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute('aria-expanded', 'true')
  const menuBounds = await page.getByRole('menubar').boundingBox()
  const workspaceBounds = await page.locator('.workspace').boundingBox()
  const statusBounds = await page.locator('.status-bar').boundingBox()
  const titleBounds = await page.locator('.main-titlebar').boundingBox()
  assert.equal(titleBounds.y, 0, 'Custom title bar starts at the top')
  await expect(page.locator('.main-title')).toHaveText(/^PLK GAP version \d+\.\d+\.\d+$/)
  await expect(page.locator('.sidebar-header strong')).toHaveText('PLK GAP')
  assert.equal(menuBounds.y, 0, 'Menu is in the top title-bar row')
  assert.equal(menuBounds.height, titleBounds.height, 'Menu shares the title-bar height')
  assert.equal(workspaceBounds.y, menuBounds.y + menuBounds.height, 'Workspace starts directly below main menu')
  assert.equal(workspaceBounds.y + workspaceBounds.height, statusBounds.y, 'Workspace fills available height')

  // Sidebar menu groups: every group header is present and children live inside their own group
  const groupNames = ['ระบบ 43 แฟ้ม', 'ระบบวิเคราะห์ข้อมูล', 'ระบบแผนที่', 'ระบบสื่อสาร', 'งานระบาดวิทยาควบคุมโรค', 'ตั้งค่า']
  for (const name of groupNames) await expect(navigation.getByRole('button', { name, exact: true })).toBeVisible()
  const files43 = navigation.getByRole('button', { name: 'ระบบ 43 แฟ้ม', exact: true })
  await expect(files43).toHaveAttribute('aria-expanded', 'true')
  // ตั้งค่า is opened rarely, so it starts folded away.
  const settings = navigation.getByRole('button', { name: 'ตั้งค่า', exact: true })
  await expect(settings).toHaveAttribute('aria-expanded', 'false')
  await expect(navigation.getByRole('button', { name: 'ตั้งค่าหน่วยบริการ', exact: true })).toBeHidden()
  await settings.click()
  await expect(navigation.getByRole('button', { name: 'ตั้งค่าหน่วยบริการ', exact: true })).toBeVisible()
  await expect(navigation.getByRole('button', { name: 'คุณภาพตามโครงสร้าง', exact: true })).toBeVisible()
  await files43.click()
  await expect(files43).toHaveAttribute('aria-expanded', 'false')
  await expect(navigation.getByRole('button', { name: 'คุณภาพตามโครงสร้าง', exact: true })).toBeHidden()
  await files43.click()
  await expect(navigation.getByRole('button', { name: 'คุณภาพตามโครงสร้าง', exact: true })).toBeVisible()
  await page.screenshot({ path: 'artifacts/plkgap-sidebar-groups.png', fullPage: true })

  await navigation.getByRole('button', { name: 'นำเข้าข้อมูล', exact: true }).click()
  const importWindow = page.getByRole('region', { name: 'นำเข้าข้อมูล - Import52FilesPage window' })
  await expect(importWindow).toBeVisible()
  await expect(importWindow).toHaveClass(/maximized/)
  assert.deepEqual(await page.locator('.workspace').boundingBox(), workspaceBounds, 'Opening a child does not shrink the workspace')
  // The grid is the import history: empty until something is actually imported.
  await expect(importWindow.locator('tbody tr')).toHaveCount(0)
  await expect(importWindow).toContainText('ยังไม่มีประวัติการนำเข้า')
  await expect(importWindow.getByRole('button', { name: 'ล้างประวัติ' })).toHaveCount(0)
  await expect(importWindow.locator('.section-title')).toHaveText('ประวัติการนำเข้า')
  assert.deepEqual(await importWindow.locator('thead th').allInnerTexts(),
    ['ลำดับ', 'วัน-เวลานำเข้า', 'ชื่อไฟล์', 'File Size (MB)', 'แถว', 'สถานะ'])
  // Child window titles carry the page component that renders them.
  await expect(importWindow.locator('.window-titlebar > span')).toHaveText('นำเข้าข้อมูล - Import52FilesPage')

  // The [...] picker is a native dialog, so stub it the same way the exit dialog is stubbed below.
  await expect(importWindow.getByRole('button', { name: 'นำเข้า', exact: true })).toBeDisabled()
  const pick = (chosen) => application.evaluate(({ dialog }, file) => {
    globalThis.openDialogOptions = undefined
    dialog.showOpenDialog = async (_window, options) => {
      globalThis.openDialogOptions = options
      return { canceled: false, filePaths: [file] }
    }
  }, chosen)
  const browse = () => importWindow.getByRole('button', { name: 'เรียกดูไฟล์' }).click()
  const importButton = importWindow.getByRole('button', { name: 'นำเข้า', exact: true })

  await pick(validZip)
  await browse()
  await expect(importWindow.getByLabel('เลือกไฟล์')).toHaveValue(validZip)
  assert.deepEqual(await application.evaluate(() => globalThis.openDialogOptions.filters),
    [{ name: 'ไฟล์ ZIP', extensions: ['zip'] }], 'The picker is limited to zip files')
  assert.equal(await application.evaluate(() => globalThis.openDialogOptions.defaultPath), importDirectory,
    'The picker opens in the import folder')
  // Only a zip holding exactly the 52 standard .txt files may be imported — nested in a folder or flat.
  await expect(importWindow.getByRole('status')).toContainText('ครบ 52 แฟ้ม')
  await expect(importButton).toBeEnabled()
  await pick(flatZip)
  await browse()
  await expect(importWindow.getByLabel('เลือกไฟล์')).toHaveValue(flatZip)
  await expect(importWindow.getByRole('status')).toContainText('ครบ 52 แฟ้ม')
  await expect(importButton).toBeEnabled()
  // Anything else is refused, and the reason is spelled out.
  await pick(badZip)
  await browse()
  await expect(importWindow.getByRole('status')).toContainText('นำเข้าไม่ได้')
  await expect(importWindow.locator('.check-problems')).toContainText('ไม่ใช่ 52 แฟ้มมาตรฐาน')
  await expect(importWindow.locator('.check-problems')).toContainText('holiday-photo.jpg')
  await expect(importWindow.locator('.check-problems')).toContainText('ขาด 51 แฟ้ม')
  await expect(importButton).toBeDisabled()

  // Import for real: the run lands in the history with the file it came from.
  await pick(validZip)
  await browse()
  await expect(importButton).toBeEnabled()
  await importButton.click()
  await expect(importWindow.getByRole('status')).toContainText('นำเข้าสำเร็จ', { timeout: 60000 })
  await expect(importWindow.locator('tbody tr')).toHaveCount(1)
  const run = importWindow.locator('tbody tr').first()
  await expect(run).toContainText('F43_07494_20260819111824.ZIP')
  await expect(run).toContainText('สำเร็จ')
  await expect(importButton).toBeDisabled()
  await expect(importWindow.getByLabel('เลือกไฟล์')).toHaveValue('', { timeout: 10000 })

  await expect(importWindow.getByRole('button', { name: /ตรวจ.*โครงสร้าง/ })).toHaveCount(0)
  await page.screenshot({ path: 'artifacts/plkgap-import.png', fullPage: true })

  // ปริมาณข้อมูล: a fiscal year runs October to September, so the grid is 12 months plus a total.
  await navigation.getByRole('button', { name: 'ปริมาณข้อมูล', exact: true }).click()
  const dataCount = page.getByRole('region', { name: 'ปริมาณข้อมูล - DataCountPage window' })
  await expect(dataCount).toBeVisible()
  // It opens on service, so there is something on screen without touching the picker.
  await expect(dataCount.getByLabel('เลือกแฟ้ม')).toHaveValue('service')
  await expect(dataCount.locator('tbody tr')).toHaveCount(5)
  await expect(dataCount).toContainText('date_serv')
  assert.deepEqual(await dataCount.locator('thead th').allInnerTexts(),
    ['ปีงบ', 'ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'รวม'])
  // แฟ้มสะสม is a standing register, so it reports fiscal-year totals with no month columns.
  await dataCount.getByLabel('เลือกแฟ้ม').selectOption('person')
  await expect(dataCount).toContainText('d_update')
  assert.deepEqual(await dataCount.locator('thead th').allInnerTexts(), ['ปีงบ', 'รวม'])
  await expect(dataCount.locator('tbody tr')).toHaveCount(5)
  await expect(dataCount.locator('tbody tr').first().locator('td')).toHaveCount(2)
  // CHRONIC has date_diag of its own and would still be yearly: the manual's marker in
  // c_files_desc decides which files are แฟ้มสะสม, not whether a date column happens to exist.
  await dataCount.getByLabel('เลือกแฟ้ม').selectOption('chronic')
  await expect(dataCount).toContainText('date_diag')
  assert.deepEqual(await dataCount.locator('thead th').allInnerTexts(), ['ปีงบ', 'รวม'])
  await dataCount.getByLabel('เลือกแฟ้ม').selectOption('service')
  await expect(dataCount).toContainText('date_serv')
  await expect(dataCount.locator('tbody tr')).toHaveCount(5)
  const fiscalYears = await dataCount.locator('tbody tr td:first-child').allInnerTexts()
  assert.deepEqual(fiscalYears.map(Number), [0, 1, 2, 3, 4].map((back) => Number(fiscalYears[0]) - back),
    'five fiscal years counting back from the current one')
  await dataCount.getByRole('button', { name: 'ปีงบ', exact: true }).click()
  assert.deepEqual((await dataCount.locator('tbody tr td:first-child').allInnerTexts()).map(Number), fiscalYears.map(Number).reverse())
  await expect(dataCount.getByRole('columnheader', { name: 'ปีงบ' })).toHaveAttribute('aria-sort', 'ascending')
  await dataCount.getByRole('button', { name: 'ปีงบ', exact: true }).click()
  assert.deepEqual(await dataCount.locator('tbody tr td:first-child').allInnerTexts(), fiscalYears)
  await expect(dataCount.locator('thead th button')).toHaveCount(14)
  const yearHeader = dataCount.getByRole('columnheader', { name: 'ปีงบ', exact: true })
  const yearWidth = (await yearHeader.boundingBox()).width
  const yearEdge = dataCount.getByRole('separator', { name: 'ปรับความกว้าง ปีงบ', exact: true })
  await expect(dataCount.getByRole('separator')).toHaveCount(14)
  async function resizeColumn(handle, distance) {
    const box = await handle.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + distance, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
  }
  await resizeColumn(yearEdge, 80)
  await expect.poll(async () => (await yearHeader.boundingBox()).width).toBeGreaterThan(yearWidth + 70)
  await expect(yearHeader).toHaveAttribute('aria-sort', 'descending')
  await resizeColumn(yearEdge, -60)
  await expect.poll(async () => (await yearHeader.boundingBox()).width).toBeLessThan(yearWidth + 30)
  assert.ok(Math.abs((await yearHeader.boundingBox()).width - (await dataCount.locator('tbody tr td').first().boundingBox()).width) < 2)
  await dataCount.getByRole('button', { name: 'ปีงบ', exact: true }).click()
  await expect(yearHeader).toHaveAttribute('aria-sort', 'ascending')
  await yearEdge.focus()
  const keyboardWidth = (await yearHeader.boundingBox()).width
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await yearHeader.boundingBox()).width).toBeGreaterThan(keyboardWidth + 10)
  await page.screenshot({ path: 'artifacts/plkgap-data-count.png', fullPage: true })
  await dataCount.getByRole('button', { name: 'Close ปริมาณข้อมูล - DataCountPage' }).click()
  await expect(dataCount).toHaveCount(0)

  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false')
  await account.click()
  await expect(accountPopup).toBeVisible()
  assert.ok((await accountPopup.boundingBox()).x >= 0, 'collapsed sidebar account popup is not clipped')
  await page.screenshot({ path: 'artifacts/plkgap-sso-collapsed.png', fullPage: true })
  await page.keyboard.press('Escape')
  assert.ok((await page.locator('.workspace').boundingBox()).width > workspaceBounds.width, 'Collapsing gives space back to MDI')
  await expect(importWindow).toBeVisible()
  await page.screenshot({ path: 'artifacts/plkgap-sidebar-collapsed.png', fullPage: true })
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  await expect(navigation.getByRole('button', { name: 'นำเข้าข้อมูล', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(importWindow).toBeVisible()
  await page.screenshot({ path: 'artifacts/plkgap-sidebar-expanded.png', fullPage: true })
  await navigation.getByRole('button', { name: 'นำเข้าข้อมูล', exact: true }).click()
  await expect(importWindow).toHaveCount(1)

  await importWindow.getByRole('button', { name: 'Restore นำเข้าข้อมูล - Import52FilesPage' }).click()
  await expect(importWindow).not.toHaveClass(/maximized/)
  // Drags are pointer-capture based, so give each press a beat before moving and poll the result:
  // a React re-render between down and move used to make this flap.
  async function drag(from, to) {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.waitForTimeout(60)
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 })
    await page.mouse.move(to.x, to.y, { steps: 6 })
    await page.waitForTimeout(60)
    await page.mouse.up()
  }
  const beforeMove = await importWindow.boundingBox()
  await drag({ x: beforeMove.x + 100, y: beforeMove.y + 18 }, { x: beforeMove.x + 170, y: beforeMove.y + 38 })
  await expect.poll(async () => (await importWindow.boundingBox()).x).toBeGreaterThan(beforeMove.x + 50)
  const afterMove = await importWindow.boundingBox()
  const handle = await importWindow.locator('.resize-handle').boundingBox()
  await drag({ x: handle.x + 12, y: handle.y + 12 }, { x: handle.x + 72, y: handle.y + 12 })
  await expect.poll(async () => (await importWindow.boundingBox()).width).toBeGreaterThan(afterMove.width + 40)
  await importWindow.getByRole('button', { name: 'Maximize นำเข้าข้อมูล - Import52FilesPage' }).click()
  await expect(importWindow).toHaveClass(/maximized/)
  await importWindow.getByRole('button', { name: 'Restore นำเข้าข้อมูล - Import52FilesPage' }).click()
  await importWindow.getByRole('button', { name: 'Minimize นำเข้าข้อมูล - Import52FilesPage' }).click()
  await expect(importWindow).toHaveCount(0)
  await page.locator('.window-dock').getByRole('button', { name: 'นำเข้าข้อมูล - Import52FilesPage', exact: true }).click()
  await expect(importWindow).toBeVisible()

  await navigation.getByRole('button', { name: '10 อันดับโรคระบาด 506', exact: true }).click()
  const d506 = page.getByRole('region', { name: '10 อันดับโรคระบาด 506 - D506Page window' })
  await expect(d506.locator('tbody tr')).toHaveCount(10)
  await page.getByRole('menuitem', { name: 'Window', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Tile windows', exact: true }).click()
  const tiledImport = await importWindow.boundingBox()
  const tiledD506 = await d506.boundingBox()
  assert.ok(tiledImport.x + tiledImport.width <= tiledD506.x, 'Tiled windows do not overlap')
  await page.screenshot({ path: 'artifacts/plkgap-mdi-windows.png', fullPage: true })
  await page.getByRole('menuitem', { name: 'Window', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Cascade windows', exact: true }).click()
  const cascadeImport = await importWindow.boundingBox()
  const cascadeD506 = await d506.boundingBox()
  assert.ok(cascadeD506.x > cascadeImport.x && cascadeD506.x < cascadeImport.x + cascadeImport.width)
  await page.getByRole('menuitem', { name: 'File', exact: true }).focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'นำเข้าข้อมูล' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'ตำแหน่งครัวเรือน (แฟ้ม Home)' })).toBeFocused()
  await page.keyboard.press('Enter')
  const map = page.getByRole('region', { name: 'ตำแหน่งครัวเรือน (แฟ้ม Home) - HouseholdMapPage window' })
  await expect(map).toBeVisible()

  const canvas = map.getByRole('application', { name: 'แผนที่ตำแหน่งครัวเรือน' })
  await expect(canvas).toBeVisible()
  const canvasBox = await canvas.boundingBox()
  const mapBox = await map.boundingBox()
  assert.ok(mapBox.width - canvasBox.width <= 2, 'Map canvas fills the window width apart from its border')
  const loadedTiles = (host) => map.locator(`img.leaflet-tile[src*="${host}"]`)
    .evaluateAll((images) => images.filter((image) => image.complete && image.naturalWidth > 0).length)
  await expect.poll(() => loadedTiles('tile.openstreetmap.org'), { timeout: 30000 }).toBeGreaterThan(0)
  await expect(map.locator('.leaflet-control-layers-expanded')).toBeVisible()
  await map.locator('.leaflet-control-layers-selector').nth(1).check()
  await expect.poll(() => loadedTiles('arcgisonline.com'), { timeout: 30000 }).toBeGreaterThan(0)
  await expect(map.locator('.map-legend')).toContainText('ตำแหน่งครัวเรือน')
  // Households come from the HOME file as green house markers inside a cluster layer.
  await expect(map.locator('.map-legend')).toContainText('ครัวเรือนที่มีพิกัด')
  await expect(map.locator('.leaflet-control-layers-overlays')).toContainText('ครัวเรือน')
  // Administrative outlines come from the boundaries seeded into c_district / c_subdistrict.
  await expect(map.locator('.leaflet-control-layers-overlays')).toContainText('ขอบเขตอำเภอ')
  await expect(map.locator('.leaflet-control-layers-overlays')).toContainText('ขอบเขตตำบล')
  // One SVG path per district. Whether a given polygon is inside the current viewport depends on
  // the zoom, so count the layers rather than asserting one is on screen.
  await expect(map.locator('path.leaflet-interactive')).toHaveCount(boundaries.districts.length, { timeout: 30000 })
  await page.screenshot({ path: 'artifacts/plkgap-map.png', fullPage: true })

  await navigation.getByRole('button', { name: 'คุณภาพตามโครงสร้าง', exact: true }).click()
  const structure = page.getByRole('region', { name: 'คุณภาพตามโครงสร้าง - StructureCheckPage window' })
  await expect(structure).toBeVisible()
  const structureRuns = structure.locator('table[aria-label="ไฟล์สำหรับตรวจตามโครงสร้าง"] tbody tr')
  await expect(structureRuns).toHaveCount(1)
  assert.deepEqual(await structure.locator('table[aria-label="ไฟล์สำหรับตรวจตามโครงสร้าง"] thead th').allInnerTexts(),
    ['ลำดับ', 'วัน-เวลานำเข้า', 'ชื่อไฟล์', 'File Size (MB)', 'แถว', 'ตรวจสอบ'])
  await expect(structureRuns.first()).toContainText('F43_07494_20260819111824.ZIP')
  await structureRuns.first().getByRole('button', { name: 'ตรวจตามโครงสร้าง' }).click()
  await expect(structure.locator('.section-title').last())
    .toHaveText('ผลตรวจ — F43_07494_20260819111824.ZIP', { timeout: 60000 })
  const findingTable = structure.locator('table[aria-label="ผลตรวจตามโครงสร้าง"]')
  const findings = findingTable.locator('tbody tr')
  // One row per field now: the rule each record broke belongs to the drill-down, not the grid.
  await expect(findings.first()).toBeVisible()
  const findingNames = await findings.evaluateAll((rows) => rows.map((row) => [row.cells[0].textContent, row.cells[1].textContent]))
  const nameOrder = new Intl.Collator('th', { numeric: true, sensitivity: 'base' })
  assert.deepEqual(findingNames, [...findingNames].sort((a, b) => nameOrder.compare(a[0], b[0]) || nameOrder.compare(a[1], b[1])))
  const issueFileNames = [...new Set(findingNames.map(([name]) => name))].sort(nameOrder.compare)
  const fileFilter = structure.getByLabel('กรองแฟ้ม', { exact: true })
  assert.deepEqual(await fileFilter.locator('option').allTextContents(), ['ทั้งหมด', ...issueFileNames])
  assert.ok((await fileFilter.boundingBox()).y >= (await structure.locator('.stat-grid').boundingBox()).y + (await structure.locator('.stat-grid').boundingBox()).height)
  await fileFilter.selectOption(issueFileNames[0].toLowerCase())
  await expect(findings).toHaveCount(findingNames.filter(([name]) => name === issueFileNames[0]).length)
  assert.ok((await findings.locator('td:first-child').allTextContents()).every((name) => name === issueFileNames[0]))
  await fileFilter.selectOption('all')
  assert.deepEqual(await findingTable.locator('thead th').allInnerTexts(),
    ['แฟ้ม', 'ฟิลด์', 'รายละเอียด', 'จำนวนแถว', 'ผ่าน', 'ร้อยละ', 'ไม่ผ่าน'])
  const fieldDefinition = reference.tables.find((table) => table.name === 'c_files_schema').rows
    .find((row) => row.table_name === findingNames[0][0] && row.name === findingNames[0][1])
  await expect(findings.first().locator('td').nth(2)).toHaveText(fieldDefinition.description || fieldDefinition.caption)
  // ร้อยละ counts what passed, so a field every row fails reads 0.00.
  await expect(findings.first()).toContainText('0.00')
  const firstCount = await findings.count()
  assert.ok(firstCount > 0, 'the structure check reports what it found')
  await structure.getByLabel('กรองระดับ').selectOption('error')
  await expect(findings).toHaveCount(firstCount)
  await structure.getByLabel('กรองระดับ').selectOption('warning')
  await expect(structure).toContainText('ไม่พบรายการตามตัวกรองที่เลือก')
  await structure.getByLabel('กรองระดับ').selectOption('all')
  await expect(findings).toHaveCount(firstCount)
  // The failing count is the way in: clicking it opens every failing record of that field.
  await findings.first().locator('td').last().getByRole('button').click()
  const modal = structure.locator('dialog[aria-label="แถวที่ไม่ผ่านเกณฑ์"]')
  const failingTable = modal.locator('table[aria-label="แถวที่ไม่ผ่านเงื่อนไข"]')
  await expect(modal).toBeVisible()
  await expect(failingTable.locator('tbody tr')).toHaveCount(1)
  const shownColumns = await failingTable.locator('thead th').allInnerTexts()
  for (const column of ['HOSPCODE', 'PID', 'SEQ', 'DATETIME_SERV']) {
    assert.ok(shownColumns.includes(column), `${column} is a standing column, got ${shownColumns.join(', ')}`)
  }
  assert.equal(shownColumns.at(-1), 'เกณฑ์', 'each record says which rule it broke')
  assert.ok((await failingTable.locator('tbody tr td:last-child').allInnerTexts()).every((rule) => rule.trim()),
    'no record is left without a rule')
  const beforeDrag = await modal.boundingBox()
  const modalHeader = modal.locator('header')
  const headerBox = await modalHeader.boundingBox()
  await page.mouse.move(headerBox.x + 60, headerBox.y + headerBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(headerBox.x + 160, headerBox.y + headerBox.height / 2 + 40, { steps: 8 })
  await page.mouse.up()
  const afterDrag = await modal.boundingBox()
  assert.ok(afterDrag.x > beforeDrag.x + 50 && afterDrag.y > beforeDrag.y + 20, 'The modal moves with its header')
  await modal.getByRole('button', { name: 'ปิด', exact: true }).click()
  await expect(modal).toBeHidden()
  await fileFilter.selectOption('village')
  const invalidCode = findings.filter({ hasText: 'WASTEWATER' })
  await expect(invalidCode).toHaveCount(1)
  await invalidCode.locator('td').last().getByRole('button').click()
  await expect(modal).toBeVisible()
  await expect(failingTable.locator('thead')).toContainText('WASTEWATER')
  await expect(failingTable.locator('tbody tr')).toHaveCount(1)
  const codeRow = failingTable.locator('tbody tr td')
  await expect(codeRow.nth(await codeRow.count() - 2)).toHaveText('2')
  await expect(codeRow.last()).toHaveText('ไม่ตรงตามรหัสมาตรฐาน')
  await page.screenshot({ path: 'artifacts/plkgap-structure-code-check.png', fullPage: true })
  await modal.getByRole('button', { name: 'ปิด', exact: true }).click()
  // The field name opens the list it is judged against, whenever the database holds one.
  const codesModal = structure.locator('dialog[aria-label="รหัสมาตรฐานของฟิลด์"]')
  await invalidCode.getByRole('button', { name: 'WASTEWATER' }).click()
  await expect(codesModal).toBeVisible()
  await expect(codesModal).toContainText('c_village_wastewater')
  const codesTable = codesModal.locator('table[aria-label="รหัสมาตรฐานใน c_village_wastewater"]')
  await expect(codesTable.locator('tbody tr')).toHaveCount(3)
  await expect(codesTable.locator('tbody tr').first()).toContainText('0')
  await page.screenshot({ path: 'artifacts/plkgap-structure-code-list.png', fullPage: true })
  await codesModal.getByRole('button', { name: 'ปิด', exact: true }).click()
  await expect(codesModal).toBeHidden()
  await fileFilter.selectOption(issueFileNames[0].toLowerCase())
  // The status bar reports the run at its far right. Arm the wait before the click: the check can
  // finish before an assertion would even look, and the bar clears itself when it does.
  const statusProgress = page.locator('.status-bar .status-progress')
  const captured = page.waitForFunction(() => {
    const bar = document.querySelector('.status-bar .status-progress')
    const end = document.querySelector('.status-bar .status-end')
    if (!bar || !end) return null
    return { text: bar.textContent, right: bar.getBoundingClientRect().right, endRight: end.getBoundingClientRect().right }
  }, null, { timeout: 60000, polling: 30 })
  await structureRuns.first().getByRole('button', { name: 'ตรวจตามโครงสร้าง' }).click()
  const shown = await (await captured).jsonValue()
  assert.ok(shown.text.includes('ตรวจตามโครงสร้าง'), `the status bar names the running check, got ${shown.text}`)
  assert.ok(shown.right > shown.endRight - 20, 'the progress sits at the far right of the status bar')
  await expect(findings).toHaveCount(firstCount, { timeout: 60000 })
  await expect(statusProgress).toBeHidden({ timeout: 10000 })
  await expect(fileFilter).toHaveValue('all')
  await page.screenshot({ path: 'artifacts/plkgap-structure-check.png', fullPage: true })

  await navigation.getByRole('button', { name: 'คุณภาพตามข้อสังเกต', exact: true }).click()
  const observations = page.getByRole('region', { name: 'คุณภาพตามข้อสังเกต - ObservationCheckPage window' })
  // Checking asks which rules to run first: the register comes up as a picker.
  const startCheck = () => observations.getByRole('button', { name: 'ตรวจตามข้อสังเกต', exact: true }).click()
  const picker = observations.getByRole('dialog', { name: 'ทะเบียนข้อสังเกต' })
  const confirm = () => picker.getByRole('button', { name: 'เริ่มตรวจสอบ', exact: true })
  await startCheck()
  await expect(picker).toBeVisible()
  const register = picker.getByRole('table', { name: 'ทะเบียนข้อสังเกต', exact: true })
  const registered = await register.locator('tbody tr').count()
  assert.ok(registered > 0, 'the observ_check register is seeded')
  await expect(register.getByRole('checkbox')).toHaveCount(registered)
  // Every registered rule starts ticked, so confirming runs the lot.
  await expect(picker.getByRole('checkbox', { checked: true })).toHaveCount(registered)
  // Same status bar, the other check: catch it in one shot, it clears itself when the run ends.
  const observationProgress = page.waitForFunction(() => {
    const bar = document.querySelector('.status-bar .status-progress')
    return bar ? bar.textContent : null
  }, null, { timeout: 60000, polling: 30 })
  await confirm().click()
  assert.ok((await (await observationProgress).jsonValue()).includes('ตรวจตามข้อสังเกต'),
    'the status bar names the observation run')
  await expect(picker).toBeHidden()
  const observationTable = observations.getByRole('table', { name: 'ผลตรวจตามข้อสังเกต', exact: true })
  await expect(observationTable.locator('tbody tr')).toHaveCount(registered)
  await expect(observationTable).not.toContainText('NCDSCREEN')
  // The result grid reads by file, so it opens sorted on the file it checked.
  const observedFiles = await observationTable.locator('tbody tr td:first-child').allInnerTexts()
  assert.deepEqual(observedFiles, [...observedFiles].sort(nameOrder.compare), 'observations open sorted by file')
  // The fixture only fills PERSON and SERVICE, so exactly the three rules reading them trip.
  const observationEntries = observationTable.locator('tbody tr')
    .filter({ has: page.locator('.status-pill.status-error, .status-pill.status-warning') })
  await expect(observationEntries).toHaveCount(3)
  for (let index = 0; index < 3; index++) {
    await expect(observationEntries.nth(index).locator('td').nth(4)).toHaveText('1')
    await observationEntries.nth(index).getByRole('button', { name: 'ดูแถวที่พบ' }).click()
    const observationDialog = observations.getByRole('dialog', { name: 'รายละเอียดข้อสังเกต' })
    await expect(observationDialog).toBeVisible()
    await expect(observationDialog.locator('tbody tr')).toHaveCount(1)
    await observationDialog.getByRole('button', { name: 'ปิด', exact: true }).click()
    await expect(observationDialog).toBeHidden()
  }
  // Unticking a rule leaves it out of the run, and the register keeps the choice for the next one.
  const prenameRule = register.locator('tbody tr').filter({ hasText: 'prename-sex' })
  await startCheck()
  await prenameRule.getByRole('checkbox').uncheck()
  await confirm().click()
  await expect(observationTable.locator('tbody tr')).toHaveCount(registered - 1)
  await expect(observationTable).not.toContainText('คำนำหน้าชื่อไม่สอดคล้องกับเพศ')
  await startCheck()
  await expect(prenameRule.getByRole('checkbox')).not.toBeChecked()
  // ยกเลิก drops the ticks made in the modal without touching the register.
  await prenameRule.getByRole('checkbox').check()
  await picker.getByRole('button', { name: 'ยกเลิก', exact: true }).click()
  await expect(picker).toBeHidden()
  await startCheck()
  await expect(prenameRule.getByRole('checkbox')).not.toBeChecked()
  await picker.getByRole('button', { name: 'ไม่เลือกเลย', exact: true }).click()
  await expect(confirm()).toBeDisabled()
  await picker.getByRole('button', { name: 'เลือกทั้งหมด', exact: true }).click()
  await page.screenshot({ path: 'artifacts/plkgap-observation-picker.png', fullPage: true })
  await confirm().click()
  await expect(observationTable.locator('tbody tr')).toHaveCount(registered)
  await page.screenshot({ path: 'artifacts/plkgap-observation-check.png', fullPage: true })

  // The local HTTP API answers off the same PGlite instance the windows are reading.
  const helpResponse = await fetch(`${api}/help`)
  assert.equal(helpResponse.status, 200)
  assert.equal(helpResponse.headers.get('access-control-allow-origin'), null, 'no CORS: a web page must not reach it')
  const helpBody = await helpResponse.json()
  assert.deepEqual(helpBody.endpoints.map((entry) => `${entry.method} ${entry.path}`),
    ['GET /help', 'GET /tables', 'GET /desc/{table_name}', 'POST /sql'])

  const tables = await (await fetch(`${api}/tables`)).json()
  assert.equal(tables.filter((entry) => entry.kind === 'file43').length, 52)
  assert.ok(tables.every((entry) => entry.rowCount === null), 'GET /tables answers without counting')
  const counted = await (await fetch(`${api}/tables?rows=1`)).json()
  assert.equal(counted.find((entry) => entry.table === 'person').rowCount, 1, 'rows=1 counts what was imported')
  assert.equal(counted.find((entry) => entry.table === 'c_file').rowCount, 52)
  assert.equal((await fetch(`${api}/tables`, { method: 'POST' })).status, 405)

  const describe = await fetch(`${api}/desc/person`)
  assert.equal(describe.status, 200)
  const person = await describe.json()
  assert.deepEqual(person.primaryKey, ['hospcode', 'pid'])
  assert.equal(person.rowCount, 1, 'it sees the row the import just brought in')
  assert.match(person.columns.find((column) => column.name === 'cid').caption, /บัตรประชาชน/)
  assert.equal((await fetch(`${api}/desc/nope`)).status, 404)
  assert.equal((await fetch(`${api}/desc/person`, { method: 'POST' })).status, 405)

  const query = async (sql, headers = { 'Content-Type': 'text/plain' }) =>
    fetch(`${api}/sql`, { method: 'POST', headers, body: sql })
  const selected = await query('SELECT hospcode, pid FROM person')
  assert.equal(selected.status, 200)
  assert.equal(selected.headers.get('X-Row-Count'), '1')
  assert.equal(selected.headers.get('X-Truncated'), 'false')
  assert.equal(selected.headers.get('X-Columns'), 'hospcode,pid')
  assert.deepEqual(await selected.json(), [{ hospcode: 'GA0014056', pid: 'TEST1' }],
    'POST /sql answers with a plain JSON array of rows')
  // Personal data is masked inside the database, so renaming or wrapping it changes nothing.
  const masked = await (await query('SELECT cid, cid AS copy, length(cid) AS n, pid FROM person')).json()
  assert.deepEqual(masked, [{ cid: '***', copy: '***', n: 3, pid: 'TEST1' }],
    'cid comes back masked however it is asked for')
  assert.equal((await (await query('SELECT * FROM person')).json())[0].cid, '***', 'SELECT * is masked too')
  const denied = await query('SELECT cid FROM public.person')
  assert.equal(denied.status, 400)
  assert.match((await denied.json()).error, /permission denied/, 'the unmasked table is out of reach')
  assert.ok(helpBody.endpoints.find((entry) => entry.path === '/sql').masked.columns
    .every((name) => ['lname', 'cid', 'telephone', 'mobile', 'home.house', 'home.house_id'].includes(name)),
    '/help lists what is masked')
  const asJson = await query(JSON.stringify({ sql: 'SELECT COUNT(*)::int AS n FROM c_file' }),
    { 'Content-Type': 'application/json' })
  assert.deepEqual(await asJson.json(), [{ n: 52 }])
  // Read-only is enforced by PostgreSQL — twice over, since the API role only holds SELECT —
  // and the app must still hold the row afterwards.
  const refused = await query('DELETE FROM person')
  assert.equal(refused.status, 400)
  assert.match((await refused.json()).error, /read-only transaction|permission denied/i)
  assert.deepEqual(await (await query('SELECT COUNT(*)::int AS n FROM person')).json(), [{ n: 1 }])
  assert.equal((await query('SELECT 1 FROM nowhere')).status, 400)
  assert.equal((await fetch(`${api}/sql`)).status, 405)
  assert.equal((await fetch(`${api}/nothing-here`)).status, 404)

  // The account panel owns the API switch, so it exists only once there is a signed-in account.
  const gatewayReach = async () => {
    try { return (await fetch(`${api}/help`)).status } catch { return 'refused' }
  }
  assert.equal(await gatewayReach(), 200, 'the API answers before the switch is touched')
  await account.click()
  const gatewaySwitch = accountPopup.getByRole('switch', { name: 'API Gateway', exact: true })
  await expect(gatewaySwitch).toHaveAttribute('aria-checked', 'true')
  await expect(gatewaySwitch).toHaveText('เปิด')
  await expect(accountPopup).toContainText(`127.0.0.1:${apiPort}`)
  await gatewaySwitch.click()
  await expect(gatewaySwitch).toHaveAttribute('aria-checked', 'false')
  await expect(gatewaySwitch).toHaveText('ปิด')
  await expect.poll(gatewayReach, { timeout: 15000 }).toBe('refused')
  await page.screenshot({ path: 'artifacts/plkgap-gateway-off.png', fullPage: true })
  // The choice is written where the app keeps it, so the next start opens the same way.
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'api-gateway.json'), 'utf8')), { enabled: false },
    'turning the API off is remembered on disk')
  await gatewaySwitch.click()
  await expect(gatewaySwitch).toHaveAttribute('aria-checked', 'true')
  await expect.poll(gatewayReach, { timeout: 15000 }).toBe(200)
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'api-gateway.json'), 'utf8')), { enabled: true })
  await page.keyboard.press('Escape')
  await expect(accountPopup).toBeHidden()

  await navigation.getByRole('button', { name: 'ตั้งค่าหน่วยบริการ', exact: true }).click()
  const serviceUnit = page.getByRole('region', { name: 'ตั้งค่าหน่วยบริการ - ServiceUnitPage window' })
  // Looks the unit up in the seeded c_hospital table over IPC — proves reference data is usable.
  await serviceUnit.getByLabel('รหัสหน่วยบริการ (HCODE)').fill('07476')
  await serviceUnit.getByRole('button', { name: 'ค้นหา' }).click()
  await expect(serviceUnit).toContainText('โรงพยาบาลส่งเสริมสุขภาพตำบลวังน้ำคู้')
  await expect(serviceUnit).toContainText('รพ.สต.วังน้ำคู้')
  await expect(serviceUnit).toContainText('เมืองพิษณุโลก')
  await expect(serviceUnit).toContainText('พิษณุโลก')
  await serviceUnit.getByLabel('รหัสหน่วยบริการ (HCODE)').fill('99999')
  await serviceUnit.getByRole('button', { name: 'ค้นหา' }).click()
  await expect(serviceUnit.getByRole('status')).toContainText('ไม่พบหน่วยบริการรหัส 99999')
  await page.screenshot({ path: 'artifacts/plkgap-settings.png', fullPage: true })

  // Quality pages show five rows; the import page shows fifteen before scrolling.
  for (let index = 0; index < 4; index++) await page.evaluate((path) => window.api.runImport(path), validZip)
  let importedCount = 5
  for (const count of [5, 6, 15, 16]) {
    while (importedCount < count) {
      await page.evaluate((path) => window.api.runImport(path), validZip)
      importedCount++
    }
    for (const [title, source] of [['นำเข้าข้อมูล', 'Import52FilesPage'], ['คุณภาพตามโครงสร้าง', 'StructureCheckPage'], ['คุณภาพตามข้อสังเกต', 'ObservationCheckPage']]) {
      const region = page.getByRole('region', { name: `${title} - ${source} window` })
      await navigation.getByRole('button', { name: title, exact: true }).click()
      await region.getByRole('button', { name: `Close ${title} - ${source}`, exact: true }).click()
      await navigation.getByRole('button', { name: title, exact: true }).click()
      const viewport = region.locator('.data-grid-scroll')
      await expect(viewport.locator('tbody tr')).toHaveCount(count)
      const visibleRows = source === 'Import52FilesPage' ? 15 : 5
      await expect.poll(() => viewport.evaluate((element) => element.scrollHeight > element.clientHeight + 1)).toBe(count > visibleRows)
      if (count > visibleRows) {
        const headerTop = await viewport.locator('thead th').first().evaluate((element) => element.getBoundingClientRect().top)
        await viewport.evaluate((element) => { element.scrollTop = element.scrollHeight })
        await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
        assert.ok(Math.abs(await viewport.locator('thead th').first().evaluate((element) => element.getBoundingClientRect().top) - headerTop) < 2)
      }
    }
  }
  await page.screenshot({ path: 'artifacts/plkgap-import-scroll.png', fullPage: true })

  await page.getByRole('menuitem', { name: 'เกี่ยวกับ', exact: true }).click()
  await page.getByRole('menuitem', { name: 'ผู้พัฒนา', exact: true }).click()
  const developers = page.getByRole('region', { name: 'ผู้พัฒนา - DevelopersPage window' })
  await expect(developers).toBeVisible()
  await expect(developers.locator('.person-card')).toHaveCount(2)
  await expect(developers).toContainText('นายสาธร สมบูรณ์')
  await expect(developers).toContainText('นายอุเทน จาดยางโทน')
  await expect(developers).toContainText('สำนักงานสาธารณสุขจังหวัดพิษณุโลก')
  await page.screenshot({ path: 'artifacts/plkgap-developers.png', fullPage: true })

  await page.getByRole('menuitem', { name: 'Window', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Close all windows' }).click()
  await expect(page.locator('.child-window')).toHaveCount(0)
  await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.unmaximize()
    win.setSize(640, 480)
  })
  await navigation.getByRole('button', { name: 'นำเข้าข้อมูล', exact: true }).click()
  await expect(importWindow).toBeVisible()
  const workspaceBox = await page.locator('.workspace').boundingBox()
  const smallImport = await importWindow.boundingBox()
  assert.ok(smallImport.x >= workspaceBox.x && smallImport.x + smallImport.width <= workspaceBox.x + workspaceBox.width + 1)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
  await account.click()
  await expect(accountPopup).toBeVisible()
  const smallPopup = await accountPopup.boundingBox()
  assert.ok(smallPopup.y >= 0 && smallPopup.x + smallPopup.width <= 640, 'account popup fits the small viewport')
  await page.keyboard.press('Escape')
  await page.screenshot({ path: 'artifacts/plkgap-small-window.png', fullPage: true })
  const divider = page.getByRole('separator', { name: 'Resize sidebar' })
  async function dragSidebarTo(x) {
    const bounds = await divider.boundingBox()
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100)
    await page.mouse.down()
    await page.mouse.move(x, bounds.y + 100, { steps: 12 })
    await page.mouse.up()
  }
  await dragSidebarTo(25)
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
  await expect(divider).toHaveAttribute('aria-valuenow', '44')
  await dragSidebarTo(245)
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible()
  assert.ok((await page.locator('.sidebar').boundingBox()).width > 200)
  await dragSidebarTo(600)
  const desktopWidth = (await page.locator('.desktop-body').boundingBox()).width
  assert.ok(Math.abs((await page.locator('.sidebar').boundingBox()).width - desktopWidth / 2) < 1, 'Drag stops at the center within pixel rounding')
  await expect(importWindow).toBeVisible()
  await page.screenshot({ path: 'artifacts/plkgap-sidebar-half-width.png', fullPage: true })
  await divider.focus()
  await page.keyboard.press('Home')
  await expect(divider).toHaveAttribute('aria-valuenow', '44')
  await page.keyboard.press('End')
  assert.ok(Math.abs((await page.locator('.sidebar').boundingBox()).width - desktopWidth / 2) < 1)
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  await mkdir('artifacts', { recursive: true })
  await page.screenshot({ path: 'artifacts/plkgap-desktop.png', fullPage: true })
  assert.deepEqual(errors, [])
  await page.getByRole('button', { name: 'Maximize application' }).click()
  await expect(page.getByRole('button', { name: 'Restore application' })).toBeVisible()
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()), true)
  await page.getByRole('button', { name: 'Restore application' }).click()
  await expect(page.getByRole('button', { name: 'Maximize application' })).toBeVisible()
  await page.getByRole('button', { name: 'Minimize application' }).click()
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true)
  await application.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.restore(); win.setSize(1100, 760); win.focus() })
  await page.screenshot({ path: 'artifacts/plkgap-custom-titlebar.png', fullPage: true })
  await account.click()
  await accountPopup.getByRole('button', { name: 'Logout', exact: true }).click()
  await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true })).toBeVisible()
  await expect(accountPopup).toBeHidden()
  await expect.poll(() => testSso.calls.revoked.length).toBe(1)
  await assert.rejects(access(join(directory, 'sso-session.bin')), { code: 'ENOENT' })
  await application.evaluate(({ dialog }) => {
    globalThis.confirmCalls = 0
    dialog.showMessageBox = async () => { globalThis.confirmCalls++; return { response: 1 } }
  })
  await page.getByRole('button', { name: 'Close application' }).click()
  await expect.poll(() => application.evaluate(() => globalThis.confirmCalls)).toBe(1)
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1, 'Cancel keeps the application open')
  await expect(page.getByRole('button', { name: 'Close application' })).toBeVisible()
  await application.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }) })
  const closed = application.waitForEvent('close')
  await page.getByRole('button', { name: 'Close application' }).click()
  await closed
  application = undefined
  console.log('PASS: Electron MDI menu groups, sidebar collapse, move/resize, minimize/restore, tile/cascade, keyboard menu, small viewport, household map tiles, settings form, about/developers menu and database status')
} finally {
  if (application) await application.close()
  await testSso.close()
  await rm(directory, { recursive: true, force: true })
  await rm(importDirectory, { recursive: true, force: true })
}
