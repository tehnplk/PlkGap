import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import yazl from 'yazl'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import reference from '../src/main/reference/c-tables.json' with { type: 'json' }
import files from '../src/main/reference/f43-tables.json' with { type: 'json' }

const referenceRows = reference.tables.reduce((sum, table) => sum + table.rows.length, 0)
// A fresh temp userData is exactly the state of a brand new machine after install.
const directory = await mkdtemp(join(tmpdir(), 'plkgap-ui-test-'))
// A stand-in for the Desktop, so the test never reads the real one.
const importDirectory = await mkdtemp(join(tmpdir(), 'plkgap-import-test-'))
const standardFiles = files.tables.map((table) => table.name)
function writeZip(path, entries) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile()
    for (const name of entries) zip.addBuffer(Buffer.from('HOSPCODE|PID'), name)
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
const env = { ...process.env, PLKGAP_TEST_DATA_DIR: directory, PLKGAP_IMPORT_DIR: importDirectory }
delete env.ELECTRON_RUN_AS_NODE
let application
try {
  application = await electron.launch({ args: ['.'], env, timeout: 60000 })
  const page = await application.firstWindow({ timeout: 60000 })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('status').filter({ hasText: 'Connected' }).waitFor({ timeout: 60000 })
  // First run on a new machine: the c_* reference data is already usable and the 52 files exist empty.
  const statusBar = page.locator('.status-bar')
  await expect(statusBar).toContainText(`${reference.tables.length} ตารางอ้างอิง`)
  await expect(statusBar).toContainText(`${referenceRows.toLocaleString('en-US')} รายการ`)
  await expect(statusBar).toContainText(`${files.tables.length} แฟ้มพร้อมนำเข้า`)
  await mkdir('artifacts', { recursive: true })
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
  await expect(page.locator('.main-title')).toHaveText(/^PlkGap version \d+\.\d+\.\d+$/)
  assert.equal(menuBounds.y, 0, 'Menu is in the top title-bar row')
  assert.equal(menuBounds.height, titleBounds.height, 'Menu shares the title-bar height')
  assert.equal(workspaceBounds.y, menuBounds.y + menuBounds.height, 'Workspace starts directly below main menu')
  assert.equal(workspaceBounds.y + workspaceBounds.height, statusBounds.y, 'Workspace fills available height')

  // Sidebar menu groups: every group header is present and children live inside their own group
  const groupNames = ['ระบบ 43 แฟ้ม', 'ระบบวิเคราะห์ข้อมูล', 'ระบบแผนที่', 'ระบบสื่อสาร', 'ระบบระบาดวิทยาและควบคุมโรค', 'ตั้งค่า']
  for (const name of groupNames) await expect(navigation.getByRole('button', { name, exact: true })).toBeVisible()
  const files43 = navigation.getByRole('button', { name: 'ระบบ 43 แฟ้ม', exact: true })
  await expect(files43).toHaveAttribute('aria-expanded', 'true')
  await expect(navigation.getByRole('button', { name: 'ตรวจตามโครงสร้าง', exact: true })).toBeVisible()
  await files43.click()
  await expect(files43).toHaveAttribute('aria-expanded', 'false')
  await expect(navigation.getByRole('button', { name: 'ตรวจตามโครงสร้าง', exact: true })).toBeHidden()
  await files43.click()
  await expect(navigation.getByRole('button', { name: 'ตรวจตามโครงสร้าง', exact: true })).toBeVisible()
  await page.screenshot({ path: 'artifacts/plkgap-sidebar-groups.png', fullPage: true })

  await navigation.getByRole('button', { name: 'นำเข้าข้อมูล', exact: true }).click()
  const importWindow = page.getByRole('region', { name: 'นำเข้าข้อมูล - Import52FilePage window' })
  await expect(importWindow).toBeVisible()
  await expect(importWindow).toHaveClass(/maximized/)
  assert.deepEqual(await page.locator('.workspace').boundingBox(), workspaceBounds, 'Opening a child does not shrink the workspace')
  // The grid is the import history: empty until something is actually imported.
  await expect(importWindow.locator('tbody tr')).toHaveCount(0)
  await expect(importWindow).toContainText('ยังไม่มีประวัติการนำเข้า')
  await expect(importWindow.getByRole('button', { name: 'ล้างประวัติ' })).toHaveCount(0)
  await expect(importWindow.locator('.section-title')).toHaveText('ประวัติการนำเข้า')
  assert.deepEqual(await importWindow.locator('thead th').allInnerTexts(),
    ['#', 'วัน-เวลานำเข้า', 'ชื่อไฟล์', 'File Size (MB)', 'สถานะ', 'คุณภาพโครงสร้าง'])
  // Child window titles carry the page component that renders them.
  await expect(importWindow.locator('.window-titlebar > span')).toHaveText('นำเข้าข้อมูล - Import52FilePage')

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
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false')
  assert.ok((await page.locator('.workspace').boundingBox()).width > workspaceBounds.width, 'Collapsing gives space back to MDI')
  await expect(importWindow).toBeVisible()
  await page.screenshot({ path: 'artifacts/plkgap-sidebar-collapsed.png', fullPage: true })
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  await expect(navigation.getByRole('button', { name: 'นำเข้าข้อมูล', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(importWindow).toBeVisible()
  await page.screenshot({ path: 'artifacts/plkgap-sidebar-expanded.png', fullPage: true })
  await navigation.getByRole('button', { name: 'นำเข้าข้อมูล', exact: true }).click()
  await expect(importWindow).toHaveCount(1)

  await importWindow.getByRole('button', { name: 'Restore นำเข้าข้อมูล - Import52FilePage' }).click()
  await expect(importWindow).not.toHaveClass(/maximized/)
  const beforeMove = await importWindow.boundingBox()
  await page.mouse.move(beforeMove.x + 100, beforeMove.y + 18)
  await page.mouse.down()
  await page.mouse.move(beforeMove.x + 170, beforeMove.y + 38, { steps: 8 })
  await page.mouse.up()
  const afterMove = await importWindow.boundingBox()
  assert.ok(afterMove.x > beforeMove.x + 50, 'Child window moves')
  const handle = await importWindow.locator('.resize-handle').boundingBox()
  await page.mouse.move(handle.x + 12, handle.y + 12)
  await page.mouse.down()
  await page.mouse.move(handle.x + 72, handle.y + 12, { steps: 8 })
  await page.mouse.up()
  assert.ok((await importWindow.boundingBox()).width > afterMove.width + 40, 'Child window resizes')
  await importWindow.getByRole('button', { name: 'Maximize นำเข้าข้อมูล - Import52FilePage' }).click()
  await expect(importWindow).toHaveClass(/maximized/)
  await importWindow.getByRole('button', { name: 'Restore นำเข้าข้อมูล - Import52FilePage' }).click()
  await importWindow.getByRole('button', { name: 'Minimize นำเข้าข้อมูล - Import52FilePage' }).click()
  await expect(importWindow).toHaveCount(0)
  await page.locator('.window-dock').getByRole('button', { name: 'นำเข้าข้อมูล - Import52FilePage', exact: true }).click()
  await expect(importWindow).toBeVisible()

  await navigation.getByRole('button', { name: 'ไข้เลือดออก', exact: true }).click()
  const dengue = page.getByRole('region', { name: 'ไข้เลือดออก - DenguePage window' })
  await expect(dengue.locator('tbody tr')).toHaveCount(5)
  await expect(dengue.locator('.bar-chart .bar')).toHaveCount(12)
  await page.getByRole('menuitem', { name: 'Window', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Tile windows', exact: true }).click()
  const tiledImport = await importWindow.boundingBox()
  const tiledDengue = await dengue.boundingBox()
  assert.ok(tiledImport.x + tiledImport.width <= tiledDengue.x, 'Tiled windows do not overlap')
  await page.screenshot({ path: 'artifacts/plkgap-mdi-windows.png', fullPage: true })
  await page.getByRole('menuitem', { name: 'Window', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Cascade windows', exact: true }).click()
  const cascadeImport = await importWindow.boundingBox()
  const cascadeDengue = await dengue.boundingBox()
  assert.ok(cascadeDengue.x > cascadeImport.x && cascadeDengue.x < cascadeImport.x + cascadeImport.width)
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
  const markerIcon = map.locator('img.leaflet-marker-icon').first()
  await expect(markerIcon).toBeVisible()
  await expect.poll(async () => markerIcon.evaluate((img) => img.complete && img.naturalWidth > 0), { timeout: 10000 }).toBe(true)
  const markerShadow = map.locator('img.leaflet-marker-shadow').first()
  await expect(markerShadow).toBeVisible()
  await expect.poll(async () => markerShadow.evaluate((img) => img.complete && img.naturalWidth > 0), { timeout: 10000 }).toBe(true)
  await page.screenshot({ path: 'artifacts/plkgap-map.png', fullPage: true })

  await navigation.getByRole('button', { name: 'ตรวจตามโครงสร้าง', exact: true }).click()
  const structure = page.getByRole('region', { name: 'ตรวจตามโครงสร้าง - StructureCheckPage window' })
  await expect(structure).toBeVisible()
  await expect(structure.locator('tbody tr')).toHaveCount(7)
  await structure.getByLabel('กรองระดับ').selectOption('error')
  await expect(structure.locator('tbody tr')).toHaveCount(3)
  await structure.getByLabel('กรองระดับ').selectOption('all')
  await expect(structure.locator('tbody tr')).toHaveCount(7)
  await page.screenshot({ path: 'artifacts/plkgap-structure-check.png', fullPage: true })

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
  await rm(directory, { recursive: true, force: true })
  await rm(importDirectory, { recursive: true, force: true })
}
