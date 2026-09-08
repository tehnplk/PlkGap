import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { basename, join } from 'node:path'
import { stat } from 'node:fs/promises'
import { startApiServer } from './server'
import { databaseStatus, finishImportRun, findHospital, insertStandardRows, listImportLog, checkImportStructure, countByFiscalYears, listBoundaries, listHouseholds, listObservationRules, listStandardFiles, setObservationRuleActive, structureFailingRows, structureResult, openDatabase, startImportRun, updateImportProgress } from './database'
import { checkImportZip, eachZipTextEntry, parsePipeFile } from './Import52Files'
import type { IpcMainInvokeEvent } from 'electron'
import { checkObservations, observationRows } from './database'

let window: BrowserWindow | null = null
let db: Awaited<ReturnType<typeof openDatabase>> | undefined
let api: Awaited<ReturnType<typeof startApiServer>> | undefined
let closing = false
let confirmedExit = false
let confirming = false
const testData = process.env.PLKGAP_TEST_DATA_DIR
if (testData) app.setPath('userData', testData)

function createWindow() {
  window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    frame: false,
    backgroundColor: '#f4f6fa',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.maximize()
  const mainWindow = window
  const publishWindowState = () => {
    if (!mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('window:maximized', mainWindow.isMaximized())
  }
  mainWindow.on('maximize', publishWindowState)
  mainWindow.on('unmaximize', publishWindowState)
  mainWindow.on('close', (event) => {
    if (confirmedExit) return
    event.preventDefault()
    if (confirming) return
    confirming = true
    void dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Exit', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: 'Exit PlkGap',
      message: 'Exit PlkGap?',
      detail: 'The local database will be closed.',
    }).then(({ response }) => {
      confirming = false
      if (response !== 0 || mainWindow.isDestroyed()) return
      confirmedExit = true
      mainWindow.close()
    })
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.on('closed', () => { window = null })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  Menu.setApplicationMenu(null)
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  app.whenReady().then(async () => {
    const path = join(app.getPath('userData'), 'plkgap-pglite')
    db = await openDatabase(path)
    if (closing) { await db.close(); app.exit(); return }
    api = await startApiServer(db)
    const authorizedWindow = (event: IpcMainInvokeEvent) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Unauthorized sender')
      return window
    }
    ipcMain.handle('window:minimize', (event) => authorizedWindow(event).minimize())
    ipcMain.handle('window:toggle-maximize', (event) => {
      const target = authorizedWindow(event)
      if (target.isMaximized()) target.unmaximize()
      else target.maximize()
    })
    ipcMain.handle('window:is-maximized', (event) => authorizedWindow(event).isMaximized())
    ipcMain.handle('window:close', (event) => {
      const target = authorizedWindow(event)
      setImmediate(() => { if (!target.isDestroyed()) target.close() })
    })
    ipcMain.handle('database:status', (event) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('Unauthorized sender')
      }
      return databaseStatus(db!, path)
    })
    ipcMain.handle('hospital:find', (event, hospcode: unknown) => {
      authorizedWindow(event)
      return findHospital(db!, String(hospcode ?? ''))
    })
    // Where the 43-file zips are dropped. Tests redirect it so they never read the real Desktop.
    const importDirectory = () => process.env.PLKGAP_IMPORT_DIR ?? join(app.getPath('desktop'), 'Zip')
    ipcMain.handle('import:choose-file', async (event) => {
      const target = authorizedWindow(event)
      const result = await dialog.showOpenDialog(target, {
        title: 'เลือกไฟล์ 52 แฟ้ม',
        defaultPath: importDirectory(),
        properties: ['openFile'],
        filters: [{ name: 'ไฟล์ ZIP', extensions: ['zip'] }],
      })
      return result.canceled ? null : result.filePaths[0] ?? null
    })
    ipcMain.handle('geo:boundaries', (event, level: unknown) => {
      authorizedWindow(event)
      return listBoundaries(db!, String(level ?? '') as Parameters<typeof listBoundaries>[1])
    })
    ipcMain.handle('home:list', (event) => {
      authorizedWindow(event)
      return listHouseholds(db!)
    })
    ipcMain.handle('files:list', (event) => {
      authorizedWindow(event)
      return listStandardFiles(db!)
    })
    ipcMain.handle('files:count-by-year', async (event, table: unknown, years: unknown) => {
      authorizedWindow(event)
      const list = Array.isArray(years) ? years.map(Number).filter(Number.isFinite) : []
      return countByFiscalYears(db!, String(table ?? ''), list)
    })
    ipcMain.handle('structure:check', (event, zipName: unknown) => {
      authorizedWindow(event)
      return checkImportStructure(db!, String(zipName ?? ''))
    })
    ipcMain.handle('observations:check', (event, zipName: unknown) => {
      authorizedWindow(event)
      return checkObservations(db!, String(zipName ?? ''))
    })
    ipcMain.handle('observations:rows', (event, zipName: unknown, rule: unknown) => {
      authorizedWindow(event)
      return observationRows(db!, String(zipName ?? ''), String(rule ?? ''))
    })
    ipcMain.handle('observations:rules', (event) => {
      authorizedWindow(event)
      return listObservationRules(db!)
    })
    ipcMain.handle('observations:set-active', (event, rule: unknown, active: unknown) => {
      authorizedWindow(event)
      return setObservationRuleActive(db!, String(rule ?? ''), active === true)
    })
    ipcMain.handle('structure:result', (event, zipName: unknown) => {
      authorizedWindow(event)
      return structureResult(db!, String(zipName ?? ''))
    })
    ipcMain.handle('structure:failing-rows', (event, zipName: unknown, tableName: unknown, columnName: unknown, rule: unknown) => {
      authorizedWindow(event)
      return structureFailingRows(db!, String(zipName ?? ''), String(tableName ?? ''), String(columnName ?? ''), String(rule ?? ''))
    })
    ipcMain.handle('import:log', (event) => {
      authorizedWindow(event)
      return listImportLog(db!)
    })
    ipcMain.handle('import:check-file', async (event, path: unknown) => {
      authorizedWindow(event)
      return checkImportZip(String(path ?? ''), await listStandardFiles(db!))
    })
    ipcMain.handle('import:run', async (event, path: unknown) => {
      const target = authorizedWindow(event)
      const file = String(path ?? '')
      const standard = await listStandardFiles(db!)
      const check = await checkImportZip(file, standard)
      if (!check.valid) throw new Error(check.error || 'ไฟล์นี้ไม่ใช่ชุด 52 แฟ้ม จึงนำเข้าไม่ได้')
      const runId = await startImportRun(db!, {
        name: basename(file),
        path: file,
        size: (await stat(file)).size,
      })
      let files = 0
      let rowCount = 0
      try {
        await eachZipTextEntry(file, async (entry, text) => {
          const table = basename(entry).replace(/\.[^.]*$/, '').toLowerCase()
          if (!standard.includes(table)) return
          const parsed = parsePipeFile(text)
          rowCount += await insertStandardRows(db!, runId, table, parsed.header, parsed.rows)
          files += 1
          const percent = Math.round((files / standard.length) * 100)
          await updateImportProgress(db!, runId, percent, rowCount)
          if (!target.isDestroyed()) target.webContents.send('import:progress', { runId, percent, file: table, rowCount })
        })
      } catch (reason: unknown) {
        await finishImportRun(db!, runId, { status: 'failed', rowCount, message: String(reason) })
        throw reason
      }
      await finishImportRun(db!, runId, { status: 'complete', rowCount, message: '' })
      return { runId, files, rowCount }
    })
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  }).catch((error: unknown) => {
    dialog.showErrorBox('PlkGap startup failed', String(error))
    app.quit()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', (event) => {
    if (!db || db.closed) return
    event.preventDefault()
    if (closing) return
    closing = true
    ipcMain.removeHandler('database:status')
    ipcMain.removeHandler('hospital:find')
    ipcMain.removeHandler('import:choose-file')
    ipcMain.removeHandler('geo:boundaries')
    ipcMain.removeHandler('home:list')
    ipcMain.removeHandler('files:list')
    ipcMain.removeHandler('files:count-by-year')
    ipcMain.removeHandler('structure:check')
    ipcMain.removeHandler('observations:check')
    ipcMain.removeHandler('observations:rows')
    ipcMain.removeHandler('observations:rules')
    ipcMain.removeHandler('observations:set-active')
    ipcMain.removeHandler('structure:result')
    ipcMain.removeHandler('structure:failing-rows')
    ipcMain.removeHandler('import:log')
    ipcMain.removeHandler('import:check-file')
    ipcMain.removeHandler('import:run')
    void Promise.resolve(api?.close()).catch(console.error)
      .then(() => db!.close()).catch(console.error).finally(() => app.exit())
  })
}
