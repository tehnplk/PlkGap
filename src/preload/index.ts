import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi } from '../shared/api'

const api: AppApi = {
  databaseStatus: () => ipcRenderer.invoke('database:status'),
  findHospital: (hospcode) => ipcRenderer.invoke('hospital:find', hospcode),
  chooseImportFile: () => ipcRenderer.invoke('import:choose-file'),
  listImportLog: () => ipcRenderer.invoke('import:log'),
  checkImportFile: (path) => ipcRenderer.invoke('import:check-file', path),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onWindowMaximized: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized)
    ipcRenderer.on('window:maximized', listener)
    return () => ipcRenderer.removeListener('window:maximized', listener)
  },
}
contextBridge.exposeInMainWorld('api', api)
