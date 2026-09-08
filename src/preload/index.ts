import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi } from '../shared/api'

const api: AppApi = {
  databaseStatus: () => ipcRenderer.invoke('database:status'),
  findHospital: (hospcode) => ipcRenderer.invoke('hospital:find', hospcode),
  chooseImportFile: () => ipcRenderer.invoke('import:choose-file'),
  listBoundaries: (level) => ipcRenderer.invoke('geo:boundaries', level),
  listHouseholds: () => ipcRenderer.invoke('home:list'),
  listStandardFiles: () => ipcRenderer.invoke('files:list'),
  countByFiscalYears: (table, years) => ipcRenderer.invoke('files:count-by-year', table, years),
  checkStructure: (zipName) => ipcRenderer.invoke('structure:check', zipName),
  checkObservations: (zipName) => ipcRenderer.invoke('observations:check', zipName),
  observationRows: (zipName, rule) => ipcRenderer.invoke('observations:rows', zipName, rule),
  listObservationRules: () => ipcRenderer.invoke('observations:rules'),
  setObservationRuleActive: (rule, active) => ipcRenderer.invoke('observations:set-active', rule, active),
  structureResult: (zipName) => ipcRenderer.invoke('structure:result', zipName),
  failingRows: (zipName, tableName, columnName, rule) =>
    ipcRenderer.invoke('structure:failing-rows', zipName, tableName, columnName, rule),
  listImportLog: () => ipcRenderer.invoke('import:log'),
  checkImportFile: (path) => ipcRenderer.invoke('import:check-file', path),
  runImport: (path) => ipcRenderer.invoke('import:run', path),
  onImportProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof callback>[0]) => callback(progress)
    ipcRenderer.on('import:progress', listener)
    return () => ipcRenderer.removeListener('import:progress', listener)
  },
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
