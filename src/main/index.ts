import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { join } from 'node:path'
import { databaseStatus, openDatabase } from './database'

let window: BrowserWindow | null = null
let db: Awaited<ReturnType<typeof openDatabase>> | undefined
let closing = false
const testData = process.env.PLKGAP_TEST_DATA_DIR
if (testData) app.setPath('userData', testData)

function createWindow() {
  window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#f4f6fa',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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
    ipcMain.handle('database:status', (event) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('Unauthorized sender')
      }
      return databaseStatus(db!, path)
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
    void db.close().catch(console.error).finally(() => app.exit())
  })
}
